-- supabase/migrations/20260603_agent_action_log_rls_fix.sql
--
-- Security fix: restrict client write access on agent_action_log.
--
-- Context:
--   The initial migration (20260603_agent_action_log.sql) created INSERT and UPDATE
--   policies for the `authenticated` role. This was overly permissive.
--
--   Target security model:
--     SELECT  → authenticated  (managers read proposals in Approval UI)
--     INSERT  → service_role only (via server API route with app-level auth check)
--     UPDATE  → service_role only (via server API route with app-level auth check)
--     DELETE  → nobody via client (permanent audit trail)
--
--   SUPABASE_SERVICE_ROLE_KEY used by lib/ai-tools/ and future API routes bypasses
--   RLS entirely — so dropping client INSERT/UPDATE policies does not break server writes.
--
-- ✅ Safe to apply:
--     DROP POLICY IF EXISTS — idempotent, safe if policy already removed
--     No DROP TABLE / TRUNCATE / DELETE
--     No changes to existing data
--     RLS remains enabled
--
-- ⚠️  Apply manually via Supabase SQL Editor (Dashboard → SQL Editor → paste → Run).

-- ─── Remove overly permissive write policies ─────────────────────────────────

-- Remove INSERT policy: authenticated clients must NOT insert directly.
-- Insertions happen via server API routes using SUPABASE_SERVICE_ROLE_KEY
-- after app-level authorization (role check, validation, safety flags).
DROP POLICY IF EXISTS "Auth insert agent_action_log" ON public.agent_action_log;

-- Remove UPDATE policy: authenticated clients must NOT update directly.
-- Approval/rejection status transitions happen via server API routes using
-- SUPABASE_SERVICE_ROLE_KEY after verifying the caller has admin/manager role.
DROP POLICY IF EXISTS "Auth update agent_action_log" ON public.agent_action_log;

-- Drop alternate policy names that may exist from earlier drafts.
DROP POLICY IF EXISTS "agent_action_log_insert_authenticated" ON public.agent_action_log;
DROP POLICY IF EXISTS "agent_action_log_update_authenticated" ON public.agent_action_log;

-- ─── Ensure RLS is enabled ────────────────────────────────────────────────────

ALTER TABLE public.agent_action_log ENABLE ROW LEVEL SECURITY;

-- ─── Re-confirm SELECT policy (idempotent) ────────────────────────────────────

-- Drop and recreate with canonical name to ensure it exists after the fix.
DROP POLICY IF EXISTS "Auth read agent_action_log" ON public.agent_action_log;
DROP POLICY IF EXISTS "agent_action_log_select_authenticated" ON public.agent_action_log;

CREATE POLICY "agent_action_log_select_authenticated"
  ON public.agent_action_log
  FOR SELECT
  TO authenticated
  USING (true);

-- No INSERT policy for authenticated.
-- No UPDATE policy for authenticated.
-- No DELETE policy for anyone via client (permanent audit trail).
--
-- All writes (INSERT for new log records, UPDATE for approval status) are performed
-- exclusively by server-side API routes via SUPABASE_SERVICE_ROLE_KEY, which bypasses
-- RLS entirely. App-level authorization (getRole(), session check) is enforced in
-- the API route handler before the DB call is made.

-- ─── Update table comment to reflect final security model ─────────────────────

COMMENT ON TABLE public.agent_action_log IS
  'Audit log for AI agent actions in the proposal-engineer runtime. '
  'Stores draft КП, approval state, tool diagnostics, and safety flags. '
  'Records are never deleted — archive via status = ''archived'' instead. '
  'RLS: authenticated users may SELECT only. '
  'INSERT and UPDATE are restricted to server API routes via service_role key.';
