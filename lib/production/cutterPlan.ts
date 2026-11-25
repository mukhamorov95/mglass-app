// Режим резчика на табло цеха (владелец 25.11.2026): что нарезать — по материалу и толщине,
// и раскладка на столько листов, сколько у резчика есть. Порядок — по дате запуска, старые
// первыми. Деталь, которая не влезла, не останавливает очередь: следующая по порядку может
// влезть («если помещается часть — делаем часть»). Только расчёт.
import { runCuttingOptimizer, type CuttingPiece, type CuttingSettings, type MaterialCuttingResult, type PieceGroup } from '@/lib/cuttingOptimizer'

type TaskLike = { item_index: number; stage_key: string; status: string }

// Позиции заказа, у которых резка ещё не закрыта. Нет ни одной задачи резки — заказ ещё не
// запущен в цех по деталям, резать нечего (а не «режь всё»).
export function itemsToCut<T>(items: T[], tasks: TaskLike[], isDone: (t: TaskLike) => boolean): { index: number; item: T }[] {
  const cutting = tasks.filter(t => t.stage_key === 'cutting')
  const open = new Set(cutting.filter(t => !isDone(t)).map(t => t.item_index))
  return items.flatMap((item, index) => (open.has(index) ? [{ index, item }] : []))
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
