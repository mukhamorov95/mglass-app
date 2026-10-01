-- Хранилище: партнёр и аноним не трогают чужие файлы (найдено 01.10.2026).
--
-- b2b-attachments — вложения клиентов к просчётам, рабочие чертежи заказов
-- (order-drawings/<id>), файлы бухгалтерии и прайсов поставщиков. Правила пускали
-- ЛЮБОГО вошедшего читать, загружать и удалять всё в бакете — партнёр из своего
-- кабинета мог скачать чертежи и вложения всех заказчиков или стереть их.
-- Партнёр получает свои файлы только через API под service role
-- (/api/b2b/drawing, /api/b2b/attachments) — там проверено, что заказ его.
-- Сотрудники грузят из браузера (калькулятор, цех, просчёты, бухгалтерия) — им как было.
--
-- furniture-shower — фото фурнитуры для 3D. Загрузку и удаление разрешала роль
-- public, то есть анонимный ключ со страницы сайта. Чтение остаётся публичным.
--
-- Тот же приём, что для таблиц B2B (20260805_b2b_partner_isolation_backstop):
-- "and not public.is_partner()".

drop policy if exists "Auth read b2b attachments" on storage.objects;
drop policy if exists "Auth upload b2b attachments" on storage.objects;
drop policy if exists "Auth delete b2b attachments" on storage.objects;

create policy "Staff read b2b attachments" on storage.objects for select to authenticated
  using (bucket_id = 'b2b-attachments' and not public.is_partner());
create policy "Staff upload b2b attachments" on storage.objects for insert to authenticated
  with check (bucket_id = 'b2b-attachments' and not public.is_partner());
create policy "Staff delete b2b attachments" on storage.objects for delete to authenticated
  using (bucket_id = 'b2b-attachments' and not public.is_partner());

drop policy if exists "furniture-shower upload" on storage.objects;
drop policy if exists "furniture-shower delete" on storage.objects;

create policy "furniture-shower staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'furniture-shower' and not public.is_partner());
create policy "furniture-shower staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'furniture-shower' and not public.is_partner());
