## Текущая задача
Ожидание следующей задачи. Следующий рекомендуемый шаг — Material Requirement by selected B2B orders (см. ниже).

## Что сделано (сессия 7 июня 2026)

### Material Status Tracking in B2B Orders — ЗАКРЫТО (7 июня 2026, коммит `ccdde96`)

**Цепочка:** `b2b_orders.notes.material_status` → блок «МАТЕРИАЛ» в `/b2b-orders` → при `ordered+` синхронизация `stages.material_ordered` → `/b2b-cutting` видит «Материал заказан»

#### Что реализовано

1. В `/b2b-orders` в раскрытой карточке заказа добавлен блок **«МАТЕРИАЛ»** с select и цветным бейджем.
2. Статус материала хранится в `b2b_orders.notes.material_status` (JSONB, без миграции).
3. Статусы:

| Ключ | Лейбл | Цвет |
|---|---|---|
| `not_checked` | Не проверен | серый |
| `need_to_buy` | Нужно купить | красный |
| `ordered` | Заказан | синий |
| `invoice_received` | Счёт получен | amber |
| `paid` | Оплачен | teal |
| `shipped` | В пути / забрать | purple |
| `received` | Принят | green |

4. При `ordered / invoice_received / paid / shipped / received` — автовыставление `notes.stages.material_ordered` (только если было пустым).
5. Откат на `not_checked / need_to_buy` — `stages.material_ordered` **не очищается** (обратная совместимость с `/b2b-cutting`).
6. Не создаются закупочные заявки. `purchase_orders` не тронуты. CRM/Telegram не вызываются.
7. Изменён только `app/b2b-orders/page.tsx`.

#### Текущая архитектура (первый MVP)

- Первый MVP без миграции — статус в `notes.material_status`
- `stages.material_ordered` сохранён для обратной совместимости
- `purchase_orders` пока не связаны с `b2b_orders` (нет FK)
- Procurement kanban `/admin/procurement` не тронут

#### Known limitations

- Нет FK-связи `purchase_orders ↔ b2b_orders`
- Нет `material_requests` / `material_request_items`
- Нет автоматической закупочной заявки
- Нет полноценного склада, остатков и резервирования
- `notes` JSONB обновляется целиком → last-write-wins при одновременной работе двух пользователей
- Откат `material_status` на «Нужно купить» не очищает `stages.material_ordered`

---

### fix(admin/users): явное отображение null лимитов скидок — ЗАКРЫТО (7 июня 2026, коммит `2580913`)

- Тип `max_discount_percent` исправлен на `number | null`  
- При null — amber-кнопка «не задан» (клик → устанавливает 10%)
- Warning banner сверху: список менеджеров без лимита + напоминание о fallback 5%
- Раньше UI скрывал null, показывая "5" как будто лимит задан

### B2B Discount Approval Flow — ЗАКРЫТО (7 июня 2026)

**Цепочка:** manager save → `pending_approval` → `/b2b-quotes` «На согласовании» → admin/ceo «Согласовать» → `agreed`

#### Коммиты

| Коммит | Описание |
|---|---|
| `611cabe` | fix(b2b): allow managers to save quotes pending discount approval |
| `1fc2f42` | feat(b2b): add discount approval flow for quotes |

#### Что реализовано

1. Кнопка «Сохранить просчёт» больше не блокируется при `discount > maxDiscount`.
2. При превышении лимита просчёт сохраняется с `notes.status = 'pending_approval'`.
3. В `/b2b-quotes` добавлена вкладка «На согласовании» (фильтр: `getStatus(q) === 'pending_approval'`).
4. `pending_approval` отображается amber-бейджем «На согласовании» (добавлен в `STATUS_META`).
5. Manager не может запустить `pending_approval` «В работу» — видит спэн «Ожидает согласования».
6. Admin/ceo видит кнопку «Согласовать ✓».
7. По клику admin/ceo выполняется `UPDATE b2b_orders SET notes = { ...oldNotes, status: 'agreed', approved_at: ISO, approved_by: userId }`.
8. Старые поля `notes` не затираются. CRM, Telegram, создание заказов — не тронуты.
9. `userRole` и `currentUserId` загружаются из `users` таблицы в `loadQuotes()` и хранятся в state.

