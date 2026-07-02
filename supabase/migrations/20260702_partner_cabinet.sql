-- ============================================================================
-- Кабинет партнёра — БД-фундамент (аддитивно, безопасно для внутренних).
-- Применять в Supabase SQL Editor (MCP в этой сессии без токена, DDL иначе не идёт).
-- ПОРЯДОК: сначала этот файл, затем — завести партнёров (см. КОММЕНТ в конце).
-- ============================================================================

-- 1) Привязка карточки клиента к учётке партнёра (если ещё не применяли 20260701_b2b_client_portal)
ALTER TABLE public.b2b_clients
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_b2b_clients_user_id ON public.b2b_clients (user_id) WHERE user_id IS NOT NULL;

-- 2) Источник заказа: отделяем партнёрское от внутреннего (для фильтров/аналитики)
ALTER TABLE public.b2b_orders
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'internal';
CREATE INDEX IF NOT EXISTS idx_b2b_orders_source ON public.b2b_orders (source) WHERE source <> 'internal';

-- 3) helper: текущий пользователь — партнёр? (SECURITY DEFINER — читает users в обход RLS)
CREATE OR REPLACE FUNCTION auth.is_partner() RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND lower(role) = 'partner')
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 4) Partner-RLS: партнёр читает ТОЛЬКО свою карточку и свои заказы.
--    Аддитивно (политики складываются по ИЛИ). Для внутренних условие user_id=auth.uid()
--    ложно → no-op; их org-политика цела.
--    ВАЖНО: изоляция сработает, ТОЛЬКО если партнёр НЕ в profiles org=1 (иначе org
--    FOR ALL политика пропустит его ко всему оргу). См. КОММЕНТ ниже.
DROP POLICY IF EXISTS "Partner reads own client" ON public.b2b_clients;
CREATE POLICY "Partner reads own client" ON public.b2b_clients
  FOR SELECT TO authenticated USING ( user_id = auth.uid() );

DROP POLICY IF EXISTS "Partner reads own orders" ON public.b2b_orders;
CREATE POLICY "Partner reads own orders" ON public.b2b_orders
  FOR SELECT TO authenticated
  USING ( client_id IN (SELECT id FROM public.b2b_clients WHERE user_id = auth.uid()) );

-- ============================================================================
-- ЗАВЕДЕНИЕ ПАРТНЁРА (делает владелец вручную, ПОСЛЕ применения выше):
--   1. Создать auth-учётку партнёру (Supabase Auth → Add user).
--   2. INSERT INTO public.users (id, role) VALUES ('<uid>', 'partner');
--   3. UPDATE public.b2b_clients SET user_id = '<uid>' WHERE id = <client_id>;
--   4. ДЛЯ ИЗОЛЯЦИИ: НЕ добавлять партнёру строку в public.profiles с organization_id=1.
--      Рекомендуется отдельная org:
--        INSERT INTO organizations (name) VALUES ('partner:<name>') RETURNING id;  -- новый org_id
--        INSERT INTO profiles (user_id, organization_id, role) VALUES ('<uid>', <org_id>, 'partner');
--      Тогда auth.org_id() вернёт пустую org, и org-FOR-ALL политика по org=1 партнёра не пропустит —
--      останется только "Partner reads own orders".
-- ============================================================================
