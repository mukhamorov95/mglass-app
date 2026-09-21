import { describe, it, expect } from 'vitest'
import {
  supplyState, writeFor, frontier, buildPurchaseGroups, summarizeNeeds, withThickness,
  supplierOrderItems, splitForSupplierOrder, resolveMaterial,
  type PurchaseMaterial, type SheetVariant, type SupplyState,
} from '@/lib/purchasing/supply'
import { runCuttingOptimizer, DEFAULT_CUTTING_SETTINGS } from '@/lib/cuttingOptimizer'

describe('три состояния поверх существующего статуса материала', () => {
  it('пусто, «не проверен», «нужно купить», «нет (цех)» — это «не заказан»', () => {
    for (const s of [null, undefined, '', 'not_checked', 'need_to_buy', 'needed']) expect(supplyState(s)).toBe('not_ordered')
  })
  it('заказан / счёт / оплачен / в пути — «заказан»; принят / есть (цех) — «есть»', () => {
    for (const s of ['ordered', 'invoice_received', 'paid', 'shipped']) expect(supplyState(s)).toBe('ordered')
    for (const s of ['received', 'ready']) expect(supplyState(s)).toBe('in_stock')
  })
})

describe('что пишется в заказ', () => {
  const today = '2026-09-18'
  it('«заказан» ставит флаг раскроя сегодняшней датой, а уже стоящую не трогает', () => {
    expect(writeFor('ordered', {}, today)).toEqual({ materialStatus: 'ordered', stages: { material_ordered: today } })
    expect(writeFor('ordered', { materialOrdered: '2026-09-10' }, today).stages.material_ordered).toBe('2026-09-10')
  })
  it('«заказан» не откатывает «оплачен» обратно в «заказан»', () => {
    expect(writeFor('ordered', { materialStatus: 'paid' }, today).materialStatus).toBe('paid')
  })
  it('«есть» — ready и флаг раскроя', () => {
    expect(writeFor('in_stock', {}, today)).toEqual({ materialStatus: 'ready', stages: { material_ordered: today } })
  })
  it('«не заказан» снимает флаг — иначе заказ выпал бы из расчёта навсегда', () => {
    expect(writeFor('not_ordered', { materialStatus: 'ordered', materialOrdered: '2026-09-10' }, today))
      .toEqual({ materialStatus: 'need_to_buy', stages: { material_ordered: null } })
  })
  it('сообщение цеха «нет материала» при снятии отметки не стирается', () => {
    expect(writeFor('not_ordered', { materialStatus: 'needed' }, today).materialStatus).toBe('needed')
  })
})

describe('граница заказанного', () => {
  const q = (states: SupplyState[]) => states.map((state, i) => ({ id: i + 1, state }))
  it('последний заказ с материалом — граница, всё после без отметки — к заказу', () => {
    expect(frontier(q(['in_stock', 'ordered', 'ordered', 'not_ordered', 'not_ordered'])))
      .toEqual({ lastId: 3, gaps: [], after: [4, 5] })
  })
  it('пропуск до границы виден отдельно — его легко потерять', () => {
    expect(frontier(q(['ordered', 'not_ordered', 'ordered', 'not_ordered'])))
      .toEqual({ lastId: 3, gaps: [2], after: [4] })
  })
  it('ничего не заказано — границы нет, к заказу всё', () => {
    expect(frontier(q(['not_ordered', 'not_ordered']))).toEqual({ lastId: null, gaps: [], after: [1, 2] })
  })
})

const MATS: PurchaseMaterial[] = [
  { id: 1, name: 'Осветлённое CrystalVision', thickness: '8.0', cost_price: '2400', sheet_width: 3210, sheet_height: 2250, pattern_direction: 'none' },
  { id: 2, name: 'Серебро', thickness: 4, cost_price: 1200, sheet_width: 3210, sheet_height: 2250, pattern_direction: 'none' },
]
const VARS: SheetVariant[] = [
  { material_id: 2, sheet_width: 3210, sheet_height: 2250, active: true },
  { material_id: 2, sheet_width: 2550, sheet_height: 1605, active: true },
  { material_id: 2, sheet_width: 1000, sheet_height: 1000, active: false },
]

