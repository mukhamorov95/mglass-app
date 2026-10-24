// Продажи по периодам: M-Glass и B2B рядом — /ceo/sales (владелец 23.10.2026).
// Периоды — по календарю Москвы, ключи YYYY-MM-DD, обе границы включительно.

export type PresetId = 'today' | 'yesterday' | 'month' | 'prev_month' | 'year' | 'prev_year'
export type Period = { from: string; to: string }
export type Bucket = 'day' | 'month'

export const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'today', label: 'Сегодня' },
  { id: 'yesterday', label: 'Вчера' },
  { id: 'month', label: 'Месяц' },
  { id: 'prev_month', label: 'Прошлый месяц' },
  { id: 'year', label: 'Год' },
  { id: 'prev_year', label: 'Прошлый год' },
]

// До двух месяцев таблица идёт по дням, дальше — по месяцам.
export const MAX_DAY_ROWS = 62

const pad = (n: number) => String(n).padStart(2, '0')
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

// Date.parse('2026-02-30') молча даёт 2 марта — сверяем дату с собой после разбора.
export function isDay(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function dayCount(p: Period): number {
  return Math.round((Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`)) / 86_400_000) + 1
}

export function presetPeriod(id: PresetId, today: string): Period {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7))
  switch (id) {
    case 'today': return { from: today, to: today }
    case 'yesterday': { const d = addDays(today, -1); return { from: d, to: d } }
    case 'month': return { from: `${y}-${pad(m)}-01`, to: today }
    case 'prev_month': {
      const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1
      return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(lastDay(py, pm))}` }
    }
    case 'year': return { from: `${y}-01-01`, to: today }
    case 'prev_year': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }
  }
}

export type Resolved = { preset: PresetId | 'range'; period: Period }

// ?p=<пресет> или ?from=&to= — свой период. Пустая или битая граница: «с» берётся из «по»,
// «по» — сегодня; перепутанные местами границы меняются, а не дают пустой экран.
export function resolvePeriod(sp: { p?: string; from?: string; to?: string }, today: string): Resolved {
  const preset = PRESETS.find(x => x.id === sp.p)?.id
  if (preset) return { preset, period: presetPeriod(preset, today) }
  if (!isDay(sp.from) && !isDay(sp.to)) return { preset: 'month', period: presetPeriod('month', today) }
  const to = isDay(sp.to) ? sp.to : today
  const from = isDay(sp.from) ? sp.from : to
  return { preset: 'range', period: from <= to ? { from, to } : { from: to, to: from } }
}

// Тот же период годом раньше; 29 февраля — в 28-е.
export function lastYear(p: Period): Period {
  const back = (d: string) => {
    const md = d.slice(5)
    return `${Number(d.slice(0, 4)) - 1}-${md === '02-29' ? '02-28' : md}`
  }
  return { from: back(p.from), to: back(p.to) }
}

// Заказы B2B до 2026 года перенесены из таблицы помесячно — все стоят на 15-м числе
// (2024: 480 из 480, 2025: 1447 из 1447). Сумма B2B за такой период верна, только если
// его часть до 2026 года состоит из целых месяцев.
export const B2B_DAILY_FROM = '2026-01-01'

export function b2bExact(p: Period): boolean {
  if (p.from >= B2B_DAILY_FROM) return true
  const end = p.to < B2B_DAILY_FROM ? p.to : addDays(B2B_DAILY_FROM, -1)
  return p.from.slice(8) === '01' && addDays(end, 1).slice(8) === '01'
}

export const bucketOf = (p: Period): Bucket => (dayCount(p) <= MAX_DAY_ROWS ? 'day' : 'month')
export const keyOf = (date: string, b: Bucket) => (b === 'day' ? date : date.slice(0, 7))

export function bucketKeys(p: Period, b: Bucket): string[] {
  const keys: string[] = []
  if (b === 'day') {
    for (let d = p.from; d <= p.to; d = addDays(d, 1)) keys.push(d)
    return keys
  }
  let y = Number(p.from.slice(0, 4)), m = Number(p.from.slice(5, 7))
  const end = p.to.slice(0, 7)
  for (let k = `${y}-${pad(m)}`; k <= end; k = `${y}-${pad(m)}`) {
    keys.push(k)
    if (++m > 12) { m = 1; y++ }
  }
  return keys
}

// Сумма каждой продажи — в целых рублях: копейки есть у 5 строк из 4,5 тыс., а без этого
// «Итого = M-Glass + B2B внешним» на экране расходилось бы на рубль с суммой слагаемых.
export type Sale = { date: string; amount: number }
export type B2BSale = Sale & { own: boolean }
export type Sum = { sum: number; count: number }
export type Split = { mglass: Sum; b2bExternal: Sum; b2bOwn: Sum }

const zero = (): Sum => ({ sum: 0, count: 0 })
const add = (s: Sum, amount: number) => { s.sum += Math.round(amount); s.count++ }

export function split(mglass: Sale[], b2b: B2BSale[]): Split {
  const out: Split = { mglass: zero(), b2bExternal: zero(), b2bOwn: zero() }
  for (const r of mglass) add(out.mglass, r.amount)
  for (const r of b2b) add(r.own ? out.b2bOwn : out.b2bExternal, r.amount)
  return out
}

export const b2bAll = (s: Split): Sum => ({ sum: s.b2bExternal.sum + s.b2bOwn.sum, count: s.b2bExternal.count + s.b2bOwn.count })
// Заказы цеха для своей розницы уже сидят в продаже M-Glass клиенту — в итог компании не идут.
export const companySum = (s: Split): number => s.mglass.sum + s.b2bExternal.sum
export const avg = (s: Sum): number => (s.count ? Math.round(s.sum / s.count) : 0)

export type BucketRow = Split & { key: string }

export function byBucket(mglass: Sale[], b2b: B2BSale[], p: Period): BucketRow[] {
  const b = bucketOf(p)
  const rows = new Map(bucketKeys(p, b).map(key => [key, { key, mglass: zero(), b2bExternal: zero(), b2bOwn: zero() } as BucketRow]))
  for (const r of mglass) { const row = rows.get(keyOf(r.date, b)); if (row) add(row.mglass, r.amount) }
  for (const r of b2b) { const row = rows.get(keyOf(r.date, b)); if (row) add(r.own ? row.b2bOwn : row.b2bExternal, r.amount) }
  return [...rows.values()]
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

export const dayLong = (d: string) => `${Number(d.slice(8))} ${MONTHS_GEN[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`
export const ddmm = (d: string) => `${d.slice(8)}.${d.slice(5, 7)}`
export const weekday = (d: string) => WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]
export const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`

export function periodLabel(p: Period): string {
  if (p.from === p.to) return dayLong(p.from)
  const sameYear = p.from.slice(0, 4) === p.to.slice(0, 4)
  return `${sameYear ? `${ddmm(p.from)}` : `${ddmm(p.from)}.${p.from.slice(0, 4)}`} — ${ddmm(p.to)}.${p.to.slice(0, 4)}`
}