#### Зафиксированная бизнес-логика

- Сохранение просчёта нельзя блокировать только из-за превышения скидки.
- При превышении лимита просчёт сохраняется на согласование, не отклоняется.
- Запуск «В работу» запрещён до согласования.
- Согласование (переход в `agreed`) доступно только `admin` / `ceo`.

#### Known limitations

- Нет отдельного notification для руководителя при появлении `pending_approval`.
- Нет отдельной истории approval events — только запись в `status_history` внутри `notes`.
- RLS пока не разделяет manager/admin на уровне `b2b_orders` — это будущий hardening.
- Нужно проверить/заполнить `users.max_discount_percent` для всех менеджеров: `null`-значение триггерит fallback 5%, что может быть слишком жёстким.

#### Production QA — ПРОЙДЕНО (7 июня 2026)

Подтверждено пользователем: «всё отлично, проверил — работает».

---

## Что сделано (сессия 4–5 июня 2026)

### Архитектурный аудит mirror — ЗАКРЫТО
- Найдено расхождение: quickCalc использовал public.materials, /calculator/mirror — glass_price_matrix
- Задокументировано 3 варианта (A/B/C), выбран вариант B (rewrite mirror-ветки)

### fix(ai): mirror proposals use glass price matrix — ЗАКРЫТО (коммит `2071f94`)

Что изменено архитектурно:
- **Раньше:** AI mirror брал цену из `public.materials.sale_price / cost_price`
- **Теперь:** AI mirror берёт цену из `glass_price_matrix` через `getMatrixPrice()` — тот же источник, что `/calculator/mirror`
- Fallback на `public.materials` сохранён как safety fallback с explicit warning
- `/calculator/mirror` и AI Proposal mirror теперь используют один мастер-источник цены

### Mirror pricing parity micro-audit — ЗАКРЫТО

SQL-верификация подтвердила:
- `owner_strategy`: target_margin=40, min_margin=25
- `financial_settings` mirror: default_margin=40, tax=12, min_margin=25
- `financial_settings` mirror_light: default_margin=50, tax=12, min_margin=30
- Причина расхождения: quickCalc безусловно использовал `mirror_light` (margin=50), игнорируя `hasLighting`
- Дополнительно: `mirrorWastePct` (=18%) не передавался в `calculateMirror`

### fix(ai): align mirror proposal pricing with calculator — ЗАКРЫТО (коммит `76dffa4`)

Что изменено (только `lib/quickCalc.ts`, mirror-ветка):
- **mirrorWastePct:** берётся из `glass_price_matrix.waste_pct` через `getWastePct()`, передаётся в `calculateMirror`
- **tax fallback:** выровнен с 11 на 12 (соответствует `financial_settings.tax_percent`)
- **Warnings:** добавлены для отсутствующих `waste_pct` и `financial_settings`
- shower/loft ветки — не тронуты

### fix(ai): include default lighting components in mirror proposals — ЗАКРЫТО (коммит `bce1224`)

Что изменено (только `lib/quickCalc.ts`, mirror-ветка):
- `loadAll()` расширен: теперь запрашивает `mirror_lighting_components` (5-я таблица)
- При `hasLighting=true` auto-select: frame, LED 12V, PSU (авто-подбор по мощности), diffuser
- Компоненты передаются в `calculateMirror` — lighting cost учитывается в расчёте
- Добавлено warning о стандартной комплектации подсветки

### fix(ai): use calculator margin for mirror lighting proposals — ЗАКРЫТО (коммит `21db841`)

Что изменено (только `lib/quickCalc.ts`, mirror-ветка):
- **До:** `mirrorSettingsType = options.hasLighting ? 'mirror_light' : 'mirror'` → при `hasLighting=true` использовался margin=50%
- **После:** `mirrorSettingsType = 'mirror'` (константа) → всегда margin=40%, как в `/calculator/mirror`
- `hasLighting` теперь влияет только на: состав компонентов, label КП, warnings
- `mirror_light` (margin=50%) больше не используется для AI Proposal mirror pricing

