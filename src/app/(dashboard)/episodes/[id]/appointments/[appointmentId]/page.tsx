export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { fmt } from '@/lib/format'
import { ArrowLeft, Calendar, MapPin, Clock, User, CalendarClock, CalendarSync } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AppointmentActions } from '@/components/appointments/appointment-actions'
import { LiveRefresh } from '@/components/shared/live-refresh'
import type { Appointment } from '@/types/database'

export async function generateMetadata() {
  return { title: 'Appointment Details' }
}

const STATUS_STYLES: Record<string, string> = {
  scheduled: 'bg-info-soft text-info',
  confirmation_pending: 'bg-warning-soft text-warning',
  confirmed: 'bg-success-soft text-success',
  reschedule_pending: 'bg-warning-soft text-warning',
  rescheduled: 'bg-brand-soft text-brand',
  cancelled: 'bg-danger-soft text-danger',
  missed: 'bg-muted text-foreground',
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  confirmation_pending: 'Awaiting Confirmation',
  confirmed: 'Confirmed',
  reschedule_pending: 'Reschedule Pending',
  rescheduled: 'Rescheduled',
  cancelled: 'Cancelled',
  missed: 'Missed',
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
      waitingNote = `None of the times offered suit the patient${change.preference ? `, who wrote: “${change.preference}”` : ''}. Agree a time with them, save it with Edit appointment, then send the WhatsApp confirmation again.`
    } else if (change.offered?.length) {
      waitingNote = `The patient asked to change this appointment and was offered ${change.offered.map((at) => fmt(at, 'EEE d MMM, HH:mm', tz)).join(', ')}. The time they choose on WhatsApp will show here.`
    } else {
      waitingNote = 'The patient asked to change this appointment on WhatsApp.'
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <Link href={`/episodes/${episodeId}`} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Back to episode
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{appt.specialty}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {patient?.full_name ?? 'Patient'} · MRN {patient?.mrn ?? '—'}
          </p>
        </div>
        <Badge className={`text-xs ${STATUS_STYLES[appt.status] ?? ''}`}>
          {STATUS_LABELS[appt.status] ?? appt.status}
        </Badge>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Appointment Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
            <span>{appt.time_tbc ? <>Due by {fmt(appt.scheduled_at, 'EEEE, d MMMM yyyy', tz)}</> : fmt(appt.scheduled_at, 'EEEE, d MMMM yyyy', tz)}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
            <span>{appt.time_tbc ? <span className="text-muted-foreground">Time to confirm — from the discharge summary</span> : fmt(appt.scheduled_at, 'HH:mm', tz)}</span>
          </div>
          {appt.location && (
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
              <span>{appt.location}</span>
            </div>
          )}
          {appt.confirmed_at && (
            <div className="flex items-center gap-2 text-sm text-success">
              <User className="w-4 h-4 shrink-0" />
              <span>Confirmed by patient on {fmt(appt.confirmed_at, 'd MMM yyyy, HH:mm', tz)}</span>
            </div>
          )}
          {movedFrom && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarSync className="w-4 h-4 shrink-0" />
              <span>Moved by the patient on WhatsApp — was {fmt(movedFrom, 'EEEE, d MMMM yyyy, HH:mm', tz)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {waitingNote && (
        <div className="flex items-start gap-2 p-3 bg-warning-soft border border-warning/30 rounded-lg text-sm">
          <CalendarClock className="w-4 h-4 mt-0.5 shrink-0 text-warning" aria-hidden="true" />
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
