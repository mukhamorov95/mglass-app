# MGlass — Правила целостности данных калькулятора

**Последняя проверка:** 26 мая 2026 — все 6 инвариантов выполнены для mirror, loft, shower.

Этот файл — ОБЯЗАТЕЛЬНЫЙ контракт системы.
Проверяй его при каждом изменении калькулятора, saveCalculation, CartContext, или страницы расчётов.

---

## ИНВАРИАНТЫ — нарушение любого из них = баг

### INV-1: final_price всегда включает услуги (= grandTotal)

`final_price` в БД = продукт + монтаж + доставка. Всегда `result.grandTotal`, никогда `result.finalPrice`.

| Место | Что проверять |
|-------|--------------|
| `handleAddToCart()` каждого калькулятора | `final_price: result.grandTotal` |
| `handleSave()` каждого калькулятора | `final_price: result.grandTotal` |
| `CartSection.tsx` → `handleSaveOrder()` | `final_price: item.grand_total` |

Runtime-guard: `assertPayloadIntegrity()` в `lib/saveCalculation.ts` логирует в console.error если `final_price < base_price * 0.8`.

---

### INV-2: input_data содержит полный snapshot для пересчёта

Из `input_data` должен быть возможен полный пересчёт без других таблиц.

**Mirror** (✅): `width, height, shape, mirrorName, mirrorMm, hasLighting, voltage, frameId, ledStripId, psuId, diffuserId, buttonType, hasSandblast, hasSubstrate, substratePrice, hasFrame, mirrorFrameId, hasFacet, facetTypeMm, hasInstallation, hasDelivery, kmFromMkad, partnerId, discount, margin`

**Loft** (✅): `width, height, sections, divisions, systemType, glassId, glassName, glassThickness, withTempering, withMirrorFilm, withPainting, hasInstallation, hasDelivery, kmFromMkad, partnerId, discount, margin`

**Shower** (✅): `tier, modelId, width, width2, height, dimStr, glassType, thickness, hwColor, stdShowerType, stdGlassCount, stdIsCorner, withMounting, withDelivery, kmFromMkad, partnerId, discount, margin`

Runtime-guard: `assertPayloadIntegrity()` логирует если `Object.keys(input_data).length < 4`.

---

### INV-3: edit mode создаёт НОВЫЙ расчёт, не перезаписывает оригинал

`handleSave()` всегда вызывает `saveCalculation({ ...payload, parent_calc_id: editCalcId ?? undefined })`.
`updateCalculation` в калькуляторах — **запрещён**. Только на странице `/calculations/[id]` для редактирования клиента/скидки.

| Калькулятор | Статус |
|------------|--------|
| mirror | ✅ |
| loft | ✅ |
| shower | ✅ |

---

### INV-4: profit и margin считаются на product price (без услуг)

```
productPrice = finalPrice  (до services — это НЕ grandTotal)
tax = productPrice * expensesPercent / 100
profit = productPrice - totalCost - tax
margin = profit / finalPrice * 100
```

Калькуляторы считают правильно. `getPreview()` в `/calculations/[id]/page.tsx`:
когда цена/скидка не изменены → возвращает `calc.profit` и `calc.margin` из БД (не пересчитывает).

---

### INV-5: CartItem.final_price = CartItem.grand_total

`CartSection.tsx` при сохранении: `final_price: item.grand_total`. ✅

---

### INV-6: parent_calc_id — ссылочная целостность

`parent_calc_id` ссылается на существующий расчёт. Цикличных ссылок нет (проверяет БД: FK constraint).

---

## ИЗВЕСТНЫЕ ОТКРЫТЫЕ ВОПРОСЫ

Нет. Все инварианты соблюдены на 26.05.2026.

---

## ЧЕКЛИСТ — запускай при любых изменениях в калькуляторах

```
[ ] INV-1: handleAddToCart → final_price: result.grandTotal
[ ] INV-1: handleSave → final_price: result.grandTotal
[ ] INV-1: CartSection → final_price: item.grand_total
[ ] INV-2: input_data содержит ВСЕ поля из таблицы выше
[ ] INV-3: handleSave не импортирует и не вызывает updateCalculation
[ ] INV-3: saveCalculation вызывается с parent_calc_id: editCalcId ?? undefined
[ ] INV-4: profit в lib/*Calculator = от product price, не от grandTotal
[ ] INV-5: CartItem тип содержит оба поля final_price и grand_total
[ ] INV-6: parent_calc_id передаётся только при editCalcId != null
```

---

## КРИТИЧЕСКИЕ ЗАПРЕТЫ

- **НЕ** используй `updateCalculation` в edit mode калькуляторов
- **НЕ** передавай `result.finalPrice` как `final_price` при сохранении
- **НЕ** пересчитывай profit вручную — только из `lib/*Calculator` result
- **НЕ** убирай `parent_calc_id` из `SavePayload` при рефакторингах
- **НЕ** упрощай `input_data` — только расширяй
- **НЕ** вычисляй tax от `grandTotal` (включает услуги) — только от `finalPrice`
