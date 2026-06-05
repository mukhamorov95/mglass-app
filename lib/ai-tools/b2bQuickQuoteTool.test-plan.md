# b2bQuickQuoteTool — Test Plan

> Read-only tool. No DB writes. No model calls. All tests call `runB2BQuickQuoteTool(input)` directly.

---

## Safety invariants (all test cases)

Every result — success or failure — must have:

```
approval_required:   true
can_send_to_client:  false
can_write_crm:       false
can_create_order:    false
model_call_executed: false
```

---

## A. Valid mirror — B2B with override discount

**Input:**
```json
{
  "product_type": "mirror",
  "width": 600,
  "height": 900,
  "mirrorType": "silver",
  "thicknessMm": 4,
  "quantity": 20,
  "partner_discount_override": 15
}
```

**Expected:**
- `ok: true`
- `product_path: "quickCalc"`
- `items[0].line_item` — non-empty string from quickCalc description
- `items[0].dimensions: "600×900 мм"`
- `items[0].quantity: 20`
- `items[0].unit_price > 0`
- `items[0].total_price = items[0].unit_price × 20`
- `pricing.subtotal = items[0].total_price`
- `pricing.discount_percent: 15`
- `pricing.discount_amount = Math.round(subtotal × 0.15)`
- `pricing.final_total = subtotal - discount_amount`
- `pricing.currency: "RUB"`
- `pricing.vat_included: false`
- `manager_internal.partner_context.partner_discount_source: "override"`
- `manager_internal.partner_context.partner_discount: 15`
- `manager_internal.margin_estimate` — number (≈ base_margin - 15)
- `manager_internal.margin_status` — 'green' | 'yellow' | 'red'
- `client_message_draft` — contains "15%" and unit_price and final_total
- `client_message_draft` — does NOT contain "себестоимость", "margin", "cost"
- `errors: []`
- All safety flags set

---

## B. Valid mirror — with lighting, partner_type_id

**Input:**
```json
{
  "product_type": "mirror",
  "width": 800,
  "height": 600,
  "mirrorType": "crystal_vision",
  "thicknessMm": 4,
  "hasLighting": true,
  "quantity": 5,
  "partner_type_id": 1
}
```

**Expected:**
- `ok: true`
- `product_path: "quickCalc"`
- `items[0].unit_price` — includes lighting component cost (≈ different from no-lighting price)
- `manager_internal.partner_context.partner_discount_source: "partner_types"`
- `manager_internal.partner_context.partner_type_id: 1`
- If id=1 not found in partner_types: `ok: true` (warnings only, discount=0), warnings contains "не найден"
- If id=1 found and active: `partner_discount = partner_types[1].percent`
- `warnings` — may contain standard lighting kit warning from quickCalc
- All safety flags set

---

## C. Valid shower

**Input:**
```json
{
  "product_type": "shower",
  "width": 1200,
  "height": 2000,
  "quantity": 3
}
```

**Expected:**
- `ok: true`
- `product_path: "quickCalc"`
- `items[0].quantity: 3`
- `items[0].unit_price > 0`
- `pricing.subtotal = unit_price × 3`
- `pricing.discount_percent: 0`
- `pricing.discount_amount: 0`
- `pricing.final_total = pricing.subtotal`
- `manager_internal.partner_context.partner_discount_source: "none"`
- `manager_internal.partner_context.partner_discount: 0`
- All safety flags set

---

## D. Valid loft

**Input:**
```json
{
  "product_type": "loft",
  "width": 900,
  "height": 2100,
  "quantity": 2,
  "partner_discount_override": 10
}
```

**Expected:**
- `ok: true`
- `product_path: "quickCalc"`
- `pricing.discount_percent: 10`
- `pricing.final_total = subtotal - round(subtotal × 0.10)`
- All safety flags set

---

## E. Invalid dimensions — missing width

**Input:**
```json
{
  "product_type": "mirror",
  "height": 900,
  "quantity": 1
}
```

**Expected:**
- `ok: false`
- `missing_data: ["width"]`
- `errors[0].code: "MISSING_WIDTH"`
- `errors[0].field: "width"`
- `pricing: null`
- `client_message_draft: null`
- `manager_internal: null`
- All safety flags set

---

## F. Invalid dimensions — missing height

**Input:**
```json
{
  "product_type": "mirror",
  "width": 600
}
```

**Expected:**
- `ok: false`
- `missing_data: ["height"]`
- `errors[0].code: "MISSING_HEIGHT"`
- `pricing: null`
- All safety flags set

---

