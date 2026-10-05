-- План менеджера на месяц в поступлениях (предоплаты + остатки из «Аналитики дохода»),
-- решение владельца 05.10 (docs/MANAGER_MORNING_ROUTE.md, М6). Ставит владелец на
-- «Команде»; менеджер видит свой на «Утре» и в «Моих деньгах».
-- Пишет только /api/manager-plans service-ключом после requireOwner(); null = плана нет.

create table if not exists manager_month_plans (
  month        text        not null check (month ~ '^\d{4}-\d{2}$'),
  amo_user_id  bigint      not null,
  plan_money   numeric     check (plan_money is null or plan_money >= 0),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  primary key (month, amo_user_id)
);

alter table manager_month_plans enable row level security;

-- Видимость как у снимка дня: руководство — всех, менеджер — только свой план.
-- «Видеть все сделки» расширяет только менеджера: флаг стоит и у закупщика (для сделок),
-- и сам по себе не должен открывать ему планы продавцов.
drop policy if exists manager_month_plans_select on manager_month_plans;
create policy manager_month_plans_select on manager_month_plans for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('admin','ceo','commercial','cfo') or (c.u_role = 'manager' and c.can_all))
  or amo_user_id = (select u.amo_user_id from users u where u.id = auth.uid())
);
-- INSERT/UPDATE/DELETE-политик нет: пишет только service-role.

revoke all on manager_month_plans from anon;
