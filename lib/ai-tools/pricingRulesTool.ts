// lib/ai-tools/pricingRulesTool.ts
//
// Read-only AI tool wrapper for pricing/margin rules from financial_settings.
//
// SAFE PROFILE:
//   reads  Supabase (financial_settings) — yes
//   writes Supabase  — no
//   writes CRM       — no
//   external HTTP    — no
//   sends to client  — no
//   changes prices   — no
//   throws raw errors — no
//
// Used by: proposal-engineer-agent / check-margin skill, create-commercial-proposal skill
// Declared in: ai/tools/tool-registry.ts (key: 'readPricingRules')

import { createClient } from '@supabase/supabase-js'
import type { FinancialSettings } from '../types'
import { totalExpensesPercent } from '../types'

// ─── Safety metadata ──────────────────────────────────────────────────────────

export const PRICING_RULES_SAFETY_META = {
  no_db_write:         true,
  no_crm_write:        true,
  no_external_request: true,
  no_client_send:      true,
  reads_supabase:      true,
} as const

export type PricingRulesToolSafetyMeta = typeof PRICING_RULES_SAFETY_META

// ─── Supported tiers ──────────────────────────────────────────────────────────

const SUPPORTED_TIERS = ['standard', 'budget'] as const

// ─── Input ────────────────────────────────────────────────────────────────────

export type PricingRulesToolInput = {
  scope?: string                  // optional product_type filter: 'mirror' | 'shower' | 'loft' | 'b2b' | ...
  tier?:  'standard' | 'budget'   // optional tier preference
}

// ─── Structured rules output ──────────────────────────────────────────────────

export type PricingRulesNormalized = {
  margin_thresholds: {
    default_margin:    number   // целевая маржа, %
    min_margin:        number   // минимально допустимая, %
    green_threshold:   number   // маржа "зелёного" состояния, %
    yellow_threshold:  number   // маржа "жёлтого" предупреждения, %
    red_threshold:     number   // маржа "красного" риска, %
    blocked_below:     number   // запрещено продавать ниже, %
  }
  discount_limits: {
    max_discount_percent: number  // максимальная скидка, %
  }
  expense_breakdown: {
    tax_percent:            number   // налог, %
    manager_percent:        number   // вознаграждение менеджера, %
    realization_percent:    number   // реализация, %
    marketing_percent:      number   // маркетинг, %
    transport_percent:      number   // транспорт, %
    operation_percent:      number   // операционные, %
    total_expenses_percent: number   // сумма всех статей расходов (производный)
  }
  sla_targets: {
    days_approved: number   // дней на утверждение КП
    days_in_work:  number   // дней в производстве
  }
  matched_row: {
    id:           number
    tier:         string
    product_type: string | null
    updated_at:   string
  }
  all_rows_summary: Array<{
    id:           number
    tier:         string
    product_type: string | null
  }>
}

// ─── Error ────────────────────────────────────────────────────────────────────

export type PricingRulesToolError = {
  code:     string
  message:  string   // user-facing, no raw Supabase errors
  field?:   string
}

// ─── Response ─────────────────────────────────────────────────────────────────

export type PricingRulesToolResponse = {
  ok:                 boolean
  tool:               'readPricingRules'
  mode:               'read_only'
  source:             'financial_settings'
  rules:              PricingRulesNormalized | null
  warnings:           string[]
  errors:             PricingRulesToolError[]
  approval_required:  false
  can_change_price:   false
  can_send_to_client: false
  safety:             PricingRulesToolSafetyMeta
}

// ─── Supabase client (server-side only) ───────────────────────────────────────
// Uses SERVICE_ROLE_KEY — call only from Next.js API routes or Node.js runtime.

function buildClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ─── Row selection ────────────────────────────────────────────────────────────
// Mirrors quickCalc.pickSettings: first match by product_type, then by tier, then first row.

function pickRow(
  rows: FinancialSettings[],
  scope?: string,
  tier?: string,
): FinancialSettings | null {
  if (scope) {
    const byScope = rows.find(r => r.product_type === scope)
    if (byScope) return byScope
  }
  if (tier) {
    const byTier = rows.find(r => r.tier === tier)
    if (byTier) return byTier
  }
  return (
    rows.find(r => r.tier === 'standard') ??
    rows[0] ??
    null
  )
}

// ─── Normalizer ───────────────────────────────────────────────────────────────

