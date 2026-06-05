# Production Detail Tracker + QR Order Flow — Architecture Plan

> M-Glass B2B Production Block MVP  
> Статус: архитектурный план, не реализован  
> Версия: 1.0 · 2026-06-05

---

## 1. Цель

Оцифровать производственный контроль B2B-заказов M-Glass, не ломая текущий бумажный workflow.

Сейчас после запуска заказа в работу производство ведётся вручную: PDF-чертежи распечатываются, рабочие карандашом ставят отметки УП, Г, З, галочки и комментарии по деталям. Состояние заказа не видно в системе — только по звонку или при физическом визите на производство.

**MVP-цель:** дать офис-менеджеру и производству один экран, где видно состояние каждого заказа и можно отмечать этапы кликом. Без автоматики, без принудительного переключения с бумаги.

**Принцип внедрения:** не строить ERP сразу. Каждый шаг — маленькое улучшение, которое сразу ощущается на практике.

---

## 2. Почему QR на заказ, а не на деталь

### Решение первого MVP: QR кодирует заказ целиком

При сканировании QR-кода рабочий попадает на страницу заказа со списком всех деталей.

**Причины этого решения:**

| Критерий | QR на заказ (MVP) | QR на деталь (будущее) |
|---|---|---|
| Сложность внедрения | Минимальная | Высокая |
| Нужен UUID детали | Нет | Да — требует миграции |
| Зависимость от itemIndex | Нет | Есть (нестабильно без UUID) |
| Совместимость с JSONB items | Полная | Частичная |
| Привычность для рабочих | Близка к бумажному листу | Новая парадигма |
| Групповые отметки | Удобно | Неудобно |
| Количество QR-кодов | 1 на заказ | N на заказ (по числу деталей) |

**Почему работает без UUID детали:**  
URL вида `/p/o/{orderId}` не зависит от порядка позиций. Страница загружает `b2b_orders.items` целиком и показывает все детали. Этап каждой детали хранится по `itemIndex` — это достаточно для MVP, потому что `items` пересохраняются только при редактировании КП, а не при отметке этапов.

**Когда переходить на QR на деталь:**  
Если рабочие будут жаловаться, что неудобно искать нужную деталь внутри длинного заказа (например, 40+ позиций), или если понадобится трекинг по отдельной детали на разных участках одновременно — тогда переходим на `b2b_order_details` с UUID. Это Commit 9+.

---

## 3. Текущий B2B Order Flow

```
/b2b-quotes
    ↓ кнопка "В работу" → confirmWorkDate()
    ↓ UPDATE b2b_orders SET notes = { status: 'sent', work_started_at: date }
    ↓
/b2b-orders  ← основная рабочая страница
    ↓ фильтр: NOT status='quote' AND archived_at IS NULL
    ↓ 11 этапов заказа в notes.stages (invoice_sent → shipped)
    ↓
/b2b-orders/{id}/production-sheet  ← новая страница (Commit 2)
    ↓ QR-код заказа + таблица деталей + поля для ручных отметок
    ↓
/p/o/{orderId}  ← новая мобильная страница (Commit 3)
    ↓ открывается при сканировании QR
    ↓ список деталей + кнопки отметки этапов
```

**Страница `/b2b-production` — устаревшая.**  
Имеет старую 5-статусную модель (`pending / cutting / tempering / ready / shipped`), которая хранится в `notes.production_status` — не синхронизирована с `notes.stages`. Для нового MVP не используется.

---

## 4. Решение по страницам

| Страница | Назначение | Статус |
|---|---|---|
| `/b2b-quotes` | Черновики КП, кнопка «В работу» | Существует, не меняем |
| `/b2b-orders` | Список активных заказов, 11 этапов | Существует, расширяем в Commit 5 |
| `/b2b-production` | Старая страница | Не использовать для MVP |
| `/b2b-orders/[id]/production-sheet` | Производственный лист + QR | Новая страница, Commit 2 |
| `/p/o/[orderId]` | Мобильная рабочая страница (при сканировании QR) | Новая страница, Commit 3 |

