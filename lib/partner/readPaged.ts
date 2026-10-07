import { pageAll, type PageResult } from '@/lib/supabase/pageAll'

// Кабинет читает «целиком» через общий lib/supabase/pageAll (потолок PostgREST — 1000
// строк, .limit(3000) его не поднимает). Здесь — форма вызова для построителей запроса.

export type Paged = { range(from: number, to: number): PromiseLike<PageResult<unknown>> }

// build() обязан сортировать по уникальному ключу, иначе страницы перекрываются.
export function readPaged<T>(build: () => Paged): Promise<T[]> {
  return pageAll<T>((from, to) => build().range(from, to) as PromiseLike<PageResult<T>>)
}

export function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
