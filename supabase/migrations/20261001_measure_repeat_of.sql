-- Повторный замер ссылается на замер, к которому он повторный (владелец 01.10: новые и
-- повторные замеры в аналитике не смешиваются — «сколько реально новых замеров за месяц»).
-- Новый замер — объект, где ещё не были; повторный — доснять/перемерить уже замеренное.
alter table public.measure_requests
  add column if not exists repeat_of bigint references public.measure_requests(id) on delete set null;
create index if not exists measure_requests_repeat_of_idx on public.measure_requests(repeat_of) where repeat_of is not null;