**Обоснование коротких URL для мобильной страницы:**  
`/p/o/{orderId}` — минимальный URL для QR-кода. Чем короче URL, тем меньше QR, тем быстрее сканирование. Альтернатива: `/production/orders/{id}/work` — более читаемый, но длиннее.

---

## 5. Текущая структура данных

### b2b_orders

```typescript
// Колонки таблицы
id:                    number
client_name:           string
custom_number:         string | null    // "0150-0"
client_order_number:   string | null
discount_percent:      number
items:                 OrderItem[]      // JSONB — массив позиций
notes:                 string | null    // JSONB — строка
total_area:            number
total_weight:          number
total_cost_net:        number
total_sale_inc_vat:    number
total_after_discount:  number
archived_at:           string | null
created_at:            string
created_by:            string           // UUID пользователя
```

### b2b_orders.notes (JSONB, строка)

```typescript
type NotesData = {
  status?:           string           // 'quote' | 'sent' | 'confirmed' | 'agreed'
  quote_date?:       string
  launched_at?:      string           // ISO date — дата запуска в производство
  production_days?:  number
  user_notes?:       string
  stages?: {
    invoice_sent?:      string | null  // дата или null
    invoice_paid?:      string | null
    added_to_group?:    string | null
    printed?:           string | null
    material_ordered?:  string | null
    cut?:               string | null
    edge_processed?:    string | null
    drilled?:           string | null
    tempering?:         string | null
    packaged?:          string | null
    shipped?:           string | null
  }
  // Устаревшие поля от /b2b-production (не использовать в новом коде):
  production_status?: string
  deadline_date?:     string
}
```

### b2b_orders.items[i] (элемент JSONB массива)

```typescript
type OrderItem = {
  materialName:    string       // "Стекло М1", "Зеркало Сильвер"
  category:        string       // "стекло" | "зеркало" | ...
  thickness:       number       // мм
  width:           number       // мм
  height:          number       // мм
  quantity:        number
  totalAreaNet:    number       // м²
  totalAreaBilled?: number      // м²
  totalWeight?:    number       // кг
  hasTempering:    boolean
  hasFacet?:       boolean
  facetTypeMm?:    number
  saleIncVat?:     number       // ₽
  services?:       { name: string; cost: number }[]
  comment?:        string
  wastePercent?:   number
}
```

**Важно:** у позиций нет собственного `id`. Идентификация по индексу массива (`itemIndex`). Это достаточно для MVP.

---

## 6. Production Order Work Page MVP

**URL:** `/p/o/[orderId]`  
**Назначение:** открывается после сканирования QR-кода, оптимизирована для мобильного.  
**Auth:** требуется авторизация. Роли: admin, manager, production (будущая роль).

### Содержимое страницы

**Шапка заказа:**
- Номер заказа (`custom_number` или `#id`)
- Имя клиента
- Дата запуска (`launched_at`)
- Текущий прогресс: Резка X/Y · Закалка X/Y · Упаковка X/Y

**Список деталей (одна карточка на позицию):**

```
┌────────────────────────────────────────┐
│ #1  Стекло М1  8 мм                   │
│ 600 × 900 мм · 5 шт                   │
│ [Закалка] [Фацет 10]                  │
│                                        │
│ ○ Резка  ○ Полировка  ○ Сверление     │
│ ○ Закалка  ○ Упаковка  ⚠ Проблема    │
└────────────────────────────────────────┘
```

- Чекбокс для групповых действий
- Признаки: закалка, фацет (с типом), триплекс
- Текущий этап выделен цветом
- Кнопка «Проблема» — открывает поле для комментария

**Групповые кнопки действий (sticky footer):**
- Отметить выбранные: «Резка выполнена»
- Отметить выбранные: «Полировка выполнена»
- Отметить выбранные: «Сверление выполнено»
- Отправить выбранные: «На закалку»
- Отметить выбранные: «Вернулось с закалки»
- Отметить выбранные: «Упаковано»
- «Проблема» (открывает форму с полем причины)

