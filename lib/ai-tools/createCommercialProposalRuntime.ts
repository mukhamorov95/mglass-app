// lib/ai-tools/createCommercialProposalRuntime.ts
//
// Orchestrator for the create-commercial-proposal runtime flow.
// Sequentially executes: quickCalcTool → pricingRulesTool → generateKpDraftTool
// and returns a single normalised draft response.
//
// SAFE PROFILE:
//   writes Supabase           — no (tools read, orchestrator never writes)
//   writes CRM                — no
//   creates orders            — no
//   external HTTP             — no
//   sends to client           — NEVER
//   Anthropic/OpenAI model    — NOT called (model_call_executed always false)
//   throws raw errors         — no
//   approval_required         — always true
//   can_send_to_client        — always false
//
// Stage: 1 (Foundation). This is a local in-process orchestrator.
// Next stage: connect to agent_action_log + Approval UI to persist drafts.
//
// Used by: proposal-engineer-agent / create-commercial-proposal skill

import type { CalcOptions } from '../quickCalc'
import {
  runQuickCalcTool,
  type QuickCalcToolInput,
  type QuickCalcToolCalculation,
} from './quickCalcTool'
import {
  runPricingRulesTool,
  type PricingRulesNormalized,
} from './pricingRulesTool'
import {
  runGenerateKpDraftTool,
  type KpDraftContent,
  type KpCalcSummary,
  type KpPricingSummary,
} from './generateKpDraftTool'

// ─── Step keys ────────────────────────────────────────────────────────────────

export type CreateCommercialProposalRuntimeStepKey =
  | 'validation'
  | 'quickCalc'
  | 'pricingRules'
  | 'generateKpDraft'

// ─── Step result ─────────────────────────────────────────────────────────────

export type CreateCommercialProposalRuntimeStep = {
  key:          CreateCommercialProposalRuntimeStepKey
  ok:           boolean
  skipped?:     boolean   // true if step was intentionally bypassed
  warnings?:    string[]
  error_codes?: string[]  // codes only — no user messages in step summary
}

// ─── Safety ───────────────────────────────────────────────────────────────────

export type CreateCommercialProposalRuntimeSafety = {
  no_db_write:               true
  no_crm_write:              true
  no_client_send:            true
  no_order_create:           true
  no_external_http:          true
  reads_supabase_via_tools:  boolean  // true if quickCalc or pricingRules executed
  model_call_executed:       false    // always false at this stage
}

// ─── Error ────────────────────────────────────────────────────────────────────

export type CreateCommercialProposalRuntimeError = {
  code:    string
  message: string   // user-facing, no stack trace
  field?:  string
  step?:   CreateCommercialProposalRuntimeStepKey
}

// ─── Input ────────────────────────────────────────────────────────────────────

export type CreateCommercialProposalRuntimeInput = {
  client_request:         string                    // required
  product_type:           string                    // required: 'mirror' | 'shower' | 'loft'
  width?:                 number                    // required for quickCalc (мм, > 0)
  height?:                number                    // required for quickCalc (мм, > 0)
  quantity?:              number                    // default 1
  options?:               Record<string, unknown>   // passed through to quickCalcTool as CalcOptions
  installation_required?: boolean
  delivery_required?:     boolean
  address_or_zone?:       string                    // informational only; not used in current tools
  manager_notes?:         string                    // forwarded to generateKpDraftTool
  company_context?:       string                    // forwarded to generateKpDraftTool
  allowModelCall?:        boolean                   // default false — future: Anthropic binding
}

// ─── Response ─────────────────────────────────────────────────────────────────

export type CreateCommercialProposalRuntimeResponse = {
  ok:                 boolean
  runtime:            'create-commercial-proposal'
  mode:               'draft'
  failed_step?:       CreateCommercialProposalRuntimeStepKey
  steps:              CreateCommercialProposalRuntimeStep[]
  calculation:        QuickCalcToolCalculation | null
  pricing_rules:      PricingRulesNormalized | null
  draft:              KpDraftContent | null
  missing_data:       string[]
  warnings:           string[]
  errors:             CreateCommercialProposalRuntimeError[]
  approval_required:  true
  can_send_to_client: false
  can_write_crm:      false
  can_create_order:   false
  safety:             CreateCommercialProposalRuntimeSafety
}

