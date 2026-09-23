-- Замер эффекта «Моего дня»: сколько утренних поводов человек реально закрыл к вечеру.
-- Без этого не узнать, помогает инструмент или просто висит на экране.
-- Считает крон /api/cron/coaching-effect в 19:30 по будням по утреннему снимку.

create table if not exists coaching_effect (
  day          date   not null,
  amo_user_id  bigint not null,
  name         text   not null,
  items        int    not null default 0,
  done         int    not null default 0,
  by_kind      jsonb  not null default '{}'::jsonb,
  checked_at   timestamptz not null default now(),
  primary key (day, amo_user_id)
);

alter table coaching_effect enable row level security;

drop policy if exists "Own effect or owner" on coaching_effect;
create policy "Own effect or owner" on coaching_effect
  for select to authenticated
  using (
    public.is_owner()
    or amo_user_id = (select u.amo_user_id from public.users u where u.id = auth.uid())
  );
