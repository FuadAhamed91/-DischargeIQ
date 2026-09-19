export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { fmt } from '@/lib/format'
import { fromZonedTime } from 'date-fns-tz'
import { Users, Bell, CalendarCheck, TrendingUp, Send, CalendarDays, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { RealtimeAlertsBanner } from '@/components/alerts/realtime-alerts-banner'
import { RecentAlerts } from '@/components/alerts/recent-alerts'
import { StatusBadge } from '@/components/shared/status-badge'
import type { AppointmentStatus } from '@/types/enums'

export const metadata = { title: 'Overview' }

export default async function OverviewPage() {
  const { profile, hospital } = await requireSession()
  const supabase = await createClient()
  const hid = profile.hospital_id
  const tz = hospital.timezone

  // "Today" in the hospital's timezone, as UTC instants for the query
  const now = new Date()
  const todayLocal = fmt(now, 'yyyy-MM-dd', tz)
  const dayStart = fromZonedTime(`${todayLocal}T00:00:00`, tz)
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const weekAgo = fmt(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd', tz)

  // Everything the page needs, in one round-trip batch
  const [
    { count: activePatients },
    { count: openAlerts },
    { count: criticalAlerts },
    { count: pendingAppointments },
    { data: recentAlerts },
    { data: snapshots },
    { data: todaysJobs },
    { data: upcoming },
  ] = await Promise.all([
    supabase.from('care_episodes').select('*', { count: 'exact', head: true }).eq('hospital_id', hid).eq('status', 'active'),
    supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('hospital_id', hid).eq('status', 'open'),
    supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('hospital_id', hid).eq('status', 'open').eq('severity', 'critical'),
    supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('hospital_id', hid).eq('status', 'confirmation_pending'),
    supabase.from('alerts')
      .select('id, type, severity, status, created_at, episode_id, care_episodes(id, patients(full_name, mrn))')
      .eq('hospital_id', hid).order('created_at', { ascending: false }).limit(5),
    supabase.from('compliance_snapshots')
      .select('reminder_response_rate, medication_adherence')
      .eq('hospital_id', hid).gte('snapshot_date', weekAgo),
    supabase.from('reminder_jobs')
      .select('status')
      .eq('hospital_id', hid).gte('fire_at', dayStart.toISOString()).lt('fire_at', dayEnd.toISOString()),
    supabase.from('appointments')
      .select('id, specialty, scheduled_at, status, episode_id, care_episodes(patients(full_name))')
      .eq('hospital_id', hid).gte('scheduled_at', now.toISOString()).lte('scheduled_at', weekAhead.toISOString())
      .not('status', 'in', '(cancelled,missed)').order('scheduled_at', { ascending: true }).limit(5),
  ])

  // Compliance: mean response rate over the last 7 days of snapshots
  const rates = (snapshots ?? []).map((s) => Number(s.reminder_response_rate)).filter((n) => !Number.isNaN(n))
  const compliance = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null

  const jobs = todaysJobs ?? []
  const reminders = {
    total: jobs.length,
    sent: jobs.filter((j) => j.status === 'sent').length,
    failed: jobs.filter((j) => j.status === 'failed').length,
    pending: jobs.filter((j) => j.status === 'pending').length,
  }
  const critical = (criticalAlerts ?? 0) > 0

  const stats = [
    { label: 'Active patients', value: activePatients ?? 0, icon: Users, tone: 'brand', href: '/patients' },
    { label: 'Open alerts', value: openAlerts ?? 0, icon: Bell, tone: critical ? 'danger' : (openAlerts ?? 0) > 0 ? 'warning' : 'brand', href: '/alerts', urgent: critical, sub: critical ? `${criticalAlerts} critical` : undefined },
    { label: 'Pending confirmations', value: pendingAppointments ?? 0, icon: CalendarCheck, tone: 'brand', href: '/appointments' },
    { label: 'Compliance (7 days)', value: compliance == null ? '—' : `${compliance}%`, icon: TrendingUp, tone: compliance == null ? 'muted' : compliance >= 75 ? 'success' : compliance >= 50 ? 'warning' : 'danger', href: '/analytics', sub: compliance == null ? 'No responses recorded yet' : 'Reminder response rate' },
  ] as const

  const TONE: Record<string, { icon: string; value: string }> = {
    brand:   { icon: 'bg-brand-soft text-brand',     value: 'text-foreground' },
    success: { icon: 'bg-success-soft text-success', value: 'text-foreground' },
    warning: { icon: 'bg-warning-soft text-warning', value: 'text-foreground' },
    danger:  { icon: 'bg-danger-soft text-danger',   value: 'text-danger' },
    muted:   { icon: 'bg-muted text-muted-foreground', value: 'text-muted-foreground' },
  }

  return (
    <div className="space-y-6">
      <RealtimeAlertsBanner hospitalId={hid} initialRedCount={criticalAlerts ?? 0} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {hospital.name} · {fmt(now, 'EEEE, d MMMM', tz)}
          </p>
        </div>
        <Link
          href="/episodes/new"
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          New episode
        </Link>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          const tone = TONE[stat.tone]
          return (
            <Link key={stat.label} href={stat.href} className="group rounded-xl focus-visible:ring-2 focus-visible:ring-ring">
              <Card className={`h-full transition-shadow duration-200 group-hover:shadow-md ${'urgent' in stat && stat.urgent ? 'ring-2 ring-danger/60' : ''}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-muted-foreground leading-snug">{stat.label}</p>
                    <span className={`shrink-0 rounded-lg p-2 ${tone.icon}`} aria-hidden="true">
                      <Icon className="h-4 w-4" />
                    </span>
                  </div>
                  <p className={`mt-3 text-3xl font-semibold tracking-tight tnum ${tone.value}`}>{stat.value}</p>
                  {'sub' in stat && stat.sub && <p className="mt-1 text-xs text-muted-foreground">{stat.sub}</p>}
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent alerts */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Recent alerts</CardTitle>
            <Link href="/alerts" className="text-xs font-medium text-brand hover:underline inline-flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <RecentAlerts alerts={(recentAlerts ?? []) as any} hospitalId={hid} />
          </CardContent>
        </Card>

        {/* Today */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Today</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Reminder delivery */}
            <section aria-labelledby="today-reminders">
              <div className="flex items-center justify-between">
                <h3 id="today-reminders" className="text-sm font-medium flex items-center gap-2">
                  <Send className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Reminders
                </h3>
                <span className="text-xs text-muted-foreground tnum">{reminders.total} scheduled</span>
              </div>
              {reminders.total === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No reminders due today.</p>
              ) : (
                <>
                  <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-muted" role="img"
                       aria-label={`${reminders.sent} sent, ${reminders.failed} failed, ${reminders.pending} pending`}>
                    <div className="bg-success" style={{ width: `${(reminders.sent / reminders.total) * 100}%` }} />
                    <div className="bg-danger" style={{ width: `${(reminders.failed / reminders.total) * 100}%` }} />
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div><dt className="text-muted-foreground">Sent</dt><dd className="font-medium tnum">{reminders.sent}</dd></div>
                    <div><dt className="text-muted-foreground">Failed</dt><dd className={`font-medium tnum ${reminders.failed ? 'text-danger' : ''}`}>{reminders.failed}</dd></div>
                    <div><dt className="text-muted-foreground">Pending</dt><dd className="font-medium tnum">{reminders.pending}</dd></div>
                  </dl>
                </>
              )}
            </section>

            {/* Upcoming appointments */}
            <section aria-labelledby="upcoming-appts">
              <div className="flex items-center justify-between">
                <h3 id="upcoming-appts" className="text-sm font-medium flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Next 7 days
                </h3>
                <Link href="/appointments" className="text-xs font-medium text-brand hover:underline">All appointments</Link>
              </div>
              {!upcoming || upcoming.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No appointments in the next 7 days.</p>
              ) : (
                <ul className="mt-2 divide-y">
                  {upcoming.map((a) => {
                    const patientName = (a.care_episodes as unknown as { patients: { full_name: string } | null } | null)?.patients?.full_name ?? 'Patient'
                    return (
                      <li key={a.id}>
                        <Link href={`/episodes/${a.episode_id}/appointments/${a.id}`} className="flex items-center justify-between gap-3 py-2.5 rounded-md hover:bg-muted/60 -mx-2 px-2 transition-colors">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{patientName}</p>
                            <p className="text-xs text-muted-foreground">{a.specialty} · {fmt(a.scheduled_at, 'EEE d MMM, HH:mm', tz)}</p>
                          </div>
                          <StatusBadge status={a.status as AppointmentStatus} />
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {reminders.failed > 0 && (
              <p className="text-xs text-muted-foreground">
                <Badge variant="outline" className="mr-1.5 border-danger/40 text-danger">Failed</Badge>
                reminders usually mean the number is not reachable on WhatsApp. Check the patient&apos;s conversation for the error.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
