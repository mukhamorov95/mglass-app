-- Гонка на этапах заказа, часть 2.
--
-- mark_detail_stages (20260730) закрыл гонку на detail_stages, но верхнеуровневые
-- notes.stages по-прежнему писались из браузера блобом: экран читал весь notes,
-- правил и клал обратно. Две отметки по одному заказу — вторая затирала первую,
-- а вместе с ней могли уехать оплата, доставка, рекламация.
--
-- patch_order_notes_shallow для этого не годится: он мержит только верхний уровень,
-- то есть { stages: {...} } заменяет ВЕСЬ объект stages целиком.
--
-- Здесь — точечная запись по ключу этапа под блокировкой строки. null удаляет
-- отметку (снятие галочки). Формат значения — календарная дата YYYY-MM-DD:
-- ручной тумблер и массовая отметка писали по-разному (date-only vs полный ISO),
-- из-за чего сравнения дат и отчёт «в срок %» вели себя непредсказуемо.

CREATE OR REPLACE FUNCTION public.mark_order_stages(p_order_id bigint, p_stages jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  n jsonb;
  k text;
  v jsonb;
  r text;
BEGIN
  -- Этапы отмечают и цех, и менеджер (в /b2b-orders), поэтому набор ролей шире,
  -- чем у чисто цеховых RPC. Сервис-ключ (auth.uid() is null) проверяет роут сам.
  IF auth.uid() IS NOT NULL THEN
    SELECT role INTO r FROM users WHERE id = auth.uid();
    IF r IS NULL OR r NOT IN ('production','admin','ceo','buyer','manager','commercial') THEN
      RAISE EXCEPTION 'forbidden: stage marking requires order role' USING errcode = '42501';
    END IF;
  END IF;

  SELECT coalesce(nullif(notes, '')::jsonb, '{}'::jsonb) INTO n
  FROM b2b_orders WHERE id = p_order_id FOR UPDATE;
  IF n IS NULL THEN n := '{}'::jsonb; END IF;

  n := jsonb_set(n, '{stages}', coalesce(n->'stages', '{}'::jsonb), true);

  FOR k, v IN SELECT * FROM jsonb_each(p_stages) LOOP
    IF v = 'null'::jsonb THEN
      n := jsonb_set(n, '{stages}', (n->'stages') - k, true);
    ELSE
      n := jsonb_set(n, array['stages', k], v, true);
    END IF;
  END LOOP;

  UPDATE b2b_orders SET notes = n::text WHERE id = p_order_id;
  RETURN n;
END $$;

GRANT EXECUTE ON FUNCTION public.mark_order_stages(bigint, jsonb) TO authenticated;
