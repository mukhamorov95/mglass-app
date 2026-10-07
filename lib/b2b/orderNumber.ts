// Следующий номер заказа «NNNN-КК» (КК — код менеджера): максимум по всем номерам этого
// вида + 1. Номера читаются все, постранично: при одном запросе PostgREST отдавал 1000 из
// ~3700 строк в случайном порядке, и максимум выходил из случайной выборки — номер повторялся.
const FORMAT = /^(\d+)-\d+$/

export function maxFormattedNumber(numbers: (string | null | undefined)[]): number | null {
  let max: number | null = null
  for (const s of numbers) {
    const m = s?.trim().match(FORMAT)
    if (!m) continue
    const n = parseInt(m[1], 10)
    if (max === null || n > max) max = n
  }
  return max
}

export function nextOrderNumber(max: number, managerCode: number): string {
  return `${max + 1}-${String(managerCode).padStart(2, '0')}`
}
