-- Ф2: фоллоу-ап Ивана замолчавшим клиентам Авито.
-- avito_user_id — id нашего аккаунта в этом чате (нужен для отправки без вебхука),
-- followup_count — сколько напоминаний уже отправлено (максимум 2).

alter table crm_leads add column if not exists avito_user_id  bigint;
alter table crm_leads add column if not exists followup_count integer not null default 0;
