export type UserRole =
  | 'super_admin'
  | 'hospital_admin'
  | 'discharge_coordinator'
  | 'nurse'
  | 'case_manager'
  | 'read_only'

export type LanguageCode = 'ar' | 'en' | 'hi' | 'ta' | 'tl'

export type EpisodeStatus =
  | 'draft'
  | 'pending_review'
  | 'active'
  | 'completed'
  | 'cancelled'

export type SummaryStatus = 'draft' | 'pending_review' | 'approved' | 'sent'

export type RiskLevel = 'green' | 'yellow' | 'red'

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmation_pending'
  | 'confirmed'
  | 'reschedule_pending'
  | 'rescheduled'
  | 'missed'
  | 'completed'
  | 'cancelled'

export type ReminderType =
  | 'medication'
  | 'exercise'
  | 'hydration'
  | 'symptom_check'
  | 'appointment'

export type JobStatus = 'pending' | 'sent' | 'failed' | 'cancelled'

export type AlertType =
  | 'risk_red'
  | 'risk_yellow'
  | 'escalation'
  | 'missed_appointment'
  | 'unconfirmed_appointment'
  | 'missed_medication'
  | 'delivery_failed'

export type AlertStatus = 'open' | 'acknowledged' | 'resolved'

export type TimelineEventType =
  | 'discharge_uploaded'
  | 'extraction_completed'
  | 'summary_approved'
  | 'summary_sent'
  | 'whatsapp_inbound'
  | 'whatsapp_outbound'
  | 'reminder_sent'
  | 'reminder_response'
  | 'appointment_confirmed'
  | 'appointment_rescheduled'
  | 'triage_completed'
  | 'ai_response'
  | 'escalation_created'
  | 'alert_acknowledged'
  | 'risk_changed'           // a nurse set the patient's colour (migration 00015)

export const SUPPORTED_LANGUAGES: Record<LanguageCode, string> = {
  ar: 'Arabic',
  en: 'English',
  hi: 'Hindi',
  ta: 'Tamil',
  tl: 'Tagalog',
}

export const RISK_LEVEL_COLORS: Record<RiskLevel, string> = {
  green: 'text-green-600 bg-green-50 border-green-200',
  yellow: 'text-yellow-600 bg-yellow-50 border-yellow-200',
  red: 'text-red-600 bg-red-50 border-red-200',
}
