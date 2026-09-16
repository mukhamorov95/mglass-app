// Факт расхода по заказу — из журнала листов, который заполняет резчик после нарезки
// (решение владельца 16.09.2026: расход по раскрою не считаем, считаем по факту).
//
// Отход листа = площадь листа − детали заказов на этом листе − остатки, которые ушли
// на стеллаж. Если лист резали под несколько заказов, отход на один заказ не делим:
// показываем лист как общий — делить нечем, пока детали не отмечены по листу.

export type CutRow = {
  id: number
  material_name: string
  thickness: number | string
  source: string
  sheet_w: number
  sheet_h: number
  order_ids: number[] | null
  created_by_name: string | null
  created_at: string
}

export type CutRemnant = { from_cut_id: number; code: string; width_mm: number; height_mm: number; status: string }

export type CutFactRow = {
  cutId: number
  material: string
  sheetLabel: string
  sheetM2: number
  remnantM2: number
  remnantCodes: string[]
  fromRemnant: boolean
  sharedWith: number[]
  wasteM2: number | null   // null — лист общий, отход на заказ не делим
  wastePct: number | null
}

const m2 = (w: number, h: number) => Math.round(w * h / 1e4) / 100

export function orderCutFacts(cuts: CutRow[], remnants: CutRemnant[], orderId: number, netM2: number): {
  rows: CutFactRow[]
  sheetM2: number
  remnantM2: number
  wasteM2: number | null
  wastePct: number | null
} {
  const byCut = new Map<number, CutRemnant[]>()
  for (const r of remnants) {
    const a = byCut.get(r.from_cut_id) ?? []
    a.push(r); byCut.set(r.from_cut_id, a)
  }

  const rows: CutFactRow[] = []
  let sheetM2 = 0, remnantM2 = 0, sharedAny = false
  const solo = cuts.filter(c => (c.order_ids ?? []).length <= 1)
  const soloNet = solo.length ? netM2 : 0

  for (const c of cuts) {
    const rem = byCut.get(c.id) ?? []
    const remM2 = rem.reduce((s, r) => s + m2(r.width_mm, r.height_mm), 0)
    const sM2 = m2(c.sheet_w, c.sheet_h)
    const shared = (c.order_ids ?? []).filter(x => x !== orderId)
    const isShared = (c.order_ids ?? []).length > 1
    if (isShared) sharedAny = true
    sheetM2 += sM2
    remnantM2 += remM2
    rows.push({
      cutId: c.id,
      material: `${c.material_name} ${Number(c.thickness)} мм`,
      sheetLabel: `${c.sheet_w}×${c.sheet_h}`,
      sheetM2: Math.round(sM2 * 100) / 100,
      remnantM2: Math.round(remM2 * 100) / 100,
      remnantCodes: rem.filter(r => r.status !== 'scrapped').map(r => r.code),
      fromRemnant: c.source === 'remnant',
      sharedWith: shared,
      wasteM2: null,
      wastePct: null,
    })
  }

  // Отход считаем только по листам, которые резали под один этот заказ.
  const soloSheetM2 = solo.reduce((s, c) => s + m2(c.sheet_w, c.sheet_h), 0)
  const soloRemnantM2 = solo.reduce((s, c) => s + (byCut.get(c.id) ?? []).reduce((a, r) => a + m2(r.width_mm, r.height_mm), 0), 0)
  const waste = solo.length && !sharedAny ? Math.round((soloSheetM2 - soloNet - soloRemnantM2) * 100) / 100 : null
  for (const r of rows) {
    if (waste == null || r.sharedWith.length) continue
    const w = Math.round((r.sheetM2 - r.remnantM2 - (solo.length === 1 ? soloNet : 0)) * 100) / 100
    r.wasteM2 = solo.length === 1 ? w : null
    r.wastePct = solo.length === 1 && soloNet > 0 ? Math.round(w / soloNet * 1000) / 10 : null
  }

  return {
    rows,
    sheetM2: Math.round(sheetM2 * 100) / 100,
    remnantM2: Math.round(remnantM2 * 100) / 100,
    wasteM2: waste,
    wastePct: waste != null && soloNet > 0 ? Math.round(waste / soloNet * 1000) / 10 : null,
  }
}
