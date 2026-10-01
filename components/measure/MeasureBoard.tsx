'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  DEFAULT_DURATION_MIN, TRAVEL_MIN, addDays, fromMin, mskMinutes, planDay, toMin,
  type Booking, type DayOff, type Schedule,
} from '@/lib/measure/slots'

// Доска занятости замерщиков: по дням — у каждого замерщика его замеры (время,
// где), выходной и окна, когда можно НАЧАТЬ новый замер (с запасом на дорогу).
// Одна и та же у менеджера, замерщика и в «Календаре замеров»; в режиме выбора
// (pick) окно — кнопка, которая подставляет замерщика, дату и время в форму.

type BoardBooking = Booking & {
  measurer_name: string | null
  address: string | null
  mine: boolean
  deal_number: string | null
  client_name: string | null
}
export type BoardData = {
  me: { id: string; role: string; scope: string }
  from: string
  today: string
  nowMin: number
  poolCount: number
  measurers: { id: string; name: string; schedule: Schedule }[]
  daysOff: (DayOff & { id: number })[]
  bookings: BoardBooking[]
}

export type BoardPick = { measurerId: string; measurerName: string; date: string; time: string }

const WEEKDAY = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const MONTH = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
function dayLabel(date: string) {
  const d = new Date(`${date}T00:00:00Z`)
  return `${WEEKDAY[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`
}
const STATUS_MARK: Record<string, string> = { done: '✅', issue: '⚠️' }

export default function MeasureBoard(props: {
  title?: string
  refreshKey?: number
  pick?: { durationMin?: number; selected?: BoardPick | null; onPick: (p: BoardPick) => void }
}) {
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<BoardData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (weekOffset: number) => {
    setLoading(true)
    try {
      const from = new Date(Date.now() + 3 * 3600_000 + weekOffset * 7 * 86_400_000).toISOString().slice(0, 10)
      const res = await fetch(`/api/measure-requests/board?from=${from}&days=7`, { cache: 'no-store' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error || `Занятость не загрузилась (${res.status})`); return }
      setError(''); setData(j as BoardData)
    } finally { setLoading(false) }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(offset) }, [load, offset, props.refreshKey])

  const dur = props.pick?.durationMin ?? DEFAULT_DURATION_MIN
  const btn = 'text-[12px] font-semibold border border-[#e4e4e0] bg-white rounded-lg px-3 py-1.5 hover:bg-[#f5f5f3] disabled:opacity-40'

  return (
    <div className="bg-white rounded-xl border border-[#e4e4e0] p-3 sm:p-4">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95] mr-auto">{props.title ?? 'Занятость замерщиков'}</p>
        {/* Стрелки и «Сегодня» — одной группой: на телефоне не разъезжаются по строкам. */}
        <div className="flex items-center gap-1.5">
          <button onClick={() => setOffset(o => o - 1)} className={btn} aria-label="Неделя раньше">←</button>
          <button onClick={() => setOffset(0)} disabled={offset === 0} className={btn}>Сегодня</button>
          <button onClick={() => setOffset(o => o + 1)} className={btn} aria-label="Неделя позже">→</button>
        </div>
      </div>

      {error && <p className="text-[12px] text-red-600 mb-2">{error}</p>}
      {!data && loading && <p className="text-[12px] text-[#9a9a95]">Загрузка…</p>}

      {data && <BoardGrid data={data} dur={dur} loading={loading} pick={props.pick} />}
    </div>
  )
}

