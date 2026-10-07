// Чтение растущих таблиц мимо потолка PostgREST: он отдаёт не больше 1000 строк за
// запрос, и `.limit(5000)` этого не меняет. Страницы по 1000 с сортировкой по
// уникальной колонке + списки id пачками по 500 (длинный .in() не влезает в URL).
// Тот же приём, что в app/api/b2b-orders/payments/route.ts (#914).

export const PAGE = 1000
export const CHUNK = 500

export type Row = Record<string, unknown>
export type Paged = {
  range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
}

export function chunk<T>(arr: T[], size: number = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// build() должен сортировать по уникальной колонке, иначе страницы range() перекрываются.
export async function readPaged(build: () => Paged): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as Row[]))
    if ((data?.length ?? 0) < PAGE) return rows
  }
}

export async function readIn<K>(ids: K[], build: (part: K[]) => Paged): Promise<Row[]> {
  if (ids.length === 0) return []
  const parts = await Promise.all(chunk(ids).map(part => readPaged(() => build(part))))
  return parts.flat()
}

export const num = (v: unknown) => Number(v) || 0
