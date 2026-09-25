-- ============================================================
-- CareLoop — Migration 00002: Row Level Security Policies
-- ============================================================

-- Helper function: get current user's hospital_id
CREATE OR REPLACE FUNCTION get_my_hospital_id()
RETURNS uuid AS $$
  SELECT hospital_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: get current user's role
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: check if user is super_admin
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean AS $$
  SELECT role = 'super_admin' FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: check if user is admin-level (hospital_admin or above)
CREATE OR REPLACE FUNCTION is_admin_or_above()
RETURNS boolean AS $$
  SELECT role IN ('super_admin', 'hospital_admin') FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: check if user is coordinator or above (can see all hospital patients)
CREATE OR REPLACE FUNCTION is_coordinator_or_above()
RETURNS boolean AS $$
  SELECT role IN ('super_admin', 'hospital_admin', 'discharge_coordinator', 'case_manager', 'read_only')
  FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: check if user is clinical (can act on episodes)
CREATE OR REPLACE FUNCTION is_clinical()
RETURNS boolean AS $$
  SELECT role IN ('super_admin', 'hospital_admin', 'discharge_coordinator', 'nurse', 'case_manager')
  FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ------------------------------------
-- ENABLE RLS ON ALL TABLES
-- ------------------------------------
ALTER TABLE hospitals                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_episodes                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE discharge_documents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE discharge_summaries           ENABLE ROW LEVEL SECURITY;
ALTER TABLE discharge_summary_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE medications                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_up_requirements        ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_slots_cache       ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_schedules            ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_jobs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_timeline_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_artifacts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE triage_assessments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_interactions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_snapshots          ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_daily               ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospital_approved_guidance    ENABLE ROW LEVEL SECURITY;

-- ------------------------------------
-- HOSPITALS
-- ------------------------------------
CREATE POLICY "hospitals_select" ON hospitals
  FOR SELECT USING (
    is_super_admin()
    OR id = get_my_hospital_id()
  );

CREATE POLICY "hospitals_update" ON hospitals
  FOR UPDATE USING (
    is_super_admin()
    OR (id = get_my_hospital_id() AND is_admin_or_above())
  );

-- ------------------------------------
-- DEPARTMENTS
-- ------------------------------------
CREATE POLICY "departments_select" ON departments
  FOR SELECT USING (
    is_super_admin()
    OR hospital_id = get_my_hospital_id()
  );

CREATE POLICY "departments_insert" ON departments
  FOR INSERT WITH CHECK (
    hospital_id = get_my_hospital_id() AND is_admin_or_above()
  );

-- ------------------------------------
-- PROFILES
-- ------------------------------------
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (
    is_super_admin()
    OR id = auth.uid()
    OR hospital_id = get_my_hospital_id()
  );

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (id = auth.uid() OR is_admin_or_above());

CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (hospital_id = get_my_hospital_id() AND is_admin_or_above())
  );

-- ------------------------------------
-- PATIENTS
-- ------------------------------------
-- Coordinators/admins/case managers/read_only: all hospital patients
-- Nurses: only patients they are assigned to
CREATE POLICY "patients_select" ON patients
  FOR SELECT USING (
    is_super_admin()
    OR (
      hospital_id = get_my_hospital_id()
      AND (
        is_coordinator_or_above()
        OR assigned_nurse_id = auth.uid()
      )
    )
  );

CREATE POLICY "patients_insert" ON patients
  FOR INSERT WITH CHECK (
    hospital_id = get_my_hospital_id()
    AND is_clinical()
  );

CREATE POLICY "patients_update" ON patients
  FOR UPDATE USING (
    hospital_id = get_my_hospital_id()
    AND is_clinical()
  );

-- ------------------------------------
-- CARE EPISODES
-- ------------------------------------
CREATE POLICY "episodes_select" ON care_episodes
  FOR SELECT USING (
    is_super_admin()
    OR (
      hospital_id = get_my_hospital_id()
      AND (
        is_coordinator_or_above()
        OR assigned_nurse_id = auth.uid()
      )
    )
  );

CREATE POLICY "episodes_insert" ON care_episodes
  FOR INSERT WITH CHECK (
    hospital_id = get_my_hospital_id()
    AND is_clinical()
  );

CREATE POLICY "episodes_update" ON care_episodes
  FOR UPDATE USING (
    hospital_id = get_my_hospital_id()
    AND is_clinical()
  );

