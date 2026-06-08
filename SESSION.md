## Текущая задача
AI B2B Quick Quote Admin UI — реализован. Следующий шаг: проверить на production что items_list отображается в карточке закупки без краша.

---

### Procurement items_list in detail modal — ЗАКРЫТО (8 июня 2026)

**Коммиты:**

| Коммит | Описание |
|---|---|
| `8b661ed` | feat(procurement): show items count in purchase order detail modal (step 1) |
| `dad1bf2` | feat(procurement): show material list in purchase order detail modal (step 2) |

**Что сделано:**
- `Order` type расширен: `items_count: number`, `items_list: OrderItem[]`
- `normalizeOrder()` безопасно извлекает из JSONB `items[]`: `name`, `thickness`, `sheets`
- Detail modal показывает `ul` список: `{name} {thickness}мм — {sheets} л.`
- Всё через pre-validated числа, никаких `toFixed/toLocaleString` в render

**Шаг 3 (полная таблица)** — отдельный PR после подтверждения пользователем что список работает без краша.

---

### AI B2B Quick Quote Admin UI — ЗАКРЫТО (8 июня 2026)

**Коммит:** `9dfd9b0`

**Файлы:**
- `app/admin/ai-b2b-quote/page.tsx` — новая страница (создана)
- `components/Sidebar.tsx` — добавлена ссылка в ADMIN_B2B + autoOpenAdmin

**Что реализовано:**
- Форма: product_type (mirror/shower/loft), width×height, quantity
- Mirror-only поля: mirrorType, thicknessMm, hasLighting
- partner_discount_override, raw_request, manager_notes
- Вызов `POST /api/ai/b2b-quote/draft` (бэкенд уже существовал)
- Результат: статус баннер, таблица позиций, pricing summary, manager internal (MarginBadge, cost_basis, partner_context), черновик для партнёра с кнопкой «Копировать», warnings/errors блоки
- Safety notice в footer: `approval_required · can_send_to_client: false · can_write_crm: false`
- Ссылка в Sidebar ADMIN_B2B под иконкой ⚡

---

### Procurement Material Requests MVP — СТАБИЛЬНАЯ ТОЧКА / ЧАСТИЧНО ЗАКРЫТО (8 июня 2026)

**Ключевые коммиты:**

| Коммит | Описание |
|---|---|
| `313945e` | feat(db): extend purchase_orders for material requests |
| `5fb4cff` | feat(procurement): create purchase order from material estimate |
| `d211146` | fix(procurement): remove unsupported invoice_date from purchase order payload |
| `2784f61` | fix(procurement): remove unsupported invoice_date from procurement form |
| `42942ae` | fix(nav): show procurement menu for admin and buyer roles |
| `8cd5168` | fix(auth): allow ceo and cfo in admin layout |
| `274b7b6` | test(procurement): diagnostic stub to isolate page crash |
| `e497b48` | fix(procurement): restore kanban without inline style |
| `faa9ba9` | fix(procurement): normalize purchase order data before render |

**Файлы изменены:** `app/admin/procurement/page.tsx`, `app/admin/layout.tsx`, `supabase/migrations/`, `components/Sidebar.tsx`, `app/b2b-orders/page.tsx`

#### Что работает

- `/b2b-orders` → выбрать заказы → **«📦 Материал»** → модалка «Ориентировочная потребность материала»
- Кнопка **«Передать в закупку»** создаёт запись в `purchase_orders`
- Записи заполняются: `items jsonb`, `b2b_order_ids`, `order_refs`, `amount`, `created_by`
- `/admin/procurement` доступен для ролей: `admin`, `ceo`, `cfo`, `buyer`
- Канбан закупок открывается без "This page couldn't load"
- Созданные заявки видны в колонке «Счёт получен»
- `supplier_name = "Не выбран"`, `order_refs`, `amount` отображаются корректно
- Все данные `purchase_orders` нормализуются через `normalizeOrder()` перед рендером
- При ошибке загрузки API — красный баннер вместо краша страницы
- **Detail modal показывает список материалов** (step 2 items_list: имя + толщина + листы)

#### Known limitations

