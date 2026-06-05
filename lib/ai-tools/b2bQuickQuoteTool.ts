// lib/ai-tools/b2bQuickQuoteTool.ts
//
// Read-only AI tool for B2B quick price estimation.
// Phase 1: mirror / shower / loft via existing quickCalcTool + partner discount.
// Phase 2 (planned): glass / cutting via lib/b2bCalculator.ts.
//
// SAFE PROFILE:
//   reads  Supabase (partner_types)  — yes, SELECT only
//   reads  via quickCalcTool          — yes (materials, services, financial_settings)
//   writes Supabase                   — no
//   writes CRM                        — no
//   creates orders                    — no
//   external HTTP                     — no
//   sends to client                   — NEVER (draft only)
//   Anthropic/OpenAI model            — NOT called
//   throws raw errors                 — no
//   approval_required                 — always true
//
// Used by: b2b-sales-agent / b2b-quick-quote skill
// Declared in: ai/tools/tool-registry.ts (key: 'b2bQuickQuote')

import { createClient } from '@supabase/supabase-js'
import {
  runQuickCalcTool,
  type QuickCalcToolInput,
  type QuickCalcProductType,
} from './quickCalcTool'
import type { CalcOptions } from '../quickCalc'

// ─── Safety metadata ──────────────────────────────────────────────────────────

export const B2B_QUICK_QUOTE_SAFETY_META = {
  no_db_write:     true,
  no_crm_write:    true,
  no_client_send:  true,
  no_order_create: true,
  reads_supabase:  true,   // partner_types + quickCalcTool (materials, services, financial_settings)
} as const

const SAFETY_FLAGS = {
  approval_required:   true  as const,
  can_send_to_client:  false as const,
  can_write_crm:       false as const,
  can_create_order:    false as const,
  model_call_executed: false as const,
}

// ─── Supported / unsupported product paths ────────────────────────────────────

const SUPPORTED_QUICK_CALC: readonly string[] = ['mirror', 'shower', 'loft']
const UNSUPPORTED_PHASE_1:  readonly string[] = ['glass', 'cutting']

// ─── Input ────────────────────────────────────────────────────────────────────

export type B2BMirrorType = 'silver' | 'crystal_vision' | 'bronze' | 'graphite'

export type B2BQuickQuoteInput = {
  // Product
  product_type: 'mirror' | 'shower' | 'loft' | 'glass' | 'cutting'
  width:        number   // мм, > 0
  height:       number   // мм, > 0
  quantity?:    number   // default 1

  // Mirror-specific
  mirrorType?:   B2BMirrorType
  thicknessMm?:  4 | 5 | 6
  hasLighting?:  boolean

  // Partner
  partner_type_id?:           number   // SELECT from partner_types
  partner_discount_override?: number   // 0–100, takes priority over partner_types

  // Context
  urgency?:       'normal' | 'urgent'
  raw_request?:   string   // original text from partner — informational only
  manager_notes?: string
}

// ─── Partner context ──────────────────────────────────────────────────────────

export type B2BPartnerContext = {
  partner_type_id?:        number
  partner_name?:           string
  partner_discount:        number
  partner_discount_source: 'partner_types' | 'override' | 'none'
}

// ─── Output ───────────────────────────────────────────────────────────────────

export type B2BQuoteItem = {
  line_item:   string
  dimensions?: string
  quantity:    number
  unit_price:  number
  total_price: number
}

export type B2BQuotePricing = {
  subtotal:         number
  discount_percent: number
  discount_amount:  number
  final_total:      number
  currency:         'RUB'
  vat_included:     boolean
}

export type B2BManagerInternal = {
  margin_estimate: number | null
  margin_status:   'green' | 'yellow' | 'red' | 'unknown'
  cost_basis?:     number
  warnings:        string[]
  partner_context: B2BPartnerContext
}

export type B2BQuickQuoteResult = {
  ok:           boolean
  tool:         'b2bQuickQuote'
  mode:         'read_only'
  product_path: 'quickCalc' | 'b2bCalculator' | 'unsupported'
  input_summary: string

  items:                B2BQuoteItem[]
  pricing:              B2BQuotePricing | null
  client_message_draft: string | null
  manager_internal:     B2BManagerInternal | null

  missing_data: string[]
  warnings:     string[]
  errors:       Array<{ code: string; message: string; field?: string }>

  approval_required:   true
  can_send_to_client:  false
  can_write_crm:       false
  can_create_order:    false
  model_call_executed: false
}

// ─── Internal partner row ─────────────────────────────────────────────────────

type PartnerTypeRow = {
  id:      number
  name:    string
  percent: number
  active:  boolean
}

// ─── Supabase client (server-side only) ───────────────────────────────────────

function buildClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('ru-RU') + ' ₽'
}

function buildInputSummary(input: B2BQuickQuoteInput): string {
  const qty    = input.quantity ?? 1
  const parts: string[] = [`${input.product_type} ${input.width}×${input.height}мм qty=${qty}`]
  if (input.mirrorType)             parts.push(input.mirrorType)
  if (input.thicknessMm)            parts.push(`${input.thicknessMm}мм`)
  if (input.hasLighting)            parts.push('lighting')
  if (input.partner_discount_override !== undefined)
    parts.push(`discount_override=${input.partner_discount_override}%`)
  else if (input.partner_type_id)   parts.push(`partner_type_id=${input.partner_type_id}`)
  return parts.join(' ')
}

function getMarginStatus(margin: number | null): 'green' | 'yellow' | 'red' | 'unknown' {
  if (margin === null) return 'unknown'
  if (margin >= 30) return 'green'
  if (margin >= 20) return 'yellow'
  return 'red'
}

function buildClientMessage(
  input:   B2BQuickQuoteInput,
  item:    B2BQuoteItem,
  pricing: B2BQuotePricing,
): string {
  const qty      = input.quantity ?? 1
  const lineDesc = item.line_item
  let msg = `Добрый день! По ${lineDesc.toLowerCase()}, ${qty} шт., предварительная стоимость — ${fmt(item.unit_price)}/шт.`

  if (pricing.discount_percent > 0) {
    msg += ` Итого без скидки: ${fmt(pricing.subtotal)}. С учётом партнёрской скидки ${pricing.discount_percent}%: ${fmt(pricing.final_total)}.`
  } else {
    msg += ` Итого: ${fmt(pricing.final_total)}.`
  }

  msg += ' Срок изготовления уточняется после подтверждения объёма.'
  return msg
}

// ─── Validation ───────────────────────────────────────────────────────────────

type ValidationResult =
  | { valid: true }
  | { valid: false; errors: Array<{ code: string; message: string; field?: string }>; missing: string[] }

function validateInput(input: B2BQuickQuoteInput): ValidationResult {
  const errors: Array<{ code: string; message: string; field?: string }> = []
  const missing: string[] = []

  if (!input.product_type) {
    missing.push('product_type')
    errors.push({ code: 'MISSING_PRODUCT_TYPE', message: 'Укажите тип изделия (mirror, shower, loft)', field: 'product_type' })
  }

  if (input.width === undefined || input.width === null) {
    missing.push('width')
    errors.push({ code: 'MISSING_WIDTH', message: 'Укажите ширину изделия в мм', field: 'width' })
  } else if (typeof input.width !== 'number' || !isFinite(input.width) || input.width <= 0) {
    errors.push({ code: 'INVALID_WIDTH', message: 'Ширина должна быть положительным числом в мм', field: 'width' })
  }

  if (input.height === undefined || input.height === null) {
    missing.push('height')
    errors.push({ code: 'MISSING_HEIGHT', message: 'Укажите высоту изделия в мм', field: 'height' })
  } else if (typeof input.height !== 'number' || !isFinite(input.height) || input.height <= 0) {
    errors.push({ code: 'INVALID_HEIGHT', message: 'Высота должна быть положительным числом в мм', field: 'height' })
  }

  if (input.quantity !== undefined) {
    if (!Number.isInteger(input.quantity) || input.quantity < 1) {
      errors.push({ code: 'INVALID_QUANTITY', message: 'Количество должно быть целым числом >= 1', field: 'quantity' })
    }
  }

  if (input.partner_discount_override !== undefined) {
    if (
      typeof input.partner_discount_override !== 'number' ||
      !isFinite(input.partner_discount_override) ||
      input.partner_discount_override < 0 ||
      input.partner_discount_override > 100
    ) {
      errors.push({
        code:    'INVALID_DISCOUNT_OVERRIDE',
        message: 'Скидка должна быть числом от 0 до 100',
        field:   'partner_discount_override',
      })
    }
  }

  if (errors.length > 0) return { valid: false, errors, missing }
  return { valid: true }
}

// ─── Partner context loader (SELECT only) ─────────────────────────────────────