function normalizeRow(
  row: FinancialSettings,
  allRows: FinancialSettings[],
): PricingRulesNormalized {
  return {
    margin_thresholds: {
      default_margin:    row.default_margin,
      min_margin:        row.min_margin,
      green_threshold:   row.green_threshold,
      yellow_threshold:  row.yellow_threshold,
      red_threshold:     row.red_threshold,
      blocked_below:     row.blocked_below,
    },
    discount_limits: {
      max_discount_percent: row.max_discount_percent,
    },
    expense_breakdown: {
      tax_percent:            row.tax_percent,
      manager_percent:        row.manager_percent,
      realization_percent:    row.realization_percent,
      marketing_percent:      row.marketing_percent,
      transport_percent:      row.transport_percent,
      operation_percent:      row.operation_percent,
      total_expenses_percent: totalExpensesPercent(row),
    },
    sla_targets: {
      days_approved: row.sla_days_approved,
      days_in_work:  row.sla_days_in_work,
    },
    matched_row: {
      id:           row.id,
      tier:         row.tier,
      product_type: row.product_type,
      updated_at:   row.updated_at,
    },
    all_rows_summary: allRows.map(r => ({
      id:           r.id,
      tier:         r.tier,
      product_type: r.product_type,
    })),
  }
}

// ─── Base response shape ──────────────────────────────────────────────────────

const BASE: Omit<PricingRulesToolResponse, 'ok' | 'rules' | 'warnings' | 'errors'> = {
  tool:               'readPricingRules',
  mode:               'read_only',
  source:             'financial_settings',
  approval_required:  false,
  can_change_price:   false,
  can_send_to_client: false,
  safety:             PRICING_RULES_SAFETY_META,
}

// ─── Main function ─────────────────────────────────────────────────────────────

export async function runPricingRulesTool(
  input?: PricingRulesToolInput,
): Promise<PricingRulesToolResponse> {
  const warnings: string[] = []
  const scope = input?.scope
  const tier  = input?.tier

  // Validate tier — if provided but not a known value, warn and proceed with fallback
  if (tier !== undefined && !(SUPPORTED_TIERS as readonly string[]).includes(tier)) {
    warnings.push(
      `Tier "${tier}" не поддерживается. Допустимые значения: ${SUPPORTED_TIERS.join(', ')}. Используется fallback (standard).`,
    )
  }

  // Fetch all financial_settings rows
  let rows: FinancialSettings[]
  try {
    const supabase = buildClient()
    const { data, error } = await supabase.from('financial_settings').select('*')
    if (error) throw error
    rows = (data ?? []) as FinancialSettings[]
  } catch (err) {
    console.error('[pricingRulesTool] Supabase fetch error:', err)
    return {
      ...BASE,
      ok:       false,
      rules:    null,
      warnings,
      errors: [{
        code:    'FETCH_ERROR',
        message: 'Не удалось получить правила ценообразования. Проверьте соединение с базой данных или обратитесь к администратору.',
      }],
    }
  }

  // Empty table — cannot derive any rules
  if (rows.length === 0) {
    return {
      ...BASE,
      ok:       false,
      rules:    null,
      warnings,
      errors: [{
        code:    'EMPTY_SETTINGS',
        message: 'Таблица financial_settings пуста. Добавьте настройки ценообразования в панели администратора (/admin/settings).',
      }],
    }
  }

  // Warn if requested scope has no matching product_type row — will use fallback
  if (scope) {
    const hasMatch = rows.some(r => r.product_type === scope)
    if (!hasMatch) {
      const knownScopes = rows
        .map(r => r.product_type)
        .filter(Boolean)
        .join(', ')
      warnings.push(
        `Настройки для scope "${scope}" не найдены в financial_settings` +
        (knownScopes ? ` (известные: ${knownScopes})` : '') +
        '. Используется стандартный fallback.',
      )
    }
  }

  // Pick best matching row (mirrors quickCalc logic)
  const picked = pickRow(rows, scope, tier)
  if (!picked) {
    return {
      ...BASE,
      ok:       false,
      rules:    null,
      warnings,
      errors: [{
        code:    'NO_MATCHING_ROW',
        message: 'Не удалось выбрать подходящую строку настроек. Возможно, таблица financial_settings содержит некорректные данные.',
      }],
    }
  }

  // Sanity checks — non-blocking, produce warnings only
  const totalExp = totalExpensesPercent(picked)
  if (totalExp <= 0) {
    warnings.push('Суммарные расходы равны 0%. Проверьте настройки financial_settings в панели администратора.')
  } else if (totalExp >= 100) {
    warnings.push(
      `Суммарные расходы (${totalExp}%) ≥ 100%. Это может указывать на некорректные настройки.`,
    )
  }

  if (picked.blocked_below > picked.min_margin) {
    warnings.push(
      `blocked_below (${picked.blocked_below}%) > min_margin (${picked.min_margin}%). Проверьте корректность порогов маржи.`,
    )
  }

  const rules = normalizeRow(picked, rows)

  return {
    ...BASE,
    ok:       true,
    rules,
    warnings,
    errors:   [],
  }
}
