-- ============================================================
-- CareLoop — Migration 00005: Harden SECURITY DEFINER functions
-- ============================================================
-- Addresses Supabase security-advisor findings on the functions from
-- migrations 00002/00003. By default every function in `public` is
-- executable by PUBLIC, which exposes it at /rest/v1/rpc/<name> to the
-- `anon` and `authenticated` roles. For SECURITY DEFINER functions that
-- means callers run them with the owner's privileges, bypassing RLS:
--
--   * get_active_episode_by_phone  -> anyone with the anon key could look
--                                     up a patient's name/episode by phone
--   * compute_compliance_snapshot   -> anyone could write compliance rows
--   * trigger bodies                -> not usefully callable, but exposed
--
-- Policy:
--   - RLS helper functions stay executable by `authenticated` (policies
--     evaluate them as the calling user) but not by `anon`.
--   - Everything else is executable only by `service_role`.
--   - All functions get a fixed search_path (advisor: function_search_path_mutable).
--
-- Nothing in the app calls these via supabase.rpc(); the webhook and cron
-- use direct queries with the service role.

-- ------------------------------------
-- 1. RLS helpers: authenticated only
-- ------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_my_hospital_id()       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_role()              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin()           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_above()        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_coordinator_or_above()  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_clinical()              FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_my_hospital_id()       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_role()              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin()           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin_or_above()        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_coordinator_or_above()  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_clinical()              TO authenticated, service_role;

-- ------------------------------------
-- 2. Service-role-only: data functions and trigger bodies
--    (PostgreSQL checks EXECUTE on trigger functions at CREATE TRIGGER
--     time, not when the trigger fires, so triggers keep working for
--     authenticated users' inserts/updates.)
-- ------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_active_episode_by_phone(text, text)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_compliance_snapshot(uuid, date)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at()                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_wa_conversation_on_activation()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_episode_risk_on_triage()                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_alert_on_triage()                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_timeline_on_alert()                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_timeline_on_appointment_change()         FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_active_episode_by_phone(text, text)       TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_compliance_snapshot(uuid, date)       TO service_role;

-- ------------------------------------
-- 3. Fixed search_path on every function
-- ------------------------------------
ALTER FUNCTION public.get_my_hospital_id()                       SET search_path = public;
ALTER FUNCTION public.get_my_role()                              SET search_path = public;
ALTER FUNCTION public.is_super_admin()                           SET search_path = public;
ALTER FUNCTION public.is_admin_or_above()                        SET search_path = public;
ALTER FUNCTION public.is_coordinator_or_above()                  SET search_path = public;
ALTER FUNCTION public.is_clinical()                              SET search_path = public;
ALTER FUNCTION public.get_active_episode_by_phone(text, text)    SET search_path = public;
ALTER FUNCTION public.compute_compliance_snapshot(uuid, date)    SET search_path = public;
ALTER FUNCTION public.handle_new_user()                          SET search_path = public;
ALTER FUNCTION public.update_updated_at()                        SET search_path = public;
ALTER FUNCTION public.create_wa_conversation_on_activation()     SET search_path = public;
ALTER FUNCTION public.sync_episode_risk_on_triage()              SET search_path = public;
ALTER FUNCTION public.create_alert_on_triage()                   SET search_path = public;
ALTER FUNCTION public.log_timeline_on_alert()                    SET search_path = public;
ALTER FUNCTION public.log_timeline_on_appointment_change()       SET search_path = public;
