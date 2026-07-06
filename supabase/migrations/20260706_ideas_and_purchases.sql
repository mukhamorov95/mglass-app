-- Цех: «Идеи» (кайдзен-обращения рабочих) + «Купить» (заявки на расходники/инструмент).

-- ── Обращения рабочих ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.production_ideas (
  id            bigserial PRIMARY KEY,
  author_id     uuid REFERENCES auth.users(id),
  author_name   text NOT NULL DEFAULT '',
  raw_text      text NOT NULL DEFAULT '',        -- исходная расшифровка (голос/текст)
  problem       text NOT NULL DEFAULT '',        -- AI: суть проблемы
  solution      text NOT NULL DEFAULT '',        -- AI: предложенное работником решение
  ai_hint       text,                            -- AI-подсказка работнику
  status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new','review','accepted','implemented','rejected')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.production_ideas ENABLE ROW LEVEL SECURITY;
-- Рабочий видит и создаёт только свои обращения; владельцы видят все и меняют статус.
DROP POLICY IF EXISTS ideas_select ON public.production_ideas;
CREATE POLICY ideas_select ON public.production_ideas FOR SELECT TO authenticated
  USING (author_id = auth.uid() OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','ceo')));
DROP POLICY IF EXISTS ideas_insert ON public.production_ideas;
CREATE POLICY ideas_insert ON public.production_ideas FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid());
DROP POLICY IF EXISTS ideas_update_owner ON public.production_ideas;
CREATE POLICY ideas_update_owner ON public.production_ideas FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','ceo')));

-- ── Оценка руководства (скрыта от рабочих: RLS только owner) ────────────────
CREATE TABLE IF NOT EXISTS public.production_idea_reviews (
  idea_id       bigint PRIMARY KEY REFERENCES public.production_ideas(id) ON DELETE CASCADE,
  admin_notes   text,
  economy_rub   numeric(12,2),                   -- эффект ₽/мес
  economy_proof text,                            -- доказательное обоснование расчёта
  bonus_rub     numeric(12,2),                   -- премия работнику
  bonus_paid_at timestamptz,
  reviewed_by   text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.production_idea_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS idea_reviews_owner ON public.production_idea_reviews;
CREATE POLICY idea_reviews_owner ON public.production_idea_reviews FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','ceo')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','ceo')));

-- ── Заявки «Необходимо купить» (канбан цеха) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shop_purchase_requests (
  id            bigserial PRIMARY KEY,
  title         text NOT NULL,
  details       text,
  link_url      text,                            -- ссылка на товар
  qty           text,                            -- «2 шт», «5 упак.»
  status        text NOT NULL DEFAULT 'need' CHECK (status IN ('need','ordered','arrived')),
  author_id     uuid REFERENCES auth.users(id),
  author_name   text NOT NULL DEFAULT '',
  ordered_by    text,
  ordered_at    timestamptz,
  arrived_by    text,
  arrived_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shop_purchase_requests ENABLE ROW LEVEL SECURITY;
-- Заявки видят и двигают все сотрудники (общий канбан цеха).
DROP POLICY IF EXISTS spr_all ON public.shop_purchase_requests;
CREATE POLICY spr_all ON public.shop_purchase_requests FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ── Обсуждение заявки ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shop_purchase_comments (
  id            bigserial PRIMARY KEY,
  request_id    bigint NOT NULL REFERENCES public.shop_purchase_requests(id) ON DELETE CASCADE,
  author_id     uuid REFERENCES auth.users(id),
  author_name   text NOT NULL DEFAULT '',
  text          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shop_purchase_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spc_all ON public.shop_purchase_comments;
CREATE POLICY spc_all ON public.shop_purchase_comments FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS spc_request_idx ON public.shop_purchase_comments (request_id, created_at);
CREATE INDEX IF NOT EXISTS spr_status_idx ON public.shop_purchase_requests (status, created_at);
CREATE INDEX IF NOT EXISTS ideas_author_idx ON public.production_ideas (author_id, created_at);
