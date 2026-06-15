## Текущая задача
Loading Safety Audit — этап 2 — закрыт и закоммичен (24e0230), pushed.

---

## Loading Safety Audit — этап 2 — ЗАКРЫТО (15 июня 2026)

### 1. Коммит

`24e0230` — fix(admin): add loading error recovery to operations pages

### 2. Страницы этапа

- `/admin/glass-prices`
- `/admin/procurement`

### 3. Что было найдено

**`/admin/procurement`:**
- уже имел `loadError` state
- уже имел `try/catch/finally` в `load()`
- уже имел error banner в UI
- `loadPayments()` имеет намеренный non-critical `catch` с комментарием
- файл не менялся в этом этапе

**`/admin/glass-prices`:**
- `load()` не имел `try/catch/finally` — `fetch('/api/admin/glass-prices')` мог упасть до `setLoading(false)` → вечный spinner
- `loadB2BData()` — `Promise.all` без защиты → unhandled rejection при сетевой ошибке
- нет `loadError` state, нет error block, нет Retry

### 4. Что изменено в /admin/glass-prices

- добавлен `loadError` state
- `load()` обёрнут в `try/catch/finally`; `finally` всегда снимает `loading`
- non-ok response теперь переводится в `loadError` (ветка `else`)
- добавлен error block "Не удалось загрузить справочник стекла" + кнопка "Повторить"
- `loadB2BData()` обёрнут в `try/catch` с `console.error` (нет своего loading state — Retry не нужен)

### 5. Что не трогалось

Бизнес-логика `/admin/procurement`: статусы, платежи, история, PDF поставщику.
Бизнес-логика `/admin/glass-prices`: save/edit цен, форматы листов, сделать основным, скрыть/показать, sync b2b materials.
`/b2b-orders`, `/b2b-quotes`, `/calculator/b2b`, `/admin/users`, migrations, `package.json`.

### 6. Production test-plan

1. Открыть `/admin/glass-prices` — матрица цен загружается, "Загрузка..." исчезает.
2. DevTools → Network → Offline → перезагрузить `/admin/glass-prices`.
3. Должен появиться блок "Не удалось загрузить справочник стекла".
4. Вернуть сеть → нажать "Повторить" → данные загружаются.
5. Проверить цены, поставщиков, форматы листов, "Сделать основным", "Скрыть/Показать", sync b2b materials.
6. Открыть `/admin/procurement` — канбан, платежи, история, PDF поставщику работают.

### 7. Итоговое правило

Критичные админ-страницы должны иметь recoverable loading: `loading` + `error` state + Retry, или уже существующий error banner.

---

## Loading Safety Audit — этап 1 — ЗАКРЫТО (15 июня 2026)

### 1. Коммит

`b7b9daa` — fix(b2b): add loading error recovery to main pages

### 2. Страницы

- `/b2b-quotes`
- `/b2b-orders`

### 3. Причина

`Promise.all` из нескольких Supabase-запросов мог упасть, после чего `loading` не снимался и страница зависала на "Загрузка..." без возможности восстановления.

### 4. Что изменено

**`/b2b-quotes`:**
- `loadQuotes()` — добавлен `loadError` state
- обёрнут в `try/catch/finally`; `finally` всегда вызывает `setLoading(false)`
- добавлен `setLoading(true)` в начало (для Retry)
- добавлен error block "Не удалось загрузить данные" + кнопка "Повторить"

**`/b2b-orders`:**
- inline `load()` из useEffect вынесен в компонентную функцию `loadOrders()`
- добавлен `loadError` state
- обёрнут в `try/catch/finally`
- `useEffect` упрощён до `useEffect(() => { loadOrders() }, [])`
- добавлен error block "Не удалось загрузить данные" + кнопка "Повторить"

### 5. Правило на будущее

Для основных загрузок страниц использовать pattern:

```ts
setLoading(true)
setLoadError(null)

try {
  // load data
} catch (error) {
  console.error(...)
  setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить данные')
} finally {
  setLoading(false)
}
```

### 6. Production test-plan

