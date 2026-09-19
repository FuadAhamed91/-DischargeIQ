/**
 * Date/time formatting for server-rendered UI.
 *
 * Server components run in the deployment's timezone (UTC on Vercel), so
 * `format(new Date(iso), …)` showed every timestamp four hours early for a
 * Dubai hospital. Always format instants in the hospital's timezone, and
 * format calendar dates (YYYY-MM-DD columns such as discharge_date) as-is,
 * without any timezone shift.
 */

import { format, parseISO } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'

export const DEFAULT_TZ = 'Asia/Dubai'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export function fmt(
  value: string | Date | null | undefined,
  pattern: string,
  tz: string = DEFAULT_TZ,
): string {
  if (!value) return '—'
  if (typeof value === 'string' && DATE_ONLY.test(value)) {
    const [y, m, d] = value.split('-').map(Number)
    return format(new Date(y, m - 1, d), pattern)
  }
  const date = typeof value === 'string' ? parseISO(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return formatInTimeZone(date, tz, pattern)
}

/** Relative "x min ago" style label, safe on the server. */
export function timeAgo(value: string | Date, now: Date = new Date()): string {
  const date = typeof value === 'string' ? parseISO(value) : value
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}
