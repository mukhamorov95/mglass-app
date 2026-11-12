-- Кто нажал «Отгрузить» (владелец 12.11.2026): табло «Заказы» показывает у позиции, кто её отгрузил.
alter table public.delivery_shipments
  add column if not exists shipped_by uuid references auth.users(id) on delete set null,
  add column if not exists shipped_by_name text;
comment on column public.delivery_shipments.shipped_by_name is 'Кто отправил отгрузку. До 12.11.2026 не писалось: у старых отгрузок пусто, автор — created_by.';
