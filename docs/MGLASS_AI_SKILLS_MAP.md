# MGlass AI Skills Map — Карта AI-навыков

> Документ описывает разбивку всей системы MGlass на 14 Skills (навыков).  
> Каждый Skill — самостоятельная область ответственности с чёткими границами, которую можно развивать независимо.

---

## Skill 1: Calculation Skill (Расчётный навык)

**Назначение:** Вычислять точную стоимость изделий (зеркала, душевые, лофт, B2B-стекло) с учётом материалов, услуг, отходов, фурнитуры и финансовых параметров.

**Модули и страницы:**
- `/calculator/mirror` — зеркала с подсветкой
- `/calculator/shower` — душевые (12 моделей, 2 тира)
- `/calculator/loft` — лофт-перегородки
- `/calculator/b2b` — B2B расчёт стекла

**API маршруты:**
- `GET /api/admin/glass-prices` — матрица цен
- `POST /api/calc/quick` — быстрый расчёт (Telegram-бот)

**Таблицы БД:**
- `glass_price_matrix` — цены стекла/зеркала по типу и толщине
- `material_waste_modifiers` — коэффициенты отходов
- `mirror_lighting_components` — подсветка
- `mirror_frames` — рамки
- `facet_prices` — фацет
- `hardware_items` — лофт-фурнитура
- `shower_hardware_items` — душевая-фурнитура
- `materials`, `services` — расходники и услуги
- `financial_settings` — % расходов, маржа
- `b2b_materials`, `b2b_services` — B2B

**Роли:** manager (пишет), admin (всё), buyer (только справочники)

**Входные данные:** Размеры, материал, опции (подсветка/фацет/монтаж), скидка, маржа

**Выходные данные:** `CostBreakdown` (постатейная себестоимость), `FinancialBreakdown` (расчёт цены), `base_price`, `final_price`, `margin`, `profit`, `client_text`

**Что уже реализовано:**
- Полные движки: `mirrorCalculator.ts`, `loftCalculator.ts`, `showerCalculator.ts`, `b2bCalculator.ts`
- Загрузка матрицы: `glassMatrix.ts`
- Сохранение в `calculations` через `saveCalculation.ts`
- SVG-визуализация: `svg/generateMirrorSVG.ts`, `svg/generateLoftSVG.ts`
- Корзина для группировки расчётов: `CartContext.tsx`
- Быстрый расчёт для Telegram: `quickCalc.ts`

**Что нужно доработать:**
- Версионирование цен: расчёт должен содержать снимок цен на момент создания
- Автоматический пересчёт при изменении цен в справочниках
- Тест на регрессию: изменение справочника не должно ломать существующие расчёты

**Риски:**
- `glass_price_matrix` и `b2b_materials` могут рассинхронизироваться (health-check следит за этим)
- `financial_settings` может отсутствовать для нового tier/product_type → нет блокировки, fallback на defaults
- НДС зашит в `b2bCalculator.ts` как константа `VAT = 22` — при изменении ставки нужно ручное обновление

**Тесты:**
- Unit: `calculateMirror()` с mock-данными
- Unit: `calcItem()` для B2B с закалкой и фацетом
- Integration: расчёт → сохранение → чтение из БД
- Regression: при изменении цен в матрице, старые расчёты остаются неизменными

**Связи:** Pricing Skill (источник цен), Order Management Skill (потребитель расчётов), Commercial Proposal Skill (визуализация)

---

## Skill 2: Commercial Proposal Skill (Навык коммерческих предложений)

**Назначение:** Формировать, отправлять и хранить коммерческие предложения — от текстового описания до PDF-документа.

**Модули и страницы:**
- `/calculations` — список КП
- `/calculations/[id]` — просмотр и редактирование КП
- `/calculations/[id]/print` — печать КП
- `/calculations/order/[groupId]/print` — печать группы
- `/b2b-quotes/[id]/kp` — КП для B2B
- `/kp-generator` — AI-генератор КП

**API маршруты:**
- `GET /api/quotes/[id]/pdf` — генерация PDF для B2B (react-pdf)
- `POST /api/ai/generate-kp` — AI-генерация КП
- `POST /api/ai/personalize-template` — персонализация шаблона

**Таблицы БД:**
- `calculations` — расчёты (status, client_text, notes, parent_calc_id)
- `b2b_quotes` — B2B КП
- `calculation_changes` — история изменений расчёта

**Роли:** manager (создаёт/редактирует), admin (всё), buyer (чтение)

**Входные данные:** Расчёт (id), клиент, статус, текст для клиента

**Выходные данные:** PDF, текст для WhatsApp/Telegram, версия КП

