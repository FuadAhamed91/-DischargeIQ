-- ============================================================
-- CareLoop — Migration 00001: Initial Schema
-- ============================================================

-- ------------------------------------
-- EXTENSIONS
-- ------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------
-- ENUM TYPES
-- ------------------------------------
CREATE TYPE user_role AS ENUM (
  'super_admin',
  'hospital_admin',
  'discharge_coordinator',
  'nurse',
  'case_manager',
  'read_only'
);

CREATE TYPE language_code AS ENUM ('ar', 'en', 'hi', 'ta', 'tl');

CREATE TYPE episode_status AS ENUM (
  'draft',
  'pending_review',
  'active',
  'completed',
  'cancelled'
);

CREATE TYPE summary_status AS ENUM (
  'draft',
  'pending_review',
  'approved',
  'sent'
);

CREATE TYPE risk_level AS ENUM ('green', 'yellow', 'red');

CREATE TYPE appointment_status AS ENUM (
  'scheduled',
  'confirmation_pending',
  'confirmed',
  'reschedule_pending',
  'rescheduled',
  'missed',
  'completed',
  'cancelled'
);

CREATE TYPE reminder_type AS ENUM (
  'medication',
  'exercise',
  'hydration',
  'symptom_check',
  'appointment'
);

CREATE TYPE job_status AS ENUM ('pending', 'sent', 'failed', 'cancelled');

CREATE TYPE alert_type AS ENUM (
  'risk_red',
  'risk_yellow',
  'escalation',
  'missed_appointment',
  'unconfirmed_appointment'
);

CREATE TYPE alert_status AS ENUM ('open', 'acknowledged', 'resolved');

CREATE TYPE timeline_event_type AS ENUM (
  'discharge_uploaded',
  'extraction_completed',
  'summary_approved',
  'summary_sent',
  'whatsapp_inbound',
  'whatsapp_outbound',
  'reminder_sent',
  'reminder_response',
  'appointment_confirmed',
  'appointment_rescheduled',
  'triage_completed',
  'ai_response',
  'escalation_created',
  'alert_acknowledged'
);

