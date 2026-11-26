import { describe, it, expect } from 'vitest'
import { calcItem } from '@/lib/b2bCalculator'
import { factoryQuoteToItem, type FactoryQuote } from '@/lib/b2bFactoryProducts'
import { itemLines, itemParts, orderRef, sumLines, type StoredItem } from '@/lib/economics/facts/items'
import { bomOperation, serviceOperation, OPERATIONS } from '@/lib/economics/facts/operations'
import { controlSet } from '@/lib/economics/controlSet'
import type { B2BMaterial, B2BService } from '@/lib/types'

const mat = (over: object = {}) => ({
  id: 1, name: 'Стекло тест', category: 'стекло', thickness: 6, cost_price: 1111, sale_price: 2400,
  waste_percent: 17, sheet_width: 3210, sheet_height: 2250, ...over,
}) as unknown as B2BMaterial
const SERVICES = [
  { id: 1, name: 'Разработка макета в электронном виде (вектор)', type: 'fixed', value: 500, cost_price: 333 },
  { id: 2, name: 'Пескоструй по трафарету (рисунок/частичное)', type: 'per_m2', value: 1800, cost_price: 607 },
  { id: 3, name: 'Приклейка плёнки', type: 'per_m2', value: 900, cost_price: 251 },
  { id: 4, name: 'Крупногабарит', type: 'percent', value: 20, cost_price: 0 },
] as unknown as B2BService[]
const FACET = [{ type_mm: 15, cost_price: 203, transport_cost: 21, sale_price: 450 }]

const asItem = (x: object) => x as StoredItem
const of = (lines: ReturnType<typeof itemLines>, op: string) => lines.filter(l => l.op === op)

const quote: FactoryQuote = {
  label: 'Зеркало с подсветкой', spec: '', widthMm: 700, heightMm: 900, thicknessMm: 4, perimeterM: 3.2,
  areaPiece: 0.63, weightPerPiece: 6.3, factoryCostPiece: 7001, prodPricePiece: 14000, transferPricePiece: 7700,
  marginPercent: 40,
  costLines: [
    { name: 'Серебро 4 мм', qty: 0.693, unit: 'м²', total: 693 },
    { name: 'LUX 2835 120LED 9,6 Вт/м', qty: 3.2, unit: 'пог.м', total: 640 },
    { name: 'Комплектующие зеркала', qty: 1, unit: 'шт', total: 200 },
    { name: 'Расходники подсветки', qty: 1, unit: 'шт', total: 500 },
    { name: 'Сборка зеркала с подсветкой', qty: 1, unit: 'шт', total: 3000 },
    { name: 'Покраска порошковая (RAL)', qty: 1, unit: '₽', total: 1000 },
    { name: 'Накладные производства 10%', qty: 10, unit: '%', total: 603 },
    { name: 'Резерв брака 5%', qty: 5, unit: '%', total: 365 },
  ],
}

describe('тождество: сумма строк = сохранённой себестоимости позиции', () => {
  const sizes: [number, number, number][] = [[150, 200, 7], [600, 900, 2], [1155, 2772, 3], [999, 1777, 1]]
  const cases = sizes.flatMap(([w, h, q]) => [false, true].map(t => ({ w, h, q, t })))

  it.each(cases)('стекло $w×$h × $q, закалка $t, услуги и фацет', ({ w, h, q, t }) => {
    const it_ = asItem(calcItem(mat(), w, h, q, 17, t, SERVICES, true, 15, FACET))
    const lines = itemLines(1, 0, it_)
    expect(sumLines(lines)).toBe(it_.costWithVat)
    expect(of(lines, 'unclassified')).toEqual([])
  })

  it.each([2, 3])('триплекс из %i стёкол', n => {
    const it_ = asItem(calcItem(mat(), 800, 1900, 2, 17, true, [], false, null, [], true, n,
      { salePerM2: 2500, costPerM2: 913 }, n === 3 ? [mat({ id: 2, thickness: 4 }), mat({ id: 3 })] : [mat({ id: 2, thickness: 4 })]))
    const lines = itemLines(1, 0, it_)
    expect(sumLines(lines)).toBe(it_.costWithVat)
    expect(of(lines, 'triplex')).toHaveLength(1)
    const parts = itemParts(1, 0, it_)
    expect(parts.map(p => [p.partKey, p.materialId, p.thicknessMm])).toEqual(
      n === 3 ? [['1:0:1', 1, 6], ['1:0:2', 2, 4], ['1:0:3', 3, 6]] : [['1:0:1', 1, 6], ['1:0:2', 2, 4]])
    expect(of(lines, 'edge')[0].driver.qty).toBeCloseTo(it_.perimeterM as number * 2 * n, 2)
  })

  it.each([1, 3, 7])('изделие производства, %i шт: состав записан на всю позицию', q => {
    const it_ = asItem(factoryQuoteToItem(quote, q))
    const lines = itemLines(1, 0, it_)
    expect(sumLines(lines)).toBeCloseTo(it_.costWithVat as number, 2)
    expect(of(lines, 'assembly')[0].value.amountGross).toBe(3000 * q)
    expect(of(lines, 'unclassified')).toEqual([])
    expect(of(lines, 'rounding').every(l => Math.abs(l.value.amountGross!) <= 4.5 * q)).toBe(true)
  })
})

