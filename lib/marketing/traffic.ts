import { channelOf, type AmoLeadLite, type ChannelKey } from './channels'

// Посещаемость сайтов по неделям «четверг — среда» (так владелец сравнивает недели).
// Визиты — из Метрики (API отчётов, последний значимый источник, без роботов),
// заявки — из amo тем же классификатором каналов, что и «Статистика».

export const SOURCES = [
  { key: 'yandex', label: 'Поиск Яндекс' },
  { key: 'google', label: 'Поиск Google' },
  { key: 'otherSearch', label: 'Другие поисковики' },
  { key: 'direct', label: 'Прямые заходы' },
  { key: 'referral', label: 'С других сайтов' },
  { key: 'social', label: 'Соцсети и мессенджеры' },
  { key: 'ad', label: 'Реклама' },
  { key: 'other', label: 'Прочее' },
] as const

export type SourceKey = (typeof SOURCES)[number]['key']

export type Week = { from: string; to: string; partial: boolean }
export type WeekRow = Week & { visits: number; pageviews: number; leads: number } & Record<SourceKey, number>

const DAY = 86400000
const toDate = (s: string) => new Date(`${s}T00:00:00Z`)
const fmt = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (s: string, n: number) => fmt(new Date(toDate(s).getTime() + n * DAY))

export const todayMoscow = (now = Date.now()) => moscowDate(now)
export const moscowDate = (ms: number) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })

// Четверг, с которого начинается неделя, содержащая день s.
export function weekStart(s: string): string {
  const dow = toDate(s).getUTCDay() // 0 — воскресенье, 4 — четверг
  return addDays(s, -((dow - 4 + 7) % 7))
}

// n полных недель и текущая (неполная, если сегодня не среда) — от старой к новой.
export function buildWeeks(today: string, n: number): Week[] {
  const cur = weekStart(today)
  const weeks: Week[] = []
  for (let i = n; i >= 1; i--) {
    const from = addDays(cur, -7 * i)
    weeks.push({ from, to: addDays(from, 6), partial: false })
  }
  const curEnd = addDays(cur, 6)
  weeks.push({ from: cur, to: today < curEnd ? today : curEnd, partial: today < curEnd })
  return weeks
}

export type MetrikaRow = { date: string; source: string; engine: string; visits: number; pageviews: number }

export function sourceOf(r: Pick<MetrikaRow, 'source' | 'engine'>): SourceKey {
  const src = r.source.toLowerCase()
  const eng = r.engine.toLowerCase()
  if (src === 'organic') {
    if (eng.startsWith('yandex') || eng.includes('яндекс')) return 'yandex'
    if (eng.startsWith('google')) return 'google'
    return 'otherSearch'
  }
  if (src === 'direct') return 'direct'
  if (src === 'referral') return 'referral'
  if (src === 'social' || src === 'messenger') return 'social'
  if (src === 'ad') return 'ad'
  return 'other'
}

export function aggregateWeeks(weeks: Week[], rows: MetrikaRow[], leadDates: string[]): WeekRow[] {
  const out: WeekRow[] = weeks.map((w) => ({ ...w, visits: 0, pageviews: 0, leads: 0, yandex: 0, google: 0, otherSearch: 0, direct: 0, referral: 0, social: 0, ad: 0, other: 0 }))
  const find = (d: string) => out.find((w) => d >= w.from && d <= w.to)
  for (const r of rows) {
    const w = find(r.date)
    if (!w) continue
    w.visits += r.visits
    w.pageviews += r.pageviews
    w[sourceOf(r)] += r.visits
  }
  for (const d of leadDates) {
    const w = find(d)
    if (w) w.leads++
  }
  return out
}

// Изменение к прошлой неделе в процентах; от нуля процента нет.
export function delta(cur: number, prev: number): number | null {
  if (!prev) return null
  return Math.round(((cur - prev) / prev) * 100)
}

export function leadDatesFor(leads: AmoLeadLite[], channels: ChannelKey[]): string[] {
  return leads.filter((l) => channels.includes(channelOf(l))).map((l) => moscowDate(l.created_at * 1000))
}

type MetrikaResponse = { data?: { dimensions: { id?: string | null; name?: string | null }[]; metrics: number[] }[]; message?: string; errors?: { message: string }[] }

export async function fetchMetrika(counterId: number, date1: string, date2: string, token: string): Promise<MetrikaRow[]> {
  const q = new URLSearchParams({
    ids: String(counterId),
    metrics: 'ym:s:visits,ym:s:pageviews',
    dimensions: 'ym:s:date,ym:s:lastsignTrafficSource,ym:s:lastsignSearchEngineRoot',
    date1,
    date2,
    filters: "ym:s:isRobot=='No'",
    accuracy: 'full',
    limit: '10000',
  })
  const res = await fetch(`https://api-metrika.yandex.net/stat/v1/data?${q}`, {
    headers: { Authorization: `OAuth ${token}` },
    next: { revalidate: 1800 },
  })
  const body = (await res.json().catch(() => ({}))) as MetrikaResponse
  if (!res.ok) throw new Error(`Метрика ответила ${res.status}: ${body.message ?? body.errors?.[0]?.message ?? 'без пояснения'}`)
  return (body.data ?? []).map((r) => ({
    date: String(r.dimensions[0]?.name ?? r.dimensions[0]?.id ?? ''),
    source: String(r.dimensions[1]?.id ?? ''),
    engine: String(r.dimensions[2]?.id ?? r.dimensions[2]?.name ?? ''),
    visits: r.metrics[0] ?? 0,
    pageviews: r.metrics[1] ?? 0,
  }))
}
