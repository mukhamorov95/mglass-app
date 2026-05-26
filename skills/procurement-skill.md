# Procurement Skill — Навык закупок

## Назначение
Управлять закупками MGlass: справочник поставщиков, канбан заявок на закупку, контроль критических остатков склада, обновление цен из прайс-листов. Обеспечивает Pricing Skill актуальными закупочными ценами.

## Модули и страницы
- `/admin/suppliers` — справочник поставщиков (CRUD, архивирование, скидки)
- `/admin/suppliers/eleganz` — специальный прайс поставщика Eleganz
- `/admin/procurement` — канбан заявок на закупку (5 колонок)
- `/admin/stock-control` — критические остатки (stock_qty < min_stock_qty)
- `/admin/materials` — справочник материалов (цена, остаток, мин. запас)
- `/admin/guide` — регламент закупщика

## API маршруты
- `GET/POST /api/admin/suppliers` — список/создание поставщиков (write: admin, buyer)
- `PATCH/DELETE /api/admin/suppliers/[id]` — редактирование/удаление поставщика
- `GET/PATCH /api/admin/warehouse` — остатки склада
- `GET/POST/PATCH /api/admin/purchase-orders` — заявки на закупку (канбан)
- `POST /api/admin/materials/from-supplier` — перенос цен из прайса в materials
- `POST /api/admin/materials/transfer` — перемещение материалов между складами
- `POST /api/admin/materials/upload` — загрузка прайса (PDF/Excel)
- `GET /api/cron/stock` — автопроверка критических остатков + Telegram-алерт

## Таблицы БД
| Таблица | Роль |
|---------|------|
| `suppliers` | Поставщики: name, contact, phone, discount_pct, is_active, notes |
| `purchase_orders` | Заявки на закупку: supplier_id, items (JSON), status (kanban-колонка), total, created_by |
| `materials` | Материалы: name, cost_price, sale_price, stock_qty, min_stock_qty, unit |
| `b2b_materials` | Стекло B2B: supplier_id (привязка к поставщику — после SQL миграции) |
| `glass_price_matrix` | Матрица стекла: supplier_id (привязка к поставщику — после SQL миграции) |

## Ключевые файлы
| Файл | Роль |
|------|------|
| `lib/telegram.ts` | Telegram-алерты при критических остатках (через cron/stock) |

## Роли и доступ
- **buyer**: полный доступ — поставщики, заявки, склад, загрузка прайсов
- **admin**: всё
- **manager/production**: нет доступа к закупкам

## Входные данные
Прайс-листы поставщиков (ручной ввод, PDF/Excel), ручное редактирование остатков, создание заявок на закупку.

## Выходные данные
Обновлённые цены в materials/b2b_materials/glass_price_matrix, заявки на закупку в канбане, Telegram-алерты при критических остатках.

## Что уже реализовано
- Справочник поставщиков с архивированием и скидками
- Канбан заявок на закупку (purchase_orders)
- Контроль склада: stock_qty vs min_stock_qty с визуальными индикаторами
- Cron-задача `/api/cron/stock` с Telegram-алертом при критическом остатке
- Привязка material строк к поставщикам (supplier_id)
- Регламент закупщика (`/admin/guide`)

## Что нужно доработать
- Автоматический импорт прайса из PDF → обновление цен в b2b_materials/glass_price_matrix (PDF-парсинг частично реализован через `/api/b2b/parse-pdf`)
- История закупочных цен: когда/на сколько изменилась цена поставщика
- Контроль критических остатков для b2b_materials (сейчас только для materials)
- Уведомление buyer при создании новой заявки на закупку

## Риски
- Ручное обновление цен → риск расхождения между прайсом поставщика и матрицей
- Cron `/api/cron/stock` требует `CRON_SECRET` — без него не работает
- Удаление поставщика при наличии связанных materials/b2b_materials — нет CASCADE, оставит supplier_id = null

## Тесты
- Integration: добавление поставщика → привязка к b2b_materials.supplier_id
- Cron: `/api/cron/stock` с CRON_SECRET → Telegram при stock_qty < min_stock_qty
- Smoke: канбан закупок отображает все колонки

## Связи с другими Skills
- **Pricing Skill** — обновляет cost-цены в матрице стекла и материалах
- **Logistics Skill** — маршруты к поставщикам (procurement_routes)
- **B2B Skill** — b2b_materials.supplier_id привязан к поставщику
- **Health Check Skill** — проверяет критические остатки
