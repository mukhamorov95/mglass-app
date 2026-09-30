-- Расчёт и КП из сделки AmoCRM (решение владельца 30.09, docs/MANAGER_UX_ROUTE.md).
-- Розница ведёт клиентов в AmoCRM; связь расчёта и КП со сделкой — по её номеру.
-- У расчётов колонка есть с 2025-05 (integer), у КП её не было.
alter table public.commercial_proposals add column if not exists amo_lead_id bigint;

create index if not exists commercial_proposals_amo_lead_id_idx
  on public.commercial_proposals (amo_lead_id) where amo_lead_id is not null;
create index if not exists calculations_amo_lead_id_idx
  on public.calculations (amo_lead_id) where amo_lead_id is not null;
