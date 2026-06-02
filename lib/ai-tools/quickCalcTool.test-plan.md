# quickCalcTool — Manual Test Plan

**File under test:** `lib/ai-tools/quickCalcTool.ts`  
**Function:** `runQuickCalcTool(input)`  
**Environment needed:** Supabase connection (materials, services, financial_settings tables populated)

---

## Test Case 1 — Mirror with valid dimensions

**Input:**
```typescript
{
  product_type: 'mirror',
  width: 600,
  height: 900,
  installation_required: false,
}
```

**Expected output:**
```
ok:                 true
tool:               'quickCalc'
mode:               'read_only'
calculation.calc_source:    'quickCalc'
calculation.base_price:     > 0
calculation.final_price:    > 0
calculation.margin:         > 0
calculation.quantity:       1
calculation.total_estimate: === calculation.final_price
missing_data:       []
warnings:           []  (нет доставки, размеры нормальные)
errors:             []
approval_required:  false
can_send_to_client: false
safety.no_db_write: true
```

**Verify:** `input_summary` содержит "mirror 600×900мм qty=1"

---

## Test Case 2 — Shower with missing dimensions

**Input:**
```typescript
{
  product_type: 'shower',
  width: 0,      // invalid
  height: 2000,
}
```

**Expected output:**
```
ok:               false
calculation:      null
missing_data:     []  (0 передан, но невалидный)
errors:           [{ code: 'INVALID_WIDTH', field: 'width' }]
warnings:         []
```

**Verify:** `errors[0].message` содержит понятный текст без Supabase stack trace

---

## Test Case 3 — Unknown product_type

**Input:**
```typescript
{
  product_type: 'b2b' as any,
  width: 1000,
  height: 2000,
}
```

**Expected output:**
```
ok:               false
calculation:      null
errors:           [{ code: 'UNSUPPORTED_PRODUCT_TYPE', field: 'product_type' }]
```

**Verify:** `errors[0].message` перечисляет поддерживаемые типы (mirror, shower, loft)

---

## Test Case 4 — Negative dimension

**Input:**
```typescript
{
  product_type: 'loft',
  width: -500,
  height: 2100,
}
```

**Expected output:**
```
ok:               false
calculation:      null
errors:           [{ code: 'INVALID_WIDTH', field: 'width' }]
```

**Verify:** функция вернула структурированный error, не бросила исключение

---

## Test Case 5 — Quantity default

**Input:**
```typescript
{
  product_type: 'mirror',
  width: 400,
  height: 600,
  // quantity не передан
}
```

**Expected output:**
```
ok:                              true
calculation.quantity:            1                  // дефолт применился
calculation.total_estimate:      === calculation.final_price
```

**Bonus — quantity > 1:**
```typescript
{
  product_type: 'mirror',
  width: 400,
  height: 600,
  quantity: 3,
}
```
```
calculation.quantity:        3
calculation.total_estimate:  === calculation.final_price × 3
```

---

## Test Case 6 — Delivery warning

**Input:**
```typescript
{
  product_type: 'shower',
  width: 900,
  height: 2000,
  delivery_required: true,
}
```

**Expected output:**
```
ok:       true
warnings: ['Стоимость доставки не включена...']
```

**Verify:** расчёт всё равно прошёл, warning не блокирует

---

## Test Case 7 — Installation mapped to withMounting

**Input:**
```typescript
{
  product_type: 'shower',
  width: 900,
  height: 2000,
  installation_required: true,
}
```

**Expected output:**
```
ok: true
calculation.service_lines: содержит строку с монтажом (name содержит 'монтаж' или 'installation')
```

**Verify:** `calculation.final_price` > цены без монтажа (сравнить с installation_required: false)

---

## Test Case 8 — Supabase unavailable (manual, requires mock or offline)

**Simulate:** отключить Supabase или очистить env vars

**Expected output:**
```
ok:               false
calculation:      null
errors:           [{ code: 'CALC_RUNTIME_ERROR' }]
errors[0].message: понятный текст без stack trace
```

**Verify:** raw Supabase error НЕ попадает в `errors[0].message`

---

## How to run manually

```typescript
// В Next.js API route или Node.js REPL:
import { runQuickCalcTool } from '@/lib/ai-tools/quickCalcTool'

const result = await runQuickCalcTool({
  product_type: 'mirror',
  width: 600,
  height: 900,
})
console.log(JSON.stringify(result, null, 2))
```
