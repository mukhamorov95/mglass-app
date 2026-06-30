-- supabase/migrations/20260701_production_tasks.sql
--
-- Personal production queues for the B2B workshop.
-- Adds production_tasks (one row per order item x stage), plus a station
-- field on users. Does NOT touch b2b_orders.notes.stages / detail_stages —
-- those remain the order-level and audit source of truth during the
-- coexistence period (see SESSION.md / docs for the phased migration plan).
--
-- ✅ Safe to apply:
--      ALTER TABLE ... ADD COLUMN IF NOT EXISTS — idempotent
--      CREATE TABLE IF NOT EXISTS  — idempotent
--      CREATE INDEX IF NOT EXISTS  — idempotent
--      No DROP / TRUNCATE / DELETE, no changes to existing tables' data
--      RLS enabled, conservative policies (no anonymous write)
--
-- ⚠️  Apply manually via Supabase SQL Editor (Dashboard → SQL Editor → paste → Run),
--     same as every other migration in this repo — there is no automated runner.

-- ─── users: production station (single field, not a separate table) ───────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS production_station text;

COMMENT ON COLUMN public.users.production_station IS
  'Default station for production-role workers: cutting|polishing|drilling|tempering|packaging
   (same vocabulary as lib/productionStages.ts DetailStageKey, minus problem).
   NULL = not a fixed-station worker (e.g. supervisor). Validated at the application
   layer, not via CHECK, to avoid coupling this table to that TS module.';

-- ─── production_tasks ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.production_tasks (
  id               bigserial    PRIMARY KEY,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),

  -- ── Identity: one row per (order item, stage) ──────────────────────────────
  order_id         bigint       NOT NULL REFERENCES public.b2b_orders(id) ON DELETE CASCADE,
  item_index       int          NOT NULL,   -- matches b2b_orders.items[item_index], same indexing as notes.detail_stages keys
  stage_key        text         NOT NULL,   -- 'cutting'|'polishing'|'drilling'|'tempering'|'packaging'
  sequence_order   int          NOT NULL,   -- per-item stage order — drives ORDER BY in personal queue

  -- ── Routing ──────────────────────────────────────────────────────────────
  station          text         NOT NULL,   -- same vocabulary as users.production_station
  assigned_to      uuid         REFERENCES public.users(id) ON DELETE SET NULL,
  -- nullable: unassigned tasks sit in a station pool, picked up by whoever is
  -- logged in at that station (users.production_station).
  blocked_by_task_id bigint     REFERENCES public.production_tasks(id) ON DELETE SET NULL,
  -- Points to the previous-stage task for the SAME item. NULL = first stage, never blocked.
  -- A task is actionable when this is NULL or that task.status = 'done'.

  -- ── State machine ────────────────────────────────────────────────────────
  status           text         NOT NULL DEFAULT 'queued',
  -- 'queued'      — exists, blocked or not yet started
  -- 'in_progress' — worker started it (started_at set)
  -- 'done'        — completed (completed_at set)
  -- 'problem'     — andon raised (problem_reason_code set)

  started_at       timestamptz,
  completed_at     timestamptz,

  -- ── Andon ────────────────────────────────────────────────────────────────
  problem_reason_code text,
  problem_comment      text,
  problem_at            timestamptz,
  problem_resolved_at   timestamptz,   -- NULL while active — drives the live andon board query

  -- ── Day batching ─────────────────────────────────────────────────────────
  production_day   date,        -- workday this task is expected on; NULL until scheduled

  CONSTRAINT pt_stage_key_valid CHECK (
    stage_key IN ('cutting','polishing','drilling','tempering','packaging')
  ),
  CONSTRAINT pt_station_valid CHECK (
    station IN ('cutting','polishing','drilling','tempering','packaging')
  ),
  CONSTRAINT pt_status_valid CHECK (
    status IN ('queued','in_progress','done','problem')
  ),
  CONSTRAINT pt_problem_reason_valid CHECK (
    problem_reason_code IS NULL OR problem_reason_code IN (
      'cut_defect','crack','scratch','wrong_size','material_defect',
      'tempering_defect','polishing_defect','drilling_defect',
      'material_missing','equipment_down','other'
    )
  ),
  CONSTRAINT pt_problem_requires_reason CHECK (
    status != 'problem' OR problem_reason_code IS NOT NULL
  ),
  CONSTRAINT pt_unique_item_stage UNIQUE (order_id, item_index, stage_key)
  -- One task per (order item, stage) — re-running generation is idempotent via ON CONFLICT.
);

