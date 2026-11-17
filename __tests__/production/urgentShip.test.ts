import { describe, expect, it } from 'vitest'
import { byDeadline, chosenToStore, urgentLinesOf, leftStages, moved, rankChanges, shipUrgentOf, urgentQueue, withAdded } from '@/lib/production/urgentShip'

describe('urgentShip', () => {
  it('читает место из notes строкой и объектом', () => {
    expect(shipUrgentOf('{"ship_urgent":{"rank":2}}')?.rank).toBe(2)
    expect(shipUrgentOf({ ship_urgent: null })).toBeNull()
    expect(shipUrgentOf('битый')).toBeNull()
  })

  it('очередь по месту, без места не входят', () => {
    const o = (id: number, urgent_rank: number | null) => ({ id, urgent_rank, overdue_days: 0, deadline_day: null, launch_day: '2026-11-01' })
    expect(urgentQueue([o(1, 2), o(2, null), o(3, 1)]).map(x => x.id)).toEqual([3, 1])
  })

  it('новые — самые просроченные первыми', () => {
    const list = [
      { id: 1, overdue_days: 3, deadline_day: '2026-11-14', launch_day: '2026-11-07' },
      { id: 2, overdue_days: 29, deadline_day: '2026-10-19', launch_day: '2026-10-12' },
      { id: 3, overdue_days: 3, deadline_day: '2026-11-14', launch_day: '2026-11-05' },
    ]
    expect(byDeadline(list).map(x => x.id)).toEqual([2, 3, 1])
  })

  it('добавление в конец без дублей, перестановка и изменённые места', () => {
    expect(withAdded([5, 7], [7, 9, 9])).toEqual([5, 7, 9])
    expect(moved([5, 7, 9], 9, -1)).toEqual([5, 9, 7])
    expect(moved([5, 7, 9], 5, -1)).toEqual([5, 7, 9])
    expect(rankChanges(new Map([[5, 1], [7, 2], [9, null]]), [5, 9, 7])).toEqual([{ id: 9, rank: 2 }, { id: 7, rank: 3 }])
  })

  it('что осталось по изделию', () => {
    const t = [
      { item_index: 0, stage_key: 'packaging', status: 'queued', sequence_order: 9 },
      { item_index: 0, stage_key: 'cutting', status: 'done', sequence_order: 1 },
      { item_index: 0, stage_key: 'tempering', status: 'queued', sequence_order: 6 },
      { item_index: 1, stage_key: 'cutting', status: 'done', sequence_order: 1 },
    ]
    expect(leftStages(t, 0)).toEqual(['Закалка', 'Упаковка'])
    expect(leftStages(t, 1)).toEqual([])
    expect(leftStages(t, 2)).toBeNull()
  })

  it('весь заказ — всё, что не уехало; отдельные изделия — только они', () => {
    const lines = [
      { key: 'a', qty: 3, shipped: 1, free: 2 },
      { key: 'b', qty: 1, shipped: 1, free: 0 },
      { key: 'c', qty: 2, shipped: 0, free: 2 },
    ]
    expect(urgentLinesOf(lines, null).map(x => [x.line.key, x.qty])).toEqual([['a', 2], ['c', 2]])
    expect(urgentLinesOf(lines, { c: 1, b: 1 }).map(x => [x.line.key, x.qty])).toEqual([['c', 1]])
    expect(chosenToStore(lines, new Map([['a', 2], ['c', 2]]))).toBeNull()
    expect(chosenToStore(lines, new Map([['a', 1], ['c', 2]]))).toEqual({ a: 1, c: 2 })
    expect(shipUrgentOf({ ship_urgent: { rank: 1, lines: { a: '2', x: 0 } } })?.lines).toEqual({ a: 2 })
  })
})
