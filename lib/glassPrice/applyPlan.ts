import type { ApplyPlan, Mapping, MatrixCostRow, ParsedItem, PlanChange, PlanSkip } from './types'

export const MATRIX_THICKNESSES = [4, 5, 6, 8, 10, 12] as const
export type MatrixThickness = typeof MATRIX_THICKNESSES[number]

export function thicknessField(t: number): keyof MatrixCostRow {
  return `t${t}` as keyof MatrixCostRow
}

function productKey(section: string, product: string): string {
  return `${section.trim().toLowerCase()}|${product.trim().toLowerCase()}`
}

export function roundTo(value: number, step: number): number {
  const s = step > 0 ? step : 1
  return Math.round(value / s) * s
}

// План применения прайса к себестоимости справочника «Стекло».
// Правила изоляции: трогаем только cost-строки и только ячейки с привязкой;
// нет цены в прайсе — ячейка остаётся прежней (не обнуляется).
export function buildApplyPlan(
  items: ParsedItem[],
  mappings: Mapping[],
  matrixRows: MatrixCostRow[],
): ApplyPlan {
  const byProduct = new Map<string, Map<number, number>>()
  for (const it of items) {
    if (it.thicknessMm == null || it.pricePerM2 == null) continue
    const key = productKey(it.section, it.product)
    if (!byProduct.has(key)) byProduct.set(key, new Map())
    const slot = byProduct.get(key)!
    if (!slot.has(it.thicknessMm)) slot.set(it.thicknessMm, it.pricePerM2)
  }

  const enabled = mappings.filter(m => m.enabled)
  const rowKey = (name: string, cat: string) => `${name}|${cat}`
  const matrix = new Map(matrixRows.map(r => [rowKey(r.name, r.category), r]))

  const changes: PlanChange[] = []
  const skips: PlanSkip[] = []
  let unchanged = 0

  const targets = [...new Set(enabled.map(m => rowKey(m.matrix_name, m.matrix_category)))]

  for (const target of targets) {
    const [name, category] = target.split('|') as [string, MatrixCostRow['category']]
    const row = matrix.get(target)
    const rules = enabled.filter(m => m.matrix_name === name && m.matrix_category === category)

    for (const thickness of MATRIX_THICKNESSES) {
      const rule = rules.find(m => m.thickness === thickness) ?? rules.find(m => m.thickness === 0)
      if (!rule) continue
      const base = { matrix_name: name, matrix_category: category, thickness, section: rule.section, product: rule.product }

      if (!row) { skips.push({ ...base, reason: 'no_matrix_row' }); continue }
      const prices = byProduct.get(productKey(rule.section, rule.product))
      if (!prices) { skips.push({ ...base, reason: 'no_item' }); continue }
      const price = prices.get(thickness)
      if (price == null) { skips.push({ ...base, reason: 'no_price' }); continue }

      const newValue = roundTo(price * (rule.coefficient || 1), rule.rounding || 1)
      const oldValue = (row[thicknessField(thickness)] as number | null) ?? null
      if (oldValue === newValue) { unchanged++; continue }
      changes.push({ ...base, old_value: oldValue, new_value: newValue, coefficient: rule.coefficient || 1, price_per_m2: price })
    }
  }

  const used = new Set(enabled.map(m => productKey(m.section, m.product)))
  const unmappedProducts = [...new Set(items.map(i => `${i.section}|||${i.product}`))]
    .filter(k => {
      const [section, product] = k.split('|||')
      return !used.has(productKey(section, product))
    })
    .map(k => { const [section, product] = k.split('|||'); return { section, product } })

  changes.sort((a, b) => a.matrix_category.localeCompare(b.matrix_category)
    || a.matrix_name.localeCompare(b.matrix_name) || a.thickness - b.thickness)

  return { changes, unchanged, skips, unmappedProducts }
}

export type MappingSuggestion = {
  matrix_name: string
  matrix_category: MatrixCostRow['category']
  section: string
  product: string
  score: number          // сколько толщин совпало с текущей себестоимостью
  exact: number          // из них точно, копейка в копейку
  matched: number[]
}

// Автоподбор привязок: текущая себестоимость в справочнике пришла из прошлого
// прайса того же поставщика — совпадение цен по нескольким толщинам однозначно
// указывает на колонку прайса.
export function suggestMappings(items: ParsedItem[], matrixRows: MatrixCostRow[]): MappingSuggestion[] {
  const products = new Map<string, { section: string; product: string; prices: Map<number, number> }>()
  for (const it of items) {
    if (it.thicknessMm == null || it.pricePerM2 == null) continue
    const key = productKey(it.section, it.product)
    if (!products.has(key)) products.set(key, { section: it.section, product: it.product, prices: new Map() })
    const slot = products.get(key)!.prices
    if (!slot.has(it.thicknessMm)) slot.set(it.thicknessMm, it.pricePerM2)
  }

  const out: MappingSuggestion[] = []
  for (const row of matrixRows) {
    let best: MappingSuggestion | null = null
    for (const p of products.values()) {
      let score = 0, exact = 0
      const matched: number[] = []
      for (const t of MATRIX_THICKNESSES) {
        const old = row[thicknessField(t)] as number | null
        const now = p.prices.get(t)
        if (!old || !now) continue
        const diff = Math.abs(old - now) / now
        if (diff < 0.001) { score += 2; exact++; matched.push(t) }
        else if (diff <= 0.15) { score += 1; matched.push(t) }
      }
      if (score === 0) continue
      const candidate: MappingSuggestion = {
        matrix_name: row.name, matrix_category: row.category,
        section: p.section, product: p.product, score, exact, matched,
      }
      if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.exact > best.exact)) best = candidate
    }
    if (best) out.push(best)
  }
  return out.sort((a, b) => b.score - a.score)
}
