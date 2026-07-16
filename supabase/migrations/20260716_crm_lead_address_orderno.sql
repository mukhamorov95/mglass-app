-- Карточка лида CRM: адрес объекта и номер заказа (как в AmoCRM).
-- Применено вручную через Supabase SQL Editor 16.07.2026.
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS order_no text;
