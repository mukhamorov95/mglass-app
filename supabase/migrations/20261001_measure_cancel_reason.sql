-- Отмена замера с причиной (владелец 01.10: «нажимает „отменён“ — выскакивает „почему?“,
-- сохраняется и видно в истории»). Отменить может и замерщик — из пула и свой замер.
-- Аддитивная: применяется до кода.
alter table public.measure_requests
  add column if not exists cancel_reason text,
  add column if not exists cancelled_by_name text,
  add column if not exists cancelled_at timestamptz;
