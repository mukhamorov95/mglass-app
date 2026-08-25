import { describe, it, expect } from 'vitest'
import { buildStartPatch, pickAutoRelease, pickStartable, RELEASE_TASK_PATCH, type StartCandidate } from '@/lib/production/start'

const NOW = '2026-08-26T09:00:00.000Z'
const actor = { id: 'u-1', name: 'Никита' }

const task = (over: Partial<StartCandidate> = {}): StartCandidate => ({
  id: 1, order_id: 100, status: 'queued', blocked_by_task_id: null,
  started_at: null, assigned_to: null, started_via: null, ...over,
})

describe('pickStartable — стартуем только то, что реально можно взять', () => {
  it('берёт задачу в очереди без блокера', () => {
    expect(pickStartable([task()], new Set()).map(t => t.id)).toEqual([1])
  })

  it('не берёт задачу, у которой предыдущий этап не закрыт', () => {
    expect(pickStartable([task({ blocked_by_task_id: 9 })], new Set())).toEqual([])
  })

  it('берёт задачу, у которой блокер закрыт', () => {
    expect(pickStartable([task({ blocked_by_task_id: 9 })], new Set([9])).map(t => t.id)).toEqual([1])
  })

  it('повторное раскрытие карточки ничего не сдвигает: уже начатое пропускаем', () => {
    expect(pickStartable([task({ status: 'in_progress' })], new Set())).toEqual([])
  })

  it('закрытые и проблемные не стартуем', () => {
    expect(pickStartable([task({ status: 'done' }), task({ id: 2, status: 'problem' })], new Set())).toEqual([])
  })
})

describe('buildStartPatch', () => {
  it('автостарт помечен как слабый сигнал — чтобы П4 не считала просмотр работой', () => {
    const p = buildStartPatch(actor, task(), NOW, 'open')
    expect(p.status).toBe('in_progress')
    expect(p.started_via).toBe('open')
    expect(p.started_at).toBe(NOW)
    expect(p.assigned_to).toBe('u-1')
  })

  it('явное «Взял» помечено как сильный сигнал', () => {
    expect(buildStartPatch(actor, task(), NOW, 'button').started_via).toBe('button')
  })

  it('не перетирает чужое назначение и уже начатое время', () => {
    const p = buildStartPatch(actor, task({ assigned_to: 'u-2', started_at: '2026-08-26T07:00:00.000Z' }), NOW, 'open')
    expect(p.assigned_to).toBe('u-2')
    expect(p.started_at).toBe('2026-08-26T07:00:00.000Z')
  })
})

describe('pickAutoRelease — рабочий делает один заказ за раз', () => {
  const inProgress = (over: Partial<StartCandidate>) => task({ status: 'in_progress', started_via: 'open', ...over })

  it('снимает автостарт по другим заказам', () => {
    const mine = [inProgress({ id: 1, order_id: 100 }), inProgress({ id: 2, order_id: 200 })]
    expect(pickAutoRelease(mine, 200)).toEqual([1])
  })

  it('не трогает заказ, который рабочий открыл сейчас', () => {
    expect(pickAutoRelease([inProgress({ id: 1, order_id: 200 })], 200)).toEqual([])
  })

  it('НИКОГДА не снимает явное «Взял» — это осознанное решение рабочего', () => {
    const mine = [inProgress({ id: 1, order_id: 100, started_via: 'button' })]
    expect(pickAutoRelease(mine, 200)).toEqual([])
  })

  it('без открытого заказа снимает весь брошенный автостарт', () => {
    const mine = [inProgress({ id: 1, order_id: 100 }), inProgress({ id: 2, order_id: 200 })]
    expect(pickAutoRelease(mine, null)).toEqual([1, 2])
  })

  it('возврат в очередь стирает время начала — брошенная задача не принесёт часов, которых не было', () => {
    expect(RELEASE_TASK_PATCH.started_at).toBeNull()
    expect(RELEASE_TASK_PATCH.started_via).toBeNull()
    expect(RELEASE_TASK_PATCH.status).toBe('queued')
  })
})
