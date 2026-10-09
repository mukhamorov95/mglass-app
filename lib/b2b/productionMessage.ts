// Производственное сообщение B2B-заказа: текст, который владелец копирует в рабочий чат.
// Собирается из строки заказа в момент нажатия — после «Изменить сумму» или правки
// номера в буфер уходит уже новое, а не сохранённая когда-то копия.

import { materialLabel } from '@/lib/materialLabel'
import { finalTotalOf } from '@/lib/b2b/priceOverride'
import { itemNote, treatmentTags, type TreatmentItem } from '@/lib/b2b/itemTreatments'

export type MessageOrder = {
  id: number
  custom_number?: string | null
  client_order_number?: string | null
  client_name: string
  items: unknown[]
  total_after_discount?: number | null
  total_sale_inc_vat?: number | null
}

type Item = TreatmentItem & {
  materialName?: string | null
  category?: string | null
  thickness?: number | null
  width?: number | null
  height?: number | null
  quantity?: number | null
  totalAreaNet?: number | null
  hasTempering?: boolean | null
}

type Group = { label: string; hasTemp: boolean; lines: { w: number; h: number; qty: number; area: number; work: string }[] }

export const orderNumberOf = (o: Pick<MessageOrder, 'id' | 'custom_number'>) => o.custom_number?.trim() || `00${o.id}`

const area2 = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

function groupItems(items: unknown[]): Group[] {
  const groups = new Map<string, Group>()
  for (const item of (Array.isArray(items) ? items : []) as Item[]) {
    if (!item) continue
    const key = `${item.materialName}|${item.thickness}`
    let g = groups.get(key)
    if (!g) {
      // materialLabel сам подписывает зеркало/рифлёное и не дублирует толщину из названия.
      g = { label: materialLabel(item), hasTemp: false, lines: [] }
      groups.set(key, g)
    }
    if (item.hasTempering) g.hasTemp = true
    // Обработка и комментарий — к самой детали, в ту же строку: песочка по макету, фацет,
    // отверстия, лента подсветки. Без этого цех узнавал о них голосом (05669, 09.10).
    const work = [treatmentTags(item).join(', '), itemNote(item.comment)].filter(Boolean).join(' · ')
    g.lines.push({ w: Number(item.width ?? 0), h: Number(item.height ?? 0), qty: Number(item.quantity ?? 0), area: Number(item.totalAreaNet ?? 0), work })
  }
  return [...groups.values()]
}

export function buildProductionMessage(order: MessageOrder): string {
  const out: string[] = [orderNumberOf(order)]
  if (order.client_order_number) out.push(`(${order.client_order_number})`)
  out.push('', order.client_name)
  for (const g of groupItems(order.items)) {
    out.push('', `${g.label}${g.hasTemp ? ', закалённое' : ''}, упакованное`)
    for (const l of g.lines) out.push(`  ${l.w}×${l.h} мм — ${l.qty} шт${l.work ? ` · ${l.work}` : ''}`)
    const qty = g.lines.reduce((s, l) => s + l.qty, 0)
    const area = g.lines.reduce((s, l) => s + l.area, 0)
    out.push(`  Итого: ${qty} шт · ${area2(area)} м²`)
  }
  out.push('', `💰 ${finalTotalOf(order).toLocaleString('ru-RU')} ₽`)
  return out.join('\n')
}

// Подпись для тоста: по ней видно, что скопирован нужный заказ, не открывая текст.
export function productionMessageSummary(order: MessageOrder): string {
  const lines = groupItems(order.items).flatMap(g => g.lines)
  const qty = lines.reduce((s, l) => s + l.qty, 0)
  const area = lines.reduce((s, l) => s + l.area, 0)
  return `${orderNumberOf(order)} · ${order.client_name} · ${qty} шт · ${area2(area)} м²`
}
