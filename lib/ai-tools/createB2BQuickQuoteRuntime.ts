// lib/ai-tools/createB2BQuickQuoteRuntime.ts
//
// Orchestrator for the b2b-quick-quote runtime flow.
// Single-tool pipeline: runB2BQuickQuoteTool → normalised runtime response.
//
// SAFE PROFILE:
//   writes Supabase           — no (b2bQuickQuoteTool reads partner_types only)
//   writes agent_action_log   — no (output_snapshot ready for API route to persist)
//   writes CRM                — no
//   creates orders            — no
//   external HTTP             — no
//   sends to client           — NEVER (draft only)
//   Anthropic/OpenAI model    — NOT called (model_call_executed always false)
//   throws raw errors         — no
//   approval_required         — always true
//   can_send_to_client        — always false
//
// Stage: 2 — Runtime wrapper. Next stage: API route persists output to agent_action_log.
//
// Used by: b2b-sales-agent / b2b-quick-quote skill
// Entry point for b2b-quick-quote-draft workflow.

import {
  runB2BQuickQuoteTool,
  type B2BQuickQuoteInput,
  type B2BQuickQuoteResult,
  type B2BQuoteItem,
  type B2BQuotePricing,
  type B2BManagerInternal,
} from './b2bQuickQuoteTool'

// ─── Re-export input alias ─────────────────────────────────────────────────────

export type B2BQuickQuoteRuntimeInput = B2BQuickQuoteInput

// ─── Draft payload ────────────────────────────────────────────────────────────
// Structured for future storage in agent_action_log.draft_payload (JSONB).

export type B2BQuickQuoteDraftPayload = {
  quote_summary:        string                   // short human-readable summary
  items:                B2BQuoteItem[]
  pricing:              B2BQuotePricing | null
  client_message_draft: string | null            // ready to copy, no internal data
  manager_internal:     B2BManagerInternal | null
  input_summary:        string
}

// ─── Runtime response ─────────────────────────────────────────────────────────

export type B2BQuickQuoteRuntimeResponse = {
  ok:            boolean
  status:        'draft' | 'failed'
  agent_key:     'b2b-sales-agent'
  skill_key:     'b2b-quick-quote'
  workflow_key:  'b2b-quick-quote-draft'
  tool_key:      'b2bQuickQuote'
  action_type:   'b2b_quote_draft_created'

  input_snapshot:  B2BQuickQuoteInput
  output_snapshot: B2BQuickQuoteResult
  draft_payload:   B2BQuickQuoteDraftPayload | null

  warnings: string[]
  errors:   Array<{ code: string; message: string; field?: string }>

  approval_required:   true
  can_send_to_client:  false
  can_write_crm:       false
  can_create_order:    false
  model_call_executed: false
}

// ─── Safety flags (hardcoded) ─────────────────────────────────────────────────

const SAFETY_FLAGS = {
  approval_required:   true  as const,
  can_send_to_client:  false as const,
  can_write_crm:       false as const,
  can_create_order:    false as const,
  model_call_executed: false as const,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('ru-RU') + ' ₽'
}

function buildQuoteSummary(toolResult: B2BQuickQuoteResult): string {
  if (!toolResult.ok || !toolResult.pricing || toolResult.items.length === 0) {
    return 'Расчёт B2B quote не выполнен.'
  }
  const item    = toolResult.items[0]
  const dims    = item.dimensions ? ` ${item.dimensions}` : ''
  const qty     = item.quantity
  const pricing = toolResult.pricing

  if (pricing.discount_percent > 0) {
    return `${item.line_item}${dims}, ${qty} шт. Итого после скидки ${pricing.discount_percent}%: ${fmt(pricing.final_total)}.`
  }
  return `${item.line_item}${dims}, ${qty} шт. Итого: ${fmt(pricing.final_total)}.`
}

// Deduplicate warnings from tool-level and manager_internal — same array in most cases,
// but deduplication guards against future divergence.
function dedupeWarnings(toolResult: B2BQuickQuoteResult): string[] {
  const combined = [
    ...toolResult.warnings,
    ...(toolResult.manager_internal?.warnings ?? []),
  ]
  return Array.from(new Set(combined))
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function runCreateB2BQuickQuoteRuntime(
  input: B2BQuickQuoteRuntimeInput,
): Promise<B2BQuickQuoteRuntimeResponse> {

  const META = {
    agent_key:    'b2b-sales-agent' as const,
    skill_key:    'b2b-quick-quote' as const,
    workflow_key: 'b2b-quick-quote-draft' as const,
    tool_key:     'b2bQuickQuote' as const,
    action_type:  'b2b_quote_draft_created' as const,
  }

  // ── Call b2bQuickQuoteTool ─────────────────────────────────────────────────
  // All validation, partner context loading, and calculation happen inside the tool.
  // Runtime's sole job: normalise the result into a persistable envelope.

  let toolResult: B2BQuickQuoteResult
  try {
    toolResult = await runB2BQuickQuoteTool(input)
  } catch (err) {
    console.error('[createB2BQuickQuoteRuntime] runB2BQuickQuoteTool threw unexpectedly:', err)
    // Build a minimal synthetic failed result to keep the response shape consistent
    const syntheticResult: B2BQuickQuoteResult = {
      ok:                   false,
      tool:                 'b2bQuickQuote',
      mode:                 'read_only',
      product_path:         'quickCalc',
      input_summary:        `${input.product_type} ${input.width}×${input.height}мм`,
      items:                [],
      pricing:              null,
      client_message_draft: null,
      manager_internal:     null,
      missing_data:         [],
      warnings:             [],
      errors: [{
        code:    'RUNTIME_UNEXPECTED_ERROR',
        message: 'Неожиданная ошибка при выполнении расчёта. Попробуйте ещё раз или обратитесь к администратору.',
      }],
      ...SAFETY_FLAGS,
    }
    return {
      ok:             false,
      status:         'failed',
      ...META,
      input_snapshot:  input,
      output_snapshot: syntheticResult,
      draft_payload:   null,
      warnings:        [],
      errors:          syntheticResult.errors,
      ...SAFETY_FLAGS,
    }
  }

  // ── Failed tool result ─────────────────────────────────────────────────────

  if (!toolResult.ok) {
    return {
      ok:             false,
      status:         'failed',
      ...META,
      input_snapshot:  input,
      output_snapshot: toolResult,
      draft_payload:   null,
      warnings:        dedupeWarnings(toolResult),
      errors:          toolResult.errors,
      ...SAFETY_FLAGS,
    }
  }

  // ── Successful tool result → build draft payload ───────────────────────────

  const draftPayload: B2BQuickQuoteDraftPayload = {
    quote_summary:        buildQuoteSummary(toolResult),
    items:                toolResult.items,
    pricing:              toolResult.pricing,
    client_message_draft: toolResult.client_message_draft,
    manager_internal:     toolResult.manager_internal,
    input_summary:        toolResult.input_summary,
  }

  return {
    ok:             true,
    status:         'draft',
    ...META,
    input_snapshot:  input,
    output_snapshot: toolResult,
    draft_payload:   draftPayload,
    warnings:        dedupeWarnings(toolResult),
    errors:          [],
    ...SAFETY_FLAGS,
  }
}
