// Аудит дублей справочника: одно изделие заведено несколькими строками с разной
// себестоимостью → маржа считается по-разному в зависимости от того, какую строку
// выбрал менеджер. Отчёт даёт владельцу картину; СЛИЯНИЕ строк — его решение,
// здесь ничего не правится.
//
// Важная тонкость: настоящий дубль по «Тонированное (бронза/графит)» 4 мм — это
// строки с РАЗНОЙ категорией (зеркало 1000₽ vs тонированное 695₽). Поэтому ключ
// группировки — имя+толщина БЕЗ категории (категория попала бы дубли в разные
// корзины и спрятала бы именно денежные расхождения). Категорию показываем как
// признак расхождения внутри группы.

export type MaterialRow = {
  id: number
  name: string
  category: string | null
  thickness: number
  cost_price: number
  waste_percent: number | null
  active: boolean
  uses: number          // сколько раз выбран в последних просчётах (по materialId)
}

export type ServiceRow = {
  id: number
  name: string
  type: string | null
  cost_price: number | null
  active: boolean
  uses: number
}

export type DupeVariant<T> = { row: T; uses: number }

export type DupeGroup<T> = {
  key: string
  label: string
  variants: DupeVariant<T>[]
  activeCount: number
  minCost: number
  maxCost: number
  costDeltaRub: number
  costDeltaPct: number      // относительно меньшей цены
  totalUses: number
  priceOfQuestion: number   // расхождение ₽ × суммарное использование — «цена вопроса»
  categoriesDiffer?: boolean
  costConflict: boolean     // ≥2 активных строки с разной себестоимостью — то, что реально жжёт
}

// Нормализация имени: регистр, схлопнутые пробелы, убранные хвостовые пробелы.
// Намеренно консервативна — не отрезаем префиксы вроде «Зеркало », чтобы не
// склеить разные материалы. Лучше пропустить слабый дубль, чем выдумать ложный.
export function normalizeName(name: string): string {
  return String(name ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

const r0 = (n: number) => Math.round(n)

function buildGroups<T extends { id: number; cost_price: number | null; active: boolean; uses: number }>(
  rows: T[],
  keyOf: (r: T) => string,
  labelOf: (r: T) => string,
  categoryOf?: (r: T) => string | null,
): DupeGroup<T>[] {
  const byKey = new Map<string, T[]>()
  for (const r of rows) {
    const k = keyOf(r)
    const arr = byKey.get(k) ?? []
    arr.push(r)
    byKey.set(k, arr)
  }

  const groups: DupeGroup<T>[] = []
  for (const [key, list] of byKey) {
    if (list.length < 2) continue
    const costs = list.map(r => Number(r.cost_price) || 0)
    const withCost = costs.filter(c => c > 0)
    const minCost = withCost.length ? Math.min(...withCost) : 0
    const maxCost = withCost.length ? Math.max(...withCost) : 0
    const costDeltaRub = r0(maxCost - minCost)
    const costDeltaPct = minCost > 0 ? Math.round((maxCost / minCost - 1) * 100) : 0
    const totalUses = list.reduce((s, r) => s + (Number(r.uses) || 0), 0)
    const activeRows = list.filter(r => r.active)
    const activeCosts = new Set(activeRows.map(r => Number(r.cost_price) || 0))
    const costConflict = activeRows.length >= 2 && activeCosts.size >= 2

    let categoriesDiffer: boolean | undefined
    if (categoryOf) {
      categoriesDiffer = new Set(list.map(r => categoryOf(r) ?? '')).size > 1
    }

    groups.push({
      key,
      label: labelOf(list[0]),
      variants: list
        .slice()
        .sort((a, b) => (b.uses - a.uses) || (a.id - b.id))
        .map(r => ({ row: r, uses: Number(r.uses) || 0 })),
      activeCount: activeRows.length,
      minCost, maxCost, costDeltaRub, costDeltaPct, totalUses,
      priceOfQuestion: costDeltaRub * totalUses,
      categoriesDiffer,
      costConflict,
    })
  }

  // Сортировка по «цене вопроса»; конфликт активных строк всегда выше «спящих» дублей.
  return groups.sort((a, b) => {
    if (a.costConflict !== b.costConflict) return a.costConflict ? -1 : 1
    if (b.priceOfQuestion !== a.priceOfQuestion) return b.priceOfQuestion - a.priceOfQuestion
    return b.costDeltaRub - a.costDeltaRub
  })
}

export function materialDupes(rows: MaterialRow[]): DupeGroup<MaterialRow>[] {
  return buildGroups(
    rows,
    r => `${normalizeName(r.name)}|${Number(r.thickness) || 0}`,
    r => `${r.name} · ${Number(r.thickness) || 0} мм`,
    r => r.category,
  )
}

export function serviceDupes(rows: ServiceRow[]): DupeGroup<ServiceRow>[] {
  return buildGroups(
    rows,
    r => `${normalizeName(r.name)}|${r.type ?? ''}`,
    r => `${r.name}${r.type ? ` · ${r.type}` : ''}`,
  )
}
