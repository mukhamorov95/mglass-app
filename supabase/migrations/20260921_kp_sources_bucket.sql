-- Исходники КП: файл старого предложения, из которого собрано наше.
-- Бакет ПРИВАТНЫЙ, в отличие от kp-photos: здесь лежит документ клиента с именем,
-- телефоном и ценами. Наружу он отдаётся только через /api/kp/source — по ссылке
-- с коротким сроком жизни и после проверки, что этот КП человеку виден.
-- Политик storage не заводим: пишет и подписывает только сервисный клиент.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'kp-sources', 'kp-sources', false, 20971520,
  array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
