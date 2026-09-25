export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { fmt } from '@/lib/format'
import { fromZonedTime } from 'date-fns-tz'
import { countCheckinAnswers } from '@/lib/analytics/checkins'
import { alertHoursStart, alertsByHour } from '@/lib/analytics/alerts'
import { resolveCheckinTime } from '@/lib/reminders/checkin'
import { Users, Bell, CalendarCheck, MessageSquareReply, Moon, CalendarDays, ArrowRight, Plus } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { RealtimeAlertsBanner } from '@/components/alerts/realtime-alerts-banner'
import { RecentAlerts } from '@/components/alerts/recent-alerts'
import { KeyReminders } from '@/components/dashboard/key-reminders'
import type { Reminder } from '@/components/dashboard/key-reminders'
import { AlertsByHour } from '@/components/dashboard/alerts-by-hour'
import { OverviewLiveRefresh } from '@/components/dashboard/overview-live-refresh'
import { StatusBadge } from '@/components/shared/status-badge'
import type { AppointmentStatus } from '@/types/enums'

export const metadata = { title: 'Overview' }

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const DAY_MS = 24 * 60 * 60 * 1000

type PlanRow = { id: string; status: string; patients: { full_name: string } | null }
type AppointmentRow = {
  id: string
  specialty: string
  scheduled_at: string
  episode_id: string
  care_episodes: { patients: { full_name: string } | null } | null
}

/**
 * The first screen of the day: who needs a nurse now, what is still to follow
 * up and how the last day went (left), then what is scheduled (right).
 */
