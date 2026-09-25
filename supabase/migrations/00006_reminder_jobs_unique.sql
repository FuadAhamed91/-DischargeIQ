-- ============================================================
-- CareLoop — Migration 00006: reminder_jobs idempotency constraint
-- ============================================================
-- lib/reminders/generator.ts upserts next-day jobs with
--   onConflict: 'schedule_id,fire_at', ignoreDuplicates: true
-- so a re-run of the nightly cron never double-schedules a reminder.
-- Postgres requires a matching unique index for ON CONFLICT, and the
-- original schema never had one, so every generate run failed with
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" and no reminder jobs were ever created.

CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_jobs_schedule_fire_at
  ON reminder_jobs (schedule_id, fire_at);
