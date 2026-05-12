-- Bucket b2b-attachments был приватным, но код сохранял public URL через getPublicUrl().
-- Для internal-инструмента с авторизацией публичный bucket безопасен.
UPDATE storage.buckets SET public = true WHERE id = 'b2b-attachments';