**Фильтры (опционально для длинных заказов):**
- Все детали
- Нуждаются в действии
- Только с проблемой

---

## 7. Production Sheet / QR Sheet MVP

**URL:** `/b2b-orders/[id]/production-sheet`  
**Назначение:** производственный лист для печати на термопринтере или обычном принтере.  
**Открывается:** кнопкой «Печать листа» в развёрнутом заказе на `/b2b-orders`.

### Содержимое листа

```
┌──────────────────────────────────────────────────┐
│  M-GLASS ПРОИЗВОДСТВЕННЫЙ ЛИСТ                  │
│  Заказ: 0150-0          Клиент: МГЛАСС          │
│  Запуск: 05.06.2026     Менеджер: Александра    │
│                                                  │
│  [QR-код заказа, 40×40 мм]                      │
│  Сканируй для отметок на телефоне               │
├────┬──────────────┬────┬────────┬───────┬───────┤
│ #  │ Материал     │ мм │  Ш×В   │  Кол  │ Прим. │
├────┼──────────────┼────┼────────┼───────┼───────┤
│  1 │ Стекло М1    │  8 │600×900 │   5   │  З    │
│  2 │ Зеркало Сильв│  4 │400×600 │   2   │       │
│ .. │ ...          │ .. │ ...    │  ...  │  ...  │
├────┴──────────────┴────┴────────┴───────┴───────┤
│ Итого: N позиций · X.XX м² · Y.Y кг             │
├──────────────────────────────────────────────────┤
│ ЛЕГЕНДА: УП=упаковано  Г=готово  З=закалка      │
│ П=проблема  ✓=выполнено                          │
├──────────────────────────────────────────────────┤
│ Принял: _____________ Подпись: _____________     │
│ Дата выдачи: ___________                         │
└──────────────────────────────────────────────────┘
```

**QR-код:**  
Кодирует URL `/p/o/{orderId}`. Генерируется на клиенте через `qrcode` (npm). Без внешних сервисов.

**Печать:**  
- `window.print()` + CSS `@media print`
- Скрывает навигацию, шапку сайта
- Адаптирован под ширину бумаги (A4 или 80 мм термоленту)
- Без прямой интеграции с драйвером термопринтера — первый вариант работает через «Печать» браузера

**Будущее:**  
Если нужна тихая печать без диалога — `window.print()` можно заменить на интеграцию с термопринтером через локальный сервис или Chrome extension (Commit N+).

---

## 8. Статусы деталей

Минимальный набор для первого MVP:

| Ключ | Отображение | Применимо к |
|---|---|---|
| `cutting` | Резка | Стекло, зеркало |
| `polishing` | Полировка / Кромка | Стекло, зеркало |
| `drilling` | Сверление | Стекло |
| `ready_for_tempering` | Готово к закалке | Стекло с hasTempering |
| `sent_to_tempering` | Отправлено на закалку | Стекло с hasTempering |
| `returned_from_tempering` | Вернулось с закалки | Стекло с hasTempering |
| `external_processing` | Внешняя обработка | По необходимости |
| `triplex` | Триплекс | По необходимости |
| `packaging` | Упаковка | Все |
| `ready` | Готово | Все |
| `problem` | Проблема | Все |

**Фильтрация применимых этапов:**  
На мобильной странице показывать только этапы, релевантные для конкретной детали:
- Без `hasTempering` → не показывать `ready_for_tempering`, `sent_to_tempering`, `returned_from_tempering`
- Зеркало → не показывать `drilling` по умолчанию (если нет сверловки в services)

---

## 9. Где хранить статусы деталей в MVP

### Вариант A — быстрый (без миграции DB)

Хранить прогресс по деталям в `b2b_orders.notes.detail_stages`:

```typescript
notes: {
  ...существующие поля...
  detail_stages?: {
    [itemIndex: number]: {
      [stage: string]: string | null  // ISO datetime или null
    }
  }
  detail_events?: Array<{
    itemIndex: number
    stage: string
    status: 'done' | 'problem'
    updated_by: string
    updated_at: string
    note?: string
  }>
}
```

