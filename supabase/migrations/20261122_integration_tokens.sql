-- Токены внешних сервисов, которые владелец подключает кнопкой из приложения
-- (первый — Яндекс.Метрика, только чтение статистики). Читает и пишет только сервер
-- service-ключом после проверки роли владельца: RLS включён без политик, у anon и
-- authenticated прав нет вовсе.
create table if not exists public.integration_tokens (
  key text primary key,
  token text not null,
  scope text,
  account text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.integration_tokens enable row level security;
revoke all on public.integration_tokens from anon, authenticated;