1. Открыть `/b2b-quotes` — список загружается, "Загрузка..." исчезает.
2. Открыть `/b2b-orders` — список загружается, "Загрузка..." исчезает.
3. DevTools → Network → Offline → перезагрузить страницу.
4. Должен появиться блок "Не удалось загрузить данные".
5. Вернуть сеть.
6. Нажать "Повторить".
7. Данные должны загрузиться.
8. В `/b2b-quotes` проверить: В работу, Отказ, PDF, КП.
9. В `/b2b-orders` проверить: Production Day, deadline badges, 📦 Материал.

### 7. Что не трогалось

Бизнес-логика `/b2b-quotes` и `/b2b-orders`: В работу, Отказ, PDF, HTML КП, approval flow, Production Day, deadline control, bulk cleanup, material requirement, payment badges, `/admin/procurement`, `/admin/glass-prices`, migrations, `package.json`.

### 8. Следующий этап

Loading Safety Audit — этап 2: `/admin/procurement`, `/admin/glass-prices`

---

## Admin Users: All Clients Access Toggle — ЗАКРЫТО (15 июня 2026)

### 1. Коммит

`f32ace6` — feat(admin-users): add all clients access toggle

### 2. Причина

В `/admin/users` было только право:

- **Заказы:** Все / Свои (`see_all_orders`)

Но не было отдельного права:

- **Клиенты:** Все / Свои

Из-за этого пользователь мог видеть все заказы, но в `/calculator/b2b` всё равно видел только своих клиентов.

### 3. Новая модель доступа

- **Заказы:** Все / Свои — `see_all_orders`
- **Клиенты:** Все / Свои — `can_view_all_clients`

Это независимые права. Можно включить одно без другого.

### 4. Новое поле

```
can_view_all_clients boolean NOT NULL DEFAULT false
```

Миграция: `supabase/migrations/20260615_add_can_view_all_clients_to_users.sql`

