// Занятость замерщика: свободные окна дня и проверка нового замера на
// пересечения. Всё по московскому времени — независимо от пояса сервера и
// браузера (в России нет перехода на летнее время, смещение постоянное).

export const DEFAULT_DURATION_MIN = 90
// Дорога до замера от предыдущего — по умолчанию час (владелец 01.10). Кто ставит
// замер вторым и дальше в день, оценивает её сам: она хранится в travel_min замера
// и дальше считается от неё. Нехватка дороги — предупреждение, а не запрет.
export const TRAVEL_MIN = 60
// Владелец 01.10: пн–пт 9–18; субботу замерщик добавляет себе сам в «Моём графике».
export const DEFAULT_SCHEDULE: Schedule = { work_days: [1, 2, 3, 4, 5], work_from: '09:00', work_to: '18:00' }

export type Schedule = { work_days: number[]; work_from: string; work_to: string }
export type DayOff = { id?: number; measurer_id: string; date_from: string; date_to: string; note?: string | null }
export type Booking = {
  id: number
  measurer_id: string | null
  scheduled_at: string | null
  duration_min: number | null
  // Оценка дороги до этого замера от предыдущего; null — по умолчанию TRAVEL_MIN.
  travel_min?: number | null
  address?: string | null
  status?: string
}

const MSK_OFFSET_MS = 3 * 3600_000
const DAY_MS = 86_400_000

export const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
export const fromMin = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

export function mskDate(iso: string | number | Date): string {
  return new Date(new Date(iso).getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10)
}
export function mskMinutes(iso: string | number | Date): number {
  const d = new Date(new Date(iso).getTime() + MSK_OFFSET_MS)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}
export function mskToIso(date: string, time: string): string {
  return new Date(`${date}T${time.length === 5 ? time : time.slice(0, 5)}:00+03:00`).toISOString()
}
export function addDays(date: string, n: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10)
}
// ISO-день недели: 1 — понедельник … 7 — воскресенье.
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}

export const isActiveBooking = (b: Booking) =>
  !!b.scheduled_at && !!b.measurer_id && (b.status === undefined || b.status === 'scheduled' || b.status === 'done' || b.status === 'issue')

export function dayOffOn(daysOff: DayOff[], measurerId: string, date: string): DayOff | null {
  return daysOff.find(d => d.measurer_id === measurerId && d.date_from <= date && date <= d.date_to) ?? null
}

export type Interval = { from: number; to: number }

function bookingInterval(b: Booking): Interval {
  const from = mskMinutes(b.scheduled_at!)
  return { from, to: from + (b.duration_min || DEFAULT_DURATION_MIN) }
}

export type DayPlan = {
  date: string
  off: DayOff | null
  working: boolean
  busy: Booking[]
  // Когда можно НАЧАТЬ новый замер заданной длительности (с запасом на дорогу).
  starts: Interval[]
}

// День одного замерщика. `notBeforeMin` — для сегодня: прошедшее время не предлагаем.
export function planDay(p: {
  date: string
  measurerId: string
  schedule?: Schedule | null
  daysOff: DayOff[]
  bookings: Booking[]
  durationMin?: number
  // Дорога до НОВОГО замера от предыдущего; до уже стоящих — их собственная travel_min.
  travelMin?: number
  notBeforeMin?: number
}): DayPlan {
  const sch = p.schedule ?? DEFAULT_SCHEDULE
  const dur = p.durationMin ?? DEFAULT_DURATION_MIN
  const travel = p.travelMin ?? TRAVEL_MIN
  const busy = p.bookings
    .filter(b => isActiveBooking(b) && b.measurer_id === p.measurerId && mskDate(b.scheduled_at!) === p.date)
    .sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!))
  const off = dayOffOn(p.daysOff, p.measurerId, p.date)
  const working = sch.work_days.includes(isoWeekday(p.date))
  if (off || !working) return { date: p.date, off, working, busy, starts: [] }

  let starts: Interval[] = [{ from: Math.max(toMin(sch.work_from), p.notBeforeMin ?? 0), to: toMin(sch.work_to) - dur }]
  for (const b of busy) {
    const iv = bookingInterval(b)
    // Нельзя начать в (начало стоящего − дорога до него − длительность; конец стоящего + дорога до нового).
    const cutFrom = iv.from - (b.travel_min ?? TRAVEL_MIN) - dur
    const cutTo = iv.to + travel
    starts = starts.flatMap(s => {
      if (cutTo <= s.from || cutFrom >= s.to) return [s]
      const parts: Interval[] = []
      if (cutFrom >= s.from) parts.push({ from: s.from, to: cutFrom })
      if (cutTo <= s.to) parts.push({ from: cutTo, to: s.to })
      return parts
    })
  }
  return { date: p.date, off, working, busy, starts: starts.filter(s => s.to >= s.from) }
}

