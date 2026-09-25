import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { resolveAuthContext } from '@/lib/utils/api'
import { apiSuccess, apiError } from '@/types/api'
import { persistExtraction } from '@/lib/intake/persist-extraction'
import { INTAKE_ROLES, IntakeCommitSchema, validatePdfUpload } from '@/lib/intake/validate'
import { isSampleMrn } from '@/lib/intake/sample-letters'
import { closeSampleEpisode } from '@/lib/intake/sample-restart'
import type { ExtractionResult } from '@/lib/ai/extraction'

export const maxDuration = 60

/**
 * Document-first intake, step 2: the nurse has checked the pre-filled form.
 * Creates (or reuses by MRN) the patient, opens the episode, stores the PDF
 * against it and writes the draft summary from the confirmed extraction, so
 * the nurse lands straight on the review/approve page.
 *
 * Demo: a sample patient's open care plan is closed so the letter can be
 * added again (lib/intake/sample-restart.ts).
 *
 * All writes go through the service client after the caller's hospital has
 * been resolved from their profile — a nurse may legitimately open a new
 * episode for a returning patient who is assigned to a colleague, which the
 * row-level SELECT policy would otherwise hide from them.
 */
export async function POST(request: Request) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { profile } = auth
  if (!INTAKE_ROLES.has(profile.role)) {
    return NextResponse.json(apiError('Forbidden'), { status: 403 })
  }

  const formData = await request.formData()
  const file = formData.get('file')
  const invalidFile = validatePdfUpload(file)
  if (invalidFile) return NextResponse.json(apiError(invalidFile), { status: 422 })

  let payload: unknown
  try {
    payload = JSON.parse(String(formData.get('payload') ?? ''))
  } catch {
    return NextResponse.json(apiError('Invalid payload'), { status: 400 })
  }
  const parsed = IntakeCommitSchema.safeParse(payload)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return NextResponse.json(apiError(first ? `${first.path.join('.')}: ${first.message}` : 'Validation error'), { status: 422 })
  }
  const { patient: patientInput, episode: episodeInput, extraction } = parsed.data
  const hospitalId = profile.hospital_id
  const phone = patientInput.phone_e164
  const supabase = await createServiceClient()

  // 1. Patient: reuse by MRN within the hospital, otherwise create.
  const { data: existing } = await supabase
    .from('patients')
    .select('id, assigned_nurse_id, metadata')
    .eq('hospital_id', hospitalId)
    .eq('mrn', patientInput.mrn)
    .maybeSingle()

  const demographics = {
    gender: patientInput.gender,
    nationality: patientInput.nationality,
    last_encounter: {
      diagnosis: episodeInput.diagnosis,
      admission_date: episodeInput.admission_date,
      ward: episodeInput.ward,
      attending_physician: episodeInput.attending_physician,
    },
  }

  let patientId: string
  if (existing) {
    // Nurse-confirmed details win (a returning patient may have a new number).
    const { error } = await supabase
      .from('patients')
      .update({
        full_name: patientInput.full_name,
        phone_e164: phone,
        preferred_language: patientInput.preferred_language,
        date_of_birth: patientInput.date_of_birth,
        assigned_nurse_id: existing.assigned_nurse_id ?? profile.id,
        metadata: { ...((existing.metadata as Record<string, unknown>) ?? {}), ...demographics },
      })
      .eq('id', existing.id)
    if (error) return NextResponse.json(apiError('Failed to update patient', error.message), { status: 500 })
    patientId = existing.id
  } else {
    const { data: created, error } = await supabase
      .from('patients')
      .insert({
        hospital_id: hospitalId,
        mrn: patientInput.mrn,
        full_name: patientInput.full_name,
        phone_e164: phone,
        preferred_language: patientInput.preferred_language,
        date_of_birth: patientInput.date_of_birth,
        assigned_nurse_id: profile.id,
        metadata: demographics,
      })
      .select('id')
      .single()
    if (error || !created) return NextResponse.json(apiError('Failed to create patient', error?.message), { status: 500 })
    patientId = created.id
  }

  // 2. One open episode per patient. A sample patient's is closed so the demo can go again.
  const { data: openEpisode } = await supabase
    .from('care_episodes')
    .select('id, status')
    .eq('patient_id', patientId)
    .in('status', ['draft', 'pending_review', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const restartsSample = !!openEpisode && isSampleMrn(patientInput.mrn)
  if (openEpisode && !(restartsSample && (await closeSampleEpisode(supabase, openEpisode.id)))) {
    // The envelope carries the existing episode so the form can link to it.
    return NextResponse.json(
      { ...apiError('This patient already has an open episode'), data: { episode_id: openEpisode.id, status: openEpisode.status } },
      { status: 409 },
    )
  }

  const { data: episode, error: episodeErr } = await supabase
    .from('care_episodes')
    .insert({
      hospital_id: hospitalId,
      patient_id: patientId,
      discharge_date: episodeInput.discharge_date,
      assigned_nurse_id: profile.id,
    })
    .select('id')
    .single()
  if (episodeErr || !episode) {
    return NextResponse.json(apiError('Failed to create episode', episodeErr?.message), { status: 500 })
  }
  const episodeId = episode.id

  // Anything that fails from here leaves the nurse with a usable episode page
  // (where the document can be re-uploaded), except an upload failure — then
  // the empty episode is removed so intake can simply be retried.
  const rollbackEpisode = () => supabase.from('care_episodes').delete().eq('id', episodeId)

  // 3. Store the PDF against the episode.
  const pdf = file as File
  const storagePath = `${hospitalId}/${episodeId}/${Date.now()}-${pdf.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const { error: uploadErr } = await supabase.storage
    .from('discharge-documents')
    .upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false })
  if (uploadErr) {
    await rollbackEpisode()
    return NextResponse.json(apiError('Upload failed', uploadErr.message), { status: 500 })
  }

  const rawExtraction: ExtractionResult = {
    ...extraction,
    patient: {
      full_name: patientInput.full_name,
      mrn: patientInput.mrn,
      date_of_birth: patientInput.date_of_birth,
      gender: patientInput.gender,
      nationality: patientInput.nationality,
      phone: null,
    },
    encounter: {
      diagnosis: episodeInput.diagnosis,
      admission_date: episodeInput.admission_date,
      discharge_date: episodeInput.discharge_date,
      ward: episodeInput.ward,
      attending_physician: episodeInput.attending_physician,
    },
  }

  const { data: doc, error: docErr } = await supabase
    .from('discharge_documents')
    .insert({
      episode_id: episodeId,
      hospital_id: hospitalId,
      storage_path: storagePath,
      original_filename: pdf.name,
      uploaded_by: profile.id,
      extraction_status: 'completed',
      raw_extraction: rawExtraction as never,
    })
    .select('id')
    .single()
  if (docErr || !doc) {
    await supabase.storage.from('discharge-documents').remove([storagePath])
    await rollbackEpisode()
    return NextResponse.json(apiError('Failed to record document', docErr?.message), { status: 500 })
  }

  await supabase.from('patient_timeline_events').insert({
    episode_id: episodeId,
    hospital_id: hospitalId,
    event_type: 'discharge_uploaded',
    payload: { document_id: doc.id, filename: pdf.name, intake: 'document_first', ...(restartsSample ? { replaces_episode_id: openEpisode!.id } : {}) },
    created_by: profile.id,
  })

  // 4. Draft summary from the confirmed extraction (+ translations in the background).
  const { data: hospital } = await supabase.from('hospitals').select('settings, timezone').eq('id', hospitalId).single()
  const hospitalLangs = ((hospital?.settings as { languages?: string[] } | null)?.languages) ?? ['en']
  const timezone = (hospital?.timezone as string | null) ?? 'Asia/Dubai'

  try {
    const summaryId = await persistExtraction({
      serviceClient: supabase,
      episodeId,
      hospitalId,
      documentId: doc.id,
      extracted: rawExtraction,
      targetLanguages: [patientInput.preferred_language, ...hospitalLangs],
      timezone,
    })
    return NextResponse.json(
      apiSuccess({ episode_id: episodeId, patient_id: patientId, summary_id: summaryId, patient_existed: !!existing, restarted_sample: restartsSample }),
      { status: 201 },
    )
  } catch (err) {
    console.error('[Intake commit] summary', err)
    return NextResponse.json(
      {
        ...apiError('Patient and episode were created but the summary could not be saved', err instanceof Error ? err.message : undefined),
        data: { episode_id: episodeId },
      },
      { status: 500 },
    )
  }
}