## G. Invalid quantity = 0

**Input:**
```json
{
  "product_type": "mirror",
  "width": 600,
  "height": 900,
  "quantity": 0
}
```

**Expected:**
- `ok: false`
- `errors[0].code: "INVALID_QUANTITY"`
- `errors[0].field: "quantity"`
- `pricing: null`
- All safety flags set

---

## H. Invalid quantity — non-integer

**Input:**
```json
{
  "product_type": "mirror",
  "width": 600,
  "height": 900,
  "quantity": 2.5
}
```

**Expected:**
- `ok: false`
- `errors[0].code: "INVALID_QUANTITY"`
- All safety flags set

---

## I. Unsupported product_type = glass

**Input:**
```json
{
  "product_type": "glass",
  "width": 600,
  "height": 900,
  "quantity": 10
}
```

**Expected:**
- `ok: false`
- `product_path: "unsupported"`
- `errors[0].code: "UNSUPPORTED_PRODUCT_TYPE_PHASE_1"`
- `errors[0].field: "product_type"`
- `pricing: null`
- `client_message_draft: null`
- `manager_internal: null`
- All safety flags set

---

## J. Unsupported product_type = cutting

**Input:**
```json
{
  "product_type": "cutting",
  "width": 600,
  "height": 900,
  "quantity": 5
}
```

**Expected:**
- `ok: false`
- `product_path: "unsupported"`
- `errors[0].code: "UNSUPPORTED_PRODUCT_TYPE_PHASE_1"`
- All safety flags set

---

## K. Safety flags — all requests

For every call to `runB2BQuickQuoteTool`, regardless of input validity or product type:

```
result.approval_required   === true
result.can_send_to_client  === false
result.can_write_crm       === false
result.can_create_order    === false
result.model_call_executed === false
result.tool                === 'b2bQuickQuote'
result.mode                === 'read_only'
```

---

## L. Partner context — override takes priority over partner_type_id

**Input:**
```json
{
  "product_type": "mirror",
  "width": 600,
  "height": 900,
  "quantity": 1,
  "partner_type_id": 1,
  "partner_discount_override": 20
}
```

**Expected:**
- `manager_internal.partner_context.partner_discount: 20`
- `manager_internal.partner_context.partner_discount_source: "override"`
- `manager_internal.partner_context.partner_type_id: undefined` (no DB read for override)
- Pricing uses 20% discount, NOT the partner_types.percent for id=1

---

## M. Partner context — unknown partner_type_id

**Input:**
```json
{
  "product_type": "mirror",
  "width": 600,
  "height": 900,
  "quantity": 1,
  "partner_type_id": 99999
}
```

**Expected:**
- `ok: true` (soft failure — warnings only)
- `manager_internal.partner_context.partner_discount: 0`
- `manager_internal.partner_context.partner_discount_source: "partner_types"`
- `warnings` — contains message about partner_type_id not found
- `pricing.discount_percent: 0`
- `pricing.final_total = pricing.subtotal`
- All safety flags set

---

## N. mirrorType bronze/graphite — fallback warning

**Input:**
```json
{
  "product_type": "mirror",
  "width": 600,
  "height": 900,
  "mirrorType": "bronze",
  "quantity": 1
}
```

**Expected:**
- `ok: true`
- `warnings` — contains message about bronze/graphite not supported, fallback to silver
- `pricing.final_total > 0`
- Calculation is based on silver pricing
- All safety flags set

---

## O. discount_override out of range

**Input:**
```json
{
  "product_type": "mirror",
  "width": 600,
  "height": 900,
  "quantity": 1,
  "partner_discount_override": 150
}
```

**Expected:**
- `ok: false`
- `errors[0].code: "INVALID_DISCOUNT_OVERRIDE"`
- `errors[0].field: "partner_discount_override"`
- `pricing: null`
- All safety flags set

---

## P. No DB writes verification

After any call (success or failure):
- `partner_types` table must have same row count (SELECT only)
- `agent_action_log` must NOT have a new row from this call
- `b2b_orders` must NOT have a new row
- `b2b_quotes` must NOT have a new row
- `calculations` must NOT have a new row

---

## Notes

- `client_message_draft` must never contain: "себестоимость", "margin", "маржа", "cost", "profit"
- `manager_internal` contains margin and warnings — not exposed to client
- `product_path: "b2bCalculator"` is reserved for Phase 2 (glass/cutting via lib/b2bCalculator.ts)
- margin_estimate is a rough approximation: `base_margin - discount_percent`; accurate costLines coming in Phase 2
