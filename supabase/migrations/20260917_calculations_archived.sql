-- Расчёт без клиента можно убрать с глаз, не удаляя.
--
-- «Мой день» показывает расчёты, не попавшие ни в одну сделку. Часть из них —
-- хвосты: посчитали на бегу, клиент не назвался, привязывать некуда. Удалять
-- нельзя (по расчёту считали цену, его ищут и переоткрывают), а висеть вечно
-- они не должны — список перестаёт быть списком дел.
--
-- status='archive' для этого не годится: статус расчёта означает стадию сделки
-- («отправлено», «согласовано») и уходит в отчёты. Архив — отдельная ось.

alter table public.calculations
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid;

-- Выборка «Моего дня»: расчёты без сделки и не в архиве, свежие сверху.
create index if not exists calculations_orphan_active_idx
  on public.calculations (created_at desc)
  where deal_id is null and archived_at is null;

comment on column public.calculations.archived_at is
  'Убран из «Расчётов без клиента» в «Моём дне». Сам расчёт остаётся доступным.';
