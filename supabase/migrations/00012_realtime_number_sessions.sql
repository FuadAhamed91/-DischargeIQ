-- ============================================================
-- CareLoop — Migration 00012: realtime for the shared-number notice
-- ============================================================
-- The episode page's Conversation tab shows which patient a shared number
-- is currently writing about and whether the sender is being asked. It
-- subscribes to whatsapp_number_sessions via postgres_changes so the notice
-- follows the webhook as it routes. RLS (wa_number_sessions_select,
-- hospital-scoped) still governs what each subscriber receives.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'whatsapp_number_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_number_sessions;
  END IF;
END $$;
