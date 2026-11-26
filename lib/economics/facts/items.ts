import type { Channel, CostLine, DriverUnit, OperationCode, OrderRef, Part } from '../types'
import { bomOperation, serviceOperation } from './operations'
import { canonicalClient, isOwnRetail } from '@/lib/liveOrders'

// Разбор СОХРАНЁННОЙ позиции. Ничего не пересчитывается: суммы берутся как записаны, а всё, что
// не объясняется статьями, уходит отдельной строкой и не прячется. Тождество на каждой позиции:
// Σ строк = costWithVat. Чего в позиции нет (диаметр, тип выреза, тип кромки) — null, не догадка.

export type StoredItem = Record<string, unknown>

export const STORED_VERSION = 'item'

const num = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0)
const orNull = (x: unknown) => (num(x) > 0 ? num(x) : null)
const arr = (x: unknown) => (Array.isArray(x) ? x as Record<string, unknown>[] : [])
const r2 = (x: number) => Math.round(x * 100) / 100
const r4 = (x: number) => Math.round(x * 10000) / 10000

export const isProductItem = (it: StoredItem) => String(it.category ?? '') === 'изделие'

const layersOf = (it: StoredItem) => (it.hasTriplex ? (num(it.triplexLayers) === 3 ? 3 : 2) : 1)
const netM2Of = (it: StoredItem) => num(it.totalAreaNet) || r4(num(it.width) * num(it.height) / 1_000_000 * num(it.quantity))

export function itemParts(orderId: number, index: number, it: StoredItem): Part[] {
  const extra = arr(it.triplexGlasses)
  return Array.from({ length: layersOf(it) }, (_, i) => {
    const glass = i === 0 ? it : extra[i - 1] ?? {}
    const cutGroups = arr(it.cutoutGroups)
    return {
      partKey: `${orderId}:${index}:${i + 1}`,
      materialId: orNull(glass.materialId),
      thicknessMm: orNull(glass.thickness),
      widthMm: orNull(it.width),
      heightMm: orNull(it.height),
      qty: orNull(it.quantity),
      shape: it.shape === 'curved' ? 'curved' : it.shape === 'rect' ? 'rect' : 'unknown',
      edgeType: null,
      holes: arr(it.holes).filter(h => num(h.n) > 0).map(h => ({ diameterMm: orNull(h.d), qty: num(h.n) })),
      cutouts: cutGroups.length
        ? cutGroups.map(c => ({ type: `${c.kind}-${c.cat}`, qty: orNull(c.n) }))
        : it.hasCutouts || num(it.cutouts) > 0 ? [{ type: null, qty: orNull(it.cutouts) }] : [],
      color: null,
      drawingRef: null,
    }
  })
}

type Add = (op: OperationCode, label: string, amount: number, unit: DriverUnit, qty: number | null, materialId?: number | null) => void

function sheetLines(it: StoredItem, add: Add) {
  const q = num(it.quantity), net = netM2Of(it), billed = num(it.totalAreaBilled) || null
  const perimeter = orNull(it.perimeterM) == null ? null : r2(num(it.perimeterM) * q)
  add('material', 'Стекло с расходом', num(it.costMaterial), 'm2', billed, orNull(it.materialId))
  add('tempering', 'Закалка', num(it.costTempering), 'm2', net || null)
  add('facet', 'Фацет', num(it.costFacet), 'lm', perimeter)
  add('edge', 'Кромка', num(it.costEdge), 'lm', perimeter == null ? null : r2(perimeter * layersOf(it)))
  add('transport', 'Перевозка на закалку', num(it.costTransport), 'pcs', q || null)
  add('packaging', 'Упаковка', num(it.costPackaging), 'm2', net || null)
  add('triplex', 'Триплексация', num(it.costTriplex), 'm2', net || null)
}

// Состав изделия производства записан НА ВСЮ позицию: factoryQuoteToItem уже умножил объём
// и сумму на количество (так же его читает lib/b2b/itemCostPanel).
function productLines(it: StoredItem, add: Add) {
  for (const b of arr(it.bom)) {
    const unit = String(b.unit ?? '')
    const u: DriverUnit = /м²|m2/i.test(unit) ? 'm2' : /пог|м\.п/i.test(unit) ? 'lm' : unit === '₽' || unit === '%' ? 'rub' : 'pcs'
    const op = bomOperation(String(b.name ?? ''))
    add(op, String(b.name ?? ''), num(b.total), u, u === 'rub' ? null : r4(num(b.qty)) || null,
      op === 'material' ? orNull(it.materialId) : null)
  }
}

export function itemLines(orderId: number, index: number, it: StoredItem): CostLine[] {
  const lines: CostLine[] = []
  const add: Add = (op, label, amount, unit, qty, materialId = null) => {
    if (!amount) return
    lines.push({
      orderId, item: index, layer: null, partKey: null, op, label, materialId,
      driver: { unit, qty },
      value: { scheme: 'stored', version: STORED_VERSION, amountGross: amount,
        rate: qty ? r2(amount / qty) : null, rateSource: 'сохранено в позиции' },
    })
  }
  const product = isProductItem(it)
  if (product) productLines(it, add)
  else sheetLines(it, add)
  for (const s of arr(it.services)) {
    const name = String(s.name ?? '')
    const unit: DriverUnit = s.type === 'per_m2' ? 'm2' : 'pcs'
    add(serviceOperation(name), name, num(s.costPrice), unit, (unit === 'm2' ? netM2Of(it) : num(it.quantity)) || null)
  }

  const rest = num(it.costWithVat) - lines.reduce((a, l) => a + (l.value.amountGross ?? 0), 0)
  if (Math.abs(rest) >= 0.005) {
    // Изделие округляется дважды: каждая строка состава и итог за штуку.
    const rounding = product && arr(it.bom).length > 0 && Math.abs(rest) <= (arr(it.bom).length + 1) * 0.5 * (num(it.quantity) || 1)
    add(rounding ? 'rounding' : 'unclassified', rounding ? 'Округление состава изделия' : 'Разница с себестоимостью позиции', r2(rest), 'rub', null)
  }
  return lines
}

export type OrderRow = { id: number; client_name?: string | null; items?: unknown }

export const itemsOf = (o: OrderRow): StoredItem[] => {
  const raw = typeof o.items === 'string' ? safeJson(o.items) : o.items
  return Array.isArray(raw) ? raw as StoredItem[] : []
}
const safeJson = (s: string): unknown => { try { return JSON.parse(s) } catch { return null } }

export const orderLines = (o: OrderRow) => itemsOf(o).flatMap((it, i) => itemLines(o.id, i, it))
export const orderParts = (o: OrderRow) => itemsOf(o).flatMap((it, i) => (isProductItem(it) ? [] : itemParts(o.id, i, it)))

// Отдельного поля канала в заказе нет. «Внутренний» — снабжение своей розницы (канал конечного
// клиента B2C), остальные — B2B. Это вывод по имени, а не отметка: channelSource это говорит.
export function orderRef(o: OrderRow, explicit?: Channel | null): OrderRef {
  const name = String(o.client_name ?? '')
  const isInternal = isOwnRetail(canonicalClient(name))
  if (explicit && explicit !== 'unknown') return { orderId: o.id, channel: explicit, channelSource: 'explicit', isInternal }
  if (!name.trim()) return { orderId: o.id, channel: 'unknown', channelSource: 'missing', isInternal }
  return { orderId: o.id, channel: isInternal ? 'b2c' : 'b2b', channelSource: 'derived', isInternal }
}

export const sumLines = (lines: CostLine[]) => lines.reduce((a, l) => a + (l.value.amountGross ?? 0), 0)
