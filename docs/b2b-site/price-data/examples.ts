// Цена за штуку для типовых деталей: текущий движок (computeQuoteItem → calcItem)
// и три модели-кандидата. Только чтение: входы — строки справочников, снятые SELECT'ом 14.10.2026
// (b2b_materials, glass_price_matrix, b2b_rates, b2b_surcharge_rules, facet_prices).
// Запуск: <main>/node_modules/.bin/tsx examples.ts
import { computeQuoteItem, computeQuoteTotals } from '@/lib/b2b/computeQuote'
import { prepPricedMaterials } from '@/lib/b2bMaterialPricing'
import { ratesFromRows } from '@/lib/b2b/rates'
import { resolveMinLinePrice } from '@/lib/b2bCalculator'
import type { B2BMaterial } from '@/lib/types'
import type { B2BOrderItem } from '@/lib/b2bCalculator'
import type { SurchargeRule } from '@/lib/surcharges'

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
  { name: 'Прозрачное М1', category: 'glass', price_type: 'cost', t4: 380, t5: 475, t6: 570, t8: 798, t10: 1026, waste_pct: 30 },
  { name: 'Осветлённое CrystalVision', category: 'glass', price_type: 'sale', t4: 3300, t6: 4300, t8: 6200, t10: 7500, waste_pct: 0 },
  { name: 'Осветлённое CrystalVision', category: 'glass', price_type: 'cost', t4: 900, t6: 1422, t8: 2016, t10: 2547, waste_pct: 30 },
  { name: 'Серебро', category: 'mirror', price_type: 'sale', t4: 1950, t6: 3250, waste_pct: 0 },
  { name: 'Серебро', category: 'mirror', price_type: 'cost', t4: 820, t5: 1115, t6: 1230, waste_pct: 18 },
  { name: 'Сатинированное бесцветное', category: 'glass', price_type: 'sale', t4: 2300, t5: 2900, t6: 3300, t8: 4400, t10: 5800, waste_pct: 0 },
  { name: 'Сатинированное бесцветное', category: 'glass', price_type: 'cost', t4: 690, t5: 888, t6: 1073, t8: 1480, t10: 1776, waste_pct: 30 },
])
const byId = new Map(mats.map(m => [m.id, m]))

const { rates, missing } = ratesFromRows([
  ['tempering_4', 300], ['tempering_5', 350], ['tempering_6', 400], ['tempering_8', 500], ['tempering_10', 600], ['tempering_12', 950],
  ['edge_per_m', 40], ['transport_per_piece', 77], ['packaging_per_m2', 120],
  ['min_glass_tempering', 2500], ['min_tinted_tempering', 3000], ['min_mirror', 1500], ['min_narrow_detail', 1500],
  ['margin_target', 35], ['margin_min', 25],
].map(([key, value]) => ({ key: key as string, value: value as number })))
if (missing.length) throw new Error('missing rates: ' + missing.join(', '))

const surchargeRules: SurchargeRule[] = [
  { id: 1, axis: 'length', min_mm: 2400, max_mm: 2600, surcharge_percent: 10, label: 'Крупногабарит 2400–2600', shape_filter: null },
  { id: 2, axis: 'length', min_mm: 2600, max_mm: 2900, surcharge_percent: 20, label: 'Крупногабарит 2600–2900', shape_filter: null },
  { id: 3, axis: 'length', min_mm: 2900, max_mm: 3200, surcharge_percent: 35, label: 'Крупногабарит 2900–3200', shape_filter: null },
  { id: 4, axis: 'width', min_mm: 1200, max_mm: 1400, surcharge_percent: 10, label: 'Широкая 1200–1400', shape_filter: null },
  { id: 5, axis: 'width', min_mm: 1400, max_mm: 1600, surcharge_percent: 20, label: 'Широкая 1400–1600', shape_filter: null },
  { id: 6, axis: 'width', min_mm: 1600, max_mm: 2000, surcharge_percent: 30, label: 'Широкая 1600–2000', shape_filter: null },
  { id: 7, axis: 'width', min_mm: 2000, max_mm: null, surcharge_percent: 45, label: 'Широкая >2000', shape_filter: null },
  { id: 8, axis: 'shape', min_mm: 1000, max_mm: 1500, surcharge_percent: 30, label: 'Сложная форма 1000–1500', shape_filter: 'curved' },
  { id: 9, axis: 'shape', min_mm: 1500, max_mm: null, surcharge_percent: 60, label: 'Сложная форма >1500', shape_filter: 'curved' },
]
const ref = {
  facetPrices: [
    { type_mm: 10, cost_price: 220, transport_cost: 20, sale_price: 500 },
    { type_mm: 15, cost_price: 250, transport_cost: 20, sale_price: 550 },
    { type_mm: 20, cost_price: 310, transport_cost: 20, sale_price: 650 },
  ],
  surchargeRules,
  rates,
}

const DISC = 10 // скидка партнёра: 10 % у большинства клиентов (b2b_clients.discount_percent)

