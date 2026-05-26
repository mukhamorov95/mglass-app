# AI Control Center Skill — Навык центра управления AI

## Назначение
Анализировать работу всей системы MGlass через Claude AI, генерировать приоритизированные рекомендации по 4 перспективам (owner/sales/operations/pricing), отслеживать их внедрение. Управлять AI-агентами, запускаемыми по расписанию.

## Модули и страницы
- `/admin/ai-control-center` — центральный дашборд (6 вкладок: overview, health, calculators, ai, recommendations, log)
- `/admin/agents` — реестр и запуск AI-агентов
- `/ai-stats` — статистика работы Telegram-бота

## API маршруты
- `POST /api/admin/ai-control-center/analyze` — AI-анализ с выбором перспективы (owner/sales/operations/pricing)
- `GET/POST /api/agents/run/[key]` — ручной запуск конкретного агента
- `POST/DELETE /api/agents/catalog/approve` — одобрение элемента каталога агентом
- `GET /api/cron/agent-analyst` — агент-аналитик (cron)
- `GET /api/cron/agent-ceo` — CEO-агент (cron)
- `GET /api/cron/agent-revenue` — агент выручки (cron)
- `GET /api/cron/agent-production` — агент производства (cron)
- `GET /api/cron/agent-catalog` — агент каталога (cron)

## Таблицы БД
| Таблица | Роль |
|---------|------|
| `calculations` | Анализ расчётов: тренды, выручка, маржа по продуктам |
| `orders` | Анализ заказов: конверсия, средний чек, просрочки |
| `users` | Состав команды для контекста анализа |
| `glass_price_matrix` | Анализ ценообразования |
| `b2b_quotes` | B2B воронка: конверсия просчётов в заказы |
| `agent_memory` | Долгосрочная память агентов: наблюдения, решения, тренды |

## Ключевые файлы
| Файл | Роль |
|------|------|
| `lib/agentMemory.ts` | Чтение/запись памяти агентов в agent_memory |
| `lib/ai-tools.ts` | Инструменты для агентов (tool use Claude API) |

## Роли и доступ
- **admin**: полный доступ, запуск агентов, просмотр всех вкладок
- **ceo**: полный доступ

## Входные данные
Перспектива анализа (owner/sales/operations/pricing), снимок данных health-check, данные о расчётах и заказах за период.

## Выходные данные
Массив рекомендаций с полями: title, description, priority (critical/high/medium/low), category, action. План внедрения.

## Что уже реализовано
- Страница с 6 вкладками (overview, health, calculators, ai, recommendations, log)
- POST `/api/admin/ai-control-center/analyze` с анализом через Claude (4 перспективы)
- Анализ расчётов с разбивкой по материалам и типам продуктов
- Система рекомендаций с трекингом статуса (реализовано/в работе/отложено) — localStorage
- 5 типов AI-агентов с cron-запуском
- Долгосрочная память агентов в `agent_memory` через `lib/agentMemory.ts`
- Интеграция данных health-check в анализ

## Что нужно доработать
- Хранение рекомендаций в БД (сейчас localStorage — теряются при смене браузера)
- Auto-apply рекомендаций через AI (исполнение рекомендации агентом)
- Сравнение метрик за разные периоды (MoM, YoY)
- Dashboard метрик самих агентов (сколько запущено, результаты)

## Риски
- Весь анализ требует `ANTHROPIC_API_KEY` — без него страница пуста, ошибки молчаливые
- Рекомендации в localStorage — теряются при смене устройства/браузера/режима инкогнито
- Cron-агенты требуют `CRON_SECRET` — без него все `/api/cron/agent-*` вернут 401

## Тесты
- Integration: POST `/api/admin/ai-control-center/analyze?perspective=owner` → массив рекомендаций
- Smoke: все 6 вкладок рендерятся без ошибок
- Smoke: `/admin/agents` показывает список агентов и кнопки запуска

## Связи с другими Skills
- **Health Check Skill** — данные о состоянии системы передаются в анализ
- **Calculation Skill** — данные расчётов для анализа трендов
- **CEO Analytics Skill** — данные выручки и заказов для анализа
- **Integration Skill** — агенты могут отправлять уведомления через Telegram
