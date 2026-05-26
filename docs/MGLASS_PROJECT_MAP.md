# MGlass Project Map — Карта проекта

> Актуальна на: 2026-05-25  
> Стек: Next.js 13+ App Router · Supabase · Tailwind CSS · Anthropic Claude · Vercel  
> Язык: TypeScript

---

## 1. Что такое MGlass

MGlass — производственная компания (стёкла, зеркала с подсветкой, душевые перегородки, лофт-перегородки). Система включает:
- B2C-калькуляторы (зеркало, душевая, лофт) → расчёты → заказы → производство → доставка
- B2B-калькулятор → просчёты → заказы → раскрой → производство B2B
- Управление закупками, складом, поставщиками
- CRM через AmoCRM + Wazzup (WhatsApp)
- Telegram-бот (Vladislav AI) с AI-агентами
- CEO-аналитика, маркетинг, контент

---

## 2. Роли и права доступа

| Роль | Описание | Доступ |
|------|----------|--------|
| `admin` | Полный доступ ко всему | Все страницы |
| `manager` | Менеджер по продажам | Калькуляторы, расчёты, заказы, клиенты, B2B калькулятор/просчёты |
| `production` | Производство | Производственный дашборд, B2B пайплайн, производство B2B, раскрой |
| `seo` | Маркетинг/SEO | Маркетинг-центр, аналитика, AI-инструменты, статистика |
| `ceo` | Владелец/директор | Owner Center, P&L, аналитика, AI Control Center, пользователи |
| `buyer` | Закупщик/логист | Склад, закупки, поставщики, справочники цен, маршруты |

### Тонкие права (UserPermissions)
- `see_mglass` — видеть раздел MGlass (B2C)
- `see_b2b` — видеть раздел B2B
- `see_calendar` — видеть календарь замеров
- `see_clients` — видеть клиентскую базу
- `see_earnings` — видеть свои заработки

---

## 3. Все страницы и пути

### Калькуляторы (manager, admin)
| Путь | Страница | Файл |
|------|----------|------|
| `/calculator/mirror` | Калькулятор зеркал | `app/calculator/mirror/page.tsx` |
| `/calculator/shower` | Калькулятор душевых | `app/calculator/shower/page.tsx` |
| `/calculator/loft` | Калькулятор лофт-перегородок | `app/calculator/loft/page.tsx` |
| `/calculator/b2b` | B2B калькулятор стекла | `app/calculator/b2b/page.tsx` |

### Расчёты и заказы (manager, admin)
| Путь | Страница | Файл |
|------|----------|------|
| `/calculations` | История расчётов | `app/calculations/page.tsx` |
| `/calculations/[id]` | Детальный просмотр расчёта | `app/calculations/[id]/page.tsx` |
| `/calculations/[id]/print` | Печать КП | `app/calculations/[id]/print/page.tsx` |
| `/calculations/order/[groupId]/print` | Печать группы | `app/calculations/order/[groupId]/print/page.tsx` |
| `/orders` | Список заказов | `app/orders/page.tsx` |
| `/orders/[id]` | Детальный заказ | `app/orders/[id]/page.tsx` |
| `/orders/[id]/print` | Печать заказа | `app/orders/[id]/print/page.tsx` |
| `/orders/[id]/act` | Акт выполненных работ | `app/orders/[id]/act/page.tsx` |
| `/orders/[id]/spec` | Спецификация | `app/orders/[id]/spec/page.tsx` |
| `/cart/print` | Печать корзины | `app/cart/print/page.tsx` |

### B2B (manager, production, admin)
| Путь | Страница | Файл |
|------|----------|------|
| `/b2b-quotes` | B2B просчёты | `app/b2b-quotes/page.tsx` |
| `/b2b-quotes/[id]/kp` | КП для B2B | `app/b2b-quotes/[id]/kp/page.tsx` |
| `/b2b-orders` | B2B заказы | `app/b2b-orders/page.tsx` |
| `/b2b-crm` | B2B клиенты (CRM) | `app/b2b-crm/page.tsx` |
| `/b2b-crm/[id]` | Карточка B2B клиента | `app/b2b-crm/[id]/page.tsx` |
| `/b2b-cutting` | Раскрой стекла | `app/b2b-cutting/page.tsx` |
| `/b2b-pipeline` | Воронка продаж B2B | `app/b2b-pipeline/page.tsx` |
| `/b2b-production` | Производство B2B | `app/b2b-production/page.tsx` |
| `/b2b-analytics` | Аналитика B2B | `app/b2b-analytics/page.tsx` |