describe('позиции заказов → детали под раскрой', () => {
  it('материал ищется по названию и толщине без учёта регистра, количество раскладывается в детали', () => {
    const { groups } = buildPurchaseGroups([
      { id: 10, client: 'А', items: [{ materialName: 'осветлённое crystalvision', thickness: 8, width: 1000, height: 2000, quantity: 2 }] },
    ], MATS, VARS)
    const g = groups.get('осветлённое crystalvision|8')!
    expect(g.pieces).toHaveLength(2)
    expect(g.materialLabel).toBe('Осветлённое CrystalVision 8 мм')
  })

  it('варианты формата листа идут в раскрой, выключенные — нет', () => {
    const { groups } = buildPurchaseGroups([{ id: 1, client: 'А', items: [{ materialName: 'Серебро', thickness: 4, width: 500, height: 500 }] }], MATS, VARS)
    expect(groups.get('серебро|4')!.sheetFormats).toEqual([{ width: 3210, height: 2250 }, { width: 2550, height: 1605 }])
  })

  it('триплекс даёт деталь на каждый слой', () => {
    const { groups } = buildPurchaseGroups([{ id: 1, client: 'А', items: [
      { materialName: 'Серебро', thickness: 4, width: 600, height: 600, hasTriplex: true, triplexLayers: 2 },
    ] }], MATS, VARS)
    expect(groups.get('серебро|4')!.pieces).toHaveLength(2)
  })

  it('материал не из справочника не кроится на лист по умолчанию — он виден отдельно', () => {
    const { groups, unknown } = buildPurchaseGroups([
      { id: 7, client: 'Б', items: [{ materialName: 'Зеркало с подсветкой Осветлённое 4 мм', thickness: 4, width: 1000, height: 2000 }] },
    ], MATS, VARS)
    expect(groups.size).toBe(0)
    expect(unknown).toEqual([{ material: 'Зеркало с подсветкой Осветлённое 4 мм', thickness: 4, pieces: 1, m2: 2, orders: [7] }])
  })
})

describe('что заказать: итог раскрывается и сходится', () => {
  const orders = [
    { id: 1, client: 'А', items: [{ materialName: 'Осветлённое CrystalVision', thickness: 8, width: 1000, height: 2000, quantity: 3 }] },
    { id: 2, client: 'Б', items: [{ materialName: 'Осветлённое CrystalVision', thickness: 8, width: 800, height: 1900 }] },
  ]
  const { groups, materialByKey } = buildPurchaseGroups(orders, MATS, VARS)
  const rows = summarizeNeeds(runCuttingOptimizer(groups, DEFAULT_CUTTING_SETTINGS), materialByKey)

  it('м² нетто = сумма площадей позиций', () => {
    expect(rows[0].netM2).toBe(3 * 2 + 0.8 * 1.9)
  })
  it('стоимость — за целые листы: листы × площадь листа × цена за м²', () => {
    const r = rows[0]
    expect(r.cost).toBe(Math.round(r.sheets * (r.sheetWidth * r.sheetHeight / 1e6) * 2400))
    expect(r.sheetsM2).toBeGreaterThanOrEqual(r.netM2)
  })
  it('видно, под какие заказы этот материал', () => {
    expect(rows[0].orders).toEqual([1, 2])
    expect(rows[0].pieces).toBe(4)
  })
})

describe('итог «что заказать» сходится с площадью позиций', () => {
  it('второй слой триплекса считается отдельно и закрывает разницу', () => {
    const orders = [
      { id: 1, client: 'А', items: [{ materialName: 'Серебро', thickness: 4, width: 1000, height: 1000, hasTriplex: true, triplexLayers: 2 }] },
      { id: 2, client: 'Б', items: [{ materialName: 'Нечто', thickness: 5, width: 500, height: 1000 }] },
    ]
    const { groups, unknown, materialByKey, extraLayerM2 } = buildPurchaseGroups(orders, MATS, VARS)
    const rows = summarizeNeeds(runCuttingOptimizer(groups, DEFAULT_CUTTING_SETTINGS), materialByKey)
    const itemsM2 = 1 + 0.5
    const inRows = rows.reduce((s, r) => s + r.netM2, 0) + unknown.reduce((s, u) => s + u.m2, 0)
    expect(extraLayerM2).toBe(1)
    expect(inRows).toBeCloseTo(itemsM2 + extraLayerM2, 6)
  })
})

describe('подпись материала', () => {
  it('толщина дописывается, если её нет в названии', () => {
    expect(withThickness('Серебро', 4)).toBe('Серебро 4 мм')
    expect(withThickness('Осветлённое CrystalVision', '8.0')).toBe('Осветлённое CrystalVision 8 мм')
  })
  it('у изделия толщина уже в названии — второй раз не пишется', () => {
    expect(withThickness('Зеркало с подсветкой Осветлённое 4 мм', 4)).toBe('Зеркало с подсветкой Осветлённое 4 мм')
    expect(withThickness('Триплекс 4,4мм', 4.4)).toBe('Триплекс 4,4мм')
  })
  it('«14 мм» в названии не спутать с толщиной 4', () => {
    expect(withThickness('Стекло 14 мм', 4)).toBe('Стекло 14 мм 4 мм')
  })
})


