export const dynamic = 'force-dynamic'

import { requireSession } from '@/lib/auth/session'
import { fmt } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ComplianceChart, RiskDonut, AlertActivityChart } from '@/components/analytics/lazy-charts'
import { AppointmentFunnel } from '@/components/analytics/appointment-funnel'
import {
  Users, Bell, TrendingUp, DollarSign, CalendarCheck, Activity,
  ShieldCheck, AlertCircle,
} from 'lucide-react'
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
    supabase.from('reminder_jobs').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId),
    supabase.from('patient_timeline_events').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).eq('event_type', 'reminder_response'),
    supabase.from('care_episodes').select('current_risk_level').eq('hospital_id', hospitalId).eq('status', 'active'),
    supabase.from('appointments').select('status').eq('hospital_id', hospitalId),
    supabase.from('compliance_snapshots').select('snapshot_date, medication_adherence, reminder_response_rate').eq('hospital_id', hospitalId).gte('snapshot_date', fmt(subDays(new Date(), 30), 'yyyy-MM-dd', tz)).order('snapshot_date', { ascending: true }),
    supabase.from('alerts').select('created_at, severity').eq('hospital_id', hospitalId).gte('created_at', subDays(new Date(), 14).toISOString()),
  ])

  // ── Compute derived metrics ──────────────────────────────────────────
  const totalR = totalReminders ?? 0
  const respondedR = reminderResponses ?? 0
  const adherenceRate = totalR > 0 ? Math.round((respondedR / totalR) * 100) : 0

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

  const readmissionsPrevented = Math.max(0, Math.round((completedEpisodes ?? 0) * 0.15))
  const estimatedSavingsAED = readmissionsPrevented * 15000

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
    { name: 'Green', value: riskCounts.green ?? 0, color: 'var(--success)' },
    { name: 'Yellow', value: riskCounts.yellow ?? 0, color: 'var(--warning)' },
    { name: 'Red', value: riskCounts.red ?? 0, color: 'var(--danger)' },
  ]

  // ── KPI card data ──────────────────────────────────────────────────
  const kpiCards = [
    {
      label: 'Total Patients',
      value: totalPatients ?? 0,
      sub: `${activeEpisodes ?? 0} currently active`,
      icon: Users,
      color: 'text-brand',
      bg: 'bg-brand-soft',
    },
    {
      label: 'Medication Adherence',
      value: `${adherenceRate}%`,
      sub: `${respondedR} of ${totalR} reminders responded`,
      icon: ShieldCheck,
      color: adherenceRate >= 70 ? 'text-success' : 'text-warning',
      bg: adherenceRate >= 70 ? 'bg-success-soft' : 'bg-warning-soft',
    },
    {
      label: 'Appt Completion',
      value: `${apptCompletionRate}%`,
      sub: `${confirmedAppts} of ${totalAppts} confirmed`,
      icon: CalendarCheck,
      color: apptCompletionRate >= 70 ? 'text-success' : 'text-warning',
      bg: apptCompletionRate >= 70 ? 'bg-success-soft' : 'bg-warning-soft',
    },
    {
      label: 'Open Alerts',
      value: openAlerts ?? 0,
      sub: `${criticalAlerts ?? 0} critical · ${totalAlerts30d ?? 0} in 30 days`,
      icon: Bell,
      color: (criticalAlerts ?? 0) > 0 ? 'text-danger' : 'text-warning',
      bg: (criticalAlerts ?? 0) > 0 ? 'bg-danger-soft' : 'bg-warning-soft',
    },
    {
      label: 'Readmissions Prevented',
      value: readmissionsPrevented,
      sub: 'Estimated (15% of discharged)',
      icon: Activity,
      color: 'text-success',
      bg: 'bg-success-soft',
    },
    {
      label: 'Est. Savings (AED)',
      value: estimatedSavingsAED > 0 ? `${(estimatedSavingsAED / 1000).toFixed(0)}K` : '—',
      sub: 'At AED 15,000 per readmission',
      icon: DollarSign,
      color: 'text-success',
      bg: 'bg-success-soft',
    },
    {
      label: 'Active Risk Alerts',
      value: (riskCounts.red ?? 0) + (riskCounts.yellow ?? 0),
      sub: `${riskCounts.red ?? 0} red · ${riskCounts.yellow ?? 0} yellow`,
      icon: AlertCircle,
      color: (riskCounts.red ?? 0) > 0 ? 'text-danger' : 'text-warning',
      bg: (riskCounts.red ?? 0) > 0 ? 'bg-danger-soft' : 'bg-warning-soft',
    },
    {
      label: 'Completed Episodes',
      value: completedEpisodes ?? 0,
      sub: 'Fully discharged patients',
      icon: TrendingUp,
      color: 'text-brand',
      bg: 'bg-brand-soft',
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Hospital performance metrics and patient outcome insights
        </p>
      </div>

      {/* Period badge */}
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs">All time</Badge>
        <Badge variant="secondary" className="text-xs">30-day trend</Badge>
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
            <CardTitle className="text-base">30-Day Compliance Trend</CardTitle>
            <p className="text-xs text-muted-foreground">Medication adherence and reminder response rates over time</p>
          </CardHeader>
          <CardContent>
            <ComplianceChart data={complianceTrend} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Patient Risk Distribution</CardTitle>
            <p className="text-xs text-muted-foreground">Current risk levels across active episodes</p>
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
            <CardTitle className="text-base">Alert Activity (14 days)</CardTitle>
            <p className="text-xs text-muted-foreground">Stacked by severity — critical, high, medium, low</p>
          </CardHeader>
          <CardContent>
            <AlertActivityChart data={Object.values(alertByDay)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Appointment Funnel</CardTitle>
            <p className="text-xs text-muted-foreground">Scheduled → confirmed → missed</p>
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

      {/* Business value callout */}
      {readmissionsPrevented > 0 && (
        <Card className="border-success/30 bg-success-soft/50">
          <CardContent className="py-5">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-success-soft rounded-xl" aria-hidden="true">
                <DollarSign className="w-6 h-6 text-success" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Estimated value delivered</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  DischargeIQ has helped prevent an estimated <strong>{readmissionsPrevented} readmission{readmissionsPrevented > 1 ? 's' : ''}</strong>,
                  saving approximately <strong>AED {estimatedSavingsAED.toLocaleString()}</strong> in avoided hospital costs.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
