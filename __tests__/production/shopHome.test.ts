import { describe, it, expect } from 'vitest'
import { shopHome, type ShopTask, type ShopOrder } from '@/lib/production/shopHome'

const NOW = Date.parse('2026-09-15T09:00:00Z') // 12:00 МСК
const order = (id: number, n: Record<string, unknown> = {}, o: Partial<ShopOrder> = {}): ShopOrder => ({
  id, client_name: `Клиент ${id}`, custom_number: null, notes: JSON.stringify(n),
  launched_at: '2026-09-01T09:00:00Z', created_at: '2026-09-01T09:00:00Z', ...o,
})
const task = (order_id: number, status: string, t: Partial<ShopTask> = {}): ShopTask => ({
  order_id, station: 'cutting', stage_key: 'cutting', status, assigned_to: null,
  started_by_name: null, completed_at: null, completed_by_name: null, ...t,
})
const run = (tasks: ShopTask[], orders: ShopOrder[], me = { id: 'u1', stations: ['cutting'] as string[] | null }) =>
  shopHome({ tasks, orders, purchaseRequestsOpen: 3, me, now: NOW })

describe('главная цеха', () => {
  it('мои задачи — по станциям работника или назначенные ему', () => {
    const h = run([
      task(1, 'queued'), task(1, 'in_progress'), task(1, 'problem'),
      task(1, 'queued', { station: 'packaging' }),
      task(1, 'queued', { station: 'packaging', assigned_to: 'u1' }),
      task(1, 'done'),
    ], [order(1, { deadline_date: '2026-09-20' })])
    expect(h.my).toMatchObject({ scope: 'mine', open: 4, inProgress: 1, problems: 1 })
  })

  it('без станций — весь цех', () => {
    const h = run([task(1, 'queued'), task(1, 'queued', { station: 'packaging' })], [order(1)], { id: 'owner', stations: null })
    expect(h.my).toMatchObject({ scope: 'shop', open: 2 })
  })

  it('в работе — есть открытые задачи и нет отметки отгрузки; срочные — срок до конца дня или флажок', () => {
    const h = run(
      [task(1, 'queued'), task(2, 'queued'), task(3, 'queued'), task(4, 'queued'), task(5, 'done')],
      [
        order(1, { deadline_date: '2026-09-10' }),
        order(2, { deadline_date: '2026-09-15' }),
        order(3, { deadline_date: '2026-09-25', urgent: true }),
        order(4, { deadline_date: '2026-09-10', stages: { shipped: '2026-09-12' } }),
        order(5, { deadline_date: '2026-09-10' }),
      ],
    )
    expect(h.inWork.count).toBe(3)
    expect(h.urgent).toMatchObject({ overdue: 1, today: 1, flagged: 1 })
    expect(h.urgent.rows.map(r => r.id)).toEqual([1, 2, 3])
    expect(h.urgent.rows[0].note).toBe('просрочен на 5 дн.')
  })

  it('материал — пометка «нет материала» на заказ или позиции', () => {
    const h = run([task(1, 'queued')], [
      order(1, { material_status: 'needed' }),
      order(2, { material_needed_items: [0, 2] }),
      order(3, { material_status: 'ready' }),
    ])
    expect(h.material).toMatchObject({ orders: 2, requestsOpen: 3 })
    expect(h.material.rows.map(r => r.note)).toEqual(['нет материала на заказ', 'нет материала на 2 поз.'])
  })

  it('отгрузка — упакован или все этапы закрыты, не отгружен; отгружено сегодня по отметке', () => {
    const h = run([task(1, 'queued'), task(2, 'done'), task(3, 'done')], [
      order(1, { stages: { packaged: '2026-09-12' } }),
      order(2),
      order(3, { stages: { shipped: '2026-09-15T08:00:00Z' } }),
      order(4, { stages: { shipped: '2026-09-14' } }),
    ])
    expect(h.shipping.ready).toBe(2)
    expect(h.shipping.shippedToday).toBe(1)
    expect(h.shipping.rows[0]).toMatchObject({ id: 1, note: 'упакован 3 дн. назад' })
  })

  it('люди — закрыто сегодня по Москве и в работе сейчас', () => {
    const h = run([
      task(1, 'done', { completed_at: '2026-09-15T06:00:00Z', completed_by_name: 'Никита' }),
      task(1, 'done', { completed_at: '2026-09-14T22:30:00Z', completed_by_name: 'Никита' }), // 01:30 МСК 15.09
      task(1, 'done', { completed_at: '2026-09-14T20:00:00Z', completed_by_name: 'Бекмурза' }), // 23:00 МСК 14.09
      task(1, 'in_progress', { started_by_name: 'Бекмурза' }),
    ], [order(1)])
    expect(h.people).toEqual([
      { name: 'Никита', doneToday: 2, inProgress: 0 },
      { name: 'Бекмурза', doneToday: 0, inProgress: 1 },
    ])
  })

  it('не запущенные и шаблоны не попадают', () => {
    const h = run([task(1, 'queued'), task(2, 'queued')], [order(1, {}, { launched_at: null }), order(2, { is_template: true })])
    expect(h.inWork.count).toBe(0)
  })
})
