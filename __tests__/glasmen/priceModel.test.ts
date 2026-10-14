import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeQuoteItem } from '@/lib/b2b/computeQuote'
import { prepPricedMaterials } from '@/lib/b2bMaterialPricing'
import { ratesFromRows } from '@/lib/b2b/rates'
import { resolveMinLinePrice, effectiveItemTotal, type B2BOrderItem } from '@/lib/b2bCalculator'
import type { B2BMaterial } from '@/lib/types'
import type { SurchargeRule } from '@/lib/surcharges'
import {
  PRESETS, PRICE_MODEL_IDS, priceLadder, applyOrderMinimum, sanitizeParams, ladderPct, allocate, itemComponents,
  type PriceModelId, type PriceLadderInput,
} from '@/lib/glasmen/priceModel'

// Справочники — те же строки, что в docs/b2b-site/price-data/examples.ts (снимок прода 14.10.2026).
const mat = (id: number, name: string, category: string, thickness: number, cost: number, waste: number, sale: number) =>
  ({ id, name, category, thickness, cost_price: cost, waste_percent: waste, notes: JSON.stringify({ sale_price: sale }), active: true, vat_rate: 22 } as unknown as B2BMaterial)

const mats = prepPricedMaterials([
  mat(3, 'Прозрачное М1', 'стекло', 6, 570, 30, 2200),
  mat(4, 'Прозрачное М1', 'стекло', 8, 798, 30, 3100),
  mat(53, 'Осветлённое CrystalVision', 'стекло', 8, 2016, 30, 6200),
  mat(60, 'Серебро', 'зеркало', 4, 820, 18, 1950),
  mat(21, 'Сатинированное бесцветное', 'сатин', 4, 690, 30, 2300),
], [
  { name: 'Прозрачное М1', category: 'glass', price_type: 'sale', t4: 1800, t5: 2100, t6: 2200, t8: 3100, t10: 3600, waste_pct: 0 },
  { name: 'Осветлённое CrystalVision', category: 'glass', price_type: 'sale', t4: 3300, t6: 4300, t8: 6200, t10: 7500, waste_pct: 0 },
  { name: 'Серебро', category: 'mirror', price_type: 'sale', t4: 1950, t6: 3250, waste_pct: 0 },
  { name: 'Сатинированное бесцветное', category: 'glass', price_type: 'sale', t4: 2300, t5: 2900, t6: 3300, t8: 4400, t10: 5800, waste_pct: 0 },
])
const byId = new Map(mats.map(m => [m.id, m]))

const { rates } = ratesFromRows([
  ['tempering_4', 300], ['tempering_5', 350], ['tempering_6', 400], ['tempering_8', 500], ['tempering_10', 600], ['tempering_12', 950],
  ['edge_per_m', 40], ['transport_per_piece', 77], ['packaging_per_m2', 120],
  ['min_glass_tempering', 2500], ['min_tinted_tempering', 3000], ['min_mirror', 1500], ['min_narrow_detail', 1500],
  ['margin_target', 35], ['margin_min', 25],
].map(([key, value]) => ({ key: key as string, value: value as number })))

const surchargeRules: SurchargeRule[] = [
  { id: 1, axis: 'length', min_mm: 2400, max_mm: 2600, surcharge_percent: 10, label: 'Крупногабарит 2400–2600', shape_filter: null },
  { id: 4, axis: 'width', min_mm: 1200, max_mm: 1400, surcharge_percent: 10, label: 'Широкая 1200–1400', shape_filter: null },
]
const ref = { facetPrices: [], surchargeRules, rates }

type Part = { key: string; matId: number; w: number; h: number; temp: boolean; holes?: { d: number; n: number }[] }
const PARTS: Part[] = [
  { key: 'mirror300', matId: 60, w: 300, h: 300, temp: false },
  { key: 'm1_600x800', matId: 3, w: 600, h: 800, temp: true },
  { key: 'm1_1000x500', matId: 4, w: 1000, h: 500, temp: true, holes: [{ d: 12, n: 4 }] },
  { key: 'shelf800x250', matId: 3, w: 800, h: 250, temp: true },
  { key: 'satin291x913', matId: 21, w: 291, h: 913, temp: true },
  { key: 'door900x2000', matId: 53, w: 900, h: 2000, temp: true, holes: [{ d: 12, n: 4 }] },
]

