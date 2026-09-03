'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

// Календарь замеров — занятость замерщиков на 2 недели вперёд.
// Видят менеджеры, замерщики и владелец; заявки создаются в /measure-requests.

type MReq = {
  id: number
  deal_number: string | null
  client_name: string
  address: string | null
  scope: string | null
  measurer_name: string | null
  scheduled_at: string | null
  status: string
}

const DAY_MS = 86400000

export default function MeasureCalendarPage() {
  const sb = createClient()
  const [reqs, setReqs] = useState<MReq[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0) // недели от текущей

  const load = useCallback(async () => {
    const { data } = await sb.from('measure_requests')
      .select('id, deal_number, client_name, address, scope, measurer_name, scheduled_at, status')
      .not('scheduled_at', 'is', null)
      .in('status', ['scheduled', 'done', 'issue'])
      .order('scheduled_at', { ascending: true }).limit(500)
    setReqs((data ?? []) as MReq[])
    setLoading(false)
  }, [sb])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  const days = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const from = new Date(start.getTime() + offset * 7 * DAY_MS)
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(from.getTime() + i * DAY_MS)
      const next = new Date(d.getTime() + DAY_MS)
      const items = reqs
        .filter(r => { const t = new Date(r.scheduled_at!); return t >= d && t < next })
        .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))
      return { d, items, isToday: offset === 0 && i === 0 }
    })
  }, [reqs, offset])

  const busyCount = useMemo(() => days.reduce((s, x) => s + x.items.length, 0), [days])

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка…</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Календарь замеров</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">Занятость замерщиков на две недели. Новая заявка создаётся в «Заявках на замер», время назначает замерщик в своём кабинете.</p>
      </div>

      <div className="px-5 pt-4 max-w-[1100px]">
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => setOffset(o => o - 1)}
            className="text-[12px] font-semibold border border-[#e4e4e0] bg-white rounded-lg px-3 py-1.5 hover:bg-[#f5f5f3]">← Раньше</button>
          <button onClick={() => setOffset(0)} disabled={offset === 0}
            className="text-[12px] font-semibold border border-[#e4e4e0] bg-white rounded-lg px-3 py-1.5 hover:bg-[#f5f5f3] disabled:opacity-40">Сегодня</button>
          <button onClick={() => setOffset(o => o + 1)}
            className="text-[12px] font-semibold border border-[#e4e4e0] bg-white rounded-lg px-3 py-1.5 hover:bg-[#f5f5f3]">Позже →</button>
          <span className="ml-auto text-[12px] text-[#9a9a95]">{busyCount > 0 ? `Замеров в периоде: ${busyCount}` : 'В периоде свободно'}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {days.map(({ d, items, isToday }) => (
            <div key={d.toISOString()}
              className={`rounded-lg p-2.5 border ${isToday ? 'border-[#111110] bg-white' : items.length ? 'border-[#e4e4e0] bg-white' : 'border-[#f0f0ec] bg-[#fafaf8]'}`}>
              <p className="text-[11px] font-bold capitalize">
                {d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', weekday: 'short', day: 'numeric', month: 'short' })}
                {isToday && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-emerald-600">сегодня</span>}
              </p>
              {items.length === 0 ? <p className="text-[11px] text-[#c4c4be] mt-1">свободно</p> : (
                <div className="mt-1.5 space-y-1.5">
                  {items.map(r => (
                    <div key={r.id} className="border-l-2 border-[#111110] pl-2">
                      <p className="text-[11px] font-semibold">
                        <span className="font-mono">{new Date(r.scheduled_at!).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })}</span>
                        {' '}{r.status === 'done' ? '✅' : r.status === 'issue' ? '⚠️' : ''} {r.deal_number || `#${r.id}`} · {r.client_name}
                      </p>
                      {r.measurer_name && <p className="text-[10px] text-[#6b6b66]">📏 {r.measurer_name}</p>}
                      {r.address && <p className="text-[10px] text-[#9a9a95]">📍 {r.address}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
