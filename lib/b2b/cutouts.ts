import type { B2BService } from '../types'

// Вырезы в стекле (владелец 25.11.2026): внешний или внутренний, I или II категории.
// Цена за штуку — строка справочника b2b_services с кодом cutout_*; себестоимость и
// продажу ставит Вера на /admin/cutouts. Не задана цена — позиция не добавляется.

export type CutoutKind = 'outer' | 'inner'
export type CutoutCat = 1 | 2
export type CutoutGroup = { kind: CutoutKind; cat: CutoutCat; n: number }

export const CUTOUT_TYPES: { code: string; kind: CutoutKind; cat: CutoutCat; label: string }[] = [
  { code: 'cutout_outer_1', kind: 'outer', cat: 1, label: 'Вырез внешний I кат.' },
  { code: 'cutout_outer_2', kind: 'outer', cat: 2, label: 'Вырез внешний II кат.' },
  { code: 'cutout_inner_1', kind: 'inner', cat: 1, label: 'Вырез внутренний I кат.' },
  { code: 'cutout_inner_2', kind: 'inner', cat: 2, label: 'Вырез внутренний II кат.' },
]

export const cutoutCode = (g: Pick<CutoutGroup, 'kind' | 'cat'>) => `cutout_${g.kind}_${g.cat}`
export const cutoutLabel = (g: Pick<CutoutGroup, 'kind' | 'cat'>) =>
  CUTOUT_TYPES.find(t => t.code === cutoutCode(g))?.label ?? 'Вырез'

type CodedService = B2BService & { code?: string | null }

export const isCutoutService = (s: { code?: string | null; name?: string | null }) =>
  (s.code ?? '').startsWith('cutout_') || /^вырез (внешний|внутренний)/i.test(s.name ?? '')

// Одинаковые вид+категория складываются, пустые и мусор отбрасываются.
export function normalizeCutouts(raw: unknown): CutoutGroup[] {
  const acc = new Map<string, CutoutGroup>()
  for (const x of Array.isArray(raw) ? raw : []) {
    const o = x as Partial<CutoutGroup>
    const kind: CutoutKind | null = o?.kind === 'outer' || o?.kind === 'inner' ? o.kind : null
    const cat: CutoutCat | null = Number(o?.cat) === 1 ? 1 : Number(o?.cat) === 2 ? 2 : null
    const n = Math.round(Number(o?.n) || 0)
    if (!kind || !cat || n <= 0) continue
    const key = cutoutCode({ kind, cat })
    const cur = acc.get(key)
    acc.set(key, { kind, cat, n: (cur?.n ?? 0) + n })
  }
  return CUTOUT_TYPES.map(t => acc.get(t.code)).filter((g): g is CutoutGroup => !!g)
}

export const cutoutTotal = (groups: CutoutGroup[]) => groups.reduce((s, g) => s + g.n, 0)

export const cutoutRow = (rows: CodedService[], g: Pick<CutoutGroup, 'kind' | 'cat'>) =>
  rows.find(r => r.code === cutoutCode(g) && r.active !== false)

// Что мешает посчитать вырезы: нет строки или продажная цена не задана.
export function cutoutProblems(groups: CutoutGroup[], rows: CodedService[]): string[] {
  const out: string[] = []
  for (const g of groups) {
    const r = cutoutRow(rows, g)
    if (!r) out.push(`${cutoutLabel(g)}: нет в справочнике`)
    else if (!(Number(r.value) > 0)) out.push(`${cutoutLabel(g)}: не задана цена`)
  }
  return out
}

// Услуги позиции за вырезы: цена за штуку × вырезов на деталь; на число деталей
// умножает движок (fixed = value × quantity).
export function cutoutServices(groups: CutoutGroup[], rows: CodedService[]): B2BService[] {
  const out: B2BService[] = []
  for (const g of groups) {
    const r = cutoutRow(rows, g)
    if (!r) continue
    out.push({
      ...r,
      type: 'fixed',
      name: `${cutoutLabel(g)} × ${g.n}`,
      value: (Number(r.value) || 0) * g.n,
      cost_price: (Number(r.cost_price) || 0) * g.n,
    })
  }
  return out
}
