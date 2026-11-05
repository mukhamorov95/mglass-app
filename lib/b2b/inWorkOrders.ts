// Кнопка «N в работе» в B2B Заказах (владелец 03.11.2026): сверху самые старые заказы, внизу новые.
// Даты — ключи дня YYYY-MM-DD; считаются календарные дни, день запуска — ноль.

const dayNum = (day: string) => Date.parse(`${day.slice(0, 10)}T00:00:00Z`)

export function daysInWork(launchDay: string, today: string): number {
  return Math.max(0, Math.round((dayNum(today) - dayNum(launchDay)) / 86_400_000))
}

// При равной дате выше тот, кого завели раньше: порядок не прыгает от загрузки к загрузке.
export function oldestFirst<T extends { id: number }>(list: readonly T[], launchDayOf: (x: T) => string): T[] {
  return [...list].sort((a, b) => launchDayOf(a).slice(0, 10).localeCompare(launchDayOf(b).slice(0, 10)) || a.id - b.id)
}

export function daysWord(days: number): string {
  const m10 = days % 10, m100 = days % 100
  return m10 === 1 && m100 !== 11 ? 'день' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'дня' : 'дней'
}

export function daysInWorkLabel(days: number): string {
  if (days === 0) return 'запущен сегодня'
  return `${days} ${daysWord(days)} в работе`
}