// Время начала по сетке шага (по умолчанию 30 мин) внутри окон — для кнопок выбора.
export function startChoices(starts: Interval[], stepMin = 30): number[] {
  const out: number[] = []
  for (const s of starts) {
    for (let t = Math.ceil(s.from / stepMin) * stepMin; t <= s.to; t += stepMin) out.push(t)
  }
  return out
}

export type Conflict = { kind: 'overlap' | 'day_off' | 'not_working_day' | 'outside_hours' | 'travel'; hard: boolean; message: string }

// Проверка нового/переносимого замера. Жёсткие — пересечение и отпуск (нельзя
// быть в двух местах сразу); мягкие — дорога, нерабочий день, выход за часы
// (сервер спросит подтверждение).
export function checkBooking(p: {
  startIso: string
  durationMin?: number
  measurerId: string
  schedule?: Schedule | null
  daysOff: DayOff[]
  bookings: Booking[]
  excludeId?: number
  travelMin?: number
}): Conflict[] {
  const sch = p.schedule ?? DEFAULT_SCHEDULE
  const dur = p.durationMin ?? DEFAULT_DURATION_MIN
  const travel = p.travelMin ?? TRAVEL_MIN
  const date = mskDate(p.startIso)
  const from = mskMinutes(p.startIso)
  const to = from + dur
  const out: Conflict[] = []

  const off = dayOffOn(p.daysOff, p.measurerId, date)
  if (off) out.push({ kind: 'day_off', hard: true, message: `в этот день выходной/отпуск (${off.date_from === off.date_to ? off.date_from : `${off.date_from} — ${off.date_to}`}${off.note ? `, ${off.note}` : ''})` })

  const same = p.bookings.filter(b => isActiveBooking(b) && b.id !== p.excludeId && b.measurer_id === p.measurerId && mskDate(b.scheduled_at!) === date)
  for (const b of same) {
    const iv = bookingInterval(b)
    const where = b.address ? ` (${b.address})` : ''
    const after = b.travel_min ?? TRAVEL_MIN
    if (from < iv.to && iv.from < to) {
      out.push({ kind: 'overlap', hard: true, message: `пересекается с замером ${fromMin(iv.from)}–${fromMin(iv.to)}${where}` })
    } else if (iv.to <= from && from < iv.to + travel) {
      out.push({ kind: 'travel', hard: false, message: `после замера ${fromMin(iv.from)}–${fromMin(iv.to)}${where} всего ${from - iv.to} мин, а на дорогу заложено ${travel}` })
    } else if (to <= iv.from && iv.from - after < to) {
      out.push({ kind: 'travel', hard: false, message: `до замера ${fromMin(iv.from)}–${fromMin(iv.to)}${where} останется ${iv.from - to} мин, а на дорогу туда заложено ${after}` })
    }
  }

  if (!sch.work_days.includes(isoWeekday(date))) {
    out.push({ kind: 'not_working_day', hard: false, message: 'нерабочий день по графику замерщика' })
  } else if (from < toMin(sch.work_from) || to > toMin(sch.work_to)) {
    out.push({ kind: 'outside_hours', hard: false, message: `вне рабочих часов ${sch.work_from}–${sch.work_to}` })
  }
  return out
}