export default async function OverviewPage() {
  const { profile, hospital } = await requireSession()
  const supabase = await createClient()
  const hid = profile.hospital_id
  const tz = hospital.timezone

  // "Today" in the hospital's timezone, as UTC instants for the query
  const now = new Date()
  const todayLocal = fmt(now, 'yyyy-MM-dd', tz)
  const dayStart = fromZonedTime(`${todayLocal}T00:00:00`, tz)
  const dayEnd = new Date(dayStart.getTime() + DAY_MS)
  const soonEnd = new Date(dayStart.getTime() + 4 * DAY_MS) // the end of the day three days from now
  const weekAhead = new Date(now.getTime() + 7 * DAY_MS)
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString()

  // Everything the page needs, in one round-trip batch
  const [
    { count: activePatients },
    { count: openAlerts },
    { count: criticalAlerts },
    { count: toConfirm },
    { data: openAlertRows },
    { count: checkinsSent },
    checkinsAnswered,
    { data: todaysJobs },
    { data: upcoming },
    { data: planRows, count: plansToSend },
    { count: acknowledgedAlerts },
    { data: soonRows, count: unconfirmedSoon },
    { data: dayAlertRows },
  ] = await Promise.all([
    supabase.from('care_episodes').select('*', { count: 'exact', head: true }).eq('hospital_id', hid).eq('status', 'active'),
    supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('hospital_id', hid).eq('status', 'open'),
    supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('hospital_id', hid).eq('status', 'open').eq('severity', 'critical'),
    supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('hospital_id', hid).eq('status', 'confirmation_pending'),
    supabase.from('alerts')
      .select('id, type, severity, status, created_at, episode_id, care_episodes(id, patients(full_name, mrn))')
      .eq('hospital_id', hid).eq('status', 'open').order('created_at', { ascending: false }).limit(20),
    supabase.from('reminder_jobs').select('*', { count: 'exact', head: true }).eq('hospital_id', hid).eq('status', 'sent').gte('fire_at', weekAgo),
    countCheckinAnswers(supabase, { hospitalId: hid, since: weekAgo }),
    supabase.from('reminder_jobs')
      .select('status')
      .eq('hospital_id', hid).gte('fire_at', dayStart.toISOString()).lt('fire_at', dayEnd.toISOString()),
    supabase.from('appointments')
      .select('id, specialty, scheduled_at, status, episode_id, care_episodes(patients(full_name))')
      .eq('hospital_id', hid).gte('scheduled_at', now.toISOString()).lte('scheduled_at', weekAhead.toISOString())
      .not('status', 'in', '(cancelled,missed)').order('scheduled_at', { ascending: true }).limit(5),
    // Key reminders: care plans not sent yet, alerts acknowledged but not resolved, appointments soon and unconfirmed
    supabase.from('care_episodes')
      .select('id, status, patients(full_name)', { count: 'exact' })
      .eq('hospital_id', hid).in('status', ['draft', 'pending_review']).order('created_at', { ascending: false }).limit(3),
    supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('hospital_id', hid).eq('status', 'acknowledged'),
    supabase.from('appointments')
      .select('id, specialty, scheduled_at, episode_id, care_episodes(patients(full_name))', { count: 'exact' })
      .eq('hospital_id', hid).eq('status', 'confirmation_pending')
      .gte('scheduled_at', now.toISOString()).lt('scheduled_at', soonEnd.toISOString())
      .order('scheduled_at', { ascending: true }).limit(3),
    // Alerts raised in the last 24 hours, whatever happened to them since
    supabase.from('alerts')
      .select('created_at, severity')
      .eq('hospital_id', hid).gte('created_at', alertHoursStart(now, tz).toISOString()).limit(1000),
  ])

  // Most urgent first, newest first within a severity.
  const needsAttention = [...(openAlertRows ?? [])].sort((a, b) =>
    (SEVERITY_RANK[a.severity as string] ?? 9) - (SEVERITY_RANK[b.severity as string] ?? 9)
    || String(b.created_at).localeCompare(String(a.created_at)))

  const sent7 = checkinsSent ?? 0
  const answered7 = Math.min(checkinsAnswered ?? 0, sent7)
  const replyRate = sent7 > 0 ? Math.round((answered7 / sent7) * 100) : null

  const jobs = todaysJobs ?? []
  const tonight = {
    total: jobs.length,
    sent: jobs.filter((j) => j.status === 'sent').length,
    failed: jobs.filter((j) => j.status === 'failed').length,
    pending: jobs.filter((j) => j.status === 'pending').length,
  }
  const critical = (criticalAlerts ?? 0) > 0

  // Most pressing first: a patient not covered yet, then alerts left half-done, then appointments close by.
  const reminders: Reminder[] = []
  const plans = (planRows ?? []) as unknown as PlanRow[]
  const planCount = plansToSend ?? plans.length
  if (planCount === 1 && plans[0]) {
    const plan = plans[0]
    const name = <span className="font-medium">{plan.patients?.full_name ?? 'A patient'}</span>
    reminders.push(plan.status === 'draft'
      ? { key: 'plans', href: `/episodes/${plan.id}/review`, text: <>{name}’s care plan is waiting for your review</> }
      : { key: 'plans', href: `/episodes/${plan.id}`, text: <>{name}’s care plan is approved but not sent yet</> })
  } else if (planCount > 1) {
    reminders.push({
      key: 'plans',
      href: `/patients?status=${plans.some((p) => p.status === 'draft') ? 'draft' : 'pending_review'}`,
      text: <><span className="font-medium">{planCount} care plans</span> are waiting to be reviewed and sent</>,
    })
  }
  const acknowledged = acknowledgedAlerts ?? 0
  if (acknowledged > 0) {
    reminders.push({
      key: 'acknowledged',
      href: '/alerts?status=acknowledged',
      text: <><span className="font-medium">{acknowledged} acknowledged alert{acknowledged === 1 ? '' : 's'}</span> still to resolve</>,
    })
  }
  const soon = (soonRows ?? []) as unknown as AppointmentRow[]
  const soonCount = unconfirmedSoon ?? soon.length
  if (soonCount === 1 && soon[0]) {
    const a = soon[0]
    reminders.push({
      key: 'unconfirmed',
      href: `/episodes/${a.episode_id}/appointments/${a.id}`,
      text: <><span className="font-medium">{a.care_episodes?.patients?.full_name ?? 'A patient'}</span> hasn’t confirmed {a.specialty}, {fmt(a.scheduled_at, 'EEE d MMM, HH:mm', tz)}</>,
    })
  } else if (soonCount > 1) {
    reminders.push({
      key: 'unconfirmed',
      href: '/appointments',
      text: <><span className="font-medium">{soonCount} appointments</span> in the next 3 days aren’t confirmed by the patient yet</>,
    })
  }

  const alertHours = alertsByHour(dayAlertRows ?? [], now, tz)

  const stats = [
    { label: 'Active patients', value: activePatients ?? 0, icon: Users, tone: 'brand', href: '/patients' },
    { label: 'Open alerts', value: openAlerts ?? 0, icon: Bell, tone: critical ? 'danger' : (openAlerts ?? 0) > 0 ? 'warning' : 'brand', href: '/alerts', urgent: critical, sub: critical ? `${criticalAlerts} critical` : undefined },
    { label: 'Appointments to confirm', value: toConfirm ?? 0, icon: CalendarCheck, tone: 'brand', href: '/appointments' },
    { label: 'Check-ins answered (7 days)', value: replyRate == null ? '—' : `${replyRate}%`, icon: MessageSquareReply, tone: replyRate == null ? 'muted' : replyRate >= 75 ? 'success' : replyRate >= 50 ? 'warning' : 'danger', href: '/analytics', sub: replyRate == null ? 'No check-ins sent this week' : `${answered7} of ${sent7} nightly check-ins` },
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
      <OverviewLiveRefresh hospitalId={hid} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {hospital.name} · {fmt(now, 'EEEE, d MMMM', tz)}
          </p>
        </div>
        <Link
          href="/episodes/new"
          data-tour="add-patient"
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> Add patient
        </Link>
      </div>

      {/* Headline numbers — each one opens the screen behind it */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" data-tour="overview-stats">
        {stats.map((stat) => {
          const Icon = stat.icon
          const tone = TONE[stat.tone]
          return (
            <Link key={stat.label} href={stat.href} className="group rounded-lg focus-visible:ring-2 focus-visible:ring-ring">
              <Card className={`h-full py-0 transition-shadow duration-200 group-hover:ring-brand/50 ${'urgent' in stat && stat.urgent ? 'ring-2 ring-danger/60' : ''}`}>
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium leading-snug text-muted-foreground">{stat.label}</p>
                    <span className={`shrink-0 rounded-lg p-2 ${tone.icon}`} aria-hidden="true">
                      <Icon className="h-4 w-4" />
                    </span>
                  </div>
                  <p className={`mt-2 text-2xl font-semibold tracking-tight tnum sm:mt-3 sm:text-3xl ${tone.value}`}>{stat.value}</p>
                  {'sub' in stat && stat.sub && <p className="mt-1 text-xs text-muted-foreground">{stat.sub}</p>}
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-5">
        {/* Needs attention: open alerts (live), what is still to follow up, and the last 24 hours */}
        <Card className="gap-0 py-0 lg:col-span-3" data-tour="overview-attention">
          <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
            <h2 className="text-base font-medium">
              Needs attention
              {needsAttention.length > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground tnum">{openAlerts ?? needsAttention.length}</span>}
            </h2>
            <Link href="/alerts" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
              All alerts <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <RecentAlerts alerts={needsAttention as any} hospitalId={hid} tz={tz} openOnly limit={5} />
          <div className="space-y-3 px-5 pb-5 pt-4">
            <KeyReminders
              reminders={reminders}
              empty={<>Nothing to follow up right now. Tonight’s check-ins go out at {resolveCheckinTime(hospital.settings)}.</>}
            />
            <AlertsByHour hours={alertHours} tz={tz} />
          </div>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          {/* Tonight's check-ins */}
          <Card className="gap-0 py-0">
            <section aria-labelledby="today-checkins" className="px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <h2 id="today-checkins" className="flex items-center gap-2 text-base font-medium">
                  <Moon className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Tonight’s check-ins
                </h2>
                <span className="text-xs text-muted-foreground tnum">{tonight.total} scheduled</span>
              </div>
              {tonight.total === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No check-ins scheduled today.</p>
              ) : (
                <>
                  <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-muted" role="img"
                       aria-label={`${tonight.sent} sent, ${tonight.failed} failed, ${tonight.pending} still to send`}>
                    <div className="bg-success" style={{ width: `${(tonight.sent / tonight.total) * 100}%` }} />
                    <div className="bg-danger" style={{ width: `${(tonight.failed / tonight.total) * 100}%` }} />
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div><dt className="text-muted-foreground">Sent</dt><dd className="mt-0.5 text-sm font-medium tnum">{tonight.sent}</dd></div>
                    <div><dt className="text-muted-foreground">Failed</dt><dd className={`mt-0.5 text-sm font-medium tnum ${tonight.failed ? 'text-danger' : ''}`}>{tonight.failed}</dd></div>
                    <div><dt className="text-muted-foreground">Still to send</dt><dd className="mt-0.5 text-sm font-medium tnum">{tonight.pending}</dd></div>
                  </dl>
                  {tonight.failed > 0 && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      <Badge variant="outline" className="mr-1.5 border-danger/40 text-danger">Failed</Badge>
                      usually means the number cannot be reached on WhatsApp — the reason is on the patient’s conversation.
                    </p>
                  )}
                </>
              )}
            </section>
          </Card>

          {/* Appointments, next 7 days */}
          <Card className="gap-0 py-0">
            <section aria-labelledby="upcoming-appts">
              <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
                <h2 id="upcoming-appts" className="flex items-center gap-2 text-base font-medium">
                  <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Next 7 days
                </h2>
                <Link href="/appointments" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                  All appointments <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              </div>
              {!upcoming || upcoming.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted-foreground">No appointments in the next 7 days.</p>
              ) : (
                <CardContent className="px-0">
                  <ul className="divide-y">
                    {upcoming.map((a) => {
                      const patientName = (a.care_episodes as unknown as { patients: { full_name: string } | null } | null)?.patients?.full_name ?? 'Patient'
                      return (
                        <li key={a.id}>
                          <Link href={`/episodes/${a.episode_id}/appointments/${a.id}`} className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-muted/60">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{patientName}</p>
                              <p className="truncate text-xs text-muted-foreground">{a.specialty} · {fmt(a.scheduled_at, 'EEE d MMM, HH:mm', tz)}</p>
                            </div>
                            <StatusBadge status={a.status as AppointmentStatus} />
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </CardContent>
              )}
            </section>
          </Card>
        </div>
      </div>
    </div>
  )
}
