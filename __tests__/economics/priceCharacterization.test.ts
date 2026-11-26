import { describe, it, expect } from 'vitest'
import { calcItem, calcTotals, effectiveItemTotal, orderMarginPct, type B2BOrderItem } from '@/lib/b2bCalculator'
import { computeQuoteItem } from '@/lib/b2b/computeQuote'
import { DEFAULT_B2B_RATES } from '@/lib/b2b/rates'
import { calcFactoryMirror, calcFactoryLoft, factoryQuoteToItem, type FactoryData } from '@/lib/b2bFactoryProducts'
import { contributionColor } from '@/lib/unitEconomics'
import type { B2BMaterial, B2BService } from '@/lib/types'

// Страховка маршрута экономики: цены, скидки и маржа порогов зафиксированы ДО его изменений.
// Эти снимки не обновляют «чтобы прошло»: расхождение означает, что изменилась цена клиенту
// или цифра согласования, а маршрут обещает их не трогать. Все справочники вымышленные.

const mat = (over: Partial<B2BMaterial> & { id: number }) => ({
  name: 'Стекло тест', category: 'стекло', thickness: 6, cost_price: 1000, sale_price: 2400,
  vat_rate: 22, waste_percent: 20, sheet_width: 3210, sheet_height: 2250, ...over,
}) as unknown as B2BMaterial

const CLEAR = mat({ id: 1 })
const TINTED = mat({ id: 2, category: 'тонированное', cost_price: 1500, sale_price: 3300 })
const MIRROR = mat({ id: 3, category: 'зеркало', thickness: 4, cost_price: 900, sale_price: 2100, waste_percent: 18 })
const FACET = [{ type_mm: 15, cost_price: 200, transport_cost: 20, sale_price: 450 }]
const SERVICES = [
  { id: 10, name: 'Макет', type: 'fixed', value: 500, cost_price: 300 },
  { id: 11, name: 'Пескоструй', type: 'per_m2', value: 1800, cost_price: 600 },
  { id: 12, name: 'Крупногабарит', type: 'percent', value: 20, cost_price: 0 },
] as unknown as B2BService[]

const SIZES: [number, number, number][] = [[200, 600, 1], [500, 800, 3], [900, 2100, 2], [1155, 2772, 3], [1800, 2400, 1]]

const money = (i: Omit<B2BOrderItem, 'localId'>) => ({
  billed: i.totalAreaBilled, sale: i.saleIncVat, saleExVat: i.saleExVat, cost: i.costWithVat, costExVat: i.costExVat,
  margin: i.margin, wholeSheets: i.wholeSheets ?? null, min: i.minPriceReason ?? null,
})

describe('calcItem: цена и сохранённая себестоимость', () => {
  it.each([
    ['прозрачное', CLEAR], ['тонированное', TINTED], ['зеркало', MIRROR],
  ])('%s — размеры × закалка', (_n, m) => {
    const rows = SIZES.flatMap(([w, h, q]) => [false, true].map(t => ({ w, h, q, t, ...money(calcItem(m, w, h, q, m.waste_percent!, t)) })))
    expect(rows).toMatchSnapshot()
  })

  it('услуги, фацет, мин. цена и её отключение', () => {
    expect([
      money(calcItem(CLEAR, 600, 900, 2, 20, true, SERVICES, true, 15, FACET)),
      money(calcItem(CLEAR, 150, 200, 4, 20, true, SERVICES)),
      money(calcItem(CLEAR, 150, 200, 4, 20, true, SERVICES, false, null, [], false, 2, null, [], false)),
    ]).toMatchSnapshot()
  })

  it('триплекс из двух и трёх стёкол', () => {
    const price = { salePerM2: 2500, costPerM2: 900 }
    expect([2, 3].map(n => money(calcItem(CLEAR, 800, 1900, 2, 20, true, [], false, null, [], true, n, price,
      n === 3 ? [TINTED, MIRROR] : [TINTED])))).toMatchSnapshot()
  })

  it('computeQuoteItem: надбавки, отверстия, вырезы', () => {
    const item = computeQuoteItem({
      material: CLEAR, width: 700, height: 2700, quantity: 2, hasTempering: true, hasHoles: true, holes: [{ d: 12, n: 4 }],
      cutoutGroups: [{ kind: 'inner', cat: 2, n: 1 }],
    }, {
      facetPrices: [], rates: DEFAULT_B2B_RATES,
      surchargeRules: [{ id: 1, axis: 'length', min_mm: 2600, max_mm: 2900, surcharge_percent: 20, label: 'Крупногабарит', shape_filter: null, active: true, sort_order: 1 }],
      holePrices: [{ id: 1, d_max: 20, t_max: 8, sale: 150, cost: 40 }],
      cutoutPrices: [{ id: 20, code: 'cutout_inner_2', name: 'Вырез внутренний II кат.', type: 'fixed', value: 700, cost_price: 350 } as unknown as B2BService],
    })
    expect({ ...money(item), services: item.services.map(s => [s.name, s.cost, s.costPrice]) }).toMatchSnapshot()
  })
})

