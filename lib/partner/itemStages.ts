import { stageLabel } from '@/lib/productionStages'
import { markLine, type BoardTask } from '@/lib/production/ordersBoard'

// Раскрытый заказ в кабинете (владелец 24.11): по каждой детали — какие этапы цеха
// пройдены, кто и когда отметил, сколько штук уехало. Чистая функция, читает маршрут.

export type ItemStage = { key: string; label: string; done: boolean; at: string | null; by: string | null; note: string | null }
export type ItemView = { index: number; label: string; size: string; qty: number; shipped: number; done: number; total: number; stages: ItemStage[] }
type Line = { index: number; key: string; label: string; size: string; qty: number }

export function itemStages(lines: Line[], tasks: BoardTask[], shippedOf: (lineKey: string) => number): ItemView[] {
  return lines.map(l => {
    const mine = tasks.filter(t => t.item_index === l.index && t.stage_key !== 'problem')
      .sort((a, b) => a.sequence_order - b.sequence_order)
    const stages = mine.map(t => {
      const done = t.status === 'done'
      const m = done ? markLine(t, stageLabel) : { by: null, note: null }
      return { key: t.stage_key, label: stageLabel(t.stage_key), done, at: done ? t.completed_at : null, by: m.by, note: m.note }
    })
    return {
      index: l.index, label: l.label, size: l.size, qty: l.qty,
      shipped: Math.min(l.qty, Math.max(0, shippedOf(l.key))),
      done: stages.filter(s => s.done).length, total: stages.length, stages,
    }
  })
}
