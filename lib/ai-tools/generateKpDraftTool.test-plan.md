# generateKpDraftTool — Manual Test Plan

**File under test:** `lib/ai-tools/generateKpDraftTool.ts`  
**Function:** `runGenerateKpDraftTool(input)`  
**Environment needed:** None (no Supabase, no Anthropic — input payload only)

---

## Test Case 1 — Valid mirror calculation → draft ok

**Input:**
```typescript
await runGenerateKpDraftTool({
  client_request:      'Зеркало с подсветкой для ванной комнаты',
  product_type:        'mirror',
  calculation_summary: {
    base_price:    12000,
    final_price:   15000,
    margin:        40,
    description:   'Зеркало Silver 600×900мм + подсветка',
    service_lines: [
      { name: 'Зеркало Silver', total: 9000 },
      { name: 'Подсветка LED', total: 3000 },
    ],
    quantity:       1,
    total_estimate: 15000,
    dimensions:     { width: 600, height: 900 },
  },
  pricing_rules_summary: {
    max_discount_percent: 10,
    sla_days_in_work:     10,
  },
})
```

**Expected:**
```
ok:                            true
mode:                          'skeleton'
draft:                         not null
draft.proposal_title:          содержит 'Зеркало с подсветкой' и '600×900мм'
draft.items:                   length === 2 (из service_lines)
draft.price_summary.total:     15000
draft.price_summary.note:      содержит '15 000 ₽'
draft.terms.production_days:   '10 рабочих дней'
draft.terms.validity_days:     14
draft.approval_block:          содержит 'ЧЕРНОВИК'
draft.manager_message:         содержит '⚠️'
approval_required:             true
can_send_to_client:            false
safety.no_db_write:            true
safety.model_call_executed:    false
errors:                        []
warnings:                      []
```

---

## Test Case 2 — Valid shower calculation → draft ok

**Input:**
```typescript
await runGenerateKpDraftTool({
  client_request:      'Душевая перегородка 900×2000мм, хром',
  product_type:        'shower',
  calculation_summary: {
    base_price:    45000,
    final_price:   52000,
    total_estimate: 52000,
    service_lines: [
      { name: 'Стекло закалённое 8мм', total: 30000 },
      { name: 'Фурнитура хром',        total: 12000 },
      { name: 'Монтаж',                total: 10000 },
    ],
    dimensions: { width: 900, height: 2000 },
  },
})
```

**Expected:**
```
ok:   true
draft.items: length === 3
draft.exclusions: НЕ содержит 'Монтажные работы' (монтаж уже в items)
draft.exclusions: содержит 'Доставка'
warnings: содержит сообщение о pricing_rules_summary
```

**Verify:** `draft.manager_message` содержит "проверьте маржу вручную" (т.к. pricing_rules_summary не передан)

---

## Test Case 3 — Отсутствует client_request → ok false

**Input:**
```typescript
await runGenerateKpDraftTool({
  client_request:      '',  // пустая строка
  product_type:        'mirror',
  calculation_summary: { base_price: 10000, final_price: 12000 },
})
```

**Expected:**
```
ok:                false
draft:             null
missing_data:      ['client_request']
errors:            [{ code: 'MISSING_CLIENT_REQUEST', field: 'client_request' }]
```

**Verify:** `errors[0].message` содержит понятный текст без технического стека

---

## Test Case 4 — Отсутствует calculation_summary → ok false

**Input:**
```typescript
await runGenerateKpDraftTool({
  client_request: 'Зеркало в ванную',
  product_type:   'mirror',
  calculation_summary: null as any,
})
```

**Expected:**
```
ok:           false
draft:        null
missing_data: ['calculation_summary']
errors:       [{ code: 'MISSING_CALCULATION_SUMMARY', field: 'calculation_summary' }]
```

**Variant — final_price === 0:**
```typescript
calculation_summary: { base_price: 0, final_price: 0 }
```
```
errors: [{ code: 'MISSING_PRICE', field: 'calculation_summary.final_price' }]
```

---

## Test Case 5 — Отсутствует pricing_rules_summary → ok true с warning

**Input:**
```typescript
await runGenerateKpDraftTool({
  client_request:      'Лофт-перегородка',
  product_type:        'loft',
  calculation_summary: { base_price: 80000, final_price: 95000 },
  // pricing_rules_summary не передан
})
```

**Expected:**
```
ok:       true
draft:    not null
errors:   []
warnings: содержит 'pricing_rules_summary не передан'
draft.terms.production_days: '7–14 рабочих дней'  // дефолт
```

**Verify:** tool не бросает исключение при отсутствии pricing_rules_summary

---

## Test Case 6 — Неизвестный product_type → warning, без ошибки

**Input:**
```typescript
await runGenerateKpDraftTool({
  client_request:      'Стеклянный балкон',
  product_type:        'balcony',
  calculation_summary: { base_price: 120000, final_price: 140000 },
})
```

