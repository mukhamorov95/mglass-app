-- Ш3 (docs/configurator/SHOWROOM_COST_ROUTE.md): заявка 3D-конструктора несёт состав
-- (модель, размеры, стекло, цвет, выбор фурнитуры) и ведёт в сделку приложения —
-- решение 11 от 02.10: Telegram и сделка у нас, AmoCRM не трогаем.
alter table public.site_leads
  add column if not exists config jsonb,
  add column if not exists deal_id bigint references public.deals(id) on delete set null;

create index if not exists site_leads_deal_id_idx on public.site_leads(deal_id);