### Production QA mirror lighting + pricing parity — ЗАКРЫТО (5 июня 2026)

| # | Тест | Параметры | Результат | Статус |
|---|---|---|---|---|
| 1 | Baseline /calculator/mirror без подсветки | Осветлённое, 4 мм, 800×600 | 4 685 ₽ | ✅ |
| 2 | AI Proposal без подсветки | Осветлённое, 4 мм, 800×600 | 4 685 ₽ | ✅ |
| 3 | Baseline /calculator/mirror с подсветкой | Серебро, 4 мм, 800×600 | 4 052 ₽ | ✅ |
| 4 | AI Proposal с подсветкой | Серебро, 4 мм, 800×600, hasLighting=true | 4 052 ₽ | ✅ |
| 5 | Title без подсветки | hasLighting=false | не содержит "с подсветкой" | ✅ |
| 6 | Title с подсветкой | hasLighting=true | содержит "Зеркало с подсветкой" | ✅ |
| 7 | Warnings | hasLighting=true | предупреждение о стандартной комплектации | ✅ |
| 8 | Safety flags | все proposals | approval_required=true, can_send=false, can_write_crm=false, can_create_order=false, model_call=false | ✅ |
| 9 | Безопасность | — | CRM не трогалась, клиенту не отправлялось, заказ не создавался, Anthropic/OpenAI не вызывались | ✅ |

**Вывод:** AI Proposal mirror полностью совпадает с `/calculator/mirror` для двух основных сценариев: зеркало без подсветки (4 685 ₽) и зеркало с подсветкой по стандартной комплектации (4 052 ₽).

### Архитектурный итог — mirror proposal pricing fully aligned

Единые источники данных для AI Proposal mirror и `/calculator/mirror`:

| Компонент | Источник |
|---|---|
| Цена стекла | `glass_price_matrix` → `getMatrixPrice()` |
| Waste % | `glass_price_matrix.waste_pct` → `getWastePct()` |
| Margin / tax | `financial_settings` `product_type='mirror'` (margin=40, tax=12) |
| Подсветка | `mirror_lighting_components` (auto-select по sort_order/id) |

Цепочка коммитов:
- `2071f94` — glass_price_matrix как источник цены стекла
- `76dffa4` — правильный margin/waste, tax=12
- `bce1224` — default lighting components включены в cost
- `21db841` — mirror_light margin исключён, используется margin=40 везде

### fix(ai): align KP draft payload with approval UI schema — ЗАКРЫТО (коммит `f370b7a`)

Файл изменён: только `lib/ai-tools/generateKpDraftTool.ts`

Что изменено:
- **`KpDraftContent.items`** приведён к схеме `DraftItem`, которую ждёт Approval UI:
  - `line_item`, `dimensions?`, `quantity`, `unit_price`, `total_price`, `note?`
- **Bug fix:** продукт теперь всегда первая строка `items` — раньше при наличии service_lines продукт выпадал
- **service_lines** добавляются после продукта (монтаж, доставка)
- **`terms`** приведён к UI-схеме: `lead_time_days`, `payment_terms`, `warranty`, `validity_days`
- **`price_summary`** приведён к UI-схеме: `subtotal`, `total`, `currency: 'RUB'`, `vat_included`
- **`manager_message`** стал человекочитаемым: содержит изделие, размер, итоговую цену
- Расчёт цены не менялся. `quickCalc.ts` не тронут. Safety invariants не изменялись.

### Production QA — KP draft payload schema alignment — ЗАКРЫТО (5 июня 2026)