// ─── Validation ───────────────────────────────────────────────────────────────

type ValidationOutcome =
  | { valid: true }
  | { valid: false; errors: CreateCommercialProposalRuntimeError[]; missing: string[] }

function validateRuntimeInput(input: CreateCommercialProposalRuntimeInput): ValidationOutcome {
  const errors: CreateCommercialProposalRuntimeError[] = []
  const missing: string[] = []

  if (!input.client_request || input.client_request.trim() === '') {
    missing.push('client_request')
    errors.push({
      code:    'MISSING_CLIENT_REQUEST',
      message: 'Укажите запрос клиента (client_request).',
      field:   'client_request',
      step:    'validation',
    })
  }

  if (!input.product_type || input.product_type.trim() === '') {
    missing.push('product_type')
    errors.push({
      code:    'MISSING_PRODUCT_TYPE',
      message: 'Укажите тип продукта (product_type): mirror, shower или loft.',
      field:   'product_type',
      step:    'validation',
    })
  }

  if (input.width === undefined || input.width === null) {
    missing.push('width')
    errors.push({
      code:    'MISSING_WIDTH',
      message: 'Укажите ширину изделия в мм (width).',
      field:   'width',
      step:    'validation',
    })
  } else if (typeof input.width !== 'number' || !isFinite(input.width) || input.width <= 0) {
    errors.push({
      code:    'INVALID_WIDTH',
      message: 'Ширина (width) должна быть положительным числом в мм.',
      field:   'width',
      step:    'validation',
    })
  }

  if (input.height === undefined || input.height === null) {
    missing.push('height')
    errors.push({
      code:    'MISSING_HEIGHT',
      message: 'Укажите высоту изделия в мм (height).',
      field:   'height',
      step:    'validation',
    })
  } else if (typeof input.height !== 'number' || !isFinite(input.height) || input.height <= 0) {
    errors.push({
      code:    'INVALID_HEIGHT',
      message: 'Высота (height) должна быть положительным числом в мм.',
      field:   'height',
      step:    'validation',
    })
  }

  if (errors.length > 0) return { valid: false, errors, missing }
  return { valid: true }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toKpCalcSummary(
  calc: QuickCalcToolCalculation,
  input: CreateCommercialProposalRuntimeInput,
): KpCalcSummary {
  return {
    base_price:     calc.base_price,
    final_price:    calc.final_price,
    margin:         calc.margin,
    description:    calc.description,
    service_lines:  calc.service_lines,
    quantity:       calc.quantity,
    total_estimate: calc.total_estimate,
    dimensions:     (input.width && input.height)
      ? { width: input.width, height: input.height }
      : undefined,
  }
}

function toKpPricingSummary(rules: PricingRulesNormalized): KpPricingSummary {
  return {
    max_discount_percent: rules.discount_limits.max_discount_percent,
    sla_days_approved:    rules.sla_targets.days_approved,
    sla_days_in_work:     rules.sla_targets.days_in_work,
  }
}

// ─── Response builder ─────────────────────────────────────────────────────────

function buildResponse(params: {
  ok:              boolean
  failed_step?:    CreateCommercialProposalRuntimeStepKey
  steps:           CreateCommercialProposalRuntimeStep[]
  calculation?:    QuickCalcToolCalculation | null
  pricing_rules?:  PricingRulesNormalized | null
  draft?:          KpDraftContent | null
  missing_data?:   string[]
  warnings:        string[]
  errors:          CreateCommercialProposalRuntimeError[]
  supabaseUsed?:   boolean
}): CreateCommercialProposalRuntimeResponse {
  return {
    ok:                 params.ok,
    runtime:            'create-commercial-proposal',
    mode:               'draft',
    failed_step:        params.failed_step,
    steps:              params.steps,
    calculation:        params.calculation ?? null,
    pricing_rules:      params.pricing_rules ?? null,
    draft:              params.draft ?? null,
    missing_data:       params.missing_data ?? [],
    warnings:           params.warnings,
    errors:             params.errors,
    approval_required:  true,
    can_send_to_client: false,
    can_write_crm:      false,
    can_create_order:   false,
    safety: {
      no_db_write:               true,
      no_crm_write:              true,
      no_client_send:            true,
      no_order_create:           true,
      no_external_http:          true,
      reads_supabase_via_tools:  params.supabaseUsed ?? false,
      model_call_executed:       false,
    },
  }
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function runCreateCommercialProposalRuntime(
  input: CreateCommercialProposalRuntimeInput,
): Promise<CreateCommercialProposalRuntimeResponse> {
  const allWarnings:  string[] = []
  const allErrors:    CreateCommercialProposalRuntimeError[] = []
  const allMissing:   string[] = []
  const steps:        CreateCommercialProposalRuntimeStep[] = []
  let supabaseUsed = false

  // ── Step 1: Validation ─────────────────────────────────────────────────────

  const validation = validateRuntimeInput(input)

  if (!validation.valid) {
    steps.push({
      key:          'validation',
      ok:           false,
      error_codes:  validation.errors.map(e => e.code),
    })
    return buildResponse({
      ok:           false,
      failed_step:  'validation',
      steps,
      missing_data: validation.missing,
      warnings:     allWarnings,
      errors:       validation.errors,
      supabaseUsed,
    })
  }

  steps.push({ key: 'validation', ok: true })

  // ── Step 2: quickCalcTool ──────────────────────────────────────────────────

  const quickCalcInput: QuickCalcToolInput = {
    product_type:           input.product_type as QuickCalcToolInput['product_type'],
    width:                  input.width!,
    height:                 input.height!,
    quantity:               input.quantity,
    options:                input.options as CalcOptions | undefined,
    installation_required:  input.installation_required,
    delivery_required:      input.delivery_required,
  }

  let calcResult: Awaited<ReturnType<typeof runQuickCalcTool>>
  try {
    calcResult = await runQuickCalcTool(quickCalcInput)
    supabaseUsed = true  // quickCalcTool reads Supabase
  } catch (err) {
    console.error('[createCommercialProposalRuntime] quickCalcTool threw unexpectedly:', err)
    steps.push({ key: 'quickCalc', ok: false, error_codes: ['UNEXPECTED_ERROR'] })
    return buildResponse({
      ok:          false,
      failed_step: 'quickCalc',
      steps,
      warnings:    allWarnings,
      errors:      [{
        code:    'CALC_UNEXPECTED_ERROR',
        message: 'Ошибка при выполнении расчёта. Попробуйте ещё раз или обратитесь к администратору.',
        step:    'quickCalc',
      }],
      supabaseUsed,
    })
  }

  // Propagate quickCalc warnings
  if (calcResult.warnings.length > 0) allWarnings.push(...calcResult.warnings)

  if (!calcResult.ok || !calcResult.calculation) {
    steps.push({
      key:         'quickCalc',
      ok:          false,
      warnings:    calcResult.warnings,
      error_codes: calcResult.errors.map(e => e.code),
    })
    allMissing.push(...calcResult.missing_data)
    return buildResponse({
      ok:           false,
      failed_step:  'quickCalc',
      steps,
      missing_data: allMissing,
      warnings:     allWarnings,
      errors:       calcResult.errors.map(e => ({
        code:    e.code,
        message: e.message,
        field:   e.field,
        step:    'quickCalc' as const,
      })),
      supabaseUsed,
    })
  }

  steps.push({ key: 'quickCalc', ok: true, warnings: calcResult.warnings })
  const calculation = calcResult.calculation

  // ── Step 3: pricingRulesTool (non-critical) ────────────────────────────────
  // pricingRules failure is non-critical: generateKpDraftTool can operate without
  // pricing_rules_summary (it uses defaults and emits a warning).

  let pricingRules: PricingRulesNormalized | null = null

  let pricingResult: Awaited<ReturnType<typeof runPricingRulesTool>>
  try {
    pricingResult = await runPricingRulesTool({ scope: input.product_type })
    supabaseUsed = true  // pricingRulesTool reads Supabase
  } catch (err) {
    console.error('[createCommercialProposalRuntime] pricingRulesTool threw unexpectedly:', err)
    allWarnings.push(
      'Не удалось получить правила ценообразования (неожиданная ошибка). ' +
      'КП будет сформирован с настройками по умолчанию. Проверьте маржу вручную.',
    )
    steps.push({ key: 'pricingRules', ok: false, error_codes: ['UNEXPECTED_ERROR'] })
    pricingRules = null
  }

  if (pricingResult!) {
    if (pricingResult.warnings.length > 0) allWarnings.push(...pricingResult.warnings)

    if (!pricingResult.ok || !pricingResult.rules) {
      // Non-critical: warn and continue without pricing rules
      allWarnings.push(
        'Правила ценообразования недоступны (' +
        (pricingResult.errors[0]?.code ?? 'PRICING_ERROR') +
        '). КП будет сформирован с настройками по умолчанию. Проверьте маржу вручную.',
      )
      steps.push({
        key:         'pricingRules',
        ok:          false,
        warnings:    pricingResult.warnings,
        error_codes: pricingResult.errors.map(e => e.code),
      })
    } else {
      pricingRules = pricingResult.rules
      steps.push({ key: 'pricingRules', ok: true, warnings: pricingResult.warnings })
    }
  }

  // ── Step 4: generateKpDraftTool ───────────────────────────────────────────

  const kpCalcSummary      = toKpCalcSummary(calculation, input)
  const kpPricingSummary   = pricingRules ? toKpPricingSummary(pricingRules) : undefined

  let draftResult: Awaited<ReturnType<typeof runGenerateKpDraftTool>>
  try {
    draftResult = await runGenerateKpDraftTool({
      client_request:        input.client_request,
      product_type:          input.product_type,
      calculation_summary:   kpCalcSummary,
      pricing_rules_summary: kpPricingSummary,
      manager_notes:         input.manager_notes,
      company_context:       input.company_context,
      allowModelCall:        input.allowModelCall ?? false,
    })
  } catch (err) {
    console.error('[createCommercialProposalRuntime] generateKpDraftTool threw unexpectedly:', err)
    steps.push({ key: 'generateKpDraft', ok: false, error_codes: ['UNEXPECTED_ERROR'] })
    return buildResponse({
      ok:          false,
      failed_step: 'generateKpDraft',
      steps,
      calculation,
      pricing_rules: pricingRules,
      warnings:    allWarnings,
      errors: [{
        code:    'DRAFT_UNEXPECTED_ERROR',
        message: 'Ошибка при формировании черновика КП. Попробуйте ещё раз.',
        step:    'generateKpDraft',
      }],
      supabaseUsed,
    })
  }

  if (draftResult.warnings.length > 0) allWarnings.push(...draftResult.warnings)

  if (!draftResult.ok || !draftResult.draft) {
    steps.push({
      key:         'generateKpDraft',
      ok:          false,
      warnings:    draftResult.warnings,
      error_codes: draftResult.errors.map(e => e.code),
    })
    allMissing.push(...draftResult.missing_data)
    return buildResponse({
      ok:           false,
      failed_step:  'generateKpDraft',
      steps,
      calculation,
      pricing_rules: pricingRules,
      missing_data:  allMissing,
      warnings:      allWarnings,
      errors:        draftResult.errors.map(e => ({
        code:    e.code,
        message: e.message,
        field:   e.field,
        step:    'generateKpDraft' as const,
      })),
      supabaseUsed,
    })
  }

  steps.push({ key: 'generateKpDraft', ok: true, warnings: draftResult.warnings })

  // ── Success ────────────────────────────────────────────────────────────────

  return buildResponse({
    ok:            true,
    steps,
    calculation,
    pricing_rules: pricingRules,
    draft:         draftResult.draft,
    missing_data:  [],
    warnings:      allWarnings,
    errors:        [],
    supabaseUsed,
  })
}
