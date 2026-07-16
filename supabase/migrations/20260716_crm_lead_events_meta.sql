-- Метаданные события ленты лида. Для звонков (kind='call') — ссылка на запись,
-- направление (in/out), длительность, id звонка (дедуп вебхука OnlinePBX) и
-- внутренний номер оператора. Nullable: существующий код читает text как раньше,
-- ничего не ломается. RLS наследуется от таблицы crm_lead_events.
alter table crm_lead_events add column if not exists meta jsonb;

-- Быстрый дедуп по id звонка из вебхука OnlinePBX.
create index if not exists idx_crm_lead_events_call_id
  on crm_lead_events ((meta->>'call_id'))
  where kind = 'call';
