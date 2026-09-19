export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { Calendar, AlertCircle, ChevronRight } from 'lucide-react'
import { fmt } from '@/lib/format'
import { StatusBadge } from '@/components/shared/status-badge'
import type { AppointmentStatus } from '@/types/enums'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/empty-state'

export async function generateMetadata() {
  return { title: 'Appointments' }
}

export default async function AppointmentsPage() {
  const { profile, hospital } = await requireSession()
  const tz = hospital.timezone
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
          <h1 className="text-2xl font-semibold tracking-tight">Appointments</h1>
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
                const href = episode?.id ? `/episodes/${episode.id}/appointments/${appt.id}` : undefined
                const inner = (
                  <>
                    <div className="w-12 shrink-0 text-center">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{fmt(appt.scheduled_at, 'MMM', tz)}</p>
                      <p className="text-xl font-semibold leading-none tnum">{fmt(appt.scheduled_at, 'd', tz)}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-sm font-medium">{appt.specialty}</p>
                        <StatusBadge status={appt.status as AppointmentStatus} className="sm:hidden" />
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {patient?.full_name ?? 'Unknown'} <span className="font-mono">{patient?.mrn ?? ''}</span>
                      </p>
                      <p className="text-xs text-muted-foreground tnum">
                        {fmt(appt.scheduled_at, 'HH:mm', tz)}{appt.location ? ` · ${appt.location}` : ''}
                      </p>
                    </div>
                    <div className="hidden sm:flex items-center gap-2 shrink-0">
                      {appt.status === 'confirmation_pending' && <AlertCircle className="w-4 h-4 text-warning" aria-hidden="true" />}
                      <StatusBadge status={appt.status as AppointmentStatus} />
                      {href && <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />}
                    </div>
                  </>
                )
                const rowClass = 'group flex items-start gap-3 sm:items-center p-4 transition-colors duration-200 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none'
                return href ? (
                  <Link key={appt.id} href={href} className={rowClass} aria-label={`${appt.specialty} appointment for ${patient?.full_name ?? 'patient'}`}>{inner}</Link>
                ) : (
                  <div key={appt.id} className={rowClass}>{inner}</div>
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
                return (
                  <div key={appt.id} className="flex flex-wrap items-center justify-between gap-2 p-4 opacity-70">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{appt.specialty}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {patient?.full_name} · {fmt(appt.scheduled_at, 'd MMM yyyy, HH:mm', tz)}
                      </p>
                    </div>
                    <StatusBadge status={appt.status as AppointmentStatus} />
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
