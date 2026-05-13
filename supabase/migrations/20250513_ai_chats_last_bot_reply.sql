-- Track when bot last replied so webhook can distinguish bot echo vs human message
ALTER TABLE ai_managed_chats
  ADD COLUMN IF NOT EXISTS last_bot_reply_at timestamptz;

-- Also add manager_wrote to the close_reason check constraint if it exists
-- (no-op if constraint doesn't exist)
