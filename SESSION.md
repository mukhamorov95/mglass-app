## Текущая задача
Buyer access fix + infinite loading fix — закоммичено (2d1b7ac).

---

### B2B Minimum Line Price MVP — РЕАЛИЗОВАНО, ещё не закоммичено

**Файлы изменены:**
- `lib/b2bCalculator.ts` — добавлены MIN_LINE_PRICES, MinPriceReason, resolveMinLinePrice(), расширен B2BOrderItem, обновлён calcItem()
- `app/calculator/b2b/page.tsx` — добавлены minPriceReasonLabel(), totalMinPriceDelta, бэдж в строке, зачёркнутая старая цена, блок «Доп. выручка мин. цен»

**Логика:**
- `resolveMinLinePrice(category, width, height, hasTempering)` возвращает `{ minPricePerPiece, reason } | null`
- Пороги: узкая деталь < 250 мм → 3000 ₽/шт; тонировка+закалка → 3000; стекло+закалка → 2500; зеркало без закалки → 1500
- В `calcItem()`: если `saleIncVat < minPricePerPiece × quantity` → saleIncVat поднимается до минимума, записываются `minPriceApplied, minPriceReason, originalLinePrice, minLinePrice, minPriceDelta`
- `saleExVat`, `outputVat`, `margin` пересчитываются из поднятого saleIncVat
- UI: бэдж amber в строке с причиной; зачёркнутая цена в колонке "Сумма"; блок «N поз. с мин. ценой +X ₽» в итогах
- Нет миграции БД — `b2b_orders.items` JSONB хранит новые поля автоматически

---

### Procurement Material Requests MVP — СТАБИЛЬНАЯ РАБОЧАЯ ТОЧКА (9 июня 2026)

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
| `663482f` | feat(procurement): show material purchase table in order card |
| `0926073` | feat(procurement): add supplier PDF export for material purchases |

**Файлы изменены:** `app/admin/procurement/page.tsx`, `app/admin/layout.tsx`, `supabase/migrations/`, `components/Sidebar.tsx`, `app/b2b-orders/page.tsx`

#### Что работает

- `/b2b-orders` → выбрать заказы → **«📦 Материал»** → модалка «Ориентировочная потребность материала»
- Кнопка **«Передать в закупку»** создаёт запись в `purchase_orders`
- Записи заполняются: `items jsonb`, `b2b_order_ids`, `order_refs`, `amount`, `created_by`
- `/admin/procurement` доступен для ролей: `admin`, `ceo`, `cfo`, `buyer`
- Канбан закупок открывается без "This page couldn't load"
- Созданные заявки видны в колонке «Счёт получен»
- Все данные `purchase_orders` нормализуются через `normalizeOrder()` перед рендером
- При ошибке загрузки API — красный баннер вместо краша страницы
- Detail modal карточки закупки показывает полную таблицу материалов с колонками:
  - Материал (название + категория + badges)
  - Толщина
  - Формат листа
  - К закупке (количество листов)
  - Используется на заказы (из `area_m2` / `required_area_m2`)
  - Площадь закупаемых листов
  - Вес закупаемых листов
  - Стоимость листов
  - Заказы (order_refs badges)
- Итог по листам, м², кг, ₽ + отдельная строка «Используется на заказы»
- Кнопка **«Сформировать PDF поставщику»** в detail modal
- PDF формируется через `window.open + document.write + print()` — без новых npm-пакетов
- В PDF **нет** внутренних данных: стоимости, заказов, комментариев, используемой площади
- В PDF есть чистая закупочная спецификация: материал, толщина, формат листа, кол-во листов, площадь листов, вес, итог
- PDF блокируется предупреждением если `material_name` содержит «бронза/графит» / «бронза или графит»

#### Диагностика "This page couldn't load"

