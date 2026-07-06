-- Контур монтажа v1: наряды на монтаж/замер получают бригаду, клиента и живые статусы.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS brigade_id  uuid REFERENCES public.brigades(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_name text;

ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('planned', 'on_way', 'done', 'issue', 'cancelled'));

CREATE INDEX IF NOT EXISTS appointments_sched_idx ON public.appointments (scheduled_at, type, status);
