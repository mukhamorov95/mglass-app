// lib/ai-tools/generateKpDraftTool.ts
//
// Draft-only AI tool wrapper for commercial proposal (КП) generation.
//
// SAFE PROFILE:
//   reads  Supabase           — no (input payload only, no DB calls)
//   writes Supabase           — no
//   writes CRM                — no
//   creates orders            — no
//   external HTTP             — no
//   sends to client           — NEVER (draft-only, approval_required: true always)
//   Anthropic/OpenAI model    — NOT called by default (allowModelCall defaults to false)
//   throws raw errors         — no
//
// Current implementation: structured skeleton generator (no model call).
//
// Future Binding (stage 2):
//   Connect to app/api/ai/generate-kp/route.ts through an internal service
//   layer — NOT via HTTP fetch to production URL. This requires:
//     1. Extract prompt-building logic from route into lib/ai/kpPromptBuilder.ts
//     2. Call Anthropic SDK directly from tool layer (no network hop)
//     3. Wrap result in same draft-only safety envelope
//   Precondition: approval flow (agent_action_log + Approval UI) must exist first.
//
// Used by: proposal-engineer-agent / create-commercial-proposal skill
// Declared in: ai/tools/tool-registry.ts (key: 'generateKpDraft')

// ─── Safety metadata ──────────────────────────────────────────────────────────

export type GenerateKpDraftSafetyMeta = {
  no_db_write:         true
  no_crm_write:        true
  no_client_send:      true
  no_order_create:     true
  model_call_allowed:  boolean  // reflects input.allowModelCall
  model_call_executed: boolean  // always false at current stage
}

// ─── Draft mode ───────────────────────────────────────────────────────────────

export type GenerateKpDraftMode =
  | 'skeleton'          // structured draft without model call (current implementation)
  | 'model_generated'   // draft text from model call (future stage 2)
  | 'model_unavailable' // allowModelCall: true but model call not yet connected

// ─── Input sub-types ─────────────────────────────────────────────────────────

/** Minimal calculation data — compatible with QuickCalcToolCalculation from quickCalcTool.ts */
export type KpCalcSummary = {
  base_price:      number
  final_price:     number
  margin?:         number
  description?:    string
  service_lines?:  Array<{ name: string; total: number }>
  quantity?:       number
  total_estimate?: number
  dimensions?: {
    width:  number
    height: number
  }
}

/** Minimal pricing data — compatible with PricingRulesNormalized from pricingRulesTool.ts */
export type KpPricingSummary = {
  max_discount_percent?: number
  sla_days_approved?:    number
  sla_days_in_work?:     number
}

// ─── Input ────────────────────────────────────────────────────────────────────

export type GenerateKpDraftToolInput = {
  client_request:         string          // required — what the client asked for
  product_type:           string          // required — 'mirror' | 'shower' | 'loft' | 'b2b'
  calculation_summary:    KpCalcSummary   // required — output from runQuickCalcTool
  pricing_rules_summary?: KpPricingSummary // optional — output from runPricingRulesTool
  options?:               Record<string, unknown> // optional — calc options, used for mirror label (hasLighting)
  manager_notes?:         string          // optional — context from the manager
  company_context?:       string          // optional — custom intro (defaults to M-Glass standard)
  allowModelCall?:        boolean         // default false — future: enables Anthropic call
}

// ─── Draft content ────────────────────────────────────────────────────────────

export type KpDraftContent = {
  proposal_title: string
  client_summary: string
  items:          Array<{
    line_item:   string
    dimensions?: string
    quantity:    number
    unit_price:  number
    total_price: number
    note?:       string
  }>
  price_summary: {
    subtotal:      number
    total:         number
    currency:      string
    vat_included?: string
  }
  terms: {
    lead_time_days?: [number, number]
    payment_terms:   string
    warranty:        string
    validity_days:   number
  }
  exclusions:      string[]
  manager_message: string   // human-readable checklist for the manager before sending
  approval_block:  string   // prominent draft disclaimer
}

