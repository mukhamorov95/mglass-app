// «Аналитика дохода» из управленческой книги → manager_stats_daily / _monthly.
// Каждое утро в 8:05 МСК — крон /api/cron/manager-stats-sync; руками — тот же код
// через scripts/import-manager-stats.mjs. Поэтому здесь только относительные импорты.
//
// Книга — зеркало: значение, стёртое в книге, в базе становится 0, а не остаётся
// старым. Если книга прочиталась подозрительно пустой, ничего не трогаем.

import type { SupabaseClient } from '@supabase/supabase-js'
import { parseManagerStats } from './managerStatsParse.mjs'
import { parseCsv } from './salesSheetParse.mjs'

export const MGMT_BOOK_ID = '1IVpJcexfVBg8W7GDpWDY6ROB3hVyGh01IT_sOQHBKjk'
const INCOME_GID = '1902318311'   // лист «Аналитика дохода»
const SOURCE = 'gsheet_mgmt'

export type DayFact = { stat_date: string; manager: string; metric: string; value: number }
export type MonthFact = {
  month: string; manager: string; metric: string; book: number | null; days: number
  value: number; kind: string; delta: number; day?: string | null
}

export type ManagerStatsReport = {
  dry: boolean
  since: string
  facts: number
  months: number
  zeroed: { days: number; months: number }
  lastDay: string | null
  lastDayByManager: Record<string, string>
  unknown: string[]
  odd: MonthFact[]
  held?: string
  error?: string
}

type Fetch = (url: string) => Promise<string>
const defaultFetch: Fetch = async url => {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`лист недоступен: HTTP ${r.status}`)
  return r.text()
}

// С начала прошлого месяца: книгу правят задним числом, но не дальше месяца назад.
export function defaultSince(today: string): string {
  const [y, m] = today.split('-').map(Number)
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10)
}

const dayKey = (f: { stat_date: string; manager: string; metric: string }) => `${f.stat_date}|${f.manager}|${f.metric}`
const monthKey = (f: { month: string; manager: string; metric: string }) => `${f.month}|${f.manager}|${f.metric}`

// Что в базе есть, а в книге за тот же период уже нет. Чистая функция — ради теста.
export function missingKeys<T>(inDb: T[], inBook: T[], key: (x: T) => string): T[] {
  const book = new Set(inBook.map(key))
  return inDb.filter(x => !book.has(key(x)))
}

