-- 15.10: монтажи живут в Google Календаре офиса, в installations с июля 3 строки. Перенос
-- сентября–октября и дальнейшая подтяжка (docs/installations/MONTAGE_ROUTE.md, М1).
-- Выезд ≠ заказ: у заказа бывает несколько выездов (этапы, доделки, рекламации), один выезд
-- закрывает несколько заказов («0829-2+0823-2+0869-2») — номера для связи с ведомостью
-- продаж (crm_sales.order_no) лежат массивом. Бригада в календаре — люди, а не запись
-- installation_crews: состав меняется от выезда к выезду.

alter table public.installations
  add column if not exists source            text not null default 'app',
  add column if not exists external_key      text,
  add column if not exists kind              text not null default 'install',
  add column if not exists crew_members      text[],
  add column if not exists order_nos         text[],
  add column if not exists amount_note       text,
  add column if not exists source_updated_at timestamptz;

do $$ begin
  alter table public.installations add constraint installations_source_check check (source in ('app', 'gcal'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.installations add constraint installations_kind_check check (kind in ('install', 'claim', 'rework', 'stage'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.installations add constraint installations_external_key_key unique (external_key);
exception when duplicate_object or duplicate_table then null; end $$;

create index if not exists inst_order_nos_idx on public.installations using gin (order_nos);
