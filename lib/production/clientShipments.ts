// Отгрузка клиенту по изделиям (владелец 03.11.2026): какие заказы и изделия уехали, заказ уехал
// полностью или нет, какой вес, на какую сумму. Здесь только расчёт, запись — в API-маршруте.
import { computeInvoiceTotals, type InvoiceOrder, type InvoiceOrderItem } from '@/lib/b2b/invoiceMath'
import { daysInWork } from '@/lib/b2b/inWorkOrders'
import { itemWeight, type WeighableItem } from '@/lib/deliveryWeight'
import { materialWithKind } from '@/lib/materialLabel'

export const SHOWER_GLASS = { region: 'shower_glass', clientId: 2, title: 'Шовер Гласс' } as const

type RawItem = Omit<InvoiceOrderItem, 'manualTotal'> & WeighableItem & { localId?: string | null; manualTotal?: number | string | null }
export type ShipOrder = {
  items?: RawItem[] | null
  discount_percent?: number | null; total_sale_inc_vat?: number | null; total_after_discount?: number | null
}

export type ShipLine = {
  key: string; index: number; label: string; size: string
  qty: number; weight: number; amount: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

// У строк, заведённых до 30.06, может не быть localId: тогда ключ — её номер в заказе.
export const lineKeyOf = (it: { localId?: string | null }, index: number) => it.localId?.trim() || `i${index}`

export function shipLines(order: ShipOrder): ShipLine[] {
  const items = Array.isArray(order.items) ? order.items : []
  // manualTotal бывает пустой строкой: computeInvoiceTotals прочёл бы её как ноль.
  const clean = items.map(it => (it.manualTotal === '' ? { ...it, manualTotal: null } : it)) as InvoiceOrderItem[]
  const { lineSums } = computeInvoiceTotals({ ...order, items: clean } as InvoiceOrder)
  return items.map((it, index) => ({
    key: lineKeyOf(it, index),
    index,
    label: materialWithKind(it, 'Изделие') + (it.thickness ? `, ${it.thickness} мм` : ''),
    size: it.width && it.height ? `${it.width}×${it.height}` : '',
    qty: Math.max(1, Math.floor(Number(it.quantity) || 1)),
    weight: round2(itemWeight(it)),
    amount: lineSums[index] ?? 0,
  }))
}

// Доля строки при частичной отгрузке: копейки и граммы сходятся, сколько бы частей ни было.
export function shareOf(total: number, qty: number, from: number, take: number): number {
  return round2(round2(total * (from + take) / qty) - round2(total * from / qty))
}

export type ShipRow = { shipment_id: number; order_id: number; line_key: string; qty: number }
export type LineTaken = { shipped: number; drafted: number }

// statusOf: статус отгрузки, к которой относится строка; строку чужой отгрузки не считаем дважды.
export function takenByLine(rows: ShipRow[], statusOf: (shipmentId: number) => string | undefined, exceptShipment?: number) {
  const out = new Map<string, LineTaken>()
  for (const r of rows) {
    if (r.shipment_id === exceptShipment) continue
    const status = statusOf(r.shipment_id)
    if (!status) continue
    const k = `${r.order_id}:${r.line_key}`
    const cur = out.get(k) ?? { shipped: 0, drafted: 0 }
    if (status === 'shipped') cur.shipped += r.qty
    else cur.drafted += r.qty
    out.set(k, cur)
  }
  return out
}

export type OrderShipState = 'none' | 'partial' | 'full'

export function orderShipState(lines: Pick<ShipLine, 'key' | 'qty'>[], shippedOf: (lineKey: string) => number): OrderShipState {
  if (lines.length === 0) return 'none'
  const shipped = lines.map(l => shippedOf(l.key))
  if (shipped.every((s, i) => s >= lines[i].qty)) return 'full'
  return shipped.some(s => s > 0) ? 'partial' : 'none'
}

export const ORDER_STATE_LABEL: Record<OrderShipState, string> = {
  none: 'Не отгружен', partial: 'Отгружен частично', full: 'Отгружен полностью',
}

// Вкладки экрана (владелец 05.11.2026): заказ лежит ровно в одной из трёх, просрочка — поверх них.
export type OrderStage = 'in_work' | 'packed' | 'shipped'
type StageLine = { qty: number; shipped: number; packed: boolean }

// Позиция, уехавшая целиком, упакована, даже если цех не закрыл задачу: иначе читается «упаковано 0, отгружено всё».
const lineReady = (l: StageLine) => l.packed || l.shipped >= l.qty
export const packedLineCount = (lines: StageLine[]) => lines.filter(lineReady).length

export function orderStage(lines: StageLine[], state: OrderShipState, markedShipped: boolean): OrderStage {
  if (state === 'full' || markedShipped) return 'shipped'
  return lines.length > 0 && lines.every(lineReady) ? 'packed' : 'in_work'
}

// Дни просрочки по календарю: день срока ещё не просрочка. Уехавший заказ не просрочен.
export function overdueDays(deadlineDay: string | null, today: string, stage: OrderStage): number {
  return stage === 'shipped' || !deadlineDay ? 0 : daysInWork(deadlineDay, today)
}

// Почему заказа нет в рабочих вкладках: он виден только в истории и не собирается в отгрузку.
export type OrderHidden = 'archived' | 'quote' | 'historical'
export const ORDER_HIDDEN_LABEL: Record<OrderHidden, string> = {
  archived: 'В архиве', quote: 'Просчёт, не запущен', historical: 'Старый заказ, импорт',
}

type HiddenNotes = { status?: string; historical?: boolean }
export function orderHidden(archivedAt: string | null | undefined, notes: HiddenNotes): OrderHidden | null {
  if (archivedAt) return 'archived'
  if (notes.status === 'quote') return 'quote'
  return notes.historical ? 'historical' : null
}

// Номер ищем без ведущих нулей: один заказ пишут и 05792, и 005792, и 5792.
export const stripZeros = (s: string) => s.trim().replace(/^0+(?=\d)/, '')
export function numberMatches(query: string, no: string, id: number): boolean {
  const q = stripZeros(query.toLowerCase())
  return !q || stripZeros(no.toLowerCase()).includes(q) || String(id).includes(q)
}

export type LineRequest = { order_id: number; line_key: string; qty: number }

// Нельзя отгрузить больше, чем есть: возвращает текст отказа или null.
export function requestProblem(req: LineRequest, line: Pick<ShipLine, 'qty' | 'label'> | undefined, taken: LineTaken | undefined, already = 0): string | null {
  if (!line) return `Заказ ${req.order_id}: строка не найдена, заказ могли изменить. Обновите экран.`
  if (!Number.isInteger(req.qty) || req.qty <= 0) return `${line.label}: количество должно быть целым и больше нуля.`
  const free = line.qty - (taken?.shipped ?? 0) - (taken?.drafted ?? 0) - already
  if (req.qty > free) return `${line.label}: можно взять ${Math.max(0, free)} из ${line.qty} шт.`
  return null
}

export type ShipmentLineView = { order_id: number; key: string; qty: number; lineQty: number; weight: number; amount: number }

// Итог отгрузки: заказов, штук, вес, сумма — одна функция и для карточки, и для листа.
export function shipmentTotals(lines: Pick<ShipmentLineView, 'order_id' | 'qty' | 'weight' | 'amount'>[]) {
  return {
    orders: new Set(lines.map(l => l.order_id)).size,
    pieces: lines.reduce((s, l) => s + l.qty, 0),
    weight: round2(lines.reduce((s, l) => s + l.weight, 0)),
    amount: round2(lines.reduce((s, l) => s + l.amount, 0)),
  }
}
