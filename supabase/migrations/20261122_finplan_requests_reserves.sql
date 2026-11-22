-- ФП Ф4а (docs/finplan/FINPLAN_ROUTE.md): четыре суммы заявки, несколько оплат,
-- недельная директива ФП с утверждением исп. директором и CFO, резерв фонда.
-- Резерв = одобрено − оплачено у заявок окончательно утверждённой недели, пока
-- заявка не закрыта. Деньги ДДС меняются только фактом оплаты.

alter table public.payment_requests
  add column if not exists approved_amount numeric(14,2) check (approved_amount >= 0),
  add column if not exists week_end date,
  add column if not exists decision text check (decision in ('full','partial','rework','postpone')),
  add column if not exists decision_by text,
  add column if not exists decision_at timestamptz,
  add column if not exists justification text,
  add column if not exists delay_impact text,
  add column if not exists prev_request_id bigint references public.payment_requests(id),
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by text;

alter table public.payment_requests drop constraint if exists payment_requests_status_check;
alter table public.payment_requests add constraint payment_requests_status_check
  check (status in ('pending','approved','postponed','cancelled','paid','rework'));

create index if not exists idx_payreq_week on public.payment_requests (unit, week_end);

create table if not exists public.payment_request_payments (
  id          bigserial primary key,
  request_id  bigint not null references public.payment_requests(id),
  entry_id    bigint references public.cashflow_entries(id),
  amount      numeric(14,2) not null check (amount > 0),
  paid_on     date not null,
  account     text,
  proof_path  text,
  paid_by_name text,
  created_at  timestamptz not null default now(),
  unique (entry_id)
);
create index if not exists idx_payreq_pay_req on public.payment_request_payments (request_id);

create table if not exists public.fp_directives (
  id         bigserial primary key,
  unit       text not null check (unit in ('ip','ooo')),
  week_end   date not null,
  status     text not null default 'open' check (status in ('open','exec_ok','final')),
  exec_by    text,
  exec_at    timestamptz,
  final_by   text,
  final_at   timestamptz,
  snapshot   jsonb,
  unique (unit, week_end)
);

alter table public.payment_request_payments enable row level security;
alter table public.fp_directives enable row level security;

drop policy if exists payreq_pay_select on public.payment_request_payments;
create policy payreq_pay_select on public.payment_request_payments for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
  or exists (select 1 from public.payment_requests r where r.id = request_id and r.created_by = auth.uid())
);
drop policy if exists payreq_pay_insert on public.payment_request_payments;
create policy payreq_pay_insert on public.payment_request_payments for insert to authenticated with check (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);

-- Директиву читает финконтур; пишет только сервер (/api/finplan/directive) после
-- проверки денег фондов — у authenticated политик записи нет.
drop policy if exists fp_dir_select on public.fp_directives;
create policy fp_dir_select on public.fp_directives for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);

drop trigger if exists audit_change on public.payment_requests;
create trigger audit_change after insert or delete or update on public.payment_requests
  for each row execute function audit_change('id', '', '');
drop trigger if exists audit_change on public.fp_directives;
create trigger audit_change after insert or delete or update on public.fp_directives
  for each row execute function audit_change('unit,week_end', '', '');
drop trigger if exists audit_change on public.payment_request_payments;
create trigger audit_change after insert or delete or update on public.payment_request_payments
  for each row execute function audit_change('request_id', '', '');

-- Окончательно утверждённую неделю нельзя расширить с экрана: одобренная сумма и
-- новое «одобрено» в ней меняются только через повторное рассмотрение (заявка
-- уходит в другую неделю).
create or replace function public.payment_request_final_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.week_end is not null and new.week_end = old.week_end
     and exists (select 1 from fp_directives d where d.unit = new.unit and d.week_end = new.week_end and d.status = 'final')
     and (new.approved_amount is distinct from old.approved_amount
          or (new.status = 'approved' and old.status <> 'approved')
          or new.fund_id <> old.fund_id) then
    raise exception 'Неделя % утверждена окончательно — изменить одобрение можно только повторным рассмотрением', new.week_end;
  end if;
  return new;
end $$;
drop trigger if exists payment_request_final_guard on public.payment_requests;
create trigger payment_request_final_guard before update on public.payment_requests
  for each row execute function public.payment_request_final_guard();
