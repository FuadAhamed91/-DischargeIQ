-- 00016: patients' voice notes, kept so a nurse can listen to them
--
-- The webhook (service role, no policy needed) stores each inbound voice note
-- at <hospital_id>/<episode_id>/<message SID>.<ext> and records the path on
-- whatsapp_messages.media_storage_path; the Conversation tab plays it through
-- a short-lived signed URL. Private, and readable only by staff of the same
-- hospital — as discharge-documents (00004). WhatsApp caps media at 16 MB.
-- Until this is applied the note is still transcribed and handled; only the
-- audio is not kept.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'voice-notes', 'voice-notes', false, 16777216,
  ARRAY['audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/amr', 'audio/wav', 'audio/webm']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "voice_notes_select_own_hospital" ON storage.objects;
CREATE POLICY "voice_notes_select_own_hospital" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'voice-notes'
    AND (storage.foldername(name))[1] = get_my_hospital_id()::text
  );
