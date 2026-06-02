-- supabase/migrations/20260603_agent_action_log.sql
--
-- Creates agent_action_log: audit table for AI agent actions,
-- proposal drafts, and approval state in the proposal-engineer runtime.
--
-- ✅ Safe to apply:
--      CREATE TABLE IF NOT EXISTS  — idempotent
--      CREATE INDEX IF NOT EXISTS  — idempotent
--      No DROP / TRUNCATE / DELETE
--      No changes to existing tables
--      RLS enabled, conservative policies (no anonymous write)
--
-- ⚠️  Apply manually via Supabase SQL Editor (Dashboard → SQL Editor → paste → Run).
--     Do NOT run supabase db push in production without review.
--     Do NOT apply without a confirmed deployment window.

-- ─── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agent_action_log (

  -- ── Identity ─────────────────────────────────────────────────────────────
  id          bigserial    PRIMARY KEY,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  -- TEXT (not uuid FK to auth.users) — decoupled from auth layer intentionally.
  -- Agent writes come via SUPABASE_SERVICE_ROLE_KEY which bypasses auth.uid().
  -- If Approval UI adds user attribution, set created_by = current manager login/email.
  created_by  text,
  approved_by text,

  -- ── Agent metadata ────────────────────────────────────────────────────────
  agent_key    text  NOT NULL,   -- 'proposal-engineer' | 'finance-controller' | ...
  skill_key    text,             -- 'create-commercial-proposal' | 'check-margin' | ...
  workflow_key text,             -- 'create-commercial-proposal-runtime' | ...
  tool_key     text,             -- 'quickCalc' | 'readPricingRules' | 'generateKpDraft' | ...

  -- ── Action metadata ───────────────────────────────────────────────────────
  -- action_type examples:
  --   'proposal_draft_created'   — createCommercialProposalRuntime completed ok
  --   'proposal_draft_updated'   — draft regenerated
  --   'proposal_approved'        — manager approved draft for sending
  --   'proposal_rejected'        — manager rejected draft
  --   'calculation_run'          — standalone quickCalcTool call
  --   'pricing_rules_read'       — standalone pricingRulesTool call
  --   'kp_draft_generated'       — standalone generateKpDraftTool call
  --   'runtime_completed'        — full orchestrator run recorded
  --   'error'                    — failed action
  action_type  text  NOT NULL,

  -- status lifecycle:
  --   draft → pending_approval → approved | rejected
  --                            → failed   (if error before approval)
  --                            → archived (manually archived, not deleted)
  status  text  NOT NULL DEFAULT 'draft',

  -- ── Business linkage ──────────────────────────────────────────────────────
  related_entity_type  text,    -- 'calculation' | 'lead' | 'deal' | 'proposal' | 'client'
  related_entity_id    text,    -- string id of the related entity (flexible type)
  client_name          text,
  client_phone         text,
  client_email         text,
  amo_lead_id          text,    -- AmoCRM lead id (text, not int — safer for API changes)

  -- Soft reference to calculations(id). No FK to avoid coupling with calculations schema.
  -- If calculations row is deleted, log record is preserved (intentional audit trail).
  calculation_id       bigint,

  proposal_title       text,

  -- ── Payloads ──────────────────────────────────────────────────────────────
  input_snapshot    jsonb  NOT NULL DEFAULT '{}'::jsonb,
  -- CreateCommercialProposalRuntimeInput or individual tool input at time of call.

  output_snapshot   jsonb  NOT NULL DEFAULT '{}'::jsonb,
  -- Normalised output (excludes draft_payload for size reasons — stored separately).

  draft_payload     jsonb,
  -- Full KpDraftContent from generateKpDraftTool. Null for non-draft actions.

  safety_snapshot   jsonb  NOT NULL DEFAULT '{}'::jsonb,
  -- Copy of safety flags at time of action:
  -- { no_db_write, no_crm_write, no_client_send, no_order_create, model_call_executed }

  approval_snapshot jsonb,
  -- Set when status transitions to approved/rejected:
  -- { approved_by, approved_at, manager_notes, action_taken }

  error_snapshot    jsonb,
  -- Structured errors from tool response. Null if ok = true.

  -- ── Human approval ────────────────────────────────────────────────────────
  -- These mirror safety flags from the runtime response — stored here for
  -- query convenience (Approval UI filters by can_send_to_client, approval_required).
  approval_required    boolean  NOT NULL DEFAULT true,
  can_send_to_client   boolean  NOT NULL DEFAULT false,
  can_write_crm        boolean  NOT NULL DEFAULT false,
  can_create_order     boolean  NOT NULL DEFAULT false,

  -- Set by Approval UI when manager takes action
  approved_at       timestamptz,
  rejected_at       timestamptz,
  rejection_reason  text,

  -- ── Diagnostics ───────────────────────────────────────────────────────────
  warnings             jsonb  NOT NULL DEFAULT '[]'::jsonb,
  -- Aggregated warnings from all tool steps (flat array of strings).

  errors               jsonb  NOT NULL DEFAULT '[]'::jsonb,
  -- Structured errors with { code, message, field?, step? }.

  runtime_version      text,
  -- Future: semantic version of createCommercialProposalRuntime for compatibility tracking.

  model_call_executed  boolean  NOT NULL DEFAULT false,
  -- Mirrors safety_snapshot.model_call_executed. Indexed for audit queries.

  model_name           text,
  -- e.g. 'claude-sonnet-4-6'. Null if model_call_executed = false.

  -- ── CHECK constraints ─────────────────────────────────────────────────────

  -- Status must be one of known lifecycle values.
  CONSTRAINT aal_status_valid CHECK (
    status IN ('draft', 'pending_approval', 'approved', 'rejected', 'failed', 'archived')
  ),

  -- agent_key and action_type must be non-empty (trim prevents whitespace-only values).
  CONSTRAINT aal_agent_key_nonempty CHECK (char_length(trim(agent_key)) > 0),
  CONSTRAINT aal_action_type_nonempty CHECK (char_length(trim(action_type)) > 0),

  -- Approval timestamp consistency.
  -- Rationale: prevents 'approved' records without an audit timestamp.
  -- Application code MUST set approved_at = now() when transitioning to 'approved'.
  -- Kept as soft CHECK (not NOT NULL) so that bulk status updates can be done in steps.
  CONSTRAINT aal_approved_at_required CHECK (
    status != 'approved' OR approved_at IS NOT NULL
  ),

  -- Rejection timestamp consistency — same rationale as above.
  CONSTRAINT aal_rejected_at_required CHECK (
    status != 'rejected' OR rejected_at IS NOT NULL
  )

);

