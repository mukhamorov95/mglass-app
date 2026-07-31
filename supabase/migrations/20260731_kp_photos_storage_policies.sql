-- ============================================================================
-- Политики storage для bucket kp-photos (фото/чертёж изделия на листе 3 КП).
-- Бакет создан публичным в 20260702_commercial_proposals.sql, но политик на
-- storage.objects для него не было → прямая заливка из браузера падала по RLS.
-- Приложение теперь заливает сервисным ключом через /api/kp/photo (RLS обходит),
-- поэтому эта миграция НЕОБЯЗАТЕЛЬНА. Оставлена для корректного состояния бакета
-- и на случай, если фронт снова начнёт грузить фото напрямую.
-- Применять в Supabase SQL Editor (авто-раннера миграций в проекте нет).
-- ============================================================================

DROP POLICY IF EXISTS "kp-photos auth upload" ON storage.objects;
CREATE POLICY "kp-photos auth upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'kp-photos');

DROP POLICY IF EXISTS "kp-photos auth update" ON storage.objects;
CREATE POLICY "kp-photos auth update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'kp-photos') WITH CHECK (bucket_id = 'kp-photos');

DROP POLICY IF EXISTS "kp-photos public read" ON storage.objects;
CREATE POLICY "kp-photos public read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'kp-photos');

DROP POLICY IF EXISTS "kp-photos auth delete" ON storage.objects;
CREATE POLICY "kp-photos auth delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'kp-photos');
