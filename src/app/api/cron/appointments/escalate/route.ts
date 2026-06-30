import { NextResponse } from 'next/server'
import { validateCronSecret } from '@/lib/utils/api'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  const authError = validateCronSecret(request)
  if (authError) return authError

  const supabase = await createServiceClient()
  let escalated = 0
  let missed = 0

  // Escalate appointments with no confirmation after 48h
  const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const { data: unconfirmed } = await supabase
    .from('appointments')
    .select('id, episode_id, hospital_id, specialty, scheduled_at')
    .eq('status', 'confirmation_pending')
    .lt('confirmation_requested_at', cutoff48h)

  for (const appt of unconfirmed ?? []) {
    await supabase.from('alerts').insert({
      episode_id: appt.episode_id,
      hospital_id: appt.hospital_id,
      type: 'unconfirmed_appointment',
      message: `Patient has not confirmed their ${appt.specialty} appointment scheduled for ${new Date(appt.scheduled_at).toLocaleDateString('en-GB')}`,
      risk_level: 'yellow',
      status: 'open',
    })
    escalated++
  }

  // Mark appointments as missed if scheduled_at has passed and still unconfirmed/scheduled
  const now = new Date().toISOString()
  const { data: pastAppointments } = await supabase
    .from('appointments')
    .select('id, episode_id, hospital_id, specialty')
    .in('status', ['scheduled', 'confirmation_pending', 'reschedule_pending'])
    .lt('scheduled_at', now)

  for (const appt of pastAppointments ?? []) {
    await supabase
      .from('appointments')
      .update({ status: 'missed', updated_at: now })
      .eq('id', appt.id)

    await supabase.from('patient_timeline_events').insert({
      episode_id: appt.episode_id,
      hospital_id: appt.hospital_id,
      event_type: 'appointment_rescheduled',
      payload: { appointment_id: appt.id, action: 'marked_missed' },
    })
    missed++
  }

  console.log(`[cron/appointments/escalate] escalated=${escalated} missed=${missed}`)

  return NextResponse.json({ ok: true, escalated, missed })
}