**Что уже реализовано:**
- Страница детального расчёта с историей изменений
- Статусная воронка КП (12 статусов: draft → done/rejected)
- PDF генерация B2B через `@react-pdf/renderer` + `QuotePDF` компонент
- Печатные страницы (`/print`)
- AI-генератор через `/api/ai/generate-kp`
- Персонализация шаблонов через `/api/ai/personalize-template`

**Что нужно доработать:**
- PDF для B2C расчётов (зеркало/душевая/лофт) — используется только print CSS
- Версии КП: сохранение снимков при изменении цены
- Шаблоны КП с брендированием

**Риски:**
- `@react-pdf/renderer` работает только на Node.js runtime (route.ts: `export const runtime = 'nodejs'`)
- PDF-генерация может упасть при больших заказах — нет ограничения по размеру

**Тесты:**
- Unit: `QuotePDF` рендерится без ошибок
- Integration: GET `/api/quotes/[id]/pdf` возвращает валидный PDF
- E2E: менеджер создаёт расчёт → отправляет КП клиенту

**Связи:** Calculation Skill (источник данных), Order Management Skill (КП → заказ), Integration Skill (отправка через Wazzup)

---

## Skill 3: Pricing Skill (Навык ценообразования)

**Назначение:** Управлять всеми справочниками цен, контролировать маржинальность и обеспечивать консистентность данных между таблицами.

**Модули и страницы:**
- `/admin/glass-prices` — матрица цен стекла/зеркал + формульные параметры
- `/admin/facet` — цены фацета
- `/admin/mirror-lighting` — компоненты подсветки
- `/admin/mirror-frames` — рамки зеркал
- `/admin/shower-hardware` — фурнитура душевых (BudgetMatrix, StandardFilter)
- `/admin/hardware` — фурнитура лофт
- `/admin/materials` — материалы
- `/admin/services` — услуги
- `/admin/settings` — финансовые настройки
- `/admin/b2b-materials` — B2B материалы
- `/admin/b2b-services` — B2B услуги
- `/admin/waste-modifiers` — коэффициенты отхода
- `/admin/pricing-manual` — руководство по ценообразованию

**API маршруты:**
- `GET/POST /api/admin/glass-prices` — матрица цен (sale только для owner)
- `GET/POST /api/admin/pricing-formula` — формульные параметры
- `POST /api/admin/migrate-glass-prices` — миграция цен
- `POST /api/admin/sync-b2b-materials` — синхронизация B2B-материалов
- `POST /api/ai/suggest-price` — AI-подсказка цены

**Таблицы БД:**
- `glass_price_matrix` — ключевая таблица (name, price_type, category, t4–t12, waste_pct, supplier_id)
- `pricing_formula_params` — параметры расчётных услуг
- `material_waste_modifiers` — коэффициенты отходов
- `facet_prices` — фацет
- `mirror_frames` — рамки
- `mirror_lighting_components` — подсветка
- `hardware_items` — лофт-фурнитура
- `shower_hardware_items` — душевая-фурнитура
- `materials` — материалы склада
- `services` — услуги
- `financial_settings` — % расходов, маржа
- `b2b_materials`, `b2b_services`, `b2b_films` — B2B

**Роли:** buyer (справочники), admin (всё), ceo/owner (sale-цены в матрице)

**Входные данные:** Прайс-листы поставщиков, ручной ввод, импорт из Google Sheets

**Выходные данные:** Цены в калькуляторах, маржинальные подсказки

**Что уже реализовано:**
- Полная матрица стекла (4 вкладки: cost/sale × glass/mirror)
- Расчёт маржи прямо в таблице glass-prices
- Привязка строк матрицы к поставщикам
- Формульные параметры для расчётных B2B-услуг
- Интерфейс страницы b2b-materials с calcCostPerM2 и calcMargin
- Настройки раскроя

**Что нужно доработать:**
- История изменений цен (аудит: кто/когда изменил)
- Автоматический пересчёт рентабельности при изменении закупочных цен
- Уведомление менеджеров о значительном изменении цен

**Риски:**
- `sale` цены в `glass_price_matrix` доступны только `owner` — если owner не настроен, sale-строки скрыты
- B2B sale_price хранится в `notes` JSON-поле (legacy) — нужна миграция
- Изменение `financial_settings` немедленно влияет на все будущие расчёты

**Тесты:**
- Integration: изменение цены в матрице отражается в калькуляторе
- Smoke: все 4 таблицы матрицы загружаются без ошибок
- Regression: health-check проверяет рассинхрон b2b_materials

**Связи:** Calculation Skill (потребляет цены), Procurement Skill (источник закупочных цен), Health Check Skill (валидация)

---

## Skill 4: Order Management Skill (Навык управления заказами)

**Назначение:** Полный жизненный цикл заказа: создание из расчёта → статусная воронка → оплата → доставка → завершение.