async function loadPartnerContext(input: B2BQuickQuoteInput): Promise<{
  context:  B2BPartnerContext
  warnings: string[]
}> {
  const warnings: string[] = []

  // Override takes full priority — no DB read needed
  if (input.partner_discount_override !== undefined) {
    return {
      context: {
        partner_discount:        input.partner_discount_override,
        partner_discount_source: 'override',
      },
      warnings,
    }
  }

  // No partner info at all
  if (!input.partner_type_id) {
    return {
      context: {
        partner_discount:        0,
        partner_discount_source: 'none',
      },
      warnings,
    }
  }

  // Fetch from partner_types — SELECT only, no writes
  try {
    const supabase = buildClient()
    const { data, error } = await supabase
      .from('partner_types')
      .select('id, name, percent, active')
      .eq('id', input.partner_type_id)
      .maybeSingle()

    if (error) throw error

    if (!data) {
      warnings.push(`Тип партнёра с id=${input.partner_type_id} не найден в partner_types. Скидка не применена.`)
      return {
        context: {
          partner_type_id:         input.partner_type_id,
          partner_discount:        0,
          partner_discount_source: 'partner_types',
        },
        warnings,
      }
    }

    const row = data as PartnerTypeRow
    if (!row.active) {
      warnings.push(`Тип партнёра "${row.name}" (id=${row.id}) неактивен. Скидка не применена.`)
      return {
        context: {
          partner_type_id:         row.id,
          partner_name:            row.name,
          partner_discount:        0,
          partner_discount_source: 'partner_types',
        },
        warnings,
      }
    }

    return {
      context: {
        partner_type_id:         row.id,
        partner_name:            row.name,
        partner_discount:        row.percent,
        partner_discount_source: 'partner_types',
      },
      warnings,
    }
  } catch (err) {
    console.error('[b2bQuickQuoteTool] partner_types fetch error:', err)
    warnings.push('Не удалось загрузить данные типа партнёра из Supabase. Скидка не применена.')
    return {
      context: {
        partner_type_id:         input.partner_type_id,
        partner_discount:        0,
        partner_discount_source: 'partner_types',
      },
      warnings,
    }
  }
}

// ─── CalcOptions builder ──────────────────────────────────────────────────────
// Maps B2BQuickQuoteInput fields to CalcOptions accepted by quickCalcTool.
// mirrorType 'bronze' and 'graphite' are not in CalcOptions — mapped to 'silver' with warning.

