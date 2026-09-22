-- Исходящие сообщения Wazzup с автором. В AmoCRM 57% исходящих приходят без автора
-- (отправлены из приложения Wazzup или с телефона) — кто их написал, amo не знает.
-- Wazzup присылает в наш вебхук и исходящие, но приёмник их отбрасывал.
-- Текст и имя клиента не храним: для «кто и когда писал» они не нужны.
-- payload_keys — какие поля реально пришли: по ним проверяем, что Wazzup шлёт автора.

create table if not exists wazzup_outgoing_messages (
  wazzup_message_id  text primary key,
  channel_id         text,
  chat_id            text,
  chat_type          text,
  author_id          text,
  author_name        text,
  is_echo            boolean,
  sent_from_app      boolean,
  message_type       text,
  sent_at            timestamptz,
  payload_keys       text[],
  received_at        timestamptz not null default now()
);

create index if not exists wazzup_outgoing_messages_sent_at_idx on wazzup_outgoing_messages (sent_at);

alter table wazzup_outgoing_messages enable row level security;

drop policy if exists "Owner reads wazzup_outgoing_messages" on wazzup_outgoing_messages;
create policy "Owner reads wazzup_outgoing_messages" on wazzup_outgoing_messages
  for select to authenticated using (public.is_owner());
