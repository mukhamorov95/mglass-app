# createCommercialProposalRuntime — Manual Test Plan

**File under test:** `lib/ai-tools/createCommercialProposalRuntime.ts`  
**Function:** `runCreateCommercialProposalRuntime(input)`  
**Environment needed:** Supabase connection (quickCalc reads materials/services/financial_settings; pricingRules reads financial_settings)

---

## Test Case 1 — Valid mirror input → full draft ok

**Input:**
```typescript
await runCreateCommercialProposalRuntime({
  client_request:        'Зеркало с подсветкой для ванной',
  product_type:          'mirror',
  width:                 600,
  height:                900,
  installation_required: false,
})
```

**Expected:**
```
ok:                            true
mode:                          'draft'
steps:                         length === 4
steps[0]:                      { key: 'validation',      ok: true }
steps[1]:                      { key: 'quickCalc',       ok: true }
steps[2]:                      { key: 'pricingRules',    ok: true }
steps[3]:                      { key: 'generateKpDraft', ok: true }
calculation:                   not null
calculation.calc_source:       'quickCalc'
calculation.final_price:       > 0
pricing_rules:                 not null  (если financial_settings заполнена)
pricing_rules.margin_thresholds.default_margin: > 0
draft:                         not null
draft.proposal_title:          содержит 'Зеркало' и '600×900'
draft.approval_block:          содержит 'ЧЕРНОВИК'
approval_required:             true
can_send_to_client:            false
safety.model_call_executed:    false
safety.reads_supabase_via_tools: true
errors:                        []
```

---

## Test Case 2 — Valid shower input → full draft ok

**Input:**
```typescript
await runCreateCommercialProposalRuntime({
  client_request:        'Душевая перегородка 900×2000мм',
  product_type:          'shower',
  width:                 900,
  height:                2000,
  installation_required: true,
  quantity:              1,
})
```

**Expected:**
```
ok:   true
steps: все 4 ok
calculation.service_lines: содержит монтаж (installation_required: true)
draft.items: содержит позиции из service_lines
draft.exclusions: НЕ содержит 'Монтаж' (монтаж уже в items)
draft.terms.production_days: либо из pricingRules.sla_targets, либо '7–14 рабочих дней'
```

---

## Test Case 3 — Отсутствует client_request → validation failure

**Input:**
```typescript
await runCreateCommercialProposalRuntime({
  client_request: '',
  product_type:   'mirror',
  width:          600,
  height:         900,
})
```

**Expected:**
```
ok:          false
failed_step: 'validation'
steps:       [{ key: 'validation', ok: false }]
errors:      [{ code: 'MISSING_CLIENT_REQUEST', step: 'validation' }]
calculation: null
draft:       null
```

**Verify:** шаги quickCalc, pricingRules, generateKpDraft НЕ вызывались

---

## Test Case 4 — Отсутствуют размеры (width/height) → validation failure

**Input:**
```typescript
await runCreateCommercialProposalRuntime({
  client_request: 'Зеркало',
  product_type:   'mirror',
  // width и height не переданы
})
```

**Expected:**
```
ok:           false
failed_step:  'validation'
missing_data: ['width', 'height']
errors:       содержит MISSING_WIDTH и MISSING_HEIGHT
```

**Variant — width: -100:**
```
errors: [{ code: 'INVALID_WIDTH', step: 'validation' }]
```

---

## Test Case 5 — Неизвестный product_type → quickCalc failure

**Input:**
```typescript
await runCreateCommercialProposalRuntime({
  client_request: 'Нестандартное изделие',
  product_type:   'furniture',
  width:          1000,
  height:         2000,
})
```

**Expected:**
```
ok:          false
failed_step: 'quickCalc'
steps:       [validation ok, quickCalc false]
errors:      [{ code: 'UNSUPPORTED_PRODUCT_TYPE', step: 'quickCalc' }]
calculation: null
draft:       null
```

---

## Test Case 6 — pricingRules failure (Supabase недоступен) → warning, flow продолжается

**Simulate:** очистить env vars для Supabase или заглушить financial_settings

