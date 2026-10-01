'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_DURATION_MIN, TRAVEL_MIN, fromMin, mskMinutes, planDay, startChoices, toMin,
  type Booking, type DayOff, type Schedule,
} from '@/lib/measure/slots'
import { mskToday } from '@/lib/measure/client'

// Выбор «замерщик · дата · время» и две оценки, которые знает только человек:
// сколько займёт сам замер и — если перед ним в этот день уже стоит замер —
// сколько ехать оттуда. От них считаются свободные окна; окончательную проверку
// делает сервер.

export type BookingValue = { measurerId: string; date: string; time: string; durationMin: number; travelMin: number }
type MeasurerLite = { id: string; name: string }
type DayData = {
  today: string
  nowMin: number
  measurers: { id: string; name: string; schedule: Schedule }[]
  daysOff: (DayOff & { note: string | null })[]
  bookings: (Booking & { address: string | null; client_name: string | null })[]
}

const DURATIONS = [30, 45, 60, 90, 120, 180]
const TRAVELS = [30, 60, 90, 120]
const dl = (m: number) => m < 60 ? `${m} мин` : m % 60 ? `${Math.floor(m / 60)},5 ч` : `${m / 60} ч`

export default function BookingPicker({ value, onChange, measurers, lockMeasurer, excludeRequestId }: {
  value: BookingValue
  onChange: (v: BookingValue) => void
  measurers: MeasurerLite[]
  lockMeasurer?: boolean
  excludeRequestId?: number
}) {
  const [day, setDay] = useState<DayData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!value.date) return
    let alive = true
    fetch(`/api/measure-requests/board?from=${value.date}&days=1`, { cache: 'no-store' })
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!alive) return
        if (!r.ok) { setError(j.error || `Занятость не загрузилась (${r.status})`); setDay(null) }
        else { setError(''); setDay(j as DayData) }
      })
      .catch(() => alive && setError('Нет связи с сервером'))
    return () => { alive = false }
  }, [value.date])

  const plan = useMemo(() => {
    if (!day || !value.measurerId || !value.date) return null
    const m = day.measurers.find(x => x.id === value.measurerId)
    if (!m) return null
    const notBefore = value.date === day.today ? Math.ceil((day.nowMin + TRAVEL_MIN) / 30) * 30 : undefined
    return planDay({
      date: value.date, measurerId: m.id, schedule: m.schedule, daysOff: day.daysOff,
      bookings: day.bookings.filter(b => b.id !== excludeRequestId),
      durationMin: value.durationMin, travelMin: value.travelMin, notBeforeMin: notBefore,
    })
  }, [day, value, excludeRequestId])

  // Соседи выбранного времени в этот день: перед ним (откуда ехать) и после.
  const neighbours = useMemo(() => {
    if (!plan || !value.time) return { prev: null, next: null }
    const t = toMin(value.time)
    const prev = [...plan.busy].reverse().find(b => mskMinutes(b.scheduled_at!) < t) ?? null
    const next = plan.busy.find(b => mskMinutes(b.scheduled_at!) >= t) ?? null
    return { prev, next }
  }, [plan, value.time])

  const choices = plan ? startChoices(plan.starts) : []
  const set = (p: Partial<BookingValue>) => onChange({ ...value, ...p })
  const inp = 'bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-[#111110]'
  const current = measurers.find(m => m.id === value.measurerId)
  const you = lockMeasurer ? 'у тебя' : 'у замерщика'
  const chip = (on: boolean) => `rounded-lg px-2 py-1 border text-[12px] ${on ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0] hover:bg-[#f5f5f3]'}`
  const span = (b: Booking) => { const f = mskMinutes(b.scheduled_at!); return `${fromMin(f)}–${fromMin(f + (b.duration_min || DEFAULT_DURATION_MIN))}` }
  const where = (b: Booking) => (b as Booking & { address: string | null }).address

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        {lockMeasurer || measurers.length === 1 ? (
          <span className="text-[12px] font-semibold">📏 {current?.name ?? measurers[0]?.name}</span>
        ) : (
          <select value={value.measurerId} onChange={e => set({ measurerId: e.target.value })} className={inp}>
            <option value="">— замерщик —</option>
            {measurers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        <input type="date" value={value.date} min={mskToday()} onChange={e => set({ date: e.target.value })} className={inp} />
        <input type="time" value={value.time} step={900} onChange={e => set({ time: e.target.value })} className={inp} />
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[12px] text-[#6b6b66] mr-1">Сам замер займёт:</span>
        {DURATIONS.map(d => (
          <button key={d} type="button" onClick={() => set({ durationMin: d })} className={chip(value.durationMin === d)}>{dl(d)}</button>
        ))}
      </div>

      {neighbours.prev && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-2 space-y-1">
          <p className="text-[12px] text-[#111110]">
            Перед этим {you} замер <b className="font-mono">{span(neighbours.prev)}</b>{where(neighbours.prev) ? ` · ${where(neighbours.prev)}` : ''}.
            {' '}Сколько займёт дорога оттуда?
          </p>
          <div className="flex items-center gap-1 flex-wrap">
            {TRAVELS.map(t => (
              <button key={t} type="button" onClick={() => set({ travelMin: t })} className={chip(value.travelMin === t)}>{dl(t)}</button>
            ))}
            <input type="number" min={0} max={600} step={5} value={value.travelMin}
              onChange={e => set({ travelMin: Math.max(0, Math.min(600, Number(e.target.value) || 0)) })}
              className={`${inp} w-20`} title="Своя оценка, минут" />
            <span className="text-[11px] text-[#6b6b66]">мин</span>
          </div>
        </div>
      )}
      {neighbours.next && (
        <p className="text-[11px] text-[#6b6b66]">
          После — замер <span className="font-mono">{span(neighbours.next)}</span>{where(neighbours.next) ? ` · ${where(neighbours.next)}` : ''}; на дорогу туда заложено {dl(neighbours.next.travel_min ?? TRAVEL_MIN)}.
        </p>
      )}

      {error && <p className="text-[11px] text-red-600">{error}</p>}
      {plan && (
        <div className="text-[11px] text-[#6b6b66] space-y-1">
          {plan.off && <p className="text-amber-700">🌴 В этот день выходной{plan.off.note ? ` — ${plan.off.note}` : ''}. Выбери другой день или замерщика.</p>}
          {!plan.off && !plan.working && <p className="text-amber-700">По графику замерщик в этот день не работает.</p>}
          {plan.busy.length > 0 && (
            <p>В этот день уже стоит: {plan.busy.map(b => `${span(b)}${where(b) ? ` (${where(b)})` : ''}`).join(' · ')}</p>
          )}
          {choices.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              <span>Начать можно:</span>
              {choices.map(t => (
                <button key={t} type="button" onClick={() => set({ time: fromMin(t) })}
                  className={`font-mono rounded px-1.5 py-0.5 border ${value.time === fromMin(t) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'}`}>
                  {fromMin(t)}
                </button>
              ))}
            </div>
          ) : !plan.off && plan.working && <p className="text-amber-700">Свободных окон в этот день нет.</p>}
        </div>
      )}
    </div>
  )
}
