/**
 * Where the hospital's appointments stand, for Analytics.
 *
 * A follow-up read from a discharge letter starts as a provisional row
 * (time_tbc: the letter's "by" date, no time yet — lib/appointments/
 * sync-follow-ups.ts). Nobody can confirm it until a nurse books a time, so
 * it is counted apart ("to book") rather than dragging the confirmed rate
 * down. Cancelled rows, and the old 'rescheduled' ones, are left out.
 */

export interface AppointmentBreakdown {
  /** Booked with a real time: the base for the rates */
  booked: number
  /** Confirmed (or attended) by the patient */
  confirmed: number
  /** Asked, and not answered yet — or the patient is choosing a new time */
  waiting: number
  /** Booked, but the patient has not been asked yet */
  notAsked: number
  missed: number
  /** From a discharge letter, still without a time */
  toBook: number
  /** confirmed / booked, %; null when nothing is booked */
  confirmedRate: number | null
}

export function appointmentBreakdown(rows: Array<{ status: string; time_tbc: boolean | null }>): AppointmentBreakdown {
  const b = { booked: 0, confirmed: 0, waiting: 0, notAsked: 0, missed: 0, toBook: 0 }
  for (const row of rows) {
    if (row.status === 'cancelled' || row.status === 'rescheduled') continue
    if (row.time_tbc) {
      b.toBook++
      continue
    }
    b.booked++
    if (row.status === 'confirmed' || row.status === 'completed') b.confirmed++
    else if (row.status === 'confirmation_pending' || row.status === 'reschedule_pending') b.waiting++
    else if (row.status === 'missed') b.missed++
    else b.notAsked++
  }
  return { ...b, confirmedRate: b.booked > 0 ? Math.round((b.confirmed / b.booked) * 100) : null }
}
