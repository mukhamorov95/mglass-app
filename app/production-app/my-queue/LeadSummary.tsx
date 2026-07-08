'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { STAGE_LABELS, type DetailStageKey } from '@/lib/productionStages'

// Сводка по мастерам — видна только ответственному (production_lead) и owner.
// По каждому мастеру: сегодня (сделано+осталось) / сделано сегодня / осталось,
// по его станциям (открытый пул: активные задачи станции + закрытые сегодня).

type Master = { id: string; name: string | null; email: string | null; production_stations: string[] | null }
type TaskLite = { station: string; status: string; completed_at: string | null }

const OWNER = new Set(['admin', 'ceo'])

export default function LeadSummary() {
  const sb = createClient()
  const [show, setShow] = useState(false)
  const [masters, setMasters] = useState<Master[]>([])
  const [active, setActive] = useState<TaskLite[]>([])
  const [doneToday, setDoneToday] = useState<TaskLite[]>([])
  const [pick, setPick] = useState<string>('all')

  const load = useCallback(async () => {
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return
    const { data: me } = await sb.from('users').select('role,production_lead').eq('id', user.id).single()
    const isLead = !!(me as { role: string | null; production_lead: boolean } | null)?.production_lead || OWNER.has((me as { role: string | null } | null)?.role ?? '')
    if (!isLead) return
    setShow(true)

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const [{ data: ms }, { data: act }, { data: dn }] = await Promise.all([
      sb.from('users').select('id,name,email,production_stations').eq('role', 'production').eq('active', true),
      sb.from('production_tasks').select('station,status,completed_at').in('status', ['queued', 'in_progress']),
      sb.from('production_tasks').select('station,status,completed_at').eq('status', 'done').gte('completed_at', todayStart.toISOString()),
    ])
    setMasters((ms ?? []) as Master[])
    setActive((act ?? []) as TaskLite[])
    setDoneToday((dn ?? []) as TaskLite[])
  }, [sb])
  useEffect(() => { load().catch(() => {}) }, [load])

  if (!show) return null

  const countAt = (rows: TaskLite[], stations: string[]) => rows.filter(t => stations.includes(t.station)).length
  const rows = masters.filter(m => pick === 'all' || m.id === pick).map(m => {
    const st = m.production_stations ?? []
    const left = countAt(active, st), done = countAt(doneToday, st)
    return { m, st, left, done, total: left + done }
  })
  const totLeft = countAt(active, [...new Set(masters.flatMap(m => m.production_stations ?? []))])
  const totDone = doneToday.length

  return (
    <div className="bg-white rounded-xl border border-[#e4e4e0] p-4 mb-4">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <p className="text-[13px] font-semibold text-[#111110]">Сводка по мастерам · сегодня</p>
        <select value={pick} onChange={e => setPick(e.target.value)} className="border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-[#111110] bg-white">
          <option value="all">Все мастера</option>
          {masters.map(m => <option key={m.id} value={m.id}>{m.name ?? m.email}</option>)}
        </select>
      </div>

      <div className="flex gap-2 mb-3">
        <div className="flex-1 bg-[#f5f5f3] rounded-lg px-3 py-2"><p className="text-[11px] text-[#9a9a95]">Сделано сегодня</p><p className="text-[18px] font-bold text-emerald-700">{totDone}</p></div>
        <div className="flex-1 bg-[#f5f5f3] rounded-lg px-3 py-2"><p className="text-[11px] text-[#9a9a95]">Осталось</p><p className="text-[18px] font-bold text-[#111110]">{totLeft}</p></div>
      </div>

      <div className="space-y-1.5">
        {rows.map(({ m, st, left, done, total }) => (
          <div key={m.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-[#f5f5f3] last:border-0">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-[#111110] truncate">{m.name ?? m.email}</p>
              <p className="text-[11px] text-[#9a9a95] truncate">{st.length ? st.map(s => STAGE_LABELS[s as DetailStageKey] ?? s).join(' · ') : 'станции не заданы'}</p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0 text-[12px]">
              <span className="text-[#9a9a95]">сегодня {total}</span>
              <span className="text-emerald-700 font-medium">сделано {done}</span>
              <span className="text-[#111110] font-semibold">осталось {left}</span>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-[12px] text-[#9a9a95]">Нет мастеров.</p>}
      </div>
    </div>
  )
}