// docs/b2b-site/price-data/examples_out.csv, скидка 10 %: q; сейчас_строка; сейчас/шт; пол; A-line/шт; A-group/шт; B/шт; B весь заказ/шт; C весь заказ/шт
type Expected = [number, number, number, boolean, number, number, number, number, number]
const CSV: Record<string, Expected[]> = {
  mirror300: [
    [1, 1350, 1350, true, 1043, 1055, 1350, 3000, 5000], [5, 6750, 1350, true, 322, 335, 270, 600, 1350],
    [10, 13500, 1350, true, 232, 245, 139, 300, 1350], [50, 67500, 1350, true, 160, 173, 122, 122, 1350],
  ],
  m1_600x800: [
    [1, 2250, 2250, true, 1755, 1830, 2250, 3000, 5000], [5, 11250, 2250, true, 1035, 1110, 882, 882, 2250],
    [10, 22500, 2250, true, 946, 1020, 833, 833, 2250], [50, 112500, 2250, true, 873, 948, 735, 735, 2250],
  ],
  m1_1000x500: [
    [1, 2250, 2250, true, 2156, 2264, 2250, 3000, 5000], [5, 11250, 2250, true, 1436, 1544, 1295, 1295, 2250],
    [10, 22500, 2250, true, 1346, 1454, 1223, 1223, 2250], [50, 112500, 2250, true, 1274, 1382, 1079, 1079, 2250],
  ],
  shelf800x250: [
    [1, 2250, 2250, true, 1256, 1287, 2250, 3000, 5000], [5, 11250, 2250, true, 536, 567, 450, 600, 2250],
    [10, 22500, 2250, true, 446, 477, 347, 347, 2250], [50, 112500, 2250, true, 374, 405, 306, 306, 2250],
  ],
  satin291x913: [
    [1, 2700, 2700, true, 1395, 1438, 2700, 3000, 5000], [5, 13500, 2700, true, 675, 718, 540, 600, 2700],
    [10, 27000, 2700, true, 585, 628, 482, 482, 2700], [50, 135000, 2700, true, 513, 556, 426, 426, 2700],
  ],
  door900x2000: [
    [1, 10044, 10044, false, 9941, 10724, 10360, 10360, 10044], [5, 50220, 10044, false, 9221, 10004, 9324, 9324, 10044],
    [10, 100440, 10044, false, 9131, 9914, 8806, 8806, 10044], [50, 502200, 10044, false, 9059, 9842, 7770, 7770, 10044],
  ],
}
const QTYS = [1, 5, 10, 50]
const DISC = 10

function engineInput(p: Part, quantities: number[]): PriceLadderInput {
  const m = byId.get(p.matId)!
  const base = { material: m, width: p.w, height: p.h, hasTempering: p.temp, hasHoles: !!p.holes, holes: p.holes ?? [] }
  const v1 = computeQuoteItem({ ...base, quantity: 1, applyMinPrice: false }, ref).saleIncVat
  const lineValues: Record<number, number> = {}
  for (const q of quantities) lineValues[q] = computeQuoteItem({ ...base, quantity: q, applyMinPrice: false }, ref).saleIncVat
  const fp = resolveMinLinePrice(m.category, p.w, p.h, p.temp, rates.minLine)?.minPricePerPiece ?? 0
  return { v1, floorPerPiece: fp, discountPct: DISC, quantities, lineValues }
}

const sumOf = (r: { breakdown: { amount: number }[] }) => r.breakdown.reduce((s, l) => s + l.amount, 0)

