## РЕШЕНИЯ ВЛАДЕЛЬЦА (2026-07-01)
- **НДС B2B = 22%, ВЕРНО.** Клиент должен его видеть, он есть в КП (`/b2b-quotes/[id]/kp`). НЕ менять. Вопрос закрыт.
- **Всё до конца июня НЕ трогаем** (исторические заказы как есть).
- **С июля — правильный поток:** B2B-заказ рождается из истории просчётов B2B (калькулятор `/calculator/b2b` сохраняет items → `/b2b-quotes` → «Запустить в работу»). У июльских заказов будут items = полная детализация по позициям. Поток проверен без пробелов: confirmWorkDate (b2b-quotes:398) пишет launched_at/deadline_date + зовёт launch-production, который читает order.items и строит позиционные production_tasks (buildProductionTasks, идемпотентный upsert). Борд/аналитика подхватывают детали автоматически.
- Правка борда: готов-к-отгрузке теперь = packed-ячейка done (order-level флаг ИЛИ все позиции упакованы по detail_stages) — чтобы новые июльские (item-level) заказы корректно уходили в «готов».

## B2B — дорожная карта (4 пункта, порядок владельца)
Многоракурсный аудит B2B выполнен (3 параллельных агента: данные/аналитика, поток КП→клиент, производство/закупки). Порядок работ: **1) B2B-аналитика → 2) починить рассинхрон производства → 3) борд «заказ×этапы» → 4) кабинет партнёра.**

### #1 B2B-аналитика — СДЕЛАНО
- Новая вкладка `/cfo/b2b` (серверный компонент на service-role, минует RLS, постранично тянет все 2672 заказа). Ссылки добавлены в шапку и быстрые ссылки `/cfo`.
- Оборотка = Σ total_after_discount по реальным заказам (не quote/pending_approval). Разбивка себестоимости (материал=Σitems[].costMaterial, закалка=ΣcostTempering, прочее=costWithVat−mat−temp) + валовая прибыль + маржа. Блоки: Оборот / Разбивка / По месяцам 2026 / Топ клиентов. Фильтр периода (месяц/квартал/полгода/год/всё).
- **КЛЮЧЕВОЙ нюанс (проверено на живой БД):** только **334 из 2672** заказов имеют `items` (сделаны через калькулятор). 2338 — импорт из таблицы без разбивки. Поэтому материал/закалка честно показываются ОТДЕЛЬНО с явным покрытием («N из M заказов, X% оборота») + amber-баннер, чтобы доли не вводили в заблуждение. Оборотка при этом полная по всем.
- Данные для аналитики уже лежат в БД — миграций НЕ потребовалось, только чтение. Впредь покрытие растёт (новые заказы из калькулятора имеют items).
- Проверка: tsc/eslint/build ЗЕЛЁНЫЕ. Логика сверена диагностикой на живых данных (оборотка реальных ~19 млн ₽, материал/закалка сходятся).

### #3 Рассинхрон производства — СДЕЛАНО
- #3a Обратное зеркало: новый POST /api/b2b-orders/[id]/sync-stages (service-role) — отметка/отмена этапа с orders/[id] (persistStageUpdate done + unsetStage) и /p/o (markSelectedStages done) теперь зеркалится в production_tasks. Best-effort, псевдоэтап 'problem' пропускается, исторические заказы без задач — no-op. Проверено: WHERE (order_id,item_index,stage_key) матчит ровно 1 строку на живых 8 задачах.
- #3b Криволинейка оживлена: чекбокс «Криволинейка» в калькуляторе b2b (add+edit) → item.shape='curved'; curved добавлен в GROUP_ACTIONS orders/[id] с фильтром по shape==='curved'. Маршрут уже умел curved (getApplicableStages), CHECK-констрейнт +curved применён ранее.
- #3c Кнопка «Взял в работу» в my-queue (action:'start') → статус in_progress, индикатор «🔧 в работе». WIP стал видимым.
- #3d Размеры детали на карточках my-queue: грузим items заказа, показываем Ш×В · материал толщина · кол-во.
- Проверка: tsc/eslint(без новых ошибок)/build ЗЕЛЁНЫЕ. production_tasks = 8 строк (1 тестовый заказ #2816).

### #2 Борд начальника «заказ × этапы» — СДЕЛАНО
- Новый экран `/production-app/board` (серверный, service-role), доступен роли production (не только admin/ceo как старый /supervisor). В навигации Сводки.
- Строки = активные заказы (не отгружены), колонки = лента: Чертёж/Материал/Резка/Полировка/Сверление/Закалка/Упаковка. Ячейки: готово✓/в работе(имя)/частично(n/m)/проблема⚠/не начато. Синяя рамка = текущий этап.
- Основа — notes.stages (order-level флаги printed/material_ordered/cut/edge/drilled/tempering/packed/shipped, данные по ВСЕМ 72 активным). Уточнение (в работе/частично/проблема) — из detail_stages+production_tasks нового цеха.
- Готов = packed=true (как Сводка). Фильтр «показать/скрыть готовые». Проверено: 72 активных → 68 в работе / 4 готовы. tsc/build зелёные.
- На будущее: старый /production-app/supervisor можно свести к борду.

### #4 Кабинет партнёра — ПЕРВЫЙ СРЕЗ СДЕЛАН (фундамент, доступ никому не выдан)
- Роль `partner` в lib/getRole.ts (Role, isRole, ROLE_ALLOWED.partner=['/', '/partner']). Внешний партнёр видит только свой кабинет.
- Миграция `supabase/migrations/20260701_b2b_client_portal.sql`: b2b_clients.user_id uuid → auth.users (аддитивно). **НЕ ПРИМЕНЕНА** (Supabase MCP Unauthorized, авто-раннера нет). Портал работает и без неё: API ловит ошибку отсутствия колонки → «не привязан».
- `/partner/layout.tsx` — гард (partner/owner). `/partner/page.tsx` — read-only «Мои заказы»: этап (из notes.stages ленты), % готовности, срок, цена (total_after_discount). Никакой себестоимости/маржи.
- `/api/partner/orders` — scoped СТРОГО по b2b_clients.user_id=auth.uid(); чужие данные не отдаёт; не привязан/нет колонки → {linked:false}.
- app/page.tsx: партнёр редиректится с '/' на '/partner' (не видит панель менеджера).
- Проверка: tsc/eslint/build зелёные. b2b_clients=48, колонки user_id пока нет (портал корректно показывает «не привязан»).
- **ШАГИ ВЛАДЕЛЬЦА для активации (внешний доступ — его решение):** 1) применить миграцию в Supabase SQL Editor; 2) завести партнёру auth-учётку + role='partner' в public.users; 3) проставить b2b_clients.user_id нужному клиенту.
- ДАЛЬШЕ по #4 (следующие срезы): облегчённый калькулятор партнёра (только цена+его скидка) → история его просчётов → заявка в работу с PDF-чертежом → статус в realtime → (будущее) ИИ-сверка чертежа с просчётом. Для realtime статус лучше вынести из notes.status в колонку.
- Открытый вопрос: НДС в HTML-КП (/b2b-quotes/[id]/kp) = 22% (канон проекта 12%) — свериться для B2B.
- Открытый вопрос к владельцу: НДС в HTML-КП (`/b2b-quotes/[id]/kp`) = 22% (канонический налог проекта 12%) — свериться, что правильно для B2B.