- `items[]` в карточке закупки — показывается в simple list (step 2). Step 3 (таблица) — после production-проверки
- Нет связанной ссылки из `/b2b-orders` на созданный `purchase_order`
- Нет автосинхронизации `purchase_order.status → b2b_orders.notes.material_status`
- Нет таблицы `material_request_items` — хранится в JSONB `items`
- Нет складского резерва
- `supplier_name` = "Не выбран" — Вера заполняет вручную после создания

---

## Что сделано (предыдущие сессии)

### Estimated Material Requirement in B2B Orders — ЗАКРЫТО (8 июня 2026)

**Коммиты:** `ee99a36`, `41ff95a`

**Файл:** только `app/b2b-orders/page.tsx`

#### Что реализовано

- В `/b2b-orders` можно выбрать несколько заказов чекбоксами
- Кнопка **«📦 Материал (N)»** открывает модалку «Ориентировочная потребность материала»
- Расчёт группирует позиции по `materialName + thickness` из `b2b_orders.items`
- Модалка показывает: м² деталей, вес кг, листов к закупке, стоимость листов, заказы
- Расчёт выполняется на клиенте — без записи в БД, без сетевых запросов
- Warning поясняет: расчёт по площади с `waste_percent`, без точной раскладки деталей
- Warning поясняет: стоимость считается по целым листам (минимум 1 лист)
- Для точного раскроя указывается ссылка на `/b2b-cutting`

---

### Cutting Oversized / Unplaced Safety Fix — ЗАКРЫТО (8 июня 2026)

**Коммиты:** `7e321f3` (алгоритм), `8f19db9` (UI)

**Файлы:** `lib/cuttingOptimizer.ts`, `app/b2b-cutting/page.tsx`

---

## Следующий шаг

**Рекомендуемый: проверить на production что items_list в карточке закупки работает без краша**

После подтверждения — можно делать step 3 (полная таблица с area_m2, estimated_cost).

**Другие независимые направления:**

**B. B2B glass/cutting support (Phase 2)**
- Подключить `lib/b2bCalculator.ts` к `b2bQuickQuoteTool` для `product_type: 'glass' | 'cutting'`
- Убрать `UNSUPPORTED_PRODUCT_TYPE_PHASE_1` для этих типов

**C. Telegram auto-send Phase 2**
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_WORK_CHAT_ID` в ENV
- Server-side route `POST /api/b2b-quotes/[id]/send-telegram`
- Confirmation before send
- Отправка текста + PDF

**D. Server-side PDF для B2C proposals** (незакрытое)
- `app/api/ai/proposals/[id]/pdf/route.ts` через `@react-pdf/renderer`
- Чистый PDF без Chrome headers/footers

**E. Procurement step 3 (таблица items)**
- После production-проверки что list работает
- area_m2, estimated_cost, waste_percent в таблице

## Контекст

- Весь код закоммичен, ветка `main`, HEAD = `9dfd9b0`
- `/admin/procurement` работает на production — подтверждено
- `/admin/ai-b2b-quote` — новая страница, бэкенд POST /api/ai/b2b-quote/draft уже существовал
- `app/admin/layout.tsx` разрешает роли: `admin`, `buyer`, `ceo`, `cfo`
- `purchase_orders.items` JSONB структура: `{ material_name, category, thickness, sheet_width, sheet_height, area_m2, required_area_m2, sheets_count, weight_kg, estimated_cost, waste_percent, order_ids, order_refs, unmatched }`
- `getMatrixPrice` и `getWastePct` — pure functions из `lib/glassMatrix.ts`, server-side
- `@react-pdf/renderer` v4.5.1 уже установлен — готов к server-side PDF route
- `b2bQuickQuoteTool` читает `partner_types` (SELECT only) + вызывает `quickCalcTool`

## Открытые вопросы

- items_list step 2 — нужна production-проверка пользователем перед step 3
- `ai/skills/`, `ai/workflows/`, `ai/memory/` — директории не созданы, запланированы для будущих этапов
- Нет Anthropic binding — генерация детерминированная (`allowModelCall: false`)
- Нет CRM-read integration — клиент заполняется вручную
