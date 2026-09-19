/**
 * Follow-up requirements ("Cardiology clinic by 3 Oct") become provisional
 * appointments the moment a discharge summary is read, so the Appointments
 * screen shows what the letter asked for without anyone re-typing it.
 *
 * A provisional appointment is `time_tbc = true`: scheduled_at is the letter's
 * "by" date at 09:00 hospital-local until a nurse books the real slot (the
 * appointment PATCH clears the flag). Follow-ups are deleted and re-inserted
 * whenever the summary is re-extracted or edited in review, so rows are
 * matched by (specialty, deadline) rather than by id.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fromZonedTime } from 'date-fns-tz'

export const TBC_LOCAL_TIME = '09:00'

interface FollowUpRow {
  id: string
  specialty: string
  deadline: string | null
}

interface ProvisionalRow {
  id: string
  follow_up_id: string | null
  specialty: string
  scheduled_at: string
}

export interface SyncResult {
  created: number
  relinked: number
  removed: number
  undated: number
}

const key = (specialty: string, deadline: string) => `${specialty.trim().toLowerCase()}|${deadline}`

/** The "by" date as an instant: 09:00 on that day in the hospital's timezone. */
export function tbcInstant(deadline: string, timezone: string): string {
  return fromZonedTime(`${deadline}T${TBC_LOCAL_TIME}:00`, timezone).toISOString()
}

export async function syncFollowUpAppointments(params: {
  serviceClient: SupabaseClient
  episodeId: string
  hospitalId: string
  summaryId: string
  timezone: string
}): Promise<SyncResult> {
  const { serviceClient, episodeId, hospitalId, summaryId, timezone } = params
  const result: SyncResult = { created: 0, relinked: 0, removed: 0, undated: 0 }

  const [{ data: followUps }, { data: provisional }] = await Promise.all([
    serviceClient.from('follow_up_requirements').select('id, specialty, deadline').eq('summary_id', summaryId),
    // Only untouched provisional rows are ours to move or remove; anything a
    // nurse has booked, confirmed or cancelled stays exactly as it is.
    serviceClient.from('appointments').select('id, follow_up_id, specialty, scheduled_at')
      .eq('episode_id', episodeId).eq('time_tbc', true).eq('status', 'scheduled'),
  ])

  const wanted = new Map<string, FollowUpRow>()
  for (const f of (followUps ?? []) as FollowUpRow[]) {
    if (!f.deadline) { result.undated++; continue }
    wanted.set(key(f.specialty, f.deadline), f)
  }

  const existing = new Map<string, ProvisionalRow>()
  for (const a of (provisional ?? []) as ProvisionalRow[]) {
    // scheduled_at was built from a deadline; recover the local date to match on
    const local = new Date(a.scheduled_at)
    const deadline = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(local)
    existing.set(key(a.specialty, deadline), a)
  }

  const toInsert: Array<Record<string, unknown>> = []
  for (const [k, f] of wanted) {
    const match = existing.get(k)
    if (match) {
      existing.delete(k)
      if (match.follow_up_id !== f.id) {
        await serviceClient.from('appointments').update({ follow_up_id: f.id, updated_at: new Date().toISOString() }).eq('id', match.id)
        result.relinked++
      }
      continue
    }
    toInsert.push({
      episode_id: episodeId,
      hospital_id: hospitalId,
      follow_up_id: f.id,
      specialty: f.specialty.trim(),
      scheduled_at: tbcInstant(f.deadline!, timezone),
      status: 'scheduled',
      time_tbc: true,
    })
  }

  if (toInsert.length > 0) {
    const { error } = await serviceClient.from('appointments').insert(toInsert)
    if (error) throw new Error(`Failed to create follow-up appointments: ${error.message}`)
    result.created = toInsert.length
  }

  // Provisional rows whose follow-up no longer exists (nurse removed or changed it)
  const stale = [...existing.values()].map((a) => a.id)
  if (stale.length > 0) {
    await serviceClient.from('appointments').delete().in('id', stale)
    result.removed = stale.length
  }

  return result
}