describe('priceModel: таблица 3.5 PRICE_OUR_MODELS (examples_out.csv) до рубля', () => {
  for (const part of PARTS) {
    it(part.key, () => {
      const inp = engineInput(part, QTYS)
      const exp = CSV[part.key]
      const cur = priceLadder(inp, 'current')
      const aL = priceLadder(inp, 'aLine')
      const aG = priceLadder(inp, 'aGroup')
      const b = priceLadder(inp, 'ladderB')
      const bW = priceLadder({ ...inp, asWholeOrder: true }, 'ladderB')
      const cW = priceLadder({ ...inp, asWholeOrder: true }, 'minC')
      const c = priceLadder(inp, 'minC')
      exp.forEach(([q, curLine, curPP, floor, aLPP, aGPP, bPP, bWPP, cWPP], i) => {
        expect(cur[i].qty).toBe(q)
        expect(cur[i].lineTotal).toBe(curLine)
        expect(cur[i].perPiece).toBe(curPP)
        expect(cur[i].floorApplied).toBe(floor)
        expect(aL[i].perPiece).toBe(aLPP)
        expect(aG[i].perPiece).toBe(aGPP)
        expect(b[i].perPiece).toBe(bPP)
        expect(bW[i].perPiece).toBe(bWPP)
        expect(cW[i].perPiece).toBe(cWPP)
        expect(c[i].lineTotal).toBe(cur[i].lineTotal)
      })
    })
  }

  it('«сейчас» = движок с полом и скидкой (effectiveItemTotal) на любом q', () => {
    for (const part of PARTS) {
      const qs = [1, 2, 3, 7, 30, 140]
      const inp = engineInput(part, qs)
      const rows = priceLadder(inp, 'current')
      const m = byId.get(part.matId)!
      qs.forEach((q, i) => {
        const it = computeQuoteItem({ material: m, width: part.w, height: part.h, quantity: q, hasTempering: part.temp }, ref)
        expect(rows[i].lineTotal).toBe(effectiveItemTotal({ ...it, localId: 't' } as B2BOrderItem, DISC))
      })
    }
  })

  it('сатин 291×913 × 30: механизм 05597 — 90 000 ₽ до скидки при прайсе 18 333 ₽', () => {
    const inp = { ...engineInput(PARTS[4], [30]), discountPct: 0 }
    const [row] = priceLadder(inp, 'current')
    expect(row.lineTotal).toBe(90000)
    expect(row.breakdown[0].amount).toBe(18333)
    expect(row.breakdown[1].amount).toBe(90000 - 18333)
  })
})

// Детерминированный генератор, чтобы падение воспроизводилось.
function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}

describe('priceModel: тождество разбивки', () => {
  it('Σ breakdown = lineTotal для случайных входов всех моделей', () => {
    const r = rng(42)
    for (let i = 0; i < 400; i++) {
      const v1 = Math.round(50 + r() * 20000)
      const inp: PriceLadderInput = {
        v1,
        floorPerPiece: [0, 1500, 2500, 3000][Math.floor(r() * 4)],
        discountPct: Math.round(r() * 30 * 10) / 10,
        quantities: [1, 2, 3, 5, 7, 10, 24, 25, 49, 50, 333],
        groupLines: 1 + Math.floor(r() * 4),
        asWholeOrder: r() < 0.5,
        temperingPart: r() < 0.3 ? Math.round(v1 * 0.2) : undefined,
      }
      const params = {
        S: Math.round(r() * 3000), k: 0.8 + r() * 0.4, M: Math.round(r() * 10000),
        floorPerLine: r() < 0.5, ladderAppliesToTempering: r() < 0.5,
      }
      for (const model of PRICE_MODEL_IDS) {
        for (const row of priceLadder(inp, model, params)) {
          expect(Number.isInteger(row.lineTotal)).toBe(true)
          for (const l of row.breakdown) expect(Number.isInteger(l.amount)).toBe(true)
          expect(sumOf(row)).toBe(row.lineTotal)
        }
      }
    }
  })
})

describe('priceModel: поведение по количеству', () => {
  const QS = [1, 2, 5, 10, 25, 50, 100]
  it('цена за штуку не растёт с количеством: aLine, aGroup, ladderB', () => {
    const r = rng(7)
    for (let i = 0; i < 300; i++) {
      const inp: PriceLadderInput = {
        v1: Math.round(30 + r() * 15000), floorPerPiece: [0, 1500, 2500, 3000][Math.floor(r() * 4)],
        discountPct: Math.round(r() * 30), quantities: QS, groupLines: 1 + Math.floor(r() * 3),
      }
      for (const model of ['aLine', 'aGroup', 'ladderB'] as PriceModelId[]) {
        const rows = priceLadder(inp, model)
        for (let j = 1; j < rows.length; j++) expect(rows[j].perPiece).toBeLessThanOrEqual(rows[j - 1].perPiece)
      }
    }
  })

  it('«сейчас»: цена за штуку от количества не зависит', () => {
    for (const part of PARTS) {
      const rows = priceLadder(engineInput(part, QS), 'current')
      for (const row of rows) expect(row.perPiece).toBe(rows[0].perPiece)
    }
    const r = rng(9)
    for (let i = 0; i < 300; i++) {
      const rows = priceLadder({ v1: Math.round(30 + r() * 15000), floorPerPiece: 2500, discountPct: Math.round(r() * 30), quantities: QS }, 'current')
      // v1 × q без карты движка: отличие от цены 1 шт. — только рубль округления скидки
      for (const row of rows) expect(Math.abs(row.perPiece - rows[0].perPiece)).toBeLessThanOrEqual(1)
    }
  })
})

