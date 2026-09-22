-- Снимок «Моего дня» для менеджера: что сделать сегодня, привычка недели, что получается.
-- Считает крон /api/cron/manager-coaching раз в утро (полный сбор — около минуты запросов к amo).
-- Менеджер читает только свою строку, владелец — любую; запись только service-role из крона.

create table if not exists manager_coaching (
  amo_user_id  bigint primary key,
  name         text        not null,
  computed_at  timestamptz not null default now(),
  payload      jsonb       not null
);

alter table manager_coaching enable row level security;

drop policy if exists "Own coaching or owner" on manager_coaching;
create policy "Own coaching or owner" on manager_coaching
  for select to authenticated
  using (
    public.is_owner()
    or amo_user_id = (select u.amo_user_id from public.users u where u.id = auth.uid())
  );
