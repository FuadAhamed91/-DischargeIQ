-- ============================================================
-- CareLoop — Migration 00003: Functions & Triggers
-- ============================================================

-- ------------------------------------
-- AUTO-CREATE PROFILE ON USER SIGNUP
-- Called by Supabase Auth trigger
-- ------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Profile is created via the invite flow (API sets hospital_id + role).
  -- This function handles edge-cases where raw signup happens.
  -- In production, only invite-flow users should reach this.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ------------------------------------
-- AUTO-CREATE WHATSAPP CONVERSATION ON EPISODE ACTIVATION
-- ------------------------------------
CREATE OR REPLACE FUNCTION create_wa_conversation_on_activation()
RETURNS TRIGGER AS $$
DECLARE
  v_phone text;
BEGIN
  IF NEW.status = 'active' AND OLD.status != 'active' THEN
    SELECT phone_e164 INTO v_phone
    FROM patients WHERE id = NEW.patient_id;

    INSERT INTO whatsapp_conversations
      (episode_id, hospital_id, patient_id, wa_phone)
    VALUES
      (NEW.id, NEW.hospital_id, NEW.patient_id, v_phone)
    ON CONFLICT (episode_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER episode_activation_creates_wa_conversation
  AFTER UPDATE ON care_episodes
  FOR EACH ROW EXECUTE FUNCTION create_wa_conversation_on_activation();

-- ------------------------------------
-- UPDATE EPISODE RISK LEVEL ON TRIAGE
-- ------------------------------------
CREATE OR REPLACE FUNCTION sync_episode_risk_on_triage()
RETURNS TRIGGER AS $$
BEGIN
  -- Only escalate risk level, never downgrade automatically
  UPDATE care_episodes
  SET current_risk_level = NEW.risk_level,
      updated_at = now()
  WHERE id = NEW.episode_id
    AND (
      -- red always wins
      NEW.risk_level = 'red'
      -- yellow wins over green
      OR (NEW.risk_level = 'yellow' AND current_risk_level = 'green')
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER triage_updates_episode_risk
  AFTER INSERT ON triage_assessments
  FOR EACH ROW EXECUTE FUNCTION sync_episode_risk_on_triage();

-- ------------------------------------
-- CREATE ALERT ON RED/YELLOW TRIAGE
-- ------------------------------------
CREATE OR REPLACE FUNCTION create_alert_on_triage()
RETURNS TRIGGER AS $$
DECLARE
  v_severity text;
  v_type     alert_type;
  v_nurse_id uuid;
BEGIN
  IF NEW.risk_level = 'red' THEN
    v_severity := 'critical';
    v_type     := 'risk_red';
  ELSIF NEW.risk_level = 'yellow' THEN
    v_severity := 'medium';
    v_type     := 'risk_yellow';
  ELSE
    RETURN NEW; -- green: no alert
  END IF;

  SELECT assigned_nurse_id INTO v_nurse_id
  FROM care_episodes WHERE id = NEW.episode_id;

  INSERT INTO alerts
    (episode_id, hospital_id, triage_id, type, severity, status, assigned_to)
  VALUES
    (NEW.episode_id, NEW.hospital_id, NEW.id, v_type, v_severity, 'open', v_nurse_id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER triage_creates_alert
  AFTER INSERT ON triage_assessments
  FOR EACH ROW EXECUTE FUNCTION create_alert_on_triage();

-- ------------------------------------
-- LOG TIMELINE EVENT ON ALERT CREATED
-- ------------------------------------
CREATE OR REPLACE FUNCTION log_timeline_on_alert()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO patient_timeline_events
    (episode_id, hospital_id, event_type, payload, risk_level)
  VALUES (
    NEW.episode_id,
    NEW.hospital_id,
    'triage_completed',
    jsonb_build_object(
      'alert_id',  NEW.id,
      'alert_type', NEW.type,
      'severity',  NEW.severity
    ),
    CASE NEW.type
      WHEN 'risk_red'    THEN 'red'::risk_level
      WHEN 'risk_yellow' THEN 'yellow'::risk_level
      ELSE NULL
    END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER alert_logs_timeline_event
  AFTER INSERT ON alerts
  FOR EACH ROW EXECUTE FUNCTION log_timeline_on_alert();

-- ------------------------------------
-- LOG TIMELINE EVENT ON APPOINTMENT STATUS CHANGE
-- ------------------------------------
CREATE OR REPLACE FUNCTION log_timeline_on_appointment_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status != OLD.status THEN
    IF NEW.status = 'confirmed' THEN
      INSERT INTO patient_timeline_events
        (episode_id, hospital_id, event_type, payload)
      VALUES (
        NEW.episode_id, NEW.hospital_id, 'appointment_confirmed',
        jsonb_build_object('appointment_id', NEW.id, 'specialty', NEW.specialty, 'scheduled_at', NEW.scheduled_at)
      );
    ELSIF NEW.status = 'rescheduled' THEN
      INSERT INTO patient_timeline_events
        (episode_id, hospital_id, event_type, payload)
      VALUES (
        NEW.episode_id, NEW.hospital_id, 'appointment_rescheduled',
        jsonb_build_object('appointment_id', NEW.id, 'specialty', NEW.specialty, 'scheduled_at', NEW.scheduled_at)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER appointment_change_logs_timeline
  AFTER UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION log_timeline_on_appointment_change();

-- ------------------------------------
-- FUNCTION: GET ACTIVE EPISODE FOR PHONE
-- Used by WhatsApp webhook handler (service role)
-- ------------------------------------
CREATE OR REPLACE FUNCTION get_active_episode_by_phone(
  p_phone            text,
  p_phone_number_id  text
)
RETURNS TABLE (
  episode_id   uuid,
  patient_id   uuid,
  hospital_id  uuid,
  patient_name text,
  language     language_code
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    p.id,
    p.hospital_id,
    p.full_name,
    p.preferred_language
  FROM patients p
  JOIN care_episodes e ON e.patient_id = p.id AND e.status = 'active'
  JOIN hospitals h ON h.id = p.hospital_id
  WHERE p.phone_e164 = p_phone
    AND h.whatsapp_phone_number_id = p_phone_number_id
  ORDER BY e.created_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ------------------------------------
-- FUNCTION: COMPLIANCE SNAPSHOT COMPUTATION
-- Called by nightly cron
-- ------------------------------------
CREATE OR REPLACE FUNCTION compute_compliance_snapshot(
  p_episode_id   uuid,
  p_snapshot_date date
)
RETURNS void AS $$
DECLARE
  v_hospital_id             uuid;
  v_medication_adherence    numeric;
  v_response_rate           numeric;
  v_symptom_checks          int;
  v_total_med_reminders     int;
  v_confirmed_med_reminders int;
  v_total_reminders         int;
  v_total_responses         int;
BEGIN
  SELECT hospital_id INTO v_hospital_id FROM care_episodes WHERE id = p_episode_id;

  -- Medication adherence: ratio of reminder_response 'yes' to medication reminders sent that day
  SELECT
    COUNT(*) FILTER (WHERE e.event_type = 'reminder_sent' AND (e.payload->>'reminder_type') = 'medication'),
    COUNT(*) FILTER (WHERE e.event_type = 'reminder_response' AND (e.payload->>'answer') = 'yes' AND (e.payload->>'reminder_type') = 'medication')
  INTO v_total_med_reminders, v_confirmed_med_reminders
  FROM patient_timeline_events e
  WHERE e.episode_id = p_episode_id
    AND date(e.created_at AT TIME ZONE 'Asia/Dubai') = p_snapshot_date;

  v_medication_adherence := CASE
    WHEN v_total_med_reminders = 0 THEN 0
    ELSE round((v_confirmed_med_reminders::numeric / v_total_med_reminders) * 100, 2)
  END;

  -- Overall response rate
  SELECT
    COUNT(*) FILTER (WHERE event_type = 'reminder_sent'),
    COUNT(*) FILTER (WHERE event_type = 'reminder_response')
  INTO v_total_reminders, v_total_responses
  FROM patient_timeline_events
  WHERE episode_id = p_episode_id
    AND date(created_at AT TIME ZONE 'Asia/Dubai') = p_snapshot_date;

  v_response_rate := CASE
    WHEN v_total_reminders = 0 THEN 0
    ELSE round((v_total_responses::numeric / v_total_reminders) * 100, 2)
  END;

  -- Symptom checks completed
  SELECT COUNT(*)
  INTO v_symptom_checks
  FROM patient_timeline_events
  WHERE episode_id = p_episode_id
    AND event_type = 'reminder_response'
    AND (payload->>'reminder_type') = 'symptom_check'
    AND date(created_at AT TIME ZONE 'Asia/Dubai') = p_snapshot_date;

  INSERT INTO compliance_snapshots
    (episode_id, hospital_id, snapshot_date, medication_adherence, reminder_response_rate, symptom_checks_completed)
  VALUES
    (p_episode_id, v_hospital_id, p_snapshot_date, v_medication_adherence, v_response_rate, v_symptom_checks)
  ON CONFLICT (episode_id, snapshot_date) DO UPDATE SET
    medication_adherence     = EXCLUDED.medication_adherence,
    reminder_response_rate   = EXCLUDED.reminder_response_rate,
    symptom_checks_completed = EXCLUDED.symptom_checks_completed;

  -- Update episode compliance_score to latest snapshot
  UPDATE care_episodes
  SET compliance_score = v_response_rate, updated_at = now()
  WHERE id = p_episode_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