// Сетка недели без загрузки — отдельно, чтобы её можно было проверить на данных
// без сети (__tests__/measureBoardView.test.ts).
export function BoardGrid({ data, dur, loading, pick }: {
  data: BoardData
  dur: number
  loading?: boolean
  pick?: { durationMin?: number; selected?: BoardPick | null; onPick: (p: BoardPick) => void }
}) {
  const days = useMemo(() => {
    // Сегодня не предлагаем время, до которого замерщик уже не доедет.
    const notBefore = Math.ceil((data.nowMin + TRAVEL_MIN) / 30) * 30
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(data.from, i)
      const lanes = data.measurers.map(m => ({
        m,
        plan: planDay({
          date, measurerId: m.id, schedule: m.schedule, daysOff: data.daysOff, bookings: data.bookings,
          durationMin: dur, notBeforeMin: date === data.today ? notBefore : undefined,
        }),
      }))
      return { date, isToday: date === data.today, isPast: date < data.today, lanes }
    })
  }, [data, dur])

  const nearest = useMemo(() => {
    for (const d of days) {
      if (d.isPast) continue
      const hits = d.lanes.filter(l => l.plan.starts.length).map(l => ({ name: l.m.name, from: l.plan.starts[0].from }))
      if (hits.length) {
        const first = Math.min(...hits.map(h => h.from))
        return { date: d.date, time: fromMin(first), names: hits.filter(h => h.from === first).map(h => h.name) }
      }
    }
    return null
  }, [days])

  const sel = pick?.selected

  return (
    <>
      <div className="text-[12px] text-[#6b6b66] mb-3 space-y-0.5">
        {data.measurers.length > 0 && (
          <p>
            {nearest
              ? <>Ближайшее свободное: <b className="text-[#111110]">{dayLabel(nearest.date)}, с {nearest.time}</b> — {nearest.names.join(', ')}</>
              : 'На этой неделе свободных окон нет — листай дальше →'}
          </p>
        )}
        <p>
          {data.poolCount > 0 ? <>В пуле ждут замерщика: <b className="text-amber-700">{data.poolCount}</b> · </> : null}
          <span className="text-[#9a9a95]">Зелёное — когда можно начать замер на {dur} мин; дорога от предыдущего — {TRAVEL_MIN} мин или сколько заложил замерщик (🚗).</span>
        </p>
      </div>

      {data.measurers.length === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
          Замерщики ещё не заведены в приложении — доске некого показывать, заявки уходят в пул.
          {data.me.role === 'admin' || data.me.role === 'ceo'
            ? <> Заведи их в <Link href="/admin/users" className="underline font-semibold">«Пользователях»</Link> с ролью «Замерщик».</>
            : ' Владелец заводит их в «Пользователях» с ролью «Замерщик».'}
        </div>
      ) : (
        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 ${loading ? 'opacity-60' : ''}`}>
          {days.map(d => (
            <div key={d.date} className={`rounded-lg p-2.5 border ${d.isToday ? 'border-[#111110]' : 'border-[#e4e4e0]'} ${d.isPast ? 'bg-[#fafaf8] opacity-70' : 'bg-white'}`}>
              <p className="text-[12px] font-bold first-letter:uppercase mb-1.5">
                {dayLabel(d.date)}
                {d.isToday && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-emerald-600">сегодня</span>}
              </p>
              <div className="space-y-2">
                {d.lanes.map(({ m, plan }) => (
                  <div key={m.id}>
                    {data.measurers.length > 1 && <p className="text-[11px] font-semibold text-[#4b4b47]">📏 {m.name}</p>}
                    {plan.off ? (
                      <p className="text-[11px] text-[#9a9a95]">🌴 выходной{plan.off.note ? ` — ${plan.off.note}` : ''}</p>
                    ) : !plan.working ? (
                      <p className="text-[11px] text-[#9a9a95]">не работает по графику</p>
                    ) : null}
                    {plan.busy.map(b => {
                      const bb = b as BoardBooking
                      const from = mskMinutes(b.scheduled_at!)
                      const to = from + (b.duration_min || DEFAULT_DURATION_MIN)
                      return (
                        <div key={b.id} className={`border-l-2 pl-1.5 mt-1 ${bb.mine ? 'border-[#111110]' : 'border-[#c4c4be]'}`}>
                          {b.travel_min != null && b.travel_min !== TRAVEL_MIN && <p className="text-[10px] text-blue-700">🚗 дорога до него {b.travel_min} мин</p>}
                          <p className="text-[11px]">
                            <span className="font-mono font-semibold">{fromMin(from)}–{fromMin(to)}</span>
                            {' '}{STATUS_MARK[b.status ?? ''] ?? ''}
                            {bb.client_name ? ` ${bb.deal_number ? `${bb.deal_number} · ` : ''}${bb.client_name}` : ' занято'}
                          </p>
                          {bb.address && <p className="text-[10px] text-[#6b6b66]">📍 {bb.address}</p>}
                        </div>
                      )
                    })}
                    {!d.isPast && plan.starts.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {plan.starts.map(s => {
                          const label = s.from === s.to ? `в ${fromMin(s.from)}` : `${fromMin(s.from)}–${fromMin(s.to)}`
                          const isSel = sel && sel.measurerId === m.id && sel.date === d.date && s.from <= toMin(sel.time) && toMin(sel.time) <= s.to
                          return pick ? (
                            <button key={s.from}
                              onClick={() => pick!.onPick({ measurerId: m.id, measurerName: m.name, date: d.date, time: fromMin(s.from) })}
                              className={`text-[10px] font-mono rounded px-1.5 py-0.5 border ${isSel ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'}`}
                              title="Подставить замерщика, дату и время в заявку">
                              {label}
                            </button>
                          ) : (
                            <span key={s.from} className="text-[10px] font-mono rounded px-1.5 py-0.5 bg-emerald-50 text-emerald-700">{label}</span>
                          )
                        })}
                      </div>
                    )}
                    {!d.isPast && !plan.off && plan.working && plan.starts.length === 0 && (
                      <p className="text-[10px] text-[#9a9a95] mt-0.5">свободных окон нет</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