**Expected:**
```
ok:   true   (если quickCalc и generateKpDraft прошли)
steps[2]:    { key: 'pricingRules', ok: false }
pricing_rules: null
warnings:    содержит сообщение о недоступных правилах ценообразования
draft:       not null  (skeleton сформирован без pricing_rules)
errors:      []  (pricing failure не блокирует)
```

**Verify:** draft.manager_message содержит "проверьте маржу вручную"

---

## Test Case 7 — generateKpDraft failure (impossible under normal conditions, simulate via bad calc)

**Note:** В нормальном flow генерация черновика всегда успешна при валидном расчёте.  
Для теста: если в будущем добавить мок, который возвращает `final_price: 0` после quickCalc.

**Expected:**
```
ok:          false
failed_step: 'generateKpDraft'
steps:       [validation ok, quickCalc ok, pricingRules ok/skip, generateKpDraft false]
calculation: не null  (расчёт прошёл успешно)
draft:       null
```

---

## Test Case 8 — allowModelCall: true → model_call_executed остаётся false

**Input:**
```typescript
await runCreateCommercialProposalRuntime({
  client_request:  'Зеркало',
  product_type:    'mirror',
  width:           500,
  height:          700,
  allowModelCall:  true,
})
```

**Expected:**
```
ok:                          true
safety.model_call_executed:  false   — жёсткая константа
safety.model_call_allowed:   не в safety orchestrator (только в draft safety внутри KpDraftTool)
warnings:                    содержит 'allowModelCall: true' + 'future binding'
draft.mode:                  'model_unavailable'  (из generateKpDraftTool)
```

---

## Test Case 9 — approval_required всегда true

**Input:** любой корректный или некорректный вход

**Expected (всегда):**
```
approval_required:  true
can_send_to_client: false
can_write_crm:      false
can_create_order:   false
```

**Verify:** эти поля не зависят от входных данных — жёсткие константы в ответе

---

## Test Case 10 — can_send_to_client всегда false

**Input:** успешный корректный вход с allowModelCall: true

**Expected:**
```
can_send_to_client: false   — НИКОГДА не меняется
```

**Verify:** draft.approval_block содержит 'pending_approval'

---

## Test Case 11 — No CRM / DB write / order create

**Проверяется интеграционно.**  
После вызова `runCreateCommercialProposalRuntime(...)`:
- Supabase `calculations`, `agent_logs`, `order_groups` — количество записей НЕ изменилось
- AmoCRM GET-только — никаких POST/PATCH запросов к CRM
- Производственный заказ не создан

**Verify:** `safety.no_db_write: true`, `safety.no_crm_write: true`, `safety.no_order_create: true`

---

## Test Case 12 — Warnings агрегируются из всех tools

**Input:**
```typescript
await runCreateCommercialProposalRuntime({
  client_request:       'Лофт большой',
  product_type:         'loft',
  width:                3500,   // > 3000 → warning из quickCalcTool
  height:               2100,
  allowModelCall:       true,   // → warning из generateKpDraftTool
  // pricing_rules_summary не будет передана автоматически если Supabase недоступна
})
```

**Expected:**
```
warnings: length >= 2 (из quickCalcTool + из generateKpDraftTool)
  - quickCalcTool:       'Размеры превышают 3000 мм...'
  - generateKpDraftTool: 'allowModelCall: true ... future binding'
errors: []
ok: true
```

**Verify:** `result.warnings` является flat-массивом всех предупреждений из всех steps

---

## How to run manually

```typescript
// В Next.js API route или Node.js REPL:
import { runCreateCommercialProposalRuntime } from '@/lib/ai-tools/createCommercialProposalRuntime'

// Полный успешный сценарий
const result = await runCreateCommercialProposalRuntime({
  client_request:        'Зеркало с подсветкой для ванной комнаты',
  product_type:          'mirror',
  width:                 600,
  height:                900,
  installation_required: false,
  manager_notes:         'Клиент хочет серебряное покрытие',
})
console.log('ok:', result.ok)
console.log('steps:', result.steps.map(s => `${s.key}: ${s.ok}`))
console.log('price:', result.calculation?.final_price)
console.log('draft title:', result.draft?.proposal_title)
console.log('warnings:', result.warnings)

// Inspect safety guarantees
console.log('safety:', result.safety)
console.log('approval_required:', result.approval_required)
console.log('can_send_to_client:', result.can_send_to_client)
```
