-- ============================================================
-- DischargeIQ — Migration 00004: Storage bucket & Realtime publication
-- ============================================================
-- Captures project-level setup the app depends on that previously lived
-- only in the dashboard of the original Supabase project:
--   1. The private `discharge-documents` bucket used for uploaded PDFs,
--      with RLS scoped to the uploader's hospital (path: <hospital_id>/<episode_id>/<file>).
--   2. Realtime publication for the tables the dashboard subscribes to.

-- ------------------------------------
-- 1. STORAGE: discharge-documents bucket
-- ------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('discharge-documents', 'discharge-documents', false, 20971520, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Uploads use the nurse's own session (not the service role), so storage RLS applies.
-- The service role (extraction, cron) bypasses RLS and needs no policy.
CREATE POLICY "discharge_docs_insert_own_hospital" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'discharge-documents'
    AND (storage.foldername(name))[1] = get_my_hospital_id()::text
    AND is_clinical()
  );

CREATE POLICY "discharge_docs_select_own_hospital" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'discharge-documents'
    AND (storage.foldername(name))[1] = get_my_hospital_id()::text
  );

-- ------------------------------------
-- 2. REALTIME: tables the dashboard subscribes to via postgres_changes
--    (alerts-list, realtime-alerts-banner, recent-alerts, episode-timeline)
--    RLS still applies to what each subscriber receives.
-- ------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'alerts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'patient_timeline_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.patient_timeline_events;
  END IF;
END $$;
