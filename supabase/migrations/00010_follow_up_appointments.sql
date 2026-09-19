-- 00010: follow-up requirements become provisional appointments
--
-- When a discharge summary is read, each dated follow-up ("Cardiology clinic
-- by 3 Oct") is placed on the Appointments screen straight away, linked via
-- appointments.follow_up_id. Until a nurse books the real slot the row is
-- provisional: time_tbc = true and scheduled_at is the "by" date at 09:00
-- hospital-local. Booking a time (appointment PATCH) clears the flag.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS time_tbc boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN appointments.time_tbc IS
  'Created from a discharge-summary follow-up: scheduled_at is the "by" date at 09:00 local until a nurse books the actual slot';

-- Backfill: open episodes whose dated follow-ups have no appointment yet.
-- Skip when an appointment for the same specialty already exists on the
-- episode (demo data has hand-made appointments that match its follow-ups).
INSERT INTO appointments (episode_id, hospital_id, follow_up_id, specialty, scheduled_at, status, time_tbc)
SELECT e.id,
       e.hospital_id,
       f.id,
       f.specialty,
       (f.deadline::timestamp + time '09:00') AT TIME ZONE h.timezone,
       'scheduled',
       true
  FROM follow_up_requirements f
  JOIN discharge_summaries s ON s.id = f.summary_id
  JOIN care_episodes e ON e.id = s.episode_id
  JOIN hospitals h ON h.id = e.hospital_id
 WHERE f.deadline IS NOT NULL
   AND e.status IN ('draft', 'pending_review', 'active')
   AND NOT EXISTS (
         SELECT 1 FROM appointments a
          WHERE a.episode_id = e.id
            AND (a.follow_up_id = f.id OR lower(a.specialty) = lower(f.specialty))
       );

-- Link hand-made appointments to the follow-up they fulfil (same episode and
-- specialty) so the Appointments screen can show the letter's instructions.
UPDATE appointments a
   SET follow_up_id = f.id
  FROM follow_up_requirements f
  JOIN discharge_summaries s ON s.id = f.summary_id
 WHERE a.follow_up_id IS NULL
   AND a.episode_id = s.episode_id
   AND lower(a.specialty) = lower(f.specialty);