describe('чего нет в позиции — пусто, неизвестное не прячется', () => {
  it('диаметр и тип выреза не достраиваются; тип кромки и цвет — null', () => {
    const [p] = itemParts(5, 2, { materialId: 1, thickness: 6, width: 500, height: 600, quantity: 2, hasCutouts: true, cutouts: 3, holes: [{ d: 0, n: 4 }] })
    expect(p).toMatchObject({ partKey: '5:2:1', edgeType: null, color: null, drawingRef: null, shape: 'unknown',
      holes: [{ diameterMm: null, qty: 4 }], cutouts: [{ type: null, qty: 3 }] })
  })

  it('необъяснённая сумма — отдельной строкой, а не растворяется', () => {
    const lines = itemLines(1, 0, { category: 'стекло', quantity: 1, costMaterial: 100, costWithVat: 175 })
    expect(lines.map(l => [l.op, l.value.amountGross])).toEqual([['material', 100], ['unclassified', 75]])
  })

  it('незнакомая строка состава и услуги не угадывается', () => {
    expect(bomOperation('Нечто новое')).toBe('unclassified')
    expect(serviceOperation('Полимерное покрытие')).toBe('unclassified')
    expect(OPERATIONS.unclassified.nature).toBe('unknown')
  })

  it.each([
    ['Сборка зеркала с пескоструем', 'assembly'], ['Комплектующие зеркала', 'components'], ['Накладной алюминиевый профиль 16×7', 'components'],
    ['Накладные производства 10%', 'overhead_allowance'], ['Покраска порошковая (RAL)', 'frame_paint'], ['Резка / раскрой полос', 'frame_cutting'],
    ['Осветлённое 4 мм', 'material'], ['Подложка', 'underlay'], ['Сложная форма', 'complex_shape'], ['Расходники подсветки', 'components'],
  ])('состав «%s» → %s', (name, op) => { expect(bomOperation(name)).toBe(op) })

  it('сторонние — только подтверждённые владельцем операции', () => {
    expect(Object.entries(OPERATIONS).filter(([, v]) => v.nature === 'external').map(([k]) => k).sort())
      .toEqual(['facet', 'frame_cutting', 'frame_paint', 'tempering', 'triplex'])
  })

  it('строка факта: объём отдельно от оценки; без объёма ставки нет', () => {
    const lines = itemLines(1, 0, asItem(factoryQuoteToItem(quote, 2)))
    const paint = of(lines, 'frame_paint')[0]
    expect(paint.driver).toEqual({ unit: 'rub', qty: null })
    expect(paint.value).toMatchObject({ scheme: 'stored', rate: null, amountGross: 2000 })
    expect(lines.every(l => !('price' in l) && !('sale' in l))).toBe(true)
  })
})

describe('канал и контрольный набор', () => {
  it('своя розница — внутренний B2C, остальные — B2B, и оба помечены как вывод', () => {
    expect(orderRef({ id: 1, client_name: 'M GLASS' })).toEqual({ orderId: 1, channel: 'b2c', channelSource: 'derived', isInternal: true })
    expect(orderRef({ id: 2, client_name: 'ООО Пример' })).toMatchObject({ channel: 'b2b', channelSource: 'derived', isInternal: false })
    expect(orderRef({ id: 3, client_name: '' })).toMatchObject({ channel: 'unknown', channelSource: 'missing' })
    expect(orderRef({ id: 4, client_name: 'ООО Пример' }, 'd2c')).toMatchObject({ channel: 'd2c', channelSource: 'explicit' })
  })

  it('только запущенные неархивные 01–26.11', () => {
    const row = (id: number, launched_at: string | null, archived_at: string | null = null) => ({ id, launched_at, archived_at })
    expect(controlSet([row(1, '2026-10-31'), row(2, '2026-11-01'), row(3, '2026-11-26'), row(4, '2026-11-27'), row(5, null), row(6, '2026-11-10', 'x')]).map(o => o.id))
      .toEqual([2, 3])
  })
})
