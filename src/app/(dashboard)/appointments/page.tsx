export const dynamic = 'force-dynamic'

import { NavLink } from '@/components/layout/nav-link'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { Calendar, AlertCircle, ChevronRight, CalendarClock, FileText } from 'lucide-react'
import { fmt } from '@/lib/format'
import { StatusBadge } from '@/components/shared/status-badge'
import type { AppointmentStatus } from '@/types/enums'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/shared/empty-state'
import { LiveRefresh } from '@/components/shared/live-refresh'

export async function generateMetadata() {
  return { title: 'Appointments' }
}

export default async function AppointmentsPage() {
  const { profile, hospital } = await requireSession()
  const tz = hospital.timezone
  const supabase = await createClient()

  const [{ data: appointments }, { data: undatedFollowUps }] = await Promise.all([
    supabase
      .from('appointments')
      .select(`
        id, specialty, scheduled_at, location, status, time_tbc,
        confirmation_requested_at, confirmed_at,
        follow_up_requirements(instructions),
        care_episodes(
          id,
          patients(full_name, mrn)
        )
      `)
      .eq('hospital_id', profile.hospital_id)
      .order('scheduled_at', { ascending: true }),
    // Follow-ups the discharge letter gave no date for: nothing to put on the
    // calendar yet, but the nurse should see they exist.
    supabase
      .from('follow_up_requirements')
      .select(`
        id, specialty, instructions,
        appointments(id),
        discharge_summaries!inner(
          episode_id,
          care_episodes!inner(id, status, patients(full_name, mrn))
        )
      `)
      .eq('hospital_id', profile.hospital_id)
      .is('deadline', null)
      .in('discharge_summaries.care_episodes.status', ['draft', 'pending_review', 'active']),
  ])

  const needsDate = (undatedFollowUps ?? []).filter((f) => !Array.isArray(f.appointments) || f.appointments.length === 0)

  const upcoming = (appointments ?? []).filter((a) =>
    ['scheduled', 'confirmation_pending', 'confirmed', 'reschedule_pending'].includes(a.status),
  )
  const past = (appointments ?? []).filter((a) =>
    ['rescheduled', 'cancelled', 'missed'].includes(a.status),
  )

  return (
    <div className="space-y-6">
      <LiveRefresh hospitalId={profile.hospital_id} events={['appointment_confirmed', 'appointment_rescheduled', 'extraction_completed']} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Appointments</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Follow-up visits from each care plan, and whether the patient has confirmed them
          </p>
        </div>
      </div>

      {appointments?.length === 0 && needsDate.length === 0 && (
        <EmptyState
          icon={Calendar}
          title="No appointments yet"
          description="Follow-up visits in a discharge letter appear here as soon as the letter is read."
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
                const rawFollowUp = appt.follow_up_requirements as unknown
                const followUpNote = ((Array.isArray(rawFollowUp) ? rawFollowUp[0] : rawFollowUp) as { instructions: string | null } | null)?.instructions ?? null
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
                        {appt.time_tbc
                          ? <>Due by {fmt(appt.scheduled_at, 'EEE d MMM', tz)} · time to confirm</>
                          : <>{fmt(appt.scheduled_at, 'HH:mm', tz)}{appt.location ? ` · ${appt.location}` : ''}</>}
                      </p>
                      {followUpNote && <p className="text-xs text-muted-foreground truncate" title={followUpNote}>{followUpNote}</p>}
                    </div>
                    <div className="hidden sm:flex items-center gap-2 shrink-0">
                      {appt.time_tbc && (
                        <Badge variant="outline" className="gap-1 border-brand/30 bg-brand-soft text-[11px] font-medium text-brand" title="Taken from the discharge letter: book the actual time">
                          <FileText className="h-3 w-3" aria-hidden="true" /> From letter
                        </Badge>
                      )}
                      {appt.status === 'confirmation_pending' && <AlertCircle className="w-4 h-4 text-warning" aria-hidden="true" />}
                      <StatusBadge status={appt.status as AppointmentStatus} />
                      {href && <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />}
                    </div>
                  </>
                )
                const rowClass = 'group flex items-start gap-3 sm:items-center p-4 transition-colors duration-200 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none'
                return href ? (
                  <NavLink key={appt.id} href={href} className={rowClass} aria-label={`${appt.specialty} appointment for ${patient?.full_name ?? 'patient'}`}>{inner}</NavLink>
                ) : (
                  <div key={appt.id} className={rowClass}>{inner}</div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {needsDate.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-warning" aria-hidden="true" />
              Needs a date ({needsDate.length})
            </CardTitle>
            <CardDescription>Visits the discharge letter asked for without a date. Open one to add a date or book it.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {needsDate.map((f) => {
                const summary = f.discharge_summaries as unknown as { episode_id: string; care_episodes: { id: string; patients: { full_name: string; mrn: string } | null } | null } | null
                const patient = summary?.care_episodes?.patients
                const episodeId = summary?.episode_id
                const inner = (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{f.specialty}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {patient?.full_name ?? 'Unknown'} <span className="font-mono">{patient?.mrn ?? ''}</span>{f.instructions ? ` · ${f.instructions}` : ''}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </>
                )
                const rowClass = 'group flex items-center gap-3 p-4 transition-colors duration-200 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none'
                return episodeId ? (
                  <NavLink key={f.id} href={`/episodes/${episodeId}?tab=care-plan`} className={rowClass} aria-label={`Set a date for ${f.specialty} follow-up, ${patient?.full_name ?? 'patient'}`}>{inner}</NavLink>
                ) : (
                  <div key={f.id} className={rowClass}>{inner}</div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {past.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-muted-foreground">Past and cancelled ({past.length})</CardTitle>
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
