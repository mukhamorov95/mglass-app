-- Связь заявки на замер с лидом CRM (Фаза C автономного контура Авито).
-- Аддитивно к существующей measure_requests (миграция 20260707): кнопка в карточке
-- лида создаёт заявку в общий пул замерщиков и линкует её на лид.

ALTER TABLE public.measure_requests ADD COLUMN IF NOT EXISTS lead_id bigint;
CREATE INDEX IF NOT EXISTS measure_requests_lead_idx ON public.measure_requests(lead_id);