-- ------------------------------------
-- HOSPITALS
-- ------------------------------------
CREATE TABLE hospitals (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                       text NOT NULL,
  slug                       text NOT NULL UNIQUE,
  timezone                   text NOT NULL DEFAULT 'Asia/Dubai',
  whatsapp_phone_number_id   text,
  scheduling_adapter         text NOT NULL DEFAULT 'manual'
                               CHECK (scheduling_adapter IN ('manual', 'epic', 'cerner', 'custom')),
  scheduling_config          jsonb,
  settings                   jsonb NOT NULL DEFAULT '{}',
  is_active                  boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------
-- DEPARTMENTS
-- ------------------------------------
CREATE TABLE departments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id  uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  name         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------
-- PROFILES (extends auth.users)
-- ------------------------------------
CREATE TABLE profiles (
  id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  hospital_id    uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  department_id  uuid REFERENCES departments(id) ON DELETE SET NULL,
  full_name      text NOT NULL,
  role           user_role NOT NULL DEFAULT 'nurse',
  phone          text,
  avatar_url     text,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------
-- PATIENTS
-- ------------------------------------
CREATE TABLE patients (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id          uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  mrn                  text NOT NULL,
  full_name            text NOT NULL,
  phone_e164           text NOT NULL,
  preferred_language   language_code NOT NULL DEFAULT 'en',
  date_of_birth        date,
  assigned_nurse_id    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  metadata             jsonb NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, mrn)
);

CREATE INDEX idx_patients_hospital_phone ON patients (hospital_id, phone_e164);

-- ------------------------------------
-- CARE EPISODES
-- ------------------------------------
CREATE TABLE care_episodes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id        uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  patient_id         uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  status             episode_status NOT NULL DEFAULT 'draft',
  discharge_date     date NOT NULL,
  assigned_nurse_id  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  current_risk_level risk_level NOT NULL DEFAULT 'green',
  compliance_score   numeric(5,2),
  started_at         timestamptz,
  ended_at           timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_episodes_hospital_status    ON care_episodes (hospital_id, status);
CREATE INDEX idx_episodes_nurse_status       ON care_episodes (assigned_nurse_id, status);
CREATE INDEX idx_episodes_patient            ON care_episodes (patient_id);

-- One active episode per patient per hospital
CREATE UNIQUE INDEX idx_episodes_one_active
  ON care_episodes (hospital_id, patient_id)
  WHERE status = 'active';

-- ------------------------------------
-- DISCHARGE DOCUMENTS
-- ------------------------------------
CREATE TABLE discharge_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id          uuid NOT NULL REFERENCES care_episodes(id) ON DELETE CASCADE,
  hospital_id         uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  storage_path        text NOT NULL,
  original_filename   text NOT NULL,
  uploaded_by         uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  extraction_status   text NOT NULL DEFAULT 'pending'
                        CHECK (extraction_status IN ('pending', 'processing', 'completed', 'failed')),
  raw_extraction      jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------
-- DISCHARGE SUMMARIES
-- ------------------------------------
CREATE TABLE discharge_summaries (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id              uuid NOT NULL UNIQUE REFERENCES care_episodes(id) ON DELETE CASCADE,
  hospital_id             uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  version                 int NOT NULL DEFAULT 1,
  status                  summary_status NOT NULL DEFAULT 'draft',
  source_language         language_code NOT NULL DEFAULT 'en',
  approved_by             uuid REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at             timestamptz,
  nurse_notes             text,
  emergency_symptoms      jsonb NOT NULL DEFAULT '[]',
  lifestyle_instructions  jsonb NOT NULL DEFAULT '[]',
  restrictions            jsonb NOT NULL DEFAULT '[]',
  activities              jsonb NOT NULL DEFAULT '[]',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------
-- DISCHARGE SUMMARY TRANSLATIONS
-- ------------------------------------
CREATE TABLE discharge_summary_translations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_id  uuid NOT NULL REFERENCES discharge_summaries(id) ON DELETE CASCADE,
  language    language_code NOT NULL,
  content     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (summary_id, language)
);

-- ------------------------------------
-- MEDICATIONS
-- ------------------------------------
CREATE TABLE medications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_id     uuid NOT NULL REFERENCES discharge_summaries(id) ON DELETE CASCADE,
  hospital_id    uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  name           text NOT NULL,
  dosage         text NOT NULL,
  frequency      text NOT NULL,
  instructions   text,
  reminder_times time[] NOT NULL DEFAULT '{}',
  sort_order     int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------
-- FOLLOW-UP REQUIREMENTS
-- ------------------------------------
CREATE TABLE follow_up_requirements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_id   uuid NOT NULL REFERENCES discharge_summaries(id) ON DELETE CASCADE,
  hospital_id  uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  specialty    text NOT NULL,
  deadline     date,
  instructions text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------
-- APPOINTMENTS
-- ------------------------------------
CREATE TABLE appointments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id                  uuid NOT NULL REFERENCES care_episodes(id) ON DELETE CASCADE,
  hospital_id                 uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  follow_up_id                uuid REFERENCES follow_up_requirements(id) ON DELETE SET NULL,
  external_id                 text,
  specialty                   text NOT NULL,
  scheduled_at                timestamptz NOT NULL,
  location                    text,
  status                      appointment_status NOT NULL DEFAULT 'scheduled',
  confirmation_requested_at   timestamptz,
  confirmed_at                timestamptz,
  rescheduled_from_id         uuid REFERENCES appointments(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_appointments_episode ON appointments (episode_id, scheduled_at);
CREATE INDEX idx_appointments_status  ON appointments (hospital_id, status);

-- ------------------------------------
-- APPOINTMENT SLOTS CACHE
-- ------------------------------------
CREATE TABLE appointment_slots_cache (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id  uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  episode_id   uuid NOT NULL REFERENCES care_episodes(id) ON DELETE CASCADE,
  slots        jsonb NOT NULL DEFAULT '[]',
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------
-- REMINDER SCHEDULES
-- ------------------------------------
CREATE TABLE reminder_schedules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id            uuid NOT NULL REFERENCES care_episodes(id) ON DELETE CASCADE,
  hospital_id           uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  type                  reminder_type NOT NULL,
  scheduled_time        time NOT NULL,
  medication_id         uuid REFERENCES medications(id) ON DELETE SET NULL,
  message_template_key  text NOT NULL,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------
-- REMINDER JOBS
-- ------------------------------------
CREATE TABLE reminder_jobs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id          uuid NOT NULL REFERENCES reminder_schedules(id) ON DELETE CASCADE,
  episode_id           uuid NOT NULL REFERENCES care_episodes(id) ON DELETE CASCADE,
  hospital_id          uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  fire_at              timestamptz NOT NULL,
  status               job_status NOT NULL DEFAULT 'pending',
  whatsapp_message_id  text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reminder_jobs_fire_at
  ON reminder_jobs (fire_at, status)
  WHERE status = 'pending';

-- ------------------------------------
-- PATIENT TIMELINE EVENTS
-- ------------------------------------
CREATE TABLE patient_timeline_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id   uuid NOT NULL REFERENCES care_episodes(id) ON DELETE CASCADE,
  hospital_id  uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  event_type   timeline_event_type NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  risk_level   risk_level,
  created_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_timeline_episode ON patient_timeline_events (episode_id, created_at DESC);

-- ------------------------------------
-- WHATSAPP CONVERSATIONS
-- ------------------------------------
CREATE TABLE whatsapp_conversations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id          uuid NOT NULL UNIQUE REFERENCES care_episodes(id) ON DELETE CASCADE,
  hospital_id         uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  patient_id          uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  wa_phone            text NOT NULL,
  last_message_at     timestamptz,
  conversation_state  jsonb NOT NULL DEFAULT '{"state": "idle"}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------
-- WHATSAPP MESSAGES
-- ------------------------------------
CREATE TABLE whatsapp_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  hospital_id         uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  direction           text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type        text NOT NULL CHECK (message_type IN ('text', 'interactive', 'audio', 'template')),
  wa_message_id       text UNIQUE,
  content             text,
  media_storage_path  text,
  metadata            jsonb NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'sent'
                        CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON whatsapp_messages (conversation_id, created_at DESC);

-- ------------------------------------
-- VOICE ARTIFACTS
-- ------------------------------------
CREATE TABLE voice_artifacts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id            uuid NOT NULL REFERENCES care_episodes(id) ON DELETE CASCADE,
  hospital_id           uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  message_id            uuid NOT NULL REFERENCES whatsapp_messages(id) ON DELETE CASCADE,
  audio_storage_path    text NOT NULL,
  transcript            text,
  transcript_language   language_code,
  duration_seconds      int,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------
-- TRIAGE ASSESSMENTS
-- ------------------------------------
CREATE TABLE triage_assessments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id          uuid NOT NULL REFERENCES care_episodes(id) ON DELETE CASCADE,
  hospital_id         uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  voice_artifact_id   uuid REFERENCES voice_artifacts(id) ON DELETE SET NULL,
  inbound_text        text,
  risk_level          risk_level NOT NULL,
  matched_symptoms    jsonb NOT NULL DEFAULT '[]',
  reasoning           text,
  processing_ms       int,
  model_version       text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------
-- ALERTS
-- ------------------------------------
CREATE TABLE alerts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id        uuid NOT NULL REFERENCES care_episodes(id) ON DELETE CASCADE,
  hospital_id       uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  triage_id         uuid REFERENCES triage_assessments(id) ON DELETE SET NULL,
  type              alert_type NOT NULL,
  severity          text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status            alert_status NOT NULL DEFAULT 'open',
  assigned_to       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  acknowledged_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  acknowledged_at   timestamptz,
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_alerts_hospital_status ON alerts (hospital_id, status, created_at DESC);

-- ------------------------------------
-- AI INTERACTIONS
-- ------------------------------------
CREATE TABLE ai_interactions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id     uuid NOT NULL REFERENCES care_episodes(id) ON DELETE CASCADE,
  hospital_id    uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  input_type     text NOT NULL CHECK (input_type IN ('text', 'voice')),
  input_text     text NOT NULL,
  output_text    text,
  confidence     numeric(3,2),
  escalated      boolean NOT NULL DEFAULT false,
  model          text NOT NULL,
  context_tokens int,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------
-- ESCALATIONS
-- ------------------------------------
CREATE TABLE escalations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id          uuid NOT NULL REFERENCES care_episodes(id) ON DELETE CASCADE,
  hospital_id         uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  ai_interaction_id   uuid REFERENCES ai_interactions(id) ON DELETE SET NULL,
  reason              text NOT NULL,
  status              text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'in_progress', 'closed')),
  assigned_to         uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------
-- COMPLIANCE SNAPSHOTS
-- ------------------------------------
CREATE TABLE compliance_snapshots (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id                 uuid NOT NULL REFERENCES care_episodes(id) ON DELETE CASCADE,
  hospital_id                uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  snapshot_date              date NOT NULL,
  medication_adherence       numeric(5,2) NOT NULL DEFAULT 0,
  reminder_response_rate     numeric(5,2) NOT NULL DEFAULT 0,
  symptom_checks_completed   int NOT NULL DEFAULT 0,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (episode_id, snapshot_date)
);

-- ------------------------------------
-- ANALYTICS DAILY
-- ------------------------------------
CREATE TABLE analytics_daily (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id                uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  metric_date                date NOT NULL,
  active_patients            int NOT NULL DEFAULT 0,
  alerts_triggered           int NOT NULL DEFAULT 0,
  appointments_completed     int NOT NULL DEFAULT 0,
  appointments_missed        int NOT NULL DEFAULT 0,
  avg_medication_adherence   numeric(5,2),
  avg_response_rate          numeric(5,2),
  readmissions_prevented     int,
  estimated_savings_aed      numeric,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, metric_date)
);

