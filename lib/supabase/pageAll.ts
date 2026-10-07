// PostgREST отдаёт не больше 1000 строк за запрос, и .limit(5000) / .range(0, 4999) этот потолок
// не поднимают — ответ молча обрезается. Всё, что читается «целиком» (сумма, счётчик, сверка,
// дедупликация), читать через эти помощники.

export type PageResult<T> = { data: T[] | null; error: { message: string } | null }

export const PAGE_SIZE = 1000
export const MAX_ROWS = 200_000

// build(from, to) обязан сортировать по уникальному ключу (.order('id'); по дате — вторым ключом id), иначе страницы перекрываются и теряют строки.
export async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<T[]> {
  const pageSize = opts.pageSize ?? PAGE_SIZE
  const maxRows = opts.maxRows ?? MAX_ROWS
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) return rows
    if (rows.length >= maxRows) {
      throw new Error(`pageAll: прочитано ${rows.length} строк — больше стоп-крана ${maxRows}; сузьте выборку`)
    }
  }
}

// Для экранов, где ошибку блока показывают рядом, а не роняют весь экран: данные или
// пусто + ошибка, но никогда не «первая тысяча» под видом всего.
export async function pageAllOrError<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts?: { pageSize?: number; maxRows?: number },
): Promise<{ data: T[]; error: { message: string } | null }> {
  try {
    return { data: await pageAll(build, opts), error: null }
  } catch (e) {
    return { data: [], error: { message: e instanceof Error ? e.message : String(e) } }
  }
}

// Длинный .in() не влезает в URL запроса; пачки идут последовательно, чтобы не душить базу.
export async function inChunks<T, R>(ids: T[], size: number, fn: (part: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))))
  return out
}