| # | Тест | Параметры | Результат | Статус |
|---|---|---|---|---|
| 1 | Позиции mirror с подсветкой | Серебро, 4 мм, 800×600, hasLighting=true | "Зеркало с подсветкой", 800×600 мм, qty=1, price заполнен | ✅ |
| 2 | Цена с подсветкой | — | 4 052 ₽ (не изменилась) | ✅ |
| 3 | Mirror без подсветки | Осветлённое, 4 мм, 800×600 | "Зеркало", 4 685 ₽ | ✅ |
| 4 | Terms отображаются | — | Срок 7–14 дн., оплата, гарантия 12 мес., действие 14 дн. | ✅ |
| 5 | Copy draft | кнопка "Скопировать черновик" | текст без `undefined` | ✅ |
| 6 | Shower proposal | любой shower | proposal создаётся, items отображаются | ✅ |
| 7 | Safety flags | все proposals | approval_required=true, can_send=false, can_write_crm=false, can_create_order=false, model_call=false | ✅ |

**Вывод:** Таблица позиций в Approval UI заполнена корректно. Copy draft работает без артефактов. Цены не изменились.

### feat(ai): add printable B2C proposal page — ЗАКРЫТО (коммит `84e5e90`)

Что реализовано:
- Создан `/admin/ai-proposals/[id]/print` — отдельная HTML print страница
- Добавлена кнопка "Открыть КП для печати" на detail page (`[id]/page.tsx`)
- Страница рендерит B2C КП: шапка, клиентский блок, таблица позиций, итоги, условия, footer
- Backward compatibility: `normItem()` поддерживает старую схему `{name, price}` и новую `{line_item, unit_price, total_price}`
- Подсказка про отключение Chrome headers/footers

### fix(ai): align printable proposal layout with B2C reference — ЗАКРЫТО (коммит `ecb8edd`)

Что изменено:
- Компактный header: бренд, контакты, метаданные в одну строку
- Убран тёмный card-стиль шапки

### fix(ai): match printable proposal to M-Glass B2C reference — ЗАКРЫТО (коммит `c4be2db`)

Что изменено (только `app/admin/ai-proposals/[id]/print/page.tsx`):
- Убран `[M]` box-icon — заменён plain-текстом `M GLASS` (17px, weight 800)
- Убран Georgia-шрифт полностью
- Layout шапки переделан на HTML `<table>` (3 ячейки: бренд | контакты | мета)
- Клиентский блок — HTML `<table>`
- Блок итогов — HTML `<table>`
- ИТОГО: plain жирная строка таблицы, без бежевого badge / background
- Footer: только `"Благодарим за обращение!"` right-aligned
- `@page { margin: 12mm 14mm }`

### Production QA — Printable B2C proposal page — ЗАКРЫТО (5 июня 2026)

| # | Тест | Результат | Статус |
|---|---|---|---|
| 1 | `/admin/ai-proposals/9/print` открывается | Страница загружается | ✅ |
| 2 | Визуал | Подтверждён пользователем как похожий на рабочее КП M-Glass | ✅ |
| 3 | Таблица позиций | Заполнена из `draft_payload.items` | ✅ |
| 4 | Итог | Совпадает с `draft_payload.price_summary.total` | ✅ |
| 5 | Print preview | Работает через Cmd+P / браузерный диалог | ✅ |
| 6 | Статус proposal | Не меняется при открытии print page | ✅ |
| 7 | Safety | GET-only, CRM не трогается, заказ не создаётся, model call не выполняется | ✅ |

Цепочка коммитов print-блока:
- `84e5e90` — создан print page + кнопка на detail page
- `ecb8edd` — компактный header, первый round layout alignment
- `c4be2db` — полный rewrite под M-Glass B2C reference

---

## B2B Quick Quote Tool / Runtime / API — ЗАКРЫТО (5 июня 2026)

### Что реализовано

