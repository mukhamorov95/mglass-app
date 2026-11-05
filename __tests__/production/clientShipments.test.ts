import { describe, it, expect } from 'vitest'
import { lineKeyOf, orderShipState, orderStage, overdueDays, packedLineCount, requestProblem, shareOf, shipLines, shipmentTotals, takenByLine } from '@/lib/production/clientShipments'

describe('отгрузка по изделиям: расчёт', () => {
  it('строка: название со словом стекло или зеркало, вес и сумма всей строки', () => {
    const [l] = shipLines({
      total_after_discount: 3000, total_sale_inc_vat: 3000, discount_percent: 0,
      items: [{ localId: 'a', materialName: 'Осветлённое', category: 'зеркало', thickness: 4, width: 600, height: 800, quantity: 2, totalWeight: 9.6, saleIncVat: 3000 }],
    })
    expect(l).toEqual({ key: 'a', index: 0, label: 'Зеркало осветлённое, 4 мм', size: '600×800', qty: 2, weight: 9.6, amount: 3000 })
  })

  it('суммы строк сходятся с итогом заказа, пустая договорная цена не становится нулём', () => {
    const lines = shipLines({
      total_after_discount: 900, total_sale_inc_vat: 1000, discount_percent: 10,
      items: [
        { localId: 'a', materialName: 'Прозрачное', category: 'стекло', quantity: 1, saleIncVat: 400, manualTotal: '' },
        { localId: 'b', materialName: 'Прозрачное', category: 'стекло', quantity: 1, saleIncVat: 600, manualTotal: null },
      ],
    })
    expect(lines.map(l => l.amount)).toEqual([360, 540])
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(900)
  })

  it('ключ строки без localId — её номер, количество всегда целое', () => {
    expect(lineKeyOf({ localId: null }, 3)).toBe('i3')
    expect(lineKeyOf({ localId: 'x' }, 3)).toBe('x')
    expect(shipLines({ items: [{ materialName: 'Серебро', category: 'зеркало' }] })[0].qty).toBe(1)
  })

  it('части суммы сходятся с целым при любом дроблении', () => {
    const parts = [shareOf(1000, 3, 0, 1), shareOf(1000, 3, 1, 1), shareOf(1000, 3, 2, 1)]
    expect(parts).toEqual([333.33, 333.34, 333.33])
    expect(Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100).toBe(1000)
    expect(shareOf(1000, 3, 0, 3)).toBe(1000)
  })

  it('занято: отгружено и в черновиках раздельно, своя отгрузка не считается', () => {
    const rows = [
      { shipment_id: 1, order_id: 7, line_key: 'a', qty: 2 },
      { shipment_id: 2, order_id: 7, line_key: 'a', qty: 1 },
      { shipment_id: 3, order_id: 7, line_key: 'a', qty: 1 },
    ]
    const status = (id: number) => ({ 1: 'shipped', 2: 'draft', 3: 'draft' } as Record<number, string>)[id]
    expect(takenByLine(rows, status).get('7:a')).toEqual({ shipped: 2, drafted: 2 })
    expect(takenByLine(rows, status, 3).get('7:a')).toEqual({ shipped: 2, drafted: 1 })
  })

  it('заказ: не отгружен, частично, полностью', () => {
    const lines = [{ key: 'a', qty: 2 }, { key: 'b', qty: 1 }]
    expect(orderShipState(lines, () => 0)).toBe('none')
    expect(orderShipState(lines, k => (k === 'a' ? 1 : 0))).toBe('partial')
    expect(orderShipState(lines, k => (k === 'a' ? 2 : 0))).toBe('partial')
    expect(orderShipState(lines, k => (k === 'a' ? 2 : 1))).toBe('full')
    expect(orderShipState([], () => 0)).toBe('none')
  })

  it('вкладка заказа: в работе, упакован, отгружен', () => {
    const line = (qty: number, shipped: number, packed: boolean) => ({ qty, shipped, packed })
    expect(orderStage([line(2, 0, false), line(1, 0, true)], 'none', false)).toBe('in_work')
    expect(orderStage([line(2, 0, true), line(1, 0, true)], 'none', false)).toBe('packed')
    expect(orderStage([line(2, 2, true), line(1, 1, true)], 'full', false)).toBe('shipped')
    expect(orderStage([line(2, 0, false)], 'none', true)).toBe('shipped')
    expect(orderStage([], 'none', false)).toBe('in_work')
  })

  it('частичная отгрузка: заказ остаётся в работе, пока остаток не упакован', () => {
    const lines = [{ qty: 2, shipped: 2, packed: false }, { qty: 3, shipped: 1, packed: false }]
    expect(orderStage(lines, 'partial', false)).toBe('in_work')
    expect(packedLineCount(lines)).toBe(1)
    const packedRest = [lines[0], { qty: 3, shipped: 1, packed: true }]
    expect(orderStage(packedRest, 'partial', false)).toBe('packed')
    expect(packedLineCount(packedRest)).toBe(2)
  })

  it('просрочка: день срока ещё не просрочка, уехавший заказ не просрочен, без срока нет просрочки', () => {
    expect(overdueDays('2026-11-05', '2026-11-05', 'in_work')).toBe(0)
    expect(overdueDays('2026-11-04', '2026-11-05', 'in_work')).toBe(1)
    expect(overdueDays('2026-10-26', '2026-11-05', 'packed')).toBe(10)
    expect(overdueDays('2026-10-26', '2026-11-05', 'shipped')).toBe(0)
    expect(overdueDays(null, '2026-11-05', 'in_work')).toBe(0)
  })

  it('больше, чем есть, взять нельзя', () => {
    const line = { qty: 5, label: 'Стекло, 8 мм' }
    const req = (qty: number) => ({ order_id: 1, line_key: 'a', qty })
    expect(requestProblem(req(2), line, { shipped: 2, drafted: 1 })).toBeNull()
    expect(requestProblem(req(3), line, { shipped: 2, drafted: 1 })).toBe('Стекло, 8 мм: можно взять 2 из 5 шт.')
    expect(requestProblem(req(1), line, undefined, 5)).toBe('Стекло, 8 мм: можно взять 0 из 5 шт.')
    expect(requestProblem(req(0), line, undefined)).toContain('больше нуля')
    expect(requestProblem(req(1.5), line, undefined)).toContain('целым')
    expect(requestProblem(req(1), undefined, undefined)).toContain('строка не найдена')
  })

  it('итог отгрузки считает заказы, штуки, вес и сумму', () => {
    expect(shipmentTotals([
      { order_id: 1, qty: 2, weight: 10.5, amount: 100 },
      { order_id: 1, qty: 1, weight: 4.25, amount: 50.5 },
      { order_id: 2, qty: 3, weight: 1, amount: 0 },
    ])).toEqual({ orders: 2, pieces: 6, weight: 15.75, amount: 150.5 })
  })
})
