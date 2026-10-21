// Порядок материалов справочника стекла и зеркала (glass_price_matrix.sort_order) — один
// на категорию, его задаёт владелец по популярности (21.10). Источник — строка
// себестоимости: у продажных строк порядок исторически расходился (у двух стоял 0, и они
// всплывали наверх). Калькулятор B2B показывает материалы в этом же порядке.

export type MatrixCategory = 'glass' | 'mirror'
type OrderRow = { name: string; category: string | null; price_type: string; sort_order: number | null }

const catOf = (r: OrderRow): string => r.category ?? 'glass'

// Место материала: строка себестоимости, без неё — продажная.
export function rankMap(rows: OrderRow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) {
    const key = `${catOf(r)}|${r.name}`
    if (r.price_type === 'cost' || !out.has(key)) out.set(key, r.sort_order ?? Number.MAX_SAFE_INTEGER)
  }
  return out
}

export function orderedNames(rows: OrderRow[], category: MatrixCategory): string[] {
  const rank = rankMap(rows)
  const names = [...new Set(rows.filter(r => catOf(r) === category).map(r => r.name))]
  return names.sort((a, b) => {
    const ra = rank.get(`${category}|${a}`)!, rb = rank.get(`${category}|${b}`)!
    return ra !== rb ? ra - rb : a.localeCompare(b, 'ru')
  })
}

// Черновик порядка поверх базы: удалённые выпадают, новые встают в конец.
export function applyDraft(base: string[], draft: string[] | undefined): string[] {
  if (!draft) return base
  return [...draft.filter(n => base.includes(n)), ...base.filter(n => !draft.includes(n))]
}

export function moveName(order: string[], name: string, delta: -1 | 1): string[] {
  const i = order.indexOf(name), j = i + delta
  if (i < 0 || j < 0 || j >= order.length) return order
  const next = [...order]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

export function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((n, i) => n === b[i])
}

// Материалы калькулятора: по месту в справочнике, не найденные в нём — в конце по алфавиту.
export function sortByDirectory<T extends { name: string; sort_rank?: number }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    const ra = a.sort_rank ?? Number.MAX_SAFE_INTEGER, rb = b.sort_rank ?? Number.MAX_SAFE_INTEGER
    return ra !== rb ? ra - rb : a.name.localeCompare(b.name, 'ru')
  })
}