type Part = { label: string; matId: number; w: number; h: number; temp: boolean; holes?: { d: number; n: number }[] }
const parts: Part[] = [
  { label: 'Зеркало Серебро 4 мм 300×300, без закалки', matId: 60, w: 300, h: 300, temp: false },
  { label: 'Стекло М1 6 мм 600×800, закалка, кромка', matId: 3, w: 600, h: 800, temp: true },
  { label: 'Стекло М1 8 мм 1000×500, закалка, 4 отверстия', matId: 4, w: 1000, h: 500, temp: true, holes: [{ d: 12, n: 4 }] },
  { label: 'Полка М1 6 мм 800×250, закалка', matId: 3, w: 800, h: 250, temp: true },
  { label: 'Сатин 4 мм 291×913, закалка (серия ГлассДекор)', matId: 21, w: 291, h: 913, temp: true },
  { label: 'CrystalVision 8 мм 900×2000, закалка (типовая дверь душевой)', matId: 53, w: 900, h: 2000, temp: true, holes: [{ d: 12, n: 4 }] },
]
const QTYS = [1, 5, 10, 50]

// Параметры моделей — откалиброваны на заказах 01.07–14.10.2026 (sql_10_model_A.sql, sql_20_model_B.sql)
const A_LINE = { S: 1000, k: 0.9001 }
const A_GROUP = { S: 1000, k: 0.9781 }   // одна деталь в заказе → группа = строка
const B = { M: 3000, k: 1.0315 }
const C = { M: 5000 }
const ladder = (q: number) => q >= 50 ? 0.25 : q >= 25 ? 0.20 : q >= 10 ? 0.15 : q >= 5 ? 0.10 : q >= 2 ? 0.05 : 0

const after = (x: number) => Math.round(x * (1 - DISC / 100))
const rows: string[] = ['деталь;шт;площадь_шт_м2;прайс_руб_м2;сейчас_строка;сейчас_за_шт;пол_сработал;A_line_за_шт;A_group_за_шт;B_за_шт;B_за_шт_если_весь_заказ;C_за_шт_если_весь_заказ']
for (const p of parts) {
  const m = byId.get(p.matId)!
  for (const q of QTYS) {
    const input = { material: m, width: p.w, height: p.h, quantity: q, hasTempering: p.temp, hasHoles: !!p.holes, holes: p.holes ?? [] }
    const cur = computeQuoteItem(input, ref) as B2BOrderItem
    const raw = computeQuoteItem({ ...input, applyMinPrice: false }, ref) as B2BOrderItem   // v: прайс без пола
    const curTotal = computeQuoteTotals([cur], DISC).totalAfterDiscount
    const v = raw.saleIncVat
    const fp = resolveMinLinePrice(m.category, p.w, p.h, p.temp, rates.minLine)?.minPricePerPiece ?? 0
    const aLine = after(A_LINE.k * v) + after(A_LINE.S)
    const aGroup = after(A_GROUP.k * v) + after(A_GROUP.S)
    const bLine = after(Math.max(fp, B.k * v * (1 - ladder(q))))
    const bOrder = Math.max(B.M, bLine)
    const cOrder = Math.max(C.M, curTotal)
    rows.push([p.label, q, cur.areaPiece, cur.pricePerM2, curTotal, Math.round(curTotal / q), cur.minPriceApplied ? 'да' : 'нет',
      Math.round(aLine / q), Math.round(aGroup / q), Math.round(bLine / q), Math.round(bOrder / q), Math.round(cOrder / q)].join(';'))
  }
}
// Проверка «закалка в цене»: одна и та же деталь с закалкой и без — цена прайса одинакова, разница только в поле.
const chk = (temp: boolean) => (computeQuoteItem({ material: byId.get(3)!, width: 600, height: 800, quantity: 1, hasTempering: temp, applyMinPrice: false }, ref) as B2BOrderItem).saleIncVat
const chkH = (holes: boolean) => (computeQuoteItem({ material: byId.get(4)!, width: 1000, height: 500, quantity: 1, hasTempering: true, hasHoles: holes, holes: holes ? [{ d: 12, n: 4 }] : [], hasCutouts: holes, cutouts: holes ? 2 : 0, applyMinPrice: false }, ref) as B2BOrderItem).saleIncVat
console.log(rows.join('\n'))
console.log(`\nПРОВЕРКА: 600×800 М1 6 мм без пола — без закалки ${chk(false)} ₽, с закалкой ${chk(true)} ₽`)
console.log(`ПРОВЕРКА (без пола): 1000×500 М1 8 мм закалка — без отверстий ${chkH(false)} ₽, 4 отверстия + 2 выреза ${chkH(true)} ₽`)
const q1 = computeQuoteItem({ material: byId.get(21)!, width: 291, height: 913, quantity: 30, hasTempering: true }, ref) as B2BOrderItem
console.log(`ПРОВЕРКА: сатин 4 мм 291×913 ×30 с закалкой — строка ${q1.saleIncVat} ₽ (пол ${q1.minPriceApplied ? 'сработал' : 'нет'}, по прайсу ${q1.originalLinePrice ?? q1.saleIncVat} ₽)`)