| Файл | Назначение | Коммит |
|---|---|---|
| `lib/ai-tools/b2bQuickQuoteTool.ts` | Read-only tool: mirror/shower/loft + партнёрская скидка | `ab6c0da` |
| `lib/ai-tools/createB2BQuickQuoteRuntime.ts` | Orchestrator → нормализованный draft-envelope | `455f8df` |
| `app/api/ai/b2b-quote/draft/route.ts` | POST /api/ai/b2b-quote/draft | `2583fa0` |
| `lib/ai-tools/b2bQuickQuoteTool.test-plan.md` | 16 тест-кейсов для tool | `ab6c0da` |
| `lib/ai-tools/createB2BQuickQuoteRuntime.test-plan.md` | 10 тест-кейсов для runtime | `455f8df` |
| `app/api/ai/b2b-quote/draft/test-plan.md` | 7 тест-кейсов для API route | `2583fa0` |

### Поддерживаемые product_type (Phase 1)

| Тип | Статус |
|---|---|
| mirror | ✅ |
| shower | ✅ |
| loft | ✅ |
| glass | ❌ `UNSUPPORTED_PRODUCT_TYPE_PHASE_1` |
| cutting | ❌ `UNSUPPORTED_PRODUCT_TYPE_PHASE_1` |

### Партнёрская скидка

- `partner_discount_override` — override-скидка вручную (0–100%)
- `partner_type_id` — читает `partner_types` (SELECT only), берёт `percent`
- Приоритет: override > partner_types > 0

### Hardcoded safety flags (все response paths)

```
approval_required:   true
can_send_to_client:  false
can_write_crm:       false
can_create_order:    false
model_call_executed: false
```

### Auth

`ALLOWED_ROLES = new Set(['admin', 'manager', 'buyer'])`

### Что НЕ реализовано на этом этапе

- Нет UI для AI B2B Quick Quote (`/admin/ai-b2b-quote`)
- `agent_action_log` запись не выполняется (подготовлен `output_snapshot` и `draft_payload`)
- CRM не трогается
- Заказы не создаются
- Telegram не вызывается

---

## B2B Telegram work text copy action — ЗАКРЫТО (5 июня 2026)

### Что реализовано

На странице `/b2b-quotes` добавлена кнопка **"ТГ"** рядом с кнопкой PDF.

Файл: `app/b2b-quotes/page.tsx`

Цепочка коммитов:
- `0a79b9d` — кнопка "ТГ", базовое копирование, clipboard API
- `9891a2a` — группировка позиций (стёкла суммируются по материалу+толщине+закалке, зеркала по материалу+толщине+форме)
- `64c2af7` — нормализация порядка слов: `Стекло {мм} {тип} {закаленное}`, `Зеркало {мм} {тип} {форма}`

### Поведение кнопки

- Копирует текст в `navigator.clipboard`
- Fallback: `window.prompt()` если clipboard недоступен
- Показывает `✓` 2 секунды + toast "Текст для Telegram скопирован"
- **Не делает никаких сетевых запросов**
- **Не меняет статус расчёта**
- **Не пишет в Supabase / CRM**
- **Не отправляет сообщение в Telegram автоматически**

### Нормализация имени клиента

`"M GLASS"` / `"MGlass"` → `"МГЛАСС"`

### Формат Telegram-текста

```
{custom_number || КП-{id}}
{clientName}
Стекло {thickness}мм {grade} {закаленное?} - {qty} шт
Зеркало {thickness}мм {mirrorType} {shape} - {qty} шт

🥝{total} руб
```

### Production QA — Telegram work text — ЗАКРЫТО (5 июня 2026)

Проверен на расчёте **0150-0**. Подтверждён пользователем как "всё супер".

```
0150-0
МГЛАСС
Стекло 8мм м1 закаленное - 13 шт
Зеркало 4мм сильвер прямоугольное - 18 шт
Зеркало 4мм сильвер круглое - 6 шт

🥝77.623 руб
```

| # | Тест | Результат | Статус |
|---|---|---|---|
| 1 | Кнопка "ТГ" присутствует рядом с PDF | ✅ | ✅ |
| 2 | Позиции группируются (13 стёкол = 1 строка) | ✅ | ✅ |
| 3 | Клиент M GLASS → МГЛАСС | ✅ | ✅ |
| 4 | Порядок строк: `Стекло 8мм м1 закаленное` | ✅ | ✅ |
| 5 | Порядок строк: `Зеркало 4мм сильвер прямоугольное` | ✅ | ✅ |
| 6 | Сумма: `🥝77.623 руб` | ✅ | ✅ |
| 7 | PDF-кнопка не сломалась | ✅ | ✅ |
| 8 | Статус расчёта не меняется | ✅ | ✅ |
| 9 | Нет сетевых запросов при клике "ТГ" | ✅ | ✅ |