**Плюсы:**
- Нет миграции — можно начать сегодня
- Один UPDATE для сохранения
- Не нужен отдельный API route для detail stage

**Минусы:**
- notes JSONB растёт с каждым событием
- Сложнее делать аналитику по деталям через SQL
- При конкурентных обновлениях (два рабочих одновременно) нужен optimistic concurrency контроль
- Нет индексов по stage — нельзя быстро выбрать "все заказы где деталь на закалке"

---

### Вариант B — правильный (с миграцией)

Создать отдельную таблицу `b2b_detail_stage_events`:

```sql
CREATE TABLE b2b_detail_stage_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    INT  NOT NULL REFERENCES b2b_orders(id) ON DELETE CASCADE,
  item_index  SMALLINT NOT NULL,
  stage       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'done',  -- 'done' | 'problem' | 'reverted'
  note        TEXT,
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_b2b_detail_events_order ON b2b_detail_stage_events (order_id, item_index);
CREATE INDEX idx_b2b_detail_events_stage ON b2b_detail_stage_events (stage, status);
```

Текущий прогресс детали — последнее событие по каждому `(order_id, item_index, stage)`.

**Плюсы:**
- История всех событий сохраняется
- Можно анализировать время на каждом этапе
- Индексы — быстрые запросы
- Легко перейти на QR по детали в будущем (добавить `detail_uuid`)
- Нет конфликта при конкурентных обновлениях

**Минусы:**
- Нужна миграция
- Сложнее первый commit

---

### Рекомендация

**Начать с Варианта A** для Commit 4 (сохранение событий).

**Обоснование:**
- Позволяет запустить мобильную страницу и протестировать workflow с реальными пользователями до миграции
- Если workflow не приживётся — не создаём лишнюю таблицу
- Миграция на Вариант B делается в Commit 4b после того, как MVP покажет ценность: события из `notes.detail_stages` переносятся в новую таблицу, старые notes очищаются

**Условие перехода на Вариант B:** если за первые 2-3 недели использования накопятся заказы с реальными данными и появится запрос на аналитику ("сколько деталей в среднем ждут закалки") — мигрируем.

---

## 10. История событий

Минимальный набор полей для каждого события:

| Поле | Тип | Описание |
|---|---|---|
| `order_id` | int | ID заказа |
| `item_index` | smallint | Индекс позиции в items[] |
| `stage` | text | Ключ этапа (cutting, polishing, ...) |
| `status` | text | `done` / `problem` / `reverted` |
| `updated_by` | uuid | ID пользователя, сделавшего отметку |
| `updated_at` | timestamptz | Время события |
| `note` | text | Комментарий при проблеме |

**Групповые события:**  
При групповой отметке (несколько деталей разом) создаётся N событий с одинаковым `updated_at` — по одному на каждую отмеченную деталь.

---

## 11. Роли

### MVP (первый этап)

Одна роль управляет всем:

| Роль | Права |
|---|---|
| `admin` | Всё — все заказы, все этапы |
| `manager` | Свои заказы — все этапы |
| `buyer` | Только просмотр (для B2B-квот) |

Нет отдельной роли `production`. Офис-менеджер отмечает всё от имени производства.

### Будущий этап (Commit N+)

| Роль | Видит | Может отмечать |
|---|---|---|
| `production_cutter` | Все заказы | Только `cutting` |
| `production_polisher` | Все заказы | Только `polishing` |
| `production_driller` | Все заказы | Только `drilling` |
| `production_packer` | Все заказы | Только `packaging`, `ready` |
| `production_manager` | Все заказы | Все этапы |
| `admin` | Всё | Всё |

Роли добавляются в `users.role` в Supabase, страница `/admin/users` управляет назначением.

---

## 12. Прогресс заказа в /b2b-orders

Добавить в карточку каждого заказа строку прогресса:

```
Резка 3/7 · Полировка 2/7 · Сверление 0/3 · Закалка 0/4 · Упаковка 0/7
```

