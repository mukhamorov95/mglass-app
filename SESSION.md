## B2B-производство — контур (автономная достройка)
СДЕЛАНО и задеплоено: ядро (миграция production_tasks, авто-маршрут, генерация при запуске, «Пул на сегодня», ролевая защита /p/o), фикс даты «В работу», объединение в одну кнопку «Запустить в работу». Worker-модуль (коммит 525f8d5): A1 станция рабочего в /admin/users; A2 назначение задач рабочим в «Пуле на сегодня» (AssignWorker); A3 my-queue рабочий; B cutover — /api/production-tasks/[id] пишет и в production_tasks, и в notes.detail_stages.
В работе: C — материалы (раскрой→потребность→заявка поставщику, нужна миграция purchase_orders.status).
Открытое: нет production-пользователей в БД (роли manager 5/admin 1/buyer 1) — владелец заводит рабочих сам через /admin/users; my-queue визуально не проверен (некого залогинить).

## Текущая задача
Production-очереди цеха (план одобрен). Код написан, typecheck/eslint/build ЗЕЛЁНЫЕ. Миграция ПРИМЕНЕНА к проду (через Supabase SQL Editor в браузере, подтверждено service-role скриптом: production_tasks ЕСТЬ 0 строк, users.production_station ЕСТЬ). Осталось: коммит + push (Vercel auto-deploy), затем Фаза 1 — тестовый запуск реального B2B-заказа «в работу» → проверить, что production_tasks наполнилась; regression — 679 заказов 2026 не изменились. Экраны my-queue/today читают новую таблицу (Фаза 2), запись этапов пока через старый /p/o (notes.detail_stages) — cutover позже.

## Готово (производственные очереди) — код написан, миграция применена
- supabase/migrations/20260701_production_tasks.sql — таблица production_tasks + users.production_station (НЕ применена)
- lib/b2bCalculator.ts — hasHoles/shape/hasTriplex в B2BOrderItem; app/calculator/b2b/page.tsx — чекбокс «Сверловка» (add+edit режимы)
- lib/productionStages.ts — getApplicableStages учитывает hasHoles (!== false, обратная совместимость)
- lib/productionRouting.ts (новый) — buildItemRoute/buildProductionTasks/ANDON_REASONS
- app/api/b2b-orders/[id]/launch-production/route.ts (новый) — генерация задач, идемпотентно
- app/b2b-quotes/page.tsx handleConfirm — best-effort вызов launch-production при isLaunched
- app/production-app/my-queue/page.tsx (новый) — личная очередь рабочего, секции Готово/Ожидаю, действия Выполнено/Проблема
- app/production-app/today/page.tsx (новый) — пул цеха по станциям + активные андон-проблемы, для супервайзера
- app/p/o/layout.tsx (новый) — ролевая защита (production/owner), раньше /p/o/[orderId] был открыт без проверки роли

## Прошлая задача (для справки)
Импорт 2026 из Google-таблицы ВЫПОЛНЕН и задеплоен (коммит 1be220f). Следующее после production-очередей — улучшение flow «калькулятор→просчёт→в работу» (3 разрыва Слоя A, см. ниже) к cutover 2026-07-01.

## Импорт 2026 — v3, ФИНАЛ (rebuild из таблицы)
- v1 (баг: regex номера терял июньский формат 00XXX) и v2 (баг: openpyxl bool False читался как True через str()) — оба архивированы, не удалены.
- v3 source='sheet_import_2026_v3': 679 активных заказов. Январь–май = принудительно confirmed (явное решение владельца — "должны быть выполнены"). Июнь = по факту чекбоксов с каскадом (если shipped→всё true): 81 confirmed (отгружен) / 75 sent (в работе).
- Сумма 15 859 109,9 ₽ = отчёт владельца 15 859 110 ₽ (сходится до рубля, проверено).
- Менеджер из колонки C сохранён в notes.manager_name.
- Следующий шаг UI (текущий): визуально различать отгружен/не отгружен на карточках заказа в /app/b2b-orders/page.tsx + цветовой индикатор (зелёный/красный) в шапке страницы между счётчиком и кнопкой "Производственный день". Отсутствие client_id НЕ должно влиять на этот индикатор — это независимый сигнал (client_unverified в notes).

