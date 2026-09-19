/**
 * The nightly check-in is the one scheduled message a patient gets per day:
 * at CHECKIN time (hospital-local) the assistant asks whether today's
 * medicines were taken and how they are feeling. It replaced per-dose
 * medication reminders on 2026-09-19 (decision: 21:00 for everyone, no dose
 * reminders, nurse approval stays).
 *
 * Modelled as one reminder_schedules row per episode
 *   type = 'symptom_check', message_template_key = NIGHTLY_CHECKIN_KEY
 * so the existing generator (daily jobs) and dispatcher (every 5 min) run it
 * unchanged, and adherence metrics keep counting reminder_jobs.
 */

export const DEFAULT_CHECKIN_TIME = '21:00'
export const NIGHTLY_CHECKIN_KEY = 'nightly_checkin_v1'

/** Hospital override lives in hospitals.settings.checkin_time ("HH:MM"). */
export function resolveCheckinTime(settings: unknown): string {
  const value = settings && typeof settings === 'object' ? (settings as { checkin_time?: unknown }).checkin_time : undefined
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : DEFAULT_CHECKIN_TIME
}

export function nightlyCheckinSchedule(params: { episodeId: string; hospitalId: string; settings: unknown }) {
  return {
    episode_id: params.episodeId,
    hospital_id: params.hospitalId,
    type: 'symptom_check' as const,
    scheduled_time: resolveCheckinTime(params.settings),
    medication_id: null,
    message_template_key: NIGHTLY_CHECKIN_KEY,
    is_active: true,
  }
}
