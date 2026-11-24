import { describe, it, expect } from 'vitest'
import { itemStages } from '@/lib/partner/itemStages'
import type { BoardTask } from '@/lib/production/ordersBoard'

const t = (item_index: number, stage_key: string, seq: number, done: boolean, by: string | null = null, extra: Partial<BoardTask> = {}): BoardTask =>
  ({ item_index, stage_key, sequence_order: seq, status: done ? 'done' : 'pending', completed_at: done ? '2026-11-20T09:00:00Z' : null, completed_by_name: by, ...extra })

describe('itemStages', () => {
  const lines = [{ index: 0, key: 'a', label: 'Стекло 8 мм', size: '548×1906', qty: 2 }, { index: 1, key: 'b', label: 'Стекло 8 мм', size: '700×1900', qty: 1 }]
  it('этапы по детали по порядку, с автором; проблема не показывается', () => {
    const v = itemStages(lines, [t(0, 'tempering', 3, false), t(0, 'cutting', 1, true, 'Иван'), t(0, 'problem', 9, false), t(1, 'cutting', 1, false)], () => 0)
    expect(v[0].stages.map(s => s.key)).toEqual(['cutting', 'tempering'])
    expect(v[0].stages[0]).toMatchObject({ label: 'Резка', done: true, by: 'Иван' })
    expect(v[0]).toMatchObject({ done: 1, total: 2 })
    expect(v[1]).toMatchObject({ done: 0, total: 1 })
  })
  it('автозакрытый этап — с пояснением', () => {
    const v = itemStages(lines, [t(0, 'packaging', 5, true, null, { auto_closed: true, auto_closed_by_name: 'Склад', auto_closed_from: 'shipping:line' })], () => 0)
    expect(v[0].stages[0]).toMatchObject({ by: 'Склад', note: 'закрыт отгрузкой изделия' })
  })
  it('уехало — не больше штук в строке', () => {
    const v = itemStages(lines, [], k => (k === 'a' ? 5 : 1))
    expect(v.map(i => i.shipped)).toEqual([2, 1])
    expect(v[0].total).toBe(0)
  })
})