describe('priceModel: пол и минимум заказа', () => {
  const inp: PriceLadderInput = { v1: 400, floorPerPiece: 2500, discountPct: 0, quantities: [1, 4, 10] }

  it('сейчас: пол × шт.', () => {
    const rows = priceLadder(inp, 'current')
    expect(rows.map(r => r.lineTotal)).toEqual([2500, 10000, 25000])
    expect(rows.every(r => r.floorApplied)).toBe(true)
  })

  it('ladderB: пол один раз на строку', () => {
    const rows = priceLadder(inp, 'ladderB')
    expect(rows[0].lineTotal).toBe(2500)
    expect(rows[1].lineTotal).toBe(2500)
    expect(rows[1].floorApplied).toBe(true)
    // 10 шт.: k·v·(1 − 15 %) = 1,0315 × 4000 × 0,85 = 3507,1 > пола
    expect(rows[2].floorApplied).toBe(false)
    expect(rows[2].lineTotal).toBe(3507)
  })

  it('ladderB с floorPerLine:false ведёт себя как пол × шт.', () => {
    const rows = priceLadder(inp, 'ladderB', { floorPerLine: false })
    expect(rows.map(r => r.lineTotal)).toEqual([2500, 10000, 25000])
  })

  it('aLine / aGroup: пола нет', () => {
    for (const m of ['aLine', 'aGroup'] as PriceModelId[]) for (const r of priceLadder(inp, m)) expect(r.floorApplied).toBe(false)
  })

  it('минимум заказа — только при asWholeOrder и только сверх суммы', () => {
    expect(applyOrderMinimum(1200, { M: 5000 })).toEqual({ total: 5000, minOrderApplied: true, topUp: 3800 })
    expect(applyOrderMinimum(7000, { M: 5000 })).toEqual({ total: 7000, minOrderApplied: false, topUp: 0 })
    expect(applyOrderMinimum(100, { M: 0 })).toEqual({ total: 100, minOrderApplied: false, topUp: 0 })
    const small: PriceLadderInput = { v1: 400, floorPerPiece: 0, discountPct: 10, quantities: [1] }
    expect(priceLadder(small, 'minC')[0].minOrderApplied).toBe(false)
    const [w] = priceLadder({ ...small, asWholeOrder: true }, 'minC')
    expect(w.lineTotal).toBe(5000)
    expect(w.minOrderApplied).toBe(true)
    expect(priceLadder({ ...small, asWholeOrder: true }, 'current')[0].minOrderApplied).toBe(false)
  })

  it('aGroup: наладка делится между строками группы, остаток рубля — первым строкам', () => {
    const one = priceLadder({ v1: 5000, floorPerPiece: 0, discountPct: 0, quantities: [1] }, 'aGroup')[0]
    const three = [0, 1, 2].map(gi => priceLadder({ v1: 5000, floorPerPiece: 0, discountPct: 0, quantities: [1], groupLines: 3, groupIndex: gi }, 'aGroup')[0])
    expect(three.map(r => one.lineTotal - r.lineTotal)).toEqual([1000 - 334, 1000 - 333, 1000 - 333])
    expect(three[0].breakdown.find(l => l.label.startsWith('Наладка'))).toEqual({ label: 'Наладка на материал заказа (доля 1 из 3)', amount: 334 })
  })

  it('aGroup со скидкой: наладка группы в сумме ровно round(S·(1−d)), каждая строка сходится', () => {
    for (const n of [2, 3, 7, 50, 51]) {
      const rows = Array.from({ length: n }, (_, gi) => priceLadder({ v1: 1234, floorPerPiece: 0, discountPct: 10, quantities: [3], groupLines: n, groupIndex: gi }, 'aGroup')[0])
      const kvAfter = Math.round(0.9781 * Math.round(1234 * 3) * 0.9)
      expect(rows.reduce((a, r) => a + (r.lineTotal - kvAfter), 0), `n=${n}`).toBe(Math.round(1000 * 0.9))
      for (const r of rows) expect(r.breakdown.reduce((a, l) => a + l.amount, 0)).toBe(r.lineTotal)
    }
  })
})

