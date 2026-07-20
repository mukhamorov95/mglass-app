-- Раздел «Бухгалтерия» (Б1): роль accountant, фонды/подфонды ДДС, операции.
-- Структура фондов повторяет Google-листы «ИП ДДС»/«ООО ДДС» владельца:
-- фонд (жёлтая строка, класс переменные/постоянные/фонды) → подфонды.
-- Правило владельца: маржа = поступления − переменные; постоянные и фонды
-- наполняются после маржи сверху вниз (финнеделя чт–ср — этап Б3).

create table cashflow_funds (
  id         bigserial primary key,
  unit       text not null check (unit in ('ip','ooo')),
  flow       text not null check (flow in ('in','out')),
  fund_class text not null check (fund_class in ('income','variable','fixed','fund')),
  name       text not null,
  percent    numeric(6,3),          -- целевой % из финмодели (null = не задан)
  sort       int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (unit, flow, name)
);

create table cashflow_subfunds (
  id       bigserial primary key,
  fund_id  bigint not null references cashflow_funds(id) on delete cascade,
  name     text not null,
  sort     int not null default 0,
  active   boolean not null default true,
  unique (fund_id, name)
);

create table cashflow_accounts (
  id     bigserial primary key,
  unit   text not null check (unit in ('ip','ooo')),
  name   text not null,
  sort   int not null default 0,
  active boolean not null default true,
  unique (unit, name)
);

create table cashflow_entries (
  id            bigserial primary key,
  entry_date    date not null,
  unit          text not null check (unit in ('ip','ooo')),
  kind          text not null check (kind in ('in','out')),
  fund_id       bigint not null references cashflow_funds(id),
  subfund_id    bigint references cashflow_subfunds(id),
  amount        numeric(14,2) not null check (amount > 0),
  account       text,
  counterparty  text,
  comment       text,
  entered_by      uuid references users(id) on delete set null,
  entered_by_name text,
  import_batch  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_cf_entries_date on cashflow_entries (unit, entry_date desc);
create index idx_cf_entries_fund on cashflow_entries (fund_id, entry_date desc);

alter table cashflow_funds    enable row level security;
alter table cashflow_subfunds enable row level security;
alter table cashflow_accounts enable row level security;
alter table cashflow_entries  enable row level security;

-- Финансовый контур: accountant, cfo и владельцы. Остальные роли — ничего.
create policy cf_funds_select on cashflow_funds for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);
create policy cf_funds_write on cashflow_funds for all to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
) with check (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);
create policy cf_subfunds_all on cashflow_subfunds for all to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
) with check (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);
create policy cf_accounts_all on cashflow_accounts for all to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
) with check (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);
create policy cf_entries_select on cashflow_entries for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);
create policy cf_entries_insert on cashflow_entries for insert to authenticated with check (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);
create policy cf_entries_update on cashflow_entries for update to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);
-- DELETE только admin: операции не исчезают по ошибке
create policy cf_entries_delete on cashflow_entries for delete to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role = 'admin')
);