-- ─── Table comments ───────────────────────────────────────────────────────────

COMMENT ON TABLE public.agent_action_log IS
  'Audit log for AI agent actions in the proposal-engineer runtime. '
  'Stores draft КП, approval state, tool diagnostics, and safety flags. '
  'Records are never deleted — archive via status = ''archived'' instead.';

COMMENT ON COLUMN public.agent_action_log.draft_payload IS
  'Full KpDraftContent from generateKpDraftTool. Null if action is not draft creation.';

COMMENT ON COLUMN public.agent_action_log.safety_snapshot IS
  'Copy of runtime safety flags at time of action. '
  'Allows auditing what was allowed/disallowed for each agent action.';

COMMENT ON COLUMN public.agent_action_log.calculation_id IS
  'Soft link to calculations(id) — no FK constraint to avoid coupling. '
  'Preserved if calculations row is later deleted.';

COMMENT ON COLUMN public.agent_action_log.approved_at IS
  'Timestamp when manager explicitly approved. '
  'Required if status = ''approved'' (enforced by CHECK constraint aal_approved_at_required).';

COMMENT ON COLUMN public.agent_action_log.approval_snapshot IS
  'JSON payload recorded at approval/rejection time: '
  '{ approved_by, timestamp, manager_notes, action_taken }.';

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Primary timeline
CREATE INDEX IF NOT EXISTS aal_created_at_idx
  ON public.agent_action_log (created_at DESC);