**Модули и страницы:**
- `/orders` — список заказов
- `/orders/[id]` — детальный заказ
- `/orders/[id]/print` — печать заказа
- `/orders/[id]/act` — акт выполненных работ
- `/orders/[id]/spec` — спецификация
- `/production` — производственный список
- `/manager-dashboard` — дашборд менеджера

**API маршруты:**
- `POST /api/orders` — создать заказ из расчёта
- `PATCH /api/orders/[id]/status` — изменить статус
- `POST /api/orders/[id]/approve` — одобрить (admin)
- `PATCH /api/orders/[id]/payment` — обновить оплату
- `PATCH /api/orders/[id]/delivery` — назначить доставку
- `PATCH /api/orders/[id]/brigade` — назначить бригаду
- `POST /api/orders/[id]/photos` — фото выполненных работ
- `POST /api/orders/[id]/rating` — оценка клиента
- `POST /api/orders/[id]/custom-number` — кастомный номер
- `PATCH /api/orders/[id]/production-stages` — этапы производства
- `GET /api/orders/production` — список для производства

**Таблицы БД:**
- `orders` — заказы
- `order_lines` — позиции заказов (BOM)
- `calculations` — исходные расчёты
- `delivery_zones` — зоны доставки
- `brigades` — монтажные бригады

**Роли:**
- manager: создаёт, видит свои заказы
- production: видит все, меняет статус производства
- buyer: видит для логистики
- admin/ceo: видит всё, одобряет

**Входные данные:** Расчёт (calculation_id), данные клиента, дедлайн, AMO-ссылка

**Выходные данные:** Заказ с номером, BOM-список, печатные документы

**Что уже реализовано:**
- Создание заказа из корзины расчётов (`LaunchOrderModal`)
- Статусная воронка (draft → pending_approval → approved → in_work → completed)
- Контроль маржи: блокировка + уведомление admin при марже < threshold
- Оплата (unpaid/partial/paid + суммы)
- История изменений расчёта (calculation_changes)
- Производственный список

**Что нужно доработать:**
- Мульти-позиционные заказы (сейчас: один расчёт = один заказ)
- Интеграция с производством (этапы: нарезка → монтаж → доставка)
- SLA-трекинг (cron/sla уже есть, но страница не отображает)

**Риски:**
- Одобрение заказа — только admin. Если admin недоступен, заказ застрянет в `pending_approval`
- `notify.ts` (email Resend) может молча не работать если RESEND_API_KEY не задан

**Тесты:**
- Integration: создание заказа с маржой ниже порога → статус pending_approval
- Integration: одобрение → статус in_work → уведомление
- E2E: менеджер создаёт заказ из расчёта, admin одобряет

**Связи:** Calculation Skill (источник), Logistics Skill (доставка/бригады), CEO Analytics Skill (выручка)

---

## Skill 5: B2B Skill (Навык B2B-продаж)

**Назначение:** Полный цикл работы с B2B-клиентами: расчёт стекла → просчёт → CRM → заказ → раскрой → производство.

**Модули и страницы:**
- `/calculator/b2b` — B2B калькулятор
- `/b2b-quotes` — список B2B просчётов
- `/b2b-quotes/[id]/kp` — КП по просчёту
- `/b2b-orders` — B2B заказы
- `/b2b-crm` — CRM (список клиентов)
- `/b2b-crm/[id]` — карточка клиента + взаимодействия
- `/b2b-cutting` — раскрой стекла
- `/b2b-pipeline` — воронка продаж
- `/b2b-production` — производство B2B
- `/b2b-analytics` — аналитика
- `/admin/b2b-clients` — справочник клиентов
- `/admin/b2b-materials` — справочник материалов
- `/admin/b2b-services` — справочник услуг
- `/admin/cutting-settings` — настройки раскроя
- `/admin/archive` — архив расчётов

**API маршруты:**
- `GET /api/quotes/[id]/pdf` — PDF КП
- `POST /api/b2b/parse-pdf` — парсинг PDF-прайса
- `GET/POST /api/admin/b2b-leads` — B2B лиды
- `POST /api/admin/b2b-seed` — тестовые данные
- `POST /api/admin/sync-b2b-materials` — синхронизация материалов
- `POST /api/ai/b2b-message` — AI-сообщение
- `POST /api/ai/b2b-score` — оценка лида
- `POST /api/ai/b2b-segment-analysis` — анализ сегмента
- `POST /api/ai/b2b-prospect` — поиск клиентов

**Таблицы БД:**
- `b2b_clients` — клиенты (CRM-поля: segment, status, score, city)
- `b2b_interactions` — история взаимодействий
- `b2b_quotes` — просчёты
- `b2b_orders` — заказы
- `b2b_materials` — материалы (стекло, зеркало и виды)
- `b2b_services` — услуги (закалка, кромка, плёнка)
- `b2b_films` — плёнки
- `cutting_settings` — настройки раскроя

