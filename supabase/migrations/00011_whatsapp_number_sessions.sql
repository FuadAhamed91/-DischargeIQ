-- 00011: one WhatsApp number, several patients
--
-- patients.phone_e164 is not unique: a family shares one phone, a daughter
-- writes for both parents, a tester registers three demo patients on their
-- own number. Each patient keeps their own whatsapp_conversations row; this
-- table remembers, per (hospital, sender number), which patient the sender
-- is currently writing about and whether they are being asked to say so.
--
--   active_patient_id / active_until  the patient the last message was about
--                                     (default for the next 24 h)
--   pending_choice                    {"options": [patient ids as listed],
--                                      "held": the message to replay once
--                                      answered, "askedAt": iso, "repeated": bool}
--
-- Written only by the webhook handler (service role); staff read it on the
-- episode page to see that a number is shared and whether a choice is pending.

CREATE TABLE IF NOT EXISTS whatsapp_number_sessions (
  hospital_id        uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  wa_phone           text NOT NULL,
  active_patient_id  uuid REFERENCES patients(id) ON DELETE SET NULL,
  active_until       timestamptz,
  pending_choice     jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hospital_id, wa_phone)
);

COMMENT ON TABLE whatsapp_number_sessions IS
  'Per sender number: which patient their messages are about when the number is linked to more than one open episode';

CREATE INDEX IF NOT EXISTS idx_number_sessions_patient
  ON whatsapp_number_sessions (active_patient_id);

DROP TRIGGER IF EXISTS whatsapp_number_sessions_updated_at ON whatsapp_number_sessions;
CREATE TRIGGER whatsapp_number_sessions_updated_at
  BEFORE UPDATE ON whatsapp_number_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE whatsapp_number_sessions ENABLE ROW LEVEL SECURITY;

-- Staff see their own hospital's sessions; only the service role writes.
DROP POLICY IF EXISTS "wa_number_sessions_select" ON whatsapp_number_sessions;
CREATE POLICY "wa_number_sessions_select" ON whatsapp_number_sessions
  FOR SELECT USING (
    is_super_admin()
    OR hospital_id = get_my_hospital_id()
  );