- Проблема: `/admin/procurement` падал в client render
- `274b7b6` — diagnostic stub подтвердил: layout / auth / route работают
- Причина: небезопасный render `purchase_orders` без нормализации JSONB
- Решение: `normalizeOrder()` + safe helpers (`safeItems`, `num`, `text`) перед любым render

#### Known limitations

- `supplier_name` = «Не выбран» — Вера выбирает/редактирует вручную после создания заявки
- Нет автосинхронизации `purchase_order.status → b2b_orders.notes.material_status`
- Нет прямой ссылки из `/b2b-orders` на созданный `purchase_order`
- Нет отдельной таблицы `material_request_items` — данные хранятся в JSONB `items`
- Нет складского резерва
- Если `material_name` содержит «бронза/графит» — нужно исправить справочник/калькулятор, чтобы менеджер выбирал точный материал при расчёте КП

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

---

## Что сделано (предыдущие сессии)

### Estimated Material Requirement in B2B Orders — ЗАКРЫТО (8 июня 2026)

**Коммиты:** `ee99a36`, `41ff95a`

**Файл:** только `app/b2b-orders/page.tsx`

- В `/b2b-orders` можно выбрать несколько заказов чекбоксами
- Кнопка **«📦 Материал (N)»** открывает модалку «Ориентировочная потребность материала»
- Расчёт группирует позиции по `materialName + thickness` из `b2b_orders.items`
- Модалка показывает: м² деталей, вес кг, листов к закупке, стоимость листов, заказы
- Расчёт выполняется на клиенте — без записи в БД, без сетевых запросов

---

### Cutting Oversized / Unplaced Safety Fix — ЗАКРЫТО (8 июня 2026)

**Коммиты:** `7e321f3` (алгоритм), `8f19db9` (UI)

**Файлы:** `lib/cuttingOptimizer.ts`, `app/b2b-cutting/page.tsx`

---

## Следующий шаг

**Не трогать procurement до ручной проверки на production:**
- открыть карточку закупки, созданную из `/b2b-orders`
- убедиться, что таблица материалов отображается корректно
- проверить PDF-экспорт

**После проверки — рекомендуемое следующее направление:**

**A. Правило минимальной стоимости малых деталей в B2B-калькуляторе**
- Проблема: маленькие детали (узкие полосы) дешевле листа — нужно минимальное ценовое правило
- Файл: `lib/b2bCalculator.ts`

**B. B2B glass/cutting support (Phase 2)**
- Подключить `lib/b2bCalculator.ts` к `b2bQuickQuoteTool` для `product_type: 'glass' | 'cutting'`
- Убрать `UNSUPPORTED_PRODUCT_TYPE_PHASE_1`

**C. Telegram auto-send Phase 2**
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_WORK_CHAT_ID` в ENV
- Server-side route `POST /api/b2b-quotes/[id]/send-telegram`

**D. Server-side PDF для B2C proposals**
- `app/api/ai/proposals/[id]/pdf/route.ts` через `@react-pdf/renderer`
- `@react-pdf/renderer` v4.5.1 уже установлен

## Контекст

- Весь код закоммичен, ветка `main`, HEAD = `0926073`
- `/admin/procurement` работает на production — стабилизирован
- `purchase_orders.items` JSONB структура: `{ material_name, category, thickness, sheet_width, sheet_height, area_m2, required_area_m2, sheets_count, weight_kg, estimated_cost, waste_percent, order_ids, order_refs, unmatched }`
- `getMatrixPrice` и `getWastePct` — pure functions из `lib/glassMatrix.ts`, server-side
- `app/admin/layout.tsx` разрешает роли: `admin`, `buyer`, `ceo`, `cfo`
- `b2bQuickQuoteTool` читает `partner_types` (SELECT only) + вызывает `quickCalcTool`

## Открытые вопросы

- `ai/skills/`, `ai/workflows/`, `ai/memory/` — директории не созданы, запланированы для будущих этапов
- Нет Anthropic binding — генерация детерминированная (`allowModelCall: false`)
- Нет CRM-read integration — клиент заполняется вручную
