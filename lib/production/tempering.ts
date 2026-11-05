// Закалка (владелец 05.11.2026): что едет на закалку, сколько вернулось, сколько разбито.
// Здесь только расчёт, запись — в API-маршруте. Триплекс: каждое стекло пакета едет своей строкой.
import { itemNeedsTempering } from '@/lib/productionStages'
import { shareOf, shipLines, type ShipOrder } from '@/lib/production/clientShipments'

type Glass = { materialName?: string; thickness?: number }
type TemperItem = Glass & {
  category?: string; hasTempering?: boolean; hasTriplex?: boolean; triplexLayers?: number; triplexGlasses?: Glass[]
  width?: number; height?: number; areaPiece?: number
}

export type TemperLine = {
  key: string; layer: number; index: number; material: string; thickness: number | null
  width: number | null; height: number | null; qty: number; area: number; weight: number; amount: number
}

const round2 = (n: number) => Math.round(n * 100) / 100
const round3 = (n: number) => Math.round(n * 1000) / 1000

export function temperLines(order: ShipOrder): TemperLine[] {
  const items = (Array.isArray(order.items) ? order.items : []) as TemperItem[]
  const base = shipLines(order)
  return items.flatMap((it, i) => {
    if (!itemNeedsTempering(it)) return []
    const l = base[i]
    const width = Number(it.width) || null
    const height = Number(it.height) || null
    const areaPiece = width && height ? width * height / 1e6 : Number(it.areaPiece) || 0
    const count = it.triplexLayers === 3 ? 3 : 2
    const glasses: Glass[] = it.hasTriplex
      ? Array.from({ length: count }, (_, g) => (g === 0 ? it : it.triplexGlasses?.[g - 1] ?? it))
      : [it]
    return glasses.map((g, gi) => {
      const thickness = Number(g.thickness) || null
      return {
        key: l.key, layer: gi + 1, index: i, material: g.materialName?.trim() || 'Материал не указан', thickness, width, height,
        qty: l.qty, area: round3(areaPiece * l.qty),
        weight: it.hasTriplex ? round2(areaPiece * l.qty * (thickness ?? 0) * 2.5) : l.weight,
        amount: round2(l.amount / glasses.length),
      }
    })
  })
}

export const temperKey = (orderId: number, lineKey: string, layer: number) => `${orderId}:${lineKey}:${layer}`

export type TemperRates = { temperingPerM2: Record<number, number>; transportPerPiece: number }

// Снимок доли строки. Ставки нет — стоимость не ноль, а неизвестна: итог называет такие строки.
export function temperSnapshot(line: TemperLine, take: number, rates: TemperRates, from = 0) {
  const rate = line.thickness ? rates.temperingPerM2[line.thickness] ?? null : null
  const area = round3(line.area * take / line.qty)
  return {
    area_m2: area,
    weight_kg: shareOf(line.weight, line.qty, from, take),
    amount: shareOf(line.amount, line.qty, from, take),
    rate_per_m2: rate,
    cost: rate == null ? null : round2(area * rate),
    transport: round2(rates.transportPerPiece * take),
  }
}

export type TemperRow = {
  id: number; batch_id: number; order_id: number; line_key: string; layer: number; item_index: number; qty: number
  order_no: string; material: string; thickness: number | null; width: number | null; height: number | null
  area_m2: number; weight_kg: number; rate_per_m2: number | null; cost: number | null; transport: number; amount: number
  returned_qty: number; broken_qty: number; received_at: string | null; received_by_name: string | null
}

export const rowOutstanding = (r: Pick<TemperRow, 'qty' | 'returned_qty' | 'broken_qty'>) => Math.max(0, r.qty - r.returned_qty - r.broken_qty)

export type TemperTaken = { drafted: number; away: number; returned: number; broken: number }
type TakenRow = Pick<TemperRow, 'batch_id' | 'order_id' | 'line_key' | 'layer' | 'qty' | 'returned_qty' | 'broken_qty'>