**Expected:**
```
ok:       true
draft:    not null
errors:   []
warnings: содержит '"balcony" не распознан' + перечень известных типов
```

**Verify:** `draft.proposal_title` содержит 'balcony' как label (raw значение использовано без краша)

---

## Test Case 7 — allowModelCall: false → model не вызывается

**Input:**
```typescript
await runGenerateKpDraftTool({
  client_request:      'Зеркало 500×700',
  product_type:        'mirror',
  calculation_summary: { base_price: 8000, final_price: 10000 },
  allowModelCall:      false,  // явный false
})
```

**Expected:**
```
ok:                          true
mode:                        'skeleton'
safety.model_call_allowed:   false
safety.model_call_executed:  false
warnings: []  // нет предупреждений про model call
```

**Verify:** функция не делает никаких async HTTP-запросов, не импортирует Anthropic SDK

---

## Test Case 8 — allowModelCall: true → предупреждение, skeleton возвращается

**Input:**
```typescript
await runGenerateKpDraftTool({
  client_request:      'Зеркало 500×700',
  product_type:        'mirror',
  calculation_summary: { base_price: 8000, final_price: 10000 },
  allowModelCall:      true,
})
```

**Expected:**
```
ok:                          true
mode:                        'model_unavailable'
safety.model_call_allowed:   true
safety.model_call_executed:  false   // не вызван — ещё не подключён
warnings:                    содержит 'allowModelCall: true' + 'future binding'
draft:                       not null  // skeleton сформирован несмотря на это
```

**Verify:** нет исходящих HTTP-запросов, нет вызова Anthropic SDK

---

## Test Case 9 — Safety metadata и draft flags всегда верны

**Input:** любой корректный вход

**Expected (всегда):**
```
approval_required:           true
can_send_to_client:          false
can_write_crm:               false
can_create_order:            false
safety.no_db_write:          true
safety.no_crm_write:         true
safety.no_client_send:       true
safety.no_order_create:      true
safety.model_call_executed:  false
```

**Verify:** ни одно из этих полей не может быть изменено входными данными

---

## Test Case 10 — manager_message как draft-only инструкция

**Input:**
```typescript
await runGenerateKpDraftTool({
  client_request:      'Душевая',
  product_type:        'shower',
  calculation_summary: { base_price: 50000, final_price: 60000 },
})
```

**Expected:**
```
draft.manager_message: содержит '⚠️ ЧЕРНОВИК'
draft.manager_message: содержит 'Проверьте перед отправкой'
draft.manager_message: содержит 'самостоятельно через CRM'
draft.approval_block:  содержит 'pending_approval'
```

**Verify:** нет призыва к автоматической отправке. Нет URL, email, телефонных действий в тексте.

---

## Test Case 11 — Loft exclusions

**Input:**
```typescript
await runGenerateKpDraftTool({
  client_request:      'Лофт-перегородка офис',
  product_type:        'loft',
  calculation_summary: { base_price: 90000, final_price: 108000 },
})
```

**Expected:**
```
draft.exclusions: содержит 'управляющей компанией'
draft.exclusions: содержит 'Доставка'
draft.exclusions: содержит 'Монтажные работы'
```

---

## How to run manually

```typescript
// В Next.js API route или Node.js REPL:
import { runGenerateKpDraftTool } from '@/lib/ai-tools/generateKpDraftTool'

const result = await runGenerateKpDraftTool({
  client_request:      'Зеркало 600×900 с подсветкой',
  product_type:        'mirror',
  calculation_summary: {
    base_price:    12000,
    final_price:   15000,
    total_estimate: 15000,
    service_lines: [
      { name: 'Зеркало Silver', total: 9000 },
      { name: 'Подсветка LED', total: 3000 },
      { name: 'Монтаж', total: 3000 },
    ],
    dimensions: { width: 600, height: 900 },
  },
})
console.log(JSON.stringify(result.draft, null, 2))

// Совместно с quickCalcTool и pricingRulesTool:
const [calc, pricing] = await Promise.all([
  runQuickCalcTool({ product_type: 'mirror', width: 600, height: 900, installation_required: true }),
  runPricingRulesTool({ scope: 'mirror_light' }),
])

if (calc.ok && pricing.ok) {
  const kp = await runGenerateKpDraftTool({
    client_request:      'Зеркало с подсветкой для ванной',
    product_type:        'mirror',
    calculation_summary: {
      base_price:    calc.calculation!.base_price,
      final_price:   calc.calculation!.final_price,
      total_estimate: calc.calculation!.total_estimate,
      service_lines: calc.calculation!.service_lines,
      dimensions:    { width: 600, height: 900 },
    },
    pricing_rules_summary: {
      max_discount_percent: pricing.rules!.discount_limits.max_discount_percent,
      sla_days_in_work:     pricing.rules!.sla_targets.days_in_work,
    },
  })
  console.log(JSON.stringify(kp, null, 2))
}
```
