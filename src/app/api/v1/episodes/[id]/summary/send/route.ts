import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { resolveAuthContext, apiSuccess, apiError } from '@/lib/utils/api'
import { sendCarePlan, latestCarePlanMessage } from '@/lib/whatsapp/care-plan'
import { explainDeliveryError } from '@/lib/whatsapp/delivery'
import { nightlyCheckinSchedule } from '@/lib/reminders/checkin'
import { rememberPatientIfShared } from '@/lib/whatsapp/number-session'

export const dynamic = 'force-dynamic'
// The plan may first need translating into the patient's language (see TRANSLATE_WITHIN_MS).
export const maxDuration = 60

/**
 * How long a send waits for a translation of the plan as approved, when the
 * stored one was made from other text (the nurse edited it). After that it
 * goes out as written, under the patient's own headings. Well inside
 * maxDuration: loading, the Twilio call and the bookkeeping follow.
 */
const TRANSLATE_WITHIN_MS = 25_000

/**
 * Sends the care plan to the patient on WhatsApp.
 *
 * First send: the summary must be approved; it becomes "sent", the episode
 * becomes active and the nightly check-in is scheduled.
 * Resend (body {"resend": true}): allowed once the summary is "sent" only
 * when the last care-plan message did not reach the patient — the dashboard
 * offers it next to the delivery failure. Nothing else changes.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { profile } = auth
  if (!['super_admin', 'hospital_admin', 'discharge_coordinator', 'nurse'].includes(profile.role)) {
    return NextResponse.json(apiError('Forbidden'), { status: 403 })
  }

  const { id: episodeId } = await params
  const body = await request.json().catch(() => ({})) as { resend?: boolean }
  const wantsResend = body?.resend === true

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

  const { data: conversation } = await serviceClient
    .from('whatsapp_conversations')
    .select('id')
    .eq('episode_id', episodeId)
    .maybeSingle()
  const lastCarePlan = conversation ? await latestCarePlanMessage(serviceClient, conversation.id) : null

  if (summary.status === 'sent') {
    if (!wantsResend) {
      return NextResponse.json(apiError('Summary has already been sent to the patient'), { status: 409 })
    }
    if (lastCarePlan && lastCarePlan.status !== 'failed') {
      return NextResponse.json(apiError('The care plan reached the patient — there is nothing to resend'), { status: 409 })
    }
  } else if (summary.status !== 'approved') {
    return NextResponse.json(
      apiError('Summary must be approved before sending'),
      { status: 409 },
    )
  }
  const isResend = summary.status === 'sent'

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

  // Build, send and record on the patient's conversation (transcript on the dashboard).
  const result = await sendCarePlan({
    serviceClient,
    episodeId,
    summary,
    patient: { id: patient.id, full_name: patient.full_name, phone: patient.phone_e164, preferred_language: patient.preferred_language },
    hospital: {
      id: hospital.id,
      name: hospital.name,
      whatsapp_phone_number_id: hospital.whatsapp_phone_number_id,
      timezone: (hospital.timezone as string | null) ?? 'Asia/Dubai',
    },
    resend: isResend,
    trigger: 'nurse',
    translateWithinMs: TRANSLATE_WITHIN_MS,
  })

  if (result.status === 'failed') {
    return NextResponse.json(
      apiError('WhatsApp did not accept the message', explainDeliveryError(result.errorCode, result.error)),
      { status: 502 },
    )
  }

  // Shared number: the care plan just went to this patient, so a relative's
  // "thanks" or first question is about them.
  await rememberPatientIfShared(serviceClient, {
    hospitalId: episode.hospital_id,
    phone: patient.phone_e164,
    patientId: patient.id,
    patientName: patient.full_name,
    episodeId,
  })

  // Timeline event (service client: the user role can only read this table)
  await serviceClient.from('patient_timeline_events').insert({
    episode_id: episodeId,
    hospital_id: episode.hospital_id,
    event_type: 'summary_sent',
    payload: {
      summary_id: summary.id,
      wa_message_id: result.messageId,
      sent_by: profile.id,
      ...(isResend ? { resend: true, trigger: 'nurse', previous_message_id: lastCarePlan?.messageId ?? null } : {}),
    },
    created_by: profile.id,
  })

  if (isResend) {
    // Delivery is only known once Twilio reports back; the nurse's own alert is cleared now.
    await serviceClient
      .from('alerts')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('episode_id', episodeId)
      .eq('status', 'open')
      .eq('type', 'delivery_failed')
    return NextResponse.json(apiSuccess({ waMessageId: result.messageId, resend: true }))
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
