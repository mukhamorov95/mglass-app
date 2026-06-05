# createB2BQuickQuoteRuntime — Test Plan

> Runtime orchestrator. No DB writes. No model calls. Tests call `runCreateB2BQuickQuoteRuntime(input)`.

---

## Safety invariants (all test cases)

Every result must have:

```
approval_required:   true
can_send_to_client:  false
can_write_crm:       false
can_create_order:    false
model_call_executed: false
agent_key:           'b2b-sales-agent'
skill_key:           'b2b-quick-quote'
workflow_key:        'b2b-quick-quote-draft'
tool_key:            'b2bQuickQuote'
action_type:         'b2b_quote_draft_created'
```

---

## A. Valid mirror — ok=true, status=draft

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
- `status: "draft"`
- `draft_payload` — not null
- `draft_payload.quote_summary` — contains "20 шт." and final_total formatted as "79 XXX ₽"
- `draft_payload.quote_summary` — contains "скидки 15%"
- `draft_payload.items` — length 1, `items[0].quantity: 20`
- `draft_payload.pricing.discount_percent: 15`
- `draft_payload.pricing.final_total > 0`
- `draft_payload.client_message_draft` — non-null, contains final total
- `draft_payload.client_message_draft` — does NOT contain "себестоимость", "margin", "маржа"
- `draft_payload.manager_internal` — not null, has `margin_estimate`
- `draft_payload.input_summary` — non-empty
- `input_snapshot` — equals input
- `output_snapshot.ok: true`
- `output_snapshot.product_path: "quickCalc"`
- `errors: []`
- All safety flags set

---

## B. Valid mirror with lighting — ok=true, status=draft

**Input:**
```json
{
  "product_type": "mirror",
  "width": 800,
  "height": 600,
  "mirrorType": "crystal_vision",
  "thicknessMm": 4,
  "hasLighting": true,
  "quantity": 5
}
```

**Expected:**
- `ok: true`
- `status: "draft"`
- `draft_payload.pricing.discount_percent: 0`
- `draft_payload.pricing.final_total = draft_payload.pricing.subtotal`
- `draft_payload.quote_summary` — contains "5 шт." and "Итого:"
- `draft_payload.quote_summary` — does NOT contain "скидки" (no discount)
- `warnings` — may contain lighting standard kit warning from quickCalc
- All safety flags set

---

## C. Valid shower — ok=true, status=draft

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
- `status: "draft"`
- `draft_payload.items[0].quantity: 3`
- `draft_payload.pricing.discount_percent: 0`
- `draft_payload.manager_internal.partner_context.partner_discount_source: "none"`
- All safety flags set

---

## D. Invalid dimensions → ok=false, status=failed

**Input:**
```json
{
  "product_type": "mirror",
  "height": 900
}
```

**Expected:**
- `ok: false`
- `status: "failed"`
- `draft_payload: null`
- `errors[0].code: "MISSING_WIDTH"`
- `output_snapshot.ok: false`
- `input_snapshot` — equals input
- All safety flags set

---

## E. Unsupported glass → ok=false, status=failed

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
- `status: "failed"`
- `draft_payload: null`
- `errors[0].code: "UNSUPPORTED_PRODUCT_TYPE_PHASE_1"`
- `output_snapshot.product_path: "unsupported"`
- All safety flags set

---

## F. Safety flags — universal

For all inputs (valid and invalid), verify:

```
result.approval_required   === true   (literal, not truthy)
result.can_send_to_client  === false
result.can_write_crm       === false
result.can_create_order    === false
result.model_call_executed === false
result.agent_key           === 'b2b-sales-agent'
result.skill_key           === 'b2b-quick-quote'
result.workflow_key        === 'b2b-quick-quote-draft'
result.tool_key            === 'b2bQuickQuote'
result.action_type         === 'b2b_quote_draft_created'
```

---

## G. Warnings deduplication

**Setup:** Use an input that produces warnings in both `toolResult.warnings`
and `toolResult.manager_internal.warnings` (they share the same array in current impl).

**Expected:**
- `result.warnings` — no duplicate strings
- `Set(result.warnings).size === result.warnings.length`

---

## H. No side effects

After any call to `runCreateB2BQuickQuoteRuntime`:
- `agent_action_log` — no new row inserted
- `b2b_orders` — no new row
- `b2b_quotes` — no new row
- `calculations` — no new row
- `partner_types` — row count unchanged (SELECT only via b2bQuickQuoteTool)

---

## I. input_snapshot and output_snapshot integrity

For any call:
- `input_snapshot` is deep-equal to the original input passed to the runtime
- `output_snapshot` is the full `B2BQuickQuoteResult` returned by the tool
- `output_snapshot.tool === 'b2bQuickQuote'`
- `output_snapshot.mode === 'read_only'`

---

## J. quote_summary format

For a valid mirror result with discount:
```
draft_payload.quote_summary matches:
  /<line_item> <dimensions>, <qty> шт\. Итого после скидки <pct>%: <amount> ₽\./
```

For a valid result without discount:
```
draft_payload.quote_summary matches:
  /<line_item> <dimensions>, <qty> шт\. Итого: <amount> ₽\./
```

For a failed result:
```
draft_payload === null   (no quote_summary on failure)
```

---

## Notes

- Runtime does NOT call Anthropic/OpenAI at any stage
- `draft_payload` is structured for future storage in `agent_action_log.draft_payload` (JSONB)
- API route (Commit 4) will persist `input_snapshot`, `output_snapshot`, `draft_payload`, `warnings`, `errors` to Supabase
- `action_type: 'b2b_quote_draft_created'` is declared in `agentActionLogTypes.ts`