COMMENT ON TABLE public.production_tasks IS
  'Per-item, per-stage production routing rows generated when a B2B order is launched
   into production. Powers personal worker queues (app/production-app/my-queue) and the
   shop-floor "Пул на сегодня" supervisor view (app/production-app/today). Coexists with
   b2b_orders.notes.detail_stages during migration; detail_stages remains the legacy
   write target for /p/o until cutover. No backfill for orders launched before this
   migration — they keep working through the JSON-only path indefinitely.';

COMMENT ON COLUMN public.production_tasks.blocked_by_task_id IS
  'Previous-stage task for the same item. Drives "ещё не пришло от предыдущего этапа" in the worker UI.';

COMMENT ON COLUMN public.production_tasks.production_day IS
  'Workday this task is scheduled for. "Пул на сегодня" filters WHERE production_day = current_date
   OR (status NOT IN (''done'') AND production_day < current_date) to surface overdue carry-over.';

-- ─── updated_at trigger (reuse existing function) ────────────────────────────
DROP TRIGGER IF EXISTS set_production_tasks_updated_at ON public.production_tasks;
CREATE TRIGGER set_production_tasks_updated_at
  BEFORE UPDATE ON public.production_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Personal queue: the hot path.
-- "SELECT * FROM production_tasks WHERE assigned_to = $user AND status IN (...) ORDER BY sequence_order"
CREATE INDEX IF NOT EXISTS pt_assigned_queue_idx
  ON public.production_tasks (assigned_to, sequence_order)
  WHERE status IN ('queued','in_progress');

-- Station pool for "Пул на сегодня": WHERE station = $s AND production_day = today
CREATE INDEX IF NOT EXISTS pt_station_day_idx
  ON public.production_tasks (station, production_day, status);

-- Reverse lookup: what's downstream of this task (cascade UI hints).
CREATE INDEX IF NOT EXISTS pt_blocked_by_idx
  ON public.production_tasks (blocked_by_task_id)
  WHERE blocked_by_task_id IS NOT NULL;

-- Order detail view / regeneration idempotency check.
CREATE INDEX IF NOT EXISTS pt_order_item_idx
  ON public.production_tasks (order_id, item_index);

-- Live andon board: active problems across all stations, newest first.
CREATE INDEX IF NOT EXISTS pt_active_problems_idx
  ON public.production_tasks (problem_at DESC)
  WHERE status = 'problem' AND problem_resolved_at IS NULL;

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- Same pattern as 20260603_agent_action_log.sql: authenticated read/insert/update, no delete.
ALTER TABLE public.production_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth read production_tasks"
  ON public.production_tasks FOR SELECT TO authenticated USING (true);

CREATE POLICY "Auth insert production_tasks"
  ON public.production_tasks FOR INSERT TO authenticated WITH CHECK (true);
  -- Generation runs server-side with SUPABASE_SERVICE_ROLE_KEY (bypasses RLS), same
  -- as the rest of the order-launch flow — policy exists for any future user-session write.

CREATE POLICY "Auth update production_tasks"
  ON public.production_tasks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  -- Matches existing posture: app/p/o/[orderId]/page.tsx already lets any authenticated
  -- user update b2b_orders.notes today. Tightening this is a separate, explicit decision.

-- No DELETE policy — tasks are not deleted, only transitioned.
