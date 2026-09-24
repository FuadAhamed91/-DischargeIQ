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

/**
 * A WhatsApp number as people write it: +1 415 523 8886, +971 50 526 3427.
 * Other countries' numbers are returned as stored.
 */
export function formatPhone(e164: string): string {
  const d = e164.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) return `+1 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`
  if (d.length === 12 && d.startsWith('971')) return `+971 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`
  return e164
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