**Как считать:**
```typescript
// Для каждого заказа:
const total = order.items.reduce((s, item) => s + (item.quantity ?? 1), 0)

// По detail_stages из notes (Вариант A):
const cuttingDone = countItemsWithStage(order, 'cutting', 'done')
const packagingDone = countItemsWithStage(order, 'packaging', 'done')

// Показывать только релевантные этапы:
// Закалка — только если есть items с hasTempering
// Сверление — только если есть items с drilling в services
```

**Цветовая индикация:**
- `0/N` → серый
- `1..N-1/N` → жёлтый (в процессе)
- `N/N` → зелёный (завершён)
- Есть `problem` → красный значок

---

## 13. Material Requirement MVP

**Назначение:** второй производственный модуль — формирование потребности в материале по выбранным или запущенным заказам.

**Отличие от `/b2b-cutting`:**  
`/b2b-cutting` — оптимизация раскроя (планирование нарезки с визуализацией листов).  
Material Requirement — простой агрегат: что нужно купить и сколько.

**Алгоритм:**
1. Выбрать заказы (checkbox, по умолчанию — все с `material_ordered = false`)
2. Пройти по `items[]` каждого заказа
3. Сгруппировать по `materialName + thickness`
4. Для каждой группы вычислить:
   - суммарный `totalAreaNet` (м²)
   - количество листов: `ceil(totalAreaNet / (sheet_width * sheet_height / 1_000_000) / (1 - waste_percent/100))`
   - вес: `area × density × thickness`
   - стоимость: `листы × cost_price × sheet_area`
5. Показать таблицу: Материал / м² / Листов / Кг / Стоимость

**Данные для расчёта листов берутся из `b2b_materials`** (`sheet_width`, `sheet_height`, `cost_price`, `waste_percent`).

**Потребность считается по выбранным заказам — не на неделю, не на период.**

---

## 14. Purchase Page MVP

**URL:** `/admin/procurement` (или отдельная страница)  
**Для:** Вера (снабжение)  
**Назначение:** статусная доска закупки материала

### Статусы закупки

```
нужно купить → счёт получен → оплачен → отгружен / забрать → принято
```

| Ключ | Русский | Следующий шаг |
|---|---|---|
| `pending` | Нужно купить | Получить счёт |
| `invoice_received` | Счёт получен | Оплатить |
| `paid` | Оплачен | Дождаться отгрузки |
| `shipped` | Отгружен / Забрать | Принять |
| `received` | Принято | — |

### Связь с заказами
Каждая запись закупки связана с заказами, для которых куплен материал. После отметки `received` → можно автоматически поставить `stages.material_ordered = today` в связанных заказах (опционально, с подтверждением).

### Данные
В MVP хранить в отдельной таблице `b2b_purchase_requests`:
```sql
id, material_name, thickness, quantity_sheets, quantity_m2,
cost_estimate, supplier_id, status, note,
order_ids JSONB,  -- массив order_id для связи
created_by, created_at, updated_at
```

---

## 15. Claims / Remakes MVP

**Статус:** будущий этап, не реализуется в первых 8 коммитах.

### Минимальная структура

```sql
CREATE TABLE b2b_claims (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      INT REFERENCES b2b_orders(id),
  item_index    SMALLINT,         -- NULL = на весь заказ
  reason        TEXT NOT NULL,
  responsible   UUID REFERENCES users(id),
  cost_estimate DECIMAL(10,2),
  status        TEXT DEFAULT 'open',  -- open | in_work | resolved | closed
  note          TEXT,
  -- фото — следующий этап (Storage bucket)
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);
```

### Связь с заказом
Рекламация всегда привязана к `order_id`. Привязка к конкретной детали через `item_index` — опциональна.

### Что нужно для реализации
- Таблица `b2b_claims` (миграция)
- UI: кнопка «Создать рекламацию» на `/b2b-orders` в развёрнутом заказе
- Список рекламаций: `/admin/claims`
- Кнопка «Проблема» на мобильной рабочей странице создаёт запись в `b2b_claims`
- Фото — через Supabase Storage (Commit N++)

---

## 16. Roadmap по коммитам

