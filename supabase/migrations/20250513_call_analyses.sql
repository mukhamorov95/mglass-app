CREATE TABLE IF NOT EXISTS call_analyses (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amo_lead_id         integer NOT NULL,
  amo_note_id         bigint,
  call_date           timestamptz,
  duration_sec        integer,
  phone               text,
  direction           text CHECK (direction IN ('in', 'out')),
  recording_url       text,
  transcription       text,
  summary             text,
  client_needs        jsonb,
  objections          jsonb,
  recommended_message text,
  tasks               jsonb,
  next_step           text,
  probability         integer CHECK (probability BETWEEN 0 AND 100),
  manager_score       integer CHECK (manager_score BETWEEN 1 AND 10),
  raw_analysis        jsonb,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_analyses_lead_idx ON call_analyses (amo_lead_id);
CREATE UNIQUE INDEX IF NOT EXISTS call_analyses_note_idx ON call_analyses (amo_note_id) WHERE amo_note_id IS NOT NULL;
