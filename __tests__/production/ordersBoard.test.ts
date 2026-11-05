import { describe, expect, it } from 'vitest'
import { boardOverdue, boardSort, boardStage, doneBy, idleDays, inBoardTab, lastMarkOf, markLine, stageCounts, type BoardTask } from '@/lib/production/ordersBoard'

const task = (o: Partial<BoardTask>): BoardTask => ({ item_index: 0, stage_key: 'cutting', status: 'queued', sequence_order: 1, completed_at: null, completed_by_name: null, ...o })
const done = (at: string, o: Partial<BoardTask> = {}) => task({ status: 'done', completed_at: at, completed_by_name: 'Никита', ...o })
const label = (k: string) => ({ packaging: 'Упаковка', polishing: 'Полировка' }[k] ?? k)

describe('срез на дату', () => {
  it('день считается по Москве: 22:00 UTC 15.10 это уже 16.10', () => {
    const t = done('2026-10-15T22:00:00Z')
    expect(doneBy(t, '2026-10-15')).toBe(false)
    expect(doneBy(t, '2026-10-16')).toBe(true)
  })

  it('этап, закрытый позже среза, на срезе открыт: заказ был в работе', () => {
    const tasks = [done('2026-10-10T10:00:00Z'), done('2026-10-20T10:00:00Z', { stage_key: 'packaging', sequence_order: 2 })]
    expect(boardStage(tasks, '2026-10-15', false)).toBe('in_work')
    expect(boardStage(tasks, '2026-10-25', false)).toBe('packed')
  })

  it('последняя отметка берётся только до среза, автор автозакрытия подставляется', () => {
    const tasks = [
      done('2026-10-10T10:00:00Z', { completed_by_name: 'Никита' }),
      done('2026-10-20T10:00:00Z', { completed_by_name: null, auto_closed: true, auto_closed_by_name: 'Эльзат' }),
    ]
    expect(lastMarkOf(tasks, '2026-10-15')).toEqual({ at: '2026-10-10T10:00:00Z', by: 'Никита' })
    expect(lastMarkOf(tasks, '2026-10-25')).toEqual({ at: '2026-10-20T10:00:00Z', by: 'Эльзат' })
  })
})

describe('вкладка заказа', () => {
  it('отметка об отгрузке важнее открытых задач', () => {
    expect(boardStage([task({})], '2026-11-05', true)).toBe('shipped')
  })
  it('заказ без задач остаётся в работе: упаковывать ещё нечего', () => {
    expect(boardStage([], '2026-11-05', false)).toBe('in_work')
  })
  it('позиция без этапа упаковки не держит заказ в работе', () => {
    expect(boardStage([done('2026-10-10T10:00:00Z')], '2026-11-05', false)).toBe('packed')
  })
  it('просрочка только у заказа в работе, день срока ещё не просрочка', () => {
    expect(boardOverdue('2026-11-01', '2026-11-05', 'in_work')).toBe(4)
    expect(boardOverdue('2026-11-05', '2026-11-05', 'in_work')).toBe(0)
    expect(boardOverdue('2026-07-01', '2026-11-05', 'packed')).toBe(0)
    expect(boardOverdue('2026-07-01', '2026-11-05', 'shipped')).toBe(0)
  })
})

describe('фильтр вкладок и период', () => {
  const base = { stage: 'shipped' as const, overdue_days: 0, ship_day: '2026-10-10', launch_day: '2026-10-01' }
  const period = { from: '2026-10-05', to: '2026-10-15' }
  it('отгружены: только отгрузка в периоде; без даты в периоде нет, без периода есть', () => {
    expect(inBoardTab(base, 'shipped', period)).toBe(true)
    expect(inBoardTab({ ...base, ship_day: '2026-10-20' }, 'shipped', period)).toBe(false)
    expect(inBoardTab({ ...base, ship_day: null }, 'shipped', period)).toBe(false)
    expect(inBoardTab({ ...base, ship_day: null }, 'shipped', null)).toBe(true)
  })
  it('история: запуск в периоде; без периода все', () => {
    expect(inBoardTab(base, 'history', period)).toBe(false)
    expect(inBoardTab({ ...base, launch_day: '2026-10-07' }, 'history', period)).toBe(true)
    expect(inBoardTab(base, 'history', null)).toBe(true)
  })
  it('просроченные лежат поверх: заказ виден и в работе', () => {
    const o = { ...base, stage: 'in_work' as const, overdue_days: 3 }
    expect(inBoardTab(o, 'overdue', null)).toBe(true)
    expect(inBoardTab(o, 'in_work', null)).toBe(true)
    expect(inBoardTab(o, 'packed', null)).toBe(false)
  })
})