describe('priceModel: пресеты и параметры', () => {
  it('черновики названы черновиками и называют окно калибровки', () => {
    for (const id of ['aLine', 'aGroup', 'ladderB', 'minC'] as PriceModelId[]) {
      expect(PRESETS[id].description).toMatch(/черновик — ждёт решения владельца \(решение 4/i)
      expect(PRESETS[id].description).toContain('563 заказа 01.07–14.10.2026')
    }
    expect(PRESETS.aLine.params).toMatchObject({ S: 1000, k: 0.9001 })
    expect(PRESETS.aGroup.params).toMatchObject({ S: 1000, k: 0.9781 })
    expect(PRESETS.ladderB.params).toMatchObject({ k: 1.0315, M: 3000, floorPerLine: true })
    expect(PRESETS.minC.params.M).toBe(5000)
  })

  it('лесенка B: ступени из документа', () => {
    const L = PRESETS.ladderB.params.ladder
    expect([1, 2, 4, 5, 9, 10, 24, 25, 49, 50, 140].map(q => ladderPct(q, L))).toEqual([0, 5, 5, 10, 10, 15, 15, 20, 20, 25, 25])
  })

  it('sanitizeParams зажимает и говорит об этом вслух', () => {
    const { params, warnings } = sanitizeParams('aLine', { S: 999999, k: 'x', foo: 1 })
    expect(params.S).toBe(20000)
    expect(params.k).toBe(0.9001)
    expect(warnings.length).toBe(3)
    const cur = sanitizeParams('current', { k: 2 })
    expect(cur.params.k).toBe(1)
    expect(cur.warnings.length).toBe(1)
    const b = sanitizeParams('ladderB', { ladder: [{ fromQty: 10, pct: 99 }, { fromQty: 2, pct: 5 }] })
    expect(b.params.ladder).toEqual([{ fromQty: 2, pct: 5 }, { fromQty: 10, pct: 60 }])
  })

  it('ответ модели не содержит себестоимости', () => {
    const rows = priceLadder(engineInput(PARTS[5], QTYS), 'ladderB')
    const json = JSON.stringify({ rows, presets: PRESETS })
    expect(json).not.toMatch(/cost|margin|inputVat|себестоим|маржа/i)
  })
})

// ── API демо: гейт владельца, сверка «Сейчас» с движком, в ответе нет себестоимости ──

const auth = vi.hoisted(() => ({ owner: true }))
const db = vi.hoisted(() => ({ reads: 0 }))
vi.mock('@/lib/apiAuth', async () => {
  const { NextResponse } = await import('next/server')
  return { requireOwner: async () => auth.owner ? 'admin' : NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 }) }
})
const RAW_MATERIALS = [
  mat(3, 'Прозрачное М1', 'стекло', 6, 570, 30, 2200),
  mat(53, 'Осветлённое CrystalVision', 'стекло', 8, 2016, 30, 6200),
  mat(60, 'Серебро', 'зеркало', 4, 820, 18, 1950),
  mat(21, 'Сатинированное бесцветное', 'сатин', 4, 690, 30, 2300),
]
const TABLES: Record<string, unknown[]> = {
  b2b_materials: RAW_MATERIALS,
  glass_price_matrix: [],
  facet_prices: [{ type_mm: 10, cost_price: 220, transport_cost: 20, sale_price: 500 }],
  b2b_surcharge_rules: surchargeRules,
  b2b_rates: [
    ['tempering_4', 300], ['tempering_5', 350], ['tempering_6', 400], ['tempering_8', 500], ['tempering_10', 600], ['tempering_12', 950],
    ['edge_per_m', 40], ['transport_per_piece', 77], ['packaging_per_m2', 120],
    ['min_glass_tempering', 2500], ['min_tinted_tempering', 3000], ['min_mirror', 1500], ['min_narrow_detail', 1500],
    ['margin_target', 35], ['margin_min', 25],
  ].map(([key, value]) => ({ key, value })),
}
vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      db.reads++
      const res = { data: TABLES[table] ?? null, error: TABLES[table] ? null : { message: 'no table' } }
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order']) chain[m] = () => chain
      chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok)
      return chain
    },
  }),
}))

