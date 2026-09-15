import { isShipped, orderDeadline, type TodayOrder } from '../b2b/todayPriorities'
import { isUrgent, materialStatus, parseNotes } from '../orderFlags'
import { stageDayKey } from './dayLists'
import { mskDayKey } from '../time'

// Главная Production App (ТЗ 4.3, маршрут Н3): шесть ответов на одном экране —
// мои задачи, заказы в работе, срочные, материал, отгрузка сегодня, загрузка людей.
// Ничего не пишет и ничего не считает заново: те же отметки, что во вкладках цеха.

export type ShopTask = {
  order_id: number
  station: string | null
  stage_key: string
  status: string
  assigned_to: string | null
  started_by_name: string | null
  completed_at: string | null
  completed_by_name: string | null
}

export type ShopOrder = Pick<TodayOrder, 'id' | 'client_name' | 'custom_number' | 'notes' | 'launched_at' | 'created_at'>

export type ShopOrderRow = { id: number; ref: string; client: string; note: string; days: number | null }

export type ShopHome = {
  my: { scope: 'mine' | 'shop'; open: number; inProgress: number; problems: number; byStation: { station: string; count: number }[] }
  inWork: { count: number; rows: ShopOrderRow[] }
  urgent: { overdue: number; today: number; flagged: number; rows: ShopOrderRow[] }
  material: { orders: number; requestsOpen: number; rows: ShopOrderRow[] }
  shipping: { ready: number; shippedToday: number; rows: ShopOrderRow[] }
  people: { name: string; doneToday: number; inProgress: number }[]
}

const OPEN = new Set(['queued', 'in_progress', 'problem'])
const DAY = 86_400_000
const ROWS = 6
const ref = (o: ShopOrder) => o.custom_number?.trim() || `#${o.id}`

export function shopHome(input: {
  tasks: ShopTask[]
  orders: ShopOrder[]
  purchaseRequestsOpen: number
  me: { id: string | null; stations: string[] | null }
  now?: number
}): ShopHome {
  const { tasks, orders, me } = input
  const now = input.now ?? Date.now()
  const todayKey = mskDayKey(now)
  const todayStart = Date.parse(`${todayKey}T00:00:00+03:00`)

  // 1. Мои задачи — станции работника или назначенные ему; у кого станций нет — весь цех
  const stations = me.stations?.filter(Boolean) ?? []
  const scope: 'mine' | 'shop' = stations.length > 0 ? 'mine' : 'shop'
  const mine = tasks.filter(t => OPEN.has(t.status) && (scope === 'shop' || stations.includes(t.station ?? '') || (me.id != null && t.assigned_to === me.id)))
  const byStationMap = new Map<string, number>()
  for (const t of mine) byStationMap.set(t.station ?? t.stage_key, (byStationMap.get(t.station ?? t.stage_key) ?? 0) + 1)

  // Задачи по заказам: сколько открыто, сколько всего
  const perOrder = new Map<number, { open: number; total: number }>()
  for (const t of tasks) {
    const a = perOrder.get(t.order_id) ?? { open: 0, total: 0 }
    a.total++
    if (OPEN.has(t.status)) a.open++
    perOrder.set(t.order_id, a)
  }

  const inWork: (ShopOrderRow & { dl: number })[] = []
  const urgent: (ShopOrderRow & { dl: number })[] = []
  const material: ShopOrderRow[] = []
  const ready: (ShopOrderRow & { packed: number })[] = []
  let overdue = 0, dueToday = 0, flagged = 0, shippedToday = 0

  for (const o of orders) {
    const n = parseNotes(o.notes)
    if (n.is_template === true || !o.launched_at) continue
    const stages = (n.stages ?? {}) as Record<string, unknown>
    if (isShipped(n)) {
      if (stageDayKey(stages.shipped) === todayKey) shippedToday++
      continue
    }
    const t = perOrder.get(o.id) ?? { open: 0, total: 0 }
    const dl = orderDeadline(o as TodayOrder, n).getTime()
    const daysLeft = Math.floor((dl - todayStart) / DAY)
    const base = { id: o.id, ref: ref(o), client: o.client_name }

    if (t.open > 0) {
      inWork.push({ ...base, note: `открыто задач: ${t.open} из ${t.total}`, days: daysLeft, dl })
      const isFlag = isUrgent(o.notes)
      if (dl < todayStart) overdue++
      else if (daysLeft === 0) dueToday++
      if (isFlag) flagged++
      if (dl < todayStart + DAY || isFlag) {
        urgent.push({ ...base, note: dl < todayStart ? `просрочен на ${-daysLeft} дн.` : daysLeft === 0 ? 'срок сегодня' : 'помечен срочным', days: daysLeft, dl })
      }
    }

    const needItems = Array.isArray(n.material_needed_items) ? (n.material_needed_items as unknown[]).length : 0
    if (materialStatus(o.notes) === 'needed' || needItems > 0) {
      material.push({ ...base, note: needItems > 0 ? `нет материала на ${needItems} поз.` : 'нет материала на заказ', days: daysLeft })
    }

    const packedKey = stageDayKey(stages.packaged)
    const packed = packedKey != null || stages.packaged === true
    if (packed || (t.total > 0 && t.open === 0)) {
      const packedAt = packedKey ? Date.parse(`${packedKey}T00:00:00+03:00`) : NaN
      const waiting = Number.isFinite(packedAt) ? Math.max(0, Math.floor((todayStart - packedAt) / DAY)) : null
      ready.push({ ...base, note: packed ? (waiting ? `упакован ${waiting} дн. назад` : 'упакован') : 'все этапы закрыты', days: waiting, packed: Number.isFinite(packedAt) ? packedAt : Infinity })
    }
  }

  // 6. Люди: закрыто сегодня и в работе сейчас
  const people = new Map<string, { doneToday: number; inProgress: number }>()
  for (const t of tasks) {
    if (t.completed_at && t.completed_by_name && mskDayKey(Date.parse(t.completed_at)) === todayKey) {
      const p = people.get(t.completed_by_name) ?? { doneToday: 0, inProgress: 0 }
      p.doneToday++
      people.set(t.completed_by_name, p)
    }
    if (t.status === 'in_progress' && t.started_by_name) {
      const p = people.get(t.started_by_name) ?? { doneToday: 0, inProgress: 0 }
      p.inProgress++
      people.set(t.started_by_name, p)
    }
  }

  const strip = <T extends ShopOrderRow>(r: T): ShopOrderRow => ({ id: r.id, ref: r.ref, client: r.client, note: r.note, days: r.days })
  return {
    my: {
      scope, open: mine.length,
      inProgress: mine.filter(t => t.status === 'in_progress').length,
      problems: mine.filter(t => t.status === 'problem').length,
      byStation: [...byStationMap.entries()].map(([station, count]) => ({ station, count })).sort((a, b) => b.count - a.count),
    },
    inWork: { count: inWork.length, rows: inWork.sort((a, b) => a.dl - b.dl).slice(0, ROWS).map(strip) },
    urgent: { overdue, today: dueToday, flagged, rows: urgent.sort((a, b) => a.dl - b.dl).slice(0, ROWS).map(strip) },
    material: { orders: material.length, requestsOpen: input.purchaseRequestsOpen, rows: material.slice(0, ROWS) },
    shipping: { ready: ready.length, shippedToday, rows: ready.sort((a, b) => a.packed - b.packed).slice(0, ROWS).map(strip) },
    people: [...people.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.doneToday - a.doneToday || b.inProgress - a.inProgress),
  }
}
