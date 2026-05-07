-- Persistent client → manager ownership map
-- Used to ensure returning clients always get assigned to their existing manager

CREATE TABLE IF NOT EXISTS client_ownership (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,        -- normalized: 7XXXXXXXXXX (Russian)
  contact_id  bigint,               -- AMO contact ID (for lookup by contact)
  manager_id  bigint NOT NULL,      -- AMO responsible_user_id
  is_manual   boolean NOT NULL DEFAULT false,  -- true = set by admin override
  assigned_at timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (phone)
);

CREATE INDEX IF NOT EXISTS idx_client_ownership_phone      ON client_ownership(phone);
CREATE INDEX IF NOT EXISTS idx_client_ownership_contact_id ON client_ownership(contact_id);
CREATE INDEX IF NOT EXISTS idx_client_ownership_manager    ON client_ownership(manager_id);
