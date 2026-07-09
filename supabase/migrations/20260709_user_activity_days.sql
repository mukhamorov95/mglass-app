-- Активность по дням: кто заходил сегодня, первый и последний заход.
-- Пишется из middleware раз в ~5 минут (тик device-ok): upsert по (user, day) —
-- first_seen ставится при INSERT (default now) и больше не трогается,
-- last_seen обновляется каждым тиком.

create table if not exists user_activity_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, day)
);

alter table user_activity_days enable row level security;

drop policy if exists activity_ins_own on user_activity_days;
create policy activity_ins_own on user_activity_days for insert with check (auth.uid() = user_id);
drop policy if exists activity_upd_own on user_activity_days;
create policy activity_upd_own on user_activity_days for update using (auth.uid() = user_id);
drop policy if exists activity_sel_own on user_activity_days;
create policy activity_sel_own on user_activity_days for select using (auth.uid() = user_id);
