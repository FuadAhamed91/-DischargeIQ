export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { ArrowLeft, Calendar, MapPin, Clock, User } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AppointmentActions } from '@/components/appointments/appointment-actions'
import type { Appointment } from '@/types/database'

export async function generateMetadata() {
  return { title: 'Appointment Details' }
}

const STATUS_STYLES: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-800',
  confirmation_pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  reschedule_pending: 'bg-orange-100 text-orange-800',
  rescheduled: 'bg-purple-100 text-purple-800',
  cancelled: 'bg-red-100 text-red-800',
  missed: 'bg-gray-100 text-gray-800',
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
  await requireSession()
  const { id: episodeId, appointmentId } = await params
  const supabase = await createClient()

  const { data: appointment } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', appointmentId)
    .single()

  if (!appointment) notFound()

  const { data: episode } = await supabase
    .from('care_episodes')
    .select('patients(full_name, mrn)')
    .eq('id', episodeId)
    .single()

  const patient = (episode?.patients as unknown as { full_name: string; mrn: string } | null)
  const appt = appointment as unknown as Appointment
  const date = new Date(appt.scheduled_at)

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
            <span>{date.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
            <span>{date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          {appt.location && (
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
              <span>{appt.location}</span>
            </div>
          )}
          {appt.confirmed_at && (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <User className="w-4 h-4 shrink-0" />
              <span>Confirmed by patient on {new Date(appt.confirmed_at).toLocaleDateString('en-GB')}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <AppointmentActions
        episodeId={episodeId}
        appointment={appt}
      />
    </div>
  )
}
