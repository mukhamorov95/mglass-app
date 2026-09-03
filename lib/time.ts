// Время в приложении — московское, всегда.
//
// Компания одна и живёт по Москве. До этого время бралось откуда придётся:
// серверные компоненты форматировали его на Vercel, а там UTC, и цех видел
// «07:43» вместо 10:43; клиентские брали часовой пояс устройства, а у рабочего
// на телефоне он может быть любым. Оба источника неверны по одной причине:
// показывали время НАБЛЮДАТЕЛЯ, а нужно время КОМПАНИИ.

export const TZ = 'Europe/Moscow'

const d = (v: string | number | Date): Date => (v instanceof Date ? v : new Date(v))

// 10:43
export function mskTime(v: string | number | Date): string {
  return d(v).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
}

// 28.08
export function mskDayShort(v: string | number | Date): string {
  return d(v).toLocaleDateString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit' })
}

// 28.08.2026
export function mskDate(v: string | number | Date): string {
  return d(v).toLocaleDateString('ru-RU', { timeZone: TZ })
}

// 28 авг., 10:43
export function mskDateTime(v: string | number | Date): string {
  return d(v).toLocaleString('ru-RU', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// Ключ дня по Москве — YYYY-MM-DD. Нужен там, где события группируются по дням:
// toISOString().slice(0,10) даёт день по UTC, и отметка в 02:00 по Москве
// попадала во вчерашний день.
export function mskDayKey(v: string | number | Date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
  return p.format(d(v))
}

// Ключ дня N дней назад — для окон «за неделю», «за 30 дней».
export function mskDayKeyAgo(days: number): string {
  return mskDayKey(Date.now() - days * 86_400_000)
}
