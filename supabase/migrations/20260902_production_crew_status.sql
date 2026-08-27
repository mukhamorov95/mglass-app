-- Состав цеха для экрана «Кто что делал».
--
-- Зачем. 26.08 выяснилось, что из ШЕСТИ заведённых работников производства четверо
-- почти не входили в приложение, а один (полировка, 645 задач в очереди) — не входил
-- ни разу с момента заведения. При этом экран активности показывал только тех, кто
-- отмечает: человека, которого нет в системе, на нём просто не было. Проблема была
-- невидима ровно там, где на неё смотрят.
--
-- Отдаёт ТОЛЬКО имя, станции, факт входа и счётчики — ни email, ни токенов.
-- Нужна как функция, а не запрос: last_sign_in_at живёт в auth.users, которая через
-- PostgREST не читается.
--
-- ✅ Безопасно: только CREATE FUNCTION + гранты. Данные не меняет вообще.

CREATE OR REPLACE FUNCTION public.production_crew_status()
RETURNS TABLE (
  user_id      uuid,
  name         text,
  stations     text[],
  last_sign_in timestamptz,
  marks_total  bigint,
  marks_7d     bigint,
  queue_open   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r text;
BEGIN
  -- Роль проверяем внутри: authenticated включает и партнёров B2B, а состав цеха
  -- и его активность — не их данные. Сервис-ключ (auth.uid() is null) гейтит роут сам.
  IF auth.uid() IS NOT NULL THEN
    SELECT u.role INTO r FROM users u WHERE u.id = auth.uid();
    IF r IS NULL OR r NOT IN ('production','admin','ceo','buyer','manager','commercial','cfo') THEN
      RAISE EXCEPTION 'forbidden: shop crew status requires a shop role' USING errcode = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.name,
    coalesce(u.production_stations, '{}'::text[]),
    a.last_sign_in_at,
    (SELECT count(*) FROM production_tasks t WHERE t.completed_by = u.id),
    (SELECT count(*) FROM production_tasks t
       WHERE t.completed_by = u.id AND t.completed_at > now() - interval '7 days'),
    (SELECT count(*) FROM production_tasks t
       WHERE t.status IN ('queued','in_progress')
         AND coalesce(u.production_stations, '{}'::text[]) <> '{}'::text[]
         AND t.station = ANY (coalesce(u.production_stations, '{}'::text[])))
  FROM users u
  LEFT JOIN auth.users a ON a.id = u.id
  WHERE u.role = 'production'
  ORDER BY u.name;
END $$;

COMMENT ON FUNCTION public.production_crew_status() IS
  'Состав цеха для экрана «Кто что делал»: кто заведён, у кого есть станция, кто хоть раз входил
   в приложение, сколько отметок. Отдаёт только имя, станции, факт входа и счётчики.';

-- SECURITY DEFINER без REVOKE = дыра для anon (урок из 20260831).
REVOKE ALL ON FUNCTION public.production_crew_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.production_crew_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.production_crew_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.production_crew_status() TO service_role;
