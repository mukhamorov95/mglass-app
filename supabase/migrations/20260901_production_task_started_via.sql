-- П2 (docs/PRODUCTION_PLAN.md) — «В работу» без трения.
--
-- Кнопка «Взял» в /production-app/my-queue существует с 30.06 и за два месяца
-- собрала 0 нажатий: статус in_progress пуст у всех 3670 задач. Ещё одна кнопка
-- была бы третьей попыткой того же. Поэтому старт выводится из действия, которое
-- рабочий и так совершает, — он раскрывает карточку заказа на своей станции.
--
-- started_via хранит, ОТКУДА пришёл сигнал. Без этого «время этапа» (П4) считало бы
-- раскрытие карточки за начало работы наравне с явным «Взял» и молча врало бы:
-- слабый сигнал должен быть отличим от сильного, а не выдавать себя за него.
--
-- ✅ Безопасно: ADD COLUMN IF NOT EXISTS + CHECK на новой колонке. Ни DROP, ни DELETE.

ALTER TABLE public.production_tasks
  ADD COLUMN IF NOT EXISTS started_via text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pt_started_via_valid' AND conrelid = 'public.production_tasks'::regclass
  ) THEN
    ALTER TABLE public.production_tasks
      ADD CONSTRAINT pt_started_via_valid
      CHECK (started_via IS NULL OR started_via IN ('button','open','scan'));
  END IF;
END $$;

COMMENT ON COLUMN public.production_tasks.started_via IS
  'Откуда пришёл сигнал начала работы:
     button — рабочий нажал «Взял» (сильный сигнал, явное намерение);
     open   — раскрыл карточку заказа на своей станции (слабый сигнал, поставлен автоматически);
     scan   — отсканировал (зарезервировано).
   NULL = работа не начиналась либо задача из истории. Аналитика длительности (П4) обязана
   различать сильный и слабый сигнал, иначе «посмотрел чертёж» засчитается как «начал резать».
   Автостарт по open снимается сам, когда рабочий раскрывает другой заказ (см. lib/production/start.ts).';

-- ─── Кто начал работу ────────────────────────────────────────────────────────
-- Автостарт НЕ должен трогать assigned_to: это ПЛАН, по нему строится очередь
-- (`assigned_to = я ИЛИ assigned_to пуст И станция моя`). Если раскрытие карточки
-- проставит assigned_to, задача уйдёт из общего пула станции и второй рабочий её
-- больше не увидит — просмотр заказа молча уводил бы чужую работу.
-- Поэтому факт начала живёт в своей паре полей, как и факт завершения (П1).

ALTER TABLE public.production_tasks
  ADD COLUMN IF NOT EXISTS started_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS started_by_name text;

COMMENT ON COLUMN public.production_tasks.started_by IS
  'ФАКТ: кто начал работу. Пара к completed_by. Автостарт (started_via = open) пишет только сюда;
   assigned_to меняет только явное «Взял».';
COMMENT ON COLUMN public.production_tasks.started_by_name IS
  'Имя начавшего на момент старта. Денормализовано (как completed_by_name) — экран «кто чем занят» (П10).';

-- «Кто чем занят прямо сейчас» (П10).
CREATE INDEX IF NOT EXISTS pt_in_progress_by_worker_idx
  ON public.production_tasks (started_by, started_at DESC)
  WHERE status = 'in_progress';
