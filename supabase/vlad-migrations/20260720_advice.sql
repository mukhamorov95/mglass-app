-- Разборы AI-советника (финдиректор/антикризис-менеджер владельца).
-- Пишет только крон-агент; владелец читает во вкладке «Предложения».
-- Агент данные НЕ меняет — только советует (принцип «ничего молча»).
create table vlad_advice (
  id bigserial primary key,
  slot text not null check (slot in ('morning','evening','manual')),
  title text not null,                  -- заголовок разбора одной фразой
  items jsonb not null default '[]',    -- [{"point","detail","kind":"finance|tasks|discipline|idea"}]
  snapshot jsonb,                       -- цифры, на которых основан разбор (для истории)
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index vlad_advice_created_idx on vlad_advice (created_at desc);
alter table vlad_advice enable row level security;