Каждый коммит — самодостаточный шаг, который можно задеплоить отдельно.

```
Commit 1 — docs(production): add production detail tracker plan
  └─ Этот файл: ai/docs/PRODUCTION_DETAIL_TRACKER_PLAN.md
  └─ Цель: зафиксировать архитектуру перед реализацией

Commit 2 — feat(production): add production sheet page with QR code
  └─ app/b2b-orders/[id]/production-sheet/page.tsx
  └─ Производственный лист + QR + печать через window.print()
  └─ Устанавливает: qrcode + @types/qrcode
  └─ Кнопка "Лист" в /b2b-orders в развёрнутом заказе
  └─ Проверка: PDF печатается, QR сканируется

Commit 3 — feat(production): add mobile order work page
  └─ app/p/o/[orderId]/page.tsx
  └─ Мобильная страница для сканирования QR
  └─ Список деталей, кнопки этапов (только UI, без сохранения)
  └─ Auth guard: admin/manager
  └─ Проверка: открывается на телефоне, отображает детали

Commit 4 — feat(production): save detail stage events to notes
  └─ Сохранение этапов: b2b_orders.notes.detail_stages (Вариант A)
  └─ API route: PATCH /api/b2b-orders/[id]/detail-stage
  └─ Optimistic update на мобильной странице
  └─ Проверка: отметка сохраняется, видна после перезагрузки

Commit 5 — feat(production): show detail progress summary in /b2b-orders
  └─ Строка "Резка X/Y · Закалка X/Y · Упаковка X/Y" в карточке заказа
  └─ Только чтение из notes.detail_stages — без нового API
  └─ Проверка: прогресс обновляется после отметки на мобилке

Commit 6 — feat(production): add material requirement page
  └─ app/admin/material-requirement/page.tsx
  └─ Выбрать заказы → посчитать материал → показать таблицу
  └─ Читает из b2b_orders.items + b2b_materials
  └─ Проверка: группировка по материалу, расчёт листов корректный

Commit 7 — feat(production): add purchase status page
  └─ app/admin/procurement/page.tsx (или расширение существующей)
  └─ Миграция: b2b_purchase_requests
  └─ Kanban или таблица: нужно купить → счёт → оплачен → принято
  └─ Проверка: Вера может создать запись и двигать по статусам

Commit 8 — feat(production): add claim/remake flow
  └─ Кнопка "Проблема" на /p/o/[orderId] → создаёт b2b_claims
  └─ Миграция: b2b_claims
  └─ Список: /admin/claims
  └─ Проверка: рекламация создаётся, видна в списке
```

---

## 17. Safety — что никогда не происходит автоматически

Все действия в системе требуют явного клика человека.

| Действие | Правило |
|---|---|
| Смена этапа детали | Только по клику пользователя |
| Отправка в Telegram | Только вручную (кнопка «Копировать») |
| Создание закупки | Только вручную (кнопка «Создать заявку») |
| Списание материала со склада | Не реализовано в MVP, будущий этап |
| Создание рекламации | Только вручную |
| Смена статуса заказа | Только вручную |
| Отправка уведомления клиенту | Запрещено на всех этапах MVP |
| Автосписание со stage при переходе в следующий | Запрещено — обратный откат должен быть возможен |

**Принцип:** каждое действие обратимо. Рабочий должен иметь возможность снять отметку, если поставил ошибочно.

---

## Открытые вопросы

1. **`/p/o/{orderId}` vs `/production/orders/{id}/work`** — финальный URL согласовать с командой. Влияет на длину QR.
2. **Термопринтер 80 мм vs A4** — если используется 80 мм лента, нужна отдельная CSS-медиа страница под ширину.
3. **Вариант A vs B** — если команда сразу хочет историю событий в таблице, можно начать с Варианта B на Commit 4.
4. **Роль `production`** — добавить в `users.role` уже на Commit 3 или дождаться Commit N+?
5. **Конкурентные обновления** — если два рабочих одновременно отмечают разные детали одного заказа (Вариант A), нужен merge JSONB, а не полная замена notes. Решается на уровне API route.