async function readAll<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await q(i, i + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

export async function syncManagerStats(
  sb: SupabaseClient,
  opts: { dry?: boolean; since?: string; today: string; fetchText?: Fetch },
): Promise<ManagerStatsReport> {
  const dry = !!opts.dry
  const since = opts.since ?? defaultSince(opts.today)
  const url = `https://docs.google.com/spreadsheets/d/${MGMT_BOOK_ID}/gviz/tq?tqx=out:csv&gid=${INCOME_GID}`
  const parsed = parseManagerStats(parseCsv(await (opts.fetchText ?? defaultFetch)(url))) as unknown as {
    facts: DayFact[]; monthly: MonthFact[]; unknown: string[]; days: number
  }
  const facts = parsed.facts.filter(f => f.stat_date >= since)
  const monthly = parsed.monthly.filter(m => m.month >= since.slice(0, 7))

  const lastDayByManager: Record<string, string> = {}
  for (const f of parsed.facts) if (!lastDayByManager[f.manager] || f.stat_date > lastDayByManager[f.manager]) lastDayByManager[f.manager] = f.stat_date
  const lastDay = Object.values(lastDayByManager).sort().at(-1) ?? null
  const odd = monthly.filter(m => m.kind !== 'match' && !(m.kind === 'no_total' && !m.days))
  const report: ManagerStatsReport = {
    dry, since, facts: facts.length, months: monthly.length, zeroed: { days: 0, months: 0 },
    lastDay, lastDayByManager, unknown: parsed.unknown, odd,
  }

  const dbDays = await readAll<DayFact>((a, b) => sb.from('manager_stats_daily')
    .select('stat_date, manager, metric, value').eq('source', SOURCE).gte('stat_date', since).neq('value', 0)
    .order('stat_date').order('manager').order('metric').range(a, b))
  const dbMonths = await readAll<MonthFact>((a, b) => sb.from('manager_stats_monthly')
    .select('month, manager, metric, book, days, value, kind, delta').gte('month', since.slice(0, 7)).neq('value', 0)
    .order('month').order('manager').order('metric').range(a, b))

  // Предохранитель: книга прочиталась, но в ней меньше половины того, что уже лежит
  // в базе за период, — вероятнее сломан разбор или лист, чем стёрт месяц работы.
  if (dbDays.length >= 20 && facts.length < dbDays.length / 2) {
    report.held = `в книге ${facts.length} значений за период с ${since}, в базе ${dbDays.length} — не трогаю, проверьте лист`
    return report
  }

  const goneDays = missingKeys(dbDays, facts, dayKey)
  const goneMonths = missingKeys(dbMonths, monthly, monthKey)
  report.zeroed = { days: goneDays.length, months: goneMonths.length }
  if (dry) return report

  const now = new Date().toISOString()
  const dayRows = [
    ...facts.map(f => ({ ...f, source: SOURCE, updated_at: now })),
    ...goneDays.map(f => ({ stat_date: f.stat_date, manager: f.manager, metric: f.metric, value: 0, source: SOURCE, updated_at: now })),
  ]
  for (let i = 0; i < dayRows.length; i += 500) {
    const { error } = await sb.from('manager_stats_daily').upsert(dayRows.slice(i, i + 500), { onConflict: 'stat_date,manager,metric' })
    if (error) { report.error = `запись дней: ${error.message}`; return report }
  }
  const monthRows = [
    ...monthly.map(m => ({
      month: m.month, manager: m.manager, metric: m.metric, book: m.book, days: m.days,
      value: m.value, kind: m.kind, delta: m.delta, note_day: m.day ?? null, updated_at: now,
    })),
    ...goneMonths.map(m => ({
      month: m.month, manager: m.manager, metric: m.metric, book: null, days: 0,
      value: 0, kind: 'match', delta: 0, note_day: null, updated_at: now,
    })),
  ]
  for (let i = 0; i < monthRows.length; i += 500) {
    const { error } = await sb.from('manager_stats_monthly').upsert(monthRows.slice(i, i + 500), { onConflict: 'month,manager,metric' })
    if (error) { report.error = `запись месяцев: ${error.message}`; return report }
  }
  return report
}

const dmy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`

// Владельцу пишем, только если есть что сделать: книга отстаёт, разбор что-то не
// узнал, итог месяца не сходится с днями, сверку остановил предохранитель.
export function formatManagerStatsReport(r: ManagerStatsReport, today: string): string | null {
  const lines: string[] = []
  if (r.error) lines.push(`⚠️ ${r.error}`)
  if (r.held) lines.push(`⏸ ${r.held}`)
  const lagDays = r.lastDay ? Math.round((Date.parse(today) - Date.parse(r.lastDay)) / 86_400_000) : null
  if (r.lastDay && lagDays != null && lagDays > 3) {
    lines.push(`Книга заполнена по ${dmy(r.lastDay)} — поступления на «Утре» менеджеров видны только по эту дату.`)
  }
  if (r.unknown.length) lines.push(`Не узнал строки: ${r.unknown.slice(0, 5).join(' · ')}`)
  const recent = r.odd.filter(m => m.month >= r.since.slice(0, 7))
  if (recent.length) {
    lines.push(`Итог месяца ≠ сумма дней: ${recent.slice(0, 5).map(m => `${m.month} ${m.manager} ${m.metric}`).join(' · ')}`)
  }
  if (!lines.length) return null
  return `📒 <b>Аналитика дохода</b>\n${lines.join('\n')}`
}