### CRM и клиенты
| Путь | Страница | Файл |
|------|----------|------|
| `/clients` | Клиентская база | `app/clients/page.tsx` |
| `/clients/[phone]` | Карточка клиента | `app/clients/[phone]/page.tsx` |
| `/calendar` | Календарь замеров | `app/calendar/page.tsx` |
| `/measurer` | Форма замера | `app/measurer/page.tsx` |

### Производство
| Путь | Страница | Файл |
|------|----------|------|
| `/production` | Производственный план | `app/production/page.tsx` |
| `/manager-dashboard` | Дашборд менеджера | `app/manager-dashboard/page.tsx` |

### Маркетинг (seo, ceo, admin)
| Путь | Страница | Файл |
|------|----------|------|
| `/marketing` | Marketing Center | `app/marketing/page.tsx` |
| `/marketing/content` | Контент-план | `app/marketing/content/page.tsx` |
| `/marketing/video-factory` | AI Video Factory | `app/marketing/video-factory/page.tsx` |
| `/marketing/media-library` | Медиабиблиотека | `app/marketing/media-library/page.tsx` |
| `/marketing/daily` | Дневной план AI | `app/marketing/daily/page.tsx` |
| `/marketing/partners` | Партнёры | `app/marketing/partners/page.tsx` |
| `/marketing/promos` | Акции | `app/marketing/promos/page.tsx` |
| `/marketing/tasks` | Задачи | `app/marketing/tasks/page.tsx` |
| `/marketing/ai` | AI-маркетолог | `app/marketing/ai/page.tsx` |

### AI-инструменты (seo, ceo, admin)
| Путь | Страница | Файл |
|------|----------|------|
| `/ai-assistant` | AI Ассистент | `app/ai-assistant/page.tsx` |
| `/ai-sales` | AI Продажи | `app/ai-sales/page.tsx` |
| `/ai-stats` | Статистика AI | `app/ai-stats/page.tsx` |
| `/amo-analysis` | Анализ воронки AMO | `app/amo-analysis/page.tsx` |
| `/kp-generator` | Генератор КП | `app/kp-generator/page.tsx` |
| `/vladislav` | Vladislav AI (бот) | `app/vladislav/page.tsx` |
| `/vladislav/calls` | Анализ звонков | `app/vladislav/calls/page.tsx` |
| `/vladislav/manager-stats` | Аналитика менеджеров | `app/vladislav/manager-stats/page.tsx` |
| `/vladislav/tasks` | Задачи AI | `app/vladislav/tasks/page.tsx` |

### CEO/Владелец (ceo, admin)
| Путь | Страница | Файл |
|------|----------|------|
| `/admin/owner` | Owner Center | `app/admin/owner/page.tsx` |
| `/admin/dashboard` | Дашборд (выручка, заказы) | `app/admin/dashboard/page.tsx` |
| `/admin/pnl` | P&L отчёт | `app/admin/pnl/page.tsx` |
| `/admin/analytics-mglass` | Расширенная аналитика | `app/admin/analytics-mglass/page.tsx` |
| `/admin/bonus-center` | Бонусный центр | `app/admin/bonus-center/page.tsx` |
| `/admin/sales-center` | Sales Center | `app/admin/sales-center/page.tsx` |
| `/admin/b2b-development` | B2B Development | `app/admin/b2b-development/page.tsx` |
| `/admin/org` | Оргструктура | `app/admin/org/page.tsx` |
| `/admin/org/[roleId]` | Карточка роли | `app/admin/org/[roleId]/page.tsx` |
| `/admin/users` | Пользователи | `app/admin/users/page.tsx` |
| `/admin/ai-control-center` | AI Control Center | `app/admin/ai-control-center/page.tsx` |
| `/admin/health-check` | Health Check | `app/admin/health-check/page.tsx` |

### Справочники (admin, buyer)
| Путь | Страница | Таблица БД |
|------|----------|------------|
| `/admin/glass-prices` | Матрица цен стекла/зеркал | `glass_price_matrix`, `pricing_formula_params` |
| `/admin/facet` | Цены на фацет | `facet_prices` |
| `/admin/mirror-lighting` | Компоненты подсветки | `mirror_lighting_components` |
| `/admin/mirror-frames` | Рамки для зеркал | `mirror_frames` |
| `/admin/shower-hardware` | Фурнитура душевых | `shower_hardware_items` |
| `/admin/hardware` | Фурнитура лофт | `hardware_items` |
| `/admin/materials` | Материалы | `materials` |
| `/admin/services` | Услуги | `services` |
| `/admin/settings` | Финансовые настройки | `financial_settings` |
| `/admin/waste-modifiers` | Коэффициенты отхода | `material_waste_modifiers` |