SQL для production (применить вручную в Supabase SQL Editor):
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_all_clients boolean NOT NULL DEFAULT false;
```

### 5. Что изменено

**`/admin/users` (`app/admin/users/page.tsx`):**
- Добавлен столбец «Клиенты»
- Переключатель «Все / Свои» (тот же паттерн что «Заказы»)
- Работает независимо от столбца «Заказы»
- `colSpan` расширен до 10

**`app/api/admin/users/route.ts`:**
- `can_view_all_clients` добавлен в SELECT полного запроса

**`/calculator/b2b` (`app/calculator/b2b/page.tsx`):**
- `can_view_all_clients` добавлен в profile SELECT
- `userCanSeeAllClients = userIsAdmin || profile?.can_view_all_clients === true`
- `visibleClients` фильтруется по `userCanSeeAllClients` (не по `userIsAdmin`)

### 6. Что не трогалось

`/b2b-orders`, `/b2b-quotes`, PDF КП, HTML КП, `/admin/procurement`, закупки, платежи, Production Day, glass-prices sheet variants

### 7. Production test-plan

1. Применить миграцию в Supabase SQL Editor.
2. Открыть `/admin/users` — убедиться что появился столбец «Клиенты».
3. Для Дмитрия поставить «Клиенты: Все».
4. Обновить страницу — значение должно сохраниться.
5. Зайти под Дмитрием в `/calculator/b2b`.
6. Убедиться что видны все B2B-клиенты.
7. Вернуть «Клиенты: Свои» — должны остаться только свои.
8. Проверить что «Заказы: Все» работает независимо.

---

### B2B HTML Proposal Alignment — ЗАКРЫТО (15 июня 2026)

**Коммит:** `ce6bf2a`

**Файл:** `app/b2b-quotes/[id]/kp/page.tsx`

**Итоговое правило:**
`/b2b-quotes`, PDF КП и HTML КП должны отображать одни и те же коммерческие данные, без внутреннего производственного шума.

**Что исправлено:**
- Убран дублирующий номер формата `КП-YYYYMM-NNNN` (генерировался из id + даты, показывался рядом с `custom_number`)
- КП № теперь один: `custom_number?.trim() || id.padStart(5, '0')` — как в PDF
- Дата берётся из `notes.quote_date || created_at` — как в PDF route
- Срок действия приведён к 14 дням (было 7) — как в PDF
- Добавлена «Персональная скидка X%» в блок клиента при `discount > 0` — как в PDF
- Услуги уже отображались sub-rows `↳` — оставлено без изменений

**Что теперь совпадает между /b2b-quotes, PDF КП и HTML КП:**
- Клиент, КП №, № клиента, дата
- Позиции (размеры, м², вес)
- Скидка % и итого к оплате
- Услуги как sub-rows

**Что НЕ попадает в HTML КП:**
- Себестоимость, предварительная закупка
- Supplier / cost данные, маржа
- Payment status, production status, deadline_control, bulk_actions

**Production test-plan:**
1. `/b2b-quotes` → LoLegko / КП 00590 → нажать «КП»
2. Шапка: один номер **КП № 00590** (без `КП-202506-0590`)
3. «Персональная скидка **10%**» в блоке клиента
4. 3 позиции, площадь **3,164 м²**, вес **63,3 кг**, итог **19 892 ₽**
5. «Действует до» = дата + **14 дней**
6. 📄 PDF продолжает работать и показывает те же данные

---

### B2B PDF Proposal Alignment — ЗАКРЫТО (15 июня 2026)

**Коммит:** `f4ceaf8`

**Файлы:**
- `components/QuotePDF.tsx`
- `app/api/quotes/[id]/pdf/route.ts`

**Решение по процессу:**
- `/b2b-quotes` — источник правды по B2B-просчёту
- PDF КП — клиентская печатная версия этого же просчёта; данные не пересчитываются, только маппинг

**Что исправлено:**
- `app/api/quotes/[id]/pdf/route.ts` теперь выбирает `custom_number`, `client_order_number` из `b2b_orders`
- `QuotePDFProps` расширен: `customNumber?`, `clientOrderNumber?`, `services?` в items
- КП № берётся из `customNumber?.trim()`, fallback — `id.padStart(5, '0')`
- `client_order_number` показывается под КП № в шапке PDF
- `services[]` передаются в PDF items и отображаются как sub-rows `↳ {name}` под основной строкой материала
- `saleIncVat` уже включает стоимость услуг → материальная строка = `saleIncVat − svcTotal`, каждая услуга — отдельный sub-row; итог позиции не меняется

**Что теперь совпадает между /b2b-quotes и PDF:**
- Клиент, КП №, № клиента
- Позиции (количество, размеры, м²)
- Вес
- Скидка %
- Итого к оплате
- Услуги (закалка, фигурная обработка и т.д.)

**Что НЕ попадает в PDF:**
- Себестоимость (`costExVat`)
- Предварительная закупка (`computeProductionSummary`)
- Supplier / cost данные (`cost_price`, `supplier_material_name`)
- Маржа (`margin_percent`)
- Payment status, production status, deadline_control, bulk_actions

**Production test-plan:**
1. `/b2b-quotes` → расчёт LoLegko / КП 00590 → нажать `📄 PDF`
2. PDF показывает:
   - КП № **00590** (из `custom_number`)
   - Клиент: **LoLegko**
   - 3 позиции
   - Площадь **3,164 м²**
   - Вес **63,3 кг**
   - Скидка **10%**
   - Итого **19 892 ₽**
   - Услуги как sub-rows под материалом
   - Без себестоимости, поставщика, маржи, статусов

**Что не трогалось:**
- `/b2b-orders`, `/admin/procurement`, закупки, Production Day
- Калькулятор (`lib/b2bCalculator.ts`)
- HTML КП (`/b2b-quotes/[id]/kp/page.tsx`)
- Структура `b2b_orders`, миграции

---

### Glass Prices Sheet Variants RLS Fix — ЗАКРЫТО (15 июня 2026)

**Коммит:** `e40dd3e`

**Файлы:**
- `app/admin/glass-prices/page.tsx`
- `app/api/admin/b2b-material-sheet-variants/route.ts` (создан)
- `app/api/admin/b2b-material-sheet-variants/[id]/route.ts` (создан)

**Production issue:**
В `/admin/glass-prices` при добавлении формата листа появлялась ошибка:
`new row violates row-level security policy for table "b2b_material_sheet_variants"`

**Причина:**
`app/admin/glass-prices/page.tsx` — client component. Write-операции (`INSERT`, `UPDATE`) в `b2b_material_sheet_variants` шли через browser Supabase client и блокировались RLS.

**Решение:**
Добавлены admin API routes с проверкой роли `admin` / `ceo` и записью через service role key:
- `GET /api/admin/b2b-material-sheet-variants` — список вариантов по material_id
- `POST /api/admin/b2b-material-sheet-variants` — добавить формат
- `PATCH /api/admin/b2b-material-sheet-variants/[id]` — сделать основным / скрыть / показать
- `DELETE /api/admin/b2b-material-sheet-variants/[id]` — soft delete (active=false, не физический DELETE)

**Операции через API:**
- Добавить формат → `POST`
- Сделать основным → `PATCH { is_default: true }` (сначала сбрасывает default у других active)
- Скрыть → `PATCH { active: false }` (сбрасывает is_default если был)
- Показать → `PATCH { active: true }`

**Что не трогалось:**
- `/b2b-orders`, `/b2b-quotes`, `/admin/procurement`
- закупки, платежи, material requirement, Production Sheet
- Структура таблицы `b2b_material_sheet_variants`
- Миграции

**Production test-plan:**
1. `/admin/glass-prices` → вкладка "Себестоимость Стекло" → "Листы"
2. Добавить формат 3300×2000, поставщик "ООО КСЗ", имя "Mopy Crystal Clear"
3. RLS error не появляется, строка видна в списке
4. "Сделать основным" → звёздочка переместилась
5. "скрыть" → opacity-50, строка осталась в БД (не удалена)
6. "показать" → вернулась в активные

---

### Payment Status Badge в /b2b-orders — ЗАКРЫТО (15 июня 2026)

**Коммит:** `0ebaf63`

**Файл:** только `app/b2b-orders/page.tsx`

**Что добавлено:**
- `OrderPayStatus = 'paid' | 'partial' | 'unpaid' | 'unknown'`
- `PAY_BADGE` — цвета и лейблы: `Оплачен` (emerald), `Частично` (amber), `Не опл.` (red), unknown = null (не показывать)
- `getOrderPayStatus(order)` — читает `pn.stages.invoice_paid`, `pn.payment_status`, `pn.stages.invoice_sent`
- Бейдж вставлен в три точки рендеринга:
  - `renderPdRow` (Production Day mode) — после `📝 Контроль`
  - `filteredOrders.map` (плоский список) — после `📝 Контроль`
  - Групповой вид (по клиентам) — после `📝 Контроль`
- `payStatus` вычисляется отдельной переменной в каждом map/function
- TypeScript clean: только pre-existing ошибки в `__tests__/calculators/mirror.test.ts`

**Источник данных оплаты:**
- `notes.stages.invoice_paid` — ставится вручную в чекбоксе Production Day
- `notes.payment_status` — переносится из b2b-quotes при подтверждении заказа (`{ ...parsed, status: 'confirmed', ... }`)
- `notes.stages.invoice_sent` → unpaid (счёт выставлен, не оплачен)

---

### B2B Quotes / Orders UX Separation — ЗАКРЫТО (11 июня 2026)

**Коммит:** `f367e3b`

**Файлы:** `app/b2b-quotes/page.tsx`, `app/b2b-orders/page.tsx`

**Решение по процессу:**
- `/b2b-quotes` — коммерческий этап: расчёт, КП, PDF, ТГ, запуск в работу, отказ, approval
- `/b2b-orders` — производственный этап: заказ, сроки, производство, оплата, материал, контроль, отгрузка

**`/b2b-quotes` — что убрано из строки:**
- Плашка `Черновик` — лишний визуальный шум
- Плашка `В работе` — лишний визуальный шум
- Плашка `Не оплачен` / `Оплачен` / `Частично` — оплата живёт в заказе, не в просчёте
- Плашка `Согласовано` — лишний визуальный шум

**`/b2b-quotes` — что осталось:**
- Плашка `На согласовании` — требует action admin/CEO (кнопка «Согласовать ✓»)
- Все функциональные кнопки: `В работу`, `Отказ`, `PDF`, `ТГ`, `КП`, дубль, удалить
- Оплата не удалена — остаётся в раскрытой карточке (секция «Оплата» → «изменить»)

**`/b2b-orders` — что улучшено:**
- Номер заказа первый и визуально сильнее: `text-[13px] font-bold`
- Fallback `#id` серым когда `custom_number = null`
- Заказчик `text-[13px]` сразу после номера
- Вторая строка: `дата · N поз. · X м²`
- Deadline badges, 📝 Контроль, ⚠️ Нет контроля, 📅 завтра, Production Day, bulk cleanup — не затронуты