**Роли:**
- manager: калькулятор, просчёты, заказы, CRM, раскрой
- production: пайплайн, производство B2B, заказы
- admin: всё
- buyer: только справочники (b2b-materials)

**Входные данные:** Список деталей (размеры, материал, услуги), скидка клиента

**Выходные данные:** Просчёт с маржой, PDF КП, карты раскроя (cuttingOptimizer)

**Что уже реализовано:**
- Полный B2B калькулятор с НДС, закалкой, фацетом, кромкой, плёнкой
- CRM: сегменты, статусы (new/contacted/active/sleeping/lost), оценки A/B/C
- История взаимодействий (звонок/встреча/КП/заказ)
- 2D-оптимизация раскроя (guillotine BSSF, multi-strategy)
- PDF генерация КП
- AI-анализ клиентов и сегментов

**Что нужно доработать:**
- Подтверждение заказа (B2B order approval flow)
- Автоматическая нарезка карт раскроя при запуске заказа
- Интеграция раскроя с производственным планом

**Риски:**
- `sale_price` в `b2b_materials` хранится в `notes` JSON-поле (legacy) — может сломаться при изменении схемы
- Раскрой не оптимизирует по нескольким заказам одновременно

**Тесты:**
- Unit: `runCuttingOptimizer` корректно укладывает детали
- Integration: калькулятор → просчёт → PDF
- E2E: менеджер делает B2B просчёт → отправляет КП

**Связи:** Pricing Skill (b2b_materials, b2b_services), Commercial Proposal Skill (PDF), Procurement Skill (материалы)

---

## Skill 6: Procurement Skill (Навык закупок)

**Назначение:** Управлять закупками: поставщики, заявки, склад, критические остатки, обновление прайсов.

**Модули и страницы:**
- `/admin/suppliers` — поставщики
- `/admin/suppliers/eleganz` — прайс Eleganz
- `/admin/procurement` — канбан закупок
- `/admin/stock-control` — критические остатки
- `/admin/warehouse` — склад
- `/admin/materials` — справочник материалов
- `/admin/guide` — регламент закупщика

**API маршруты:**
- `GET/POST /api/admin/suppliers` — поставщики (write: admin, buyer)
- `PATCH/DELETE /api/admin/suppliers/[id]` — один поставщик
- `GET/PATCH /api/admin/warehouse` — остатки склада
- `GET/POST/PATCH /api/admin/purchase-orders` — заявки на закупку
- `POST /api/admin/materials/from-supplier` — перенос цен из прайса
- `POST /api/admin/materials/transfer` — перенос материалов
- `POST /api/admin/materials/upload` — загрузка прайса
- `GET /api/cron/stock` — автопроверка критических остатков

**Таблицы БД:**
- `suppliers` — поставщики
- `purchase_orders` — заявки на закупку (канбан)
- `materials` — материалы (stock_qty, min_stock_qty)
- `b2b_materials` — стекло для B2B (supplier_id)
- `glass_price_matrix` — матрица (supplier_id)

**Роли:**
- buyer: полный доступ к закупкам и складу
- admin: всё

**Входные данные:** Прайс-листы поставщиков (PDF/Excel), ручной ввод

**Выходные данные:** Обновлённые цены в справочниках, канбан заявок, алерты критических остатков

**Что уже реализовано:**
- Справочник поставщиков с архивированием и скидками
- Канбан закупок (purchase_orders)
- Контроль склада (stock_qty vs min_stock_qty)
- Привязка материалов к поставщикам
- Cron-задача проверки критических остатков

**Что нужно доработать:**
- Импорт прайс-листов поставщиков (PDF-парсинг частично реализован через `/api/b2b/parse-pdf`)
- Автоматическое обновление цен из прайса в b2b_materials/glass_price_matrix
- История закупочных цен

**Риски:**
- Ручное обновление цен → риск расхождения между поставщиком и матрицей
- Критические остатки только по `materials` — `b2b_materials` не контролируется

**Тесты:**
- Integration: добавление поставщика → привязка к материалу
- Cron: `/api/cron/stock` отправляет уведомление при критическом остатке

**Связи:** Pricing Skill (обновление цен), Logistics Skill (маршруты к поставщикам)

---

## Skill 7: Logistics Skill (Навык логистики)

**Назначение:** Управлять доставками клиентам и маршрутами к поставщикам, назначать бригады, контролировать зоны доставки.

**Модули и страницы:**
- `/admin/route-sheet` — маршрутный лист доставок клиентам
- `/admin/procurement-routes` — маршруты к поставщикам
- `/admin/delivery-zones` — зоны доставки
- `/admin/brigades` — бригады монтажников

