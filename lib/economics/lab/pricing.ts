import { plus, times, type Range } from '../classification/vat'
import type { Bottleneck } from '../engine/cost'

// Ценовые сценарии §11 ТЗ. Цена здесь — с НДС: комиссия берётся с суммы к оплате, поэтому она
// стоит в знаменателе вместе с долей выручки без НДС. Знаменатель проверяется на знак: при
// большой комиссии или целевой марже цены не существует, и это не ноль, а «нет решения».
export type PriceScenario = {
  id: 'A' | 'B' | 'C' | 'D'
  label: string
  formula: string
  incVat: Range | null
  exVat: Range | null
  why: string | null        // почему цены нет
  caution?: string
}

export type PricingInput = {
  variable: Range           // V — переменные без возмещаемого НДС
  full: Range               // F — полная нормативная себестоимость
  vatRatePct: number        // r
  commissionPct: number     // k
  targetMarginPct: number | null   // M
  targetMdPerHour: number | null   // H
  bottleneck: Bottleneck | null    // T берётся из его часов
}

const denom = (r: number, k: number, m = 0) => (1 - m) / (1 + r) - k

export function priceScenarios(i: PricingInput): PriceScenario[] {
  const r = i.vatRatePct / 100, k = i.commissionPct / 100
  const vatPart = `1/(1+${i.vatRatePct}%)`
  const solve = (cost: Range, d: number): Range | null =>
    d > 0 ? { lo: cost.lo / d, hi: cost.hi / d } : null
  const both = (cost: Range, d: number, id: PriceScenario['id'], label: string, formula: string, extra?: Partial<PriceScenario>): PriceScenario => {
    const incVat = solve(cost, d)
    return {
      id, label, formula, incVat, exVat: incVat ? times(incVat, 1 / (1 + r)) : null,
      why: incVat ? null : 'знаменатель не положителен: при такой комиссии и целевой марже цены не существует',
      ...extra,
    }
  }

  const base = denom(r, k)
  const out: PriceScenario[] = [
    both(i.variable, base, 'A', 'Нижняя переменная граница', `P = V ÷ (${vatPart} − k)`, {
      caution: 'это граница покрытия переменных затрат, а не рекомендованная цена',
    }),
    both(i.full, base, 'B', 'Покрытие полной себестоимости', `P = F ÷ (${vatPart} − k)`),
  ]

  if (i.targetMarginPct == null) {
    out.push({ id: 'C', label: 'Целевой маржинальный доход', formula: 'P = V ÷ ((1−M)/(1+r) − k)', incVat: null, exVat: null, why: 'целевая доля МД не задана владельцем' })
  } else {
    out.push(both(i.variable, denom(r, k, i.targetMarginPct / 100), 'C', 'Целевой маржинальный доход',
      `P = V ÷ ((1−${i.targetMarginPct}%)/(1+${i.vatRatePct}%) − k)`))
  }

  if (i.targetMdPerHour == null || !i.bottleneck) {
    out.push({
      id: 'D', label: 'Цена через производственное время', formula: 'P = (V + T × H) ÷ (1/(1+r) − k)',
      incVat: null, exVat: null,
      why: i.targetMdPerHour == null ? 'целевой МД на час ресурса не задан владельцем' : 'ресурс для T не определён',
    })
  } else {
    const t = i.bottleneck.hours
    out.push(both(plus(i.variable, times(t, i.targetMdPerHour)), base, 'D', 'Цена через производственное время',
      `P = (V + ${fmt(t)} ч × ${i.targetMdPerHour} ₽/ч) ÷ (${vatPart} − k), ресурс — ${i.bottleneck.label}`))
  }
  return out
}

const fmt = (r: Range) => (r.lo === r.hi ? String(Math.round(r.lo * 100) / 100) : `${Math.round(r.lo * 100) / 100}…${Math.round(r.hi * 100) / 100}`)
