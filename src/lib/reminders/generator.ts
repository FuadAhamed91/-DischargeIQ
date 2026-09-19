/**
 * Reminder job generator.
 *
 * Runs daily (via cron) to materialise the next 24 hours of reminder_jobs
 * from active reminder_schedules. Idempotent — uses ON CONFLICT DO NOTHING.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { addDays } from 'date-fns'

interface GenerateResult {
  generated: number
  skipped: number
  errors: string[]
}

/**
 * For each active hospital, materialise reminder_jobs for the next 24 hours.
 */
export async function generateNextDayJobs(): Promise<GenerateResult> {
  const supabase = await createServiceClient()
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

    // The hospital's current and next calendar dates, as wall-clock dates in its timezone.
    // Combining a wall-clock date + scheduled_time with fromZonedTime() yields the correct
    // UTC instant regardless of the server's own timezone (the previous toZonedTime +
    // setHours approach was only right on UTC machines and fired 4h early on a Dubai one).
    const todayLocal = formatInTimeZone(nowUtc, tz, 'yyyy-MM-dd')
    const tomorrowLocal = formatInTimeZone(addDays(nowUtc, 1), tz, 'yyyy-MM-dd')

    const jobs = schedules.map((schedule) => {
      const time = (schedule.scheduled_time as string).slice(0, 5) // 'HH:MM' from 'HH:MM:SS'

      // Next occurrence of this schedule: today in the hospital's tz, or tomorrow if already passed
      let fireAtUtc = fromZonedTime(`${todayLocal}T${time}:00`, tz)
      if (fireAtUtc <= nowUtc) {
        fireAtUtc = fromZonedTime(`${tomorrowLocal}T${time}:00`, tz)
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
    const { error: iErr, data: inserted } = await supabase
      .from('reminder_jobs')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(jobs as any[], { onConflict: 'schedule_id,fire_at', ignoreDuplicates: true })
      .select('id')

    if (iErr) {
      result.errors.push(`Hospital ${hospital.id} insert: ${iErr.message}`)
    } else {
      result.generated += inserted?.length ?? 0
    }
  }

  return result
}