const COST_KEYS = /"(cost\w*|margin\w*|inputVat|costWithVat|costExVat|waste\w*|cost_price)"/

describe('API /api/glasmen-demo', () => {
  beforeEach(() => { auth.owner = true })

  const post = async (body: unknown) => {
    const { POST } = await import('@/app/api/glasmen-demo/quote/route')
    const { NextRequest } = await import('next/server')
    return POST(new NextRequest('http://x/api/glasmen-demo/quote', { method: 'POST', body: JSON.stringify(body) }))
  }

  it('не владелец — 403 до чтения справочников', async () => {
    auth.owner = false
    expect((await post({ materialId: 3, width: 600, height: 800 })).status).toBe(403)
    const { GET } = await import('@/app/api/glasmen-demo/materials/route')
    expect((await GET()).status).toBe(403)
  })

  it('материалы: прайс за м², закаляемость, без закупки', async () => {
    const { GET } = await import('@/app/api/glasmen-demo/materials/route')
    const res = await GET()
    const text = await res.text()
    expect(text).not.toMatch(COST_KEYS)
    const j = JSON.parse(text)
    expect(j.combos).toBe(4)
    expect(j.materials.map((m: { category: string }) => m.category)).toEqual(['зеркало', 'сатин', 'стекло', 'стекло'])
    expect(j.materials.find((m: { id: number }) => m.id === 60).temperable).toBe(false)
    expect(j.materials.find((m: { id: number }) => m.id === 3)).toMatchObject({ pricePerM2: 2200, temperable: true })
  })

  it('расчёт: таблица 3.5 для полки 800×250, сверка без предупреждений, без себестоимости', async () => {
    const res = await post({ materialId: 3, width: 800, height: 250, hasTempering: true, quantities: [1, 5, 10, 50], discountPct: 10 })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toMatch(COST_KEYS)
    const j = JSON.parse(text)
    expect(j.warnings).toEqual([])
    const pp = (id: string) => j.models[id].rows.map((r: { perPiece: number }) => r.perPiece)
    expect(pp('current')).toEqual([2250, 2250, 2250, 2250])
    expect(pp('aLine')).toEqual([1256, 536, 446, 374])
    expect(pp('aGroup')).toEqual([1287, 567, 477, 405])
    expect(pp('ladderB')).toEqual([2250, 450, 347, 306])
    expect(j.material).toMatchObject({ id: 3, pricePerM2: 2200, temperable: true })
    expect(j.areaPieceM2).toBe(0.2)
  })

  it('расчёт: надбавка за габарит и неверный ввод', async () => {
    const ok = await (await post({ materialId: 53, width: 1300, height: 2500, hasTempering: true, quantities: [1] })).json()
    expect(ok.surcharges.map((s: { pct: number }) => s.pct).sort()).toEqual([10, 10])
    expect(ok.warnings).toEqual([])
    expect((await post({ materialId: 60, width: 300, height: 300, hasTempering: true })).status).toBe(400)
    expect((await post({ materialId: 3, width: 5, height: 300 })).status).toBe(400)
    expect((await post({ materialId: 3, width: 300, height: 300, discountPct: 31 })).status).toBe(400)
    expect((await post({ materialId: 3, width: 300, height: 300, quantities: Array.from({ length: 21 }, (_, i) => i + 1) })).status).toBe(400)
    expect((await post({ materialId: 3, width: 300, height: 300, hasFacet: true, facetTypeMm: 15 })).status).toBe(400)
    expect((await post({ materialId: 3, width: 300, height: 300, models: ['zzz'] })).status).toBe(400)
  })

  it('отверстия 1…100 мм; Ø101 — 400 с подсказкой «крупнее — вырез»', async () => {
    expect((await post({ materialId: 3, width: 600, height: 800, holes: [{ d: 100, n: 1 }] })).status).toBe(200)
    const r = await post({ materialId: 3, width: 600, height: 800, holes: [{ d: 101, n: 1 }] })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/1…100 мм \(крупнее — вырез\)/)
  })

  it('aGroup: строки группы по groupIndex в сумме несут ровно наладку; пределы groupLines/groupIndex', async () => {
    const rows = await Promise.all([0, 1, 2].map(async gi => (await (await post({
      materialId: 3, width: 600, height: 800, hasTempering: true, quantities: [2], discountPct: 0, models: ['aGroup'], groupLines: 3, groupIndex: gi,
    })).json()).models.aGroup.rows[0]))
    const setups = rows.map((r: { breakdown: { label: string; amount: number }[] }) => r.breakdown.find(l => l.label.startsWith('Наладка'))!.amount)
    expect(setups).toEqual([334, 333, 333])
    const lt = rows.map((r: { lineTotal: number }) => r.lineTotal)
    expect(lt[0] - lt[1]).toBe(1)                              // рубль остатка наладки — первой строке
    for (const r of rows) expect(r.breakdown.reduce((a: number, l: { amount: number }) => a + l.amount, 0)).toBe(r.lineTotal)
    expect((await post({ materialId: 3, width: 600, height: 800, groupLines: 1000, groupIndex: 999 })).status).toBe(200)
    expect((await post({ materialId: 3, width: 600, height: 800, groupLines: 1001 })).status).toBe(400)
    expect((await post({ materialId: 3, width: 600, height: 800, groupLines: 3, groupIndex: 3 })).status).toBe(400)
  })

  it('разбивка в ответе: стекло, обе надбавки и фацет отдельными строками; «Сейчас» = движок', async () => {
    const j = await (await post({ materialId: 53, width: 1300, height: 2500, hasTempering: true, hasFacet: true, facetTypeMm: 10, quantities: [1, 3] })).json()
    expect(j.warnings).toEqual([])
    for (const id of ['current', 'aLine', 'aGroup', 'ladderB', 'minC']) {
      for (const r of j.models[id].rows) {
        const labels = r.breakdown.map((l: { label: string }) => l.label)
        expect(labels[0]).toMatch(/^Стекло по прайсу: 6\s200 ₽\/м² × 3,25 м²|^Стекло по прайсу: 6\s200 ₽\/м² × 9,75 м²/)
        expect(labels.filter((l: string) => /Крупногабарит|Широкая|Фацет 10 мм/.test(l))).toHaveLength(3)
        expect(r.breakdown.reduce((a: number, l: { amount: number }) => a + l.amount, 0)).toBe(r.lineTotal)
      }
    }
  })

  it('материалы: ширины фацета из справочника, без его цен', async () => {
    const { GET } = await import('@/app/api/glasmen-demo/materials/route')
    const text = await (await GET()).text()
    expect(JSON.parse(text).facetTypesMm).toEqual([10])
    expect(text).not.toMatch(/sale_price|transport_cost/)
  })

  it('справочники читаются раз в 60 с: корзина из 5 строк не перечитывает 5 таблиц на строку', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 120_000)                 // кэш прошлых тестов устарел
      const before = db.reads
      await Promise.all(Array.from({ length: 5 }, () => post({ materialId: 3, width: 600, height: 800 })))
      const first = db.reads - before
      expect(first).toBeGreaterThan(0)
      expect(first).toBeLessThanOrEqual(6)                   // одна загрузка на все параллельные запросы
      await post({ materialId: 3, width: 600, height: 800 })
      expect(db.reads - before).toBe(first)                  // в пределах 60 с — из памяти
      vi.setSystemTime(Date.now() + 61_000)
      await post({ materialId: 3, width: 600, height: 800 })
      expect(db.reads - before).toBe(first * 2)              // устарело — читаем заново
      const saved = TABLES.facet_prices
      delete TABLES.facet_prices
      vi.setSystemTime(Date.now() + 61_000)
      expect((await post({ materialId: 3, width: 600, height: 800 })).status).toBe(500)
      TABLES.facet_prices = saved
      expect((await post({ materialId: 3, width: 600, height: 800 })).status).toBe(200)   // ошибка не закэширована
    } finally {
      vi.useRealTimers()
    }
  })

  it('параметры ползунков зажимаются, о чём сказано в warnings', async () => {
    const j = await (await post({ materialId: 3, width: 600, height: 800, models: ['aLine'], params: { aLine: { S: 1e9 } } })).json()
    expect(j.models.aLine.params.S).toBe(20000)
    expect(j.warnings.length).toBe(1)
    expect(Object.keys(j.models)).toEqual(['aLine'])
  })
})

