// Фильтры списка B2B-просчётов (просьба владельца 13.10): «кто просчитал» и «откуда пришёл».
// Откуда — сначала из самого просчёта (просчёт без заказчика, lead_source), иначе из карточки
// заказчика (b2b_clients.crm_source): Авито-просчёт после «заказываю» остаётся Авито.

import { readQuoteLead } from '@/lib/b2b/leadQuote'
import { B2B_SOURCES } from '@/lib/types'

type QuoteLike = { notes: string | null; created_by_name?: string | null; client_id?: number | null }

const parse = (notes: string | null): Record<string, unknown> => {
  if (!notes) return {}
  try { const p = JSON.parse(notes); return p && typeof p === 'object' ? p : {} } catch { return {} }
}

// Тот же автор, что в строке «Просчитал: …».
export function quoteAuthor(q: QuoteLike): string | null {
  const n = q.created_by_name?.trim() || parse(q.notes).manager_name
  return typeof n === 'string' && n.trim() ? n.trim() : null
}

export function quoteSource(q: QuoteLike, clientSource: Map<number, string>): string | null {
  return readQuoteLead(parse(q.notes)).source ?? (q.client_id != null ? clientSource.get(q.client_id) ?? null : null)
}

export type QuoteFilter = { by: string | null; src: string | null }

export const matchesFilter = (q: QuoteLike, f: QuoteFilter, clientSource: Map<number, string>) =>
  (!f.by || quoteAuthor(q) === f.by) && (!f.src || quoteSource(q, clientSource) === f.src)

// Кнопки фильтра с числом «сколько увидишь, если нажмёшь»: каждая ось считается по списку,
// уже отфильтрованному другой осью. Авито — первым среди источников, остальные по убыванию.
export function filterFacets(list: QuoteLike[], f: QuoteFilter, clientSource: Map<number, string>) {
  const authors = new Map<string, number>()
  const sources = new Map<string, number>()
  for (const q of list) {
    const a = quoteAuthor(q), s = quoteSource(q, clientSource)
    if (a && (!f.src || s === f.src)) authors.set(a, (authors.get(a) ?? 0) + 1)
    if (s && (!f.by || a === f.by)) sources.set(s, (sources.get(s) ?? 0) + 1)
  }
  // Выбранное остаётся кнопкой и при нуле в этой вкладке — иначе его нечем снять.
  if (f.by && !authors.has(f.by)) authors.set(f.by, 0)
  if (f.src && !sources.has(f.src)) sources.set(f.src, 0)
  const rank = (v: string) => (v === 'avito' ? -1 : B2B_SOURCES.findIndex(x => x.value === v))
  return {
    authors: [...authors].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'ru')),
    sources: [...sources].sort((x, y) => rank(x[0]) - rank(y[0]) || y[1] - x[1]),
  }
}

// Выбор живёт в адресе: переживает обновление страницы, ссылку можно переслать.
export function readFilterFromUrl(search: string): QuoteFilter {
  const p = new URLSearchParams(search)
  return { by: p.get('by') || null, src: p.get('src') || null }
}

export function filterToSearch(search: string, f: QuoteFilter): string {
  const p = new URLSearchParams(search)
  for (const k of ['by', 'src'] as const) { if (f[k]) p.set(k, f[k]!); else p.delete(k) }
  const s = p.toString()
  return s ? `?${s}` : ''
}
