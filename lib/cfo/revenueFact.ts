import { factForUnit, type SourceDiag } from './sourceDiagnostics'

// Выручка месяца одной цифрой — тем же правилом, что /cfo/model: юнит входит в сумму
// только с доверенным источником; без него — «нет данных», а не ноль. До 08.10 /cfo
// складывал одобренные расчёты (0 ₽ за сентябрь), /admin/cfo — все расчёты с черновиками.
export const FACT_UNITS = ['M-Glass', 'Производство'] as const

export type MonthRevenueFact = {
  total: number
  units: { unit: string; revenue: number | null }[]
  missing: string[]
}

export function monthRevenueFact(diags: SourceDiag[]): MonthRevenueFact {
  const units = FACT_UNITS.map(unit => {
    const f = factForUnit(diags, unit)
    return { unit, revenue: f.captured ? f.revenue : null }
  })
  return {
    total: units.reduce((s, u) => s + (u.revenue ?? 0), 0),
    units,
    missing: units.filter(u => u.revenue === null).map(u => u.unit),
  }
}

// Первое число месяца так же, как на /cfo/model, — иначе две страницы разойдутся
// на границе месяца из-за часового пояса.
export function factMonthStart(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}
