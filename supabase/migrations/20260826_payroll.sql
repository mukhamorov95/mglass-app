-- Б11: зарплатный контур. Люди в ДДС уже есть — это подфонды «Фонда оплаты
-- труда» и «Сдельной зарплаты». Выплата = операция ДДС по такому подфонду,
-- её и берём как факт. Не хватало другой половины: НАЧИСЛЕНО. Без неё нельзя
-- сказать, сколько человеку должны — видно только сколько ему отдали.
create table if not exists payroll_accruals (
  id           bigserial primary key,
  unit         text not null check (unit in ('ip','ooo')),
  fund_id      bigint not null references cashflow_funds(id),
  subfund_id   bigint references cashflow_subfunds(id),
  person_name  text not null,              -- имя на момент начисления (подфонд могут переименовать)
  month        text not null check (month ~ '^\d{4}-\d{2}$'),
  kind         text not null default 'оклад'
               check (kind in ('оклад','сделка','премия','аванс','НДФЛ','взносы','прочее')),
  amount       numeric(14,2) not null check (amount > 0),
  note         text,
  created_by      uuid references users(id) on delete set null,
  created_by_name text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_payroll_month on payroll_accruals (unit, month);
create index if not exists idx_payroll_person on payroll_accruals (subfund_id, month);

alter table payroll_accruals enable row level security;
create policy payroll_select on payroll_accruals for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);
-- Пишет серверный роут (service-role) — он же проверяет роль и закрытый период.
