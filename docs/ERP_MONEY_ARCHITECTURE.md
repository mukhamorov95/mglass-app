# Архитектура «Деньги как учёт» — M-Glass ERP

> Рабочий документ стройки. Место: `docs/ERP_MONEY_ARCHITECTURE.md`.
> Сведение двух проектов: «Денежное ядро (`payments`)» и «Ведомость продаж наполняется сама (`crm_sales`)». Все пути — от корня `mglass-app/`.
> Основа: карта денег в коде, карта пути продажи, отчёт по импорту (сверены с кодом, якоря файл:строка проверены).

---

## 1. Цель и три принципа

**Цель.** Сегодня деньги в системе существуют как ручные булевы отметки в трёх несвязанных местах (JSON `b2b_orders.notes`, колонки `orders`, галочки `crm_sales`), а поступление «сумма + дата + документ» не существует нигде. Строим учётное ядро, при котором любой дашборд — производная от учёта, а не параллельная реальность.

1. **Один факт = одна запись.** Платёж живёт одной строкой в `payments`, продажа — одной строкой в `crm_sales`. Всё остальное (бейджи, галочки, notes) — UI-слой, зеркалируемый в ядро идемпотентно.
2. **Вносить там, где работаешь.** Менеджер не ходит в «отдельную ведомость»: строку продажи рождает сам факт оплаты, отмеченный в его обычном экране. Менеджер только дозаполняет.
3. **Деньги = учёт, дашборды = следствие.** `/cfo`, агенты, MoneyPulse, morning-briefing читают SQL по `payments`/`crm_sales`, а не 6 разошедшихся копий inline-логики по notes.

Жёсткие рамки (не обсуждаются): финансовая детализация — только `/cfo`; маржа-цвета red < 25% / amber 25–35% / green ≥ 35%; цены — только детерминированный код; AmoCRM read-only; `vlad_payments` вне контура.

---

## 2. Целевая схема

```
calculations ─┐                       ┌─ crm_sale_finance (cost, RLS: owner-only)
orders ───────┼──► crm_sales ◄────────┤
b2b_orders ───┘    (продажа, 1 строка)└─ v_crm_sales_margin (маржа, SQL)
     │                  │
     └──────────────────┴──► payments (платёж: сумма + дата + документ)
                              ▲ пишут ТОЛЬКО серверные роуты (service-role)

purchase_order_payments (расход, поставщики) ─┐
planned_payments (план ДДС) ──────────────────┼─► v_cashflow (позже, /cfo/cashflow)
payments (приход) ────────────────────────────┘
```

### 2.1 `payments` — денежное ядро

```sql
create table public.payments (
  id            bigint generated always as identity primary key,
  -- типизированные FK вместо (entity_type, entity_id); минимум одна ссылка
  b2b_order_id  bigint references b2b_orders(id) on delete restrict,
  order_id      uuid   references orders(id)     on delete restrict,
  crm_sale_id   bigint references crm_sales(id)  on delete restrict,
  constraint payments_has_document
    check (num_nonnulls(b2b_order_id, order_id, crm_sale_id) >= 1),

  amount        numeric(14,2) not null check (amount > 0),
  paid_at       date not null,                    -- дата факта денег
  kind          text not null check (kind in
                  ('prepayment','remainder','full','refund','adjustment')),
  method        text not null default 'Счёт' check (method in
                  ('Счёт','Наличные','Карта','Перевод','Другое')),

  entered_by      uuid references users(id) on delete set null,
  entered_by_name text,
  source        text not null,   -- 'b2b_payment_api' | 'orders_payment_api'
                                 -- | 'production_stages_api' | 'sales_api'
                                 -- | 'payments_reconcile_cron' | 'cfo_manual'
                                 -- | 'gsheet_import' | 'cashflow_plan_done'
  external_key  text not null unique,             -- идемпотентность (см. 2.4)
  import_batch  text,

  voided_at     timestamptz,                      -- «оплату сняли»: не delete
  voided_by     uuid references users(id) on delete set null,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_payments_paid_at on payments (paid_at desc) where voided_at is null;
create index idx_payments_b2b   on payments (b2b_order_id) where b2b_order_id is not null;
create index idx_payments_order on payments (order_id)     where order_id is not null;
create index idx_payments_sale  on payments (crm_sale_id)  where crm_sale_id is not null;
```

Типы ключей проверены: `orders.id = uuid`, `b2b_orders.id = bigint`, `crm_sales.id = bigserial`.