### Закупки и склад (admin, buyer)
| Путь | Страница | Таблица БД |
|------|----------|------------|
| `/admin/suppliers` | Поставщики | `suppliers` |
| `/admin/suppliers/eleganz` | Прайс Eleganz | `suppliers`, `b2b_materials` |
| `/admin/procurement` | Канбан закупок | `purchase_orders` |
| `/admin/stock-control` | Критические остатки | `materials` (stock_qty, min_stock_qty) |
| `/admin/warehouse` | Склад | `materials` |
| `/admin/cutting-settings` | Настройки раскроя | `cutting_settings` |

### Логистика (admin, buyer)
| Путь | Страница | Таблица БД |
|------|----------|------------|
| `/admin/route-sheet` | Маршрутный лист | `orders`, `b2b_orders` |
| `/admin/procurement-routes` | Маршруты к поставщикам | `procurement_routes`, `procurement_route_stops` |
| `/admin/delivery-zones` | Зоны доставки | `delivery_zones` |
| `/admin/brigades` | Бригады монтажников | `brigades` |

### B2B справочники (admin)
| Путь | Страница | Таблица БД |
|------|----------|------------|
| `/admin/b2b-clients` | B2B клиенты (справочник) | `b2b_clients` |
| `/admin/b2b-services` | B2B услуги | `b2b_services` |
| `/admin/b2b-materials` | B2B материалы | `b2b_materials` |
| `/admin/archive` | Архив расчётов | `b2b_quotes` |

### Система (admin)
| Путь | Страница | Описание |
|------|----------|----------|
| `/admin/data-hub` | Центр данных | Импорт из Google Sheets |
| `/admin/integrations` | Мониторинг интеграций | Avito, AMO |
| `/admin/infrastructure` | Техцентр | Cron, переменные окружения |
| `/admin/architecture` | Карта данных | Визуализация схемы БД |
| `/admin/roadmap` | Roadmap | Дорожная карта |
| `/admin/pricing-manual` | Pricing Manual | Руководство по ценообразованию |
| `/admin/owner-questionnaire` | Стратегия | Опрос стратегии владельца |
| `/admin/guide` | Регламент | Инструкции для закупщика |
| `/admin/shower-images` | Media Library | Изображения душевых |
| `/admin/agents` | AI-агенты | Управление AI-агентами |

---

## 4. Все сущности (типы данных)

### Calculation (расчёт)
Таблица: `calculations`  
Поля: `id, created_at, created_by, product_type, input_data (JSON), cost_breakdown (JSON), financial_breakdown (JSON), base_price, discount, partner_percent, final_price, margin, profit, status, client_text, notes, client_name, client_phone, order_group_id, parent_calc_id, amo_lead_id`  
Статусы: `draft → sent → thinking → approved → measurement → in_work → production → install → done → launched → rejected → archive`

### Order (заказ)
Таблица: `orders`  
Поля: `id (UUID), number, custom_number, amo_deal_id/url, client_name/phone, object_address, manager_id, order_type, total_sale/cost_price, gross_profit, margin_percent, margin_status, status, approved_by/at, payment_status, prepayment_amount, delivery_zone_id, brigade_id`  
Статусы: `draft → pending_approval → approved → in_work → completed → cancelled`

### OrderLine (позиция заказа)
Таблица: `order_lines`  
Поля: `id, order_id, position_num, product_type/name, dimensions_text, quantity, unit_cost/sale_price, discount_percent, margin, input_snapshot, cost_snapshot, materials_bom, hardware_bom, services_bom, calculation_id`

### Material (материал)
Таблица: `materials`  
Поля: `id, name, short_name, category, unit, cost_price, sale_price, has_vat, vat_rate, active, in_stock, stock_qty, min_stock_qty`  
Категории: `зеркало, стекло, подсветка, профиль, электрика, расходники, работа, услуга, фурнитура`

### B2BMaterial (стекло/зеркало для B2B)
Таблица: `b2b_materials`  
Поля: `id, name, category, thickness, cost_price, sale_price, vat_rate, waste_percent, passthrough, sheet_width (3210), sheet_height (2250), pattern_direction, supplier_id`  
Категории: `стекло, зеркало, тонированное, сатин, рифленое, декоративное`