## Импорт 2026 — СДЕЛАНО (rebuild из таблицы) [устарело, см. v3 выше]
- Решение владельца: таблица = источник истины, позиции (`items`) теряем осознанно (в БД было лишь 45% с items), rebuild одобрен.
- Перенесено **579 заказов** из листа в `b2b_orders` (custom_number, client_id/скидка, launched_at, total_sale_inc_vat, notes.status=confirmed/sent, notes.stages, source='sheet_import_2026'). 107 мусорных итоговых строк листа отброшены.
- Исходные **733 архивированы** (`archived_at`, НЕ удалены). Бэкап: `scratchpad/b2b_orders_backup.json` (733) + `b2b_clients_backup.json`.
- 10 заказов без клиента — discount 10% по умолчанию (`notes.discount_defaulted`), 7 клиентов на сверку (Борис Воронеж, Константин, Егор Воронеж, Стеклянная Роскошь(Воронеж), Александр Емельянов, Эльхан, Евгений от Алексая).
- Активных заказов: 579. notes — text-колонка с JSON. organization_id=1.
- ОТКАТ если надо: восстановить из b2b_orders_backup.json + снять archived_at со старых / удалить импортированные (source='sheet_import_2026').

## Flow B2B — Слой A
- ✅ Фикс #1: запущенные (sent/confirmed) больше НЕ показываются в «Просчётах» (`app/b2b-quotes/page.tsx`: notLaunched-фильтр, убран таб «В работе», 'all'→'Активные').
- ✅ Фикс #2: таб «Сегодня» = просчитано сегодня и ещё не запущено (isToday по created_at); счётчики all/today; подзаголовок «N активных · M сегодня». Бонус: убран антипаттерн setState-в-useMemo (сброс страницы → в обработчиках вкладки/поиска).
- Проверка: typecheck app — чисто; eslint моих правок — чисто (осталась 1 пред-существующая ошибка на useEffect loadQuotes:514, не моя).

## Следующий шаг — Слой A, фикс #3
Редактирование заказа: сейчас правка в калькуляторе делает новый insert (`app/calculator/b2b/page.tsx:~281,681`). Нужно: update того же ряда + снапшот «было» в notes.change_log[], итоги считать по «стало». Затем — Слой B (материалы/раскрой→закупка, маршрут с ветвлением, подрядчики).

## B2B — что выяснено (grounded, эта сессия)
- `b2b_orders` в проде: **733 строки, ВСЕ created_at=2026**. История 2024–2025 в БД отсутствует (есть только в Google-таблице, ~2700 заказов, 2026 ~691).
- Причина «заказы 2026 вылетели»: **542/733 (74%) без launched_at, 401 без status в notes** → не попадают в помесячную группировку (`b2b-orders` группирует по launch-месяцу) → висят в «без даты»/свёрнутых месяцах. Таймзонный сдвиг (гипотеза H1) ОПРОВЕРГНУТ: дат «31.12» = 0.
- Просчёты и заказы — одна таблица `b2b_orders`; статус в JSON `notes.status` (quote/sent/agreed/confirmed/pending_approval). Колонка `status` в схеме не используется.
- Slой A разрывы: (1) `b2b-quotes` грузит всю таблицу без фильтра → запущенные не исчезают из просчётов; (2) нет среза «сегодня/не запущено»; (3) редактирование = новый insert, без истории «было/стало».
- Slой B: раскрой (`cuttingOptimizer.ts`) силён и считает листы по выделенным заказам ✅; не хватает: сумма ₽ в UI раскроя, печать заявки поставщику, связка раскрой→`purchase_orders`, сверка со складом, ветвление маршрута (сверловка/криволинейка/фацет/триплекс), трекинг подрядчиков «отправлено/вернулось».
- Google-таблица скачана: `scratchpad/mglass_2026.xlsx`. Помесячные листы 2024–2026, колонки заказа = № / Менеджер / Клиент / Дата запуска / суммы / стадии (Распечатан…Отгружен).

