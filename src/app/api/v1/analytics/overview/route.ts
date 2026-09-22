/**
 * GET /api/v1/analytics/overview
 *
 * Returns aggregate analytics for the current hospital:
 * - KPIs (active patients, alerts, adherence, completion rates)
 * - 30-day compliance snapshots for trend chart
 * - Risk distribution across all active episodes
 * - Appointment funnel counts
 * - Daily alert + reminder activity (last 14 days)
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveAuthContext, apiSuccess } from '@/lib/utils/api'
import { subDays, format } from 'date-fns'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { profile } = auth
  const hospitalId = profile.hospital_id
  const supabase = await createClient()

  // ── Core counts ────────────────────────────────────────────────────
  const [
    { count: totalPatients },
    { count: activeEpisodes },
    { count: completedEpisodes },
    { count: openAlerts },
    { count: criticalAlerts },
    { count: totalAlerts30d },
    { count: totalReminders },
    { count: reminderResponses },
  ] = await Promise.all([
    supabase.from('patients').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId),
    supabase.from('care_episodes').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).eq('status', 'active'),
    supabase.from('care_episodes').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).eq('status', 'completed'),
    supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).eq('status', 'open'),
    supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).eq('status', 'open').eq('severity', 'critical'),
    supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).gte('created_at', subDays(new Date(), 30).toISOString()),
    supabase.from('reminder_jobs').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId),
    supabase.from('patient_timeline_events').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).eq('event_type', 'reminder_response'),
  ])

  // ── Appointment funnel ─────────────────────────────────────────────
  const { data: apptStats } = await supabase
    .from('appointments')
    .select('status')
    .eq('hospital_id', hospitalId)

  const apptCounts = (apptStats ?? []).reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1
    return acc
  }, {})

  const totalAppts = apptStats?.length ?? 0
  const confirmedAppts = (apptCounts['confirmed'] ?? 0) + (apptCounts['completed'] ?? 0)
  const missedAppts = apptCounts['missed'] ?? 0
  const pendingAppts = apptCounts['confirmation_pending'] ?? 0
  const apptCompletionRate = totalAppts > 0 ? Math.round((confirmedAppts / totalAppts) * 100) : 0

  // ── Risk distribution ──────────────────────────────────────────────
  const { data: riskData } = await supabase
    .from('care_episodes')
    .select('current_risk_level')
    .eq('hospital_id', hospitalId)
    .eq('status', 'active')

  const riskCounts = (riskData ?? []).reduce<Record<string, number>>((acc, e) => {
    acc[e.current_risk_level] = (acc[e.current_risk_level] ?? 0) + 1
    return acc
  }, { green: 0, yellow: 0, red: 0 })

  // ── 30-day compliance trend ────────────────────────────────────────
  const { data: snapshots } = await supabase
    .from('compliance_snapshots')
    .select('snapshot_date, medication_adherence, reminder_response_rate')
    .eq('hospital_id', hospitalId)
    .gte('snapshot_date', format(subDays(new Date(), 30), 'yyyy-MM-dd'))
    .order('snapshot_date', { ascending: true })

  // ── 14-day alert activity ──────────────────────────────────────────
  const { data: alertActivity } = await supabase
    .from('alerts')
    .select('created_at, severity')
    .eq('hospital_id', hospitalId)
    .gte('created_at', subDays(new Date(), 14).toISOString())
    .order('created_at', { ascending: true })

  // Group alerts by day
  const alertByDay: Record<string, { date: string; critical: number; high: number; medium: number; low: number }> = {}
  for (let i = 13; i >= 0; i--) {
    const day = format(subDays(new Date(), i), 'dd MMM')
    alertByDay[day] = { date: day, critical: 0, high: 0, medium: 0, low: 0 }
  }
  for (const a of alertActivity ?? []) {
    const day = format(new Date(a.created_at), 'dd MMM')
    if (alertByDay[day]) {
      alertByDay[day][a.severity as 'critical' | 'high' | 'medium' | 'low'] += 1
    }
  }

  // ── Adherence rate ──────────────────────────────────────────────────
  const totalR = totalReminders ?? 0
  const respondedR = reminderResponses ?? 0
  const adherenceRate = totalR > 0 ? Math.round((respondedR / totalR) * 100) : 0

  // ── Readmissions prevented estimate ────────────────────────────────
  // Industry benchmark: discharge management programs prevent ~15% of readmissions.
  // Average UAE readmission cost ≈ AED 15,000. Conservative estimate.
  const readmissionsPrevented = Math.max(0, Math.round((completedEpisodes ?? 0) * 0.15))
  const estimatedSavingsAED = readmissionsPrevented * 15000

  return NextResponse.json(apiSuccess({
    kpis: {
      totalPatients: totalPatients ?? 0,
      activeEpisodes: activeEpisodes ?? 0,
      completedEpisodes: completedEpisodes ?? 0,
      openAlerts: openAlerts ?? 0,
      criticalAlerts: criticalAlerts ?? 0,
      totalAlerts30d: totalAlerts30d ?? 0,
      adherenceRate,
      apptCompletionRate,
      readmissionsPrevented,
      estimatedSavingsAED,
    },
    appointmentFunnel: {
      total: totalAppts,
      confirmed: confirmedAppts,
      missed: missedAppts,
      pending: pendingAppts,
    },
    riskDistribution: [
      { name: 'Green', value: riskCounts.green, color: '#22c55e' },
      { name: 'Yellow', value: riskCounts.yellow, color: '#eab308' },
      { name: 'Red', value: riskCounts.red, color: '#ef4444' },
    ],
    complianceTrend: (snapshots ?? []).map((s) => ({
      date: format(new Date(s.snapshot_date), 'dd MMM'),
      adherence: Number(s.medication_adherence),
      responseRate: Number(s.reminder_response_rate),
    })),
    alertActivity: Object.values(alertByDay),
  }))
}
