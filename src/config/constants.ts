export const APP_NAME = 'CareLoop'
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

export const SUPPORTED_LANGUAGES = ['ar', 'en', 'hi', 'ta', 'tl'] as const

export const DEFAULT_TIMEZONE = 'Asia/Dubai'

/** Appointment escalation thresholds (hours) */
export const APPOINTMENT_REMINDER_HOURS = 24
export const APPOINTMENT_ALERT_HOURS = 48
export const APPOINTMENT_ESCALATION_HOURS = 72

/** Triage processing SLA (milliseconds) */
export const TRIAGE_SLA_MS = 12_000

/** AI confidence threshold below which to escalate */
export const AI_CONFIDENCE_THRESHOLD = 0.75

/** Appointment slot cache TTL (minutes) */
export const SLOT_CACHE_TTL_MINUTES = 30

/** Maximum appointment slots to show patient via WhatsApp */
export const MAX_SLOTS_SHOWN = 10

/** Reminder job generation window (hours ahead) */
export const REMINDER_GENERATION_WINDOW_HOURS = 24

export const WHATSAPP_TEMPLATE_NAMES = {
  DISCHARGE_INTRO: 'discharge_intro',
  APPOINTMENT_CONFIRM: 'appointment_confirm',
  APPOINTMENT_SLOTS: 'appointment_slots',
  REMINDER_MEDICATION: 'reminder_medication',
  REMINDER_EXERCISE: 'reminder_exercise',
  REMINDER_HYDRATION: 'reminder_hydration',
  SYMPTOM_CHECK: 'symptom_check',
  TRIAGE_RED_REASSURANCE: 'triage_red_reassurance',
  NURSE_ESCALATION_NOTICE: 'nurse_escalation_notice',
  NOT_REGISTERED: 'not_registered',
} as const
