import { isProductItem, itemParts, itemsOf, type OrderRow, type StoredItem } from '../facts/items'
import { bomOperation, serviceOperation } from '../facts/operations'
import { NORM_OPS, type NormOp } from '../standards/norms'

// Объём работ по сохранённым позициям: детали, объём операции и ключ технологической партии.
// Партия считается по совместимости (материал, толщина, набор диаметров), а не по одинаковости
// изделий. Чего в позиции нет — попадает в пробелы, а не подставляется.
export type Work = { orderId: number; item: number; op: NormOp; parts: number; units: number; batchKey: string }
export type Gap = { orderId: number; item: number; what: string }

// Средняя площадь закупаемого листа (база знаний, «история и модель»): мера закупочной работы.
export const SHEET_M2 = 7.22

const num = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0)
const arr = (x: unknown) => (Array.isArray(x) ? x as Record<string, unknown>[] : [])
const isNormOp = (op: string): op is NormOp => (NORM_OPS as readonly string[]).includes(op)

export function itemWork(orderId: number, index: number, it: StoredItem): { work: Work[]; gaps: Gap[] } {
  const work: Work[] = [], gaps: Gap[] = []
  const add = (op: NormOp, parts: number, units: number, batchKey: string) => work.push({ orderId, item: index, op, parts, units, batchKey })
  const gap = (what: string) => gaps.push({ orderId, item: index, what })
  const q = num(it.quantity), w = num(it.width), h = num(it.height)
  const perimeter = w > 0 && h > 0 ? 2 * (w + h) / 1000 : 0
  const areaM2 = num(it.totalAreaNet) || w * h / 1_000_000 * q
  if (!(q > 0)) { gap('нет количества'); return { work, gaps } }

  if (isProductItem(it)) {
    const glass = `изделие:${String(it.materialName ?? '')}`
    if (perimeter) {
      add('cutting', q, perimeter * q, glass)
      add('edge', q, perimeter * q, glass)
    } else gap('изделие без размеров: резка и кромка не посчитаны')
    const bomOps = new Set(arr(it.bom).map(b => bomOperation(String(b.name ?? ''))))
    // Раскрой металла делает подрядчик: своих часов на него нет.
    for (const op of ['assembly', 'frame_welding', 'sandblast'] as const) {
      if (bomOps.has(op)) add(op, q, op === 'sandblast' ? areaM2 : q, glass)
    }
    add('packaging', q, areaM2, 'изделие')
    const glassM2 = arr(it.bom).filter(b => /м²|m2/i.test(String(b.unit)) && bomOperation(String(b.name ?? '')) === 'material').reduce((a, b) => a + num(b.qty), 0)
    if (glassM2) add('purchasing', 0, glassM2 / SHEET_M2, 'листы')
  } else {
    if (!perimeter) gap('нет размеров')
    const curved = it.shape === 'curved'
    for (const p of itemParts(orderId, index, it)) {
      const thk = p.thicknessMm ?? '?'
      add('cutting', q, perimeter * q, `${p.materialId ?? '?'}:${thk}`)
      if (curved) add('curved', q, perimeter * q, `${thk}`)
      else if (num(it.costEdge) > 0) add('edge', q, perimeter * q, `${thk}`)
      const holes = p.holes.reduce((a, x) => a + (x.qty ?? 0), 0)
      if (holes) add('drilling', q, holes * q, `${thk}:${p.holes.map(x => x.diameterMm ?? '?').sort().join('+')}`)
      else if (it.hasHoles) gap('отверстия без количества')
      if (p.cutouts.length) {
        if (p.cutouts.some(c => c.qty == null)) gap('вырезы без количества')
        const cuts = p.cutouts.reduce((a, x) => a + (x.qty ?? 0), 0)
        if (cuts) add('cutout', q, cuts * q, `${thk}`)
      }
      if (num(it.costTempering) > 0) add('transport', q, 0, `${thk}`)
    }
    add('packaging', q, areaM2, 'стекло')
    const billedM2 = (num(it.totalAreaBilled) || areaM2) * (it.hasTriplex ? (num(it.triplexLayers) === 3 ? 3 : 2) : 1)
    if (billedM2) add('purchasing', 0, billedM2 / SHEET_M2, 'листы')
  }

  for (const s of arr(it.services)) {
    const op = serviceOperation(String(s.name ?? ''))
    if (!isNormOp(op) || op === 'drilling' || op === 'cutout' || op === 'curved') continue
    if (work.some(x => x.op === op)) continue
    if (op === 'design') add(op, 0, 1, `позиция:${orderId}:${index}`)
    else add(op, q, areaM2, `позиция:${orderId}:${index}`)
  }
  return { work, gaps }
}

export function orderWork(order: OrderRow) {
  const all = itemsOf(order).map((it, i) => itemWork(order.id, i, it))
  return { work: all.flatMap(x => x.work), gaps: all.flatMap(x => x.gaps) }
}

export const batches = (work: Work[]) => {
  const out = new Map<string, { op: NormOp; parts: number; units: number }>()
  for (const w of work) {
    const key = `${w.op}|${w.batchKey}`
    const b = out.get(key) ?? { op: w.op, parts: 0, units: 0 }
    out.set(key, { op: w.op, parts: b.parts + w.parts, units: b.units + w.units })
  }
  return [...out.values()]
}
