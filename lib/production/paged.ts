// PostgREST отдаёт не больше 1000 строк за запрос — молча: ответ выглядит нормальным,
// просто короче. `.limit(5000)` потолок не поднимает. Поэтому всё, что может перерасти
// тысячу (задачи цеха — 6600+, открытых 1380; заказы B2B — 3400), читаем страницами,
// а длинные списки id — пачками по 500, чтобы не упереться ещё и в длину адреса.
//
// Без серверных импортов: этим пользуются и экраны цеха, и маршруты API.

export const PAGE = 1000
export const IN_CHUNK = 500

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

// page(from, to) должен сортировать по уникальной колонке (обычно id) — иначе
// соседние страницы перекрываются и строки двоятся или теряются.
export async function readPaged<T>(page: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

export function chunks<T>(arr: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// Пачки id × страницы внутри каждой пачки: на 500 заказов задач легко больше тысячи.
export async function readIn<T, K>(
  ids: K[],
  page: (part: K[], from: number, to: number) => PageResult<T>,
): Promise<T[]> {
  if (ids.length === 0) return []
  const parts = await Promise.all(chunks(ids).map(part => readPaged<T>((from, to) => page(part, from, to))))
  return parts.flat()
}

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