**API маршруты:**
- `GET/POST/PATCH/DELETE /api/admin/procurement-routes` — маршруты (routes + stops)
- `GET/POST/PATCH/DELETE /api/admin/delivery-zones/[id]` — зоны доставки
- `GET/POST /api/admin/brigades` — бригады
- `PATCH/DELETE /api/admin/brigades/[id]` — одна бригада
- `GET /api/admin/brigades/stats` — статистика бригад
- `PATCH /api/orders/[id]/delivery` — назначить зону доставки
- `PATCH /api/orders/[id]/brigade` — назначить бригаду

**Таблицы БД:**
- `delivery_zones` — зоны доставки (название, цена)
- `brigades` — бригады монтажников
- `procurement_routes` — маршруты к поставщикам
- `procurement_route_stops` — остановки маршрутов (position, supplier_id, address)
- `orders` — связь с delivery_zone_id, brigade_id
- `b2b_orders` — B2B-заказы для маршрутного листа

**Роли:**
- buyer: маршруты к поставщикам, маршрутный лист, зоны
- admin: всё

**Входные данные:** Адреса клиентов/поставщиков, даты доставки

**Выходные данные:** Маршрутный лист (печать), назначение бригады к заказу

**Что уже реализовано:**
- Маршрутный лист с печатью (`PrintButton.tsx`)
- CRUD маршрутов к поставщикам со списком остановок
- Зоны доставки с ценами
- Бригады со статистикой
- Назначение зоны и бригады к заказу

**Что нужно доработать:**
- Автоматическая стоимость доставки по зоне в калькуляторе
- GPS/карта маршрутов
- Учёт времени монтажа в планировании бригад

**Риски:**
- Зона доставки назначается вручную — нет автоматизации по адресу
- Если бригада удалена, заказы с brigade_id могут сломаться

**Тесты:**
- Integration: назначение зоны к заказу обновляет delivery_cost
- Smoke: маршрутный лист печатается без ошибок

**Связи:** Order Management Skill (заказы), Procurement Skill (поставщики)

---

## Skill 8: Measurement Skill (Навык замеров)

**Назначение:** Принимать заявки на замер, уведомлять команду, хранить данные замера.

**Модули и страницы:**
- `/measurer` — форма замера для менеджера
- `/calendar` — календарь замеров

**API маршруты:**
- `POST /api/measurer` — создать заявку на замер (фото + данные)
- `GET/POST /api/appointments` — записи (calendar)

**Таблицы БД:**
- `measurements` — заявки на замер (client_name, address, phone, product_type, photos, dimensions, notes)
- Supabase Storage `backups` — фотографии замеров

**Роли:** manager (создаёт), admin (видит всё), buyer (нет доступа)

**Входные данные:** Имя клиента, адрес, телефон, тип продукта, размеры, фото (несколько файлов)

**Выходные данные:** Запись в `measurements`, уведомление admin в Telegram (`notifyAdmins()`)

**Что уже реализовано:**
- Форма замера с загрузкой фото
- Сохранение в `measurements`
- Telegram-уведомление admin

**Что нужно доработать:**
- Связь замера с заказом (measurement → order)
- Страница списка замеров для admin
- Интеграция с Google Календарём

**Риски:**
- Фото загружаются в `backups` bucket — нет лимита, может расти бесконтрольно
- Нет подтверждения замера клиенту (только admin-уведомление)

**Тесты:**
- Integration: POST /api/measurer с файлами → запись в measurements + Telegram
- Smoke: форма замера открывается, поля валидируются

**Связи:** Order Management Skill (замер → заказ), Integration Skill (Telegram-уведомление)

---

## Skill 9: Health Check Skill (Навык проверки здоровья системы)

**Назначение:** Автоматически проверять консистентность данных, находить ошибки конфигурации, предлагать и применять авто-исправления.

**Модули и страницы:**
- `/admin/health-check` — страница с результатами проверок
- `/admin/ai-control-center` (вкладка health) — интегрировано в AI Control Center

**API маршруты:**
- `POST /api/admin/health-check/fix` — применить авто-исправление (admin/ceo only)
- `GET /api/cron/health` — автоматическая проверка (cron, Bearer token)

**Таблицы БД:**
- `glass_price_matrix` — проверка на рассинхронизацию с b2b_materials
- `b2b_materials` — проверка на устаревшие/отсутствующие записи
- `users` — проверка на пользователей без роли
- `materials` — проверка склада
- Supabase API keys (проверяется доступность)

**Роли:** admin, ceo (доступ к health-check)

**Входные данные:** Запрос на запуск проверок

**Выходные данные:** `CheckResult[]` со статусами (ok/warn/error), `IssueMeta` с причиной/рекомендацией/авто-фиксом

