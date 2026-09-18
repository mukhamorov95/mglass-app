// Свод показателей менеджера за период: из дневных фактов в строку таблицы.
//
// Чистая функция, потому что здесь легко ошибиться дважды: сложить итог из
// строки книги (и удвоить) и посчитать конверсию по нулю (и показать ∞).

export type MetricKey = 'talks' | 'measure_assigned' | 'measure_done' | 'payments' | 'prepay' | 'remainder' | 'money_total'

export const METRIC_KEYS: { key: MetricKey; label: string; money: boolean }[] = [
  { key: 'talks', label: 'Разговоры', money: false },
  { key: 'measure_assigned', label: 'Замер назначен', money: false },
  { key: 'measure_done', label: 'Замер проведён', money: false },
  { key: 'payments', label: 'Оплат, шт', money: false },
  { key: 'prepay', label: 'Предоплаты', money: true },
  { key: 'remainder', label: 'Остатки', money: true },
  { key: 'money_total', label: 'Всего денег', money: true },
]

export type StatFact = { stat_date: string; manager: string; metric: string; value: number | string }

export type StatRow = {
  manager: string
  talks: number; measure_assigned: number; measure_done: number; payments: number
  prepay: number; remainder: number; money_total: number
  // Книга ведёт «ВСЕГО» отдельной строкой, и она не всегда равна сумме
  // предоплат и остатков. Показываем расхождение, а не прячем его.
  moneySum: number
  moneyGap: number
  avgCheck: number
  toMeasure: number | null   // разговор → замер назначен, %
  toDone: number | null      // назначен → проведён, %
  toPayment: number | null   // проведён → оплата, %
}

const pct = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part / whole) * 100) : null

function makeRow(manager: string, v: Record<MetricKey, number>): StatRow {
  const moneySum = v.prepay + v.remainder
  return {
    manager, ...v,
    moneySum,
    moneyGap: Math.round(v.money_total - moneySum),
    avgCheck: v.payments > 0 ? Math.round(v.prepay / v.payments) : 0,
    toMeasure: pct(v.measure_assigned, v.talks),
    toDone: pct(v.measure_done, v.measure_assigned),
    toPayment: pct(v.payments, v.measure_done),
  }
}

const zero = (): Record<MetricKey, number> => ({
  talks: 0, measure_assigned: 0, measure_done: 0, payments: 0, prepay: 0, remainder: 0, money_total: 0,
})

export function foldStats(facts: StatFact[], picked: string[] = []): { rows: StatRow[]; totals: StatRow; days: number } {
  const byManager = new Map<string, Record<MetricKey, number>>()
  const days = new Set<string>()
  const keep = picked.length ? (m: string) => picked.includes(m) : () => true

  for (const f of facts) {
    const key = f.metric as MetricKey
    if (!(key in zero())) continue
    if (!keep(f.manager)) continue
    days.add(f.stat_date)
    const cur = byManager.get(f.manager) ?? zero()
    cur[key] += Number(f.value) || 0
    byManager.set(f.manager, cur)
  }

  const rows = [...byManager.entries()]
    .map(([m, v]) => makeRow(m, v))
    .sort((a, b) => b.money_total - a.money_total || b.prepay - a.prepay || a.manager.localeCompare(b.manager))

  const sum = zero()
  for (const r of rows) for (const { key } of METRIC_KEYS) sum[key] += r[key]
  return { rows, totals: makeRow('Итого', sum), days: days.size }
}

// Период → целые месяцы + хвосты по дням. Целый месяц берётся из итога месяца
// книги (manager_stats_monthly) — ровно та колонка, по которой владелец сверяет
// (август 26 — ADL). Дни нужны только там, где период режет месяц пополам: в
// итоге месяца есть суммы, внесённые без дня, и сложить дни вместо итога значит
// потерять их (Дима, февраль–июнь 2026).
export function splitPeriod(from: string, to: string): { months: string[]; dayRanges: [string, string][] } {
  const months: string[] = []
  const dayRanges: [string, string][] = []
  if (!from || !to || from > to) return { months, dayRanges }

  const lastDay = (ym: string) => {
    const [y, m] = ym.split('-').map(Number)
    return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
  }
  const nextMonth = (ym: string) => {
    const [y, m] = ym.split('-').map(Number)
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  }

  let ym = from.slice(0, 7)
  const endYm = to.slice(0, 7)
  while (ym <= endYm) {
    const first = `${ym}-01`, last = lastDay(ym)
    const lo = from > first ? from : first
    const hi = to < last ? to : last
    if (lo === first && hi === last) months.push(ym)
    else dayRanges.push([lo, hi])
    ym = nextMonth(ym)
  }
  return { months, dayRanges }
}

export type MonthNote = {
  month: string; manager: string; metric: MetricKey
  book: number | null; days: number; value: number
  kind: 'month_only' | 'total_misses_last_day' | 'total_below_days' | 'no_total'
  note_day: string | null
}

// Подпись к расхождению книги — одна фраза, что в книге и что показано.
export function describeNote(n: MonthNote): string {
  switch (n.kind) {
    case 'month_only': return 'внесено только в итог месяца, без дня — показан итог книги'
    case 'total_misses_last_day': return `итог месяца в книге не включает ${n.note_day ? n.note_day.split('-').reverse().join('.') : 'последний день'} — показана сумма дней, книгу стоит поправить`
    case 'no_total': return 'итог месяца в книге пустой, а по дням суммы есть — показана сумма дней'
    default: return 'итог месяца в книге меньше суммы дней — показана сумма дней'
  }
}
