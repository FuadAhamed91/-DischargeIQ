/**
 * POST /api/v1/episodes/[id]/checkin — send the nightly check-in now.
 *
 * For a demo, or a nurse who wants tonight's answers early. The episode's
 * next pending check-in job is claimed and sent at once, so the patient is
 * not asked again at the usual time and adherence still counts one job; if
 * there is none (already sent today, or not generated yet) one is created.
 * Unlike the dispatcher it does not wait for another patient on a shared
 * number: the nurse asked for it, and this patient becomes the number's topic.
 */
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveAuthContext, apiSuccess, apiError, requireRole } from '@/lib/utils/api'
import { sendAndLog } from '@/lib/whatsapp/outbound'
import { explainDeliveryError } from '@/lib/whatsapp/delivery'
import { buildNightlyCheckinMessage } from '@/lib/whatsapp/checkin-templates'
import { rememberPatientIfShared } from '@/lib/whatsapp/number-session'
import { NIGHTLY_CHECKIN_KEY } from '@/lib/reminders/checkin'
import type { LanguageCode } from '@/types/enums'

export const dynamic = 'force-dynamic'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { profile } = auth
  const roleError = requireRole(profile.role, 'nurse')
  if (roleError) return roleError

  const { id: episodeId } = await params
  const supabase = await createClient()
  const service = await createServiceClient()

  const { data: episode } = await supabase
    .from('care_episodes')
    .select('id, hospital_id, patient_id, status')
    .eq('id', episodeId)
    .eq('hospital_id', profile.hospital_id)
    .single()
  if (!episode) return NextResponse.json(apiError('Episode not found'), { status: 404 })
  if (episode.status !== 'active') {
    return NextResponse.json(apiError('The check-in starts once the care plan has been sent'), { status: 409 })
  }

  const [{ data: patient }, { data: hospital }, { data: schedule }] = await Promise.all([
    service.from('patients').select('full_name, phone_e164, preferred_language').eq('id', episode.patient_id).single(),
    service.from('hospitals').select('name, whatsapp_phone_number_id').eq('id', episode.hospital_id).single(),
    service
      .from('reminder_schedules')
      .select('id')
      .eq('episode_id', episodeId)
      .eq('message_template_key', NIGHTLY_CHECKIN_KEY)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
  ])
  if (!patient?.phone_e164) return NextResponse.json(apiError('Patient has no WhatsApp number'), { status: 422 })
  if (!hospital?.whatsapp_phone_number_id) return NextResponse.json(apiError('Hospital WhatsApp not configured'), { status: 422 })
  if (!schedule) return NextResponse.json(apiError('No nightly check-in is scheduled for this patient'), { status: 409 })

  // Claim tonight's job before sending, so the 5-minute dispatcher cannot send it too.
  const now = new Date().toISOString()
  const { data: pending } = await service
    .from('reminder_jobs')
    .select('id')
    .eq('schedule_id', schedule.id)
    .eq('status', 'pending')
    .order('fire_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  let jobId: string | null = null
  if (pending) {
    const { data: claimed } = await service
      .from('reminder_jobs')
      .update({ status: 'sent', fire_at: now })
      .eq('id', pending.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    jobId = (claimed?.id as string | undefined) ?? null
  }
  const broughtForward = jobId !== null
  if (!jobId) {
    const { data: created, error } = await service
      .from('reminder_jobs')
      .insert({ schedule_id: schedule.id, episode_id: episodeId, hospital_id: episode.hospital_id, fire_at: now, status: 'sent' })
      .select('id')
      .single()
    if (error || !created) return NextResponse.json(apiError('Could not record the check-in', error?.message), { status: 500 })
    jobId = created.id as string
  }

  const result = await sendAndLog({
    supabase: service,
    phoneNumberId: hospital.whatsapp_phone_number_id,
    message: buildNightlyCheckinMessage({
      to: patient.phone_e164,
      patientName: patient.full_name,
      hospitalName: hospital.name,
      language: (patient.preferred_language as LanguageCode) ?? 'en',
    }),
    episodeId,
    hospitalId: episode.hospital_id,
    patientId: episode.patient_id,
    nextState: 'awaiting_checkin_meds',
  }).catch((err: unknown) => ({ status: 'failed' as const, messageId: '', error: String(err), errorCode: undefined }))

  if (result.status === 'failed') {
    await service.from('reminder_jobs').update({ status: 'failed' }).eq('id', jobId)
    return NextResponse.json(apiError('WhatsApp send failed', explainDeliveryError(result.errorCode, result.error)), { status: 502 })
  }

  await service.from('reminder_jobs').update({ whatsapp_message_id: result.messageId }).eq('id', jobId)
  // Shared number: this patient's question is the one waiting, so an unaddressed reply goes to them.
  await rememberPatientIfShared(service, {
    hospitalId: episode.hospital_id,
    phone: patient.phone_e164,
    patientId: episode.patient_id,
    patientName: patient.full_name,
    episodeId,
  })
  await service.from('patient_timeline_events').insert({
    episode_id: episodeId,
    hospital_id: episode.hospital_id,
    event_type: 'reminder_sent',
    payload: { job_id: jobId, reminder_type: 'symptom_check', wa_message_id: result.messageId, sent_early: true },
    created_by: profile.id,
  })

  return NextResponse.json(apiSuccess({ waMessageId: result.messageId, broughtForward }))
}