-- ------------------------------------
-- AUDIT LOGS
-- ------------------------------------
CREATE TABLE audit_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id    uuid REFERENCES hospitals(id) ON DELETE SET NULL,
  actor_id       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action         text NOT NULL,
  resource_type  text NOT NULL,
  resource_id    uuid,
  ip_address     inet,
  metadata       jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_hospital ON audit_logs (hospital_id, created_at DESC);

-- ------------------------------------
-- HOSPITAL APPROVED GUIDANCE
-- ------------------------------------
CREATE TABLE hospital_approved_guidance (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id       uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  category          text NOT NULL,
  question_patterns jsonb NOT NULL DEFAULT '[]',
  answer            jsonb NOT NULL DEFAULT '{}',
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------
-- UPDATED_AT TRIGGER FUNCTION
-- ------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER hospitals_updated_at
  BEFORE UPDATE ON hospitals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER patients_updated_at
  BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER care_episodes_updated_at
  BEFORE UPDATE ON care_episodes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER discharge_summaries_updated_at
  BEFORE UPDATE ON discharge_summaries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER whatsapp_conversations_updated_at
  BEFORE UPDATE ON whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER escalations_updated_at
  BEFORE UPDATE ON escalations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER hospital_approved_guidance_updated_at
  BEFORE UPDATE ON hospital_approved_guidance
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
