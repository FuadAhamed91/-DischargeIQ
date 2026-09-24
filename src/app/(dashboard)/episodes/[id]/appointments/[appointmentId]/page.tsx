export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { fmt } from '@/lib/format'
import { ArrowLeft, Calendar, MapPin, Clock, User, CalendarClock, CalendarSync } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { StatusBadge } from '@/components/shared/status-badge'
import { AppointmentActions } from '@/components/appointments/appointment-actions'
import { LiveRefresh } from '@/components/shared/live-refresh'
import type { Appointment } from '@/types/database'
import type { AppointmentStatus } from '@/types/enums'

export async function generateMetadata() {
  return { title: 'Appointment' }
}

export default async function AppointmentDetailPage({
  params,
}: {
  params: Promise<{ id: string; appointmentId: string }>
}) {
  const { hospital } = await requireSession()
  const tz = hospital.timezone
  const { id: episodeId, appointmentId } = await params
  const supabase = await createClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', appointmentId)
    .single()

  if (!appointment) notFound()

  const [{ data: episode }, { data: lastChange }] = await Promise.all([
    supabase
      .from('care_episodes')
      .select('patients(full_name, mrn)')
      .eq('id', episodeId)
      .single(),
    // The latest change to this appointment: when it is the patient's, from
    // the WhatsApp reschedule (lib/whatsapp/reschedule.ts), say what they did.
    supabase
      .from('patient_timeline_events')
      .select('payload')
      .eq('episode_id', episodeId)
      .eq('event_type', 'appointment_rescheduled')
      .eq('payload->>appointment_id', appointmentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const patient = (episode?.patients as unknown as { full_name: string; mrn: string } | null)
  const appt = appointment as unknown as Appointment
  const change = (lastChange?.payload ?? null) as {
    chosen_by?: string
    from?: string
    requested_by?: string
    none_suit?: boolean
    preference?: string | null
    offered?: string[]
  } | null
  const movedFrom = change?.chosen_by === 'patient' && change.from ? change.from : null
  let waitingNote: string | null = null
  if (appt.status === 'reschedule_pending' && change?.requested_by === 'patient') {
    if (change.none_suit) {
      waitingNote = `None of the times offered suit the patient${change.preference ? `, who wrote: “${change.preference}”` : ''}. Agree a time with them, save it with Change, then ask them to confirm again.`
    } else if (change.offered?.length) {
      waitingNote = `The patient asked to change this appointment and was offered ${change.offered.map((at) => fmt(at, 'EEE d MMM, HH:mm', tz)).join(', ')}. The time they choose on WhatsApp will show here.`
    } else {
      waitingNote = 'The patient asked to change this appointment on WhatsApp.'
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <Link href={`/episodes/${episodeId}?tab=care-plan`} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {patient?.full_name ?? 'Patient'}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{appt.specialty}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {patient?.full_name ?? 'Patient'} · MRN <span className="font-mono">{patient?.mrn ?? '—'}</span>
          </p>
        </div>
        <StatusBadge status={appt.status as AppointmentStatus} />
      </div>

      <Card>
        <CardContent>
          <ul className="space-y-3 text-sm">
            <li className="flex items-center gap-2">
              <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>{appt.time_tbc ? <>Due by {fmt(appt.scheduled_at, 'EEEE d MMMM yyyy', tz)}</> : fmt(appt.scheduled_at, 'EEEE d MMMM yyyy', tz)}</span>
            </li>
            <li className="flex items-center gap-2">
              <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>{appt.time_tbc ? <span className="text-muted-foreground">Time not booked yet (from the discharge letter)</span> : fmt(appt.scheduled_at, 'HH:mm', tz)}</span>
            </li>
            {appt.location && (
              <li className="flex items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>{appt.location}</span>
              </li>
            )}
            {appt.confirmed_at && (
              <li className="flex items-center gap-2 text-success">
                <User className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Confirmed by the patient on {fmt(appt.confirmed_at, 'd MMM yyyy, HH:mm', tz)}</span>
              </li>
            )}
            {movedFrom && (
              <li className="flex items-center gap-2 text-muted-foreground">
                <CalendarSync className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Moved by the patient on WhatsApp. It was {fmt(movedFrom, 'EEEE d MMMM yyyy, HH:mm', tz)}.</span>
              </li>
            )}
          </ul>
        </CardContent>
      </Card>

      {waitingNote && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <p>{waitingNote}</p>
        </div>
      )}

      <AppointmentActions
        episodeId={episodeId}
        appointment={appt}
        timezone={tz}
      />

      {/* Patient confirms / reschedules on WhatsApp: reflect it here without a reload */}
      <LiveRefresh episodeId={episodeId} events={['appointment_confirmed', 'appointment_rescheduled']} />
    </div>
  )
}
