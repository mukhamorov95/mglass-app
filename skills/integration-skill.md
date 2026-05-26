# Integration Skill — Навык интеграций

## Назначение
Обеспечить связь MGlass с внешними системами: Telegram-бот с AI для клиентов/команды, AmoCRM для лидов, Wazzup для WhatsApp, Google Sheets для импорта данных, Avito.

## Модули и страницы
- `/admin/integrations` — мониторинг интеграций (статус Avito, AMO)
- `/admin/data-hub` — центр данных (импорт из Google Sheets)
- `/vladislav` — интерфейс Telegram-бота Vladislav AI (статистика, история)
- `/amo-analysis` — анализ воронки AMO CRM

## API маршруты
- `POST /api/telegram/webhook` — Telegram-бот: меню, AI-диалог, быстрые расчёты, команды
- `POST /api/amo/webhook` — AmoCRM webhook: новые лиды → Wazzup-сообщение клиенту
- `GET /api/amo/calls` — звонки из AMO
- `POST /api/amo/calls/transcribe` — транскрипция звонка через AI
- `POST /api/amo/calls/analyze` — AI-анализ звонка (тональность, результат)
- `POST /api/wazzup/webhook` — WhatsApp webhook (входящие сообщения)
- `POST /api/admin/data-hub/sheets` — читать Google Sheet по URL
- `POST /api/admin/data-hub/import` — импортировать данные из таблицы
- `GET /api/admin/data-hub/logs` — логи импорта
- `POST /api/admin/integrations` — сохранить настройки интеграций
- `POST /api/admin/integrations/backfill` — обратное заполнение данных
- `GET /api/integrations/avito/health` — проверка соединения с Avito

## Таблицы БД
| Таблица | Роль |
|---------|------|
| `telegram_sessions` | Сессии бота: user_id, state, context (JSON для диалога) |
| `activity_log` | Лог действий: user, action, entity_type, entity_id, details |

## Ключевые файлы
| Файл | Роль |
|------|------|
| `lib/telegram.ts` | `notifyAdmins()`, `sendTelegramMessage()` — уведомления в Telegram |
| `lib/wazzup.ts` | `sendWazzupMessage()` — отправка WhatsApp через Wazzup API |
| `lib/quickCalc.ts` | Быстрый расчёт для Telegram-бота без сохранения в БД |

## Роли и доступ
- **admin**: настройка интеграций, просмотр всех данных
- **ceo**: мониторинг, анализ AMO
- **seo**: анализ AMO, статистика AI
- **Telegram-бот**: доступен без авторизации (идентификация по Telegram user_id)

## Входные данные
Webhooks от AMO/Telegram/Wazzup, URL Google Sheets (публичная ссылка), входящие сообщения клиентов.

## Выходные данные
Лиды в системе, автоответы клиентам через Wazzup, уведомления команде в Telegram, транскрипции звонков, импортированные данные.

## Что уже реализовано
- Telegram-бот с Claude AI: меню навигации, быстрые расчёты через `quickCalc.ts`, диалог
- AmoCRM webhook: новые лиды → автоматическое Wazzup-сообщение клиенту
- Round-robin распределение лидов между менеджерами
- Wazzup-интеграция (WhatsApp) для исходящих сообщений
- Импорт из Google Sheets (CSV через публичную ссылку)
- Транскрипция и AI-анализ звонков
- `notifyAdmins()` используется во всех Skill'ах для алертов

## Что нужно доработать
- OAuth для Google Sheets (сейчас только публично доступные таблицы)
- Полная Avito-интеграция (health check есть, но данные не синхронизируются)
- Двухсторонняя синхронизация заказов с AMO (сейчас только входящий webhook)
- Проверка подписи AmoCRM webhook (сейчас принимает любой запрос)

## Риски
- Telegram-бот и AMO webhook молча не работают при отсутствии ключей (`TELEGRAM_BOT_TOKEN`, `WAZZUP_API_KEY`)
- AmoCRM webhook не проверяет подпись запроса — риск фейковых данных
- Google Sheets импорт работает только для публичных таблиц (CSV-экспорт)
- Wazzup может отклонить сообщение если номер не в белом списке

## Тесты
- Integration: POST `/api/telegram/webhook` с тестовым update → корректный ответ
- Integration: POST `/api/amo/webhook` с лидом → Wazzup-сообщение клиенту
- Smoke: `GET /api/integrations/avito/health` → статус 200
- Security: AMO webhook должен отклонять неподписанные запросы (TODO)

## Связи с другими Skills
- **Measurement Skill** — `notifyAdmins()` при новом замере
- **Order Management Skill** — `notifyAdmins()` при критической марже, уведомления команде
- **B2B Skill** — AMO webhook создаёт B2B лиды, Wazzup отвечает клиентам
- **AI Control Center Skill** — агенты могут отправлять результаты через Telegram
- **CEO Analytics Skill** — AMO анализ воронки
