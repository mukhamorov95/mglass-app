// Табло цеха по заказам (владелец 25.11.2026): канбан как в amoCRM, колонки — этапы цеха.
// Заказ стоит в колонке самого раннего этапа, где у него есть незакрытая деталь: пока
// хоть одна деталь не нарезана, заказ на «Резке». Только расчёт, чтение — в маршруте.
import { PRODUCTION_STAGES } from '@/lib/productionStages'
import { materialKind } from '@/lib/materialLabel'

export type KanbanColumn = 'new' | (typeof PRODUCTION_STAGES)[number]['key'] | 'packed' | 'shipped'

export const KANBAN_COLUMNS: { key: KanbanColumn; label: string }[] = [
  { key: 'new', label: 'Новые' },
  ...PRODUCTION_STAGES.map(s => ({ key: s.key as KanbanColumn, label: s.label })),
  { key: 'packed', label: 'Упакован' },
  { key: 'shipped', label: 'Отгружен' },
]

// Отгруженные копятся сотнями: на табло — за последние дни, остальное в «Заказах».
export const SHIPPED_SHOW_DAYS = 7

type Task = { stage_key: string; status: string }
const STAGE_ORDER = new Map<string, number>(PRODUCTION_STAGES.map((s, i) => [s.key, i]))

export function kanbanColumn(tasks: Task[], shipped: boolean): KanbanColumn {
  if (shipped) return 'shipped'
  if (tasks.length === 0 || tasks.every(t => t.status !== 'done')) return 'new'
  const open = tasks.filter(t => t.status !== 'done')
  if (open.length === 0) return 'packed'
  // Этап, которого нет в справочнике, ставим после известных: заказ не пропадает с табло.
  const first = open.reduce((best, t) => ((STAGE_ORDER.get(t.stage_key) ?? 99) < (STAGE_ORDER.get(best.stage_key) ?? 99) ? t : best))
  return STAGE_ORDER.has(first.stage_key) ? (first.stage_key as KanbanColumn) : 'packaging'
}

export type KanbanMaterial = { kind: 'Стекло' | 'Зеркало'; name: string; thickness: number; pieces: number }

type ItemLike = {
  materialName?: string | null; category?: string | null; thickness?: number | string | null; quantity?: number | string | null
  hasTriplex?: boolean; triplexGlasses?: { materialName?: string | null; thickness?: number | string | null }[] | null
}

// Материалы заказа: вид + название + толщина, штук деталей. Стекло и зеркало раздельно.
// Триплекс — каждое стекло пакета своей строкой: режут их по отдельности.
export function orderMaterials(items: unknown): KanbanMaterial[] {
  const acc = new Map<string, KanbanMaterial>()
  const add = (kind: KanbanMaterial['kind'], name: string, thickness: number, pieces: number) => {
    const key = `${kind}|${name.toLowerCase()}|${thickness}`
    const cur = acc.get(key)
    if (cur) cur.pieces += pieces
    else acc.set(key, { kind, name, thickness, pieces })
  }
  for (const raw of Array.isArray(items) ? items : []) {
    const it = raw as ItemLike
    const kind = materialKind(it)
    if (!kind) continue
    const qty = Math.max(1, Math.floor(Number(it.quantity) || 1))
    const glasses = it.hasTriplex && Array.isArray(it.triplexGlasses) && it.triplexGlasses.length ? it.triplexGlasses : null
    if (glasses) {
      for (const g of glasses) add('Стекло', String(g.materialName ?? '').trim() || 'Стекло', Number(g.thickness) || 0, qty)
      continue
    }
    add(kind, String(it.materialName ?? '').trim() || kind, Number(it.thickness) || 0, qty)
  }
  return [...acc.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.thickness - b.thickness || a.name.localeCompare(b.name))
}

export const materialLine = (m: KanbanMaterial) => `${m.kind} ${m.name}${m.thickness ? ` ${m.thickness} мм` : ''}`

// Сколько дней до срока отгрузки: 0 — сегодня, минус — просрочен.
export function daysLeft(deadlineDay: string | null, today: string): number | null {
  if (!deadlineDay) return null
  return Math.round((Date.parse(`${deadlineDay}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)
}

export function daysLeftLabel(d: number | null): string {
  if (d === null) return 'срок не указан'
  if (d === 0) return 'сегодня'
  if (d < 0) return `просрочен ${-d} дн.`
  return `${d} дн.`
}

export type KanbanCardLike = {
  id: number; no: string; client: string; launch_day: string | null; ship_day?: string | null
  column: KanbanColumn; materials: KanbanMaterial[]
}

// Новые сверху, старые уходят вниз (владелец 25.11).
export const kanbanSort = <T extends KanbanCardLike>(list: T[]) =>
  [...list].sort((a, b) => (b.launch_day ?? '').localeCompare(a.launch_day ?? '') || b.id - a.id)

export function kanbanMatch(o: KanbanCardLike, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  const hay = `${o.no} ${o.id} ${o.client} ${o.materials.map(materialLine).join(' ')}`.toLowerCase()
  return s.split(/\s+/).every(w => hay.includes(w))
}

export function onKanban(o: Pick<KanbanCardLike, 'column' | 'ship_day'>, today: string): boolean {
  if (o.column !== 'shipped') return true
  const d = daysLeft(o.ship_day ?? null, today)
  return d !== null && -d < SHIPPED_SHOW_DAYS
}
