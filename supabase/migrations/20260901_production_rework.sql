-- П3 (docs/PRODUCTION_PLAN.md) — брак и переделка как рабочий статус.
--
-- Диагноз: за два месяца при 3670 задачах в системе ТРИ записи о браке (обе модели вместе),
-- и единственная использованная причина — material_missing, у которой есть своя отдельная
-- кнопка. Дело не в цене отметки: кнопка «Проблема» переводила задачу в статус problem,
-- то есть вынимала её из рабочего потока, и закрывать её потом шёл тот же самый человек.
-- Кнопка не была нейтральной — она создавала рабочему работу. Ноль был рациональным выбором.
--
-- Что рабочему нужно на самом деле: сказать «эту деталь надо изготовить заново». Сейчас
-- выразить это нечем — ранние этапы стоят done, и очередь показывает деталь готовой к
-- следующему этапу. После боя приложение врёт, а правду он держит в голове.
--
-- Поэтому П3 — не отчёт о браке, а действие «Переделать»: маршрут детали переоткрывается,
-- очередь становится правдой, а запись брака остаётся побочным эффектом.
--
-- ✅ Безопасно: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS. Ни DROP, ни DELETE.

CREATE TABLE IF NOT EXISTS public.production_rework (
  id            bigserial   PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),

  order_id       bigint     NOT NULL REFERENCES public.b2b_orders(id) ON DELETE CASCADE,
  item_index     int        NOT NULL,
  found_at_stage text       NOT NULL,
  restart_stage  text       NOT NULL,

  reason_code   text        NOT NULL,
  comment       text,

  by_user       uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  by_name       text,

  reopened_task_ids bigint[] NOT NULL DEFAULT '{}',

  CONSTRAINT pr_reason_valid CHECK (
    reason_code IN ('break','scratch','wrong_size','material_defect','other')
  )
);

COMMENT ON TABLE public.production_rework IS
  'Журнал переделок цеха (append-only). Отдельной таблицей, а не флагом на production_tasks:
   переоткрытие переиспользует ТУ ЖЕ строку задачи (уникальна по order_id+item_index+stage_key+layer),
   поэтому вторая и третья переделка на флаге были бы неотличимы от первой. Здесь каждая — своя
   строка, и у аналитики брака (П15) сразу есть материал. Записи не редактируются и не удаляются.';
COMMENT ON COLUMN public.production_rework.found_at_stage IS
  'Этап, на котором брак обнаружен — он же говорит, ГДЕ ошиблись. Поэтому список причин отвечает
   только на «что случилось», и его хватило сократить с 11 кодов до 5.';
COMMENT ON COLUMN public.production_rework.restart_stage IS
  'Этап, с которого маршрут детали переоткрыт. Выводится из причины: бой / неверный размер /
   брак материала → с резки (деталь в лом), царапина / другое → с места обнаружения.';
COMMENT ON COLUMN public.production_rework.reopened_task_ids IS
  'Какие задачи вернулись в очередь этим действием — чтобы переделку можно было разобрать постфактум.';

CREATE INDEX IF NOT EXISTS pr_order_item_idx  ON public.production_rework (order_id, item_index);
CREATE INDEX IF NOT EXISTS pr_reason_time_idx ON public.production_rework (reason_code, created_at DESC);
CREATE INDEX IF NOT EXISTS pr_by_user_idx     ON public.production_rework (by_user, created_at DESC);

ALTER TABLE public.production_rework ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth read production_rework" ON public.production_rework;
CREATE POLICY "Auth read production_rework"
  ON public.production_rework FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Auth insert production_rework" ON public.production_rework;
CREATE POLICY "Auth insert production_rework"
  ON public.production_rework FOR INSERT TO authenticated WITH CHECK (true);

-- Ни UPDATE, ни DELETE: журнал неизменяем, как inventory_moves.

ALTER TABLE public.production_tasks
  ADD COLUMN IF NOT EXISTS rework_count int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.production_tasks.rework_count IS
  'Сколько раз этот этап детали переоткрывали переделкой. Денормализовано из production_rework
   для дешёвого показа в очереди цеха. Выработка (П16) считает закрытий 1 + rework_count:
   человек, отрезавший деталь дважды, сделал работу дважды.';

-- Счётчик ведёт триггер, а не приложение: журнал — источник правды, rework_count —
-- его денормализация. Инкремент в транзакции вставки не разъедется с журналом и не
-- зависит от того, дошёл ли до кэша схемы очередной RPC.
CREATE OR REPLACE FUNCTION public.bump_rework_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF array_length(NEW.reopened_task_ids, 1) IS NOT NULL THEN
    UPDATE production_tasks
       SET rework_count = rework_count + 1
     WHERE id = ANY (NEW.reopened_task_ids);
  END IF;
  RETURN NEW;
END $$;

-- SECURITY DEFINER без REVOKE = дыра для anon (урок из 20260831). Сначала снимаем всё.
REVOKE ALL ON FUNCTION public.bump_rework_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bump_rework_count() FROM anon;

DROP TRIGGER IF EXISTS production_rework_bump_count ON public.production_rework;
CREATE TRIGGER production_rework_bump_count
  AFTER INSERT ON public.production_rework
  FOR EACH ROW EXECUTE FUNCTION public.bump_rework_count();
