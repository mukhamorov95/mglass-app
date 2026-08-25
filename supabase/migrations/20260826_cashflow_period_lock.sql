-- Б10: закрытие месяца и журнал правок ДДС.
-- Пока месяц открыт, любую строку прошлого периода можно изменить, и вчерашний
-- отчёт назавтра другой. Закрытый месяц не принимает ни вставку, ни правку, ни
-- удаление — даже от service-role (проверка в триггере, а не в RLS: серверные
-- роуты RLS обходят). Чтобы поправить закрытый месяц, его сначала открывают —
-- и это видно в журнале.
create table if not exists cashflow_period_locks (
  unit       text not null check (unit in ('ip','ooo')),
  month      text not null check (month ~ '^\d{4}-\d{2}$'),
  locked_at  timestamptz not null default now(),
  locked_by  text,
  note       text,
  primary key (unit, month)
);
alter table cashflow_period_locks enable row level security;
create policy cf_locks_select on cashflow_period_locks for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);

create table if not exists cashflow_entry_log (
  id         bigserial primary key,
  entry_id   bigint,
  action     text not null check (action in ('insert','update','delete')),
  unit       text,
  entry_date date,
  before     jsonb,
  after      jsonb,
  actor      text,
  at         timestamptz not null default now()
);
create index if not exists idx_cf_log_entry on cashflow_entry_log (entry_id, at desc);
alter table cashflow_entry_log enable row level security;
create policy cf_log_select on cashflow_entry_log for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);

create or replace function public.cashflow_guard_and_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  d date := coalesce(new.entry_date, old.entry_date);
  u text := coalesce(new.unit, old.unit);
  locked boolean;
  who text;
begin
  select true into locked from cashflow_period_locks
   where unit = u and month = to_char(d, 'YYYY-MM');
  if locked then
    raise exception 'Месяц % по % закрыт — сначала откройте период', to_char(d, 'YYYY-MM'), u
      using errcode = 'check_violation';
  end if;

  select coalesce(nullif(current_setting('request.jwt.claim.email', true), ''),
                  (select name from users where id = auth.uid()))
    into who;

  if tg_op = 'INSERT' then
    insert into cashflow_entry_log (entry_id, action, unit, entry_date, after, actor)
    values (new.id, 'insert', new.unit, new.entry_date, to_jsonb(new),
            coalesce(who, new.entered_by_name));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into cashflow_entry_log (entry_id, action, unit, entry_date, before, after, actor)
    values (new.id, 'update', new.unit, new.entry_date, to_jsonb(old), to_jsonb(new),
            coalesce(who, new.entered_by_name));
    return new;
  else
    insert into cashflow_entry_log (entry_id, action, unit, entry_date, before, actor)
    values (old.id, 'delete', old.unit, old.entry_date, to_jsonb(old),
            coalesce(who, old.entered_by_name));
    return old;
  end if;
end $$;

drop trigger if exists cashflow_entries_guard on cashflow_entries;
create trigger cashflow_entries_guard
  before insert or update or delete on cashflow_entries
  for each row execute function public.cashflow_guard_and_log();
