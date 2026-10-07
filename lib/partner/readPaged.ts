// PostgREST отдаёт не больше 1000 строк за запрос, и .limit(3000) этого не меняет —
// хвост теряется молча. Читаем страницами до короткой.

export type Paged = { range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> }

export const PAGE = 1000

// build() обязан сортировать по уникальному ключу, иначе страницы перекрываются.
export async function readPaged<T>(build: () => Paged, page = PAGE): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await build().range(from, from + page - 1)
    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as T[]))
    if ((data?.length ?? 0) < page) return rows
  }
}

export function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
