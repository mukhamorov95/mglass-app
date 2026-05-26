# Commercial Proposal Skill — Навык коммерческих предложений

## Назначение
Формировать, редактировать и отправлять коммерческие предложения клиентам. Хранит историю версий, поддерживает статусную воронку, генерирует PDF и персонализированные тексты. Является мостом между расчётом и сделкой.

## Модули и страницы
- `/calculations` — список всех расчётов/КП текущего менеджера
- `/calculations/[id]` — детальный просмотр: стоимость, статус, история изменений, текст клиенту
- `/calculations/[id]/print` — версия для печати / отправки клиенту
- `/calculations/order/[groupId]/print` — печать группы расчётов (один заказ = несколько позиций)
- `/b2b-quotes` — список B2B просчётов
- `/b2b-quotes/[id]/kp` — PDF КП для B2B клиента
- `/kp-generator` — AI-генератор коммерческих предложений
- `/admin/archive` — архив B2B расчётов

## API маршруты
- `GET /api/quotes/[id]/pdf` — генерация PDF (react-pdf, runtime: nodejs)
- `POST /api/ai/generate-kp` — AI генерация текста КП
- `POST /api/ai/personalize-template` — персонализация шаблона КП под клиента
- `GET /api/admin/sales-scripts` — скрипты продаж
- `GET /api/admin/knowledge-base` — база знаний для AI

## Таблицы БД
| Таблица | Роль |
|---------|------|
| `calculations` | Расчёты: `status, client_text, notes, client_name, client_phone, parent_calc_id, order_group_id` |
| `b2b_quotes` | B2B просчёты с позициями |
| `b2b_clients` | Клиент для КП (contact, phone) |
| `b2b_orders` | B2B заказы (для PDF) |
| `calculation_changes` | История изменений: `field, old_value, new_value, reason, changed_by` |

## Роли
- **manager** — создаёт и редактирует КП по своим расчётам, меняет статус, добавляет текст клиенту
- **admin** — видит все КП, может редактировать любые, одобряет
- **ceo** — только просмотр
- **buyer** — нет доступа

## Входные данные
- `calculation_id` — ссылка на расчёт
- `client_name`, `client_phone` — данные клиента
- `status` — статус КП (12 вариантов)
- `client_text` — персонализированный текст для клиента
- `notes` — внутренние заметки менеджера
- `discount` — скидка (до max_discount_percent из financial_settings)

## Выходные данные
- Детальная страница КП с разбивкой стоимости
- PDF-документ (для B2B через react-pdf)
- Печатная версия (B2C через print CSS)
- История изменений цены/статуса
- Персонализированный текст для клиента (AI)

## Что уже реализовано
- **Страница `/calculations/[id]`:** полная детализация + история изменений + статусная воронка
- **12 статусов КП:** draft → sent → thinking → approved → measurement → in_work → production → install → done → launched → rejected → archive
- **PDF B2B:** `GET /api/quotes/[id]/pdf` через `@react-pdf/renderer` + компонент `QuotePDF`
- **Печать B2C:** `/calculations/[id]/print` через стандартный print CSS
- **Версионирование:** `calculation_changes` хранит все изменения price/discount/status с причиной
- **Группировка:** `order_group_id` связывает несколько расчётов в один заказ
- **Наследование:** `parent_calc_id` — новая версия расчёта наследует от родителя
- **AI КП:** POST `/api/ai/generate-kp` генерирует текст КП через Claude
- **Персонализация:** POST `/api/ai/personalize-template` адаптирует шаблон под клиента

## Что нужно доработать
- **PDF для B2C:** зеркало/душевая/лофт не имеют PDF-версии, только print CSS — нужен branded PDF
- **Версии КП:** снимок цен при каждом изменении (сейчас фиксируется только факт изменения)
- **Брендированный PDF:** логотип, фото изделия, контакты
- **Отправка WhatsApp:** кнопка «Отправить клиенту» с текстом через Wazzup
- **Шаблоны КП:** набор шаблонов по типу продукта (зеркало/душевая/лофт/B2B)

## Риски
- **react-pdf только Node.js:** `export const runtime = 'nodejs'` обязателен, Vercel Edge не поддерживает
- **Нет блокировки редактирования:** два менеджера могут одновременно изменить КП → race condition
- **Скидка не валидируется на уровне API:** менеджер может установить скидку > max_discount_percent без одобрения

## Тесты
- Unit: `QuotePDF` компонент рендерится без ошибок
- Integration: `GET /api/quotes/[id]/pdf` возвращает 200 + application/pdf
- Integration: изменение статуса → запись в `calculation_changes`
- Integration: AI-генерация КП возвращает непустой текст
- E2E: менеджер создаёт расчёт → меняет статус на sent → клиент получает текст

## Связи с другими Skills
- **Calculation Skill** — источник данных (расчёт = основа КП)
- **Order Management Skill** — КП с approved/measurement → запуск заказа
- **Integration Skill** — отправка КП клиенту через Wazzup/WhatsApp
- **B2B Skill** — B2B просчёты → PDF КП
