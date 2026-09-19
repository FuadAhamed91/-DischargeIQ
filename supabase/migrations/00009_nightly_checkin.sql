-- 00009: nightly check-in replaces per-dose medication reminders
--
-- Product decision (2026-09-19): one WhatsApp conversation per day at 21:00
-- hospital-local — "did you take all your medicines?" then "how are you
-- feeling?" — instead of a message per dose. Patients can still write in at
-- any time. Modelled with the existing reminder machinery:
--   reminder_schedules.type = 'symptom_check', message_template_key = 'nightly_checkin_v1'
-- so the daily generator and the 5-minute dispatcher need no schema change.

-- A "took none / some of my medicines" answer raises a nurse alert of its own type.
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'missed_medication';

-- Retire the per-dose schedules and anything queued for them.
UPDATE reminder_schedules
   SET is_active = false
 WHERE type = 'medication'
   AND is_active;

UPDATE reminder_jobs j
   SET status = 'cancelled'
  FROM reminder_schedules s
 WHERE j.schedule_id = s.id
   AND s.type = 'medication'
   AND j.status = 'pending';

-- Older symptom_check rows (demo seed used 20:00) become the nightly check-in.
UPDATE reminder_schedules
   SET message_template_key = 'nightly_checkin_v1',
       scheduled_time = time '21:00'
 WHERE type = 'symptom_check'
   AND message_template_key <> 'nightly_checkin_v1';

-- Every active episode gets exactly one nightly check-in at the hospital's
-- configured time (hospitals.settings->>'checkin_time'), default 21:00.
INSERT INTO reminder_schedules (episode_id, hospital_id, type, scheduled_time, medication_id, message_template_key, is_active)
SELECT e.id,
       e.hospital_id,
       'symptom_check',
       COALESCE(NULLIF(h.settings->>'checkin_time', '')::time, time '21:00'),
       NULL,
       'nightly_checkin_v1',
       true
  FROM care_episodes e
  JOIN hospitals h ON h.id = e.hospital_id
 WHERE e.status = 'active'
   AND NOT EXISTS (
         SELECT 1
           FROM reminder_schedules s
          WHERE s.episode_id = e.id
            AND s.type = 'symptom_check'
            AND s.is_active
       );
