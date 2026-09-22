-- Кто продавец B2C, а кто нет. Владелец 22.09.2026: «Влад и Дмитрий не продавцы»,
-- Нуржан — офис-менеджер (B2B ведёт в Noorun). Мерить их воронкой B2C нельзя:
-- норма, подсказки «Мой день» и медиана команды считаются только по продавцам,
-- остальные показываются справочно.

alter table manager_schedules add column if not exists is_seller boolean not null default true;

comment on column manager_schedules.is_seller is 'Продавец B2C: по нему считаются норма, подсказки «Мой день» и медиана команды. Не продавцы (владелец, сопровождение, офис) показываются справочно.';

insert into manager_schedules (amo_user_id, name, is_seller, work_days, note)
values
  (8352283, 'Владислав', false, '{}', 'Владелец, не продавец (со слов владельца 22.09.2026)'),
  (8272783, 'Дмитрий',   false, '{}', 'Не продавец B2C: двигает чужие сделки по этапам и закрывает задачи (со слов владельца 22.09.2026)'),
  (9309142, 'Нуржан',    false, '{}', 'Офис-менеджер M-Glass, B2B ведёт в Noorun; в продажах B2C не участвует (со слов владельца 22.09.2026)')
on conflict (amo_user_id) do update set is_seller = excluded.is_seller, note = excluded.note, work_days = excluded.work_days, updated_at = now();