// ─── Error ────────────────────────────────────────────────────────────────────

export type GenerateKpDraftToolError = {
  code:     string
  message:  string   // user-facing text, no internal stack trace
  field?:   string
}

// ─── Response ─────────────────────────────────────────────────────────────────

export type GenerateKpDraftToolResponse = {
  ok:                 boolean
  tool:               'generateKpDraft'
  mode:               GenerateKpDraftMode
  draft:              KpDraftContent | null
  missing_data:       string[]
  warnings:           string[]
  errors:             GenerateKpDraftToolError[]
  approval_required:  true    // always — no draft is ever sent without human review
  can_send_to_client: false   // always — tool never sends to client
  can_write_crm:      false   // always — no CRM writes
  can_create_order:   false   // always — no order creation
  safety:             GenerateKpDraftSafetyMeta
}

// ─── Product labels ───────────────────────────────────────────────────────────
// Mirrors PRODUCT_LABELS from app/api/ai/generate-kp/route.ts (no import — route is HTTP-coupled).

const PRODUCT_LABELS: Record<string, string> = {
  mirror: 'Зеркало с подсветкой',
  loft:   'Лофт-перегородка',
  shower: 'Душевая перегородка',
  b2b:    'Стеклянная конструкция B2B',
}

const KP_VALIDITY_DAYS = 14   // standard offer validity

// ─── Skeleton builder ─────────────────────────────────────────────────────────