**Важные правила процесса:**
- Расчёт, ушедший «В работу», живёт в `/b2b-orders` — не смешивать визуально с просчётами
- Оплата контролируется на уровне заказа (`/b2b-orders`), а не в строке просчёта

---

### Monthly Bulk Shipped Cleanup — ЗАКРЫТО (10 июня 2026)

**Коммит:** `3fcc00d`

**Файл:** только `app/b2b-orders/page.tsx`

**Что реализовано:**
- `BulkAction` тип + `NotesData.bulk_actions?: BulkAction[]`
- `getOrderMonthKey(order)` — group key: `launched_at` → `created_at`
- `formatMonthKey(key)` — `"2026-05"` → `"Май 2026"`
- `bulkActionLoading: string | null` — state по monthKey
- `bulkMarkMonthAsShipped(monthKey, orders)` — последовательный update с audit log
- Секция 🔥 Просрочено в Production Day: месячные подгруппы + кнопка «Отметить месяц отгруженным»
- Safety guard: `if (getDeadlineStatus(order).status !== 'overdue') continue`
- `packaged` не перезаписывается если уже был
- `detail_stages`, `deadline_control` не трогаются (spread)
- `bulk_actions[]` накапливается в notes, отображается в карточке заказа
- `JSON.stringify(nextNotes)` сохранён намеренно — `b2b_orders.notes` является TEXT-колонкой
- Заметки safety-fix отклонены: замена `.update({ notes: nextNotes })` сломала бы TEXT-поле