-- Agent + timeline (most common query: all actions for proposal-engineer agent)
CREATE INDEX IF NOT EXISTS aal_agent_key_created_idx
  ON public.agent_action_log (agent_key, created_at DESC);

-- Skill filter (Approval UI shows actions per skill)
CREATE INDEX IF NOT EXISTS aal_skill_key_idx
  ON public.agent_action_log (skill_key)
  WHERE skill_key IS NOT NULL;

-- Status filter — Approval UI primary query: WHERE status = 'pending_approval'
CREATE INDEX IF NOT EXISTS aal_status_idx
  ON public.agent_action_log (status);

-- Action type filter (audit: all calculation_run events, all errors)
CREATE INDEX IF NOT EXISTS aal_action_type_idx
  ON public.agent_action_log (action_type);

-- Entity lookup (all actions for a specific deal or lead)
CREATE INDEX IF NOT EXISTS aal_entity_idx
  ON public.agent_action_log (related_entity_type, related_entity_id)
  WHERE related_entity_id IS NOT NULL;

-- AmoCRM lead correlation (find all agent activity for a CRM deal)
CREATE INDEX IF NOT EXISTS aal_amo_lead_idx
  ON public.agent_action_log (amo_lead_id)
  WHERE amo_lead_id IS NOT NULL;

-- Calculation linkage (find agent history for a specific calculation)
CREATE INDEX IF NOT EXISTS aal_calculation_idx
  ON public.agent_action_log (calculation_id)
  WHERE calculation_id IS NOT NULL;

-- Approval queue — partial index on the exact Approval UI query pattern
-- WHERE approval_required = true AND status = 'pending_approval'
CREATE INDEX IF NOT EXISTS aal_pending_approval_idx
  ON public.agent_action_log (created_at DESC)
  WHERE approval_required = true AND status = 'pending_approval';

-- Model call audit (find all records where Anthropic was invoked)
CREATE INDEX IF NOT EXISTS aal_model_executed_idx
  ON public.agent_action_log (created_at DESC)
  WHERE model_call_executed = true;

-- No GIN indexes at this stage.
-- Rationale: jsonb columns (draft_payload, input_snapshot, etc.) are used for
-- display/storage, not for jsonb key search. GIN would add write overhead for
-- every insert without a clear query benefit at current scale.
-- Add GIN on draft_payload->>'proposal_title' or warnings when search is needed.

-- ─── updated_at trigger ───────────────────────────────────────────────────────
-- Reuses public.update_updated_at_column() defined in
-- 20250513_b2b_clients_updated_at.sql. CREATE OR REPLACE is idempotent.

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_aal_updated_at ON public.agent_action_log;
CREATE TRIGGER set_aal_updated_at
  BEFORE UPDATE ON public.agent_action_log
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── Row Level Security ───────────────────────────────────────────────────────
--
-- Project RLS pattern (from 20250514_agent_settings.sql):
--   SELECT:  authenticated — all logged-in users can read
--   INSERT:  authenticated — in practice only SERVICE_ROLE_KEY is used (bypasses RLS)
--   UPDATE:  authenticated — Approval UI needs UPDATE for status transitions
--   DELETE:  no policy     — deletions intentionally blocked from client layer
--
-- Note: SUPABASE_SERVICE_ROLE_KEY (used by all lib/ai-tools/) bypasses RLS entirely.
-- These policies govern access via anon/user JWT (browser/Approval UI).

ALTER TABLE public.agent_action_log ENABLE ROW LEVEL SECURITY;

-- Managers can read all records (for Approval UI review)
CREATE POLICY "Auth read agent_action_log"
  ON public.agent_action_log
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated insert (service_role key used from server bypasses this anyway)
CREATE POLICY "Auth insert agent_action_log"
  ON public.agent_action_log
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Managers need UPDATE for approval workflow:
-- status: pending_approval → approved / rejected
-- approved_at / rejected_at / rejection_reason
-- approval_snapshot
CREATE POLICY "Auth update agent_action_log"
  ON public.agent_action_log
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- No DELETE policy: records are permanent audit trail.
-- Archival is done by setting status = 'archived'.
-- Direct deletion requires service_role access only (intentionally restricted).
