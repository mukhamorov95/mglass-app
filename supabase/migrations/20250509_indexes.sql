-- Performance indexes for common query patterns

-- Orders: filter by manager, status, created_at (most common list queries)
CREATE INDEX IF NOT EXISTS idx_orders_manager_id   ON orders(manager_id);
CREATE INDEX IF NOT EXISTS idx_orders_status        ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at    ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_brigade_id    ON orders(brigade_id);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_zone ON orders(delivery_zone_id);

-- Order lines: joins to orders (most expensive join)
CREATE INDEX IF NOT EXISTS idx_order_lines_order_id ON order_lines(order_id);

-- Calculations: filter by creator (RLS + manager history page)
CREATE INDEX IF NOT EXISTS idx_calculations_created_by ON calculations(created_by);
CREATE INDEX IF NOT EXISTS idx_calculations_created_at ON calculations(created_at DESC);

-- Installer ratings: lookup by order and brigade
CREATE INDEX IF NOT EXISTS idx_installer_ratings_order_id   ON installer_ratings(order_id);
CREATE INDEX IF NOT EXISTS idx_installer_ratings_brigade_id ON installer_ratings(brigade_id);

-- Appointments: filter by scheduled date, order
CREATE INDEX IF NOT EXISTS idx_appointments_order_id      ON appointments(order_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_at  ON appointments(scheduled_at);

-- AI conversations: filter by user and chat
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_id ON ai_conversations(user_id);

-- Telegram sessions: lookup by telegram_id (already primary key-like but adding for safety)
CREATE INDEX IF NOT EXISTS idx_telegram_sessions_telegram_id ON telegram_sessions(telegram_id);
