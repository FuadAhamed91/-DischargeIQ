import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { resolveAuthContext, apiSuccess, apiError } from '@/lib/utils/api'
import { sendAndLog } from '@/lib/whatsapp/outbound'
import { buildDischargeSummaryMessage } from '@/lib/whatsapp/templates'
import type { CarePlanAppointment, CarePlanTranslation } from '@/lib/whatsapp/templates'
import { nightlyCheckinSchedule } from '@/lib/reminders/checkin'
import type { LanguageCode } from '@/types/enums'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { profile } = auth
  if (!['super_admin', 'hospital_admin', 'discharge_coordinator', 'nurse'].includes(profile.role)) {
    return NextResponse.json(apiError('Forbidden'), { status: 403 })
  }

  const { id: episodeId } = await params
  const supabase = await createClient()
  const serviceClient = await createServiceClient()

  // Load episode + patient + hospital
  const { data: episode } = await supabase
    .from('care_episodes')
    .select('id, hospital_id, patient_id, status')
    .eq('id', episodeId)
    .single()

  if (!episode) return NextResponse.json(apiError('Episode not found'), { status: 404 })

  if (!['pending_review', 'active'].includes(episode.status)) {
    return NextResponse.json(
      apiError('Episode must be pending_review or active to send discharge summary'),
      { status: 409 },
    )
  }

  const { data: summary } = await supabase
    .from('discharge_summaries')
    .select('*')
    .eq('episode_id', episodeId)
    .single()

  if (!summary) return NextResponse.json(apiError('Discharge summary not found'), { status: 404 })
  if (summary.status === 'sent') {
    return NextResponse.json(apiError('Summary has already been sent to the patient'), { status: 409 })
  }
  if (summary.status !== 'approved') {
    return NextResponse.json(
      apiError('Summary must be approved before sending'),
      { status: 409 },
    )
  }

  // Load patient
  const { data: patient } = await serviceClient
    .from('patients')
    .select('id, full_name, phone_e164, preferred_language')
    .eq('id', episode.patient_id)
    .single()

  if (!patient) return NextResponse.json(apiError('Patient not found'), { status: 404 })
  if (!patient.phone_e164) {
    return NextResponse.json(apiError('Patient has no WhatsApp phone number'), { status: 422 })
  }

  // Load hospital for WhatsApp phone_number_id
  const { data: hospital } = await serviceClient
    .from('hospitals')
    .select('id, name, whatsapp_phone_number_id, settings, timezone')
    .eq('id', episode.hospital_id)
    .single()

  if (!hospital?.whatsapp_phone_number_id) {
    return NextResponse.json(
      apiError('Hospital WhatsApp phone number is not configured'),
      { status: 422 },
    )
  }

  const patientLanguage = (patient.preferred_language as LanguageCode) ?? 'en'

  // Medications, the follow-up appointments (booked or provisional from the
  // letter) and, when the patient reads another language, the stored translation.
  const [{ data: medications }, { data: appointments }, { data: translation }] = await Promise.all([
    supabase.from('medications').select('*').eq('summary_id', summary.id).order('sort_order'),
    serviceClient
      .from('appointments')
      .select('specialty, scheduled_at, location, time_tbc, status')
      .eq('episode_id', episodeId)
      .in('status', ['scheduled', 'confirmation_pending', 'confirmed'])
      .order('scheduled_at', { ascending: true }),
    patientLanguage !== summary.source_language
      ? serviceClient.from('discharge_summary_translations').select('content').eq('summary_id', summary.id).eq('language', patientLanguage).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  // Build and send the WhatsApp message
  const msgPayload = buildDischargeSummaryMessage({
    to: patient.phone_e164,
    patientName: patient.full_name,
    hospitalName: hospital.name,
    language: patientLanguage,
    summary: summary as Parameters<typeof buildDischargeSummaryMessage>[0]['summary'],
    medications: (medications ?? []) as Parameters<typeof buildDischargeSummaryMessage>[0]['medications'],
    appointments: (appointments ?? []) as CarePlanAppointment[],
    timezone: (hospital.timezone as string | null) ?? 'Asia/Dubai',
    translation: (translation?.content as CarePlanTranslation | null) ?? null,
  })

  // Send and record on the patient's conversation (transcript on the dashboard).
  // The summary asks nothing of the patient, so the conversation stays idle.
  const result = await sendAndLog({
    supabase: serviceClient,
    phoneNumberId: hospital.whatsapp_phone_number_id,
    message: msgPayload,
    episodeId,
    hospitalId: episode.hospital_id,
    patientId: patient.id,
  })

  if (result.status === 'failed') {
    return NextResponse.json(
      apiError('WhatsApp send failed', result.error),
      { status: 502 },
    )
  }

  // Update summary status + episode
  await supabase
    .from('discharge_summaries')
    .update({ status: 'sent' })
    .eq('id', summary.id)

  await supabase
    .from('care_episodes')
    .update({ status: 'active', started_at: new Date().toISOString() })
    .eq('id', episodeId)

  // Timeline event
  await (await createServiceClient()).from('patient_timeline_events').insert({
    episode_id: episodeId,
    hospital_id: episode.hospital_id,
    event_type: 'summary_sent',
    payload: {
      summary_id: summary.id,
      wa_message_id: result.messageId,
      sent_by: profile.id,
    },
    created_by: profile.id,
  })

  // Schedule the nightly check-in (one per episode). Dose times stay on the
  // medications as instructions in the summary; they are not messaged.
  const { count } = await supabase
    .from('reminder_schedules')
    .select('id', { count: 'exact', head: true })
    .eq('episode_id', episodeId)
    .eq('is_active', true)

  if (!count || count === 0) {
    await supabase.from('reminder_schedules').insert(
      nightlyCheckinSchedule({ episodeId, hospitalId: episode.hospital_id, settings: hospital.settings }),
    )
  }

  return NextResponse.json(apiSuccess({ waMessageId: result.messageId }))
}