**Что уже реализовано:**
- `healthCheckRunner.ts` — типы, константы, маппинг проверок
- Страница `/admin/health-check` с детальными результатами
- Авто-исправления: `sync_b2b_materials`, `sync_b2b_from_glass`, `fix_roles_null`
- Log авто-исправлений (localStorage: `mglass_health_fix_log`)
- Cron-задача `/api/cron/health` с Telegram-алертом при проблемах
- Интеграция в AI Control Center

**Что нужно доработать:**
- Хранение лога исправлений в БД (сейчас только localStorage)
- Больше проверок: финансовые настройки, мёртвые расчёты, дублированные клиенты
- Email-уведомление при критических ошибках

**Риски:**
- Авто-исправления применяются без подтверждения — критично при `sync_b2b_from_glass` (деактивирует записи)
- cron/health требует `CRON_SECRET` — без него не работает

**Тесты:**
- Integration: `sync_b2b_materials` добавляет нужные записи в b2b_materials
- Integration: `fix_roles_null` назначает роль manager
- Unit: `runChecks()` возвращает корректную структуру

**Связи:** Pricing Skill (проверяет матрицу), B2B Skill (проверяет b2b_materials), User & Access Skill (роли)

---

## Skill 10: AI Control Center Skill (Навык центра управления AI)

**Назначение:** Анализировать работу системы с помощью AI, генерировать рекомендации, отслеживать их внедрение.

**Модули и страницы:**
- `/admin/ai-control-center` — центральный дашборд (6 вкладок: overview, health, calculators, ai, recommendations, log)
- `/admin/agents` — AI-агенты
- `/ai-stats` — статистика AI

**API маршруты:**
- `POST /api/admin/ai-control-center/analyze` — AI-анализ с выбором перспективы (owner/sales/operations/pricing)
- `GET/POST /api/agents/run/[key]` — запуск агента
- `POST/DELETE /api/agents/catalog/approve` — одобрение каталога агентом
- `GET /api/cron/agent-analyst` — агент-аналитик
- `GET /api/cron/agent-ceo` — CEO-агент
- `GET /api/cron/agent-revenue` — агент выручки
- `GET /api/cron/agent-production` — агент производства
- `GET /api/cron/agent-catalog` — агент каталога

**Таблицы БД:**
- `calculations` — анализ расчётов
- `orders` — анализ заказов
- `users` — состав команды
- `glass_price_matrix` — анализ цен
- `b2b_quotes` — B2B воронка
- `agent_memory` — память агентов

**Роли:** admin, ceo (доступ к AI Control Center)

**Входные данные:** Перспектива анализа (owner/sales/operations/pricing), снимок health-check

**Выходные данные:** AI-рекомендации с приоритетом (critical/high/medium/low), план внедрения

**Что уже реализовано:**
- Страница с 6 вкладками
- POST `/api/admin/ai-control-center/analyze` с анализом через Claude
- Анализ расчётов с разбивкой по материалам
- Система рекомендаций с трекингом статуса (localStorage: `mglass_ai_recommendations`)
- AI-агенты (5 видов, cron)
- Интеграция health-check данных в анализ

**Что нужно доработать:**
- Хранение рекомендаций в БД (сейчас localStorage)
- Внедрение рекомендаций через AI (auto-apply)
- Сравнение метрик за разные периоды

**Риски:**
- Анализ требует `ANTHROPIC_API_KEY` — без него не работает
- Рекомендации хранятся в localStorage — теряются при смене устройства/браузера

**Тесты:**
- Integration: POST `/api/admin/ai-control-center/analyze` возвращает рекомендации
- Smoke: все 6 вкладок рендерятся

**Связи:** Health Check Skill (данные о состоянии), Calculation Skill (анализ расчётов), CEO Analytics Skill (данные выручки)

---

## Skill 11: User & Access Skill (Навык управления доступом)

**Назначение:** Управлять пользователями, ролями, тонкими правами и видимостью разделов.

**Модули и страницы:**
- `/admin/users` — список пользователей
- `/admin/org` — оргструктура
- `/admin/org/[roleId]` — карточка роли с функциями и KPI
- `/admin/org/[roleId]/print` — печать регламента роли

**API маршруты:**
- `GET/POST /api/admin/users` — пользователи
- `POST /api/admin/invite` — пригласить пользователя
- `GET/POST /api/admin/role-assignments` — назначение ролей
- `PATCH/DELETE /api/admin/role-assignments/[id]` — редактирование
- `POST /api/admin/seed-managers` — тестовые менеджеры
- `POST /api/auth/setup-org` — начальная настройка

**Таблицы БД:**
- `users` — `id, role, permissions (JSON), manager_code, can_delete, max_discount_percent`

**Роли:** admin (полный), ceo (чтение + приглашение)

**Входные данные:** Email, роль, permissions JSON, manager_code

**Выходные данные:** Пользователь с настроенной ролью и правами