-- ------------------------------------
-- DISCHARGE DOCUMENTS
-- ------------------------------------
CREATE POLICY "discharge_documents_select" ON discharge_documents
  FOR SELECT USING (
    is_super_admin()
    OR hospital_id = get_my_hospital_id()
  );

CREATE POLICY "discharge_documents_insert" ON discharge_documents
  FOR INSERT WITH CHECK (
    hospital_id = get_my_hospital_id()
    AND is_clinical()
  );

-- ------------------------------------
-- DISCHARGE SUMMARIES
-- ------------------------------------
CREATE POLICY "discharge_summaries_select" ON discharge_summaries
  FOR SELECT USING (
    is_super_admin()
    OR hospital_id = get_my_hospital_id()
  );

CREATE POLICY "discharge_summaries_insert" ON discharge_summaries
  FOR INSERT WITH CHECK (
    hospital_id = get_my_hospital_id()
    AND is_clinical()
  );

CREATE POLICY "discharge_summaries_update" ON discharge_summaries
  FOR UPDATE USING (
    hospital_id = get_my_hospital_id()
    AND is_clinical()
  );

-- ------------------------------------
-- DISCHARGE SUMMARY TRANSLATIONS
-- ------------------------------------
CREATE POLICY "translations_select" ON discharge_summary_translations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM discharge_summaries ds
      WHERE ds.id = summary_id
        AND (is_super_admin() OR ds.hospital_id = get_my_hospital_id())
    )
  );

CREATE POLICY "translations_insert" ON discharge_summary_translations
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM discharge_summaries ds
      WHERE ds.id = summary_id
        AND ds.hospital_id = get_my_hospital_id()
        AND is_clinical()
    )
  );

-- ------------------------------------
-- MEDICATIONS
-- ------------------------------------
CREATE POLICY "medications_select" ON medications
  FOR SELECT USING (
    is_super_admin()
    OR hospital_id = get_my_hospital_id()
  );

CREATE POLICY "medications_insert" ON medications
  FOR INSERT WITH CHECK (
    hospital_id = get_my_hospital_id()
    AND is_clinical()
  );

CREATE POLICY "medications_update" ON medications
  FOR UPDATE USING (
    hospital_id = get_my_hospital_id()
    AND is_clinical()
  );

CREATE POLICY "medications_delete" ON medications
  FOR DELETE USING (
    hospital_id = get_my_hospital_id()
    AND is_clinical()
  );

-- ------------------------------------
-- FOLLOW-UP REQUIREMENTS
-- ------------------------------------
CREATE POLICY "follow_up_select" ON follow_up_requirements
  FOR SELECT USING (
    is_super_admin()
    OR hospital_id = get_my_hospital_id()
  );

CREATE POLICY "follow_up_insert" ON follow_up_requirements
  FOR INSERT WITH CHECK (
    hospital_id = get_my_hospital_id()
    AND is_clinical()
  );

CREATE POLICY "follow_up_update" ON follow_up_requirements
  FOR UPDATE USING (
    hospital_id = get_my_hospital_id()
    AND is_clinical()
  );

-- ------------------------------------
-- APPOINTMENTS
-- ------------------------------------
CREATE POLICY "appointments_select" ON appointments
  FOR SELECT USING (
    is_super_admin()
    OR hospital_id = get_my_hospital_id()
  );

CREATE POLICY "appointments_insert" ON appointments
  FOR INSERT WITH CHECK (
    hospital_id = get_my_hospital_id()
    AND is_clinical()
  );

CREATE POLICY "appointments_update" ON appointments
  FOR UPDATE USING (
    hospital_id = get_my_hospital_id()
    AND is_clinical()
  );

-- ------------------------------------
-- APPOINTMENT SLOTS CACHE
-- ------------------------------------
CREATE POLICY "slots_cache_select" ON appointment_slots_cache
  FOR SELECT USING (hospital_id = get_my_hospital_id());

-- ------------------------------------
-- REMINDER SCHEDULES
-- ------------------------------------
CREATE POLICY "reminder_schedules_select" ON reminder_schedules
  FOR SELECT USING (
    is_super_admin()
    OR hospital_id = get_my_hospital_id()
  );

CREATE POLICY "reminder_schedules_insert" ON reminder_schedules
  FOR INSERT WITH CHECK (
    hospital_id = get_my_hospital_id()
    AND is_clinical()
  );

