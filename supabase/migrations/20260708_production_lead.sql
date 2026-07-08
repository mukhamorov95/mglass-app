-- «Ответственные» цеха видят и могут отметить ЛЮБОЙ этап любого заказа
-- (Бекмурза, Никита). Обычный мастер жмёт только этап своей станции —
-- защита от случайных отметок. Owner-роли (admin/ceo) тоже могут всё.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS production_lead boolean NOT NULL DEFAULT false;

UPDATE public.users SET production_lead = true
WHERE id IN ('b55bc35d-210d-452d-959e-893684d39c24', '788906ca-db9c-44a0-8215-dfb589d3facc');
