# MGlass — Правила целостности данных калькулятора

## Статус
Этот файл — ОБЯЗАТЕЛЬНЫЙ контракт системы.
Он должен проверяться при каждом изменении любого калькулятора, saveCalculation, CartContext, или страницы расчётов.

---

## ИНВАРИАНТЫ — нарушение любого из них = баг

### INV-1: final_price всегда включает услуги
**Что должно быть:**
- `final_price` в БД = продукт + монтаж + доставка (всё что платит клиент)
- `final_price` = `grand_total`, никогда не `result.finalPrice` без услуг

**Где проверять:**
- `components/CartSection.tsx` → `handleSaveOrder()` → поле `final_price`
- `app/calculator/mirror/page.tsx` → `handleAddToCart()` → `final_price` в CartItem
- `app/calculator/loft/page.tsx` → `handleAddToCart()` → `final_price` в CartItem ⚠️ БАГ
- `app/calculator/shower/page.tsx` → `handleAddToCart()` → `final_price` в CartItem ⚠️ БАГ

**Правило:** `final_price: result.grandTotal` — всегда grandTotal, никогда finalPrice

---

### INV-2: input_data — полный snapshot для пересчёта
**Что должно быть:**
Из `input_data` должно быть возможно воспроизвести расчёт полностью.
Включает ВСЕ пользовательские параметры: размеры, материалы, услуги, скидки, партнёр.

**Что обязательно в input_data:**
- Mirror: width, height, shape, mirrorName, mirrorMm, hasLighting, voltage, frameId, ledStripId, psuId, diffuserId, buttonType, hasSandblast, hasSubstrate, substratePrice, hasFrame, mirrorFrameId, hasFacet, facetTypeMm, hasInstallation, hasDelivery, kmFromMkad, partnerId, discount, margin
- Loft: width, height, sections, divisions, systemType, glassId, glassName, glassThickness, withTempering, withMirrorFilm, withPainting, hasInstallation, hasDelivery, kmFromMkad, partnerId, discount, margin ⚠️ partnerId/discount/margin отсутствуют
- Shower: tier, modelId, stdShowerType, stdGlassCount, stdIsCorner, dimStr, glassType, thickness, hwColor, hasInstallation, hasDelivery, kmFromMkad, partnerId, discount ⚠️ partnerId/discount отсутствуют

---

### INV-3: edit mode никогда не перезаписывает оригинал
**Что должно быть:**
"Пересчитать по актуальным ценам" → ВСЕГДА создаёт НОВЫЙ расчёт с `parent_calc_id = editCalcId`.
`updateCalculation` вызывается только для редактирования клиента/скидки на странице расчёта.

**Где проверять:**
- `app/calculator/mirror/page.tsx` → `handleSave()` — ИСПРАВЛЕНО ✓
- `app/calculator/loft/page.tsx` → `handleSave()` — ⚠️ до сих пор вызывает `updateCalculation`
- `app/calculator/shower/page.tsx` → `handleSave()` — ⚠️ до сих пор вызывает `updateCalculation`

**Правило:** в `handleSave()` не должно быть блока `if (editCalcId) { updateCalculation(...) }`.
Всегда: `saveCalculation({ ...payload, parent_calc_id: editCalcId ?? undefined })`

---

### INV-4: profit и margin считаются корректно при наличии услуг
**Что должно быть:**
- `profit` = (final_price - servicesTotal) - totalCost - tax_on_product
- `margin` = profit / final_price * 100
- НЕ: profit = final_price - totalCost - expensesAmount (включает услуги в базу → занижает profit)

**Где проверять:**
- Все калькуляторы: `result.profit`, `result.margin` из lib/mirrorCalculator.ts, lib/loftCalculator.ts, lib/showerCalculator.ts
- `app/calculations/[id]/page.tsx` → `getPreview()`: когда цена не изменена — использовать `calc.profit` и `calc.margin` из БД напрямую

---

### INV-5: CartItem.final_price = CartItem.grand_total
**Что должно быть:**
В `lib/CartContext.tsx`, тип `CartItem` поле `final_price` должно быть = `grand_total`.
`CartSection.tsx` при сохранении использует `item.grand_total` как `final_price`.

---

### INV-6: parent_calc_id — ссылочная целостность
**Что должно быть:**
- Цикличных ссылок нет (A → B → A)
- `parent_calc_id` ссылается на существующий расчёт

---

## ИЗВЕСТНЫЕ БАГИ (не исправлены на момент написания)

| # | Файл | Строка | Баг | Приоритет |
|---|------|--------|-----|-----------|
| 1 | `app/calculator/loft/page.tsx` | ~293 | `final_price: result.finalPrice` вместо `result.grandTotal` в CartItem | КРИТИЧЕСКИЙ |
| 2 | `app/calculator/shower/page.tsx` | ~380 | То же самое в CartItem | КРИТИЧЕСКИЙ |
| 3 | `app/calculator/loft/page.tsx` | ~325 | `updateCalculation` в edit mode — перезаписывает оригинал | ВЫСОКИЙ |
| 4 | `app/calculator/shower/page.tsx` | ~411 | То же самое | ВЫСОКИЙ |
| 5 | `app/calculator/loft/page.tsx` | ~285 | input_data без partnerId, discount, margin, kmFromMkad | СРЕДНИЙ |
| 6 | `app/calculator/shower/page.tsx` | ~380 | input_data без partnerId, discount, kmFromMkad | СРЕДНИЙ |

---

## ЧЕКЛИСТ для проверки после любых изменений в калькуляторах

```
[ ] INV-1: final_price в CartItem = grandTotal (не finalPrice)
[ ] INV-1: final_price в handleSave payload = grandTotal
[ ] INV-2: input_data содержит ВСЕ параметры из таблицы выше
[ ] INV-3: handleSave не вызывает updateCalculation — только saveCalculation с parent_calc_id
[ ] INV-4: profit/margin в payload = из calculator lib, не пересчитан вручную с ошибкой
[ ] INV-5: CartSection использует item.grand_total как final_price
[ ] INV-6: parent_calc_id передаётся корректно при edit mode
```
