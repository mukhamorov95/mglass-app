-- ─── B2B CRM: прямые колонки + история взаимодействий ──────────────────────────
-- Supersedes 20250512_b2b_crm.sql (which was never applied).
-- All CRM fields get the crm_ prefix to avoid clashing with reserved words
-- and to make it obvious in queries which columns belong to the CRM layer.

-- ── 1. Extend b2b_clients with CRM columns ────────────────────────────────────
ALTER TABLE b2b_clients
  ADD COLUMN IF NOT EXISTS crm_segment  TEXT,
  ADD COLUMN IF NOT EXISTS crm_status   TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS crm_score    TEXT NOT NULL DEFAULT 'C',
  ADD COLUMN IF NOT EXISTS crm_city     TEXT,
  ADD COLUMN IF NOT EXISTS crm_manager  TEXT,
  ADD COLUMN IF NOT EXISTS crm_next_contact DATE,
  ADD COLUMN IF NOT EXISTS crm_notes    TEXT;

-- ── 2. Interaction history table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS b2b_interactions (
  id               BIGSERIAL    PRIMARY KEY,
  client_id        BIGINT       NOT NULL REFERENCES b2b_clients(id) ON DELETE CASCADE,
  type             TEXT         NOT NULL DEFAULT 'note',
  note             TEXT         NOT NULL DEFAULT '',
  outcome          TEXT,
  next_action      TEXT,
  next_action_date DATE,
  created_by       TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_b2b_interactions_client ON b2b_interactions(client_id, created_at DESC);

ALTER TABLE b2b_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth manage b2b_interactions"
  ON b2b_interactions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ── 3. Migrate CRM data from notes JSON → direct columns ─────────────────────
-- Only touches rows where notes looks like a JSON object.
UPDATE b2b_clients
SET
  crm_segment = CASE
    WHEN notes IS NOT NULL AND notes ~ '^\s*\{'
      AND jsonb_typeof(notes::jsonb) = 'object'
      AND (notes::jsonb)->>'crm_segment' IS NOT NULL
    THEN (notes::jsonb)->>'crm_segment'
    ELSE crm_segment
  END,
  crm_status = CASE
    WHEN notes IS NOT NULL AND notes ~ '^\s*\{'
      AND jsonb_typeof(notes::jsonb) = 'object'
      AND (notes::jsonb)->>'crm_status' IS NOT NULL
    THEN (notes::jsonb)->>'crm_status'
    ELSE crm_status
  END,
  crm_score = CASE
    WHEN notes IS NOT NULL AND notes ~ '^\s*\{'
      AND jsonb_typeof(notes::jsonb) = 'object'
      AND (notes::jsonb)->>'crm_score' IS NOT NULL
    THEN (notes::jsonb)->>'crm_score'
    ELSE crm_score
  END,
  crm_city = CASE
    WHEN notes IS NOT NULL AND notes ~ '^\s*\{'
      AND jsonb_typeof(notes::jsonb) = 'object'
    THEN (notes::jsonb)->>'crm_city'
    ELSE crm_city
  END,
  crm_manager = CASE
    WHEN notes IS NOT NULL AND notes ~ '^\s*\{'
      AND jsonb_typeof(notes::jsonb) = 'object'
    THEN (notes::jsonb)->>'crm_manager'
    ELSE crm_manager
  END,
  crm_next_contact = CASE
    WHEN notes IS NOT NULL AND notes ~ '^\s*\{'
      AND jsonb_typeof(notes::jsonb) = 'object'
      AND (notes::jsonb)->>'crm_next_contact' IS NOT NULL
      AND (notes::jsonb)->>'crm_next_contact' <> ''
    THEN ((notes::jsonb)->>'crm_next_contact')::DATE
    ELSE crm_next_contact
  END,
  crm_notes = CASE
    WHEN notes IS NOT NULL AND notes ~ '^\s*\{'
      AND jsonb_typeof(notes::jsonb) = 'object'
    THEN (notes::jsonb)->>'crm_note'
    ELSE crm_notes
  END
WHERE notes IS NOT NULL AND notes ~ '^\s*\{';

-- ── 4. Migrate interactions JSON array → b2b_interactions rows ────────────────
INSERT INTO b2b_interactions (client_id, type, note, outcome, next_action, next_action_date, created_at, created_by)
SELECT
  c.id,
  COALESCE(NULLIF(i->>'type', ''), 'note'),
  COALESCE(i->>'note', ''),
  NULLIF(i->>'outcome', ''),
  NULLIF(i->>'next_action', ''),
  CASE
    WHEN i->>'next_action_date' IS NOT NULL AND i->>'next_action_date' <> ''
    THEN (i->>'next_action_date')::DATE
  END,
  CASE
    WHEN i->>'created_at' IS NOT NULL AND i->>'created_at' <> ''
    THEN (i->>'created_at')::TIMESTAMPTZ
    ELSE now()
  END,
  i->>'created_by'
FROM b2b_clients c
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN c.notes IS NOT NULL
      AND c.notes ~ '^\s*\{'
      AND jsonb_typeof(c.notes::jsonb) = 'object'
      AND jsonb_typeof((c.notes::jsonb)->'interactions') = 'array'
    THEN (c.notes::jsonb)->'interactions'
    ELSE '[]'::jsonb
  END
) AS i
WHERE c.notes IS NOT NULL
  AND c.notes ~ '^\s*\{'
  AND jsonb_typeof(c.notes::jsonb) = 'object'
  AND jsonb_typeof((c.notes::jsonb)->'interactions') = 'array'
  AND jsonb_array_length((c.notes::jsonb)->'interactions') > 0;
