/**
 * Hand-authored database types until `supabase gen types` is run against the project.
 * Run `npm run gen:types` to regenerate from the live Supabase schema.
 */

import type {
  UserRole,
  LanguageCode,
  EpisodeStatus,
  SummaryStatus,
  RiskLevel,
  AppointmentStatus,
  ReminderType,
  JobStatus,
  AlertType,
  AlertStatus,
  TimelineEventType,
} from './enums'

// ------------------------------------
// Base rows (as stored in PostgreSQL)
// ------------------------------------

export interface Hospital {
  id: string
  name: string
  slug: string
  timezone: string
  whatsapp_phone_number_id: string | null
  scheduling_adapter: 'manual' | 'epic' | 'cerner' | 'custom'
  scheduling_config: Record<string, unknown> | null
  settings: Record<string, unknown>
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Department {
  id: string
  hospital_id: string
  name: string
  created_at: string
}

export interface Profile {
  id: string
  hospital_id: string
  department_id: string | null
  full_name: string
  role: UserRole
  phone: string | null
  avatar_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Patient {
  id: string
  hospital_id: string
  mrn: string
  full_name: string
  phone_e164: string
  preferred_language: LanguageCode
  date_of_birth: string | null
  assigned_nurse_id: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface CareEpisode {
  id: string
  hospital_id: string
  patient_id: string
  status: EpisodeStatus
  discharge_date: string
  assigned_nurse_id: string | null
  current_risk_level: RiskLevel
  compliance_score: number | null
  started_at: string | null
  ended_at: string | null
  created_at: string
  updated_at: string
}

export interface DischargeDocument {
  id: string
  episode_id: string
  hospital_id: string
  storage_path: string
  original_filename: string
  uploaded_by: string
  extraction_status: 'pending' | 'processing' | 'completed' | 'failed'
  raw_extraction: Record<string, unknown> | null
  created_at: string
}

export interface DischargeSummary {
  id: string
  episode_id: string
  hospital_id: string
  version: number
  status: SummaryStatus
  source_language: LanguageCode
  approved_by: string | null
  approved_at: string | null
  nurse_notes: string | null
  emergency_symptoms: string[]
  lifestyle_instructions: string[]
  restrictions: string[]
  activities: string[]
  created_at: string
  updated_at: string
}

export interface DischargeSummaryTranslation {
  id: string
  summary_id: string
  language: LanguageCode
  content: Record<string, unknown>
  created_at: string
}

export interface Medication {
  id: string
  summary_id: string
  hospital_id: string
  name: string
  dosage: string
  frequency: string
  instructions: string | null
  reminder_times: string[]
  sort_order: number
  created_at: string
}

export interface FollowUpRequirement {
  id: string
  summary_id: string
  hospital_id: string
  specialty: string
  deadline: string | null
  instructions: string | null
  created_at: string
}

export interface Appointment {
  id: string
  episode_id: string
  hospital_id: string
  follow_up_id: string | null
  external_id: string | null
  specialty: string
  scheduled_at: string
  location: string | null
  status: AppointmentStatus
  confirmation_requested_at: string | null
  confirmed_at: string | null
  rescheduled_from_id: string | null
  /** Created from a discharge-summary follow-up; scheduled_at is the "by" date until a slot is booked */
  time_tbc: boolean
  created_at: string
  updated_at: string
}

export interface AppointmentSlotsCache {
  id: string
  hospital_id: string
  episode_id: string
  slots: AppointmentSlot[]
  expires_at: string
  created_at: string
}

export interface AppointmentSlot {
  id: string
  datetime: string
  specialty: string
  location?: string
  /** The appointment the patient asked to move (the WhatsApp reschedule flow) */
  appointment_id?: string
}

export interface ReminderSchedule {
  id: string
  episode_id: string
  hospital_id: string
  type: ReminderType
  scheduled_time: string
  medication_id: string | null
  message_template_key: string
  is_active: boolean
  created_at: string
}

export interface ReminderJob {
  id: string
  schedule_id: string
  episode_id: string
  hospital_id: string
  fire_at: string
  status: JobStatus
  whatsapp_message_id: string | null
  created_at: string
}

export interface PatientTimelineEvent {
  id: string
  episode_id: string
  hospital_id: string
  event_type: TimelineEventType
  payload: Record<string, unknown>
  risk_level: RiskLevel | null
  created_by: string | null
  created_at: string
}

export interface WhatsappConversation {
  id: string
  episode_id: string
  hospital_id: string
  patient_id: string
  wa_phone: string
  last_message_at: string | null
  conversation_state: ConversationState
  created_at: string
  updated_at: string
}

/** The FSM owns the list of states (lib/whatsapp/fsm.ts); this is the same type, not a copy that drifts. */
export type ConversationStateName = import('@/lib/whatsapp/fsm').ConversationState

export interface ConversationState {
  state: ConversationStateName
  /** nurse_attending: ISO expiry (`until`) and the nurse (`by`); older rows may carry `context`. */
  until?: string
  by?: string
  context?: Record<string, unknown>
}

/**
 * Per (hospital, sender number): which patient the sender is writing about
 * when the number is linked to more than one open episode (migration 00011).
 */
export interface WhatsappNumberSession {
  hospital_id: string
  wa_phone: string
  active_patient_id: string | null
  active_until: string | null
  pending_choice: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface WhatsappMessage {
  id: string
  conversation_id: string
  hospital_id: string
  direction: 'inbound' | 'outbound'
  message_type: 'text' | 'interactive' | 'audio' | 'template'
  wa_message_id: string | null
  content: string | null
  media_storage_path: string | null
  metadata: Record<string, unknown>
  status: 'sent' | 'delivered' | 'read' | 'failed'
  created_at: string
}

export interface VoiceArtifact {
  id: string
  episode_id: string
  hospital_id: string
  message_id: string
  audio_storage_path: string
  transcript: string | null
  transcript_language: LanguageCode | null
  duration_seconds: number | null
  created_at: string
}

export interface TriageAssessment {
  id: string
  episode_id: string
  hospital_id: string
  voice_artifact_id: string | null
  inbound_text: string | null
  risk_level: RiskLevel
  matched_symptoms: string[]
  reasoning: string | null
  processing_ms: number | null
  model_version: string
  created_at: string
}

export interface Alert {
  id: string
  episode_id: string
  hospital_id: string
  triage_id: string | null
  type: AlertType
  severity: 'low' | 'medium' | 'high' | 'critical'
  status: AlertStatus
  assigned_to: string | null
  acknowledged_by: string | null
  acknowledged_at: string | null
  resolved_at: string | null
  created_at: string
}

export interface AiInteraction {
  id: string
  episode_id: string
  hospital_id: string
  input_type: 'text' | 'voice'
  input_text: string
  output_text: string | null
  confidence: number | null
  escalated: boolean
  model: string
  context_tokens: number | null
  created_at: string
}

export interface Escalation {
  id: string
  episode_id: string
  hospital_id: string
  ai_interaction_id: string | null
  reason: string
  status: 'open' | 'in_progress' | 'closed'
  assigned_to: string
  created_at: string
  updated_at: string
}

export interface ComplianceSnapshot {
  id: string
  episode_id: string
  hospital_id: string
  snapshot_date: string
  medication_adherence: number
  reminder_response_rate: number
  symptom_checks_completed: number
  created_at: string
}

export interface AnalyticsDaily {
  id: string
  hospital_id: string
  metric_date: string
  active_patients: number
  alerts_triggered: number
  appointments_completed: number
  appointments_missed: number
  avg_medication_adherence: number | null
  avg_response_rate: number | null
  readmissions_prevented: number | null
  estimated_savings_aed: number | null
  created_at: string
}

export interface AuditLog {
  id: string
  hospital_id: string | null
  actor_id: string | null
  action: string
  resource_type: string
  resource_id: string | null
  ip_address: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface HospitalApprovedGuidance {
  id: string
  hospital_id: string
  category: string
  question_patterns: string[]
  answer: Record<LanguageCode, string>
  is_active: boolean
  created_at: string
  updated_at: string
}

// ------------------------------------
// Database type (for Supabase client generic)
// ------------------------------------
export type Database = {
  public: {
    Tables: {
      hospitals: { Row: Hospital; Insert: Partial<Hospital>; Update: Partial<Hospital> }
      departments: { Row: Department; Insert: Partial<Department>; Update: Partial<Department> }
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile> }
      patients: { Row: Patient; Insert: Partial<Patient>; Update: Partial<Patient> }
      care_episodes: { Row: CareEpisode; Insert: Partial<CareEpisode>; Update: Partial<CareEpisode> }
      discharge_documents: { Row: DischargeDocument; Insert: Partial<DischargeDocument>; Update: Partial<DischargeDocument> }
      discharge_summaries: { Row: DischargeSummary; Insert: Partial<DischargeSummary>; Update: Partial<DischargeSummary> }
      discharge_summary_translations: { Row: DischargeSummaryTranslation; Insert: Partial<DischargeSummaryTranslation>; Update: Partial<DischargeSummaryTranslation> }
      medications: { Row: Medication; Insert: Partial<Medication>; Update: Partial<Medication> }
      follow_up_requirements: { Row: FollowUpRequirement; Insert: Partial<FollowUpRequirement>; Update: Partial<FollowUpRequirement> }
      appointments: { Row: Appointment; Insert: Partial<Appointment>; Update: Partial<Appointment> }
      appointment_slots_cache: { Row: AppointmentSlotsCache; Insert: Partial<AppointmentSlotsCache>; Update: Partial<AppointmentSlotsCache> }
      reminder_schedules: { Row: ReminderSchedule; Insert: Partial<ReminderSchedule>; Update: Partial<ReminderSchedule> }
      reminder_jobs: { Row: ReminderJob; Insert: Partial<ReminderJob>; Update: Partial<ReminderJob> }
      patient_timeline_events: { Row: PatientTimelineEvent; Insert: Partial<PatientTimelineEvent>; Update: Partial<PatientTimelineEvent> }
      whatsapp_conversations: { Row: WhatsappConversation; Insert: Partial<WhatsappConversation>; Update: Partial<WhatsappConversation> }
      whatsapp_messages: { Row: WhatsappMessage; Insert: Partial<WhatsappMessage>; Update: Partial<WhatsappMessage> }
      whatsapp_number_sessions: { Row: WhatsappNumberSession; Insert: Partial<WhatsappNumberSession>; Update: Partial<WhatsappNumberSession> }
      voice_artifacts: { Row: VoiceArtifact; Insert: Partial<VoiceArtifact>; Update: Partial<VoiceArtifact> }
      triage_assessments: { Row: TriageAssessment; Insert: Partial<TriageAssessment>; Update: Partial<TriageAssessment> }
      alerts: { Row: Alert; Insert: Partial<Alert>; Update: Partial<Alert> }
      ai_interactions: { Row: AiInteraction; Insert: Partial<AiInteraction>; Update: Partial<AiInteraction> }
      escalations: { Row: Escalation; Insert: Partial<Escalation>; Update: Partial<Escalation> }
      compliance_snapshots: { Row: ComplianceSnapshot; Insert: Partial<ComplianceSnapshot>; Update: Partial<ComplianceSnapshot> }
      analytics_daily: { Row: AnalyticsDaily; Insert: Partial<AnalyticsDaily>; Update: Partial<AnalyticsDaily> }
      audit_logs: { Row: AuditLog; Insert: Partial<AuditLog>; Update: Partial<AuditLog> }
      hospital_approved_guidance: { Row: HospitalApprovedGuidance; Insert: Partial<HospitalApprovedGuidance>; Update: Partial<HospitalApprovedGuidance> }
    }
    Functions: {
      get_my_hospital_id: { Args: Record<string, never>; Returns: string }
      get_my_role: { Args: Record<string, never>; Returns: UserRole }
      get_active_episode_by_phone: {
        Args: { p_phone: string; p_phone_number_id: string }
        Returns: { episode_id: string; patient_id: string; hospital_id: string; patient_name: string; language: LanguageCode }[]
      }
    }
    Enums: {
      user_role: UserRole
      language_code: LanguageCode
      episode_status: EpisodeStatus
      summary_status: SummaryStatus
      risk_level: RiskLevel
      appointment_status: AppointmentStatus
      reminder_type: ReminderType
      job_status: JobStatus
      alert_type: AlertType
      alert_status: AlertStatus
    }
  }
}