**Что уже реализовано:**
- `getRole()` и `getUserProfile()` в `lib/getRole.ts`
- `canAccess()` — проверка доступа к пути
- Middleware.ts — SSR-защита маршрутов
- Тонкие права `UserPermissions` (see_mglass, see_b2b, see_calendar, see_clients, see_earnings)
- Страница `/admin/users` с управлением пользователями
- Оргструктура с карточками ролей

**Что нужно доработать:**
- UI управления `permissions` JSON в форме пользователя
- Row Level Security в Supabase (сейчас роли только на уровне приложения)
- Аудит-лог изменений прав

**Риски:**
- Проверка роли в middleware делает запрос к БД на каждом SSR-запросе — нагрузка
- Нет RLS — admin может видеть данные других пользователей напрямую через API

**Тесты:**
- Unit: `canAccess('manager', '/admin/dashboard')` → false
- Integration: middleware перенаправляет неавторизованного на /login
- Integration: пользователь без роли получает /access-denied

**Связи:** все Skills (права влияют на всё)

---

## Skill 12: Integration Skill (Навык интеграций)

**Назначение:** Обеспечить бесшовную связь с внешними системами: AmoCRM, Wazzup, Telegram, Google Sheets.

**Модули и страницы:**
- `/admin/integrations` — мониторинг интеграций (Avito, AMO)
- `/admin/data-hub` — центр данных (импорт из Google Sheets)
- `/vladislav` — Telegram-бот (Vladislav AI)
- `/amo-analysis` — анализ воронки AMO

**API маршруты:**
- `POST /api/telegram/webhook` — Telegram-бот с AI, меню, расчётами
- `POST /api/amo/webhook` — AmoCRM webhook (новые лиды, статусы)
- `GET /api/amo/calls` — звонки
- `POST /api/amo/calls/transcribe` — транскрипция звонков
- `POST /api/amo/calls/analyze` — анализ звонков
- `POST /api/wazzup/webhook` — WhatsApp webhook
- `POST /api/admin/data-hub/sheets` — читать Google Sheet
- `POST /api/admin/data-hub/import` — импортировать данные
- `GET /api/admin/data-hub/logs` — логи импорта
- `POST /api/admin/integrations` — настройки интеграций
- `POST /api/admin/integrations/backfill` — обратное заполнение
- `GET /api/integrations/avito/health` — проверка Avito

**Таблицы БД:**
- `telegram_sessions` — сессии бота
- `amo_leads` — лиды из AMO (если синхронизируются)
- `activity_log` — лог действий

**Роли:** admin (настройка), ceo (мониторинг), seo (анализ AMO)

**Входные данные:** Webhooks от AMO/Telegram/Wazzup, URL Google Sheets

**Выходные данные:** Лиды в системе, уведомления, транскрипции, импорт данных

**Что уже реализовано:**
- Telegram-бот с Claude AI, меню навигации, быстрыми расчётами
- AmoCRM webhook: новые лиды → Wazzup-сообщение клиенту
- Round-robin распределение лидов между менеджерами
- Wazzup-интеграция (WhatsApp)
- Импорт из Google Sheets (CSV через публичную ссылку)
- Транскрипция и анализ звонков

**Что нужно доработать:**
- OAuth для Google Sheets (сейчас только публичные таблицы)
- Avito-интеграция (health check есть, но полная интеграция не готова)
- Двухсторонняя синхронизация заказов с AMO

**Риски:**
- Telegram-бот и AMO webhook — если ключи не настроены, падают молча
- AmoCRM webhook не проверяет подпись запроса — риск фейковых данных
- Google Sheets импорт работает только для публично доступных таблиц

**Тесты:**
- Integration: POST /api/telegram/webhook с тестовым обновлением
- Smoke: /api/integrations/avito/health возвращает статус
- Security: AMO webhook отклоняет неподписанные запросы

**Связи:** Measurement Skill (Telegram-уведомления), B2B Skill (AMO-лиды), AI Control Center Skill (агенты)

---

## Skill 13: Content Skill (Навык контента)

**Назначение:** Управлять контент-планом, генерировать материалы для социальных сетей, хранить медиабиблиотеку.

**Модули и страницы:**
- `/marketing` — Marketing Center
- `/marketing/content` — контент-план
- `/marketing/video-factory` — AI Video Factory
- `/marketing/media-library` — медиабиблиотека
- `/marketing/daily` — дневной план AI
- `/marketing/partners` — партнёры
- `/marketing/promos` — акции
- `/marketing/tasks` — задачи маркетинга
- `/marketing/ai` — AI-маркетолог
- `/admin/shower-images` — изображения душевых

