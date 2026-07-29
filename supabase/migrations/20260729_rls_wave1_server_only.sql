-- RLS, волна 1: таблицы, к которым браузер не обращается НИКОГДА.
--
-- Контекст: аудит показал 28 таблиц с выключенным RLS — то есть читаемых и
-- писуемых публичным ключом, который лежит в любом браузере. Среди них были
-- одноразовые КОДЫ ВХОДА (telegram_auth_codes): их можно было прочитать из
-- консоли и войти чужой учёткой. Проверено эмпирически до и после.
--
-- Почему это безопасно: все обращения к этим таблицам идут service-role ключом
-- (вебхуки, кроны, админ-роуты), а service_role имеет BYPASSRLS — политики его
-- не касаются. Анон-ключ доступ теряет, сервер работает как работал.
-- Политики намеренно НЕ создаются: если ни одной политики нет, RLS не пропускает
-- никого, кроме bypass-ролей. Это и есть нужное поведение.
--
-- Волны 2 и 3 (прайсы и переписка) требуют политик — они читаются из браузера,
-- и слепое включение сломает калькуляторы. Делаются отдельно.

-- Приоритет №1 — токены доступа.
alter table public.telegram_auth_codes    enable row level security;  -- одноразовые коды входа
alter table public.telegram_sessions      enable row level security;  -- состояние диалога бота
alter table public.telegram_users         enable row level security;  -- маппинг telegram → пользователь

-- Ценообразование: формулы калькуляторы получают по HTTP через service-роут
-- (/api/admin/pricing-formula), а не напрямую из браузера.
alter table public.pricing_formula        enable row level security;

-- Переписка с клиентами и очереди обработки: пишет вебхук, читает крон.
alter table public.avito_messages_raw     enable row level security;
alter table public.message_queue          enable row level security;
alter table public.external_conversations enable row level security;

-- Настройки AI (включая рубильник ботов) и очередь обучения.
alter table public.ai_settings            enable row level security;
alter table public.ai_training_tasks      enable row level security;