## B2B-производство — фаза «команда цеха» (СДЕЛАНО, деплой)
- Миграция (применена): users.production_stations[] (мультистанции), production_tasks CHECK +curved.
- 6 учёток production: Бекмурза[cutting,curved], Эльзат[polishing], Адилет[drilling], Никита[tempering,packaging], Сергей[], Валерия[]. Пароли *Cex26 (в /admin/users). Триггер auth→users авто-создаёт строку — заводить через update, не insert.
- Этап «Криволинейка» (curved) — маршрут при item.shape==='curved'. Фильтры my-queue/today/station/AssignWorker — на production_stations[].
- /admin/users: мультивыбор станций (чипы) + фильтр по роли/отделу «Отдел» (ad1c4e5).
- /production-app (Сводка): группировка по сроку выдачи (готовы/просрочено/сегодня/завтра/послезавтра/позже)+готовность+нав. /material (Сергей, read-only). /docs (Валерия, печать+отметка notes.docs_printed). API /api/b2b-orders/[id]/docs-printed.
- Срок сдачи: захват «Срок сдачи» (дефолт +14д) в «Запустить в работу» → notes.deadline_date; Сводка группирует по нему (ad1c4e5). ОПЦИОНАЛЬНО на будущее: импорт «Ориентировочной даты» из Google-таблицы для исторических активных заказов.
Коммиты: 497c079 (мультистанции+curved), 03f1ce6 (Сводка+Материал+Документы), ad1c4e5 (срок сдачи + фильтр отдела).

## B2B-производство — контур (автономная достройка)
СДЕЛАНО и задеплоено: ядро (миграция production_tasks, авто-маршрут, генерация при запуске, «Пул на сегодня», ролевая защита /p/o), фикс даты «В работу», объединение в одну кнопку «Запустить в работу». Worker-модуль (коммит 525f8d5): A1 станция рабочего в /admin/users; A2 назначение задач рабочим в «Пуле на сегодня» (AssignWorker); A3 my-queue рабочий; B cutover — /api/production-tasks/[id] пишет и в production_tasks, и в notes.detail_stages.
СДЕЛАНО: C — печатная «Заявка поставщику» из раскроя (4597662). D — агрегированный вид резчика /production-app/cutting (партии материал+толщина из всех заказов, отметка партией/строкой). E — PWA цеха (production-app.webmanifest start_url /production-app, sw.js, RegisterSW). Коммит 5c9c389.
СДЕЛАНО (продолжение по порядку): агрегация ВСЕХ станций /production-app/station/[station] (резка с раскроем, остальные — детали/площадь, только готовые задачи), /cutting → редирект, «Мои задачи» ведёт на станцию рабочего (d530f7b). Учёт закупок: процурмент-система /admin/procurement УЖЕ существует (статусы счёт→оплата→забрали→закрыто + платежи) — добавил связку «Сохранить в закупки» из раскроя (090b767), миграция не понадобилась.
СДЕЛАНО (по порядку): гейт резки по приходу материала — резка строки блокируется, если по заказу есть открытая заявка в закупках, не «забрана» (da2410b); ₽-оценка себестоимости в раскрое по канонической формуле sheetCost (3bd1a49); сверка со складом — миграция b2b_materials.stock_sheets ПРИМЕНЕНА в прод, поле в /admin/b2b-materials, колонка «Склад/докупить» в раскрое (8a6bb07).
Весь контур B2B-производства реализован и в проде. Операционный пред-шаг (за владельцем): завести рабочих production + станции в /admin/users, вести остатки склада в /admin/b2b-materials.
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
