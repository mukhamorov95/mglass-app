'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { confirmDialog } from '@/lib/dialog'
import { dayRouteUrl, tidy } from '@/lib/measure/message'
import { mskToday } from '@/lib/measure/client'
import {
  DEFAULT_DURATION_MIN, TRAVEL_MIN, addDays, fromMin, isoWeekday, mskDate, mskMinutes, planDay,
  type Booking, type DayOff, type Schedule,
} from '@/lib/measure/slots'

// Календарь замерщика: месяц — его замеры, выходные, нерабочие дни; по нажатию на
// день — расписание по порядку, окна «когда можно начать», маршрут дня в Яндекс.Картах
// и «сделать выходным». Владелец смотрит любого замерщика или всех сразу.

type CalBooking = Booking & {
  measurer_name: string | null
  address: string | null
  client_name: string | null
  deal_number: string | null
}
type CalData = {
  today: string
  nowMin: number
  measurers: { id: string; name: string; schedule: Schedule }[]
  daysOff: (DayOff & { id: number; note: string | null })[]
  bookings: CalBooking[]
}

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
const WD_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье']
const STATUS_MARK: Record<string, string> = { done: '✅', issue: '⚠️' }

export function monthGrid(month: string): { start: string; days: number } {
  const first = `${month}-01`
  const start = addDays(first, -(isoWeekday(first) - 1))
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  const end = addDays(last, 7 - isoWeekday(last))
  const days = Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000) + 1
  return { start, days }
}
const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}
const dayTitle = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`)
  return `${WD_FULL[isoWeekday(date) - 1]}, ${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]}`
}

export default function MeasurerCalendar({ meId, isOwner, refreshKey, onChanged }: {
  meId: string
  isOwner: boolean
  refreshKey?: number
  onChanged?: () => void
}) {
  const today = mskToday()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [selected, setSelected] = useState(today)
  const [who, setWho] = useState(isOwner ? '' : meId)
  const [data, setData] = useState<CalData | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const grid = useMemo(() => monthGrid(month), [month])

  const load = useCallback(async () => {
    const res = await fetch(`/api/measure-requests/board?from=${grid.start}&days=${grid.days}`, { cache: 'no-store' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setError(j.error || `Календарь не загрузился (${res.status})`); return }
    setError(''); setData(j as CalData)
  }, [grid])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load, refreshKey])

  const lanes = useMemo(() => !data ? [] : data.measurers.filter(m => !who || m.id === who), [data, who])
  const notBefore = data ? Math.ceil((data.nowMin + TRAVEL_MIN) / 30) * 30 : 0

  const cells = useMemo(() => {
    if (!data) return []
    return Array.from({ length: grid.days }, (_, i) => {
      const date = addDays(grid.start, i)
      const items = data.bookings
        .filter(b => b.scheduled_at && mskDate(b.scheduled_at) === date && lanes.some(l => l.id === b.measurer_id))
        .sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!))
      const offs = lanes.filter(l => data.daysOff.some(d => d.measurer_id === l.id && d.date_from <= date && date <= d.date_to))
      const working = lanes.some(l => l.schedule.work_days.includes(isoWeekday(date)))
      return { date, items, offs, working, inMonth: date.startsWith(month) }
    })
  }, [data, grid, lanes, month])

  const day = useMemo(() => {
    if (!data) return null
    return lanes.map(m => ({
      m,
      plan: planDay({
        date: selected, measurerId: m.id, schedule: m.schedule, daysOff: data.daysOff, bookings: data.bookings,
        notBeforeMin: selected === data.today ? notBefore : undefined,
      }),
      off: data.daysOff.find(d => d.measurer_id === m.id && d.date_from <= selected && selected <= d.date_to) ?? null,
    }))
  }, [data, lanes, selected, notBefore])

  // Выходной на один день — замерщику себе, владельцу выбранному замерщику.
  const target = isOwner ? who : meId
  async function toggleDayOff(off: (DayOff & { id: number }) | null, hasMeasures: boolean) {
    if (!target) return
    if (off) {
      const range = off.date_from === off.date_to ? null : `${off.date_from.split('-').reverse().join('.')} — ${off.date_to.split('-').reverse().join('.')}`
      if (!(await confirmDialog({
        title: range ? 'Убрать весь отпуск?' : 'Убрать выходной?',
        text: range ? `Это отпуск ${range} — уберётся целиком, все дни снова станут свободными.` : 'День снова станет свободным на доске у менеджеров.',
        confirmLabel: 'Убрать',
      }))) return
    } else if (!(await confirmDialog({
      title: `Сделать ${dayTitle(selected)} выходным?`,
      text: hasMeasures ? 'На этот день уже стоят замеры — их нужно будет перенести или вернуть в пул.' : 'Менеджеры увидят 🌴 и не смогут поставить замер на этот день.',
      confirmLabel: 'Сделать выходным',
    }))) return
    setBusy(true); setError(''); setNotice('')
    try {
      const res = off
        ? await fetch(`/api/measurers/days-off?id=${off.id}`, { method: 'DELETE' })
        : await fetch('/api/measurers/days-off', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ measurer_id: target, date_from: selected, date_to: selected }),
        })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error || `Не сохранено (${res.status})`); return }
      setNotice(off ? 'Выходной убран.' : `${dayTitle(selected)} — выходной. На доске у менеджеров этот день закрыт.`)
      await load(); onChanged?.()
    } finally { setBusy(false) }
  }

  const navBtn = 'text-[13px] font-semibold border border-[#e4e4e0] bg-white rounded-lg px-3 py-1.5 hover:bg-[#f5f5f3]'
  const [y, mIdx] = [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1]

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-[#e4e4e0] p-3 sm:p-4">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <button onClick={() => setMonth(m => shiftMonth(m, -1))} className={navBtn} aria-label="Месяц раньше">←</button>
          <p className="text-[15px] font-bold first-letter:uppercase min-w-[130px] text-center">{MONTHS[mIdx]} {y}</p>
          <button onClick={() => setMonth(m => shiftMonth(m, 1))} className={navBtn} aria-label="Месяц позже">→</button>
          {month !== today.slice(0, 7) && <button onClick={() => { setMonth(today.slice(0, 7)); setSelected(today) }} className={navBtn}>Сегодня</button>}
          {isOwner && data && data.measurers.length > 0 && (
            <select value={who} onChange={e => setWho(e.target.value)} className="ml-auto bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px]">
              <option value="">Все замерщики</option>
              {data.measurers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
        </div>

        {error && <p className="text-[12px] text-red-600 mb-2">{error}</p>}
        {data && data.measurers.length === 0 && (
          <p className="text-[12px] text-amber-700 mb-2">Замерщики ещё не заведены в приложении — календарь пуст.</p>
        )}

        <div className="grid grid-cols-7 gap-1">
          {WD.map(w => <p key={w} className="text-[10px] font-bold uppercase text-[#9a9a95] text-center">{w}</p>)}
          {cells.map(c => {
            const isSel = c.date === selected
            const isToday = c.date === today
            return (
              <button key={c.date} onClick={() => setSelected(c.date)}
                className={`min-h-[52px] sm:min-h-[72px] rounded-lg border p-1 text-left align-top flex flex-col
                  ${isSel ? 'border-[#111110] ring-1 ring-[#111110]' : 'border-[#f0f0ec]'}
                  ${!c.inMonth ? 'opacity-40' : ''} ${c.offs.length ? 'bg-[#f5f5f3]' : !c.working ? 'bg-[#fafaf8]' : 'bg-white'}`}>
                <span className={`self-start text-[12px] font-semibold ${isToday ? 'bg-[#111110] text-white rounded-full min-w-[20px] text-center px-1' : ''}`}>{Number(c.date.slice(8))}</span>
                {c.offs.length > 0 && <span className="text-[10px] leading-tight">🌴{who ? '' : ` ${c.offs.map(o => o.name).join(', ')}`}</span>}
                {c.items.length > 0 && (
                  <>
                    <span className="sm:hidden mt-auto text-[10px] font-semibold text-blue-700">{c.items.length} зам.</span>
                    <span className="hidden sm:flex flex-col gap-0.5 mt-0.5">
                      {c.items.slice(0, 3).map(b => (
                        <span key={b.id} className="text-[10px] leading-tight truncate">
                          <span className="font-mono font-semibold">{fromMin(mskMinutes(b.scheduled_at!))}</span>
                          {' '}{STATUS_MARK[b.status ?? ''] ?? ''}{tidy(b.address)?.split(',')[0] ?? ''}
                        </span>
                      ))}
                      {c.items.length > 3 && <span className="text-[10px] text-[#9a9a95]">ещё {c.items.length - 3}</span>}
                    </span>
                  </>
                )}
              </button>
            )
          })}
        </div>
        <p className="text-[10px] text-[#9a9a95] mt-2">🌴 выходной · серый фон — не рабочий день по графику · ✅ выполнен · ⚠️ сложность. Нажми на день — расписание ниже.</p>
      </div>

      {notice && <p className="text-[12px] text-emerald-700">✅ {notice}</p>}

      {day && (
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4 space-y-3">
          <p className="text-[14px] font-bold first-letter:uppercase">{dayTitle(selected)}{selected === today ? ' · сегодня' : ''}</p>
          {day.length === 0 && <p className="text-[12px] text-[#c4c4be]">Замерщиков нет.</p>}
          {day.map(({ m, plan, off }) => {
            const route = dayRouteUrl(plan.busy.filter(b => b.status !== 'done').map(b => (b as CalBooking).address))
            return (
              <div key={m.id} className="space-y-1.5">
                {day.length > 1 && <p className="text-[12px] font-semibold text-[#4b4b47]">📏 {m.name}</p>}
                {off && <p className="text-[12px] text-[#6b6b66]">🌴 выходной{off.note ? ` — ${off.note}` : ''}</p>}
                {!off && !plan.working && <p className="text-[12px] text-[#9a9a95]">По графику не рабочий день.</p>}
                {plan.busy.length === 0 && !off && <p className="text-[12px] text-[#c4c4be]">Замеров нет.</p>}
                {plan.busy.map((b, i) => {
                  const bb = b as CalBooking
                  const f = mskMinutes(b.scheduled_at!)
                  return (
                    <div key={b.id} className="border-l-2 border-[#111110] pl-2">
                      {i > 0 && <p className="text-[10px] text-blue-700">🚗 дорога {b.travel_min ?? TRAVEL_MIN} мин</p>}
                      <p className="text-[13px]">
                        <span className="font-mono font-bold">{fromMin(f)}–{fromMin(f + (b.duration_min || DEFAULT_DURATION_MIN))}</span>
                        {' '}{STATUS_MARK[b.status ?? ''] ?? ''} {bb.deal_number ? `${bb.deal_number} · ` : ''}{bb.client_name ? tidy(bb.client_name) : 'занято'}
                      </p>
                      {bb.address && <p className="text-[12px] text-[#6b6b66]">📍 {bb.address}</p>}
                    </div>
                  )
                })}
                {plan.starts.length > 0 && selected >= today && (
                  <p className="text-[12px] text-emerald-700">
                    Можно начать новый: {plan.starts.map(s => s.from === s.to ? `в ${fromMin(s.from)}` : `${fromMin(s.from)}–${fromMin(s.to)}`).join(' · ')}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {route && (
                    <a href={route} target="_blank" rel="noopener noreferrer"
                      className="text-[12px] font-semibold bg-[#111110] text-white rounded-lg px-3 py-1.5 hover:bg-[#2a2a28]">
                      🗺 Маршрут дня{plan.busy.length > 1 ? ` (${plan.busy.filter(b => b.status !== 'done').length} адр.)` : ''}
                    </a>
                  )}
                  {(isOwner ? !!who : m.id === meId) && selected >= today && (
                    <button onClick={() => toggleDayOff(off, plan.busy.length > 0)} disabled={busy}
                      className="text-[12px] border border-[#e4e4e0] rounded-lg px-3 py-1.5 hover:bg-[#f5f5f3] disabled:opacity-40">
                      {off ? '↺ Убрать выходной' : '🌴 Сделать выходным'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
