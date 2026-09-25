export const dynamic = 'force-dynamic'

import { requireSession } from '@/lib/auth/session'
import { fmt } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ComplianceChart, RiskDonut, AlertActivityChart } from '@/components/analytics/lazy-charts'
import { AppointmentFunnel } from '@/components/analytics/appointment-funnel'
import { countCheckinAnswers, checkinTrend } from '@/lib/analytics/checkins'
import { appointmentBreakdown } from '@/lib/analytics/appointments'
import { Users, Bell, CalendarCheck, MessageSquareReply } from 'lucide-react'
import { subDays } from 'date-fns'

export const metadata = { title: 'Analytics' }

export default async function AnalyticsPage() {
  const { profile, hospital } = await requireSession()
  const tz = hospital.timezone
  const hospitalId = profile.hospital_id
  const supabase = await createClient()

  // ── Fetch all data server-side ──────────────────────────────────────
  const since30 = subDays(new Date(), 31).toISOString()
  const [
    { count: totalPatients },
    { count: activeEpisodes },
    { count: completedEpisodes },
    { count: openAlerts },
    { count: criticalAlerts },
    { count: totalAlerts30d },
    { count: totalReminders },
    checkinAnswers,
    { data: riskData },
    { data: apptStats },
    { data: sentJobs30d },
    { data: answerEvents30d },
    { data: alertActivity },
  ] = await Promise.all([
    supabase.from('patients').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId),
    supabase.from('care_episodes').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).eq('status', 'active'),
    supabase.from('care_episodes').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).eq('status', 'completed'),
    supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).eq('status', 'open'),
    supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).eq('status', 'open').eq('severity', 'critical'),
    supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).gte('created_at', subDays(new Date(), 30).toISOString()),
    supabase.from('reminder_jobs').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).eq('status', 'sent'),
    countCheckinAnswers(supabase, { hospitalId }),
    supabase.from('care_episodes').select('current_risk_level').eq('hospital_id', hospitalId).eq('status', 'active'),
    supabase.from('appointments').select('status, time_tbc').eq('hospital_id', hospitalId),
    // The check-in chart is worked out from the check-ins themselves, as they happen.
    supabase.from('reminder_jobs').select('id, fire_at').eq('hospital_id', hospitalId).eq('status', 'sent').gte('fire_at', since30),
    supabase.from('patient_timeline_events').select('event_type, payload, created_at').eq('hospital_id', hospitalId).in('event_type', ['reminder_response', 'escalation_created']).gte('created_at', since30),
    supabase.from('alerts').select('created_at, severity').eq('hospital_id', hospitalId).gte('created_at', subDays(new Date(), 14).toISOString()),
  ])

  // ── Compute derived metrics ──────────────────────────────────────────
  // Nightly check-ins that went out, and how many were answered ("none taken" counts: lib/analytics/checkins.ts).
  const sentCheckins = totalReminders ?? 0
  const answeredCheckins = Math.min(checkinAnswers, sentCheckins)
  const answerRate = sentCheckins > 0 ? Math.round((answeredCheckins / sentCheckins) * 100) : null

  const appts = appointmentBreakdown(apptStats ?? [])

  const riskCounts = (riskData ?? []).reduce<Record<string, number>>((acc, e) => {
    acc[e.current_risk_level] = (acc[e.current_risk_level] ?? 0) + 1
    return acc
  }, { green: 0, yellow: 0, red: 0 })

  const last30Days = Array.from({ length: 30 }, (_, i) => fmt(subDays(new Date(), 29 - i), 'yyyy-MM-dd', tz))
  const complianceTrend = checkinTrend({
    sent: (sentJobs30d ?? []) as Array<{ id: string; fire_at: string }>,
    events: (answerEvents30d ?? []) as Array<{ event_type: string; payload: Record<string, unknown> | null; created_at: string }>,
    days: last30Days,
    timezone: tz,
  }).map((d) => ({ date: fmt(d.day, 'dd MMM', tz), answered: d.answered, tookAll: d.tookAll }))

  // Build 14-day alert activity
  const alertByDay: Record<string, { date: string; critical: number; high: number; medium: number; low: number }> = {}
  for (let i = 13; i >= 0; i--) {
    const day = fmt(subDays(new Date(), i), 'dd MMM', tz)
    alertByDay[day] = { date: day, critical: 0, high: 0, medium: 0, low: 0 }
  }
  for (const a of alertActivity ?? []) {
    const day = fmt(a.created_at, 'dd MMM', tz)
    if (alertByDay[day]) {
      alertByDay[day][a.severity as 'critical' | 'high' | 'medium' | 'low'] += 1
    }
  }

  const riskDistribution = [
    { name: 'Stable (green)', value: riskCounts.green ?? 0, color: 'var(--success)' },
    { name: 'Monitor (yellow)', value: riskCounts.yellow ?? 0, color: 'var(--warning)' },
    { name: 'Critical (red)', value: riskCounts.red ?? 0, color: 'var(--danger)' },
  ]

  // ── KPI cards: counted from the records, nothing estimated ─────────
  const kpiCards = [
    {
      label: 'Patients',
      value: totalPatients ?? 0,
      sub: `${activeEpisodes ?? 0} active · ${completedEpisodes ?? 0} completed`,
      icon: Users,
      color: 'text-brand',
      bg: 'bg-brand-soft',
    },
    {
      label: 'Check-ins answered',
      value: answerRate == null ? '—' : `${answerRate}%`,
      sub: answerRate == null ? 'No check-ins sent yet' : `${answeredCheckins} of ${sentCheckins} nightly check-ins`,
      icon: MessageSquareReply,
      color: answerRate == null ? 'text-muted-foreground' : answerRate >= 70 ? 'text-success' : 'text-warning',
      bg: answerRate == null ? 'bg-muted' : answerRate >= 70 ? 'bg-success-soft' : 'bg-warning-soft',
    },
    {
      label: 'Appointments confirmed',
      value: appts.confirmedRate == null ? '—' : `${appts.confirmedRate}%`,
      sub: appts.confirmedRate == null
        ? (appts.toBook > 0 ? `None booked yet · ${appts.toBook} to book` : 'No appointments yet')
        : `${appts.confirmed} of ${appts.booked} booked${appts.toBook > 0 ? ` · ${appts.toBook} still to book` : ''}`,
      icon: CalendarCheck,
      color: appts.confirmedRate == null ? 'text-muted-foreground' : appts.confirmedRate >= 70 ? 'text-success' : 'text-warning',
      bg: appts.confirmedRate == null ? 'bg-muted' : appts.confirmedRate >= 70 ? 'bg-success-soft' : 'bg-warning-soft',
    },
    {
      label: 'Open alerts',
      value: openAlerts ?? 0,
      sub: `${criticalAlerts ?? 0} critical · ${totalAlerts30d ?? 0} in the last 30 days`,
      icon: Bell,
      color: (criticalAlerts ?? 0) > 0 ? 'text-danger' : (openAlerts ?? 0) > 0 ? 'text-warning' : 'text-brand',
      bg: (criticalAlerts ?? 0) > 0 ? 'bg-danger-soft' : (openAlerts ?? 0) > 0 ? 'bg-warning-soft' : 'bg-brand-soft',
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          How your patients are doing, since they joined CareLoop
        </p>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpiCards.map((kpi) => {
          const Icon = kpi.icon
          return (
            <Card key={kpi.label}>
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground leading-snug">{kpi.label}</CardTitle>
                <div className={`shrink-0 p-1.5 rounded-lg ${kpi.bg}`} aria-hidden="true">
                  <Icon className={`w-3.5 h-3.5 ${kpi.color}`} />
                </div>
              </CardHeader>
              <CardContent className="pb-4">
                <div className={`text-2xl font-semibold tracking-tight tnum ${kpi.color}`}>{kpi.value}</div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{kpi.sub}</p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Check-ins, last 30 days</CardTitle>
            <p className="text-xs text-muted-foreground">Of each night’s check-ins: how many were answered, and how many answers said every medicine was taken</p>
          </CardHeader>
          <CardContent>
            <ComplianceChart data={complianceTrend} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Active patients by risk</CardTitle>
            <p className="text-xs text-muted-foreground">Their colour right now</p>
          </CardHeader>
          <CardContent>
            <RiskDonut data={riskDistribution} />
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Alerts per day, last 14 days</CardTitle>
            <p className="text-xs text-muted-foreground">Coloured by how urgent they were</p>
          </CardHeader>
          <CardContent>
            <AlertActivityChart data={Object.values(alertByDay)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Appointments</CardTitle>
            <p className="text-xs text-muted-foreground">Booked appointments, and where each one stands</p>
          </CardHeader>
          <CardContent>
            <AppointmentFunnel {...appts} />
          </CardContent>
        </Card>
      </div>

    </div>
  )
}