describe('скидки, ручной итог и маржа согласования', () => {
  const items = [calcItem(CLEAR, 600, 900, 2, 20, true), calcItem(TINTED, 900, 2100, 1, 20, true, SERVICES)]
    .map((c, i) => ({ ...c, localId: String(i) }))

  it('итоги при скидках 0, 7 и 15 %, с договорной ценой и клиентским прайсом', () => {
    const variants = [items, [{ ...items[0], manualTotal: 5000 }, items[1]], [{ ...items[0], clientPriced: true }, items[1]]]
    expect(variants.map(v => [0, 7, 15].map(d => ({
      totals: calcTotals(v, d), margin: orderMarginPct(v, d), lines: v.map(i => effectiveItemTotal(i, d)),
    })))).toMatchSnapshot()
  })

  it('пороги цвета маржи 25 / 35 %', () => {
    expect([24.9, 25, 34.9, 35].map(contributionColor)).toEqual(['red', 'amber', 'amber', 'green'])
  })
})

describe('изделия производства: цена цеха и состав', () => {
  const cfg = {
    productionTaxPercent: 12, productionMarginPercent: 40, factoryOverheadPercent: 10,
    scrapReservePercent: 5, packagingCostPerM2: 120, transferUpliftPercent: 10,
  }
  const component = (id: number, component_type: string, name: string, cost_price: number, over: object = {}) =>
    ({ id, component_type, name, short_name: null, voltage: 12, color_temp: 4500, power_per_meter: 10, max_power: 100, cost_price, unit: 'пог.м', ...over })
  const material = (id: number, name: string, cost_price: number) =>
    ({ id, name, short_name: null, category: 'расходники', unit: 'шт', cost_price, sale_price: 0, active: true })
  const data = {
    retailMaterials: [material(1, 'Расходники подсветки', 500), material(2, 'Комплектующие зеркала', 200),
      material(3, 'Сборка зеркала с подсветкой', 3000), material(4, 'Сборка зеркала', 1000)],
    retailServices: [], finSettings: null, sandblastRates: [], cfgSource: { mirror: 'config', loft: 'config' },
    components: [component(1, 'frame', 'Профиль алюминиевый', 300), component(2, 'led_strip', 'LED лента', 200),
      component(3, 'power_supply', 'Блок питания', 400), component(4, 'diffuser', 'Рассеиватель', 100)],
    matrix: [{ name: 'Серебро', price_type: 'cost', category: 'mirror', waste_pct: 10, t4: 1000, t5: null, t6: null, t8: null, t10: null }],
    mirrorCfg: cfg, loftCfg: cfg, mirrorNames: ['Серебро'],
    loftGlasses: [{ id: 5, name: 'Стекло тест 8 мм', cost_price: 1800 }],
    loftRates: new Proxy({}, { get: () => 100 }), frameRates: {}, decorFrames: [], frameSupplierRows: [], minuteRates: null,
  } as unknown as FactoryData

  it('зеркало с подсветкой и в металлической раме', () => {
    const base = { widthMm: 700, heightMm: 900, mirrorName: 'Серебро', mirrorMm: 4, hasLighting: true, buttonType: 'none' as const }
    const quotes = [calcFactoryMirror(base, data), calcFactoryMirror({ ...base, metalFrame: true }, data)]
    expect(quotes.every(Boolean)).toBe(true)
    expect(quotes.map(q => ({ cost: q!.factoryCostPiece, price: q!.prodPricePiece, transfer: q!.transferPricePiece, lines: q!.costLines }))).toMatchSnapshot()
    expect(money(factoryQuoteToItem(quotes[0]!, 3))).toMatchSnapshot()
  })

  it('лофт', () => {
    const q = calcFactoryLoft({ widthMm: 1200, heightMm: 2400, construction: 'fixed', doors: 0, fixedParts: 1, rows: 2, handle: 'none' as never, softClose: false, glassId: 5, tempering: false }, data)
    expect(q).not.toBeNull()
    expect({ cost: q!.factoryCostPiece, price: q!.prodPricePiece, lines: q!.costLines }).toMatchSnapshot()
  })
})
