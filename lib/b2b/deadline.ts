// А6: один расчёт срока для всего B2B-контура. Раньше менеджерский запуск ставил
// «+14 календарных дней», а кабинет партнёра считал «+15 рабочих» — клиент и менеджер
// видели разные даты. Здесь единственная формула; фабрикованных сроков нет:
// либо явный deadline_date, либо production_days из просчёта, либо рабочие дни от запуска.

export const DEFAULT_WORKING_DAYS = 15

export function addWorkingDays(from: Date, days: number): Date {
  const d = new Date(from)
  let left = days
  while (left > 0) {
    d.setDate(d.getDate() + 1)
    const wd = d.getDay()
    if (wd !== 0 && wd !== 6) left--
  }
  return d
}

// Ориентир отгрузки от даты запуска. production_days (если менеджер задал в просчёте) —
// календарные дни, как их понимает клиент; иначе рабочие дни производства.
export function shipDateFrom(launch: Date | string, productionDays?: number | null): Date {
  const base = new Date(launch)
  if (productionDays && productionDays > 0) {
    const d = new Date(base)
    d.setDate(d.getDate() + productionDays)
    return d
  }
  return addWorkingDays(base, DEFAULT_WORKING_DAYS)
}

// Срок заказа: явная дата → срок от запуска → срок от создания (для незапущенных).
export function deadlineFor(
  notes: Record<string, unknown>,
  createdAt: string,
): Date {
  if (notes.deadline_date) return new Date(notes.deadline_date as string)
  const days = Number(notes.production_days) || null
  if (notes.launched_at) return shipDateFrom(notes.launched_at as string, days)
  return shipDateFrom(createdAt, days)
}

export const toDateInput = (d: Date) => d.toISOString().slice(0, 10)
