// Период реестра продаж: месяц, квартал, год или произвольные даты.
//
// Считается в одном месте, потому что границы нужны трижды: в запросе к базе
// (там верхняя граница ИСКЛЮЧАЮЩАЯ — иначе продажи последнего дня теряются),
// в подписи на экране и в ссылке, которой владелец делится.

export type PeriodMode = 'month' | 'quarter' | 'year' | 'range'

export type Period = {
  mode: PeriodMode
  from: string        // включительно, YYYY-MM-DD
  to: string          // включительно, YYYY-MM-DD — то, что видит человек
  toExclusive: string // для запроса: sale_date < toExclusive
  month: string       // YYYY-MM — для стрелок «предыдущий/следующий месяц»
  label: string
}

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const isMonth = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTHS[(m || 1) - 1]} ${y}`
}

export function dayLabel(d: string): string {
  const [y, m, dd] = d.split('-').map(Number)
  return `${dd} ${MONTHS_GEN[(m || 1) - 1]} ${y}`
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  let mo = m + delta, yy = y
  while (mo < 1) { mo += 12; yy-- }
  while (mo > 12) { mo -= 12; yy++ }
  return `${yy}-${pad(mo)}`
}

// Следующий день — верхняя граница запроса. Через UTC, чтобы летнее время
// не съедало и не добавляло сутки.
function nextDay(d: string): string {
  const [y, m, dd] = d.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, dd + 1))
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function resolvePeriod(
  q: { month?: string | null; from?: string | null; to?: string | null; mode?: string | null },
  today: string,
): Period {
  const [ty, tm] = today.split('-').map(Number)

  // Произвольный период задаётся датами и бьёт всё остальное: его ввёл человек.
  if (isDate(q.from) && isDate(q.to)) {
    const [from, to] = q.from <= q.to ? [q.from, q.to] : [q.to, q.from]
    return {
      mode: 'range', from, to, toExclusive: nextDay(to),
      month: from.slice(0, 7),
      label: `${dayLabel(from)} — ${dayLabel(to)}`,
    }
  }

  const ym = isMonth(q.month) ? q.month : `${ty}-${pad(tm)}`
  const [y, m] = ym.split('-').map(Number)

  if (q.mode === 'year') {
    return {
      mode: 'year', from: ymd(y, 1, 1), to: ymd(y, 12, 31), toExclusive: ymd(y + 1, 1, 1),
      month: ym, label: `${y} год`,
    }
  }
  if (q.mode === 'quarter') {
    const qi = Math.floor((m - 1) / 3)          // 0..3
    const first = qi * 3 + 1, last = first + 2
    return {
      mode: 'quarter',
      from: ymd(y, first, 1), to: ymd(y, last, lastDayOfMonth(y, last)),
      toExclusive: last === 12 ? ymd(y + 1, 1, 1) : ymd(y, last + 1, 1),
      month: ym, label: `${qi + 1} квартал ${y}`,
    }
  }
  return {
    mode: 'month',
    from: ymd(y, m, 1), to: ymd(y, m, lastDayOfMonth(y, m)),
    toExclusive: m === 12 ? ymd(y + 1, 1, 1) : ymd(y, m + 1, 1),
    month: ym, label: monthLabel(ym),
  }
}

// Список менеджеров из строки запроса. Пустой список = все, и это не то же
// самое, что «никто»: фильтр без выбранных не должен прятать все продажи.
export function parseManagers(raw: string | null | undefined): string[] {
  if (!raw) return []
  return [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))]
}
