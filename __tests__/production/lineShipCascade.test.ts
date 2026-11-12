import { describe, expect, it } from 'vitest'
import { LINE_SHIPPED_FROM, pickLineTasks, shippedLineIndexes, type LineTask } from '@/lib/production/lineShipCascade'

const t = (id: number, item_index: number, stage_key: string, status: string, extra: Partial<LineTask> = {}): LineTask =>
  ({ id, item_index, stage_key, status, auto_closed: null, auto_closed_from: null, completed_by: null, ...extra })

describe('shippedLineIndexes', () => {
  const lines = [{ key: 'a', index: 0, qty: 1 }, { key: 'b', index: 1, qty: 4 }, { key: 'c', index: 2, qty: 1 }]
  it('позиция считается уехавшей, только когда уехали все её штуки', () => {
    const shipped = { a: 1, b: 2, c: 0 } as Record<string, number>
    expect([...shippedLineIndexes(lines, k => shipped[k] ?? 0)]).toEqual([0])
  })
})

describe('pickLineTasks', () => {
  // Заказ 5803 на 12.11: резка и полировка отмечены цехом, закалка и упаковка открыты, уехали позиции 0 и 1.
  const tasks = [
    t(1, 0, 'cutting', 'done', { completed_by: 'u-elzat' }), t(2, 0, 'tempering', 'queued'), t(3, 0, 'packaging', 'queued'),
    t(4, 1, 'tempering', 'in_progress'), t(5, 1, 'packaging', 'problem'),
    t(6, 2, 'tempering', 'queued'), t(7, 2, 'packaging', 'queued'),
  ]
  it('закрывает открытые этапы уехавших позиций и не трогает остальные', () => {
    const { close, reopen } = pickLineTasks(tasks, new Set([0, 1]), false)
    expect(close.map(x => x.id)).toEqual([2, 3, 4, 5])
    expect(reopen).toEqual([])
  })
  it('возвращает только закрытое этим каскадом у позиции, которую убрали из отгрузки', () => {
    const after = [
      t(1, 0, 'cutting', 'done', { completed_by: 'u-elzat' }),
      t(2, 0, 'tempering', 'done', { auto_closed: true, auto_closed_from: LINE_SHIPPED_FROM }),
      t(3, 0, 'packaging', 'done', { auto_closed: true, auto_closed_from: 'shipping:shipped' }),
      t(4, 1, 'tempering', 'done', { auto_closed: true, auto_closed_from: LINE_SHIPPED_FROM }),
      t(5, 1, 'packaging', 'done', { auto_closed: true, auto_closed_from: LINE_SHIPPED_FROM, completed_by: 'u-nikita' }),
    ]
    const { close, reopen } = pickLineTasks(after, new Set([1]), false)
    expect(close).toEqual([])
    expect(reopen.map(x => x.id)).toEqual([2])
  })
  it('у заказа с отметкой «Отгружен» ничего не возвращает', () => {
    const after = [t(2, 0, 'tempering', 'done', { auto_closed: true, auto_closed_from: LINE_SHIPPED_FROM })]
    expect(pickLineTasks(after, new Set(), true).reopen).toEqual([])
  })
})

describe('подпись этапа, закрытого отгрузкой', async () => {
  const { markLine } = await import('@/lib/production/ordersBoard')
  const base = { item_index: 0, stage_key: 'tempering', status: 'done', sequence_order: 3, completed_at: '2026-11-12T09:31:00Z', completed_by_name: null, auto_closed: true, auto_closed_by_name: 'Влад' }
  it('называет отгрузку изделия и того, кто отгрузил', () => {
    expect(markLine({ ...base, auto_closed_from: LINE_SHIPPED_FROM }, k => k)).toEqual({ by: 'Влад', note: 'закрыт отгрузкой изделия' })
  })
  it('отгрузку заказа не выдаёт за этап цеха', () => {
    expect(markLine({ ...base, auto_closed_from: 'shipping:shipped' }, k => k).note).toBe('закрыт отгрузкой заказа')
  })
})