### Safety подтверждение

- Telegram API не подключён, бот не используется
- Автоматической отправки нет — только clipboard copy
- PDF-кнопка не изменилась
- Цена не пересчитывается
- Статусы расчётов не меняются

---

## Production Detail Tracker MVP — ЗАКРЫТО (5 июня 2026)

### Цепочка коммитов

| Коммит | Описание |
|---|---|
| `de02012` | docs(production): add production detail tracker plan |
| `08851b9` | feat(production): add B2B production sheet with QR |
| `3bd51f7` | feat(production): add mobile order work page |
| `02d3a0b` | feat(production): save detail stages and fix mobile totals |
| `829d84e` | fix(production): hide tempering stage for mirrors |

### Рабочий flow

`/b2b-orders` → кнопка "🖨 Лист" → `/b2b-orders/{id}/production-sheet` → QR → `/p/o/{id}` → выбор позиций → отметка этапа → `b2b_orders.notes.detail_stages`

### Архитектура (Variant A — без миграции)

- Статусы деталей хранятся в `b2b_orders.notes.detail_stages` (TEXT-колонка, JSON)
- Ключ позиции = `itemIndex` (строковый индекс из `b2b_orders.items` JSONB)
- QR кодирует заказ целиком (`/p/o/{orderId}`), не отдельную деталь
- Нет отдельной таблицы `b2b_order_details` — Variant A намеренно
- `/b2b-production` считается устаревшей для нового production flow
- Основной production flow строится вокруг `/b2b-orders`

### Этапы

| Ключ | Название | Ограничение |
|---|---|---|
| `cutting` | Резка | Все позиции |
| `polishing` | Полировка | Все позиции |
| `drilling` | Сверление | Все позиции (временно — признаков отверстий в данных нет) |
| `tempering` | Закалка | Только `hasTempering=true` и не зеркало (`isMirrorItem=false`) |
| `packaging` | Упаковка | Все позиции |
| `problem` | Проблема | Все позиции |

### Определение зеркала

```typescript
const MIRROR_RE = /зеркало|mirror|silver|серебро|сильвер/i
isMirrorItem(item)       → MIRROR_RE.test(`${materialName} ${category}`)
itemNeedsTempering(item) → hasTempering === true && !isMirrorItem(item)
```

### Структура `notes.detail_stages`

```json
{
  "status": "...",
  "launched_at": "...",
  "detail_stages": {
    "0": {
      "cutting": { "status": "done", "updated_at": "...", "updated_by": "uuid", "updated_by_email": "..." }
    }
  }
}
```

Merge: `{ ...notesObj, detail_stages: newStages }` — `notes.status`, `notes.stages`, `notes.work_started_at` не затираются.

### Итоги позиций (исправлено в `02d3a0b`)

```typescript
itemAreaM2(item)   → totalAreaNet || (w × h / 1_000_000 × qty)
itemWeightKg(item) → totalWeight  || (area × thickness × 2.5)
totalArea          → sum(itemAreaM2) сначала, fallback order.total_area
totalWeight        → sum(itemWeightKg) сначала, fallback order.total_weight
```

### Production QA — ПРОЙДЕН (5 июня 2026)

- Мобильная страница `/p/o/{id}`: позиции, итоги, выбор, отметка этапов — работает
- After reload: статусы сохраняются
- Правило "у зеркал нет закалки" — исправлено, подтверждено пользователем
- Safety: SELECT при загрузке, UPDATE notes только по клику; нет Telegram, CRM, AI call, создания заказов

### Known limitations