function buildSkeleton(
  input: GenerateKpDraftToolInput,
  productLabel: string,
): KpDraftContent {
  const calc    = input.calculation_summary
  const pricing = input.pricing_rules_summary

  // Dimensions string if available
  const dimsStr = calc.dimensions
    ? `${calc.dimensions.width}×${calc.dimensions.height} мм`
    : undefined
  const dimsLabel = dimsStr ? ` ${dimsStr}` : ''

  // ── Title ──────────────────────────────────────────────────────────────────
  const proposal_title = `Коммерческое предложение — ${productLabel}${dimsLabel}`

  // ── Client summary ─────────────────────────────────────────────────────────
  const companyIntro = input.company_context?.trim()
    ?? 'Уважаемый клиент, благодарим за интерес к продукции M-Glass.'
  const requestNote = input.client_request.trim()
    ? ` Мы подготовили предложение по вашему запросу: «${input.client_request.trim()}».`
    : ''
  const managerNote = input.manager_notes?.trim()
    ? ` ${input.manager_notes.trim()}`
    : ''
  const client_summary = `${companyIntro}${requestNote}${managerNote}`

  // ── Items — product always first, services after ───────────────────────────
  const qty = calc.quantity ?? 1
  const productTotal = calc.total_estimate ?? calc.final_price
  const items: KpDraftContent['items'] = []

  // Main product line — always present regardless of service_lines
  items.push({
    line_item:   productLabel,
    dimensions:  dimsStr,
    quantity:    qty,
    unit_price:  calc.final_price,
    total_price: productTotal,
  })

  // Service lines (installation, delivery) — appended after product
  if (calc.service_lines && calc.service_lines.length > 0) {
    for (const line of calc.service_lines) {
      items.push({
        line_item:   line.name,
        quantity:    1,
        unit_price:  line.total,
        total_price: line.total,
      })
    }
  }

  // ── Price summary ──────────────────────────────────────────────────────────
  const servicesTotal = (calc.service_lines ?? []).reduce((s, l) => s + l.total, 0)
  const grandTotal    = productTotal + servicesTotal
  const discountNote  = pricing?.max_discount_percent
    ? ` Максимальная скидка по договорённости: ${pricing.max_discount_percent}%.`
    : ''
  const price_summary: KpDraftContent['price_summary'] = {
    subtotal:      productTotal,
    total:         grandTotal,
    currency:      'RUB',
    vat_included:  `НДС не предусмотрен.${discountNote}`,
  }

  // ── Terms ──────────────────────────────────────────────────────────────────
  const leadTimeDays: [number, number] = pricing?.sla_days_in_work
    ? [pricing.sla_days_in_work, pricing.sla_days_in_work]
    : [7, 14]
  const terms: KpDraftContent['terms'] = {
    lead_time_days: leadTimeDays,
    payment_terms:  'Предоплата 50% при подтверждении заказа, остаток — при готовности изделия.',
    warranty:       '12 месяцев',
    validity_days:  KP_VALIDITY_DAYS,
  }

  // ── Exclusions ─────────────────────────────────────────────────────────────
  const exclusions: string[] = [
    'Доставка в стоимость не включена (уточняйте отдельно)',
  ]
  const hasMounting = items.some(i =>
    i.line_item.toLowerCase().includes('монтаж') ||
    i.line_item.toLowerCase().includes('installation'),
  )
  if (!hasMounting) {
    exclusions.push('Монтажные работы в стоимость не включены (уточняйте отдельно)')
  }
  if (input.product_type === 'loft') {
    exclusions.push('Стоимость не включает согласование с управляющей компанией')
  }

  // ── Manager message ────────────────────────────────────────────────────────
  const productLine = dimsStr ? `${productLabel}, ${dimsStr}` : productLabel
  const checklistLines = [
    '⚠️ ЧЕРНОВИК — требует проверки перед отправкой клиенту.',
    `Изделие: ${productLine}`,
    `Итоговая стоимость: ${grandTotal.toLocaleString('ru-RU')} ₽`,
    'КП клиенту НЕ отправлено — требуется ручная отправка менеджером.',
    '',
    'Проверьте перед отправкой:',
    '  • корректность размеров и состава изделия;',
    '  • актуальность цены (расчёт на дату составления);',
    '  • условия оплаты соответствуют договорённостям с клиентом;',
    !pricing ? '  • настройки ценообразования не переданы — проверьте маржу вручную;' : null,
    '  • при необходимости уточните сроки производства.',
    'После проверки — отправьте КП клиенту самостоятельно через CRM.',
  ]
  const manager_message = checklistLines.filter(Boolean).join('\n')

  // ── Approval block ─────────────────────────────────────────────────────────
  const approval_block =
    '[ЧЕРНОВИК / DRAFT] Документ подготовлен AI-агентом и требует явного подтверждения ' +
    'менеджера перед отправкой клиенту. Статус: pending_approval.'

  return {
    proposal_title,
    client_summary,
    items,
    price_summary,
    terms,
    exclusions,
    manager_message,
    approval_block,
  }
}

// ─── Main function ─────────────────────────────────────────────────────────────

