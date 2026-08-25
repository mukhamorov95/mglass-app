-- Б5: мост «оплата → ДДС». Платёж из ядра (payments) проводится в ОДДС одной
-- кнопкой: рождается cashflow_entries со ссылкой на платёж. Уникальность
-- payment_id = один платёж проводится ровно один раз (защита от дубля прихода).
-- Пропуск («это не наши деньги / не через кассу») не удаляет платёж, а помечает
-- его в отдельной таблице — правило владельца: ничего не исчезает.
alter table cashflow_entries
  add column if not exists payment_id bigint references payments(id);
create unique index if not exists idx_cf_entries_payment
  on cashflow_entries (payment_id) where payment_id is not null;

create table if not exists cashflow_payment_skips (
  payment_id  bigint primary key references payments(id) on delete cascade,
  reason      text,
  skipped_by  text,
  skipped_at  timestamptz not null default now()
);
alter table cashflow_payment_skips enable row level security;

create policy cf_skips_select on cashflow_payment_skips for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);
-- Пишет только серверный роут (service-role): он же проверяет роль.
