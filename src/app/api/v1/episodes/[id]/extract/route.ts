import { NextResponse, after } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveAuthContext } from '@/lib/utils/api'
import { apiSuccess, apiError } from '@/types/api'
import { extractTextFromPdf, extractDischargeData } from '@/lib/ai/extraction'
import { translateAndStoreSummary } from '@/lib/ai/translation'
import type { LanguageCode } from '@/types/enums'

export const maxDuration = 60

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { profile } = auth
  const { id: episodeId } = await params

  if (!['super_admin', 'hospital_admin', 'discharge_coordinator', 'nurse'].includes(profile.role)) {
    return NextResponse.json(apiError('Forbidden'), { status: 403 })
  }

  const { document_id } = await request.json()

  if (!document_id) {
    return NextResponse.json(apiError('document_id is required'), { status: 400 })
  }

  const supabase = await createClient()
  const serviceClient = await createServiceClient()

  // Verify document belongs to this episode
  const { data: doc } = await supabase
    .from('discharge_documents')
    .select('id, extraction_status, storage_path')
    .eq('id', document_id)
    .eq('episode_id', episodeId)
    .single()

  if (!doc) {
    return NextResponse.json(apiError('Document not found'), { status: 404 })
  }

  if (doc.extraction_status === 'processing') {
    return NextResponse.json(apiError('Extraction already in progress'), { status: 409 })
  }

  // Mark as processing
  await serviceClient
    .from('discharge_documents')
    .update({ extraction_status: 'processing' })
    .eq('id', document_id)

  try {
    // Download PDF from Supabase Storage
    const { data: fileData, error: downloadError } = await serviceClient.storage
      .from('discharge-documents')
      .download(doc.storage_path)

    if (downloadError || !fileData) {
      await serviceClient
        .from('discharge_documents')
        .update({ extraction_status: 'failed' })
        .eq('id', document_id)
      return NextResponse.json(apiError('Failed to download document from storage'), { status: 500 })
    }

    // Extract text from PDF
    const buffer = Buffer.from(await fileData.arrayBuffer())
    const pdfText = await extractTextFromPdf(buffer)

    // Reject blank / near-empty PDFs
    const wordCount = pdfText.trim().split(/\s+/).filter(Boolean).length
    if (wordCount < 30) {
      await serviceClient
        .from('discharge_documents')
        .update({ extraction_status: 'failed' })
        .eq('id', document_id)
      return NextResponse.json(
        apiError('The uploaded PDF appears to be blank or contains too little text. Please upload the actual discharge summary document.'),
        { status: 422 },
      )
    }

    // Run AI extraction
    const extracted = await extractDischargeData(pdfText)

    // Reject if AI found nothing meaningful
    const hasMeaningfulContent =
      extracted.medications.length > 0 ||
      extracted.emergency_symptoms.length > 0 ||
      extracted.lifestyle_instructions.length > 0 ||
      extracted.restrictions.length > 0

    if (!hasMeaningfulContent) {
      await serviceClient
        .from('discharge_documents')
        .update({ extraction_status: 'failed' })
        .eq('id', document_id)
      return NextResponse.json(
        apiError('No discharge information could be extracted. Please check you uploaded the correct discharge summary document.'),
        { status: 422 },
      )
    }

    // Store raw extraction on document
    await serviceClient
      .from('discharge_documents')
      .update({ extraction_status: 'completed', raw_extraction: extracted as never })
      .eq('id', document_id)

    // Get hospital_id for this episode
    const { data: episode } = await serviceClient
      .from('care_episodes')
      .select('hospital_id')
      .eq('id', episodeId)
      .single()

    const hospitalId = episode?.hospital_id

    // Upsert discharge summary (draft)
    const { data: existingSummary } = await serviceClient
      .from('discharge_summaries')
      .select('id, version')
      .eq('episode_id', episodeId)
      .single()

    const summaryPayload = {
      episode_id: episodeId,
      hospital_id: hospitalId,
      status: 'draft' as const,
      source_language: (extracted.source_language as 'en' | 'ar' | 'hi' | 'ta' | 'tl') ?? 'en',
      emergency_symptoms: extracted.emergency_symptoms,
      lifestyle_instructions: extracted.lifestyle_instructions,
      restrictions: extracted.restrictions,
      activities: extracted.activities,
      version: existingSummary ? existingSummary.version + 1 : 1,
    }

    let summaryId: string

    if (existingSummary) {
      await serviceClient
        .from('discharge_summaries')
        .update({ ...summaryPayload, approved_by: null, approved_at: null })
        .eq('id', existingSummary.id)
      summaryId = existingSummary.id
    } else {
      const { data: newSummary, error: summaryErr } = await serviceClient
        .from('discharge_summaries')
        .insert(summaryPayload)
        .select('id')
        .single()
      if (summaryErr || !newSummary) {
        return NextResponse.json(apiError('Failed to create discharge summary', summaryErr?.message), { status: 500 })
      }
      summaryId = newSummary.id
    }

    // Replace medications
    await serviceClient.from('medications').delete().eq('summary_id', summaryId)
    if (extracted.medications.length > 0) {
      await serviceClient.from('medications').insert(
        extracted.medications.map((med, i) => ({
          summary_id: summaryId,
          hospital_id: hospitalId,
          name: med.name,
          dosage: med.dosage,
          frequency: med.frequency,
          instructions: med.instructions,
          reminder_times: med.reminder_times,
          sort_order: i,
        })),
      )
    }

    // Replace follow-up requirements
    await serviceClient.from('follow_up_requirements').delete().eq('summary_id', summaryId)
    if (extracted.follow_up_requirements.length > 0) {
      await serviceClient.from('follow_up_requirements').insert(
        extracted.follow_up_requirements.map((fu) => ({
          summary_id: summaryId,
          hospital_id: hospitalId,
          specialty: fu.specialty,
          deadline: fu.deadline,
          instructions: fu.instructions,
        })),
      )
    }

    // Log timeline event
    await serviceClient.from('patient_timeline_events').insert({
      episode_id: episodeId,
      hospital_id: hospitalId,
      event_type: 'extraction_completed',
      payload: { document_id, summary_id: summaryId, medication_count: extracted.medications.length },
    })

    // Fire-and-forget translation (non-blocking, failure is acceptable)
    const { data: episodeWithPatient } = await supabase
      .from('care_episodes')
      .select('patients(preferred_language), hospitals(settings)')
      .eq('id', episodeId)
      .single()

    const patientLang = (episodeWithPatient?.patients as unknown as { preferred_language: string } | null)?.preferred_language
    const hospitalSettings = (episodeWithPatient?.hospitals as unknown as { settings: { languages?: string[] } } | null)?.settings
    const hospitalLangs: string[] = hospitalSettings?.languages ?? ['en']
    const targetLanguages = [
      ...new Set([patientLang, ...hospitalLangs].filter(Boolean)),
    ] as LanguageCode[]

    // Translate after the response is sent so the nurse isn't blocked on it.
    // Previously this was a fire-and-forget self-HTTP call to /api/internal/ai/translate,
    // which the auth proxy redirected to /login — translations were never produced.
    if (targetLanguages.length > 0) {
      after(() => translateAndStoreSummary(serviceClient, summaryId, extracted, targetLanguages))
    }

    return NextResponse.json(apiSuccess({ summary_id: summaryId, extraction: extracted }))

  } catch (err) {
    console.error('[Extract]', err)
    await serviceClient
      .from('discharge_documents')
      .update({ extraction_status: 'failed' })
      .eq('id', document_id)
    return NextResponse.json(
      apiError('Extraction failed', err instanceof Error ? err.message : 'Unknown error'),
      { status: 500 },
    )
  }
}
