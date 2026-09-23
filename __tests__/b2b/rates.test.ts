import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { B2B_RATE_SPECS, DEFAULT_B2B_RATES, ratesFromRows, ratesMissingNote, type B2BRates } from '@/lib/b2b/rates'
import { calcItem } from '@/lib/b2bCalculator'
import { computeQuoteItem } from '@/lib/b2b/computeQuote'
import { checkQuoteBom } from '@/lib/b2b/bomCheck'
import type { B2BMaterial } from '@/lib/types'

// Справочник b2b_rates: ставки из таблицы, пропуск — заводское значение И сигнал.
const SEED = B2B_RATE_SPECS.map(s => ({ key: s.key, value: s.value }))

const GLASS: B2BMaterial = {
  id: 1, name: 'Прозрачное М1', category: 'стекло', thickness: 8,
  cost_price: 781, sale_price: 2000, waste_percent: 30,
  sheet_width: 3210, sheet_height: 2250,
} as B2BMaterial

describe('ratesFromRows', () => {
  it('полный справочник = заводские значения, пропусков нет', () => {
    const { rates, missing } = ratesFromRows(SEED)
    expect(missing).toEqual([])
    expect(rates).toEqual(DEFAULT_B2B_RATES)
  })

  it('нет строки → заводское значение и её подпись в missing', () => {
    const { rates, missing } = ratesFromRows(SEED.filter(r => r.key !== 'edge_per_m'))
    expect(rates.edgePerM).toBe(40)
    expect(missing).toEqual(['Кромка'])
    expect(ratesMissingNote(missing)).toContain('Кромка')
  })

  it('справочник не прочитался (null) → все ставки в missing', () => {
    const { rates, missing } = ratesFromRows(null)
    expect(rates).toEqual(DEFAULT_B2B_RATES)
    expect(missing).toHaveLength(B2B_RATE_SPECS.length)
  })

  it('пустое, отрицательное и нечисловое значение — не ставка, а пропуск', () => {
    const rows = SEED.map(r =>
      r.key === 'edge_per_m' ? { ...r, value: -1 } :
      r.key === 'packaging_per_m2' ? { key: r.key, value: null } :
      r.key === 'transport_per_piece' ? { key: r.key, value: 'abc' } : r)
    const { missing } = ratesFromRows(rows)
    expect(missing.sort()).toEqual(['Доставка на закалку', 'Кромка', 'Упаковка (гофрокартон)'].sort())
  })

  it('ноль — осознанное значение, а не пропуск', () => {
    const { rates, missing } = ratesFromRows(SEED.map(r => r.key === 'packaging_per_m2' ? { ...r, value: 0 } : r))
    expect(rates.packagingPerM2).toBe(0)
    expect(missing).toEqual([])
  })

  it('новая толщина закалки подхватывается без правки кода', () => {
    const { rates } = ratesFromRows([...SEED, { key: 'tempering_15', value: '1200' }])
    expect(rates.temperingPerM2[15]).toBe(1200)
  })
})

describe('сид миграции = заводские значения кода', () => {
  // Перенос места, не цены: иначе первая загрузка справочника молча сдвинет цены.
  it('каждая строка 20260923_b2b_rates.sql совпадает со спецификацией', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260923_b2b_rates.sql'), 'utf8')
    const seeded = new Map<string, number>()
    for (const m of sql.matchAll(/\('([a-z0-9_]+)',\s*'[^']*',\s*'[^']*',\s*(\d+(?:\.\d+)?),/g)) seeded.set(m[1], Number(m[2]))
    expect(seeded.size).toBe(B2B_RATE_SPECS.length)
    for (const s of B2B_RATE_SPECS) expect(seeded.get(s.key)).toBe(s.value)
  })
})

describe('calcItem считает по переданным ставкам', () => {
  const custom: B2BRates = {
    ...DEFAULT_B2B_RATES,
    temperingPerM2: { ...DEFAULT_B2B_RATES.temperingPerM2, 8: 1000 },
    edgePerM: 80, transportPerPiece: 100, packagingPerM2: 200,
    minLine: { ...DEFAULT_B2B_RATES.minLine, glass_tempering: 9000 },
  }
  const item = (rates?: B2BRates) => calcItem(GLASS, 1000, 2000, 1, 0, true, [], false, null, [], false, 2, null, [], true, rates)

  it('закалка, кромка, доставка на закалку, упаковка — из ставок', () => {
    const base = item()
    const r = item(custom)
    expect(base.costTempering).toBe(2 * 500)
    expect(r.costTempering).toBe(2 * 1000)
    expect(r.costEdge).toBe(Math.round(6 * 80))          // периметр 6 м
    expect(r.costTransport).toBe(100)
    expect(r.costPackaging).toBe(2 * 200)
  })

  it('минимальная цена позиции — из ставок (сторона продажи)', () => {
    const r = item(custom)
    expect(r.minPriceApplied).toBe(true)
    expect(r.saleIncVat).toBe(9000)
  })

  it('без ставок — заводские: поведение до переноса не изменилось', () => {
    expect(item()).toEqual(item(DEFAULT_B2B_RATES))
  })
})

describe('менеджер и партнёр считают по одной таблице', () => {
  it('computeQuoteItem передаёт ставки в ядро', () => {
    const rates: B2BRates = { ...DEFAULT_B2B_RATES, minLine: { ...DEFAULT_B2B_RATES.minLine, glass_tempering: 7777 } }
    const r = computeQuoteItem(
      { material: GLASS, width: 300, height: 300, quantity: 1, hasTempering: true },
      { facetPrices: [], surchargeRules: [], rates },
    )
    expect(r.saleIncVat).toBe(7777)
  })
})

describe('проверка полноты смотрит ту же закалку, что сумма', () => {
  it('нет тарифа толщины в справочнике → блок', () => {
    const ref = { facetPrices: [], temperingPerM2: { 4: 300 } }
    const codes = checkQuoteBom([{ material: GLASS, hasTempering: true }], ref).map(i => i.code)
    expect(codes).toContain('tempering_no_cost')
  })
  it('тариф есть → замечаний по закалке нет', () => {
    const ref = { facetPrices: [], temperingPerM2: DEFAULT_B2B_RATES.temperingPerM2 }
    const codes = checkQuoteBom([{ material: GLASS, hasTempering: true }], ref).map(i => i.code)
    expect(codes).not.toContain('tempering_no_cost')
  })
})
