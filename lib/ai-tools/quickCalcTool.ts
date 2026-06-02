// lib/ai-tools/quickCalcTool.ts
//
// Read-only AI tool wrapper for quick price estimation.
//
// SAFE PROFILE:
//   reads  Supabase (materials, services, financial_settings) — yes
//   writes Supabase  — no
//   writes CRM       — no
//   external HTTP    — no (Supabase SDK counts as data layer, not external service)
//   sends to client  — no
//   throws raw errors — no
//
// Used by: proposal-engineer-agent / create-commercial-proposal skill
// Declared in: ai/tools/tool-registry.ts (key: 'quickCalc')

import { quickCalc, type CalcType, type CalcOptions } from '../quickCalc'

// ─── Supported product types ──────────────────────────────────────────────────
// Mirrors CalcType from lib/quickCalc.ts.
// b2b is NOT supported by quickCalc — handled separately.

export type QuickCalcProductType = CalcType  // 'mirror' | 'loft' | 'shower'

const SUPPORTED_PRODUCT_TYPES: readonly QuickCalcProductType[] = ['mirror', 'loft', 'shower']

// ─── Input ────────────────────────────────────────────────────────────────────

export type QuickCalcToolInput = {
  product_type:           QuickCalcProductType
  width:                  number    // мм, > 0
  height:                 number    // мм, > 0
  options?:               CalcOptions
  installation_required?: boolean   // mapped to options.withMounting
  delivery_required?:     boolean   // informational; quickCalc sets delivery: false internally
  quantity?:              number    // default 1; multiplied into total_estimate
}

// ─── Output ───────────────────────────────────────────────────────────────────

export type QuickCalcToolCalculation = {
  base_price:     number
  final_price:    number
  margin:         number
  description:    string
  service_lines:  Array<{ name: string; total: number }>
  quantity:       number
  total_estimate: number   // final_price × quantity
  calc_source:    'quickCalc'
}

export type QuickCalcToolError = {
  code:     string
  message:  string   // user-facing text, no raw Supabase errors
  field?:   string   // which input field triggered the error
}

export const QUICK_CALC_SAFETY_META = {
  no_db_write:    true,
  no_crm_write:   true,
  no_client_send: true,
  reads_supabase: true,   // reads materials / services / financial_settings
} as const

export type QuickCalcToolSafetyMeta = typeof QUICK_CALC_SAFETY_META

export type QuickCalcToolResponse = {
  ok:                 boolean
  tool:               'quickCalc'
  mode:               'read_only'
  input_summary:      string
  calculation:        QuickCalcToolCalculation | null
  missing_data:       string[]          // input fields that were absent or invalid
  warnings:           string[]          // non-blocking issues agent should note
  errors:             QuickCalcToolError[]
  approval_required:  false             // read-only tool never requires approval
  can_send_to_client: false             // output is for agent / manager review only
  safety:             QuickCalcToolSafetyMeta
}

// ─── Validation ───────────────────────────────────────────────────────────────

type ValidationResult =
  | { valid: true }
  | { valid: false; errors: QuickCalcToolError[]; missing: string[] }

function validateInput(input: QuickCalcToolInput): ValidationResult {
  const errors: QuickCalcToolError[] = []
  const missing: string[] = []

  if (!input.product_type) {
    missing.push('product_type')
    errors.push({ code: 'MISSING_PRODUCT_TYPE', message: 'Укажите тип изделия (mirror, shower или loft)', field: 'product_type' })
  } else if (!(SUPPORTED_PRODUCT_TYPES as readonly string[]).includes(input.product_type)) {
    errors.push({
      code:    'UNSUPPORTED_PRODUCT_TYPE',
      message: `Тип "${input.product_type}" не поддерживается quickCalc. Поддерживаются: ${SUPPORTED_PRODUCT_TYPES.join(', ')}`,
      field:   'product_type',
    })
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

  if (errors.length > 0) return { valid: false, errors, missing }
  return { valid: true }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildInputSummary(input: QuickCalcToolInput): string {
  const qty    = input.quantity ?? 1
  const mount  = input.installation_required ? ' + монтаж' : ''
  const deliv  = input.delivery_required ? ' + доставка' : ''
  return `${input.product_type} ${input.width}×${input.height}мм qty=${qty}${mount}${deliv}`
}

function mergeOptions(input: QuickCalcToolInput): CalcOptions {
  return {
    ...(input.options ?? {}),
    withMounting: input.installation_required ?? input.options?.withMounting ?? false,
  }
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function runQuickCalcTool(
  input: QuickCalcToolInput,
): Promise<QuickCalcToolResponse> {

  const baseResponse: Omit<QuickCalcToolResponse, 'ok' | 'calculation' | 'missing_data' | 'warnings' | 'errors'> = {
    tool:               'quickCalc',
    mode:               'read_only',
    input_summary:      buildInputSummary(input),
    approval_required:  false,
    can_send_to_client: false,
    safety:             QUICK_CALC_SAFETY_META,
  }

  // Validate
  const validation = validateInput(input)
  if (!validation.valid) {
    return {
      ...baseResponse,
      ok:           false,
      calculation:  null,
      missing_data: validation.missing,
      warnings:     [],
      errors:       validation.errors,
    }
  }

  // Normalise
  const quantity = input.quantity ?? 1
  const options  = mergeOptions(input)
  const warnings: string[] = []

  // Warn about delivery — quickCalc always sets delivery: false internally
  if (input.delivery_required) {
    warnings.push('Стоимость доставки не включена в расчёт quickCalc. Добавьте вручную на основе зоны доставки.')
  }

  // Warn about extreme dimensions
  if (input.width > 3000 || input.height > 3000) {
    warnings.push('Размеры превышают 3000 мм. Уточните технические ограничения производства.')
  }
  if (input.width < 200 || input.height < 200) {
    warnings.push('Размеры менее 200 мм — проверьте минимальный заказ.')
  }

  // Run calculation
  let raw: Awaited<ReturnType<typeof quickCalc>>
  try {
    raw = await quickCalc(input.product_type as CalcType, input.width, input.height, options)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    // Never expose raw Supabase / stack trace to user-facing message
    return {
      ...baseResponse,
      ok:           false,
      calculation:  null,
      missing_data: [],
      warnings,
      errors: [{
        code:    'CALC_RUNTIME_ERROR',
        message: 'Не удалось выполнить расчёт. Проверьте соединение с базой данных или обратитесь к администратору.',
        field:   undefined,
      }],
    }
  }

  if (!raw) {
    return {
      ...baseResponse,
      ok:           false,
      calculation:  null,
      missing_data: [],
      warnings,
      errors: [{
        code:    'CALC_RETURNED_NULL',
        message: `Расчёт для ${input.product_type} не дал результата. Возможно, отсутствует материал или настройки цен в справочнике.`,
      }],
    }
  }

  const calculation: QuickCalcToolCalculation = {
    base_price:     raw.price,
    final_price:    raw.finalPrice,
    margin:         raw.margin,
    description:    raw.description,
    service_lines:  raw.serviceLines ?? [],
    quantity,
    total_estimate: Math.round(raw.finalPrice * quantity),
    calc_source:    'quickCalc',
  }

  if (calculation.total_estimate === 0) {
    warnings.push('Итоговая сумма равна 0. Проверьте настройки цен в financial_settings.')
  }

  return {
    ...baseResponse,
    ok:           true,
    calculation,
    missing_data: [],
    warnings,
    errors:       [],
  }
}