### 2.2 `crm_sales` — дополнение (связи + процесс, БЕЗ финансовой детали)

```sql
alter table crm_sales
  add column if not exists order_id       uuid   unique references orders(id),
  add column if not exists b2b_order_id   bigint unique references b2b_orders(id),
  add column if not exists calculation_id bigint references calculations(id),
  add column if not exists paid_remainder_at date,   -- у boolean не было даты
  add column if not exists product_type   text,
  add column if not exists source         text,
  add column if not exists needs_review   boolean not null default false, -- «автосоздано, дозаполни»
  add column if not exists voided         boolean not null default false, -- откат оплаты ≠ delete
  add column if not exists external_key   text unique,                    -- идемпотентность импорта
  add column if not exists import_batch   text;
```

### 2.3 `crm_sale_finance` + маржа в SQL

Себестоимость — в **дочерней таблице** (RLS построчная, не поколоночная: колонка `cost` на `crm_sales` читалась бы менеджером anon-клиентом через существующую политику `crm_sales_select`).

```sql
create table crm_sale_finance (
  sale_id        bigint primary key references crm_sales(id) on delete cascade,
  cost           numeric(14,2) not null default 0,
  cost_source    text not null default 'manual' check (cost_source in
                   ('calculation','order','b2b_order','import','manual')),
  cost_overridden boolean not null default false,  -- ручное значение авто-апдейт не перетирает
  updated_at     timestamptz not null default now()
);

create view v_crm_sales_margin with (security_invoker = true) as
select s.*, f.cost, f.cost_source,
  round((s.amount - s.partner_fee - f.cost) / nullif(s.amount, 0) * 100, 1) as margin_percent
from crm_sales s join crm_sale_finance f on f.sale_id = s.id;
```

Маржу считает **только этот view** (не API, не руки, не AI). `security_invoker` наследует RLS обеих таблиц: `/cfo` видит всё, менеджер через view — ничего. Предзаполнение `cost` кодом из источника: `orders.total_cost_price` / `b2b_orders.total_cost_net(+vat)` / `calculations.cost_breakdown.totalCost`.

### 2.4 Идемпотентность `external_key`

Notes хранят не платежи, а накопленное состояние → зеркало — **реконсилиатор**: выводит каноническое состояние документа и upsert-ит максимум две строки на документ. Ключ канонизируется на бизнес-документе, а не на точке ввода (три UI → одна строка):

| Что | external_key | Поведение |
|---|---|---|
| Предоплата B2B | `b2b:{id}:prepayment` | upsert (amount, paid_at, source) |
| Остаток/полная B2B | `b2b:{id}:settlement` | upsert; снятие галочки → `voided_at=now()`, повторная → null |
| Розница из orders | `order:{id}:prepayment` / `:settlement` | так же |
| Галочки crm_sales | при заполненном `order_id`/`b2b_order_id` — **ключ заказа** (дубля нет); иначе `sale:{id}:prepayment` / `:remainder` | upsert |
| Импорт Google | `gsheet:{order_no}` (fallback `sha1(date\|client\|amount)`) | `do nothing` |
| Ручной ввод CFO (Д3) | `manual:{uuid}` | настоящий append-only, много строк на документ |
| План → факт | `plan:{planned_payment_id}` | upsert |

Повторный прогон зеркала/крона/импорта не плодит ничего.

### 2.5 RLS

```sql
alter table payments enable row level security;
-- SELECT: admin/ceo/cfo — всё; manager — платежи своих документов (через crm_caller());
-- production/seo — ничего.
-- INSERT/UPDATE-политик НЕТ: пишет только service-role из API-роутов (закрывает разрыв №10 —
-- сегодня факт оплаты B2B пишется браузером с любой ролью).
-- DELETE-политики нет: платежи не удаляются — voided_at или kind='refund'.
-- crm_sale_finance: for all — только admin/ceo/cfo.
```

### 2.6 Судьба существующих payment-таблиц

- **`payment_tracking`** — таблицы не существует (имя файла миграции с ALTER `orders`). Колонки `orders.payment_status/…` — legacy write-through до Д4, потом производная от `payments`. Дубль-миграцию `20250509_all_pending.sql` не трогать, только пометить комментарием.
- **`purchase_order_payments`** — **остаётся**: расходный контур (поставщики), грануляция уже верная. В `payments` не сливать. Две правки: убрать параллельную запись legacy `purchase_orders.payment_amount` (`app/admin/procurement/page.tsx:578-579`) и, после сверки, fallback-чтение (:615, :798).
- **`planned_payments`** — **остаётся**: план, не факт. В Д3 `status='done'` + `kind='in'` → факт в `payments` (`plan:{id}`).
- **`vlad_payments`** — вне контура, не упоминается и не трогается.

