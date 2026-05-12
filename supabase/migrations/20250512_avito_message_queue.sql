-- close_reason column for ai_managed_chats (may already exist via code)
ALTER TABLE ai_managed_chats ADD COLUMN IF NOT EXISTS close_reason text;

-- ─── Raw message storage ───────────────────────────────────────────────────────
-- Every incoming Wazzup/Avito message is saved here FIRST, before any processing.
CREATE TABLE IF NOT EXISTS avito_messages_raw (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wazzup_message_id   text        UNIQUE,
  chat_id             text        NOT NULL,
  channel_id          text        NOT NULL,
  chat_type           text        NOT NULL DEFAULT 'whatsapp',
  direction           text        NOT NULL DEFAULT 'incoming'
                                  CHECK (direction IN ('incoming', 'outgoing')),
  message_type        text        NOT NULL DEFAULT 'text'
                                  CHECK (message_type IN ('text', 'photo', 'audio', 'file', 'video', 'system', 'unknown')),
  text                text,
  contact_name        text,
  attachments_json    jsonb,
  raw_payload_json    jsonb       NOT NULL DEFAULT '{}',
  received_at         timestamptz NOT NULL DEFAULT now(),
  processing_status   text        NOT NULL DEFAULT 'pending'
                                  CHECK (processing_status IN ('pending', 'processing', 'done', 'failed')),
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ─── Message processing queue ─────────────────────────────────────────────────
-- Each raw message gets exactly one queue entry.
-- Worker picks pending/retry items, syncs to AmoCRM, then runs AI.
CREATE TABLE IF NOT EXISTS message_queue (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source          text        NOT NULL DEFAULT 'wazzup',
  raw_message_id  uuid        NOT NULL REFERENCES avito_messages_raw(id) ON DELETE CASCADE,
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN (
                                'pending', 'processing',
                                'synced_to_amocrm', 'ai_processed',
                                'failed', 'retry_scheduled'
                              )),
  attempts        int         NOT NULL DEFAULT 0,
  max_attempts    int         NOT NULL DEFAULT 5,
  next_retry_at   timestamptz,
  last_error      text,
  amo_lead_id     bigint,
  ai_response     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── External conversation links (Wazzup chat ↔ AMO contact/lead) ─────────────
CREATE TABLE IF NOT EXISTS external_conversations (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source              text        NOT NULL DEFAULT 'wazzup',
  external_chat_id    text        NOT NULL,
  external_channel_id text,
  chat_type           text        NOT NULL DEFAULT 'whatsapp',
  amo_contact_id      bigint,
  amo_lead_id         bigint,
  assigned_manager_id bigint,
  client_name         text,
  last_message_at     timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_chat_id)
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_avito_raw_chat_id
  ON avito_messages_raw(chat_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_avito_raw_status
  ON avito_messages_raw(processing_status);

CREATE INDEX IF NOT EXISTS idx_message_queue_status
  ON message_queue(status, next_retry_at NULLS FIRST);

CREATE INDEX IF NOT EXISTS idx_message_queue_raw
  ON message_queue(raw_message_id);

CREATE INDEX IF NOT EXISTS idx_ext_conv_chat_id
  ON external_conversations(source, external_chat_id);

CREATE INDEX IF NOT EXISTS idx_ext_conv_amo_lead
  ON external_conversations(amo_lead_id);
