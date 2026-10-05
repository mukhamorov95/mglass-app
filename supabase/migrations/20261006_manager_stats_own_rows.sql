-- «Аналитика дохода» (manager_stats_daily / _monthly): менеджер читает только свои строки.
--
-- Было: политика чтения not is_partner() — любой вошедший сотрудник (менеджер, цех,
-- замерщик) браузерным ключом читал разговоры, замеры, оплаты и поступления всех
-- менеджеров. Экраны (/api/manager-stats, «Утро» — lib/morningData.ts, загрузка книги)
-- читают service-ключом с проверкой роли, поэтому политика их не затрагивает.
--
-- В книге человек записан не так, как в users.name («Семен» → «Семён», «Дмитрий» →
-- «Дима», «Администратор» → «Влад»). Для политики имя из книги лежит в users.book_name:
-- одна строка книги — один человек (уникальный индекс). Писать users может только
-- service-role (политики на запись у authenticated нет), значит своё имя в книге
-- сотрудник сам не поменяет. Правило заполнения то же, что в lib/sales/bookNames.ts —
-- совпадение держит __tests__/access/managerStatsOwnRows.test.ts.

alter table public.users add column if not exists book_name text;

comment on column public.users.book_name is
  'Как сотрудник записан в книгах владельца («Аналитика дохода», «Продажи Мгласс»). По нему RLS manager_stats_* отдаёт менеджеру его строки.';

create unique index if not exists users_book_name_key on public.users (book_name) where book_name is not null;

update public.users set book_name = case name
    when 'Семен' then 'Семён'
    when 'Дмитрий' then 'Дима'
    when 'Администратор' then 'Влад'
    else name
  end
where book_name is null and role in ('manager', 'admin') and nullif(trim(name), '') is not null;

-- Руководство видит всех; менеджер с «видеть все сделки» — всех; остальные — только строки
-- со своим именем из книги. Флаг считается только у менеджера: у закупщика он открыт для
-- сделок, а не для денег менеджеров (экран /api/manager-stats его тоже не пускает).
drop policy if exists manager_stats_daily_read on public.manager_stats_daily;
drop policy if exists auth_read_manager_stats_daily on public.manager_stats_daily;
drop policy if exists manager_stats_daily_select on public.manager_stats_daily;
create policy manager_stats_daily_select on public.manager_stats_daily for select to authenticated using (
  exists (select 1 from crm_caller() c
          where c.u_role in ('admin', 'ceo', 'commercial', 'cfo') or (c.u_role = 'manager' and c.can_all))
  or manager = (select u.book_name from public.users u where u.id = auth.uid())
);

drop policy if exists manager_stats_monthly_read on public.manager_stats_monthly;
drop policy if exists auth_read_manager_stats_monthly on public.manager_stats_monthly;
drop policy if exists manager_stats_monthly_select on public.manager_stats_monthly;
create policy manager_stats_monthly_select on public.manager_stats_monthly for select to authenticated using (
  exists (select 1 from crm_caller() c
          where c.u_role in ('admin', 'ceo', 'commercial', 'cfo') or (c.u_role = 'manager' and c.can_all))
  or manager = (select u.book_name from public.users u where u.id = auth.uid())
);
-- INSERT/UPDATE/DELETE-политик нет: пишет только service-role (крон и скрипт загрузки книги).

revoke all on public.manager_stats_daily, public.manager_stats_monthly from anon;
