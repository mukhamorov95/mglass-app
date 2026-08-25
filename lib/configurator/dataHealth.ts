import { auditKits, type AuditReport, type AuditIssue } from '@/lib/configurator/audit'
import type { Library, ModelKit, KitRates, RoleId } from '@/lib/configurator/kit'
import type { Tier } from '@/lib/configurator/pricing'

// Здоровье данных прайса: не «упадёт ли расчёт», а «что клиент увидит вместо цены и что
// владельцу нужно завести». Собирается поверх auditKits по ОБОИМ тарифам. Пустой премиум
// или незаведённые ролики — это НЕ ошибка кода (CI от этого не краснеет), а бизнес-дыра,
// которую видно отчётом и списком «что завести», отсортированным по влиянию.

export type TierInput = { library: Library; kits: Record<string, ModelKit>; rates: KitRates }
export type FinanceInput = { marginPct: number; taxPct: number; minMarginPct?: number }

export type ModelHealth = {
  code: string
  name: string
  sellable: boolean
  clientSees: 'цена' | 'по запросу'
  gaps: number                // число блокеров
  priceFrom: number | null    // нижняя цена (мин. размер, chrome) если продаётся
}
export type TierHealth = {
  tier: Tier
  empty: boolean              // в тарифе вообще нет данных
  ready: number
  total: number
  models: ModelHealth[]
}

// Позиция списка «что завести»: одна причина, сколько моделей задевает.
export type ToFillItem = {
  key: string
  title: string
  reason: AuditIssue['code']
  tier: Tier
  affects: string[]           // коды моделей
  impact: number              // affects.length — по нему сортируем
}
export type DataHealth = {
  tiers: TierHealth[]
  toFill: ToFillItem[]
  sellableTotal: number       // моделей, продаваемых хотя бы в одном тарифе
  modelsTotal: number
}

function tierHealth(tier: Tier, input: TierInput, finance: FinanceInput): { health: TierHealth; report: AuditReport } {
  const empty = input.library.items.length === 0
  const report = auditKits(input.library, input.kits, input.rates, finance)
  const models: ModelHealth[] = report.models.map(m => ({
    code: m.code, name: m.name, sellable: m.sellable,
    clientSees: m.sellable ? 'цена' : 'по запросу',
    gaps: m.issues.filter(i => i.severity === 'blocker').length,
    priceFrom: m.sellable && m.sizes.length ? m.sizes[0].total : null,
  }))
  return { health: { tier, empty, ready: report.ready, total: report.total, models }, report }
}

export function buildDataHealth(byTier: Record<Tier, TierInput>, finance: Record<Tier, FinanceInput>): DataHealth {
  const budget = tierHealth('budget', byTier.budget, finance.budget)
  const premium = tierHealth('premium', byTier.premium, finance.premium)
  const tiers = [budget.health, premium.health]

  // Список «что завести»: блокеры моделей + дыры библиотеки, сгруппированные по причине.
  const toFill: ToFillItem[] = []
  const push = (tier: Tier, reason: AuditIssue['code'], title: string, code?: string) => {
    const key = `${tier}|${reason}|${title}`
    let item = toFill.find(t => t.key === key)
    if (!item) { item = { key, title, reason, tier, affects: [], impact: 0 }; toFill.push(item) }
    if (code && !item.affects.includes(code)) { item.affects.push(code); item.impact = item.affects.length }
  }

  for (const { report, health } of [budget, premium]) {
    const tier = health.tier
    if (health.empty) { push(tier, 'нет позиции', `Тариф «${tier === 'budget' ? 'Бюджет' : 'Премиум'}» пуст — не заведено ни одной позиции`); continue }
    for (const m of report.models) {
      for (const i of m.issues) {
        if (i.severity !== 'blocker') continue
        push(tier, i.code, `${i.label}: ${i.code}`, m.code)
      }
    }
    for (const i of report.libraryIssues) {
      if (i.severity !== 'blocker') continue
      push(tier, i.code, `${i.label}: ${i.detail}`)
    }
  }
  // Сортировка по влиянию: пустой тариф (impact 0, но title говорит сам) — наверх, затем
  // по числу задетых моделей. Частоту запросов из системы не достать → лучший доступный
  // прокси именно число моделей.
  toFill.sort((a, b) => {
    const aEmpty = a.impact === 0 ? 1 : 0, bEmpty = b.impact === 0 ? 1 : 0
    if (aEmpty !== bEmpty) return bEmpty - aEmpty
    return b.impact - a.impact
  })

  const sellable = new Set<string>()
  for (const t of tiers) for (const m of t.models) if (m.sellable) sellable.add(m.code)

  return {
    tiers, toFill,
    sellableTotal: sellable.size,
    modelsTotal: budget.health.total,
  }
}

export const roleFromIssue = (i: AuditIssue): RoleId | undefined => i.role