**API маршруты:**
- `GET/POST /api/marketing/content` — контент-план
- `GET/POST /api/marketing/daily` — дневной план
- `GET/POST /api/marketing/media` — медиа
- `GET/POST /api/marketing/partners` — партнёры
- `GET/POST /api/marketing/promos` — акции
- `GET/POST /api/marketing/scripts` — скрипты
- `GET/POST /api/marketing/tasks` — задачи
- `GET/POST /api/marketing/videos` — видео
- `POST /api/ai/content-generate` — генерация контента
- `POST /api/ai/marketing-chat` — AI-маркетолог
- `GET/POST /api/admin/influencers` — инфлюенсеры
- `GET/POST /api/admin/shower-images` — медиабиблиотека

**Таблицы БД:**
- `marketing_content` — контент-план
- `marketing_tasks` — задачи
- `marketing_partners` — партнёры
- `marketing_promos` — акции
- `marketing_videos` — видео
- `shower_images` — изображения душевых

**Роли:** seo (полный доступ), ceo (просмотр/управление), admin (всё)

**Входные данные:** Тема, продукт, тон, платформа (Instagram/Telegram/VK)

**Выходные данные:** Тексты постов, скрипты Reels, контент-план, AI-генерированный контент

**Что уже реализовано:**
- Полная структура страниц маркетинга
- AI-маркетолог (`lib/marketingManagerPrompt.ts`)
- Генерация контента через Claude
- Медиабиблиотека изображений душевых

**Что нужно доработать:**
- Публикация контента напрямую в соцсети
- Автоматический постинг по расписанию
- Аналитика контента (охваты, лайки)

**Риски:**
- AI-генерация контента требует `ANTHROPIC_API_KEY`
- Нет модерации перед публикацией — риск публикации неудачного контента

**Тесты:**
- Smoke: все страницы маркетинга рендерятся
- Integration: POST /api/ai/content-generate возвращает текст

**Связи:** Integration Skill (Telegram-публикации), CEO Analytics Skill (ROI маркетинга)

---

## Skill 14: CEO Analytics Skill (Навык аналитики для CEO)

**Назначение:** Предоставлять владельцу полную картину бизнеса: KPI, выручку, P&L, маржинальность, прогнозы.

**Модули и страницы:**
- `/admin/dashboard` — дашборд (выручка, маржа, менеджеры)
- `/admin/pnl` — P&L отчёт
- `/admin/analytics-mglass` — расширенная аналитика
- `/admin/owner` — Owner Center
- `/admin/bonus-center` — бонусный центр менеджеров
- `/admin/sales-center` — Sales Center
- `/admin/b2b-development` — B2B Development
- `/b2b-analytics` — B2B аналитика
- `/ai-stats` — статистика AI-бота
- `/amo-analysis` — воронка AMO

**API маршруты:**
- `GET /api/cbr-rate` — курс ЦБ (для P&L)
- `GET /api/amo/analyze` — анализ AMO
- `GET /api/amo/manager-stats` — статистика менеджеров
- `GET /api/admin/owner-strategy` — стратегия владельца
- `POST /api/admin/owner-strategy` — обновить стратегию
- `POST /api/admin/sales-bonuses` — бонусы менеджеров
- `GET /api/admin/sales-feedback` — обратная связь
- `GET /api/admin/sales-scripts` — скрипты продаж
- `GET /api/admin/sales-followups` — follow-up задачи
- `GET /api/cron/anomalies` — детекция аномалий
- `GET /api/cron/agent-ceo` — CEO-агент
- `GET /api/cron/agent-revenue` — агент выручки

**Таблицы БД:**
- `calculations` — выручка, маржа
- `orders` — заказы, статусы, оплата
- `users` — менеджеры
- `b2b_quotes`, `b2b_orders` — B2B воронка
- `owner_strategy` — стратегические цели
- `agent_memory` — память CEO-агента

**Роли:** ceo (полный), admin (полный), seo (только аналитика/маркетинг)

**Входные данные:** Период, фильтры по менеджеру/продукту

**Выходные данные:** KPI-дашборд, P&L, сравнение периодов, топ-менеджеры, прогнозы

**Что уже реализовано:**
- Dashboard: выручка сегодня/месяц vs прошлый, активные/завершённые заказы, средняя маржа, долг
- Топ-менеджеры по выручке и количеству
- AI-агент CEO с cron
- Стратегия владельца (owner_strategy)
- Бонусный центр с комиссионными тирами (`lib/commissionTiers.ts`)

**Что нужно доработать:**
- P&L с реальной разбивкой по статьям расходов
- Cash flow прогноз
- Сравнение план/факт

**Риски:**
- Dashboard читает данные напрямую из `calculations` без кеша — при большом объёме медленно
- P&L зависит от `NEXT_PUBLIC_CBR_KEY` для курса валют

**Тесты:**
- Integration: dashboard загружает данные за текущий месяц
- Smoke: все CEO-страницы рендерятся без ошибок

**Связи:** Order Management Skill (данные заказов), Calculation Skill (маржа), Integration Skill (AMO-данные)
