-- П1 (docs/PRODUCTION_PLAN.md) — исполнитель производственной задачи.
--
-- Диагноз: assigned_to заполнен у 0 из 3670 задач. Но assigned_to — это ПЛАН
-- (по нему строится личная очередь: assigned_to = я ИЛИ assigned_to пуст И станция моя).
-- Если писать туда же факт «кто закрыл», поле начнёт значить две вещи сразу,
-- и планирование (П11/П12) будет читать выработку. Поэтому факт — отдельно.
--
-- Историю не теряем: b2b_orders.notes.detail_stages хранит updated_by по каждой
-- отметке, поэтому исполнитель поднимается для уже закрытых задач (~1449 из 1683).
--
-- ✅ Безопасно: только ADD COLUMN IF NOT EXISTS + CREATE INDEX + UPDATE пустых полей.
--    Ни DROP, ни DELETE, ни изменения существующих значений.

ALTER TABLE public.production_tasks
  ADD COLUMN IF NOT EXISTS completed_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_by_name   text,
  ADD COLUMN IF NOT EXISTS problem_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS problem_resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.production_tasks.completed_by IS
  'ФАКТ: кто нажал «Готово». Проставляется сервером из сессии, отдельного действия рабочий не делает.
   Не путать с assigned_to (ПЛАН — кому задача адресована, чем питается личная очередь).
   NULL у каскадно закрытых (auto_closed = true) — их физически никто не отмечал, и в выработку они не идут.';
COMMENT ON COLUMN public.production_tasks.completed_by_name IS
  'Имя исполнителя на момент отметки. Денормализовано (как problem_by_name, launched_by_name):
   экран цеха читает задачи браузерным клиентом и не должен ходить в users за каждым именем.';
COMMENT ON COLUMN public.production_tasks.problem_by IS
  'Кто поднял андон. Пара к существующему problem_by_name — имя для показа, uuid для аналитики брака (П15).';
COMMENT ON COLUMN public.production_tasks.problem_resolved_by IS
  'Кто снял андон. Пара к problem_resolved_by_name.';

-- Выработка по людям (П16): «что закрыл этот человек за период».
-- auto_closed исключён прямо в индексе — каскад не выработка.
CREATE INDEX IF NOT EXISTS pt_output_by_worker_idx
  ON public.production_tasks (completed_by, completed_at DESC)
  WHERE completed_by IS NOT NULL AND auto_closed = false;

-- ─── Догон истории из notes.detail_stages ────────────────────────────────────
-- Берём только отметки status='done' без флага auto (каскад не считаем работой)
-- и только те, чей updated_by — существующий пользователь.
WITH marks AS (
  SELECT
    o.id                                   AS order_id,
    (item.key)::int                        AS item_index,
    st.key                                 AS stage_key,
    (st.value->>'updated_by')::uuid        AS by_id
  FROM public.b2b_orders o
  CROSS JOIN LATERAL jsonb_each((o.notes::jsonb)->'detail_stages') AS item(key, value)
  CROSS JOIN LATERAL jsonb_each(item.value)                        AS st(key, value)
  WHERE (o.notes::jsonb) ? 'detail_stages'
    AND st.value->>'status' = 'done'
    AND COALESCE((st.value->>'auto')::boolean, false) = false
    AND st.value->>'updated_by' ~ '^[0-9a-fA-F-]{36}$'
    AND item.key ~ '^[0-9]+$'
)
UPDATE public.production_tasks t
   SET completed_by      = u.id,
       completed_by_name = COALESCE(u.name, u.email)
  FROM marks m
  JOIN public.users u ON u.id = m.by_id
 WHERE t.order_id   = m.order_id
   AND t.item_index = m.item_index
   AND t.stage_key  = m.stage_key
   AND t.status     = 'done'
   AND t.auto_closed = false
   AND t.completed_by IS NULL;

-- Тот же догон для андона: кто поднимал проблему (в detail_stages это status='problem').
WITH probs AS (
  SELECT
    o.id                            AS order_id,
    (item.key)::int                 AS item_index,
    st.key                          AS stage_key,
    (st.value->>'updated_by')::uuid AS by_id
  FROM public.b2b_orders o
  CROSS JOIN LATERAL jsonb_each((o.notes::jsonb)->'detail_stages') AS item(key, value)
  CROSS JOIN LATERAL jsonb_each(item.value)                        AS st(key, value)
  WHERE (o.notes::jsonb) ? 'detail_stages'
    AND st.value->>'status' = 'problem'
    AND st.value->>'updated_by' ~ '^[0-9a-fA-F-]{36}$'
    AND item.key ~ '^[0-9]+$'
)
UPDATE public.production_tasks t
   SET problem_by = u.id
  FROM probs p
  JOIN public.users u ON u.id = p.by_id
 WHERE t.order_id   = p.order_id
   AND t.item_index = p.item_index
   AND t.stage_key  = p.stage_key
   AND t.problem_at IS NOT NULL
   AND t.problem_by IS NULL;