describe('priceModel: итог раскрыт на суммы (стекло, надбавки, фацет)', () => {
  // Деталь 1300×2500 попадает в обе надбавки (широкая и крупногабарит), плюс фацет 10 мм.
  const facetPrices = [{ type_mm: 10, sale_price: 310, cost_price: 120, transport_cost: 15 }]
  const fref = { ...ref, facetPrices }
  const m = byId.get(4)!
  const base = { material: m, width: 1300, height: 2500, hasTempering: true, hasFacet: true, facetTypeMm: 10 }
  const qs = [1, 2, 5, 10, 25, 50]
  const lineValues: Record<number, number> = {}
  const lineComponents: Record<number, { label: string; amount: number }[]> = {}
  for (const q of qs) {
    const it = computeQuoteItem({ ...base, quantity: q, applyMinPrice: false }, fref)
    lineValues[q] = it.saleIncVat
    lineComponents[q] = itemComponents(it)
  }
  const fp = resolveMinLinePrice(m.category, 1300, 2500, true, rates.minLine)?.minPricePerPiece ?? 0
  const plain: PriceLadderInput = { v1: lineValues[1], floorPerPiece: fp, discountPct: 10, quantities: qs, lineValues }
  const rich: PriceLadderInput = { ...plain, lineComponents }

  it('itemComponents: стекло + 2 надбавки + фацет, сумма = saleIncVat движка до рубля', () => {
    for (const q of qs) {
      const c = lineComponents[q]
      expect(c.map(l => l.label.split(':')[0].split(' (')[0])).toEqual(['Стекло по прайсу', 'Крупногабарит 2400–2600', 'Широкая 1200–1400', 'Фацет 10 мм'])
      expect(c.reduce((a, l) => a + l.amount, 0)).toBe(lineValues[q])
    }
  })

  it('каждая модель: итог тот же, что без разбивки; строки складываются в итог ровно', () => {
    for (const id of PRICE_MODEL_IDS) {
      for (const whole of [false, true]) {
        const a = priceLadder({ ...plain, asWholeOrder: whole }, id)
        const b = priceLadder({ ...rich, asWholeOrder: whole }, id)
        b.forEach((r, i) => {
          expect(r.lineTotal, `${id} q=${r.qty}`).toBe(a[i].lineTotal)
          expect(sumOf(r), `${id} q=${r.qty}`).toBe(r.lineTotal)
          expect(r.breakdown.length).toBeGreaterThan(a[i].breakdown.length)
        })
      }
    }
  })

  it('«Сейчас»: строки разбивки — суммы движка как есть', () => {
    const r = priceLadder(rich, 'current')
    qs.forEach((q, i) => expect(r[i].breakdown.slice(0, 4)).toEqual(lineComponents[q]))
  })

  it('A и B: каждая строка × k, отклонение от k·сумма не больше рубля', () => {
    for (const id of ['aLine', 'aGroup', 'ladderB'] as PriceModelId[]) {
      const k = PRESETS[id].params.k
      priceLadder(rich, id).forEach((r, i) => {
        const comps = lineComponents[qs[i]]
        comps.forEach((c, j) => {
          expect(r.breakdown[j].label).toBe(`${c.label} × ${String(k).replace('.', ',')}`)
          expect(Math.abs(r.breakdown[j].amount - k * c.amount)).toBeLessThanOrEqual(1)
        })
      })
    }
  })

  it('разбивка, не сходящаяся с v(q), не используется — строка «По прайсу» одной суммой', () => {
    const broken = { ...rich, lineComponents: { ...lineComponents, 1: [{ label: 'Стекло', amount: 1 }] } }
    const r = priceLadder(broken, 'current')[0]
    expect(r.breakdown[0]).toEqual({ label: 'По прайсу: ₽/м² × площадь × шт. + надбавки', amount: lineValues[1] })
  })
})

describe('allocate — метод наибольшего остатка', () => {
  it('сумма ровно target, доли ≈ пропорции, ничья — первым', () => {
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333])
    expect(allocate(10, [1, 1, 1, 1])).toEqual([3, 3, 2, 2])
    expect(allocate(0, [5, 7])).toEqual([0, 0])
    expect(allocate(7, [0, 0])).toEqual([7, 0])
    const w = [12345, 678, 9012, 3]
    const out = allocate(Math.round(0.9781 * 22038), w)
    expect(out.reduce((a, x) => a + x, 0)).toBe(Math.round(0.9781 * 22038))
    out.forEach((x, i) => expect(Math.abs(x - (Math.round(0.9781 * 22038) * w[i]) / 22038)).toBeLessThan(1))
  })
})
