'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'

// Диспетчеризация монтажей и замеров: неделя вперёд, наряды по дням,
// бригада + живые статусы (назначен → в пути → смонтирован / проблема).
// Данные — существующий /api/appointments; бригады — таблица brigades.

type Brigade = { id: string; name: string; lead_name: string | null; active: boolean }
type Appt = {
  id: string
  type: 'measurement' | 'installation'
  scheduled_at: string
  address: string | null
  assignee_name: string | null
  client_name: string | null
  notes: string | null
  status: string
  brigade_id: string | null
  orders?: { number?: string; client_name?: string } | null
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  planned:   { label: 'Назначен',     cls: 'bg-[#f0f0ec] text-[#6b6b66]' },
  on_way:    { label: '🚗 В пути',    cls: 'bg-blue-50 text-blue-700' },
  done:      { label: '✅ Выполнен',  cls: 'bg-emerald-50 text-emerald-700' },
  issue:     { label: '⚠️ Проблема',  cls: 'bg-red-50 text-red-700' },
  cancelled: { label: 'Отменён',      cls: 'bg-[#f0f0ec] text-[#c4c4be] line-through' },
}
const DAYS = 7

export default function InstallationsPage() {
  const sb = createClient()
  const [tab, setTab] = useState<'installation' | 'measurement'>('installation')
  const [appts, setAppts] = useState<Appt[]>([])
  const [brigades, setBrigades] = useState<Brigade[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  // форма наряда
  const [fClient, setFClient] = useState('')
  const [fAddress, setFAddress] = useState('')
  const [fDate, setFDate] = useState('')
  const [fTime, setFTime] = useState('10:00')
  const [fBrigade, setFBrigade] = useState('')
  const [fNotes, setFNotes] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const from = new Date(); from.setHours(0, 0, 0, 0)
    const to = new Date(from.getTime() + DAYS * 86400000)
    const [aRes, bRes] = await Promise.all([
      fetch(`/api/appointments?from=${from.toISOString()}&to=${to.toISOString()}`).then(r => r.json()).catch(() => []),
      sb.from('brigades').select('id, name, lead_name, active').eq('active', true).order('name'),
    ])
    setAppts(Array.isArray(aRes) ? aRes : [])
    setBrigades((bRes.data ?? []) as Brigade[])
    setLoading(false)
  }, [sb])

  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  const brigadeName = (id: string | null) => brigades.find(b => b.id === id)?.name ?? null

  const days = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    return Array.from({ length: DAYS }, (_, i) => {
      const d = new Date(start.getTime() + i * 86400000)
      const next = new Date(d.getTime() + 86400000)
      const items = appts
        .filter(a => a.type === tab)
        .filter(a => { const t = new Date(a.scheduled_at); return t >= d && t < next })
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
      return { d, items }
    })
  }, [appts, tab])

  async function setStatus(a: Appt, status: string) {
    setBusy(a.id)
    try {
      const patch: Record<string, unknown> = { id: a.id, status }
      if (status === 'issue') {
        const note = window.prompt('Что случилось?', '')
        if (note == null) return
        patch.notes = [a.notes, `⚠️ ${note}`].filter(Boolean).join('\n')
      }
      await fetch('/api/appointments', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      await load()
    } finally { setBusy(null) }
  }

  async function assignBrigade(a: Appt, brigadeId: string) {
    setBusy(a.id)
    try {
      await fetch('/api/appointments', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id, brigade_id: brigadeId || null }) })
      await load()
    } finally { setBusy(null) }
  }

  async function createAppt() {
    if (!fDate || (!fClient.trim() && !fAddress.trim())) return
    await fetch('/api/appointments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: tab, scheduled_at: new Date(`${fDate}T${fTime || '10:00'}:00`).toISOString(),
        client_name: fClient, address: fAddress, brigade_id: fBrigade || null, notes: fNotes,
      }),
    })
    setFClient(''); setFAddress(''); setFNotes('')
    await load()
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка…</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Монтажи и замеры</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">Наряды на неделю по дням: бригада, адрес, статус. Проблема пишется в заметку наряда.</p>
        <div className="flex gap-1.5 mt-3">
          {([['installation', '🔧 Монтажи'], ['measurement', '📐 Замеры']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium ${tab === k ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4]'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 pt-4 space-y-4 max-w-[1100px]">
        {/* Новый наряд */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95] mb-2">Новый наряд · {tab === 'installation' ? 'монтаж' : 'замер'}</p>
          <div className="flex flex-wrap gap-2">
            <input value={fClient} onChange={e => setFClient(e.target.value)} placeholder="Клиент"
              className="bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] w-44" />
            <input value={fAddress} onChange={e => setFAddress(e.target.value)} placeholder="Адрес"
              className="bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] flex-1 min-w-[200px]" />
            <input type="date" value={fDate} onChange={e => setFDate(e.target.value)}
              className="bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px]" />
            <input type="time" value={fTime} onChange={e => setFTime(e.target.value)}
              className="bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px]" />
            <select value={fBrigade} onChange={e => setFBrigade(e.target.value)}
              className="bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px]">
              <option value="">Бригада…</option>
              {brigades.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <input value={fNotes} onChange={e => setFNotes(e.target.value)} placeholder="Заметка"
              className="bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] w-44" />
            <button onClick={createAppt}
              className="bg-[#111110] text-white text-[12px] font-semibold px-3 py-1.5 rounded-lg hover:bg-[#2a2a28]">+ Создать</button>
          </div>
          {brigades.length === 0 && <p className="text-[11px] text-amber-600 mt-2">Бригад нет — заведи в Админ → Операции → Бригады.</p>}
        </div>

        {/* Неделя */}
        {days.map(({ d, items }) => (
          <div key={d.toISOString()} className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <p className="text-[12px] font-bold text-[#111110] mb-2 capitalize">
              {d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
              <span className="text-[#9a9a95] font-normal"> · {items.length} наряд(ов)</span>
            </p>
            {items.length === 0 ? (
              <p className="text-[12px] text-[#c4c4be]">Пусто</p>
            ) : (
              <div className="space-y-2">
                {items.map(a => {
                  const meta = STATUS_META[a.status] ?? STATUS_META.planned
                  return (
                    <div key={a.id} className={`border border-[#f0f0ec] rounded-lg p-3 ${busy === a.id ? 'opacity-50' : ''}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[13px] font-bold">{new Date(a.scheduled_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="text-[13px] font-medium">{a.client_name || a.orders?.client_name || a.assignee_name || '—'}</span>
                        {a.orders?.number && <span className="text-[11px] text-[#9a9a95]">заказ {a.orders.number}</span>}
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${meta.cls}`}>{meta.label}</span>
                        <select value={a.brigade_id ?? ''} onChange={e => assignBrigade(a, e.target.value)}
                          className="ml-auto bg-white border border-[#e4e4e0] rounded-lg px-2 py-1 text-[11px]">
                          <option value="">без бригады</option>
                          {brigades.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                      </div>
                      {a.address && <p className="text-[12px] text-[#6b6b66] mt-1">📍 {a.address}</p>}
                      {a.notes && <p className="text-[11px] text-[#9a9a95] mt-1 whitespace-pre-line">{a.notes}</p>}
                      <div className="flex gap-1.5 mt-2">
                        {a.status !== 'on_way' && a.status !== 'done' && (
                          <button onClick={() => setStatus(a, 'on_way')} className="text-[11px] border border-[#e4e4e0] rounded-lg px-2 py-1 hover:bg-[#f5f5f3]">🚗 В пути</button>
                        )}
                        {a.status !== 'done' && (
                          <button onClick={() => setStatus(a, 'done')} className="text-[11px] font-semibold bg-emerald-600 text-white rounded-lg px-2 py-1 hover:bg-emerald-700">✅ Выполнен</button>
                        )}
                        {a.status !== 'issue' && a.status !== 'done' && (
                          <button onClick={() => setStatus(a, 'issue')} className="text-[11px] border border-red-200 text-red-600 rounded-lg px-2 py-1 hover:bg-red-50">⚠️ Проблема</button>
                        )}
                        {(a.status === 'done' || a.status === 'issue' || a.status === 'on_way') && (
                          <button onClick={() => setStatus(a, 'planned')} className="text-[11px] text-[#9a9a95] px-2 py-1 hover:text-[#111110]">↩ вернуть в план</button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
