export const dynamic = 'force-dynamic'

import { requireSession } from '@/lib/auth/session'
import { fmt } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ComplianceChart, RiskDonut, AlertActivityChart } from '@/components/analytics/lazy-charts'
import { AppointmentFunnel } from '@/components/analytics/appointment-funnel'
import { Users, Bell, CalendarCheck, MessageSquareReply } from 'lucide-react'
import { subDays } from 'date-fns'

export const metadata = { title: 'Analytics' }

export default async function AnalyticsPage() {
  const { profile, hospital } = await requireSession()
  const tz = hospital.timezone
  const hospitalId = profile.hospital_id
  const supabase = await createClient()

  // ── Fetch all data server-side ──────────────────────────────────────
  const [
    { count: totalPatients },
    { count: activeEpisodes },
    { count: completedEpisodes },
    { count: openAlerts },
    { count: criticalAlerts },
    { count: totalAlerts30d },
    { count: totalReminders },
    { count: reminderResponses },
    { data: riskData },
    { data: apptStats },
    { data: snapshots },
    { data: alertActivity },
  ] = await Promise.all([
    supabase.from('patients').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId),
    supabase.from('care_episodes').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).eq('status', 'active'),
    supabase.from('care_episodes').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).eq('status', 'completed'),
    supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).eq('status', 'open'),
    supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).eq('status', 'open').eq('severity', 'critical'),
    supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).gte('created_at', subDays(new Date(), 30).toISOString()),
    supabase.from('reminder_jobs').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).eq('status', 'sent'),
    supabase.from('patient_timeline_events').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).eq('event_type', 'reminder_response'),
    supabase.from('care_episodes').select('current_risk_level').eq('hospital_id', hospitalId).eq('status', 'active'),
    supabase.from('appointments').select('status').eq('hospital_id', hospitalId),
    supabase.from('compliance_snapshots').select('snapshot_date, medication_adherence, reminder_response_rate').eq('hospital_id', hospitalId).gte('snapshot_date', fmt(subDays(new Date(), 30), 'yyyy-MM-dd', tz)).order('snapshot_date', { ascending: true }),
    supabase.from('alerts').select('created_at, severity').eq('hospital_id', hospitalId).gte('created_at', subDays(new Date(), 14).toISOString()),
  ])

  // ── Compute derived metrics ──────────────────────────────────────────
  // Nightly check-ins that went out, and how many were answered.
  const sentCheckins = totalReminders ?? 0
  const answeredCheckins = Math.min(reminderResponses ?? 0, sentCheckins)
  const answerRate = sentCheckins > 0 ? Math.round((answeredCheckins / sentCheckins) * 100) : null

  const apptCounts = (apptStats ?? []).reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1
    return acc
  }, {})
  const totalAppts = apptStats?.length ?? 0
  const confirmedAppts = (apptCounts['confirmed'] ?? 0) + (apptCounts['completed'] ?? 0)
  const missedAppts = apptCounts['missed'] ?? 0
  const pendingAppts = apptCounts['confirmation_pending'] ?? 0
  const apptCompletionRate = totalAppts > 0 ? Math.round((confirmedAppts / totalAppts) * 100) : 0

  const riskCounts = (riskData ?? []).reduce<Record<string, number>>((acc, e) => {
    acc[e.current_risk_level] = (acc[e.current_risk_level] ?? 0) + 1
    return acc
  }, { green: 0, yellow: 0, red: 0 })

  const complianceTrend = (snapshots ?? []).map((s) => ({
    date: fmt(s.snapshot_date, 'dd MMM', tz),
    adherence: Number(s.medication_adherence),
    responseRate: Number(s.reminder_response_rate),
  }))

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
      value: totalAppts > 0 ? `${apptCompletionRate}%` : '—',
      sub: totalAppts > 0 ? `${confirmedAppts} of ${totalAppts} appointments` : 'No appointments yet',
      icon: CalendarCheck,
      color: totalAppts === 0 ? 'text-muted-foreground' : apptCompletionRate >= 70 ? 'text-success' : 'text-warning',
      bg: totalAppts === 0 ? 'bg-muted' : apptCompletionRate >= 70 ? 'bg-success-soft' : 'bg-warning-soft',
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
          How your patients are doing, since they joined DischargeIQ
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
            <p className="text-xs text-muted-foreground">Medicines taken and check-ins answered, per day</p>
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
            <p className="text-xs text-muted-foreground">Booked, confirmed by the patient, missed</p>
          </CardHeader>
          <CardContent>
            <AppointmentFunnel
              total={totalAppts}
              confirmed={confirmedAppts}
              missed={missedAppts}
              pending={pendingAppts}
            />
          </CardContent>
        </Card>
      </div>

    </div>
  )
}
