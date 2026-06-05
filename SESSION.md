## Текущая задача
Printable B2C proposal page — ЗАКРЫТО. Этап остановлен. Следующий шаг — выбор между server-side PDF и cost breakdown propagation.

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

## Следующий шаг

Выбрать один из двух вариантов при возвращении:

**A. Server-side PDF download route:**
- `components/ProposalPDF.tsx` — PDF-компонент через `@react-pdf/renderer` (уже установлен)
- `app/api/ai/proposals/[id]/pdf/route.ts` — route с `renderToBuffer`, `runtime='nodejs'`
- Даст чистый PDF без Chrome headers/footers, скачиваемый напрямую

**B. Cost breakdown propagation:**
1. Прокинуть `costLines` из `calculateMirror` / `calculateShower` / `calculateLoft` через `quickCalc` → `QuickCalcResult`
2. Добавить `costLines` в `QuickCalcToolCalculation`
3. Передать `costLines` в `KpCalcSummary` через `toKpCalcSummary()`
4. `generateKpDraftTool` строит `items` из `costLines` (стекло, профиль, LED, БП, рассеиватель, комплектующие, сборка)
5. Разделить `client_items` (для КП) и `internal_cost_breakdown` (только для менеджера)

## Контекст

- Весь код закоммичен на production (Vercel), ветка `main`
- `getMatrixPrice` и `getWastePct` — pure functions из `lib/glassMatrix.ts`, server-side
- `loadAll()` в `quickCalc.ts` запрашивает 5 таблиц: materials, services, financial_settings, glass_price_matrix, mirror_lighting_components
- `loadGlassMatrix()` (browser) не вызывается в `quickCalc.ts` — используется server-side `db()`
- Shower и loft ветки не тронуты ни одним из коммитов
- Supabase schema не менялась
- `@react-pdf/renderer` v4.5.1 уже установлен — готов к server-side PDF route

## Текущие ограничения (known limitations)

- Print page — HTML + браузерный Print / Save as PDF; нет `/api/ai/proposals/[id]/pdf`
- Chrome headers/footers нужно отключать вручную перед сохранением PDF
- Финальная pixel-perfect верстка может быть улучшена позже при необходимости
- Internal cost breakdown пока не выведен в print page
- UI пока не даёт выбирать LED/профиль/БП/рассеиватель вручную — используется стандартная комплектация
- `draft_payload.items` не раскрывает полноценный состав позиции (только итоговая строка)
- Нет редактирования черновика перед approve
- Нет pagination в списке `/admin/ai-proposals`
- Нет rate limiting на POST `/api/ai/proposals/draft`
- RLS на `shower_catalog_items` не настроена явно

## Открытые вопросы

- `ai/skills/`, `ai/workflows/`, `ai/memory/` — директории не созданы, запланированы для будущих этапов
- Нет Anthropic binding — генерация детерминированная (`allowModelCall: false`)
- Нет CRM-read integration — клиент заполняется вручную
