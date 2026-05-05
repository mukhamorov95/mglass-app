create table if not exists ai_managed_chats (
  chat_id      text primary key,
  channel_id   text not null,
  chat_type    text not null default 'whatsapp',
  amo_lead_id  bigint,
  client_name  text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  chat_id     text not null references ai_managed_chats(chat_id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists ai_conversations_chat_id_idx on ai_conversations(chat_id, created_at);
