/**
 * Reminder job generator.
 *
 * Runs daily (via cron) to materialise the next 24 hours of reminder_jobs
 * from active reminder_schedules. Idempotent — uses ON CONFLICT DO NOTHING.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { toZonedTime } from 'date-fns-tz'

interface GenerateResult {
  generated: number
  skipped: number
  errors: string[]
}

/**
 * For each active hospital, materialise reminder_jobs for the next 24 hours.
 */
export async function generateNextDayJobs(): Promise<GenerateResult> {
  const supabase = createServiceClient()
  const result: GenerateResult = { generated: 0, skipped: 0, errors: [] }

  // Load all active hospitals
  const { data: hospitals, error: hErr } = await supabase
    .from('hospitals')
    .select('id, timezone')
    .eq('is_active', true)

  if (hErr || !hospitals) {
    result.errors.push(`Failed to load hospitals: ${hErr?.message}`)
    return result
  }

  for (const hospital of hospitals) {
    const tz = hospital.timezone ?? 'UTC'

    // Load all active reminder_schedules for this hospital's active episodes
    const { data: schedules, error: sErr } = await supabase
      .from('reminder_schedules')
      .select(`
        id,
        episode_id,
        hospital_id,
        type,
        scheduled_time,
        medication_id,
        message_template_key,
        care_episodes!inner(status)
      `)
      .eq('hospital_id', hospital.id)
      .eq('is_active', true)
      .in('care_episodes.status', ['active'])

    if (sErr) {
      result.errors.push(`Hospital ${hospital.id}: ${sErr.message}`)
      continue
    }
    if (!schedules || schedules.length === 0) continue

    const nowUtc = new Date()
    const tomorrowUtc = new Date(nowUtc.getTime() + 24 * 60 * 60 * 1000)

    const jobs = schedules.map((schedule) => {
      // Build a UTC fire_at by combining today's date (in hospital TZ) with the scheduled_time
      const localNow = toZonedTime(nowUtc, tz)
      const [hour, minute] = (schedule.scheduled_time as string).split(':').map(Number)

      // Create fire time today in local TZ
      const localFireDate = new Date(localNow)
      localFireDate.setHours(hour, minute, 0, 0)

      // Convert back to UTC
      const fireAtUtc = new Date(
        localFireDate.getTime() - getTimezoneOffsetMs(tz, localFireDate),
      )

      // If the fire time has already passed today, schedule for tomorrow
      if (fireAtUtc <= nowUtc) {
        fireAtUtc.setDate(fireAtUtc.getDate() + 1)
      }

      // Only generate if within the next 24h window
      if (fireAtUtc > tomorrowUtc) return null

      return {
        schedule_id: schedule.id,
        episode_id: schedule.episode_id,
        hospital_id: schedule.hospital_id,
        fire_at: fireAtUtc.toISOString(),
        status: 'pending' as const,
      }
    }).filter(Boolean)

    if (jobs.length === 0) continue

    // Batch insert — ON CONFLICT on (schedule_id, fire_at) ensures idempotency
    const { error: iErr, count } = await supabase
      .from('reminder_jobs')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(jobs as any[], { onConflict: 'schedule_id,fire_at', ignoreDuplicates: true })
      .select('id', { count: 'exact', head: true })

    if (iErr) {
      result.errors.push(`Hospital ${hospital.id} insert: ${iErr.message}`)
    } else {
      result.generated += count ?? 0
    }
  }

  return result
}

/**
 * Utility: get timezone offset in milliseconds for a given date and IANA tz.
 * This is a simplified implementation — in production use `date-fns-tz` `getTimezoneOffset`.
 */
function getTimezoneOffsetMs(tz: string, date: Date): number {
  try {
    const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' })
    const localStr = date.toLocaleString('en-US', { timeZone: tz })
    const utcDate = new Date(utcStr)
    const localDate = new Date(localStr)
    return localDate.getTime() - utcDate.getTime()
  } catch {
    return 0
  }
}
