/**
 * Alerts raised per hour over the last day, for the chart under Needs attention
 * on the Overview. Hours follow the hospital's clock: the last one is the hour
 * we are in, so the chart ends at "now".
 */

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

export interface AlertHour {
  /** Start of the hour, as an ISO instant. */
  start: string
  count: number
  critical: number
}

const HOUR_MS = 60 * 60 * 1000

/** Start of the first hour shown: `hours - 1` whole hours before the start of the current one. */
export function alertHoursStart(now: Date, tz: string, hours = 24): Date {
  const thisHour = fromZonedTime(formatInTimeZone(now, tz, "yyyy-MM-dd'T'HH:00:00"), tz)
  return new Date(thisHour.getTime() - (hours - 1) * HOUR_MS)
}

/** Counts alerts into hourly buckets, oldest hour first; alerts outside the window are ignored. */
export function alertsByHour(
  rows: Array<{ created_at: string; severity: string }>,
  now: Date,
  tz: string,
  hours = 24,
): AlertHour[] {
  const first = alertHoursStart(now, tz, hours).getTime()
  const buckets: AlertHour[] = Array.from({ length: hours }, (_, i) => ({
    start: new Date(first + i * HOUR_MS).toISOString(),
    count: 0,
    critical: 0,
  }))
  for (const row of rows) {
    const i = Math.floor((new Date(row.created_at).getTime() - first) / HOUR_MS)
    if (i < 0 || i >= hours) continue
    buckets[i].count++
    if (row.severity === 'critical') buckets[i].critical++
  }
  return buckets
}
