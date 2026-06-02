# pricingRulesTool — Manual Test Plan

**File under test:** `lib/ai-tools/pricingRulesTool.ts`  
**Function:** `runPricingRulesTool(input?)`  
**Environment needed:** Supabase connection (financial_settings table populated)

---

## Test Case 1 — financial_settings populated, no input

**Input:**
```typescript
await runPricingRulesTool()
// or
await runPricingRulesTool({})
```

**Expected output:**
```
ok:                            true
tool:                          'readPricingRules'
mode:                          'read_only'
source:                        'financial_settings'
rules:                         not null
rules.margin_thresholds:
  default_margin:              > 0
  min_margin:                  > 0
  green_threshold:             > 0
  yellow_threshold:            > 0
  red_threshold:               > 0
  blocked_below:               >= 0
rules.discount_limits:
  max_discount_percent:        >= 0
rules.expense_breakdown:
  total_expenses_percent:      === sum of all 6 expense fields
rules.sla_targets:
  days_approved:               >= 0
  days_in_work:                >= 0
rules.matched_row:             id, tier, product_type, updated_at not null
rules.all_rows_summary:        array length >= 1
warnings:                      []  (если данные корректны)
errors:                        []
approval_required:             false
can_change_price:              false
can_send_to_client:            false
safety.no_db_write:            true
safety.no_crm_write:           true
safety.no_external_request:    true
```

**Verify:** `total_expenses_percent` === `tax_percent + manager_percent + realization_percent + marketing_percent + transport_percent + operation_percent`

---

## Test Case 2 — financial_settings пустая

**Simulate:** временно очистить таблицу или заменить запрос на мок, возвращающий `[]`

**Expected output:**
```
ok:             false
rules:          null
errors:         [{ code: 'EMPTY_SETTINGS' }]
errors[0].message: содержит '/admin/settings'  (понятный текст для пользователя)
warnings:       []
```

**Verify:** `errors[0].message` не содержит Supabase stack trace или имена внутренних таблиц

---

## Test Case 3 — Supabase недоступен

**Simulate:** отключить Supabase env vars или сымитировать network error

**Expected output:**
```
ok:             false
rules:          null
errors:         [{ code: 'FETCH_ERROR' }]
errors[0].message: понятный текст без stack trace
```

**Verify:** сырая ошибка Supabase залоггирована в `console.error` (в логах сервера), но НЕ попадает в `errors[0].message`

---

## Test Case 4 — Неизвестный scope

**Input:**
```typescript
await runPricingRulesTool({ scope: 'furniture' })
```

**Expected output:**
```
ok:       true   (tool не ломается)
rules:    not null  (использует fallback — standard tier)
warnings: содержит строку про отсутствие scope "furniture"
errors:   []
```

**Verify:** `rules.matched_row.tier` === `'standard'` (fallback применился)

---

## Test Case 5 — Известный scope с совпадением в таблице

**Input:**
```typescript
await runPricingRulesTool({ scope: 'mirror_light' })
// При условии, что в financial_settings есть строка с product_type = 'mirror_light'
```

**Expected output:**
```
ok:                        true
rules.matched_row.product_type: 'mirror_light'
warnings: []   (совпадение найдено, fallback не нужен)
```

**Verify:** `rules.matched_row.product_type` соответствует запрошенному scope

---

## Test Case 6 — Неизвестный tier

**Input:**
```typescript
await runPricingRulesTool({ tier: 'premium' as any })
```

**Expected output:**
```
ok:       true   (tool не ломается, tier проигнорирован)
rules:    not null
warnings: содержит 'premium' + перечень допустимых значений (standard, budget)
errors:   []
```

**Verify:** `warnings[0]` содержит 'standard' и 'budget' как допустимые

---

## Test Case 7 — Проверка safety metadata

**Input:**
```typescript
const result = await runPricingRulesTool()
```

**Expected:**
```
result.safety.no_db_write:         true
result.safety.no_crm_write:        true
result.safety.no_external_request: true
result.safety.no_client_send:      true
result.safety.reads_supabase:      true
result.can_change_price:           false
result.can_send_to_client:         false
result.approval_required:          false
```

**Verify:** все поля safety присутствуют и корректны

---

## Test Case 8 — Совместимость с create-commercial-proposal flow

**Simulate:** вызвать `runQuickCalcTool` + `runPricingRulesTool` в одном контексте

```typescript
const [calc, pricing] = await Promise.all([
  runQuickCalcTool({ product_type: 'mirror', width: 600, height: 900 }),
  runPricingRulesTool({ scope: 'mirror_light' }),
])
```

**Expected:**
```
calc.ok:    true
pricing.ok: true

// Проверить согласованность:
// margin из quickCalc ≥ pricing.rules.margin_thresholds.blocked_below
// margin из quickCalc ≥ pricing.rules.margin_thresholds.min_margin
// calc.calculation.margin === pricing.rules.margin_thresholds.default_margin
//   (если quickCalc использует ту же строку настроек)
```

**Verify:** tool не вызывает side effects при параллельном запуске. Оба результата независимы.

---

## How to run manually

```typescript
// В Next.js API route или Node.js REPL:
import { runPricingRulesTool } from '@/lib/ai-tools/pricingRulesTool'

// Базовый вызов
const result = await runPricingRulesTool()
console.log(JSON.stringify(result, null, 2))

// С фильтром по product_type
const resultMirror = await runPricingRulesTool({ scope: 'mirror_light' })
console.log(JSON.stringify(resultMirror.rules?.margin_thresholds, null, 2))
```
