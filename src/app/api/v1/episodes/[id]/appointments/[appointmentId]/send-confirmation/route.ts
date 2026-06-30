import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { resolveAuthContext, apiSuccess, apiError, requireRole } from '@/lib/utils/api'
import { sendMessage } from '@/lib/whatsapp/client'
import { buildAppointmentConfirmationRequest } from '@/lib/whatsapp/templates'
import type { LanguageCode } from '@/types/enums'
import type { Appointment } from '@/types/database'

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
    .select('whatsapp_phone_number_id')
    .eq('id', episode.hospital_id)
    .single()

  if (!hospital?.whatsapp_phone_number_id) {
    return NextResponse.json(apiError('Hospital WhatsApp not configured'), { status: 422 })
  }

  const message = buildAppointmentConfirmationRequest({
    to: patient.phone_e164,
    patientName: patient.full_name,
    language: (patient.preferred_language as LanguageCode) ?? 'en',
    appointment: appointment as unknown as Appointment,
  })

  const result = await sendMessage(hospital.whatsapp_phone_number_id, message)

  if (result.status === 'failed') {
    return NextResponse.json(apiError('WhatsApp send failed', result.error), { status: 502 })
  }

  // Update appointment status
  await supabase
    .from('appointments')
    .update({
      status: 'confirmation_pending',
      confirmation_requested_at: new Date().toISOString(),
    })
    .eq('id', appointmentId)

  // Update conversation state
  await serviceClient
    .from('whatsapp_conversations')
    .upsert({
      episode_id: episodeId,
      hospital_id: episode.hospital_id,
      patient_phone: patient.phone_e164,
      conversation_state: 'awaiting_appointment_confirm',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'episode_id' })

  // Log outbound message
  await serviceClient.from('whatsapp_messages').insert({
    episode_id: episodeId,
    hospital_id: episode.hospital_id,
    wa_message_id: result.messageId,
    direction: 'outbound',
    message_type: 'interactive',
    content: `Appointment confirmation request: ${appointment.specialty}`,
    status: 'sent',
  })

  // Timeline
  await supabase.from('patient_timeline_events').insert({
    episode_id: episodeId,
    hospital_id: episode.hospital_id,
    event_type: 'whatsapp_outbound',
    payload: { appointment_id: appointmentId, wa_message_id: result.messageId, type: 'confirmation_request' },
    created_by: profile.id,
  })

  return NextResponse.json(apiSuccess({ waMessageId: result.messageId }))
}
