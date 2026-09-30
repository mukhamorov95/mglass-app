'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_DURATION_MIN, TRAVEL_MIN, fromMin, mskMinutes, planDay, startChoices,
  type Booking, type DayOff, type Schedule,
} from '@/lib/measure/slots'
import { mskToday } from '@/lib/measure/client'

// Выбор «замерщик · дата · время · длительность» с подсказкой: что у замерщика
// в этот день уже стоит и когда можно начать. Время — кнопкой из свободных или
// руками; окончательную проверку делает сервер.

export type BookingValue = { measurerId: string; date: string; time: string; durationMin: number }
type MeasurerLite = { id: string; name: string }
type DayData = {
  today: string
  nowMin: number
  measurers: { id: string; name: string; schedule: Schedule }[]
  daysOff: (DayOff & { note: string | null })[]
  bookings: (Booking & { address: string | null; client_name: string | null })[]
}

const DURATIONS = [60, 90, 120, 180]

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
      durationMin: value.durationMin, notBeforeMin: notBefore,
    })
  }, [day, value, excludeRequestId])

  const choices = plan ? startChoices(plan.starts) : []
  const set = (p: Partial<BookingValue>) => onChange({ ...value, ...p })
  const inp = 'bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-[#111110]'
  const current = measurers.find(m => m.id === value.measurerId)

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
        <select value={value.durationMin} onChange={e => set({ durationMin: Number(e.target.value) })} className={inp} title="Сколько займёт замер">
          {DURATIONS.map(d => <option key={d} value={d}>{d % 60 ? `${Math.floor(d / 60)},5 ч` : `${d / 60} ч`}</option>)}
        </select>
      </div>

      {error && <p className="text-[11px] text-red-600">{error}</p>}
      {plan && (
        <div className="text-[11px] text-[#6b6b66] space-y-1">
          {plan.off && <p className="text-amber-700">🌴 В этот день выходной{plan.off.note ? ` — ${plan.off.note}` : ''}. Выбери другой день или замерщика.</p>}
          {!plan.off && !plan.working && <p className="text-amber-700">По графику замерщик в этот день не работает.</p>}
          {plan.busy.length > 0 && (
            <p>Уже стоит: {plan.busy.map(b => {
              const f = mskMinutes(b.scheduled_at!)
              const bb = b as Booking & { address: string | null }
              return `${fromMin(f)}–${fromMin(f + (b.duration_min || DEFAULT_DURATION_MIN))}${bb.address ? ` (${bb.address})` : ''}`
            }).join(' · ')}</p>
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