describe('порядок в работе', () => {
  const o = (id: number, x: Partial<{ urgent: boolean; overdue_days: number; deadline_day: string | null }>) => ({ id, urgent: false, overdue_days: 0, deadline_day: '2026-11-20', launch_day: '2026-11-01', ship_day: null, ...x })
  const ids = (list: { id: number }[]) => list.map(x => x.id)

  it('просроченный выше срочного без просрочки, затем срочные, точки, ближайший срок', () => {
    const list = [o(1, { deadline_day: '2026-11-10' }), o(2, { urgent: true }), o(3, { overdue_days: 2 }), o(4, { overdue_days: 9 }), o(5, {})]
    expect(ids(boardSort(list, 'in_work', x => x.id === 5))).toEqual([4, 3, 2, 5, 1])
  })
  it('внутри просроченных срочный и точка идут первыми', () => {
    const list = [o(1, { overdue_days: 9 }), o(2, { overdue_days: 1, urgent: true }), o(3, { overdue_days: 1 })]
    expect(ids(boardSort(list, 'overdue', x => x.id === 3))).toEqual([2, 3, 1])
  })
  it('отгруженные: свежие сверху, без даты в конце', () => {
    const list = [{ ...o(1, {}), ship_day: '2026-10-01' }, { ...o(2, {}), ship_day: null }, { ...o(3, {}), ship_day: '2026-11-01' }]
    expect(ids(boardSort(list, 'shipped', () => false))).toEqual([3, 1, 2])
  })
})

describe('кто поставил этап', () => {
  it('отметил сам', () => {
    expect(markLine(done('2026-10-16T10:00:00Z'), label)).toEqual({ by: 'Никита', note: null })
  })
  it('автозакрытие называет причину и того, кто нажал', () => {
    expect(markLine(done('x', { completed_by_name: null, auto_closed: true, auto_closed_by_name: 'Эльзат', auto_closed_from: 'packaging' }), label)).toEqual({ by: 'Эльзат', note: 'закрыт вместе с этапом «Упаковка»' })
    expect(markLine(done('x', { completed_by_name: null, auto_closed: true, auto_closed_by_name: 'Администратор', auto_closed_from: 'manager:shipped' }), label)).toEqual({ by: 'Администратор', note: 'закрыт отметкой «Отгружен»' })
  })
  it('автора нет: пусто, не выдумываем', () => {
    expect(markLine(done('x', { completed_by_name: null }), label).by).toBeNull()
  })
})

describe('движение заказа', () => {
  it('этапы в порядке маршрута, счёт по позициям на дату среза', () => {
    const tasks = [
      done('2026-10-10T10:00:00Z', { stage_key: 'cutting', sequence_order: 1 }),
      task({ stage_key: 'cutting', sequence_order: 1, item_index: 1 }),
      task({ stage_key: 'packaging', sequence_order: 9 }),
      done('2026-10-20T10:00:00Z', { stage_key: 'polishing', sequence_order: 5 }),
    ]
    expect(stageCounts(tasks, '2026-10-15')).toEqual([
      { key: 'cutting', done: 1, total: 2 }, { key: 'polishing', done: 0, total: 1 }, { key: 'packaging', done: 0, total: 1 },
    ])
  })
  it('дней без отметок: от последней отметки, иначе от запуска', () => {
    expect(idleDays({ at: '2026-11-01T10:00:00Z' }, '2026-10-01', '2026-11-05')).toBe(4)
    expect(idleDays(null, '2026-10-30', '2026-11-05')).toBe(6)
    expect(idleDays(null, null, '2026-11-05')).toBeNull()
  })
})
