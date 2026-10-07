import { describe, it, expect, vi, beforeEach } from 'vitest'

const sent = vi.hoisted(() => [] as { orderId: number; text: string; link?: string }[])
vi.mock('@/lib/b2b/notifyManager', () => ({
  notifyOrderManager: async (orderId: number, text: string, link?: string) => { sent.push({ orderId, text, link }); return true },
}))

import { mirrorOrderStages, isMissingFunction } from '@/lib/productionOrderMirror'

type RpcAnswer = { data: unknown; error: { code?: string; message?: string } | null }

// Поддельная база: задачи заказа, сам заказ и ответы RPC по имени функции.
function fakeSvc(opts: { tasks: { stage_key: string; status: string }[]; stages?: Record<string, unknown>; rpc: Record<string, RpcAnswer> }) {
  const calls: string[] = []
  const chain = (data: unknown) => {
    const b: Record<string, unknown> = {}
    Object.assign(b, {
      select: () => b, eq: () => b,
      single: async () => ({ data, error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res),
    })
    return b
  }
  return {
    calls,
    svc: {
      from: (t: string) => t === 'production_tasks'
        ? chain(opts.tasks)
        : chain({ notes: JSON.stringify({ stages: opts.stages ?? {} }), custom_number: '05555', client_name: 'Клиент' }),
      rpc: async (fn: string) => { calls.push(fn); return opts.rpc[fn] ?? { data: null, error: { message: 'no such rpc' } } },
    },
  }
}

const packDone = [{ stage_key: 'cutting', status: 'done' }, { stage_key: 'packaging', status: 'done' }]

beforeEach(() => { sent.length = 0 })

describe('менеджеру — «упакован» ровно один раз на переход', () => {
  it('флаг поставил этот вызов — одно сообщение со ссылкой на сделку', async () => {
    const f = fakeSvc({ tasks: packDone, rpc: { mark_order_stages_forward: { data: ['cut', 'packaged'], error: null } } })
    const flags = await mirrorOrderStages(f.svc as never, 5555)
    expect(flags).toEqual(['cut', 'packaged'])
    expect(sent).toHaveLength(1)
    expect(sent[0].text).toContain('05555')
    expect(sent[0].text).toContain('согласуйте отгрузку')
    expect(sent[0].link).toBe('/b2b-deal/5555')
  })

  it('параллельный вызов уже поставил флаг — сообщения нет', async () => {
    const f = fakeSvc({ tasks: packDone, rpc: { mark_order_stages_forward: { data: [], error: null } } })
    expect(await mirrorOrderStages(f.svc as never, 5555)).toEqual([])
    expect(sent).toHaveLength(0)
  })

  it('флаг уже стоял до вызова — ни записи, ни сообщения', async () => {
    const f = fakeSvc({ tasks: packDone, stages: { cut: '2026-10-01', packaged: '2026-10-01' }, rpc: {} })
    expect(await mirrorOrderStages(f.svc as never, 5555)).toEqual([])
    expect(f.calls).toEqual([])
    expect(sent).toHaveLength(0)
  })

  it('упаковка не закрыта — сообщения нет', async () => {
    const f = fakeSvc({
      tasks: [{ stage_key: 'cutting', status: 'done' }, { stage_key: 'packaging', status: 'queued' }],
      rpc: { mark_order_stages_forward: { data: ['cut'], error: null } },
    })
    expect(await mirrorOrderStages(f.svc as never, 5555)).toEqual(['cut'])
    expect(sent).toHaveLength(0)
  })

  it('миграция не применена — откат на mark_order_stages, как раньше', async () => {
    const f = fakeSvc({
      tasks: packDone,
      rpc: {
        mark_order_stages_forward: { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.mark_order_stages_forward' } },
        mark_order_stages: { data: {}, error: null },
      },
    })
    expect(await mirrorOrderStages(f.svc as never, 5555)).toEqual(['cut', 'packaged'])
    expect(f.calls).toEqual(['mark_order_stages_forward', 'mark_order_stages'])
    expect(sent).toHaveLength(1)
  })

  it('другая ошибка записи — флагов нет, сообщения нет', async () => {
    const f = fakeSvc({ tasks: packDone, rpc: { mark_order_stages_forward: { data: null, error: { code: '42501', message: 'forbidden' } } } })
    expect(await mirrorOrderStages(f.svc as never, 5555)).toEqual([])
    expect(sent).toHaveLength(0)
  })

  it('отсутствующая функция распознаётся по коду и тексту', () => {
    expect(isMissingFunction({ code: '42883' })).toBe(true)
    expect(isMissingFunction({ code: 'PGRST202' })).toBe(true)
    expect(isMissingFunction({ message: 'Could not find the function x in the schema cache' })).toBe(true)
    expect(isMissingFunction({ code: '42501', message: 'forbidden' })).toBe(false)
  })
})
