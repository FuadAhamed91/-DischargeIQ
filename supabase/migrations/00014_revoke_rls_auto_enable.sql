-- 00014: rls_auto_enable() is not callable over the API
--
-- rls_auto_enable() is Supabase's event-trigger function behind the
-- ensure_rls event trigger: it switches row level security on for every new
-- table in public. Like any function it was created with EXECUTE granted to
-- PUBLIC, so the security advisor reports it as callable by anon and
-- authenticated through /rest/v1/rpc (lints 0028 / 0029). An event-trigger
-- function cannot actually be run that way, but revoke the grant anyway, as
-- 00005 does for the app's own trigger functions. Event triggers do not check
-- EXECUTE when they fire, so ensure_rls keeps working.
--
-- Guarded: environments without the function (local, fresh projects) skip it.

DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
END $$;
