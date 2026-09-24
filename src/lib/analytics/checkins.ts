/**
 * Nightly check-in answers, counted the same way on the Home dashboard, the
 * patient page and Analytics.
 *
 * An answer to "did you take your medicines?" is recorded two ways
 * (webhook-handler.ts, log_checkin_meds): "all" and "some" as a
 * reminder_response event, "none" as an escalation for a nurse (intent
 * missed_medication, severity medium) with no reminder_response. Counting
 * reminder_response alone made a patient who honestly answered "none" look
 * as if they had not replied.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { formatInTimeZone } from 'date-fns-tz'

/** The escalation a "none taken" answer is recorded as ("some" is severity low, and also a reminder_response). */
export const NONE_TAKEN = { intent: 'missed_medication', severity: 'medium' } as const

/** all / some / none; null: an answer, but not about medicines (the retired symptom-check reminder). */
export type MedsAnswer = 'all' | 'some' | 'none' | null

interface TimelineRow {
  event_type: string
  payload: Record<string, unknown> | null
}

/** What a timeline event says about a check-in: undefined when it is not an answer to one. */
export function readCheckinAnswer(event: TimelineRow): MedsAnswer | undefined {
  const p = event.payload ?? {}
  if (event.event_type === 'escalation_created') {
    return p.intent === NONE_TAKEN.intent && p.severity === NONE_TAKEN.severity ? 'none' : undefined
  }
  if (event.event_type !== 'reminder_response') return undefined
  if (p.response === 'all' || p.response === 'some') return p.response
  if (p.response === 'symptom_ok') return null
  return 'all' // the per-dose reminders retired on 19 Sep: "TAKEN", "1", 👍 meant the dose was taken
}

/** How many check-ins were answered, in a hospital (or one of its episodes), optionally since a time. */
export async function countCheckinAnswers(
  supabase: SupabaseClient,
  scope: { hospitalId: string; episodeId?: string; since?: string },
): Promise<number> {
  const events = (eventType: string) => {
    let query = supabase
      .from('patient_timeline_events')
      .select('id', { count: 'exact', head: true })
      .eq('hospital_id', scope.hospitalId)
      .eq('event_type', eventType)
    if (scope.episodeId) query = query.eq('episode_id', scope.episodeId)
    if (scope.since) query = query.gte('created_at', scope.since)
    return query
  }
  const [answered, noneTaken] = await Promise.all([
    events('reminder_response'),
    events('escalation_created').eq('payload->>intent', NONE_TAKEN.intent).eq('payload->>severity', NONE_TAKEN.severity),
  ])
  return (answered.count ?? 0) + (noneTaken.count ?? 0)
}

export interface CheckinDay {
  /** Hospital-local date, yyyy-MM-dd */
  day: string
  /** % of that day's check-ins that were answered; null when none went out */
  answered: number | null
  /** % of that day's medicines answers that were "all taken"; null when there were none */
  tookAll: number | null
}

/**
 * One point per day: of the check-ins that went out, how many were answered,
 * and how many of the answers said every medicine was taken. An answer
 * counts on the day its check-in went out, so a reply after midnight to the
 * 21:00 question is not "tomorrow's".
 */
export function checkinTrend(params: {
  sent: Array<{ id: string; fire_at: string }>
  events: Array<TimelineRow & { created_at: string }>
  /** Hospital-local dates, yyyy-MM-dd, oldest first */
  days: string[]
  timezone: string
}): CheckinDay[] {
  const dayOf = (iso: string) => formatInTimeZone(new Date(iso), params.timezone, 'yyyy-MM-dd')
  const jobDay = new Map(params.sent.map((job) => [job.id, dayOf(job.fire_at)]))
  const tally = new Map(params.days.map((day) => [day, { sent: 0, answered: 0, meds: 0, all: 0 }]))

  for (const day of jobDay.values()) {
    const t = tally.get(day)
    if (t) t.sent++
  }
  for (const event of params.events) {
    const meds = readCheckinAnswer(event)
    if (meds === undefined) continue
    const jobId = typeof event.payload?.job_id === 'string' ? event.payload.job_id : null
    const t = tally.get((jobId && jobDay.get(jobId)) || dayOf(event.created_at))
    if (!t) continue
    t.answered++
    if (meds !== null) {
      t.meds++
      if (meds === 'all') t.all++
    }
  }

  const pct = (n: number, of: number) => (of > 0 ? Math.min(100, Math.round((n / of) * 100)) : null)
  return params.days.map((day) => {
    const t = tally.get(day)!
    return { day, answered: pct(t.answered, t.sent), tookAll: pct(t.all, t.meds) }
  })
}
