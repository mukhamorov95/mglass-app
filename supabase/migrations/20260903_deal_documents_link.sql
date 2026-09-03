-- Шаг 1 пути сделки: документы получают связь со сделкой (nullable, как у calculations.deal_id).
-- Связь ставится в момент создания из карточки; старые не привязываем. ON DELETE SET NULL —
-- удаление сделки не роняет документ. Политики RLS уже есть на таблицах (per-manager),
-- добавление колонки их не меняет; чтение «документов по сделке» идёт сервис-клиентом со
-- скоупом в коде (как /api/deals), поэтому новые политики не требуются.

alter table public.commercial_proposals
  add column if not exists deal_id bigint references public.deals(id) on delete set null;
create index if not exists idx_cp_deal on public.commercial_proposals(deal_id) where deal_id is not null;

alter table public.contracts
  add column if not exists deal_id bigint references public.deals(id) on delete set null;
create index if not exists idx_contracts_deal on public.contracts(deal_id) where deal_id is not null;

alter table public.invoices
  add column if not exists deal_id bigint references public.deals(id) on delete set null;
create index if not exists idx_invoices_deal on public.invoices(deal_id) where deal_id is not null;
