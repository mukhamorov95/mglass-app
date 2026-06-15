ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_all_clients boolean NOT NULL DEFAULT false;
