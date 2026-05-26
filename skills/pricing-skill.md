# Pricing Skill — Навык ценообразования

## Назначение
Управлять всеми справочниками цен MGlass: матрица стекла/зеркала, фурнитура, услуги, материалы, коэффициенты отхода. Обеспечивает консистентность данных между таблицами и является единственным источником цен для Calculation Skill.

## Модули и страницы
- `/admin/glass-prices` — матрица цен стекла/зеркал (4 вкладки: cost/sale × glass/mirror) + формульные параметры
- `/admin/facet` — цены фацета (₽/м.п. по типу 10/15/20 мм)
- `/admin/mirror-lighting` — компоненты подсветки (LED-лента, блок питания, диффузор)
- `/admin/mirror-frames` — рамки зеркал (₽/м.п., коэффициент отхода)
- `/admin/shower-hardware` — фурнитура душевых (BudgetMatrix, стандартные комплекты)
- `/admin/hardware` — фурнитура лофт (по системе: sliding/swing/universal)
- `/admin/materials` — материалы склада (расходники, подложка, электрика)
- `/admin/services` — услуги (монтаж, доставка, пескоструй)
- `/admin/b2b-materials` — B2B материалы (стекло/зеркало/тонированное/сатин/плёнки)
- `/admin/b2b-services` — B2B услуги (percent/per_m2/fixed/calculated/film)
- `/admin/waste-modifiers` — коэффициенты отхода по форме (circle, oval, complex)
- `/admin/settings` — финансовые настройки (% расходов, маржа по умолчанию)
- `/admin/pricing-manual` — руководство по ценообразованию

## API маршруты
- `GET/POST /api/admin/glass-prices` — матрица цен (sale-цены только для owner/ceo)
- `GET/POST /api/admin/pricing-formula` — формульные параметры для расчётных B2B-услуг
- `POST /api/admin/migrate-glass-prices` — миграция структуры матрицы
- `POST /api/admin/sync-b2b-materials` — синхронизация b2b_materials из glass_price_matrix
- `POST /api/ai/suggest-price` — AI-подсказка цены

## Таблицы БД
| Таблица | Роль |
|---------|------|
| `glass_price_matrix` | Ключевая: name, price_type (cost/sale), category (glass/mirror), t4–t12 (цена по толщине), waste_pct, supplier_id |
| `pricing_formula_params` | Параметры расчётных услуг (формульные коэффициенты) |
| `material_waste_modifiers` | Коэффициенты отхода: rule_key (circle/oval/complex), multiplier |
| `facet_prices` | Фацет: type_mm (10/15/20), price_per_m |
| `mirror_frames` | Рамки: whip_length_m, cost_per_m, waste_factor, assembly_cost |
| `mirror_lighting_components` | Подсветка: type, cost_price, unit |
| `hardware_items` | Лофт-фурнитура: system_type, name, cost_price, sale_price |
| `shower_hardware_items` | Душевая-фурнитура: tier (budget/standard), model, комплектация |
| `materials` | Расходники: name, cost_price, sale_price, stock_qty, min_stock_qty |
| `services` | Услуги: name, cost_price, sale_price, unit |
| `financial_settings` | % расходов: tax, manager, realization, marketing, transport, operation; маржа по product_type |
| `b2b_materials` | B2B материалы: name, category, t4–t12, cost_price, sale_price, supplier_id |
| `b2b_services` | B2B услуги: name, price_type (percent/per_m2/fixed/calculated/film), price |
| `b2b_films` | Плёнки для B2B |

## Ключевые файлы
| Файл | Роль |
|------|------|
| `lib/glassMatrix.ts` | Загрузка матрицы стекла из БД, кеширование, поиск по name+type+thickness |
| `lib/types.ts` | Типы: GlassPriceRow, FinancialSettings, MaterialRow, ServiceRow |

## Роли и доступ
- **buyer**: полный CRUD справочников (materials, services, b2b_materials, glass_price_matrix cost-строки)
- **admin**: всё, включая sale-цены
- **ceo/owner**: просмотр sale-цен в матрице
- **manager**: только чтение (через калькулятор)

## Входные данные
Прайс-листы поставщиков (ручной ввод или PDF-парсинг), ручное редактирование в интерфейсе.

## Выходные данные
Актуальные цены во всех калькуляторах, маржинальные подсказки, синхронизированные данные между таблицами.

## Что уже реализовано
- Полная матрица стекла с 4 вкладками (cost/sale × glass/mirror)
- Расчёт маржи прямо в таблице glass-prices
- Формульные параметры для расчётных B2B-услуг
- Привязка строк матрицы к поставщикам (supplier_id — после SQL миграции)
- Интерфейс b2b-materials с calcCostPerM2 и calcMargin
- Настройки раскроя
- `lib/glassMatrix.ts` — кеш и поиск по матрице

## Что нужно доработать
- История изменений цен: кто/когда изменил, delta
- Автоматический пересчёт рентабельности при изменении закупочных цен
- Уведомление менеджеров о значительном изменении цен (>10%)
- Импорт прайса поставщика из PDF/Excel напрямую в glass_price_matrix

## Риски
- `sale`-цены в `glass_price_matrix` доступны только `owner` — если роль не настроена, строки скрыты и калькулятор считает по cost-ценам
- `b2b_materials.sale_price` исторически хранился в поле `notes` как JSON — при работе с этой таблицей проверь актуальную схему
- Изменение `financial_settings` немедленно влияет на все будущие расчёты без предупреждения
- `VAT = 22` зашит константой в `b2bCalculator.ts` — при изменении ставки нужно ручное обновление

## Тесты
- Integration: изменение цены в матрице → калькулятор зеркала использует новую цену
- Smoke: все 4 вкладки `/admin/glass-prices` загружаются без ошибок
- Regression: Health Check Skill проверяет рассинхрон b2b_materials и glass_price_matrix

## Связи с другими Skills
- **Calculation Skill** — потребляет все цены; любое изменение здесь влияет на расчёты
- **Procurement Skill** — источник закупочных цен; обновляет cost-строки матрицы
- **B2B Skill** — использует b2b_materials и b2b_services
- **Health Check Skill** — валидирует консистентность между таблицами