---

## 3. Процессный слой: единые точки записи

**Принцип: факт оплаты — единственное событие, рождающее строку `crm_sales`.** Все точки — серверные, service-role, через два модуля: `lib/payments/recordPayment.ts` (единственный писатель `payments`) и `lib/salesLedger.ts` (`upsertSaleFromB2B` / `upsertSaleFromRetail` / `voidSale`; Telegram-хелпер переезжает сюда из POST `/api/sales`).

| Точка | Что делает |
|---|---|
| **`app/api/b2b-orders/[id]/payment/route.ts` (новый, PATCH)**, роли admin/ceo/manager/buyer/cfo | Серверный read-merge-write `notes` (лечит гонки «случай #4960»); пишет **оба механизма синхронно** (`payment_status`+`paid_at` и `stages.invoice_paid`), на откате сбрасывает оба; затем `recordPayment` + `upsertSaleFromB2B`/`voidSale`. Три UI (`b2b-quotes` savePayStatus :312, `b2b-orders` toggleStage :944 — только ветка invoice_paid, `cfo/receivables` markPaid/setPrepay :123-136) переключаются на него; кнопки не меняются |
| `app/api/orders/[id]/payment/route.ts` (существующий) | после update при `partial\|paid` → `recordPayment` + `upsertSaleFromRetail`. Предзаполнение целиком из `orders` |
| `app/api/orders/[id]/production-stages/route.ts` | +`requireRole(['admin','ceo','manager','buyer'])` — production исключён (сегодня оплату ставит любой аутентифицированный); при `invoice_paid` → `recordPayment` (ключ `order:{id}:settlement`), **crm_sales НЕ трогает** |
| `app/api/sales/route.ts` PATCH :120-126 | галочки `prepayment_paid`/`remainder_paid` → `recordPayment` (ключ канонизируется на заказ при заполненной связи); GET вырезает `cost` на сервере по роли |
| Кнопка «Продано» `app/crm/[id]/page.tsx:205-215` | остаётся как есть — минимальный путь для сделки AmoCRM без внутреннего заказа |
| `app/api/cron/payments-reconcile/route.ts` (новый, ночной, свой секрет, `vercel.json`) | реконсилиация всех `b2b_orders`/`orders` → `payments`+`crm_sales`. **Первый запуск = бэкфилл истории из notes**; далее страховка от пропусков |

Предзаполнение строки B2B: `client`←`client_name`, `amount`←`total_after_discount ?? total_sale_inc_vat`, `order_no`←`custom_number`, `manager`←`launched_by`/актор, `sale_date`←`paid_at`, `cost`←`total_cost_net` (`cost_source='b2b_order'`), `needs_review=true`. Менеджер дозаполняет только: способ оплаты, партнёрские, дату готовности. Оплата на просчёте, не ставшем заказом, строку всё равно создаёт (деньги пришли — факт есть); вкладка «Требуют переноса» остаётся контролем.

Notes при этом **никто не перестаёт писать** — все старые читатели (бейджи, агенты, morning-briefing) работают без правок до Д4.

---

## 4. Разрешение противоречий двух проектов

| # | Расхождение | Решение | Почему |
|---|---|---|---|
| 1 | `cost` колонкой в `crm_sales` (процесс) vs дочерняя `crm_sale_finance` (данные) | **Дочерняя таблица** | RLS в Postgres построчная: колонку менеджер прочитал бы anon-клиентом через `crm_sales_select`. `cost_overridden` переезжает в `crm_sale_finance` |
| 2 | Словарь `cost_source`: `auto_b2b/auto_order/manual/import` vs `calculation/order/b2b_order/import/manual` | **Второй** (по имени таблицы-источника) + флаг `cost_overridden` | Один словарь на систему; «auto» выражается источником, ручное — флагом |
| 3 | Путь записи B2B: browser-notes + best-effort mirror (данные) vs единый серверный роут (процесс) | **Серверный роут `/api/b2b-orders/[id]/payment` — первичный писатель.** Отдельный `/api/payments/mirror` не создаётся: его логика — внутри роута и cron-реконсилиатора; браузерные best-effort вызовы не нужны | Роут разом лечит гонки notes, рассинхрон двух механизмов при откате и права (браузерная запись оплаты исчезает). Cron остаётся страховкой и бэкфиллом |
| 4 | `production-stages` `invoice_paid`: пишет `payments` (данные) vs «леджер не триггерит» (процесс) | **Оба, на своих уровнях:** пишет `payments` (закрывает разрыв №4, ключ идемпотентен), **не создаёт** строк `crm_sales` | Деньги учитываются откуда угодно, но цех не рождает продажи |
| 5 | Маржа: SQL view (данные) vs расчёт на чтении в API (процесс) | **View `v_crm_sales_margin`**, API читает view | Один расчёт в одном месте, `security_invoker` даёт RLS бесплатно |
| 6 | Две миграции (`payments_core` + `crm_sales_v2`) | **Одна**: `supabase/migrations/20260721_money_core.sql` | Схема Д1 атомарна, таблицы пустые, ломать нечего |
| 7 | `unique` на `crm_sales.order_id`/`b2b_order_id`: процесс — да, данные молчат | **Да, unique** | Одна продажа = один документ; множественность платежей живёт в `payments`, не в леджере |

---

## 5. Этапы внедрения

### Д1 — Схема и модули записи (ноль правок UI)

**Файлы:** `supabase/migrations/20260721_money_core.sql` (payments + ALTER crm_sales + crm_sale_finance + view + RLS + индексы) · `lib/payments/recordPayment.ts` · `lib/salesLedger.ts`.
**Готово, когда:** миграция применена; `npm run build` и `npm run lint` зелёные; таблицы пустые; ни один экран не изменился; тесты на `external_key`-идемпотентность `recordPayment` (двойной вызов = одна строка) проходят.

### Д2 — Единые писатели + бэкфилл

**Файлы:** новый `app/api/b2b-orders/[id]/payment/route.ts` · переключение трёх UI: `app/b2b-quotes/page.tsx` (:312), `app/b2b-orders/page.tsx` (:944, только invoice_paid), `app/cfo/receivables/page.tsx` (:123-136) · `app/api/orders/[id]/payment/route.ts` (+хуки) · `app/api/orders/[id]/production-stages/route.ts` (+роли, +recordPayment) · `app/api/sales/route.ts` (галочки→recordPayment, cost по ролям) · `app/api/cron/payments-reconcile/route.ts` + `vercel.json`.
**Готово, когда:** любая отметка оплаты в любом из экранов создаёт строку `payments` и строку `crm_sales` (`needs_review=true`); снятие отметки сбрасывает оба notes-механизма и ставит void в обоих ядрах; первый прогон cron = бэкфилл всей истории notes; `select source, count(*), sum(amount) from payments where voided_at is null group by 1` сходится с дебиторкой `/cfo/receivables`; в браузерном коде не осталось ни одного прямого insert/update оплаты; повторный прогон cron не меняет счётчики.

### Д3 — История, CFO-витрины, ручной ввод

**Файлы:** `scripts/import-crm-sales.mjs` (dry-run по умолчанию, `external_key`, rejects.csv, `import_batch='gsheet-2026-07'`) · `lib/payments/receivables.ts` — единая функция дебиторки, переключить 6 копий (receivables, cashflow, MoneyPulse, morning-briefing, agent-ceo, agent-analyst — копии уже разошлись: `receivables:94` vs `agent-ceo:148`) · `app/cfo/sales-ledger/page.tsx` (маржа + светофор red/amber/green, фильтр «ручная себестоимость») · `app/cfo/sales-check/page.tsx` (временный: «месяц | лист | БД | дельта») · `app/api/cron/sales-ledger-check/route.ts` (сироты: paid-документы без строки леджера; `needs_review` старше 24 ч → Telegram/morning-briefing) · ручной ввод платежа в CFO (`manual:{uuid}`) с **обратным зеркалом** в notes/колонки (симметрия sync-stages).
**Готово, когда:** импорт сверен по 22 месяцам с контрольными суммами листа (2024 — 231 / 36 887 686 ₽; 2025 — 492 / 71 533 084 ₽; 2026 янв–апр — 111 / 14 492 167 ₽; итого ~834 строки; count — точно, сумма ±1%), месяцы с дельтой разобраны с владельцем **до** включения витрин; «оплачено сегодня» у агентов — SQL по `payments.paid_at`, розница впервые видна финконтуру; 6 inline-копий дебиторки удалены.

### Д4 — Параллель и переключение старых экранов

**Состав:** 4 недели параллели — менеджеры работают **только в системе**, построчная Google-таблица заморожена, РОП ведёт в ней только дневные счётчики (кол-во/сумма); ежедневный Telegram-пинг менеджеру списком его `needs_review`-строк. Старые экраны переводятся на статус, производный от `payments`: `app/b2b-orders/page.tsx`, `app/b2b-quotes/page.tsx` (бейджи), `app/orders/OrdersClient.tsx:58`, `app/admin/dashboard/page.tsx:118` (разрыв №4 закрывается автоматически); notes-поля остаются write-through legacy.
**Готово, когда:** 2 недели подряд дельта счётчиков «лист vs БД» = 0; Google-таблица → read-only со ссылкой на `/sales` (целевая дата — **01.09.2026**, после июльского B2B-перехода); cron-сверка сирот остаётся как постоянный контроль; ничего не дропнуто.

---

## 6. Открытые вопросы владельцу

1. **Кому видна маржа продажи.** A — только `/cfo` (рекомендуем на старт, по правилу «финдетализация только /cfo»); B — A + роль `commercial` (прецедент: `/api/commercial/money` уже отдаёт маржу); C — позже менеджеру светофор его сделки без цифр (мотивация без раскрытия себестоимости). Что выбираем на старт и планируем ли C?
2. **Экспорт построчных листов «Продажи МГласс» и «Маржа»** (колонки: дата, № заказа, клиент, сумма, предоплата, остаток+дата, менеджер, способ оплаты, партнёрские, себестоимость итого, тип изделия). Кто выгружает и к какой дате? Без этого Д3-импорт — только агрегатные контрольные суммы.
3. **Заморозка построчной Google-таблицы на параллель:** подтвердить регламент — менеджеры пишут только в систему, РОП ведёт в таблице только дневные счётчики. Кто именно РОП-ответственный?
4. **Дозаполнение `needs_review`** (способ оплаты, партнёрские, дата готовности): подтверждаете SLA 24 ч + ежедневный Telegram-пинг менеджеру? Кто контролирует просрочку?
5. **Дата закрытия таблицы 01.09.2026** — подтвердить (4 недели параллели + запас после июльского B2B-перехода).
6. **Розница из AmoCRM-воронки без внутреннего заказа:** кнопка «Продано» в `/crm/[id]` становится обязательным шагом менеджера при получении денег. Это регламент людям, не код — нужно ваше распоряжение.
7. **Месяцы с дельтой при сверке импорта** (если будут) — разбор построчно с вами до включения витрин; закладываем на это один созвон.

---

## 7. Что сознательно НЕ делаем сейчас

- **Не дропаем и не перестаём писать** notes JSON и legacy-колонки (`orders.payment_status`, `purchase_orders.payment_amount` до сверки) — write-through до конца Д4; физический дроп — отдельное решение после.
- **Не сливаем** `purchase_order_payments` (расход) и `planned_payments` (план) в `payments` — другие контуры; единый кассовый взгляд `v_cashflow` (in ∪ out ∪ план) — после Д3, отдельной задачей для `/cfo/cashflow`.
- **Не трогаем** `vlad_payments` и AmoCRM (read-only, никакого авто-синка оплат из CRM — факт оплаты B2C-воронки фиксируется кнопкой «Продано», не интеграцией).
- **Не импортируем** из `fetched_sheet.csv` разбивку по менеджерам (недостоверна с осени 2025) и рекламный бюджет (сломаны единицы) — лист используется только как эталон контрольных сумм.
- **Не показываем** маржу менеджерам (вариант C — после стабилизации и только решением владельца).
- **Не выносим** оплату B2B из notes в колонки `b2b_orders` — отдельный рефакторинг после Д4, текущую стройку не блокирует.
- **Не строим** новых финансовых блоков вне `/cfo` и не меняем воронку/зоны (`salesMonitor.ts` не трогается).
- **Не восстанавливаем** пооперационную историю из дневных агрегатов листа — «размазывание» агрегата создаст фиктивные сделки и отравит средний чек и маржу.

---

**Порядок стройки:** Д1 (миграция + модули) → Д2 (B2B-роут → три UI → розница → production-роли → sales-галочки → cron-бэкфилл) → Д3 (импорт → единая дебиторка → CFO-витрины → ручной ввод) → Д4 (параллель → переключение бейджей → закрытие таблицы). Каждый этап независимо откатываем: ядро наполняется зеркалом, старые экраны живут на notes до последнего шага.