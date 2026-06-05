# POST /api/ai/b2b-quote/draft — Test Plan

> HTTP API layer. Tests call `POST /api/ai/b2b-quote/draft` with a JSON body.
> No DB writes. No model calls. No agent_action_log inserts.

---

## A. 401 — unauthenticated

**Setup:** no session cookie / expired token.

**Expected:**
- HTTP 401
- `{ error: 'Не авторизован' }`

---

## B. 403 — wrong role

**Setup:** authenticated user with role `production` or `seo`.

**Body:** any valid B2B input.

**Expected:**
- HTTP 403
- `{ error: 'Доступ запрещён' }`

---

## C. 400 — malformed JSON

**Setup:** `Content-Type: application/json`, body = `"not json {{{"`

**Expected:**
- HTTP 400
- `{ error: 'Неверный формат запроса' }`

---

## D. 400 — missing width (validation error)

**Setup:** authenticated user with role `admin` or `manager` or `buyer`.

**Body:**
```json
{ "product_type": "mirror", "height": 900, "quantity": 5 }
```

**Expected:**
- HTTP 400
- `result.ok: false`
- `result.errors[0].code: "MISSING_WIDTH"`
- `result.draft_payload: null`
- `result.approval_required: true`
- `result.can_send_to_client: false`

---

## E. 400 — unsupported product_type

**Body:**
```json
{ "product_type": "glass", "width": 600, "height": 900, "quantity": 10 }
```

**Expected:**
- HTTP 400
- `result.errors[0].code: "UNSUPPORTED_PRODUCT_TYPE_PHASE_1"`

---

## F. 200 ok=true — valid mirror with discount (role=manager)

**Body:**
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
- HTTP 200
- `result.ok: true`
- `result.status: "draft"`
- `result.draft_payload` — not null
- `result.draft_payload.pricing.discount_percent: 15`
- `result.draft_payload.pricing.final_total > 0`
- `result.draft_payload.client_message_draft` — non-null, no internal margin data
- `result.agent_key: "b2b-sales-agent"`
- `result.action_type: "b2b_quote_draft_created"`
- `result.approval_required: true`
- `result.can_send_to_client: false`
- `result.can_write_crm: false`
- `result.can_create_order: false`
- `result.model_call_executed: false`
- **agent_action_log** — no new row inserted

---

## G. 200 ok=false — business failure (invalid_quantity) returns 200 not 400

**Note:** `INVALID_QUANTITY` is a validation code → returns 400 (see test D pattern).
Business failures with unlisted codes → 200 with `ok: false`.

**Body:**
```json
{
  "product_type": "mirror",
  "width": 600,
  "height": 900,
  "quantity": 20,
  "partner_discount_override": 150
}
```

**Expected:**
- HTTP 400 (INVALID_DISCOUNT_OVERRIDE is in validationCodes set)
- `result.ok: false`
- `result.errors[0].code: "INVALID_DISCOUNT_OVERRIDE"`

---

## Safety — all responses

For every response (success or failure):
```
result.approval_required   === true
result.can_send_to_client  === false
result.can_write_crm       === false
result.can_create_order    === false
result.model_call_executed === false
```

These fields must be present in the HTTP response body and equal the listed values.
`agent_action_log` must have no new rows after any call to this route.
