import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  pointsFirst, pointRank, pointPrepayRefusal, pointLaunchGate, IN_WORK_STATUSES, orderTotal,
} from '@/lib/b2b/points'
import { launchPatch } from '@/lib/b2b/orderNotes'

// Решение владельца 01.10.2026: заказы точек на стройрынке цех делает первыми,
// в работу они уходят только после 100 % оплаты.

describe('pointsFirst — точки вперёд, остальной порядок не ломается', () => {
  // Экран уже выстроил очередь по срочности: a, b, c, d, e. Точки — b и d.
  const queue = ['a', 'b', 'c', 'd', 'e']
  const isPoint = (x: string) => x === 'b' || x === 'd'

  it('точки встают первыми в том порядке, в каком были', () => {
    expect(pointsFirst(queue, isPoint)).toEqual(['b', 'd', 'a', 'c', 'e'])
  })

  it('без точек и из одних точек — порядок ровно прежний', () => {
    expect(pointsFirst(queue, () => false)).toEqual(queue)
    expect(pointsFirst(queue, () => true)).toEqual(queue)
    expect(pointsFirst([], isPoint)).toEqual([])
  })

  it('исходный массив не меняется', () => {
    const copy = [...queue]
    pointsFirst(queue, isPoint)
    expect(queue).toEqual(copy)
  })

  it('составная сортировка: точка поднимается только внутри своего статуса', () => {
    // Обзор цеха: сначала незакрытые, внутри — точки, потом по сроку.
    const rows = [
      { id: 1, done: false, point: false, days: 0 },
      { id: 2, done: true, point: true, days: -5 },
      { id: 3, done: false, point: true, days: 4 },
      { id: 4, done: false, point: false, days: -1 },
    ]
    const sorted = [...rows].sort((a, b) =>
      (a.done ? 1 : 0) - (b.done ? 1 : 0) || pointRank(a.point) - pointRank(b.point) || a.days - b.days)
    expect(sorted.map(r => r.id)).toEqual([3, 4, 1, 2])
  })
})

describe('pointPrepayRefusal — в работу только после 100 % оплаты', () => {
  it('«Оплачен» — можно', () => {
    expect(pointPrepayRefusal({ payment_status: 'paid' })).toBeNull()
    expect(pointPrepayRefusal(JSON.stringify({ status: 'quote', payment_status: 'paid' }))).toBeNull()
  })

  it('оплата не отмечена — отказ с причиной и тем, что сделать', () => {
    for (const notes of [{}, { payment_status: 'unpaid' }, null, '', 'не json']) {
      const msg = pointPrepayRefusal(notes)
      expect(msg).toContain('только после 100 % оплаты')
      expect(msg).toContain('Оплата по заказу не отмечена')
      expect(msg).toContain('отметьте «Оплачен»')
    }
  })

  it('предоплата — не полная оплата: отказ называет внесённую сумму и итог', () => {
    const msg = pointPrepayRefusal({ payment_status: 'partial', prepayment_amount: 1500 }, 4200)
    expect(msg).toContain('Отмечена предоплата')
    expect(msg).toMatch(/1\s500 ₽ из 4\s200 ₽/)
  })

  it('итог заказа — со скидкой, без неё — сумма продажи', () => {
    expect(orderTotal({ total_after_discount: 900, total_sale_inc_vat: 1000 })).toBe(900)
    expect(orderTotal({ total_after_discount: null, total_sale_inc_vat: 1000 })).toBe(1000)
    expect(orderTotal({})).toBe(0)
  })

  it('статус запуска из «Запустить в работу» — среди статусов «в работе», калитка его ловит', () => {
    const st = launchPatch({}, { at: '2026-10-01T10:00:00Z', workDate: '2026-10-01' }).status as string
    expect(IN_WORK_STATUSES).toContain(st)
  })
})

// Поддельный сервис-клиент: признак точки у клиента или ошибка чтения.
function svcWith(row: { is_point: boolean } | null, error: { message: string } | null = null) {
  const calls: string[] = []
  const svc = {
    from: (table: string) => {
      calls.push(table)
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) }) }
    },
  } as unknown as SupabaseClient
  return { svc, calls }
}

describe('pointLaunchGate — серверная калитка запуска', () => {
  it('не точка — без оплаты пускает, как раньше', async () => {
    const { svc } = svcWith({ is_point: false })
    expect(await pointLaunchGate(svc, { client_id: 7, notes: {} })).toEqual({ ok: true })
  })

  it('точка без оплаты — 409 с понятной фразой', async () => {
    const { svc } = svcWith({ is_point: true })
    const g = await pointLaunchGate(svc, { client_id: 7, notes: { payment_status: 'partial', prepayment_amount: 100 }, total: 500 })
    expect(g.ok).toBe(false)
    if (!g.ok) {
      expect(g.status).toBe(409)
      expect(g.error).toContain('100 % оплаты')
    }
  })

  it('точка с полной оплатой — пускает', async () => {
    const { svc } = svcWith({ is_point: true })
    expect(await pointLaunchGate(svc, { client_id: 7, notes: { payment_status: 'paid' } })).toEqual({ ok: true })
  })

  it('признак не прочитался — не пускаем (а не считаем «не точкой»)', async () => {
    const { svc } = svcWith(null, { message: 'timeout' })
    const g = await pointLaunchGate(svc, { client_id: 7, notes: {} })
    expect(g.ok).toBe(false)
    if (!g.ok) expect(g.status).toBe(500)
  })

  it('заказ без клиента — проверять нечего, база не дёргается', async () => {
    const { svc, calls } = svcWith({ is_point: true })
    expect(await pointLaunchGate(svc, { client_id: null, notes: {} })).toEqual({ ok: true })
    expect(calls).toEqual([])
  })
})