### B2BClient (B2B клиент)
Таблица: `b2b_clients`  
Поля: `id, name, contact, phone, discount_percent, active, manager_id, manager_code, crm_segment, crm_status, crm_score, crm_city, crm_manager, crm_next_contact`  
Сегменты: `designer, furniture, construction, aluminum, glass_company, office, other`  
Статусы CRM: `new → contacted → active → sleeping → lost`  
Оценки: `A, B, C`

### B2BQuote (B2B просчёт)
Таблица: `b2b_quotes`  
Связи: `b2b_clients`, `calculations`

### B2BOrder (B2B заказ)
Таблица: `b2b_orders`  
Поля: `id, client_id, client_name, discount_percent, items (JSON), total_area, total_weight, total_sale_inc_vat, total_after_discount`

### MirrorFrame (рамка зеркала)
Таблица: `mirror_frames`  
Поля: `id, article, name, supplier, frame_type, color, profile_size, whip_length_m, cost_per_m, sale_per_m, waste_factor, cut_minutes, assemble_minutes, pack_minutes`

### Supplier (поставщик)
Таблица: `suppliers`  
Поля: `id, name, contact, phone, city, is_active, discount_percent, notes`

### FinancialSettings (финансовые настройки)
Таблица: `financial_settings`  
Поля: `tier (standard/budget), product_type, tax_percent, manager_percent, realization_percent, marketing_percent, transport_percent, operation_percent, default_margin, min_margin, green_threshold, yellow_threshold, blocked_below, max_discount_percent, sla_days_*`

### GlassMatrixRow (матрица цен стекла)
Таблица: `glass_price_matrix`  
Поля: `name, price_type (cost/sale), category (glass/mirror), waste_pct, t4, t5, t6, t8, t10, t12, supplier_id`

### HardwareItem / ShowerHardwareItem
Таблицы: `hardware_items`, `shower_hardware_items`

### FacetPrice
Таблица: `facet_prices`  
Поля: `id, type_mm (10/15/20), cost_price, transport_cost, sale_price`

### DeliveryZone / Brigade
Таблицы: `delivery_zones`, `brigades`

### PurchaseOrder (заявка на закупку)
Таблица: `purchase_orders`

### ProcurementRoute / Stop
Таблицы: `procurement_routes`, `procurement_route_stops`

### Measurement (запись на замер)
Таблица: `measurements`

### TelegramSession
Таблица: `telegram_sessions`

---

## 5. Архитектура расчётов

### Калькулятор зеркал (`lib/mirrorCalculator.ts`)
Входные данные:
- Размеры (ширина × высота), форма (`rectangle/circle/oval/complex`)
- Материал зеркала из `glass_price_matrix` (категория `mirror`)
- Подсветка: компоненты из `mirror_lighting_components`
- Рамка из `mirror_frames`
- Фацет из `facet_prices`
- Кнопки, пескоструй, подложка, монтаж, доставка
- Наценка, скидка, партнёрский %

Источники цен:
- Стекло/зеркало: `glass_price_matrix` (sale) → `lib/glassMatrix.ts`
- Отходы: `material_waste_modifiers` → `getShapeModifier()`
- Подсветка: `mirror_lighting_components`
- Рамка: `mirror_frames` + формула `calcFrameCost()`
- Фацет: `facet_prices`
- Финансы: `financial_settings`

### Калькулятор лофт (`lib/loftCalculator.ts`)
- Стекло из `glass_price_matrix` (glass, sale)
- Фурнитура из `hardware_items`
- Услуги из `services`

### Калькулятор душевых (`lib/showerCalculator.ts`)
- 12 моделей (M1–M12), 2 тира (budget/standard)
- Фурнитура из `shower_hardware_items`
- Стекло из `glass_price_matrix`

### B2B калькулятор (`lib/b2bCalculator.ts`)
- Материалы из `b2b_materials`
- Услуги из `b2b_services`
- НДС 22%, закалка по толщине (`TEMPERING_COST`)
- Раскрой: `lib/cuttingOptimizer.ts` (2D guillotine, best short-side fit)
- Раскрой: листы 3210×2250 (default), до 50% отход для рифлёного

---

## 6. Справочники и что они контролируют

