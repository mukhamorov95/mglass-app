# ПРОМПТ: Аудит целостности данных MGlass

> Скопируй всё ниже и отправь Claude как первое сообщение новой сессии.

---

## Контекст задачи

Это CRM + калькулятор для производства стекла и зеркал (MGlass).
Ты — старший инженер. Твоя задача: провести полный аудит того, что данные,
которые менеджер видит в **Истории расчётов** и **карточке заказа**,
точно соответствуют тому, что рассчитал **калькулятор**.

Прочитай `MGLASS_SYSTEM_RULES.md` — это контракт системы.
Прочитай `SESSION.md` — текущее состояние проекта.

---

## Шаг 1 — Прочитай ключевые файлы

Прочитай ВСЕ перечисленные файлы перед тем как что-то писать:

```
lib/saveCalculation.ts
lib/CartContext.tsx
lib/mirrorCalculator.ts
lib/loftCalculator.ts
lib/showerCalculator.ts
components/CartSection.tsx
app/calculator/mirror/page.tsx
app/calculator/loft/page.tsx
app/calculator/shower/page.tsx
app/calculations/[id]/page.tsx
MGLASS_SYSTEM_RULES.md
```

---

## Шаг 2 — Проверь 6 инвариантов

Для каждого инварианта выдай: ✅ соблюдается / ❌ нарушен + файл + строка.

### INV-1: final_price всегда = product + services (grandTotal)

Найди в каждом калькуляторе два места:
- **handleAddToCart** — что передаётся в CartItem как `final_price`
- **handleSave** — что передаётся в payload как `final_price`

**Правило:** оба места должны использовать `result.grandTotal`, **никогда** `result.finalPrice`.

Проверь также `CartSection.tsx` → `handleSaveOrder()`:
поле `final_price` должно быть `item.grand_total`, не `item.final_price`.

---

### INV-2: input_data содержит полный snapshot

Из `input_data` в БД должно быть возможно воспроизвести расчёт без обращения к другим таблицам.

Проверь для каждого калькулятора:

**Mirror** — в `handleAddToCart` и `handleSave` должны быть:
`width, height, shape, mirrorName, mirrorMm, hasLighting, voltage, frameId, ledStripId, psuId, diffuserId, buttonType, hasSandblast, hasSubstrate, substratePrice, hasFrame, mirrorFrameId, hasFacet, facetTypeMm, hasInstallation, hasDelivery, kmFromMkad, partnerId, discount, margin`

**Loft** — в `handleAddToCart` и `handleSave` должны быть:
`width, height, sections, divisions, systemType, glassId, glassName, glassThickness, withTempering, withMirrorFilm, withPainting, hasInstallation, hasDelivery, kmFromMkad, partnerId, discount, margin`

**Shower** — в `handleAddToCart` и `handleSave` должны быть:
`tier, modelId, stdShowerType, stdGlassCount, stdIsCorner, dimStr, glassType, thickness, hwColor, hasInstallation, hasDelivery, kmFromMkad, partnerId, discount`

---

### INV-3: edit mode создаёт НОВЫЙ расчёт, не перезаписывает

В `handleSave()` каждого калькулятора:
- **Нарушение:** блок `if (editCalcId) { updateCalculation(editCalcId, payload) }`
- **Правило:** всегда `saveCalculation({ ...payload, parent_calc_id: editCalcId ?? undefined })`

mirror уже исправлен. Проверь loft и shower.

---

### INV-4: profit и margin учитывают услуги правильно

