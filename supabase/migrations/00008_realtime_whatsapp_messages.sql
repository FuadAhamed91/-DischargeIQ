-- ============================================================
-- CareLoop — Migration 00008: realtime for the conversation transcript
-- ============================================================
-- The episode page's Conversation tab subscribes to whatsapp_messages via
-- postgres_changes so nurse and patient messages appear as they happen.
-- RLS (wa_messages_select, hospital-scoped) still governs what each
-- subscriber receives.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'whatsapp_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
  END IF;
END $$;