describe('заказ поставщику', () => {
  it('«пришёл» по заказу поставщику — «принят», а не цеховое «есть»', () => {
    expect(writeFor('in_stock', { materialStatus: 'ordered', materialOrdered: '2026-09-18' }, '2026-09-20', { fromPurchase: true }))
      .toEqual({ materialStatus: 'received', stages: { material_ordered: '2026-09-18' } })
  })

  it('уже заказанное и нарезанное повторно не заказывается — иначе два счёта', () => {
    const { take, skipped } = splitForSupplierOrder([
      { id: 1, state: 'not_ordered' as const, cut: false },
      { id: 2, state: 'ordered' as const, cut: false },
      { id: 3, state: 'in_stock' as const, cut: false },
      { id: 4, state: 'not_ordered' as const, cut: true },
    ])
    expect(take.map(o => o.id)).toEqual([1])
    expect(skipped).toEqual([
      { id: 2, reason: 'уже заказан' }, { id: 3, reason: 'материал есть' }, { id: 4, reason: 'уже нарезан' },
    ])
  })

  it('позиции — в формате канбана закупок: чистое название, толщина числом, листы, формат, номера заказов', () => {
    const orders = [{ id: 5, client: 'А', items: [{ materialName: 'Серебро', thickness: 4, width: 1000, height: 1000 }, { materialName: 'Нечто', thickness: 5, width: 500, height: 1000 }] }]
    const { groups, unknown, materialByKey } = buildPurchaseGroups(orders, MATS, VARS)
    const rows = summarizeNeeds(runCuttingOptimizer(groups, DEFAULT_CUTTING_SETTINGS), materialByKey)
    const items = supplierOrderItems(rows, unknown, id => `0${id}-1`)
    expect(items[0]).toMatchObject({
      material_name: 'Серебро', thickness: 4, sheets_count: rows[0].sheets,
      sheet_width: rows[0].sheetWidth, sheet_height: rows[0].sheetHeight,
      area_m2: 1, estimated_cost: rows[0].cost, order_ids: [5], order_refs: ['05-1'], unmatched: false,
    })
    // Не распознанное не теряется — идёт строкой с пометкой
    expect(items[1]).toMatchObject({ material_name: 'Нечто 5 мм', thickness: 5, area_m2: 0.5, sheets_count: null, unmatched: true })
  })
})

describe('стекло изделия распознаётся по названию', () => {
  const CAT: PurchaseMaterial[] = [
    { id: 49, name: 'Осветлённое', thickness: 4, category: 'зеркало', cost_price: 1180, sheet_width: 3210, sheet_height: 2250, pattern_direction: 'none' },
    { id: 51, name: 'Осветлённое CrystalVision', thickness: 4, category: 'стекло', cost_price: 950, sheet_width: 3210, sheet_height: 2250, pattern_direction: 'none' },
    { id: 60, name: 'Серебро', thickness: 4, category: 'зеркало', cost_price: 730, sheet_width: 3210, sheet_height: 2250, pattern_direction: 'none' },
  ]

  it('у зеркала ищем среди зеркал: «Осветлённое», а не «Осветлённое CrystalVision»', () => {
    expect(resolveMaterial('Зеркало с подсветкой Осветлённое 4 мм', 4, CAT)?.id).toBe(49)
  })

  it('неосветлённое зеркало — серебро', () => {
    expect(resolveMaterial('Зеркало с подсветкой Серебро 4 мм', 4, CAT)?.id).toBe(60)
  })

  it('буква «ё» и регистр не мешают', () => {
    expect(resolveMaterial('зеркало осветленное 4мм с подсветкой', 4, CAT)?.id).toBe(49)
  })

  it('толщина должна совпадать — 6 мм из 4-миллиметрового справочника не берём', () => {
    expect(resolveMaterial('Зеркало с подсветкой Осветлённое 6 мм', 6, CAT)).toBeNull()
  })

  it('изделие попадает в раскрой к своему материалу, и это видно отдельной строкой', () => {
    const { groups, unknown, resolved } = buildPurchaseGroups([
      { id: 9, client: 'M GLASS', items: [{ materialName: 'Зеркало с подсветкой Осветлённое 4 мм', thickness: 4, width: 1000, height: 2000, quantity: 2, category: 'изделие' }] },
    ], CAT, [])
    expect(unknown).toHaveLength(0)
    expect(groups.get('осветлённое|4')!.pieces).toHaveLength(2)
    expect(resolved).toEqual([{ from: 'Зеркало с подсветкой Осветлённое 4 мм', to: 'Осветлённое', thickness: 4, pieces: 2, m2: 4, orders: [9] }])
  })
})
