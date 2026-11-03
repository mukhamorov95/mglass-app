// «Кто что делал» по одному работнику (владелец 03.11.2026): отметки за период — по этапам,
// дням и заказам. В счёт идёт только то, что человек отметил сам: каскад закрывает прошлые
// этапы без него, и приписать их ему значило бы исказить выработку. Редкие строки, где
// каскад сохранил имя, идут отдельным числом: production_crew_status считает их во «всего».

import { mskDayKey } from '@/lib/time'

export type WorkerMark = { completed_at: string; stage_key: string; order_id: number; auto_closed: boolean | null }
export type StageCount = { key: string; n: number }
export type WorkerOrder = { orderId: number; total: number; stages: StageCount[] }
export type WorkerDay = { day: string; total: number; firstAt: string; lastAt: string; stages: StageCount[]; orders: WorkerOrder[] }
export type WorkerSummary = { marks: number; autoMarks: number; orders: number; stages: StageCount[]; days: WorkerDay[] }

const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1)
const toStages = (m: Map<string, number>): StageCount[] =>
  [...m].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key))

export function summarizeWorker(rows: readonly WorkerMark[]): WorkerSummary {
  const own = rows.filter(r => !r.auto_closed)
  const allStages = new Map<string, number>()
  const byDay = new Map<string, WorkerMark[]>()
  for (const r of own) {
    bump(allStages, r.stage_key)
    const day = mskDayKey(r.completed_at)
    byDay.set(day, [...(byDay.get(day) ?? []), r])
  }
  const days = [...byDay].map(([day, list]): WorkerDay => {
    const stages = new Map<string, number>()
    const orders = new Map<number, Map<string, number>>()
    for (const r of list) {
      bump(stages, r.stage_key)
      if (!orders.has(r.order_id)) orders.set(r.order_id, new Map())
      bump(orders.get(r.order_id)!, r.stage_key)
    }
    const times = list.map(r => Date.parse(r.completed_at))
    return {
      day, total: list.length,
      firstAt: new Date(Math.min(...times)).toISOString(),
      lastAt: new Date(Math.max(...times)).toISOString(),
      stages: toStages(stages),
      orders: [...orders].map(([orderId, m]) => ({ orderId, total: [...m.values()].reduce((s, n) => s + n, 0), stages: toStages(m) }))
        .sort((a, b) => b.total - a.total || a.orderId - b.orderId),
    }
  }).sort((a, b) => b.day.localeCompare(a.day))
  return {
    marks: own.length,
    autoMarks: rows.length - own.length,
    orders: new Set(own.map(r => r.order_id)).size,
    stages: toStages(allStages),
    days,
  }
}