---

### B2B Production Day v2 — ЗАКРЫТО (10 июня 2026)

**Коммит:** `2ee4d7e`

**Файл:** только `app/b2b-orders/page.tsx`

**Что реализовано:**
- `requiresDeadlineControl(order)` — overdue/today/tomorrow без заполненного deadline_control
- `hasDeadlineControl(order)` — проверка наличия reason/next_action
- `tomorrowDateStr()` — утилита для дата+1
- `quickPatchDc(orderId, patch)` — прямое сохранение частичного DeadlineControl в Supabase без формы
- Фильтр «⚠️ Требуют контроля» в шапке Production Day Mode
- Счётчик «Требуют контроля: N» в сводке, красный/зелёный
- «⚠️ Нет контроля» badge в строке заказа
- «📅 завтра» — кнопка одним кликом ставит next_check_date на завтра без раскрытия карточки
- Empty state «Все срочные заказы уже взяты в контроль» при включённом фильтре и count=0

---

### B2B Production Day / Deadline Control — ЗАКРЫТО (10 июня 2026)

**Коммиты:**

| Коммит | Описание |
|---|---|
| `111ad58` | feat(b2b-orders): add deadline risk badges |
| `b15de57` | feat(b2b-orders): add deadline control notes |
| `8dde4d2` | feat(b2b-orders): add production day view |

**Файл:** только `app/b2b-orders/page.tsx`

**Что реализовано:**

- Deadline risk badges в каждой строке заказа: Просрочен / Срок сегодня / Срок завтра / Готов / Отгружен
- Плановая дата готовности рассчитывается:
  - `launched_at + production_days` — если оба поля заполнены (авторитетный дедлайн)
  - `launched_at + 7 дней` — если нет `production_days`
  - `created_at + 10 дней` — если нет `launched_at`