export async function runGenerateKpDraftTool(
  input: GenerateKpDraftToolInput,
): Promise<GenerateKpDraftToolResponse> {
  const missing_data: string[] = []
  const warnings:     string[] = []
  const errors:       GenerateKpDraftToolError[] = []
  const allowModel    = input.allowModelCall === true

  const safety: GenerateKpDraftSafetyMeta = {
    no_db_write:         true,
    no_crm_write:        true,
    no_client_send:      true,
    no_order_create:     true,
    model_call_allowed:  allowModel,
    model_call_executed: false,   // always false at this stage
  }

  const BASE: Omit<
    GenerateKpDraftToolResponse,
    'ok' | 'mode' | 'draft' | 'missing_data' | 'warnings' | 'errors'
  > = {
    tool:               'generateKpDraft',
    approval_required:  true,
    can_send_to_client: false,
    can_write_crm:      false,
    can_create_order:   false,
    safety,
  }

  // ── Validation ─────────────────────────────────────────────────────────────

  if (!input.client_request || input.client_request.trim() === '') {
    missing_data.push('client_request')
    errors.push({
      code:    'MISSING_CLIENT_REQUEST',
      message: 'Укажите запрос клиента (client_request) — что именно интересует клиента.',
      field:   'client_request',
    })
  }

  if (!input.product_type || input.product_type.trim() === '') {
    missing_data.push('product_type')
    errors.push({
      code:    'MISSING_PRODUCT_TYPE',
      message: 'Укажите тип продукта (product_type): mirror, shower, loft или b2b.',
      field:   'product_type',
    })
  }

  if (!input.calculation_summary) {
    missing_data.push('calculation_summary')
    errors.push({
      code:    'MISSING_CALCULATION_SUMMARY',
      message: 'Передайте итог расчёта (calculation_summary). Выполните расчёт через runQuickCalcTool() и передайте результат.',
      field:   'calculation_summary',
    })
  } else if (typeof input.calculation_summary.final_price !== 'number' || input.calculation_summary.final_price <= 0) {
    missing_data.push('calculation_summary.final_price')
    errors.push({
      code:    'MISSING_PRICE',
      message: 'Итоговая цена (calculation_summary.final_price) равна 0 или отсутствует. Перезапустите расчёт через runQuickCalcTool().',
      field:   'calculation_summary.final_price',
    })
  }

  if (errors.length > 0) {
    return {
      ...BASE,
      ok:           false,
      mode:         'skeleton',
      draft:        null,
      missing_data,
      warnings,
      errors,
    }
  }

  // ── Warnings (non-blocking) ────────────────────────────────────────────────

  // Unknown product_type → warn, use raw value as label
  let productLabel = PRODUCT_LABELS[input.product_type]
  if (!productLabel) {
    warnings.push(
      `Тип продукта "${input.product_type}" не распознан. ` +
      `Известные типы: ${Object.keys(PRODUCT_LABELS).join(', ')}. ` +
      `Черновик сформирован без специфичного шаблона для этого типа.`,
    )
    productLabel = input.product_type
  }

  // Mirror label depends on hasLighting option — don't call plain mirror "с подсветкой"
  if (input.product_type === 'mirror') {
    const hasLighting = Boolean(input.options?.hasLighting)
    productLabel = hasLighting ? 'Зеркало с подсветкой' : 'Зеркало'
  }

  // No pricing rules → warn, use defaults
  if (!input.pricing_rules_summary) {
    warnings.push(
      'pricing_rules_summary не передан. Сроки производства и лимиты скидок подставлены по умолчанию. ' +
      'Для точного КП передайте данные из runPricingRulesTool().',
    )
  }

  // allowModelCall: true but model not connected yet
  if (allowModel) {
    warnings.push(
      'allowModelCall: true получен, но model call на текущем этапе не подключён. ' +
      'Future binding: lib/ai-tools/generateKpDraftTool.ts → внутренний service layer → ' +
      'app/api/ai/generate-kp/route.ts (не через HTTP fetch). ' +
      'Предусловие: approval flow (agent_action_log + Approval UI) должен быть реализован первым. ' +
      'Возвращаю skeleton draft.',
    )
  }

  // ── Build skeleton ─────────────────────────────────────────────────────────

  let draft: KpDraftContent
  try {
    draft = buildSkeleton(input, productLabel)
  } catch (err) {
    console.error('[generateKpDraftTool] Skeleton generation error:', err)
    return {
      ...BASE,
      ok:           false,
      mode:         'skeleton',
      draft:        null,
      missing_data: [],
      warnings,
      errors: [{
        code:    'DRAFT_GENERATION_ERROR',
        message: 'Не удалось сформировать черновик КП. Проверьте корректность входных данных.',
      }],
    }
  }

  return {
    ...BASE,
    ok:           true,
    mode:         allowModel ? 'model_unavailable' : 'skeleton',
    draft,
    missing_data: [],
    warnings,
    errors:       [],
  }
}
