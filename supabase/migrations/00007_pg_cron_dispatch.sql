-- ============================================================
-- CareLoop — Migration 00007: dispatch reminders every 5 min via pg_cron
-- ============================================================
-- Vercel's Hobby plan only allows once-a-day cron jobs, so reminders
-- scheduled for the evening were being delivered the next morning.
-- pg_cron + pg_net let the database itself call the dispatch route
-- every 5 minutes, which is how lib/reminders/dispatcher.ts was
-- designed to run. Vercel keeps the daily generate + escalate jobs.
--
-- Configuration lives in Supabase Vault (encrypted), never in the job:
--   cron_base_url  e.g. https://your-app.vercel.app
--   cron_secret    must equal the CRON_SECRET env var on Vercel
-- Set both with (service_role only):
--   select configure_cron_dispatch('https://<app-host>', '<CRON_SECRET>');
-- Until both exist the job runs but makes no HTTP call, so applying this
-- migration to a fresh/dev project is harmless.

-- ------------------------------------
-- 1. Extensions
-- ------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- ------------------------------------
-- 2. Admin function to (re)configure the Vault secrets
-- ------------------------------------
CREATE OR REPLACE FUNCTION public.configure_cron_dispatch(p_base_url text, p_secret text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url_id    uuid;
  v_secret_id uuid;
BEGIN
  IF p_base_url IS NULL OR p_base_url !~ '^https?://' THEN
    RAISE EXCEPTION 'p_base_url must be an absolute http(s) URL';
  END IF;
  IF p_secret IS NULL OR length(p_secret) < 16 THEN
    RAISE EXCEPTION 'p_secret must be at least 16 characters';
  END IF;

  SELECT id INTO v_url_id    FROM vault.secrets WHERE name = 'cron_base_url';
  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = 'cron_secret';

  IF v_url_id IS NULL THEN
    PERFORM vault.create_secret(rtrim(p_base_url, '/'), 'cron_base_url', 'Base URL of the CareLoop app for pg_cron HTTP calls');
  ELSE
    PERFORM vault.update_secret(v_url_id, rtrim(p_base_url, '/'));
  END IF;

  IF v_secret_id IS NULL THEN
    PERFORM vault.create_secret(p_secret, 'cron_secret', 'Bearer token for /api/cron/* (same value as CRON_SECRET on Vercel)');
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_secret);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.configure_cron_dispatch(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_cron_dispatch(text, text) TO service_role;

-- ------------------------------------
-- 3. The job: GET /api/cron/reminders/dispatch every 5 minutes
--    cron.schedule() upserts by name, so re-running this is safe.
--    pg_net's http_get is asynchronous; the response is recorded in
--    net._http_response and each run is logged in cron.job_run_details.
-- ------------------------------------
SELECT cron.schedule(
  'dispatch-reminders-every-5-min',
  '*/5 * * * *',
  $job$
  SELECT net.http_get(
    url                  := cfg.base_url || '/api/cron/reminders/dispatch',
    headers              := jsonb_build_object('Authorization', 'Bearer ' || cfg.secret),
    timeout_milliseconds := 60000
  )
  FROM (
    SELECT
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_base_url') AS base_url,
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')   AS secret
  ) AS cfg
  WHERE cfg.base_url IS NOT NULL AND cfg.secret IS NOT NULL;
  $job$
);