## Прошлый трек (P0 безопасность) — батч 1 закрыт
- `lib/apiAuth.ts` +`requireRole([...])`; гарды на 10 операций (payment, warehouse, b2b-seed, materials/from-supplier+transfer, mirror-lighting(+tabs), purchase-orders, procurement-routes, bot-toggle). «Без guard» 66→56. `scripts/audit-guards.mjs` — страж.

## Что сделано (эта сессия)
- Сквозной аудит 6 аналитиками + `docs/AUDIT_2026-06-30.md`, `docs/WORKING_RULES.md`, `scripts/audit-guards.mjs` (страж покрытия).
- **Батч 1 гардов (10 операций закрыто, «без guard» 66 → 56):**
  - `lib/apiAuth.ts` — добавлен helper `requireRole(allowed[])`.
  - `orders/[id]/payment` → requireRole(admin,ceo,manager,buyer).
  - `admin/warehouse` → requireOwner; `admin/b2b-seed` (массовый DELETE) → requireOwner.
  - `admin/materials/from-supplier`, `admin/materials/transfer`, `admin/mirror-lighting`, `admin/mirror-lighting/tabs`, `admin/purchase-orders`, `admin/procurement-routes` → requireRole(admin,ceo,buyer).
  - `admin/bot-toggle` → requireRole(admin,ceo,seo).
- Проверено: tsc в боевом коде 0 ошибок, vitest 23/23, страж подтверждает закрытие.
- Роли подобраны по `ROLE_ALLOWED` так, чтобы не выбить легитимных вызывающих.

## Следующий шаг
Батч 2 P0 (по приоритету):
1. Order-lifecycle service-role роуты по правильным ролям (производство легитимно зовёт стадии): `orders/[id]/{brigade,delivery,production-stages,rating,photos}`, `appointments`, `measurer`.
2. `ai/proposals/*` (draft/approve/reject) — гард по роли.
3. `ai/generate-task`, `ai/analyze-note` — добавить auth (сейчас вообще без неё).
4. Защитить доступ к AmoCRM-write роутам (`amo/calls/analyze` без auth) — НЕ удаляя запись (решение по записи за владельцем).
5. Проверить наличие `CRON_SECRET`/секрета Wazzup в проде → fail-closed для `wazzup/webhook`, `cron/process-queue|process-tasks`.

## Контекст
- Корень дыры: `lib/getRole.ts:230` — `/api/*` всегда `true`; вся защита API на самих роутах.
- Страж: `node scripts/audit-guards.mjs` (regex детектора знает requireOwner/requireAdmin/requireRole).
- Пре-существующее: 31 ошибка tsc только в `__tests__/calculators/mirror.test.ts` (зовёт calculateMirror с 4 арг вместо 3) — быстрый follow-up, чтобы typecheck стал зелёным гейтом.

## Открытые вопросы
1. AmoCRM-записи (`cron/process-queue`, `amo/calls/analyze`) — фича или убрать? (запись не трогаю до решения; доступ к роуту защищу)
2. RLS на `glass_price_matrix` — включать только после проверки чтения калькуляторов.
3. Подтвердить `CRON_SECRET`/секрет Wazzup в проде перед fail-closed.

## Контекст
- Корневой источник дыры: `lib/getRole.ts:230` — `/api/*` всегда `true`, middleware не гейтит API по роли.
- Роуты `orders/[id]/{status,brigade,delivery,production-stages}` легитимно зовут не-owner роли (производство) — гард подбирать по роли, не blanket requireOwner.

## Открытые вопросы (блокеры P0, решает владелец)
1. AmoCRM-записи (`cron/process-queue`, `amo/calls/analyze`) — намеренная фича или убрать? (нарушают read-only)
2. Включение RLS на `glass_price_matrix` — только после проверки, что чтение калькуляторов не сломается.
3. Cron/webhook fail-closed — подтвердить, что `CRON_SECRET` и секрет Wazzup заданы в проде.
