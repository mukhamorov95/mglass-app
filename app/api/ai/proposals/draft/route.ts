// app/api/ai/proposals/draft/route.ts
//
// POST /api/ai/proposals/draft
//
// Runs createCommercialProposalRuntime and persists the result
// to agent_action_log via service role.
//
// Safety guarantees (inherited from runtime):
//   can_send_to_client  — false, always
//   can_write_crm       — false, always
//   can_create_order    — false, always
//   model_call_executed — false at stage 1
//   approval_required   — true, always

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { runCreateCommercialProposalRuntime } from '@/lib/ai-tools/createCommercialProposalRuntime'
import type { AgentActionLogInsert } from '@/lib/ai-tools/agentActionLogTypes'

const ALLOWED_ROLES = new Set(['admin', 'manager'])

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

  // ── Parse and validate input ──────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Неверный формат запроса' }, { status: 400 })
  }

  const clientRequest = typeof body.client_request === 'string' ? body.client_request.trim() : ''
  const productType   = typeof body.product_type   === 'string' ? body.product_type.trim()   : ''

  if (!clientRequest) return NextResponse.json({ error: 'client_request обязателен' }, { status: 400 })
  if (!productType)   return NextResponse.json({ error: 'product_type обязателен'   }, { status: 400 })

  const width    = typeof body.width    === 'number' ? body.width    : undefined
  const height   = typeof body.height   === 'number' ? body.height   : undefined
  const quantity = typeof body.quantity === 'number' ? body.quantity : undefined
  const options  = body.options && typeof body.options === 'object' && !Array.isArray(body.options)
    ? (body.options as Record<string, unknown>)
    : undefined

  const installationRequired = body.installation_required != null ? Boolean(body.installation_required) : undefined
  const deliveryRequired     = body.delivery_required     != null ? Boolean(body.delivery_required)     : undefined
  const addressOrZone  = typeof body.address_or_zone === 'string' ? body.address_or_zone  : undefined
  const managerNotes   = typeof body.manager_notes   === 'string' ? body.manager_notes    : undefined
  const companyContext = typeof body.company_context === 'string' ? body.company_context  : undefined
  const clientName     = typeof body.client_name     === 'string' ? body.client_name.trim() || null : null

  // ── Run orchestrator ──────────────────────────────────────────────────────
  let runtime
  try {
    runtime = await runCreateCommercialProposalRuntime({
      client_request:        clientRequest,
      product_type:          productType,
      width,
      height,
      quantity,
      options,
      installation_required: installationRequired,
      delivery_required:     deliveryRequired,
      address_or_zone:       addressOrZone,
      manager_notes:         managerNotes,
      company_context:       companyContext,
      allowModelCall:        false,
    })
  } catch (err) {
    console.error('[POST /api/ai/proposals/draft] runtime error:', err)
    return NextResponse.json({ error: 'Ошибка при генерации черновика' }, { status: 500 })
  }

  // ── Persist to agent_action_log via service role ──────────────────────────
  const record: AgentActionLogInsert = {
    agent_key:    'proposal-engineer-agent',
    skill_key:    'create-commercial-proposal',
    workflow_key: 'proposal-draft-runtime',
    action_type:  runtime.ok ? 'proposal_draft_created' : 'error',
    status:       runtime.ok ? 'pending_approval'        : 'failed',

    client_name:    clientName,
    proposal_title: runtime.draft?.proposal_title ?? null,

    input_snapshot: {
      client_request:        clientRequest,
      product_type:          productType,
      width:                 width ?? null,
      height:                height ?? null,
      quantity:              quantity ?? null,
      installation_required: installationRequired ?? null,
      delivery_required:     deliveryRequired ?? null,
      address_or_zone:       addressOrZone ?? null,
      manager_notes:         managerNotes ?? null,
      company_context:       companyContext ?? null,
      client_name:           clientName,
    },
    output_snapshot: {
      ok:           runtime.ok,
      mode:         runtime.mode,
      steps:        runtime.steps,
      failed_step:  runtime.failed_step ?? null,
      missing_data: runtime.missing_data,
    },
    draft_payload:   runtime.draft as unknown as Record<string, unknown> | null ?? null,
    safety_snapshot: runtime.safety as unknown as Record<string, unknown>,

    approval_required:   true,
    can_send_to_client:  false,
    can_write_crm:       false,
    can_create_order:    false,
    model_call_executed: false,

    warnings: runtime.warnings,
    errors:   runtime.errors as AgentActionLogInsert['errors'],

    created_by: user.email ?? user.id,
  }

  // ── Persist to agent_action_log — insert failure is a hard error ─────────
  // Rationale: without a saved id there is no way to open, approve, or reject
  // this draft in the Approval UI. A runtime result with id: null is unusable.
  const SAVE_ERROR_RESPONSE = {
    ok:                 false,
    status:             'failed_to_save',
    message:            'Черновик создан, но не удалось сохранить его для проверки. Повторите попытку или обратитесь к администратору.',
    id:                 null,
    approval_required:  true,
    can_send_to_client: false,
    can_write_crm:      false,
    can_create_order:   false,
  } as const

  let insertedId: number
  try {
    const svc = createServiceClient()
    const { data: inserted, error: insertError } = await svc
      .from('agent_action_log')
      .insert(record)
      .select('id')
      .single()

    if (insertError || !inserted) {
      console.error('[POST /api/ai/proposals/draft] insert error:', insertError)
      return NextResponse.json(SAVE_ERROR_RESPONSE, { status: 500 })
    }

    insertedId = (inserted as { id: number }).id
  } catch (err) {
    console.error('[POST /api/ai/proposals/draft] service client threw:', err)
    return NextResponse.json(SAVE_ERROR_RESPONSE, { status: 500 })
  }

  // ── Normalised response — no raw DB data, no secrets ─────────────────────
  // ok reflects runtime success; id is always present (insert was confirmed above).
  return NextResponse.json({
    ok:             runtime.ok,
    id:             insertedId,
    status:         runtime.ok ? 'pending_approval' : 'failed',
    proposal_title: runtime.draft?.proposal_title ?? null,
    calculation: runtime.calculation ? {
      total_estimate: runtime.calculation.total_estimate,
      final_price:    runtime.calculation.final_price,
      description:    runtime.calculation.description,
      calc_source:    runtime.calculation.calc_source,
    } : null,
    warnings:           runtime.warnings,
    errors:             runtime.errors,
    missing_data:       runtime.missing_data,
    failed_step:        runtime.failed_step ?? null,
    approval_required:  true,
    can_send_to_client: false,
    can_write_crm:      false,
    can_create_order:   false,
  })
}