В lib/*Calculator.ts найди формулу расчёта profit.

**Неправильно:** `profit = finalPrice - totalCost - expensesAmount`
(expensesAmount считается от finalPrice включая услуги → налог завышен)

**Правильно:**
```
productPrice = finalPrice - servicesTotal
tax = productPrice * (expensesPercent / 100)
profit = productPrice - totalCost - tax
margin = profit / finalPrice * 100
```

---

### INV-5: CartItem согласован с saveCalculation

В `lib/CartContext.tsx` тип `CartItem`:
- поле `final_price` должно существовать
- `grand_total` тоже должно существовать и = final_price + services

В `CartSection.tsx` при сохранении:
- `final_price: item.grand_total` (не `item.final_price`)

---

### INV-6: getPreview() на странице расчёта не ломает profit

В `app/calculations/[id]/page.tsx` функция `getPreview()`:

**Правило:** если пользователь НЕ изменял цену и скидку — возвращать `calc.profit` и
`calc.margin` прямо из БД. Пересчёт только при явном изменении.

Иначе: profit пересчитывается без услуг → показывает завышенную маржу.

---

## Шаг 3 — Исправь все нарушения

Для каждого ❌ — примени исправление немедленно.
Используй зафиксированный в mirror-калькуляторе паттерн как образец.

Приоритет исправлений:
1. INV-1 loft + shower (КРИТИЧНО — деньги в БД неправильные)
2. INV-3 loft + shower (ВЫСОКИЙ — перезаписывает оригинал клиента)
3. INV-2 loft + shower (СРЕДНИЙ — пересчёт работает неполно)

---

## Шаг 4 — Добавь runtime-проверку в saveCalculation

В `lib/saveCalculation.ts` добавь функцию `assertPayloadIntegrity(payload)`,
которая вызывается перед каждым сохранением и бросает console.error (не exception)
если нарушен инвариант:

```typescript
function assertPayloadIntegrity(p: SavePayload) {
  // INV-1: final_price должна быть >= base_price (т.е. включает хотя бы продукт)
  if (p.final_price < p.base_price * 0.5) {
    console.error('[MGlass INV-1] final_price подозрительно мала — возможно передан finalPrice вместо grandTotal', p)
  }
  // INV-4: margin не должна быть > 90% (признак того что profit считается без услуг)
  if (p.margin > 90) {
    console.error('[MGlass INV-4] margin > 90% — возможно profit считается без вычета услуг', p)
  }
  // INV-2: input_data не должна быть пустой
  if (!p.input_data || Object.keys(p.input_data).length < 3) {
    console.error('[MGlass INV-2] input_data слишком мала — snapshot неполный', p)
  }
}
```

Вызывай её в начале `saveCalculation()` перед insert.

---

## Шаг 5 — Обнови MGLASS_SYSTEM_RULES.md

После исправлений:
- Убери строки с ⚠️ БАГ для исправленных пунктов
- Обнови таблицу "Известные баги" — убери исправленные
- Добавь дату последней проверки в начало файла

---

## Шаг 6 — Напиши что проверено

Формат ответа:

```
## Результат аудита

| Инвариант | Mirror | Loft | Shower | Статус |
|-----------|--------|------|--------|--------|
| INV-1 final_price | ✅ | ❌→✅ | ❌→✅ | Исправлено |
| INV-2 input_data  | ✅ | ❌→✅ | ❌→✅ | Исправлено |
| INV-3 edit mode   | ✅ | ❌→✅ | ❌→✅ | Исправлено |
| INV-4 profit/margin | ✅ | ✅ | ✅ | OK |
| INV-5 CartItem    | ✅ | — | — | OK |
| INV-6 getPreview  | ✅ | — | — | OK |

## Что изменено
- файл:строка — описание

## Что осталось
- ...
```

---

## Критические запреты

- НЕ используй `updateCalculation` в edit mode калькуляторов
- НЕ передавай `result.finalPrice` как `final_price` при сохранении
- НЕ пересчитывай profit вручную — только из lib/*Calculator result
- НЕ убирай `parent_calc_id` из SavePayload при любых рефакторингах
- НЕ упрощай input_data — только расширяй

---

*Этот промпт хранится в `PROMPT_INTEGRITY_AUDIT.md`. Обновляй его если добавляются новые калькуляторы или инварианты.*