export function temperTaken(rows: TakenRow[], statusOf: (batchId: number) => string | undefined, exceptBatch?: number) {
  const out = new Map<string, TemperTaken>()
  for (const r of rows) {
    if (r.batch_id === exceptBatch) continue
    const status = statusOf(r.batch_id)
    if (!status) continue
    const k = temperKey(r.order_id, r.line_key, r.layer)
    const cur = out.get(k) ?? { drafted: 0, away: 0, returned: 0, broken: 0 }
    if (status === 'sent') {
      cur.away += rowOutstanding(r)
      cur.returned += r.returned_qty
      cur.broken += r.broken_qty
    } else cur.drafted += r.qty
    out.set(k, cur)
  }
  return out
}

// Разбитая штука снова свободна: её сделают заново и отправят ещё раз.
export const temperFree = (qty: number, t: TemperTaken | undefined) => Math.max(0, qty - (t?.drafted ?? 0) - (t?.away ?? 0) - (t?.returned ?? 0))

export type TemperRequest = { order_id: number; line_key: string; layer: number; qty: number }

export function temperRequestProblem(req: TemperRequest, line: Pick<TemperLine, 'qty' | 'material'> | undefined, taken: TemperTaken | undefined, already = 0): string | null {
  if (!line) return 'Строка не найдена или ей не нужна закалка. Обновите экран.'
  if (!Number.isInteger(req.qty) || req.qty <= 0) return `${line.material}: количество должно быть целым и больше нуля.`
  const free = temperFree(line.qty, taken) - already
  if (req.qty > free) return `${line.material}: можно отправить ${Math.max(0, free)} из ${line.qty} шт.`
  return null
}

export function receiveProblem(returned: number, broken: number, row: Pick<TemperRow, 'qty' | 'returned_qty' | 'broken_qty' | 'material'>): string | null {
  if (![returned, broken].every(n => Number.isInteger(n) && n >= 0)) return `${row.material}: количество должно быть целым.`
  const left = rowOutstanding(row)
  if (returned + broken > left) return `${row.material}: на закалке осталось ${left} шт., а указано ${returned + broken}.`
  return null
}

type TotalsRow = Pick<TemperRow, 'order_id' | 'qty' | 'area_m2' | 'weight_kg' | 'cost' | 'transport' | 'amount' | 'returned_qty' | 'broken_qty'>
export function batchTotals(rows: TotalsRow[]) {
  return {
    orders: new Set(rows.map(r => r.order_id)).size,
    pieces: rows.reduce((s, r) => s + r.qty, 0),
    area: round2(rows.reduce((s, r) => s + Number(r.area_m2), 0)),
    weight: round2(rows.reduce((s, r) => s + Number(r.weight_kg), 0)),
    cost: round2(rows.reduce((s, r) => s + Number(r.cost ?? 0), 0)),
    noRate: rows.filter(r => r.cost == null).length,
    transport: round2(rows.reduce((s, r) => s + Number(r.transport), 0)),
    amount: round2(rows.reduce((s, r) => s + Number(r.amount), 0)),
    away: rows.reduce((s, r) => s + rowOutstanding(r), 0),
    returned: rows.reduce((s, r) => s + r.returned_qty, 0),
    broken: rows.reduce((s, r) => s + r.broken_qty, 0),
  }
}

// Основа ведомости для закалочной: материал, толщина, штуки, площадь.
export function materialSummary(rows: Pick<TemperRow, 'material' | 'thickness' | 'qty' | 'area_m2'>[]) {
  const map = new Map<string, { material: string; thickness: number | null; pieces: number; area: number }>()
  for (const r of rows) {
    const k = `${r.material}|${r.thickness ?? ''}`
    const cur = map.get(k) ?? { material: r.material, thickness: r.thickness, pieces: 0, area: 0 }
    cur.pieces += r.qty
    cur.area = round2(cur.area + Number(r.area_m2))
    map.set(k, cur)
  }
  return [...map.values()].sort((a, b) => a.material.localeCompare(b.material, 'ru') || (a.thickness ?? 0) - (b.thickness ?? 0))
}
