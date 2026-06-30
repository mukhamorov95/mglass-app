-- B2B orders: explicit authorship + first-class launch date.
-- Idempotent: re-running is safe. Does not drop or rename anything.
--
-- Deployment order:
--   1) Apply this migration first (production SQL Editor or supabase db push).
--   2) Then deploy the application code that writes/reads these columns.
-- Reversed order would let existing code keep working (only JSON notes are read),
-- but the new code requires these columns to exist before it inserts/updates them.

ALTER TABLE public.b2b_orders
  ADD COLUMN IF NOT EXISTS created_by_name      text,
  ADD COLUMN IF NOT EXISTS updated_by_user_id   uuid,
  ADD COLUMN IF NOT EXISTS updated_by_name      text,
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz,
  ADD COLUMN IF NOT EXISTS converted_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS converted_by_name    text,
  ADD COLUMN IF NOT EXISTS launched_by_user_id  uuid,
  ADD COLUMN IF NOT EXISTS launched_by_name     text,
  ADD COLUMN IF NOT EXISTS launched_at          date;

CREATE INDEX IF NOT EXISTS b2b_orders_launched_at_idx
  ON public.b2b_orders(launched_at)
  WHERE archived_at IS NULL;

-- Backfill from existing JSON notes. We only fill NULL cells so anything
-- explicitly set later is preserved.
-- notes is `text` in current schema, so we guard with a JSON-shape check before
-- casting to jsonb.
UPDATE public.b2b_orders
SET launched_at = COALESCE(
  launched_at,
  NULLIF((notes::jsonb)->>'launched_at', '')::date
)
WHERE notes IS NOT NULL
  AND notes ~ '^\s*\{'
  AND launched_at IS NULL;

UPDATE public.b2b_orders
SET created_by_name = COALESCE(
  created_by_name,
  (notes::jsonb)->>'manager_name'
)
WHERE notes IS NOT NULL
  AND notes ~ '^\s*\{'
  AND created_by_name IS NULL;

-- Note: JSON notes.launched_at / notes.manager_name are NOT removed.
-- Application code writes to both column and JSON during the transition window.
