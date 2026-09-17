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
