// «Срочно отгрузить» (владелец 17.11.2026): владелец отмечает заказы Шовер Гласс, ставит их по срочности
// и отдаёт цеху ведомость: что по каждому изделию ещё не сделано. Место в очереди — notes.ship_urgent.rank.
import { stageLabel } from '@/lib/productionStages'

// lines: какие изделия и сколько штук срочные; нет поля — весь заказ, всё, что ещё не уехало (17.11.2026).
export type UrgentLines = Record<string, number>
export type ShipUrgent = { rank: number; at?: string; by?: string; lines?: UrgentLines | null }

export function shipUrgentOf(notes: unknown): ShipUrgent | null {
  let n: unknown = notes
  if (typeof n === 'string') { try { n = JSON.parse(n) } catch { return null } }
  const v = (n as { ship_urgent?: unknown } | null)?.ship_urgent as ShipUrgent | null | undefined
  if (!v || !Number.isFinite(Number(v.rank))) return null
  return { ...v, rank: Number(v.rank), lines: cleanLines(v.lines) }
}

export function cleanLines(v: unknown): UrgentLines | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out: UrgentLines = {}
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    const q = Math.floor(Number(n))
    if (k && q > 0) out[k] = q
  }
  return Object.keys(out).length ? out : null
}

type ShipLineView = { key: string; qty: number; shipped: number; free: number }

// Что отгружаем по срочному заказу: весь заказ — всё не уехавшее; отдельные изделия — они, не больше остатка.
export function urgentLinesOf<L extends ShipLineView>(lines: L[], chosen: UrgentLines | null | undefined): { line: L; qty: number }[] {
  return lines.flatMap(line => {
    const left = line.qty - line.shipped
    const want = chosen ? Math.min(chosen[line.key] ?? 0, left) : left
    return want > 0 ? [{ line, qty: want }] : []
  })
}

// Выбор на экране → что хранить: отмечены все свободные изделия целиком — значит весь заказ (null).
export function chosenToStore<L extends ShipLineView>(lines: L[], picked: Map<string, number>): UrgentLines | null {
  const free = lines.filter(l => l.free > 0)
  if (free.length > 0 && free.every(l => (picked.get(l.key) ?? 0) >= l.free)) return null
  return cleanLines(Object.fromEntries(picked))
}

type Ranked = { id: number; urgent_rank: number | null; overdue_days: number; deadline_day: string | null; launch_day: string }

// Новые встают в конец очереди: сначала самые просроченные, потом по сроку и запуску.
export function byDeadline<T extends Omit<Ranked, 'urgent_rank'>>(list: T[]): T[] {
  return [...list].sort((a, b) => b.overdue_days - a.overdue_days
    || (a.deadline_day ?? '9999').localeCompare(b.deadline_day ?? '9999')
    || a.launch_day.localeCompare(b.launch_day) || a.id - b.id)
}

export function urgentQueue<T extends Ranked>(list: T[]): T[] {
  return list.filter(o => o.urgent_rank !== null).sort((a, b) => (a.urgent_rank ?? 0) - (b.urgent_rank ?? 0) || a.id - b.id)
}

// Порядок после добавления: старые на своих местах, новые в конце. Уже стоящие не дублируются.
export function withAdded(queue: number[], added: number[]): number[] {
  const seen = new Set(queue)
  return [...queue, ...added.filter(id => !seen.has(id) && seen.add(id))]
}

export function moved(queue: number[], id: number, dir: -1 | 1): number[] {
  const i = queue.indexOf(id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= queue.length) return queue
  const next = [...queue]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

// Какие места поменялись: пишем только их, а не всю очередь.
export function rankChanges(before: Map<number, number | null>, order: number[]): { id: number; rank: number }[] {
  return order.map((id, i) => ({ id, rank: i + 1 })).filter(x => before.get(x.id) !== x.rank)
}

export type StageTask = { item_index: number | null; stage_key: string; status: string; sequence_order: number | null }

// Что по изделию ещё не закрыто, по порядку станций. Пусто при задачах — всё сделано; без задач — null: цех её не вёл.
export function leftStages(tasks: StageTask[], index: number): string[] | null {
  const mine = tasks.filter(t => t.item_index === index && t.stage_key !== 'problem')
  if (mine.length === 0) return null
  return mine.filter(t => t.status !== 'done').sort((a, b) => (a.sequence_order ?? 0) - (b.sequence_order ?? 0)).map(t => stageLabel(t.stage_key))
}
