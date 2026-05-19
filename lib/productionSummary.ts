export const TEMPERING_RATES: Record<number, number> = {
  4: 300, 5: 350, 6: 400, 8: 500, 10: 600, 12: 950,
}

export type ProductionRow = {
  matKey: string
  matLabel: string
  sheetW: number
  sheetH: number
  sheetsNeeded: number
  totalAreaNet: number
  sheetCost: number
  temperingCost: number
  totalCost: number
}

export type ProductionSummary = {
  rows: ProductionRow[]
  totalAreaNet: number
  totalAreaBilled: number
  totalSheets: number
  totalSheetCost: number
  totalTemperingCost: number
  grandTotal: number
}

export type SummaryItem = {
  materialName?: string | null
  thickness?: number | null
  totalAreaNet?: number | null
  totalAreaBilled?: number | null
  hasTempering?: boolean | null
  wastePercent?: number | null
}

export type MatLight = {
  name: string
  thickness: number
  sheet_width?: number | null
  sheet_height?: number | null
  cost_price?: number | null
  waste_percent?: number | null
}

export function computeProductionSummary(
  items: SummaryItem[],
  materials: MatLight[],
  sheetsOverride?: Map<string, number>, // matKey → sheetsNeeded from cutting optimizer
): ProductionSummary {
  const matLookup = new Map(materials.map(m => [`${m.name}|${m.thickness}`, m]))

  type Group = {
    matLabel: string
    sheetW: number
    sheetH: number
    costPrice: number
    totalAreaNet: number
    totalBilled: number
    temperingArea: number
    thickness: number
  }

  const groups = new Map<string, Group>()
  let sumNet = 0
  let sumBilled = 0

  for (const item of items) {
    const name = item.materialName ?? ''
    const t = item.thickness ?? 0
    if (!name || !t) continue
    const key = `${name}|${t}`
    const mat = matLookup.get(key)
    if (!groups.has(key)) {
      groups.set(key, {
        matLabel: `${name} ${t} мм`,
        sheetW: mat?.sheet_width ?? 3210,
        sheetH: mat?.sheet_height ?? 2250,
        costPrice: mat?.cost_price ?? 0,
        totalAreaNet: 0,
        totalBilled: 0,
        temperingArea: 0,
        thickness: t,
      })
    }
    const g = groups.get(key)!
    const areaNet = item.totalAreaNet ?? 0
    const waste = item.wastePercent ?? mat?.waste_percent ?? 15
    const billed = item.totalAreaBilled ?? areaNet * (1 + waste / 100)
    g.totalAreaNet += areaNet
    g.totalBilled += billed
    sumNet += areaNet
    sumBilled += billed
    if (item.hasTempering) g.temperingArea += areaNet
  }

  const rows: ProductionRow[] = []
  let totalSheets = 0

  for (const [key, g] of groups) {
    const sheetAreaM2 = g.sheetW * g.sheetH / 1_000_000
    const sheetsNeeded = sheetsOverride?.get(key) ?? Math.ceil(g.totalBilled / sheetAreaM2)
    const sheetCost = Math.round(sheetsNeeded * sheetAreaM2 * g.costPrice)
    const temperingCost = Math.round(g.temperingArea * (TEMPERING_RATES[g.thickness] ?? 0))
    totalSheets += sheetsNeeded
    rows.push({
      matKey: key,
      matLabel: g.matLabel,
      sheetW: g.sheetW,
      sheetH: g.sheetH,
      sheetsNeeded,
      totalAreaNet: g.totalAreaNet,
      sheetCost,
      temperingCost,
      totalCost: sheetCost + temperingCost,
    })
  }

  const totalSheetCost = rows.reduce((s, r) => s + r.sheetCost, 0)
  const totalTemperingCost = rows.reduce((s, r) => s + r.temperingCost, 0)

  return {
    rows,
    totalAreaNet: sumNet,
    totalAreaBilled: sumBilled,
    totalSheets,
    totalSheetCost,
    totalTemperingCost,
    grandTotal: totalSheetCost + totalTemperingCost,
  }
}
