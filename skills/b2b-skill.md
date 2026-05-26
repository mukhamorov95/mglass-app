# B2B Skill — Навык B2B-продаж

## Назначение
Полный цикл работы с оптовыми клиентами: калькулятор стекла → просчёт → CRM → PDF КП → заказ → оптимизация раскроя → производство. Потенциально тиражируемый SaaS-продукт для стекольных компаний.

## Модули и страницы
- `/calculator/b2b` — B2B калькулятор (список деталей, материал, услуги, скидка)
- `/b2b-quotes` — список просчётов с маржой и статусом
- `/b2b-quotes/[id]/kp` — PDF коммерческое предложение
- `/b2b-orders` — B2B заказы
- `/b2b-crm` — CRM: список клиентов с сегментами и оценками
- `/b2b-crm/[id]` — карточка клиента: история взаимодействий, статистика
- `/b2b-cutting` — оптимизация раскроя стекла
- `/b2b-pipeline` — воронка продаж (kanban)
- `/b2b-production` — производство B2B заказов
- `/b2b-analytics` — аналитика B2B (выручка, клиенты, воронка)
- `/admin/b2b-clients` — справочник клиентов (admin)
- `/admin/b2b-materials` — справочник материалов
- `/admin/b2b-services` — справочник услуг
- `/admin/cutting-settings` — настройки раскроя (лист, отступы)
- `/admin/archive` — архив расчётов

## API маршруты
- `GET /api/quotes/[id]/pdf` — генерация PDF КП (react-pdf, runtime: nodejs)
- `POST /api/b2b/parse-pdf` — парсинг PDF-прайса поставщика
- `GET/POST /api/admin/b2b-leads` — B2B лиды
- `POST /api/admin/sync-b2b-materials` — синхронизация материалов из glass_price_matrix
- `POST /api/ai/b2b-message` — AI-сообщение для клиента
- `POST /api/ai/b2b-score` — AI-оценка лида (A/B/C)
- `POST /api/ai/b2b-segment-analysis` — AI-анализ сегмента клиентов
- `POST /api/ai/b2b-prospect` — AI-поиск потенциальных клиентов

## Таблицы БД
| Таблица | Роль |
|---------|------|
| `b2b_clients` | Клиенты: company, contact, phone, city, segment, status (new/contacted/active/sleeping/lost), score (A/B/C) |
| `b2b_interactions` | История: client_id, type (call/meeting/kp/order), notes, created_at |
| `b2b_quotes` | Просчёты: client_id, items (JSON позиций), total_cost, total_sale, margin, status |
| `b2b_orders` | Заказы: quote_id, client_id, status, delivery_date |
| `b2b_materials` | Материалы: name, category, t4–t12, cost_price, sale_price, supplier_id |
| `b2b_services` | Услуги: name, price_type, price, is_active |
| `b2b_films` | Плёнки: name, cost_price, sale_price |
| `cutting_settings` | Лист раскроя: sheet_width, sheet_height, blade_width, edge_margin |

## Ключевые файлы
| Файл | Роль |
|------|------|
| `lib/b2bCalculator.ts` | Движок расчёта B2B: позиции, услуги, НДС, маржа |
| `lib/cuttingOptimizer.ts` | 2D-оптимизация раскроя (guillotine BSSF, multi-strategy) |

## Роли и доступ
- **manager**: калькулятор, просчёты, заказы, CRM, раскрой
- **production**: пайплайн, производство B2B, просмотр заказов
- **buyer**: только справочники (b2b-materials, b2b-services)
- **admin**: всё, включая архив и управление клиентами

## Входные данные
Список деталей (ширина, высота, материал, услуги), скидка клиента, настройки листа для раскроя.

## Выходные данные
Просчёт с маржой по каждой позиции и итоговой, PDF КП, карты раскроя с оптимальной укладкой, AI-оценка клиента.

## Что уже реализовано
- Полный B2B калькулятор с НДС, закалкой, фацетом, кромкой, плёнкой, фрезеровкой
- CRM: сегменты (мелкий/средний/крупный опт), статусы, оценки A/B/C
- История взаимодействий (звонок/встреча/КП/заказ)
- 2D-оптимизация раскроя (guillotine BSSF, multi-strategy) в `lib/cuttingOptimizer.ts`
- PDF генерация КП через `@react-pdf/renderer`
- AI-анализ клиентов, сегментов, оценка лидов
- Воронка продаж (kanban)
- Архив расчётов

## Что нужно доработать
- Подтверждение B2B заказа (approval flow аналогичный B2C)
- Автоматическая нарезка карт раскроя при запуске заказа в производство
- Интеграция раскроя с производственным планом
- Двусторонняя синхронизация с AMO (сейчас только приём webhook)

## Риски
- `@react-pdf/renderer` требует `runtime = 'nodejs'` — если забыть, PDF-роут упадёт на edge
- Раскрой не оптимизирует по нескольким заказам одновременно (каждый заказ — отдельный лист)
- `b2b_materials.sale_price` исторически хранился в поле `notes` как JSON (legacy) — проверь схему перед работой
- AI-функции требуют `ANTHROPIC_API_KEY` — без него все `/api/ai/b2b-*` роуты падают

## Тесты
- Unit: `runCuttingOptimizer()` корректно укладывает детали в лист
- Unit: `b2bCalculator` считает НДС и маржу корректно
- Integration: калькулятор → просчёт → PDF (GET `/api/quotes/[id]/pdf`)
- E2E: менеджер создаёт B2B просчёт → отправляет PDF КП клиенту

## Связи с другими Skills
- **Pricing Skill** — источник b2b_materials и b2b_services; синхронизация через sync-b2b-materials
- **Commercial Proposal Skill** — PDF КП генерируется через тот же механизм
- **Procurement Skill** — материалы привязаны к поставщикам
- **Integration Skill** — AMO webhook создаёт B2B лиды; AI-агент анализирует клиентов
