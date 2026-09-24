/**
 * Checks for what the dashboard counts:
 *   - lib/analytics/checkins.ts       a check-in answer ("none taken" included), per-day trend, counts
 *   - lib/analytics/appointments.ts   booked vs still-to-book appointments, the confirmed rate
 *
 * No network or API keys needed. Run with:  npm run check:analytics
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { FakeDb } from './lib/fake-supabase'
import { readCheckinAnswer, checkinTrend, countCheckinAnswers } from '@/lib/analytics/checkins'
import { appointmentBreakdown } from '@/lib/analytics/appointments'

let fails = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`)
}

const TZ = 'Asia/Dubai'
const answer = (response: string, extra: Record<string, unknown> = {}) => ({ event_type: 'reminder_response', payload: { response, ...extra } })
const noneTaken = (extra: Record<string, unknown> = {}) => ({ event_type: 'escalation_created', payload: { intent: 'missed_medication', severity: 'medium', ...extra } })

async function main() {
  console.log('— what counts as an answer —')
  eq('"all"', readCheckinAnswer(answer('all', { source: 'nightly_checkin' })), 'all')
  eq('"some"', readCheckinAnswer(answer('some', { source: 'nightly_checkin' })), 'some')
  eq('"none" is an escalation, and an answer', readCheckinAnswer(noneTaken()), 'none')
  eq('"some" also raises a low escalation: not counted twice', readCheckinAnswer({ event_type: 'escalation_created', payload: { intent: 'missed_medication', severity: 'low' } }), undefined)
  eq('an unrelated escalation is not an answer', readCheckinAnswer({ event_type: 'escalation_created', payload: { intent: 'emergency' } }), undefined)
  eq('old per-dose reminder "TAKEN": taken', readCheckinAnswer(answer('TAKEN')), 'all')
  eq('old symptom check: an answer, not about medicines', readCheckinAnswer(answer('symptom_ok')), null)

  console.log('— the 30-day trend —')
  // Three nights in Dubai: 22 Sep (3 check-ins), 23 Sep (1), 24 Sep (none sent).
  const days = ['2026-09-22', '2026-09-23', '2026-09-24']
  const sent = [
    { id: 'j1', fire_at: '2026-09-22T17:00:00Z' },   // 21:00 Dubai
    { id: 'j2', fire_at: '2026-09-22T17:00:00Z' },
    { id: 'j3', fire_at: '2026-09-22T17:00:00Z' },
    { id: 'j4', fire_at: '2026-09-23T17:00:00Z' },
  ]
  const events = [
    { ...answer('all', { job_id: 'j1' }), created_at: '2026-09-22T17:05:00Z' },
    { ...noneTaken({ job_id: 'j2' }), created_at: '2026-09-22T17:06:00Z' },
    // j3 answered "some" at 00:30 Dubai the next day: still the 22nd's check-in
    { ...answer('some', { job_id: 'j3' }), created_at: '2026-09-22T20:30:00Z' },
    { event_type: 'escalation_created', payload: { intent: 'missed_medication', severity: 'low', job_id: 'j3' }, created_at: '2026-09-22T20:30:00Z' },
    { event_type: 'escalation_created', payload: { intent: 'emergency' }, created_at: '2026-09-23T10:00:00Z' },
  ]
  eq('per day: answered % of those sent; "all" % of the medicines answers; gaps where nothing was sent', checkinTrend({ sent, events, days, timezone: TZ }), [
    { day: '2026-09-22', answered: 100, tookAll: 33 },
    { day: '2026-09-23', answered: 0, tookAll: null },
    { day: '2026-09-24', answered: null, tookAll: null },
  ])

  console.log('— counting answers (as the pages do) —')
  const db = new FakeDb({
    patient_timeline_events: [
      { hospital_id: 'h1', episode_id: 'e1', event_type: 'reminder_response', payload: { response: 'all' }, created_at: '2026-09-20T17:05:00Z' },
      { hospital_id: 'h1', episode_id: 'e1', event_type: 'escalation_created', payload: { intent: 'missed_medication', severity: 'medium' }, created_at: '2026-09-23T17:05:00Z' },
      { hospital_id: 'h1', episode_id: 'e2', event_type: 'reminder_response', payload: { response: 'some' }, created_at: '2026-09-23T17:05:00Z' },
      { hospital_id: 'h1', episode_id: 'e2', event_type: 'escalation_created', payload: { intent: 'missed_medication', severity: 'low' }, created_at: '2026-09-23T17:05:00Z' },
      { hospital_id: 'h1', episode_id: 'e2', event_type: 'escalation_created', payload: { intent: 'emergency' }, created_at: '2026-09-23T18:00:00Z' },
      { hospital_id: 'h2', episode_id: 'e9', event_type: 'reminder_response', payload: { response: 'all' }, created_at: '2026-09-23T17:05:00Z' },
    ],
  })
  const client = db as unknown as SupabaseClient
  eq('hospital: all, none and some — three answers', await countCheckinAnswers(client, { hospitalId: 'h1' }), 3)
  eq('one patient: all and none', await countCheckinAnswers(client, { hospitalId: 'h1', episodeId: 'e1' }), 2)
  eq('since a time', await countCheckinAnswers(client, { hospitalId: 'h1', since: '2026-09-22T00:00:00Z' }), 2)

  console.log('— appointments —')
  // Today's demo hospital: three follow-ups from letters without a time, two waiting, two confirmed, one missed.
  const live = [
    ...Array.from({ length: 3 }, () => ({ status: 'scheduled', time_tbc: true })),
    { status: 'confirmation_pending', time_tbc: false }, { status: 'confirmation_pending', time_tbc: false },
    { status: 'confirmed', time_tbc: false }, { status: 'confirmed', time_tbc: false },
    { status: 'missed', time_tbc: false },
  ]
  eq('letters still to book are kept out of the rate', appointmentBreakdown(live), { booked: 5, confirmed: 2, waiting: 2, notAsked: 0, missed: 1, toBook: 3, confirmedRate: 40 })
  const b = appointmentBreakdown([
    { status: 'scheduled', time_tbc: false }, { status: 'reschedule_pending', time_tbc: false }, { status: 'completed', time_tbc: false },
    { status: 'cancelled', time_tbc: false }, { status: 'rescheduled', time_tbc: false }, { status: 'cancelled', time_tbc: true },
  ])
  eq('not asked yet, choosing a new time, attended; cancelled left out', b, { booked: 3, confirmed: 1, waiting: 1, notAsked: 1, missed: 0, toBook: 0, confirmedRate: 33 })
  eq('the rows add up to the booked total', b.confirmed + b.waiting + b.notAsked + b.missed, b.booked)
  eq('nothing booked: no rate', appointmentBreakdown([{ status: 'scheduled', time_tbc: true }]).confirmedRate, null)

  console.log(fails === 0 ? '\nALL PASSED' : `\n${fails} FAILED`)
  process.exit(fails ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
