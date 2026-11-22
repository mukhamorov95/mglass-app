-- ФП Ф6 (docs/finplan/FINPLAN_ROUTE.md): утверждённая версия финмодели на месяц —
-- снимок всех юнитов finplan_models с нормативами. Правка черновика после этого
-- версию не меняет; повторное утверждение того же месяца — новая версия (номер растёт),
-- прежние хранятся. Удалять и править нельзя.
create table if not exists public.finplan_model_versions (
  id          bigserial primary key,
  month       text not null check (month ~ '^\d{4}-\d{2}$'),
  version     int not null,
  data        jsonb not null,   -- { unit: data } всех юнитов на момент утверждения
  note        text,
  approved_by text,
  approved_at timestamptz not null default now(),
  unique (month, version)
);
alter table public.finplan_model_versions enable row level security;

drop policy if exists fmv_select on public.finplan_model_versions;
create policy fmv_select on public.finplan_model_versions for select to authenticated using (
  exists (select 1 from users u where u.id = (select auth.uid()) and u.role in ('admin','ceo','cfo'))
);
drop policy if exists fmv_insert on public.finplan_model_versions;
create policy fmv_insert on public.finplan_model_versions for insert to authenticated with check (
  exists (select 1 from users u where u.id = (select auth.uid()) and u.role in ('admin','ceo','cfo'))
);
drop trigger if exists audit_change on public.finplan_model_versions;
create trigger audit_change after insert or delete or update on public.finplan_model_versions
  for each row execute function audit_change('month,version', '', '');