-- ------------------------------------
-- REMINDER JOBS
-- ------------------------------------
CREATE POLICY "reminder_jobs_select" ON reminder_jobs
  FOR SELECT USING (
    is_super_admin()
    OR hospital_id = get_my_hospital_id()
  );

-- ------------------------------------
-- PATIENT TIMELINE EVENTS
-- ------------------------------------
CREATE POLICY "timeline_select" ON patient_timeline_events
  FOR SELECT USING (
    is_super_admin()
    OR (
      hospital_id = get_my_hospital_id()
      AND (
        is_coordinator_or_above()
        OR EXISTS (
          SELECT 1 FROM care_episodes e
          WHERE e.id = episode_id
            AND e.assigned_nurse_id = auth.uid()
        )
      )
    )
  );

-- ------------------------------------
-- WHATSAPP CONVERSATIONS
-- ------------------------------------
CREATE POLICY "wa_conversations_select" ON whatsapp_conversations
  FOR SELECT USING (
    is_super_admin()
    OR hospital_id = get_my_hospital_id()
  );

-- ------------------------------------
-- WHATSAPP MESSAGES
-- ------------------------------------
CREATE POLICY "wa_messages_select" ON whatsapp_messages
  FOR SELECT USING (
    is_super_admin()
    OR hospital_id = get_my_hospital_id()
  );

-- ------------------------------------
-- VOICE ARTIFACTS
-- ------------------------------------
CREATE POLICY "voice_artifacts_select" ON voice_artifacts
  FOR SELECT USING (
    is_super_admin()
    OR hospital_id = get_my_hospital_id()
  );

-- ------------------------------------
-- TRIAGE ASSESSMENTS
-- ------------------------------------
CREATE POLICY "triage_select" ON triage_assessments
  FOR SELECT USING (
    is_super_admin()
    OR hospital_id = get_my_hospital_id()
  );

-- ------------------------------------
-- ALERTS
-- ------------------------------------
CREATE POLICY "alerts_select" ON alerts
  FOR SELECT USING (
    is_super_admin()
    OR hospital_id = get_my_hospital_id()
  );

CREATE POLICY "alerts_update" ON alerts
  FOR UPDATE USING (
    hospital_id = get_my_hospital_id()
    AND is_clinical()
  );

-- ------------------------------------
-- AI INTERACTIONS
-- ------------------------------------
CREATE POLICY "ai_interactions_select" ON ai_interactions
  FOR SELECT USING (
    is_super_admin()
    OR hospital_id = get_my_hospital_id()
  );

-- ------------------------------------
-- ESCALATIONS
-- ------------------------------------
CREATE POLICY "escalations_select" ON escalations
  FOR SELECT USING (
    is_super_admin()
    OR hospital_id = get_my_hospital_id()
  );

CREATE POLICY "escalations_update" ON escalations
  FOR UPDATE USING (
    hospital_id = get_my_hospital_id()
    AND is_clinical()
  );

-- ------------------------------------
-- COMPLIANCE SNAPSHOTS
-- ------------------------------------
CREATE POLICY "compliance_select" ON compliance_snapshots
  FOR SELECT USING (
    is_super_admin()
    OR hospital_id = get_my_hospital_id()
  );

-- ------------------------------------
-- ANALYTICS DAILY
-- ------------------------------------
CREATE POLICY "analytics_select" ON analytics_daily
  FOR SELECT USING (
    is_super_admin()
    OR (
      hospital_id = get_my_hospital_id()
      AND get_my_role() IN ('super_admin', 'hospital_admin', 'discharge_coordinator', 'case_manager', 'read_only')
    )
  );

-- ------------------------------------
-- AUDIT LOGS
-- ------------------------------------
CREATE POLICY "audit_logs_select" ON audit_logs
  FOR SELECT USING (
    is_super_admin()
    OR (hospital_id = get_my_hospital_id() AND is_admin_or_above())
  );

-- ------------------------------------
-- HOSPITAL APPROVED GUIDANCE
-- ------------------------------------
CREATE POLICY "guidance_select" ON hospital_approved_guidance
  FOR SELECT USING (
    is_super_admin()
    OR hospital_id = get_my_hospital_id()
  );

CREATE POLICY "guidance_insert" ON hospital_approved_guidance
  FOR INSERT WITH CHECK (
    hospital_id = get_my_hospital_id()
    AND is_admin_or_above()
  );

CREATE POLICY "guidance_update" ON hospital_approved_guidance
  FOR UPDATE USING (
    hospital_id = get_my_hospital_id()
    AND is_admin_or_above()
  );
