import { COST_RU, costsComplete, type CostKey, type MarginObject } from '@/lib/sales/marginBook'
import { orderKey } from '@/lib/sales/montageBook'

// Объект M-Glass = продажа из книги «Продажи» по номеру заказа (решение владельца 22.11,
// docs/B2C_OBJECT_ROUTE.md). Стадия и состояние маржи выводятся из того, что уже записано:
// продажа, книга «Маржа» с правками приложения, выезды монтажа.

export const OBJECTS_FROM = '2026-08-01'

export type Stage = 'work' | 'montage_planned' | 'mounted' | 'done'
export const STAGE_RU: Record<Stage, string> = {
  work: 'В работе',
  montage_planned: 'Монтаж назначен',
  mounted: 'Смонтирован, ждём остаток',
  done: 'Сдан',
}

export type ObjInstall = { order_no: string | null; order_nos: string[] | null; scheduled_date: string | null; status: string | null; kind: string | null; crew_members: string[] | null }

export type MarginState =
  | { kind: 'ok'; pct: number | null }
  | { kind: 'partial'; missing: string[] }
  | { kind: 'none' }

// Имя менеджера в книге — короткое («Дима»), в учётке — полное («Дмитрий»).
const ALIAS: Record<string, string> = { дмитрий: 'дима', владислав: 'влад', семён: 'семен', александр: 'саша' }
export function managerKey(s: string | null | undefined): string {
  const first = String(s ?? '').trim().toLowerCase().replace(/ё/g, 'е').split(/\s+/)[0] ?? ''
  return ALIAS[first] ?? ALIAS[first.replace(/е/g, 'ё')] ?? first
}
export const sameManager = (a: string | null | undefined, b: string | null | undefined) => !!managerKey(a) && managerKey(a) === managerKey(b)

export function installsOf(orderNo: string | null, all: ObjInstall[]): ObjInstall[] {
  const k = orderKey(orderNo)
  if (!k) return []
  return all.filter(i => orderKey(i.order_no) === k || (i.order_nos ?? []).some(n => orderKey(n) === k))
}

export function stageOf(closed: boolean, installs: ObjInstall[], today: string): { stage: Stage; montageDate: string | null } {
  const mont = installs.filter(i => (i.kind ?? 'install') === 'install' && i.scheduled_date && i.status !== 'canceled')
  const next = mont.filter(i => i.scheduled_date! >= today && i.status !== 'done').sort((a, b) => a.scheduled_date!.localeCompare(b.scheduled_date!))[0]
  const last = mont.filter(i => i.scheduled_date! < today || i.status === 'done').sort((a, b) => b.scheduled_date!.localeCompare(a.scheduled_date!))[0]
  if (closed) return { stage: 'done', montageDate: last?.scheduled_date ?? null }
  if (next) return { stage: 'montage_planned', montageDate: next.scheduled_date }
  if (last) return { stage: 'mounted', montageDate: last.scheduled_date }
  return { stage: 'work', montageDate: null }
}

export function marginStateOf(o: MarginObject | undefined): MarginState {
  if (!o || o.var_total == null) return { kind: 'none' }
  if (costsComplete(o)) return { kind: 'ok', pct: o.md_pct }
  const keys = o.issues.flatMap(i => (i.kind === 'missing_costs' ? i.keys : [])) as CostKey[]
  return { kind: 'partial', missing: keys.map(k => COST_RU[k]) }
}
