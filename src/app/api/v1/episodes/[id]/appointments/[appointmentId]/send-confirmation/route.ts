import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { resolveAuthContext, apiSuccess, apiError, requireRole } from '@/lib/utils/api'
import { sendAndLog } from '@/lib/whatsapp/outbound'
import { buildAppointmentConfirmationRequest } from '@/lib/whatsapp/appointment-templates'
import { rememberPatientIfShared } from '@/lib/whatsapp/number-session'
import type { LanguageCode } from '@/types/enums'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; appointmentId: string }> },
) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { profile } = auth
  const roleError = requireRole(profile.role, 'nurse')
  if (roleError) return roleError

  const { id: episodeId, appointmentId } = await params
  const supabase = await createClient()
  const serviceClient = await createServiceClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', appointmentId)
    .single()

  if (!appointment) return NextResponse.json(apiError('Appointment not found'), { status: 404 })

  if (appointment.status === 'confirmed') {
    return NextResponse.json(apiError('Appointment already confirmed'), { status: 409 })
  }
  if (appointment.time_tbc) {
    // The date on a provisional row is the letter's "by" date with a placeholder
    // time — never ask a patient to confirm that. Book the slot first.
    return NextResponse.json(apiError('Set the appointment date and time before asking the patient to confirm'), { status: 409 })
  }

  // Load patient via episode
  const { data: episode } = await supabase
    .from('care_episodes')
    .select('patient_id, hospital_id')
    .eq('id', episodeId)
    .single()

  if (!episode) return NextResponse.json(apiError('Episode not found'), { status: 404 })

  const { data: patient } = await serviceClient
    .from('patients')
    .select('full_name, phone_e164, preferred_language')
    .eq('id', episode.patient_id)
    .single()

  if (!patient?.phone_e164) {
    return NextResponse.json(apiError('Patient has no WhatsApp number'), { status: 422 })
  }

  const { data: hospital } = await serviceClient
    .from('hospitals')
    .select('whatsapp_phone_number_id, timezone')
    .eq('id', episode.hospital_id)
    .single()

  if (!hospital?.whatsapp_phone_number_id) {
    return NextResponse.json(apiError('Hospital WhatsApp not configured'), { status: 422 })
  }

  const message = buildAppointmentConfirmationRequest({
    to: patient.phone_e164,
    patientName: patient.full_name,
    language: (patient.preferred_language as LanguageCode) ?? 'en',
    appointment: { specialty: appointment.specialty, scheduled_at: appointment.scheduled_at, location: appointment.location ?? null },
    timezone: (hospital.timezone as string | null) ?? 'Asia/Dubai',
  })

  // Send, log on the conversation, and move it to awaiting_appointment_confirm
  // so the patient's YES/NO reply is handled by the appointment flow.
  const result = await sendAndLog({
    supabase: serviceClient,
    phoneNumberId: hospital.whatsapp_phone_number_id,
    message,
    episodeId,
    hospitalId: episode.hospital_id,
    patientId: episode.patient_id,
    nextState: 'awaiting_appointment_confirm',
  })

  if (result.status === 'failed') {
    return NextResponse.json(apiError('WhatsApp send failed', result.error), { status: 502 })
  }

  // Shared number: "Can you attend?" makes this patient the topic, so a "1"
  // is read as their answer even if a relative wrote about someone else earlier.
  await rememberPatientIfShared(serviceClient, {
    hospitalId: episode.hospital_id,
    phone: patient.phone_e164,
    patientId: episode.patient_id,
    patientName: patient.full_name,
    episodeId,
  })

  // Update appointment status
  await supabase
    .from('appointments')
    .update({
      status: 'confirmation_pending',
      confirmation_requested_at: new Date().toISOString(),
    })
    .eq('id', appointmentId)

  // Timeline
  await (await createServiceClient()).from('patient_timeline_events').insert({
    episode_id: episodeId,
    hospital_id: episode.hospital_id,
    event_type: 'whatsapp_outbound',
    payload: { appointment_id: appointmentId, wa_message_id: result.messageId, type: 'confirmation_request' },
    created_by: profile.id,
  })

  return NextResponse.json(apiSuccess({ waMessageId: result.messageId }))
}
