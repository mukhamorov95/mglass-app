import { isRemnant } from '../cuttingOptimizer'

// Остатки листа (Э6.3): что можно записать на стеллаж и сколько там лежит.
// Порог — из cutting_settings (решение владельца 15.09: 400×800 мм). Чистая логика.

export const REMNANT_MIN = { short: 400, long: 800 }

export type Thresholds = { min_remnant_short?: number | null; min_remnant_long?: number | null }
export type RemnantDraft = { w: number; h: number; location?: string | null }

const th = (t?: Thresholds) => ({
  min_remnant_short: t?.min_remnant_short ?? REMNANT_MIN.short,
  min_remnant_long: t?.min_remnant_long ?? REMNANT_MIN.long,
})

export function thresholdLabel(t?: Thresholds): string {
  const x = th(t)
  return `${x.min_remnant_short}×${x.min_remnant_long}`
}

// Одна строка ввода мастера → ошибка простыми словами или null.
export function remnantError(d: RemnantDraft, sheet: { w: number; h: number }, t?: Thresholds): string | null {
  const w = Math.round(Number(d.w)), h = Math.round(Number(d.h))
  if (!(w > 0) || !(h > 0)) return 'укажите ширину и высоту в мм'
  const s = Math.min(w, h), l = Math.max(w, h)
  if (s > Math.min(sheet.w, sheet.h) || l > Math.max(sheet.w, sheet.h)) return `кусок ${w}×${h} больше листа ${sheet.w}×${sheet.h}`
  if (!isRemnant(w, h, th(t))) return `${w}×${h} меньше ${thresholdLabel(t)} — это полоса, в отход`
  return null
}

export function checkRemnants(list: RemnantDraft[], sheet: { w: number; h: number }, t?: Thresholds): { ok: RemnantDraft[]; errors: string[] } {
  const ok: RemnantDraft[] = [], errors: string[] = []
  for (const d of list) {
    const e = remnantError(d, sheet, t)
    if (e) errors.push(e)
    else ok.push({ w: Math.round(Number(d.w)), h: Math.round(Number(d.h)), location: d.location?.trim() || null })
  }
  return { ok, errors }
}

export const remnantM2 = (w: number, h: number) => Math.round(w * h / 1e4) / 100

export type StockRow = { material_name: string; thickness: number | string; width_mm: number; height_mm: number; status: string }

// Сколько лежит на стеллаже по материалу — сверху самое объёмное.
export function stockSummary(rows: StockRow[]): { key: string; material: string; thickness: number; count: number; m2: number }[] {
  const m = new Map<string, { key: string; material: string; thickness: number; count: number; m2: number }>()
  for (const r of rows) {
    if (r.status !== 'in_stock') continue
    const thk = Number(r.thickness)
    const key = `${r.material_name}|${thk}`
    const a = m.get(key) ?? { key, material: r.material_name, thickness: thk, count: 0, m2: 0 }
    a.count++
    a.m2 = Math.round((a.m2 + r.width_mm * r.height_mm / 1e6) * 100) / 100
    m.set(key, a)
  }
  return [...m.values()].sort((a, b) => b.m2 - a.m2)
}
