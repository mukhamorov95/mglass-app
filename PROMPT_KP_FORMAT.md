# Промпт: Формат КП — Изделие → Монтаж → Доставка

## Контекст

Файл для редактирования: `app/calculations/order/[groupId]/print/page.tsx`

Это страница печатного КП для группы расчётов. Каждый расчёт из `calculations` содержит:
- `final_price` — итоговая цена с услугами (grandTotal = finalPrice + servicesTotal)
- `financial_breakdown.serviceLines` — массив услуг: `[{ name, qty, unit, price, total }]`
  - Может содержать: "Монтаж зеркала", "Доставка Москва", "Монтаж душевой перегородки" и др.
- `financial_breakdown.discountAmount` — сумма скидки (уже применена к finalPrice)
- `financial_breakdown.servicesTotal` — сумма всех услуг
- `discount` — процент скидки
- `input_data` — данные калькулятора (размеры, материал, форма и т.д.)

**Формула цен:**
- `finalPrice = final_price - servicesTotal` — цена изделия (без услуг)
- `servicesTotal = sum(serviceLines[].total)` — услуги
- `final_price = finalPrice + servicesTotal` — итог (что видел клиент в калькуляторе)

## Требование к формату таблицы КП

Каждый расчёт в группе должен раскрываться в строки ПОСЛЕДОВАТЕЛЬНО:

```
┌────┬─────────────────────────────────────────┬─────┬─────────────┬─────────────┐
│ №  │ НАИМЕНОВАНИЕ                            │ КОЛ.│    ЦЕНА     │    СУММА    │
├────┼─────────────────────────────────────────┼─────┼─────────────┼─────────────┤
│ 1  │ Зеркало прямоугольное, 776×2200 мм      │  1  │  69 501 ₽   │  69 501 ₽   │
│    │   Antique Mirror A-1 4 мм · подложка    │     │             │             │
├────┼─────────────────────────────────────────┼─────┼─────────────┼─────────────┤
│    │   Монтаж зеркала                        │  1  │   6 500 ₽   │   6 500 ₽   │
├────┼─────────────────────────────────────────┼─────┼─────────────┼─────────────┤
│    │   Доставка Москва                       │  1  │   2 000 ₽   │   2 000 ₽   │
├────┼─────────────────────────────────────────┼─────┼─────────────┼─────────────┤
│ 2  │ Зеркало прямоугольное, 776×606 мм       │  1  │  17 705 ₽   │  17 705 ₽   │
│    │   Antique Mirror A-1 4 мм               │     │             │             │
├────┼─────────────────────────────────────────┼─────┼─────────────┼─────────────┤
│    │   Монтаж зеркала                        │  1  │   6 500 ₽   │   6 500 ₽   │
...
```

### Правила строк:

**Строка изделия (продукт):**
- `id` = порядковый номер (1, 2, 3…) — нумеруются ТОЛЬКО строки изделий
- `name` = результат `getProductDescription(calc)` — ВСЕГДА из `input_data` (форма + размер + материал + опции)
- `qty` = 1
- `price` = `final_price - servicesTotal` (цена изделия БЕЗ услуг)
- `total` = то же значение
- Если `discount > 0`: добавить в name суффикс `" (скидка X%)"`, так как цена уже финальная

**Строка услуги (монтаж, доставка и т.д.):**
- `id` = '' (пусто, не нумеруется)
- `name` = `svcLine.name` — название услуги из `financial_breakdown.serviceLines`
- `qty` = `svcLine.qty ?? 1`
- `price` = `svcLine.price ?? svcLine.total`
- `total` = `svcLine.total`
- Визуально: отступ слева, шрифт меньше, цвет серый (#555)
- Услуги НЕ накапливаются — каждая следует сразу за своим изделием

**Итоговая проверка:**
```
ИТОГО = Σ(final_price каждого расчёта)
       = Σ(productPrice_i + serviceLines_i)
```
Это должно совпадать с суммой `final_price` по всем расчётам в группе.

## Что нужно изменить в коде

### `app/calculations/order/[groupId]/print/page.tsx`

**Функция `getProductDescription`** (уже исправлена — читает из `input_data`):
- Зеркало: "Зеркало прямоугольное, 776×2200 мм" + "Antique Mirror A-1 4 мм · подложка"
- Лофт: "Лофт-перегородка 2000×2400 мм" + "стационарная, Antique Mirror A-1"
- Душевая: "Душевая перегородка 900×2000 мм" + "стекло 8 мм прозрачное · фурнитура Хром"

**Логика построения строк:**
```typescript
const rows: Row[] = []
let itemIdx = 0  // счётчик только для изделий

for (const calc of calcs) {
  itemIdx++
  const svcLines = (calc.financial_breakdown?.serviceLines ?? [])
    .filter(s => s.total > 0)
  const servicesTotal = svcLines.reduce((s, l) => s + l.total, 0)
  const productPrice  = calc.final_price - servicesTotal
  const discountNote  = calc.discount > 0 ? ` (скидка ${calc.discount}%)` : ''

  // Строка изделия
  rows.push({
    id:        itemIdx,
    name:      getProductDescription(calc) + discountNote,
    qty:       1,
    price:     productPrice,
    total:     productPrice,
    isProduct: true,
  })

  // Строки услуг — сразу за изделием
  for (const svc of svcLines) {
    rows.push({
      id:        '',
      name:      svc.name,
      qty:       svc.qty ?? 1,
      price:     svc.price ?? svc.total,
      total:     svc.total,
      isService: true,
    })
  }
}

const grandTotal = rows.reduce((s, r) => s + r.total, 0)
// grandTotal === Σ(calc.final_price) ✓
```

**Рендеринг строки услуги:**
```tsx
<td style={{ paddingLeft: 24, color: '#555', fontSize: 11 }}>
  {row.name}
</td>
```

**Тип Row:**
```typescript
type Row = {
  id: number | ''
  name: string
  qty: number
  price: number
  total: number
  isProduct?: boolean
  isService?: boolean
}
```

## Проверки после реализации

1. ИТОГО в КП === сумма `final_price` по всем расчётам группы
2. Цена изделия в КП === цена изделия в калькуляторе (без услуг)
3. Монтаж и доставка идут сразу под своим изделием
4. Нумерация только у изделий (1, 2, 3…), у услуг — пусто
5. Если у изделия нет услуг — строк услуг нет
6. Если скидка — написано в названии изделия "(скидка X%)"

## Затронутые файлы

- `app/calculations/order/[groupId]/print/page.tsx` — основной файл КП

Примечание: `app/calculations/[id]/print/page.tsx` (КП для одного расчёта) — проверить отдельно,
аналогичная логика может понадобиться и там.