- `itemIndex` нестабилен, если порядок `items` изменится
- Нет отдельной таблицы `b2b_order_details` и истории событий
- Нет ролей production
- Нет прогресса этапов в `/b2b-orders`
- Нет undo / отмены отметки
- Нет optimistic locking при одновременной работе двух пользователей
- `drilling` виден универсально — признаков отверстий/вырезов в данных пока нет

---

## Следующий шаг

**Рекомендуемый следующий: Material Requirement by selected B2B orders**

- Выбрать несколько B2B-заказов (чекбоксы)
- Нажать «Сформировать материал»
- Сгруппировать потребность по `b2b_materials` (материал + толщина): м², листы, вес, стоимость
- Показать, из каких заказов складывается потребность
- Первый этап — без сохранения в БД (только расчёт на клиенте)

**Другие независимые направления:**

**E. Production Detail Tracker — прогресс этапов в /b2b-orders** — ЗАКРЫТО (коммит `834aa69`)

**A. AI B2B Quick Quote Admin UI** (`/admin/ai-b2b-quote`)
- Форма ввода параметров запроса
- Отображение результата (позиции, цена, скидка, manager_internal)
- Кнопка копирования ответа партнёру
- Предварительно: сохранение результата в `agent_action_log` (Commit 5)

**B. B2B glass/cutting support (Phase 2)**
- Подключить `lib/b2bCalculator.ts` к `b2bQuickQuoteTool` для `product_type: 'glass' | 'cutting'`
- Убрать `UNSUPPORTED_PRODUCT_TYPE_PHASE_1` для этих типов

**C. Telegram auto-send Phase 2**
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_WORK_CHAT_ID` в ENV
- Server-side route `POST /api/b2b-quotes/[id]/send-telegram`
- Confirmation before send
- Отправка текста + PDF
- Logging sent status + защита от дублей

**D. Server-side PDF для B2C proposals** (незакрытое из предыдущей сессии)
- `app/api/ai/proposals/[id]/pdf/route.ts` через `@react-pdf/renderer`
- Чистый PDF без Chrome headers/footers

## Контекст

- Весь код закоммичен на production (Vercel), ветка `main`
- `getMatrixPrice` и `getWastePct` — pure functions из `lib/glassMatrix.ts`, server-side
- `loadAll()` в `quickCalc.ts` запрашивает 5 таблиц: materials, services, financial_settings, glass_price_matrix, mirror_lighting_components
- Shower и loft ветки не тронуты ни одним из зеркальных коммитов
- `@react-pdf/renderer` v4.5.1 уже установлен — готов к server-side PDF route
- `b2bQuickQuoteTool` читает `partner_types` (SELECT only) + вызывает `quickCalcTool`
- `output_snapshot` и `draft_payload` готовы к сохранению в `agent_action_log` (следующий этап)

## Текущие ограничения (known limitations)

- Print page — HTML + браузерный Print / Save as PDF; нет `/api/ai/proposals/[id]/pdf`
- Chrome headers/footers нужно отключать вручную перед сохранением PDF
- UI пока не даёт выбирать LED/профиль/БП/рассеиватель вручную — стандартная комплектация
- `draft_payload.items` не раскрывает полноценный состав позиции (только итоговая строка)
- Нет редактирования черновика перед approve
- Нет pagination в списке `/admin/ai-proposals`
- Нет rate limiting на POST `/api/ai/proposals/draft` и `/api/ai/b2b-quote/draft`
- AI B2B Quick Quote: нет UI, нет `agent_action_log` записи, нет Telegram отправки
- B2B Telegram: только clipboard copy, Telegram API не подключён, нет авто-отправки
- `product_type: 'glass' | 'cutting'` не поддерживается в `b2bQuickQuoteTool` (Phase 2)

## Открытые вопросы

- `ai/skills/`, `ai/workflows/`, `ai/memory/` — директории не созданы, запланированы для будущих этапов
- Нет Anthropic binding — генерация детерминированная (`allowModelCall: false`)
- Нет CRM-read integration — клиент заполняется вручную
- RLS на `shower_catalog_items` не настроена явно
