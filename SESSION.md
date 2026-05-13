## Текущая задача
Закоммичено: разбивка ИТОГО в калькуляторе душевых (изделие + доставка + итого).

## Что сделано (последние сессии)
- `app/calculator/shower/page.tsx` — бюджетный калькулятор душевых: загрузка ручных цен фурнитуры из `shower_budget_manual_prices` по модели + цвету
- `app/admin/shower-hardware/BudgetKitTab.tsx` — вкладка бюджетных комплектов: отображение ошибок при сохранении
- `app/admin/shower-hardware/` — доставка MKAD (линейная формула), qty и ручные цены в бюджетном ките
- `app/admin/glass-prices/page.tsx` — кнопка "Заполнить по формуле" для всех цен продажи
- `supabase/migrations/20250513_formula_margin_40.sql` — мин маржа 40% для стекла/зеркала

## Следующий шаг
Нет — ожидание новой задачи от пользователя.

## Контекст
- Стек: Next.js 14 App Router + Supabase + Tailwind, деплой на Vercel
- Путь: `/Users/mukhamorov01/Desktop/КЛАУД/mglass-app`
- Dev: `localhost:3000`
- Последний коммит: `2ec28cf` — Budget shower: use manual hw prices from DB
- Синхронизация = git push через кнопку в сайдбаре → Vercel автодеплой

### Ключевые таблицы (душевые)
- `shower_budget_manual_prices` — (model_id, color_id, price) — ручная цена комплекта фурнитуры
- `shower_catalog_items` / `shower_catalog_prices` — каталог фурнитуры с ценами
- `shower_hw_colors` / `shower_hw_suppliers` — цвета и поставщики
- `glass_price_matrix` — матрица цен стекла (cost/sale × категория)

### Формула расчёта душевой (budget tier)
- `customHardwareCost` = цена из `shower_budget_manual_prices` для модели+цвета
- Передаётся в `calculateShower()` через `inputs.customHardwareCost`
- Цвет: `hwColor` (chrome/black/etc) → маппинг `COLOR_DB_NAME` → `shower_hw_colors.name` → `color_id`

## Открытые вопросы
- Нет известных багов или незакрытых задач