- Статусы `DeadlineStatus`: `overdue | today | tomorrow | normal | ready | shipped | unknown`
- Фильтр по срокам (отдельная строка под stage-фильтром): Все / Просрочены / Сегодня / Завтра / В сроке / Готовы / Отгружены / Без срока
- Сортировка по риску в flat-view: overdue → today → tomorrow → normal → ready → shipped
- `notes.deadline_control` — поле в `b2b_orders.notes` (без миграции):
  - `reason` — причина риска (select: Материал / Закалка / Фацет / Производство / Упаковка / Ожидание клиента / Логистика / Другое)
  - `next_action` — следующее действие
  - `responsible` — ответственный
  - `next_check_date` — дата следующего контроля
  - `updated_at` — ISO timestamp сохранения
- `deadline_control` сохраняется через `{ ...order.parsedNotes, deadline_control: merged }` — `notes.stages`, `notes.detail_stages`, `material_status` не перезаписываются
- Блок «Контроль срока» в раскрытой карточке заказа: форма с полями, кнопка «Сохранить контроль», amber-фон для overdue/today/tomorrow
- Индикатор `📝 Контроль` в строке заказа если `deadline_control.reason` или `next_action` заполнены
- Режим `🏭 Производственный день` — кнопка-переключатель в шапке:
  - Сводка: Просрочено / Сегодня / Завтра / Готово
  - 4 секции: 🔥 Просрочено, 🟠 Срок сегодня, 🟡 Срок завтра, ✅ Готово / упаковано
  - Внутри строки: deadline badge + 📝 Контроль + `→ next_action / responsible / 📅 next_check_date`
  - Заказы раскрываются с полной карточкой включая «Контроль срока»
  - Режим строится на `orders` с фильтром только по search — без stageFilter/deadlineFilter
- Без новых таблиц и миграций
- Не трогались: `/admin/procurement`, закупки, платежи, material requirement, Production Sheet, `/p/o/{id}`, `notes.detail_stages`, `notes.stages`

**Следующий рекомендуемый шаг:**
Production Day v2: добавить быстрые действия из режима «Производственный день» — открыть контроль срока прямо из строки, поставить `next_check_date` в один клик, отфильтровать заказы без назначенного контроля.

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

**Рекомендуемое следующее направление:**

**A. B2B glass/cutting support (Phase 2)**
- Подключить `lib/b2bCalculator.ts` к `b2bQuickQuoteTool` для `product_type: 'glass' | 'cutting'`
- Убрать `UNSUPPORTED_PRODUCT_TYPE_PHASE_1`

**C. Telegram auto-send Phase 2**
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_WORK_CHAT_ID` в ENV
- Server-side route `POST /api/b2b-quotes/[id]/send-telegram`

**D. Server-side PDF для B2C proposals**
- `app/api/ai/proposals/[id]/pdf/route.ts` через `@react-pdf/renderer`
- `@react-pdf/renderer` v4.5.1 уже установлен

## Контекст

- Весь код закоммичен, ветка `main`, HEAD = `8dde4d2`
- `/admin/procurement` работает на production — стабилизирован
- `purchase_orders.items` JSONB структура: `{ material_name, category, thickness, sheet_width, sheet_height, area_m2, required_area_m2, sheets_count, weight_kg, estimated_cost, waste_percent, order_ids, order_refs, unmatched }`
- `getMatrixPrice` и `getWastePct` — pure functions из `lib/glassMatrix.ts`, server-side
- `app/admin/layout.tsx` разрешает роли: `admin`, `buyer`, `ceo`, `cfo`
- `b2bQuickQuoteTool` читает `partner_types` (SELECT only) + вызывает `quickCalcTool`

## Открытые вопросы

- `ai/skills/`, `ai/workflows/`, `ai/memory/` — директории не созданы, запланированы для будущих этапов
- Нет Anthropic binding — генерация детерминированная (`allowModelCall: false`)
- Нет CRM-read integration — клиент заполняется вручную
