// Режим резчика на табло цеха (владелец 25.11.2026): что нарезать — по материалу и толщине,
// и раскладка на столько листов, сколько у резчика есть. Порядок — по дате запуска, старые
// первыми. Деталь, которая не влезла, не останавливает очередь: следующая по порядку может
// влезть («если помещается часть — делаем часть»). Только расчёт.
import { runCuttingOptimizer, type CuttingPiece, type CuttingSettings, type MaterialCuttingResult, type PieceGroup } from '@/lib/cuttingOptimizer'

type TaskLike = { item_index: number; stage_key: string; status: string; layer?: number | null }

// Позиции заказа, у которых резка ещё не закрыта. Нет ни одной задачи резки — заказ ещё не
// запущен в цех по деталям, резать нечего (а не «режь всё»).
// У триплекса задача резки своя на каждое стекло: отрезанное второй раз в раскладку не берём.
export function itemsToCut<T>(items: T[], tasks: TaskLike[], isDone: (t: TaskLike) => boolean): { index: number; item: T; layers: number[] }[] {
  const open = new Map<number, number[]>()
  for (const t of tasks) {
    if (t.stage_key !== 'cutting' || isDone(t)) continue
    open.set(t.item_index, [...(open.get(t.item_index) ?? []), t.layer || 1])
  }
  return items.flatMap((item, index) => (open.has(index) ? [{ index, item, layers: open.get(index)! }] : []))
}

export type CutPosition = { order_id: number; item_index: number; layer: number }
export type CutCandidate = CutPosition & { placed: number; total: number }

// Что можно отметить «отрезано» по раскладке: только стекло позиции, у которого в раскладке
// ВСЕ штуки. Задача резки одна на позицию (у триплекса — на стекло), половину ею не отметить.
export function cutCandidates(
  placed: CuttingPiece[],
  orders: { id: number; cut_items: { item_index?: number; quantity?: number }[] }[],
): { full: CutCandidate[]; partial: CutCandidate[] } {
  const qty = new Map<string, number>()
  for (const o of orders) for (const it of o.cut_items) {
    if (it.item_index !== undefined) qty.set(`${o.id}|${it.item_index}`, Math.max(1, Number(it.quantity) || 1))
  }
  const acc = new Map<string, CutCandidate>()
  for (const p of placed) {
    if (p.itemIndex === undefined) continue
    const total = qty.get(`${p.orderId}|${p.itemIndex}`)
    if (!total) continue
    const layer = p.layer ?? 1
    const k = `${p.orderId}|${p.itemIndex}|${layer}`
    const c = acc.get(k) ?? { order_id: p.orderId, item_index: p.itemIndex, layer, placed: 0, total }
    c.placed++
    acc.set(k, c)
  }
  const all = [...acc.values()].sort((a, b) => a.order_id - b.order_id || a.item_index - b.item_index || a.layer - b.layer)
  return { full: all.filter(c => c.placed === c.total), partial: all.filter(c => c.placed !== c.total) }
}

export type CutTask = {
  id: number; item_index: number; layer: number | null; status: string; sequence_order: number
  stage_key: string; rework_count: number | null; started_at: string | null; assigned_to: string | null; started_by: string | null
}
export type CutSkip = CutPosition & { reason: 'already' | 'other' | 'problem' | 'missing' }

// Что из присланного сервер действительно закроет. Чужую взятую и задачу с поднятой
// проблемой кнопка не трогает — их закрывают на своих экранах, где видно, что случилось.
export function pickCutTasks(tasks: CutTask[], wanted: CutPosition[], userId: string): { take: CutTask[]; skipped: CutSkip[] } {
  const take: CutTask[] = []
  const skipped: CutSkip[] = []
  const seen = new Set<string>()
  for (const w of wanted) {
    const k = `${w.item_index}|${w.layer}`
    if (seen.has(k)) continue
    seen.add(k)
    const t = tasks.find(x => x.stage_key === 'cutting' && x.item_index === w.item_index && (x.layer || 1) === w.layer)
    const reason = !t ? 'missing' : t.status === 'done' ? 'already' : t.status === 'problem' ? 'problem'
      : t.assigned_to && t.assigned_to !== userId ? 'other' : null
    if (reason) skipped.push({ ...w, reason })
    else take.push(t!)
  }
  return { take, skipped }
}

export const SKIP_LABELS: Record<CutSkip['reason'], string> = {
  already: 'уже отмечена', other: 'взял другой работник', problem: 'стоит «Проблема»', missing: 'нет задачи резки',
}

export type CutOrder = { id: number; no: string; client: string; launch_day: string | null }

// Старые первыми: кто раньше запущен, того и режем.
export const cutPriority = (a: CutOrder, b: CutOrder) =>
  (a.launch_day ?? '9999').localeCompare(b.launch_day ?? '9999') || a.id - b.id

export type Allocation = {
  result: MaterialCuttingResult | null
  placed: CuttingPiece[]
  skipped: CuttingPiece[]
  byOrder: { orderId: number; placed: number; total: number }[]
}

export function allocateToSheets(
  group: PieceGroup,
  sheets: number,
  settings: CuttingSettings,
  rank: Map<number, number>,
): Allocation {
  const queue = [...group.pieces].sort((a, b) => (rank.get(a.orderId) ?? 1e9) - (rank.get(b.orderId) ?? 1e9) || b.width * b.height - a.width * a.height)
  let placed: CuttingPiece[] = []
  const skipped: CuttingPiece[] = []
  let result: MaterialCuttingResult | null = null
  if (sheets > 0) {
    for (const p of queue) {
      const trial = [...placed, p]
      const r = runCuttingOptimizer(new Map([['k', { ...group, pieces: trial }]]), settings)[0]
      if (r && r.unplacedCount === 0 && r.sheetsNeeded <= sheets) { placed = trial; result = r }
      else skipped.push(p)
    }
  } else skipped.push(...queue)
  const total = new Map<number, number>()
  const ok = new Map<number, number>()
  for (const p of queue) total.set(p.orderId, (total.get(p.orderId) ?? 0) + 1)
  for (const p of placed) ok.set(p.orderId, (ok.get(p.orderId) ?? 0) + 1)
  const byOrder = [...total.entries()]
    .map(([orderId, t]) => ({ orderId, placed: ok.get(orderId) ?? 0, total: t }))
    .sort((a, b) => (rank.get(a.orderId) ?? 1e9) - (rank.get(b.orderId) ?? 1e9))
  return { result, placed, skipped, byOrder }
}
