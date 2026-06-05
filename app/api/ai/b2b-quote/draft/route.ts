// app/api/ai/b2b-quote/draft/route.ts
//
// POST /api/ai/b2b-quote/draft
//
// Runs createB2BQuickQuoteRuntime and returns the normalised draft response.
// Does NOT write to agent_action_log at this stage —
// persistence is handled in Commit 5 (Approval UI integration).
//
// Safety guarantees (inherited from runtime + hardcoded here):
//   approval_required   — true, always
//   can_send_to_client  — false, always
//   can_write_crm       — false, always
//   can_create_order    — false, always
//   model_call_executed — false, always
//   agent_action_log    — NOT written by this route

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { runCreateB2BQuickQuoteRuntime } from '@/lib/ai-tools/createB2BQuickQuoteRuntime'
import type { B2BQuickQuoteInput } from '@/lib/ai-tools/b2bQuickQuoteTool'

const ALLOWED_ROLES = new Set(['admin', 'manager', 'buyer'])

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!ALLOWED_ROLES.has((userRow as { role: string } | null)?.role ?? '')) {
    return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Неверный формат запроса' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'Неверный формат запроса' }, { status: 400 })
  }

  const b = body as Record<string, unknown>

  // ── Build typed input ─────────────────────────────────────────────────────
  // Validation happens inside the runtime/tool — route only extracts fields.
  const input: B2BQuickQuoteInput = {
    product_type: (typeof b.product_type === 'string' ? b.product_type : '') as B2BQuickQuoteInput['product_type'],
    width:        typeof b.width  === 'number' ? b.width  : (undefined as unknown as number),
    height:       typeof b.height === 'number' ? b.height : (undefined as unknown as number),

    ...(typeof b.quantity === 'number'       && { quantity:       b.quantity }),
    ...(typeof b.mirrorType === 'string'     && { mirrorType:     b.mirrorType as B2BQuickQuoteInput['mirrorType'] }),
    ...(typeof b.thicknessMm === 'number'    && { thicknessMm:    b.thicknessMm as B2BQuickQuoteInput['thicknessMm'] }),
    ...(typeof b.hasLighting === 'boolean'   && { hasLighting:    b.hasLighting }),
    ...(typeof b.partner_type_id === 'number'          && { partner_type_id:          b.partner_type_id }),
    ...(typeof b.partner_discount_override === 'number' && { partner_discount_override: b.partner_discount_override }),
    ...(typeof b.urgency === 'string'        && { urgency:        b.urgency as B2BQuickQuoteInput['urgency'] }),
    ...(typeof b.raw_request === 'string'    && { raw_request:    b.raw_request }),
    ...(typeof b.manager_notes === 'string'  && { manager_notes:  b.manager_notes }),
  }

  // ── Run runtime ───────────────────────────────────────────────────────────
  let result
  try {
    result = await runCreateB2BQuickQuoteRuntime(input)
  } catch (err) {
    console.error('[POST /api/ai/b2b-quote/draft] runtime threw unexpectedly:', err)
    return NextResponse.json(
      { ok: false, error: 'Не удалось сформировать B2B quick quote' },
      { status: 500 },
    )
  }

  // ── HTTP status selection ─────────────────────────────────────────────────
  // 400 — client validation errors (bad input fields)
  // 500 — unexpected internal error
  // 200 — all other cases (ok=true draft or ok=false business failure)
  const validationCodes = new Set([
    'MISSING_WIDTH',
    'MISSING_HEIGHT',
    'INVALID_QUANTITY',
    'INVALID_DISCOUNT_OVERRIDE',
    'UNSUPPORTED_PRODUCT_TYPE_PHASE_1',
  ])

  if (!result.ok && result.errors.length > 0) {
    const firstCode = result.errors[0].code
    if (firstCode === 'RUNTIME_UNEXPECTED_ERROR') {
      return NextResponse.json(result, { status: 500 })
    }
    if (validationCodes.has(firstCode)) {
      return NextResponse.json(result, { status: 400 })
    }
  }

  return NextResponse.json(result, { status: 200 })
}
