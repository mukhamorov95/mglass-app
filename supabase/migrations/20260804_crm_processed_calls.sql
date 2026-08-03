-- Атомарный барьер идемпотентности звонков OnlinePBX. АТС ретраит вебхук, а
-- прежний SELECT-дедуп проигрывал гонку (несколько запросов одновременно видели
-- «дубля нет» → фантомные лиды и дубли call-событий). PK по call_id даёт
-- атомарную вставку: только первый запрос занимает звонок, ретраи ловят конфликт.
create table if not exists crm_processed_calls (
  call_id text primary key,
  lead_id bigint,
  created_at timestamptz not null default now()
);
alter table crm_processed_calls enable row level security;

-- Бэкфилл уже виденных call_id, чтобы старые ретраи не задвоились.
insert into crm_processed_calls (call_id, lead_id)
select distinct on (meta->>'call_id') meta->>'call_id', lead_id
from crm_lead_events
where kind='call' and meta->>'call_id' is not null
order by meta->>'call_id', id
on conflict (call_id) do nothing;
