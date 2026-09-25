-- ============================================================
-- CareLoop — Migration 00004: Storage bucket & Realtime publication
-- ============================================================
-- Captures project-level setup the app depends on that previously lived
-- only in the dashboard of the original Supabase project:
--   1. The private `discharge-documents` bucket used for uploaded PDFs,
--      with RLS scoped to the uploader's hospital (path: <hospital_id>/<episode_id>/<file>).
--   2. Realtime publication for the tables the dashboard subscribes to.

-- ------------------------------------
-- 1. STORAGE: discharge-documents bucket
-- ------------------------------------
-- Converges an existing bucket too: private, PDF-only, 20 MB (the upload route
-- always sends contentType application/pdf).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('discharge-documents', 'discharge-documents', false, 20971520, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- The original project had dashboard-created policies that only checked bucket_id,
-- so any signed-in user of any hospital could read or write every hospital's PDFs.
-- Permissive policies OR together, so they must be removed, not just supplemented.
DROP POLICY IF EXISTS "Hospital staff can read documents"   ON storage.objects;
DROP POLICY IF EXISTS "Hospital staff can upload documents" ON storage.objects;

-- Uploads use the nurse's own session (not the service role), so storage RLS applies.
-- The service role (extraction, cron) bypasses RLS and needs no policy.
-- Object paths are <hospital_id>/<episode_id>/<file>, built by the documents route.
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
