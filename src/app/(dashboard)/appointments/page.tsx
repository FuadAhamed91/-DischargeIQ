export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { Calendar, Plus, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/shared/empty-state'

export async function generateMetadata() {
  return { title: 'Appointments' }
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

export default async function AppointmentsPage() {
  const { profile } = await requireSession()
  const supabase = await createClient()

  const { data: appointments } = await supabase
    .from('appointments')
    .select(`
      id, specialty, scheduled_at, location, status,
      confirmation_requested_at, confirmed_at,
      care_episodes(
        id,
        patients(full_name, mrn)
      )
    `)
    .eq('hospital_id', profile.hospital_id)
    .order('scheduled_at', { ascending: true })

  const upcoming = (appointments ?? []).filter((a) =>
    ['scheduled', 'confirmation_pending', 'confirmed', 'reschedule_pending'].includes(a.status),
  )
  const past = (appointments ?? []).filter((a) =>
    ['rescheduled', 'cancelled', 'missed'].includes(a.status),
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Appointments</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage follow-up appointments and track patient confirmations
          </p>
        </div>
      </div>

      {appointments?.length === 0 && (
        <EmptyState
          icon={Calendar}
          title="No appointments yet"
          description="Appointments are created from episode follow-up requirements on the episode review page."
        />
      )}

      {upcoming.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Upcoming ({upcoming.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {upcoming.map((appt) => {
                const episode = appt.care_episodes as unknown as { id: string; patients: { full_name: string; mrn: string } | null }
                const patient = episode?.patients
                const date = new Date(appt.scheduled_at)

                return (
                  <div key={appt.id} className="flex items-center justify-between p-4 hover:bg-muted/30">
                    <div className="flex items-start gap-4">
                      <div className="text-center min-w-[48px]">
                        <p className="text-xs text-muted-foreground uppercase">
                          {date.toLocaleDateString('en-GB', { month: 'short' })}
                        </p>
                        <p className="text-xl font-bold leading-none">{date.getDate()}</p>
                      </div>
                      <div>
                        <p className="font-medium text-sm">{appt.specialty}</p>
                        <p className="text-xs text-muted-foreground">
                          {patient?.full_name ?? 'Unknown'} · MRN {patient?.mrn ?? '—'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                          {appt.location ? ` · ${appt.location}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {appt.status === 'confirmation_pending' && (
                        <AlertCircle className="w-4 h-4 text-yellow-500" />
                      )}
                      <Badge className={`text-xs ${STATUS_STYLES[appt.status] ?? ''}`}>
                        {STATUS_LABELS[appt.status] ?? appt.status}
                      </Badge>
                      {episode?.id && (
                        <Link href={`/episodes/${episode.id}/appointments/${appt.id}`}>
                          <Button size="sm" variant="ghost" className="h-7 text-xs">View</Button>
                        </Link>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {past.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-muted-foreground">Past / Cancelled ({past.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {past.map((appt) => {
                const episode = appt.care_episodes as unknown as { id: string; patients: { full_name: string; mrn: string } | null }
                const patient = episode?.patients
                const date = new Date(appt.scheduled_at)

                return (
                  <div key={appt.id} className="flex items-center justify-between p-4 opacity-60">
                    <div>
                      <p className="font-medium text-sm">{appt.specialty}</p>
                      <p className="text-xs text-muted-foreground">
                        {patient?.full_name} · {date.toLocaleDateString('en-GB')}
                      </p>
                    </div>
                    <Badge className={`text-xs ${STATUS_STYLES[appt.status] ?? ''}`}>
                      {STATUS_LABELS[appt.status] ?? appt.status}
                    </Badge>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
