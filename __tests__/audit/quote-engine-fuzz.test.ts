import { describe, it, expect } from 'vitest'
import { computeQuoteItem, computeQuoteTotals, type QuoteItemInput } from '@/lib/b2b/computeQuote'
import type { B2BOrderItem, FacetPrice } from '@/lib/b2bCalculator'
import type { SurchargeRule } from '@/lib/surcharges'
import type { B2BMaterial } from '@/lib/types'

// ФАЗЗ-ПАРИТЕТ (офлайн, без БД — гоняется в CI всегда). Доказывает объективно:
//   1. computeQuoteItem — ЧИСТАЯ детерминированная функция входа: один и тот же
//      спек → байт-в-байт та же позиция. Значит просчёт клиента и наш пересчёт
//      той же позиции не могут разойтись.
//   2. Менеджер и клиент строят вход одинаково → одинаковый saleIncVat. Разница
//      только в dismissedSurcharges: клиент ВСЕГДА пустой; при пустом и у менеджера
//      цены совпадают. Проверяем, что снятая надбавкой у менеджера — единственный
//      источник легального расхождения (и он под контролем менеджера).
//   3. Надбавки за габариты реально применяются (иначе «паритет» был бы тривиален).
//   4. Итоги (computeQuoteTotals) = сумма позиций со скидкой, без дрейфа.

// Детерминированный PRNG — без Math.random, чтобы фейлы воспроизводились.
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeMaterial(rng: () => number, over: Partial<B2BMaterial> = {}): B2BMaterial {
  return {
    id: Math.floor(rng() * 1e6), name: 'Стекло тест', category: 'стекло',
    thickness: [4, 5, 6, 8, 10][Math.floor(rng() * 5)],
    cost_price: 500 + rng() * 1500, sale_price: 900 + rng() * 4000,
    vat_rate: 12, waste_percent: 10 + Math.floor(rng() * 20), active: true, passthrough: false,
    notes: null, created_at: '2026-01-01', sheet_width: 3210, sheet_height: 2250,
    pattern_direction: 'none' as B2BMaterial['pattern_direction'], ...over,
  }
}

const FACETS: FacetPrice[] = [
  { type_mm: 10, cost_price: 100, transport_cost: 20, sale_price: 250, active: true },
  { type_mm: 15, cost_price: 140, transport_cost: 20, sale_price: 320, active: true },
  { type_mm: 20, cost_price: 180, transport_cost: 20, sale_price: 400, active: true },
]
const SURCHARGES: SurchargeRule[] = [
  { id: 1, axis: 'length', min_mm: 2000, max_mm: 2600, surcharge_percent: 15, label: '>2000мм', shape_filter: null, active: true, sort_order: 1 },
  { id: 2, axis: 'length', min_mm: 2600, max_mm: null, surcharge_percent: 30, label: '>2600мм', shape_filter: null, active: true, sort_order: 2 },
  { id: 3, axis: 'shape', min_mm: 0, max_mm: null, surcharge_percent: 20, label: 'радиус', shape_filter: 'curved', active: true, sort_order: 3 },
]
const REF = { facetPrices: FACETS, surchargeRules: SURCHARGES }

function randomSpec(rng: () => number): QuoteItemInput {
  const facetMm = [10, 15, 20][Math.floor(rng() * 3)]
  const hasFacet = rng() < 0.4
  return {
    material: makeMaterial(rng),
    width: 300 + Math.floor(rng() * 2600),
    height: 300 + Math.floor(rng() * 2600),
    quantity: 1 + Math.floor(rng() * 8),
    hasTempering: rng() < 0.5,
    hasFacet, facetTypeMm: hasFacet ? facetMm : null,
    hasHoles: rng() < 0.3,
    shape: rng() < 0.2 ? 'curved' : 'rect',
    applyMinPrice: rng() < 0.8,
  }
}

describe('Фазз-паритет движка B2B-цены (офлайн)', () => {
  it('детерминизм: один спек → идентичная позиция (менеджер == клиент)', () => {
    const rng = mulberry32(20260825)
    for (let i = 0; i < 800; i++) {
      const spec = randomSpec(rng)
      // «Менеджер» и «клиент» зовут ОДИН движок с одинаковым входом (клиент — пустой dismissed).
      const manager = computeQuoteItem({ ...spec, dismissedSurcharges: new Set<number>() }, REF)
      const partner = computeQuoteItem({ ...spec }, REF)
      expect(partner).toEqual(manager)
      expect(Number.isFinite(partner.saleIncVat)).toBe(true)
      expect(partner.saleIncVat).toBeGreaterThan(0)
    }
  })

  it('надбавки за габариты реально применяются (паритет нетривиален)', () => {
    const rng = mulberry32(7)
    const mat = makeMaterial(rng)
    const base = { material: mat, height: 1000, quantity: 1, applyMinPrice: false } as const
    const small = computeQuoteItem({ ...base, width: 1000 }, REF)          // без надбавки
    const bigNoRule = computeQuoteItem({ ...base, width: 2500 }, { facetPrices: FACETS, surchargeRules: [] })
    const bigWithRule = computeQuoteItem({ ...base, width: 2500 }, REF)    // длинная сторона 2500 → +15%
    // При включённом правиле большая панель дороже такой же панели без правил.
    expect(bigWithRule.saleIncVat).toBeGreaterThan(bigNoRule.saleIncVat)
    expect(bigWithRule.pricePerM2).toBeGreaterThan(0)
    expect(small.saleIncVat).toBeGreaterThan(0)
  })

  it('снятая менеджером надбавка — единственный источник легального расхождения', () => {
    const mat = makeMaterial(mulberry32(3))
    const spec: QuoteItemInput = { material: mat, width: 2500, height: 1200, quantity: 2, applyMinPrice: false }
    const client = computeQuoteItem(spec, REF)                                   // клиент: все надбавки
    const managerKept = computeQuoteItem({ ...spec, dismissedSurcharges: new Set() }, REF)
    const managerDismissed = computeQuoteItem({ ...spec, dismissedSurcharges: new Set([1]) }, REF)
    expect(managerKept.saleIncVat).toBe(client.saleIncVat)                       // не сняли → паритет
    expect(managerDismissed.saleIncVat).toBeLessThan(client.saleIncVat)          // сняли → дешевле (осознанно)
  })

  it('итоги = сумма позиций со скидкой (без дрейфа агрегации)', () => {
    const rng = mulberry32(99)
    for (let t = 0; t < 100; t++) {
      const n = 1 + Math.floor(rng() * 6)
      const items: B2BOrderItem[] = []
      for (let i = 0; i < n; i++) items.push({ ...computeQuoteItem(randomSpec(rng), REF), localId: String(i) })
      const discount = Math.floor(rng() * 30)
      const totals = computeQuoteTotals(items, discount)
      const expected = Math.round(items.reduce((s, it) => s + it.saleIncVat, 0) * (1 - discount / 100))
      // допускаем построчное округление ≤ числа позиций
      expect(Math.abs(totals.totalAfterDiscount - expected)).toBeLessThanOrEqual(n + 1)
    }
  })
})
