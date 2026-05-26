# Calculation Skill — Расчётный навык

## Назначение
Вычислять точную стоимость изделий MGlass: зеркала с подсветкой, душевые перегородки, лофт-перегородки и B2B-стекло. Skill принимает параметры изделия, загружает актуальные цены из справочников и возвращает детальную разбивку себестоимости и финального ценника.

## Модули и страницы
- `/calculator/mirror` — расчёт зеркала с подсветкой (форма + SVG-визуализация + корзина)
- `/calculator/shower` — расчёт душевой (12 моделей M1–M12, тиры budget/standard)
- `/calculator/loft` — расчёт лофт-перегородки (секции, фурнитура, стекло)
- `/calculator/b2b` — расчёт B2B-стекла (список деталей, услуги, раскрой)

## API маршруты
- `GET /api/admin/glass-prices` — загрузка матрицы цен (вызывается внутри `glassMatrix.ts`)
- `POST /api/calc/quick` — быстрый расчёт без сохранения (для Telegram-бота)

## Таблицы БД
| Таблица | Роль |
|---------|------|
| `glass_price_matrix` | Цена стекла/зеркала по имени, типу (cost/sale) и толщине (t4–t12) |
| `material_waste_modifiers` | Коэффициенты отхода по форме изделия (rule_key: circle, oval, complex) |
| `mirror_lighting_components` | LED-лента, блок питания, диффузор, рамка-LED (cost_price) |
| `mirror_frames` | Декоративные рамки: whip_length_m, cost_per_m, waste_factor, сборка |
| `facet_prices` | Фацет ₽/м.п. (type_mm: 10/15/20) |
| `hardware_items` | Фурнитура лофт (system_type: sliding/swing/universal) |
| `shower_hardware_items` | Фурнитура душевых (BudgetMatrix, стандартные комплекты) |
| `materials` | Расходники: подложка, кнопки, электрика |
| `services` | Услуги: монтаж, доставка, пескоструй (cost_price, sale_price) |
| `b2b_materials` | Материалы для B2B (стекло/зеркало/тонированное/сатин/рифлёное/декоративное) |
| `b2b_services` | Услуги B2B (percent/per_m2/fixed/calculated/film) |
| `financial_settings` | % расходов (tax, manager, realization, marketing, transport, operation), маржа |
| `calculations` | Сохранение результатов расчётов |

## Роли
- **manager** — использует калькуляторы, сохраняет расчёты, добавляет в корзину
- **admin** — полный доступ, видит себестоимость
- **buyer** — только справочники (не калькулятор)
- **production** — нет доступа к калькуляторам

## Входные данные
```typescript
// Зеркало
{ width, height, shape, mirrorMaterial, hasLighting, ledStrip, powerSupply,
  mirrorFrame, hasFacet, facetTypeMm, hasInstallation, hasDelivery,
  partnerPercent, discount, margin }

// B2B
[{ materialId, thickness, width, height, quantity, wastePercent,
   hasTempering, hasFacet, services[] }]
```

## Выходные данные
```typescript
// Все калькуляторы возвращают:
{
  costLines: CostLine[]        // постатейная себестоимость
  totalCost: number            // итого себестоимость
  expensesPercent: number      // % операционных расходов
  expensesAmount: number       // ₽ операционных расходов
  basePrice: number            // минимальная цена (cost / (1 - margin%))
  partnerAmount: number        // комиссия партнёру
  discountAmount: number       // сумма скидки
  finalPrice: number           // итоговая цена клиенту
  margin: number               // маржа %
  profit: number               // прибыль ₽
  clientText: string           // текст для КП клиенту
}
```

## Что уже реализовано
- `lib/mirrorCalculator.ts` — полный движок зеркала: площадь, отход, перimeter, LED, рамка, фацет, финансы
- `lib/loftCalculator.ts` — движок лофта: стекло, профиль, штапик, фурнитура, финансы
- `lib/showerCalculator.ts` — 12 моделей душевых, 2 тира, фурнитурные комплекты
- `lib/b2bCalculator.ts` — B2B расчёт с НДС 22%, закалкой, кромкой, транспортом, упаковкой
- `lib/glassMatrix.ts` — загрузка `glass_price_matrix` и `material_waste_modifiers`
- `lib/saveCalculation.ts` — сохранение/обновление в `calculations`
- `lib/quickCalc.ts` — быстрый расчёт без сохранения (Telegram)
- `lib/cuttingOptimizer.ts` — 2D-оптимизация раскроя для B2B (BSSF guillotine)
- `lib/productionSummary.ts` — производственная сводка по позициям
- `lib/CartContext.tsx` — корзина расчётов для группировки в заказ
- `lib/svg/generateMirrorSVG.ts`, `lib/svg/generateLoftSVG.ts` — визуализация
- Компонент `PricingBlock` — единый блок ценника с маржой-светофором

## Что нужно доработать
- Снимок цен на момент расчёта (сейчас `input_data` содержит материал, но цена не фиксируется)
- Пересчёт при изменении цен в справочниках (уведомлять менеджера)
- Тонкая настройка `financial_settings` по `product_type` (сейчас иногда fallback на tier='standard')
- Расчёт душевых не использует `glass_price_matrix` для price — нужна интеграция

## Риски
- **Рассинхронизация матрицы и B2B:** `glass_price_matrix` и `b2b_materials` — разные таблицы. Health Check следит, но ручное изменение одной не обновляет вторую
- **НДС-константа:** `VAT = 22` зашита в `b2bCalculator.ts`. При изменении ставки — ручное обновление
- **Нет кеша:** каждый расчёт делает несколько запросов к БД. При медленном Supabase — лаги
- **Форма complex:** для зеркал-нестандарт отход берётся через `material_waste_modifiers` — если правило не добавлено, отход = 0

## Тесты
- Unit: `calculateMirror(inputs, materials, settings)` с mock-данными → ожидаемый `finalPrice`
- Unit: `calcItem(item, material, services, facetPrices)` для B2B
- Unit: `runCuttingOptimizer(pieces, settings)` корректно укладывает детали
- Integration: загрузка `glass_price_matrix` → `getMatrixPrice()` возвращает число
- Integration: сохранение расчёта → `calculations.id` возвращается
- Regression: изменение цены в матрице не изменяет сохранённые расчёты

## Связи с другими Skills
- **Pricing Skill** — источник всех цен (обязательная зависимость)
- **Commercial Proposal Skill** — потребляет результат расчёта для КП
- **Order Management Skill** — расчёт → добавление в корзину → запуск заказа
- **Health Check Skill** — следит за синхронизацией данных расчётов
