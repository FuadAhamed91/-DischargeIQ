/**
 * GET  /api/v1/episodes/[id]/compliance
 *
 * Computes (and caches in care_episodes.compliance_score) a 0–100 compliance score.
 *
 * Score formula:
 *   60% weight — medication/reminder adherence  (reminder_jobs sent → responded)
 *   30% weight — risk stability                 (% days with no RED triage)
 *   10% weight — appointment completion         (confirmed / scheduled)
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveAuthContext, apiSuccess, apiError } from '@/lib/utils/api'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { profile } = auth
  const { id: episodeId } = await params
  const supabase = await createClient()

  // Verify episode belongs to this hospital
  const { data: episode, error: epErr } = await supabase
    .from('care_episodes')
    .select('id, hospital_id, discharge_date, compliance_score')
    .eq('id', episodeId)
    .eq('hospital_id', profile.hospital_id)
    .single()

  if (epErr || !episode) {
    return NextResponse.json(apiError('Episode not found'), { status: 404 })
  }

  // ── Reminder adherence (60%) ──────────────────────────────────────────
  const { data: reminderJobs } = await supabase
    .from('reminder_jobs')
    .select('status')
    .eq('episode_id', episodeId)

  const totalJobs = reminderJobs?.length ?? 0

  // Count positive reminder responses from timeline
  const { count: positiveResponses } = await supabase
    .from('patient_timeline_events')
    .select('*', { count: 'exact', head: true })
    .eq('episode_id', episodeId)
    .eq('event_type', 'reminder_response')

  const reminderScore = totalJobs > 0
    ? Math.min(100, ((positiveResponses ?? 0) / totalJobs) * 100)
    : 50  // neutral if no reminders yet

  // ── Risk stability (30%) ──────────────────────────────────────────────
  const { data: triages } = await supabase
    .from('triage_assessments')
    .select('risk_level, created_at')
    .eq('episode_id', episodeId)
    .order('created_at', { ascending: false })

  const totalTriages = triages?.length ?? 0
  const redTriages = triages?.filter((t) => t.risk_level === 'red').length ?? 0
  const riskScore = totalTriages > 0
    ? Math.max(0, ((totalTriages - redTriages) / totalTriages) * 100)
    : 80  // assume stable if no triage events yet

  // ── Appointment completion (10%) ──────────────────────────────────────
  const { data: appointments } = await supabase
    .from('appointments')
    .select('status')
    .eq('episode_id', episodeId)

  const totalAppts = appointments?.length ?? 0
  const completedAppts = appointments?.filter(
    (a) => a.status === 'confirmed' || a.status === 'completed',
  ).length ?? 0
  const apptScore = totalAppts > 0
    ? (completedAppts / totalAppts) * 100
    : 80  // neutral if no appointments yet

  // ── Final weighted score ──────────────────────────────────────────────
  const finalScore = Math.round(
    reminderScore * 0.6 +
    riskScore     * 0.3 +
    apptScore     * 0.1,
  )

  // Cache the score on the episode
  await supabase
    .from('care_episodes')
    .update({ compliance_score: finalScore })
    .eq('id', episodeId)

  // Save a daily snapshot
  const today = new Date().toISOString().slice(0, 10)
  await supabase
    .from('compliance_snapshots')
    .upsert({
      episode_id: episodeId,
      hospital_id: profile.hospital_id,
      snapshot_date: today,
      medication_adherence: Math.round(reminderScore),
      reminder_response_rate: Math.round(reminderScore),
      symptom_checks_completed: totalTriages,
    }, { onConflict: 'episode_id,snapshot_date' })

  return NextResponse.json(apiSuccess({
    score: finalScore,
    breakdown: {
      reminderAdherence: Math.round(reminderScore),
      riskStability: Math.round(riskScore),
      appointmentCompletion: Math.round(apptScore),
    },
    meta: {
      totalReminderJobs: totalJobs,
      positiveReminderResponses: positiveResponses ?? 0,
      totalTriages,
      redTriages,
      totalAppointments: totalAppts,
      completedAppointments: completedAppts,
    },
  }))
}