| Справочник | Таблица | Что контролирует |
|------------|---------|-----------------|
| Матрица цен стекла | `glass_price_matrix` | Цену стекла/зеркала в калькуляторах зеркал, лофт и B2B |
| Коэффициенты отхода | `material_waste_modifiers` | Доп. % отхода по форме изделия |
| Подсветка | `mirror_lighting_components` | Стоимость LED-ленты, блока питания, диффузора в зеркальном калькуляторе |
| Рамки | `mirror_frames` | Стоимость декоративных рамок + трудоёмкость сборки |
| Фацет | `facet_prices` | Стоимость фацета ₽/м.п. в зеркальном и B2B калькуляторах |
| Фурнитура душевых | `shower_hardware_items` | Комплекты фурнитуры для душевых (budget matrix, standard catalog) |
| Фурнитура лофт | `hardware_items` | Системы sliding/swing/universal |
| Материалы | `materials` | Расходники, электрика, профиль (склад + себестоимость) |
| Услуги | `services` | Монтаж, доставка, пескоструй (₽/м²) |
| B2B материалы | `b2b_materials` | Список позиций стекла для B2B калькулятора |
| B2B услуги | `b2b_services` | Услуги для B2B (закалка, кромка, плёнка, расчётные) |
| Финансовые настройки | `financial_settings` | % расходов, маржа по умолчанию/минимум, блокировка |
| Формульные параметры | `pricing_formula_params` | Параметры расчётных услуг (section: glass/mirror/b2b) |
| Настройки раскроя | `cutting_settings` | Зазор между деталями, отступ от края листа |

---

## 7. API маршруты

### Admin API (`/api/admin/`)
- `glass-prices` — матрица цен (GET/POST/DELETE)
- `suppliers` — поставщики (CRUD)
- `suppliers/[id]` — один поставщик
- `materials/upload` — загрузка прайса поставщика
- `materials/from-supplier` — перенос цен из прайса
- `materials/transfer` — перенос материалов между таблицами
- `mirror-lighting` — компоненты подсветки
- `mirror-lighting/tabs` — вкладки компонентов
- `warehouse` — остатки на складе
- `procurement-routes` — маршруты к поставщикам
- `purchase-orders` — канбан закупок
- `waste-modifiers` — коэффициенты отхода
- `users` — управление пользователями
- `role-assignments/[id]` — назначение ролей
- `settings` — финансовые настройки
- `health-check/fix` — авто-исправления (admin/ceo only)
- `ai-control-center/analyze` — AI-анализ системы
- `data-hub/sheets` — импорт из Google Sheets
- `data-hub/import` — импорт данных
- `brigades` / `brigades/[id]` — бригады
- `delivery-zones` / `delivery-zones/[id]` — зоны доставки
- `sync-b2b-materials` — синхронизация B2B-материалов
- `b2b-leads`, `b2b-outreach`, `b2b-seed` — B2B лиды

### Orders API (`/api/orders/`)
- `POST /api/orders` — создать заказ
- `GET/PATCH /api/orders/[id]/status` — изменить статус
- `POST /api/orders/[id]/approve` — одобрить заказ (admin)
- `PATCH /api/orders/[id]/payment` — обновить оплату
- `PATCH /api/orders/[id]/delivery` — назначить доставку
- `PATCH /api/orders/[id]/brigade` — назначить бригаду
- `POST /api/orders/[id]/photos` — фото выполненных работ
- `GET /api/orders/production` — производственный список

### AI API (`/api/ai/`)
- `ask` — общий чат
- `chat` — основной AI-чат
- `generate-kp` — генерация КП
- `suggest-price` — предложить цену
- `analyze-client` — анализ клиента
- `b2b-message` — AI-сообщение для B2B
- `b2b-prospect` — поиск B2B-клиентов
- `b2b-score` — оценка B2B-лида
- `content-generate` — генерация контента
- `marketing-chat` — AI-маркетолог
- `personalize-template` — персонализация шаблона

### Интеграции
- `POST /api/telegram/webhook` — Telegram-бот (Vladislav)
- `POST /api/amo/webhook` — AmoCRM webhook
- `GET /api/amo/calls` — звонки из AMO
- `POST /api/wazzup/webhook` — WhatsApp webhook
- `POST /api/measurer` — форма замера
- `GET /api/cbr-rate` — курс ЦБ

### Cron-задачи (`/api/cron/`)
- `health` — проверка здоровья системы
- `stock` — проверка критических остатков
- `followup` — follow-up напоминания
- `backup` — резервное копирование
- `sla` — мониторинг SLA
- `agent-analyst`, `agent-ceo`, `agent-revenue`, `agent-production`, `agent-catalog` — AI-агенты

---

