import { describe, it, expect } from 'vitest'
import { summarizeWorker, type WorkerMark } from '@/lib/production/workerActivity'

const mark = (completed_at: string, stage_key: string, order_id: number, auto_closed: boolean | null = false): WorkerMark =>
  ({ completed_at, stage_key, order_id, auto_closed })

describe('отметки одного работника', () => {
  it('нет отметок — нули и пустые дни, а не падение', () => {
    expect(summarizeWorker([])).toEqual({ marks: 0, autoMarks: 0, orders: 0, stages: [], days: [] })
  })

  it('каскад с именем не идёт в выработку, но считается отдельно', () => {
    const s = summarizeWorker([mark('2026-10-12T08:00:00Z', 'cutting', 1), mark('2026-10-12T08:01:00Z', 'polishing', 1, true)])
    expect(s.marks).toBe(1)
    expect(s.autoMarks).toBe(1)
    expect(s.stages).toEqual([{ key: 'cutting', n: 1 }])
    expect(s.days[0].total).toBe(1)
  })

  it('день считается по Москве', () => {
    const s = summarizeWorker([mark('2026-10-11T22:30:00Z', 'cutting', 1)])
    expect(s.days[0].day).toBe('2026-10-12')
  })

  it('дни — сверху новые; окно времени внутри дня', () => {
    const s = summarizeWorker([
      mark('2026-10-10T07:00:00Z', 'cutting', 1),
      mark('2026-10-12T12:00:00Z', 'cutting', 2),
      mark('2026-10-12T07:00:00Z', 'cutting', 3),
    ])
    expect(s.days.map(d => d.day)).toEqual(['2026-10-12', '2026-10-10'])
    expect(s.days[0].firstAt).toBe('2026-10-12T07:00:00.000Z')
    expect(s.days[0].lastAt).toBe('2026-10-12T12:00:00.000Z')
  })

  it('внутри дня заказ с этапами: больше отметок — выше, и сумма сходится', () => {
    const s = summarizeWorker([
      mark('2026-10-12T07:00:00Z', 'cutting', 5),
      mark('2026-10-12T07:01:00Z', 'cutting', 9),
      mark('2026-10-12T07:02:00Z', 'polishing', 9),
      mark('2026-10-12T07:03:00Z', 'polishing', 9),
    ])
    expect(s.orders).toBe(2)
    expect(s.days[0].orders.map(o => o.orderId)).toEqual([9, 5])
    expect(s.days[0].orders[0].stages).toEqual([{ key: 'polishing', n: 2 }, { key: 'cutting', n: 1 }])
    expect(s.days[0].orders.reduce((n, o) => n + o.total, 0)).toBe(s.marks)
    expect(s.stages.reduce((n, x) => n + x.n, 0)).toBe(s.marks)
  })
})
