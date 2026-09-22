-- График менеджера — норма, с которой /commercial/activity сравнивает факт из AmoCRM.
-- Без нормы экран не отличает короткий день от согласованного графика, а пустую
-- неделю — от работы, которая ещё не началась (Алина должна была выйти с 09.09.2026,
-- а замер 25.08–21.09 записал ей «пустую неделю» 01–04.09).
-- Пишет только API после проверки роли (service role); читать напрямую может владелец.

create table if not exists manager_schedules (
  amo_user_id  bigint primary key,
  name         text        not null,
  starts_on    date,
  work_from    time,
  work_to      time,
  work_days    smallint[]  not null default '{1,2,3,4,5}',
  note         text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);

alter table manager_schedules enable row level security;

drop policy if exists "Owner reads manager_schedules" on manager_schedules;
create policy "Owner reads manager_schedules" on manager_schedules
  for select to authenticated using (public.is_owner());

insert into manager_schedules (amo_user_id, name, starts_on, note)
values (8272804, 'Алина', '2026-09-09', 'Со слов владельца 22.09.2026: должна была работать с 09.09')
on conflict (amo_user_id) do nothing;