## 8. Зависимости между модулями

```
glass_price_matrix
  → mirrorCalculator.ts (зеркала B2C)
  → loftCalculator.ts (лофт B2C)
  → b2b_materials (синхронизация через health-check)
  → B2B калькулятор

b2b_materials
  → b2bCalculator.ts
  → cuttingOptimizer.ts
  → b2b_quotes (просчёты)
  → b2b_orders (заказы)

calculations
  → orders (через CartContext + LaunchOrderModal)
  → b2b_quotes

financial_settings
  → mirrorCalculator (маржа, расходы)
  → loftCalculator
  → showerCalculator
  → orders (margin_status, pending_approval)

suppliers
  → b2b_materials (supplier_id)
  → glass_price_matrix (supplier_id)
  → purchase_orders

Telegram webhook
  → quickCalc
  → calculations
  → orders (статусы)

AmoCRM webhook
  → b2b_clients (crm данные)
  → Wazzup (WhatsApp-сообщения)
```

---

## 9. Технические файлы и утилиты

| Файл | Назначение |
|------|-----------|
| `lib/getRole.ts` | Получение роли и профиля пользователя; ROLE_ALLOWED — маршруты по ролям |
| `lib/types.ts` | Все типы: Material, Service, Calculation, Order, B2BClient и др. |
| `lib/permissions.ts` | UserPermissions — тонкие права видимости |
| `lib/saveCalculation.ts` | Сохранение/обновление расчёта в `calculations` |
| `lib/mirrorCalculator.ts` | Движок калькулятора зеркал |
| `lib/loftCalculator.ts` | Движок калькулятора лофт |
| `lib/showerCalculator.ts` | Движок калькулятора душевых |
| `lib/b2bCalculator.ts` | Движок B2B калькулятора |
| `lib/glassMatrix.ts` | Загрузка матрицы цен из `glass_price_matrix` |
| `lib/cuttingOptimizer.ts` | 2D-оптимизация раскроя (guillotine BSSF) |
| `lib/healthCheckRunner.ts` | Запуск проверок + маппинг результатов |
| `lib/CartContext.tsx` | Корзина расчётов (React Context) |
| `lib/notify.ts` | Email-уведомление при низкой марже (Resend API) |
| `lib/telegram.ts` | Отправка сообщений через Telegram Bot API |
| `lib/wazzup.ts` | Отправка через Wazzup (WhatsApp) |
| `lib/activityLog.ts` | Лог действий пользователей |
| `lib/agentMemory.ts` | Память AI-агентов |
| `lib/commissionTiers.ts` | Ступени комиссий менеджеров |
| `middleware.ts` | Проверка доступа по ролям (canAccess) |

---

## 10. Где хранятся данные (Supabase-таблицы)

| Таблица | Модуль |
|---------|--------|
| `users` | Пользователи + роли + permissions |
| `calculations` | Расчёты (B2C) |
| `orders` | Заказы |
| `order_lines` | Позиции заказов |
| `b2b_quotes` | B2B просчёты |
| `b2b_orders` | B2B заказы |
| `b2b_clients` | B2B клиенты |
| `b2b_interactions` | Взаимодействия с B2B клиентами |
| `b2b_materials` | Материалы для B2B калькулятора |
| `b2b_services` | Услуги для B2B |
| `b2b_films` | Плёнки для B2B |
| `glass_price_matrix` | Матрица цен стекла/зеркал |
| `pricing_formula_params` | Параметры формул расчётных услуг |
| `material_waste_modifiers` | Коэффициенты отхода |
| `materials` | Материалы склада |
| `services` | Услуги (монтаж, доставка) |
| `mirror_frames` | Рамки зеркал |
| `mirror_lighting_components` | Компоненты подсветки |
| `facet_prices` | Цены фацета |
| `hardware_items` | Фурнитура лофт |
| `shower_hardware_items` | Фурнитура душевых |
| `suppliers` | Поставщики |
| `purchase_orders` | Заявки на закупку |
| `financial_settings` | Финансовые настройки |
| `delivery_zones` | Зоны доставки |
| `brigades` | Бригады |
| `procurement_routes` | Маршруты к поставщикам |
| `procurement_route_stops` | Остановки маршрутов |
| `measurements` | Заявки на замер |
| `telegram_sessions` | Сессии Telegram-бота |
| `cutting_settings` | Настройки раскроя |
| `activity_log` | Лог действий |
| `agent_memory` | Память AI-агентов |
| `owner_strategy` | Стратегия владельца |