function buildCalcOptions(input: B2BQuickQuoteInput): {
  options:  CalcOptions
  warnings: string[]
} {
  const options:  CalcOptions = {}
  const warnings: string[]   = []

  if (input.hasLighting !== undefined) options.hasLighting = input.hasLighting
  if (input.thicknessMm !== undefined) options.thicknessMm = input.thicknessMm

  if (input.mirrorType === 'crystal_vision') {
    options.mirrorType = 'crystal_vision'
  } else if (input.mirrorType === 'bronze' || input.mirrorType === 'graphite') {
    // CalcOptions supports only 'silver' | 'crystal_vision'.
    // Bronze and graphite fall through to silver pricing in quickCalc — no separate matrix row.
    options.mirrorType = 'silver'
    warnings.push(
      `Тип зеркала "${input.mirrorType}" не поддерживается quickCalc в Phase 1. ` +
      'Расчёт выполнен по цене "Серебро". Уточните цену вручную.',
    )
  } else if (input.mirrorType === 'silver') {
    options.mirrorType = 'silver'
  }
  // undefined mirrorType → quickCalc defaults to silver branch

  return { options, warnings }
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function runB2BQuickQuoteTool(
  input: B2BQuickQuoteInput,
): Promise<B2BQuickQuoteResult> {

  const inputSummary = buildInputSummary(input)

  // ── Unsupported product types (Phase 1) ────────────────────────────────────
  if (UNSUPPORTED_PHASE_1.includes(input.product_type)) {
    return {
      ok:                   false,
      tool:                 'b2bQuickQuote',
      mode:                 'read_only',
      product_path:         'unsupported',
      input_summary:        inputSummary,
      items:                [],
      pricing:              null,
      client_message_draft: null,
      manager_internal:     null,
      missing_data:         [],
      warnings:             [],
      errors: [{
        code:    'UNSUPPORTED_PRODUCT_TYPE_PHASE_1',
        message: `Тип "${input.product_type}" (glass/cutting) будет добавлен в следующем этапе через lib/b2bCalculator.ts. Phase 1 поддерживает только mirror, shower, loft.`,
        field:   'product_type',
      }],
      ...SAFETY_FLAGS,
    }
  }

  // ── Validation ─────────────────────────────────────────────────────────────
  const validation = validateInput(input)
  if (!validation.valid) {
    return {
      ok:                   false,
      tool:                 'b2bQuickQuote',
      mode:                 'read_only',
      product_path:         SUPPORTED_QUICK_CALC.includes(input.product_type) ? 'quickCalc' : 'unsupported',
      input_summary:        inputSummary,
      items:                [],
      pricing:              null,
      client_message_draft: null,
      manager_internal:     null,
      missing_data:         validation.missing,
      warnings:             [],
      errors:               validation.errors,
      ...SAFETY_FLAGS,
    }
  }

  const quantity    = input.quantity ?? 1
  const allWarnings: string[] = []

  // ── Dimension warnings ─────────────────────────────────────────────────────
  if (input.width > 3000 || input.height > 3000) {
    allWarnings.push('Размеры превышают 3000 мм. Уточните технические ограничения производства.')
  }
  if (input.width < 200 || input.height < 200) {
    allWarnings.push('Размеры менее 200 мм — проверьте минимальный заказ.')
  }

  // ── Partner context (SELECT only) ──────────────────────────────────────────
  const { context: partnerContext, warnings: partnerWarn } = await loadPartnerContext(input)
  allWarnings.push(...partnerWarn)

  if (partnerContext.partner_discount > 30) {
    allWarnings.push(
      `Скидка ${partnerContext.partner_discount}% превышает 30%. Убедитесь в достаточной марже.`,
    )
  }

  // ── CalcOptions ────────────────────────────────────────────────────────────
  const { options: calcOptions, warnings: optionWarn } = buildCalcOptions(input)
  allWarnings.push(...optionWarn)

  // ── Run quickCalcTool ──────────────────────────────────────────────────────
  const calcInput: QuickCalcToolInput = {
    product_type: input.product_type as QuickCalcProductType,
    width:        input.width,
    height:       input.height,
    quantity,
    options:      calcOptions,
  }

  const calcResult = await runQuickCalcTool(calcInput)

  if (calcResult.warnings.length > 0) {
    allWarnings.push(...calcResult.warnings)
  }

  if (!calcResult.ok || !calcResult.calculation) {
    return {
      ok:                   false,
      tool:                 'b2bQuickQuote',
      mode:                 'read_only',
      product_path:         'quickCalc',
      input_summary:        inputSummary,
      items:                [],
      pricing:              null,
      client_message_draft: null,
      manager_internal: {
        margin_estimate: null,
        margin_status:   'unknown',
        warnings:        allWarnings,
        partner_context: partnerContext,
      },
      missing_data: calcResult.missing_data,
      warnings:     allWarnings,
      errors:       calcResult.errors,
      ...SAFETY_FLAGS,
    }
  }

  const calc = calcResult.calculation

  // ── Pricing (post-calculation discount only) ───────────────────────────────
  // Base price from quickCalcTool — never modified; discount applied on top only.
  const unitPrice      = calc.final_price                             // per-unit price (no partner discount)
  const subtotal       = calc.total_estimate                          // = final_price × quantity
  const discountPct    = partnerContext.partner_discount
  const discountAmount = Math.round(subtotal * discountPct / 100)
  const finalTotal     = subtotal - discountAmount

  if (finalTotal <= 0) {
    allWarnings.push('Итоговая сумма после скидки равна 0 или отрицательная. Проверьте размер скидки.')
  }

  // ── Margin estimation (rough post-discount approximation for Phase 1) ──────
  // effective_margin = base_margin - discount_percent is a conservative estimate.
  // Accurate margin requires cost data from costLines (Phase 2).
  const marginEstimate: number | null = calc.margin - discountPct
  const marginStatus = getMarginStatus(marginEstimate)

  if (marginStatus === 'red' && discountPct > 0) {
    allWarnings.push(
      `Приблизительная маржа после скидки ${discountPct}% составляет ~${marginEstimate}%. Проверьте рентабельность перед отправкой.`,
    )
  }

  // ── Items ──────────────────────────────────────────────────────────────────
  const item: B2BQuoteItem = {
    line_item:   calc.description,
    dimensions:  `${input.width}×${input.height} мм`,
    quantity,
    unit_price:  unitPrice,
    total_price: subtotal,
  }

  const pricing: B2BQuotePricing = {
    subtotal,
    discount_percent: discountPct,
    discount_amount:  discountAmount,
    final_total:      finalTotal,
    currency:         'RUB',
    vat_included:     false,
  }

  // ── Client message — no margin, no cost, no internal data ─────────────────
  const clientMessageDraft = buildClientMessage(input, item, pricing)

  // ── Manager internal ───────────────────────────────────────────────────────
  const managerInternal: B2BManagerInternal = {
    margin_estimate: marginEstimate,
    margin_status:   marginStatus,
    warnings:        allWarnings,
    partner_context: partnerContext,
  }

  return {
    ok:                   true,
    tool:                 'b2bQuickQuote',
    mode:                 'read_only',
    product_path:         'quickCalc',
    input_summary:        inputSummary,
    items:                [item],
    pricing,
    client_message_draft: clientMessageDraft,
    manager_internal:     managerInternal,
    missing_data:         [],
    warnings:             allWarnings,
    errors:               [],
    ...SAFETY_FLAGS,
  }
}
