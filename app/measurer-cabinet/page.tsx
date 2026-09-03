'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

// Кабинет замерщика: пул новых заявок → назначить дату/время → мой календарь
// (занято/свободно) → выполнен / сложность (проблема + решение, как у цеха)
// → мои деньги: сколько замеров, сколько причитается, сколько выплачено.

type MReq = {
  id: number
  deal_number: string | null
  client_name: string
  phone: string | null
  amo_url: string | null
  address: string | null
  scope: string | null
  notes: string | null
  visit_price: number
  payer: string | null
  is_repeat: boolean
  structured_text: string | null
  manager_name: string | null
  measurer_id: string | null
  measurer_name: string | null
  scheduled_at: string | null
  status: string
  issue_text: string | null
  issue_solution: string | null
  measurer_fee: number
  fee_status: string
  photos: string[] | null
  created_at: string
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'

export default function MeasurerCabinetPage() {
  const sb = createClient()
  const [me, setMe] = useState<{ id: string; name: string; role: string } | null>(null)
  const [reqs, setReqs] = useState<MReq[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const [schedFor, setSchedFor] = useState<number | null>(null)
  const [sDate, setSDate] = useState('')
  const [sTime, setSTime] = useState('10:00')

  const load = useCallback(async () => {
    const { data: { user } } = await sb.auth.getUser()
    if (user) {
      const { data: p } = await sb.from('users').select('id, name, role').eq('id', user.id).maybeSingle()
      if (p) setMe(p as { id: string; name: string; role: string })
    }
    const { data } = await sb.from('measure_requests').select('*')
      .order('created_at', { ascending: false }).limit(300)
    setReqs((data ?? []) as MReq[])
    setLoading(false)
  }, [sb])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  const isOwnerView = me?.role === 'admin' || me?.role === 'ceo'
  const pool = useMemo(() => reqs.filter(r => r.status === 'new'), [reqs])
  const mine = useMemo(() => reqs.filter(r => r.measurer_id === me?.id || (isOwnerView && r.measurer_id)), [reqs, me, isOwnerView])

  // Мой календарь: 7 дней, назначенные мне
  const week = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start.getTime() + i * 86400000)
      const next = new Date(d.getTime() + 86400000)
      const items = mine.filter(r => r.status === 'scheduled' && r.scheduled_at)
        .filter(r => { const t = new Date(r.scheduled_at!); return t >= d && t < next })
        .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))
      return { d, items }
    })
  }, [mine])

  // Деньги за текущий месяц
  const money = useMemo(() => {
    const m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0)
    const doneThisMonth = reqs.filter(r => r.measurer_id === me?.id && r.status === 'done'
      && r.scheduled_at && new Date(r.scheduled_at) >= m0)
    const earned = doneThisMonth.reduce((s, r) => s + (Number(r.measurer_fee) || 0), 0)
    const paid = doneThisMonth.filter(r => r.fee_status === 'paid').reduce((s, r) => s + (Number(r.measurer_fee) || 0), 0)
    return { count: doneThisMonth.length, earned, paid, pending: earned - paid }
  }, [reqs, me])

  async function take(r: MReq) {
    if (!me || !sDate) return
    setBusy(r.id)
    try {
      await sb.from('measure_requests').update({
        measurer_id: me.id, measurer_name: me.name,
        scheduled_at: new Date(`${sDate}T${sTime || '10:00'}:00`).toISOString(),
        status: 'scheduled', updated_at: new Date().toISOString(),
      }).eq('id', r.id)
      setSchedFor(null); setSDate('')
      await load()
    } finally { setBusy(null) }
  }

  async function setStatus(r: MReq, status: string) {
    setBusy(r.id)
    try {
      const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
      if (status === 'issue') {
        const issue = window.prompt('Какая сложность?', r.issue_text ?? '')
        if (issue == null) return
        const solution = window.prompt('Какое видишь решение?', r.issue_solution ?? '')
        patch.issue_text = issue; patch.issue_solution = solution
      }
      await sb.from('measure_requests').update(patch).eq('id', r.id)
      await load()
    } finally { setBusy(null) }
  }

  // Файл замера (чертёж/фото) с объекта → measure_requests.photos, виден в карточке сделки.
  async function attachFile(r: MReq, file: File) {
    setBusy(r.id)
    try {
      const fd = new FormData(); fd.append('file', file)
      await fetch(`/api/measure-requests/${r.id}/photo`, { method: 'POST', body: fd })
      await load()
    } finally { setBusy(null) }
  }

  async function markFeePaid(r: MReq) {
    setBusy(r.id)
    try {
      await sb.from('measure_requests').update({ fee_status: 'paid', fee_paid_at: new Date().toISOString() }).eq('id', r.id)
      await load()
    } finally { setBusy(null) }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка…</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Кабинет замерщика</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">Бери заявку из пула, договорись с клиентом и проставь дату — менеджеры увидят её в календаре.</p>
      </div>

      <div className="px-5 pt-4 space-y-4 max-w-[1100px]">
        {/* Деньги месяца */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-[#111110] text-white rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a8a85]">Замеров за месяц</p>
            <p className="text-[20px] font-bold font-mono mt-1">{money.count}</p>
          </div>
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#9a9a95]">Причитается</p>
            <p className="text-[18px] font-bold font-mono mt-1">{fmt(money.earned)}</p>
          </div>
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#9a9a95]">Выплачено</p>
            <p className="text-[18px] font-bold font-mono text-emerald-700 mt-1">{fmt(money.paid)}</p>
          </div>
          <div className={`rounded-xl p-4 border ${money.pending > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-[#e4e4e0]'}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${money.pending > 0 ? 'text-amber-700' : 'text-[#9a9a95]'}`}>Ожидает выплаты</p>
            <p className={`text-[18px] font-bold font-mono mt-1 ${money.pending > 0 ? 'text-amber-700' : ''}`}>{fmt(money.pending)}</p>
          </div>
        </div>

        {/* Пул новых заявок */}
        <div className={`rounded-xl border p-4 ${pool.length ? 'bg-amber-50 border-amber-200' : 'bg-white border-[#e4e4e0]'}`}>
          <p className={`text-[11px] font-bold uppercase tracking-widest ${pool.length ? 'text-amber-700' : 'text-[#9a9a95]'}`}>
            🆕 Новые заявки · {pool.length}
          </p>
          {pool.length === 0 ? <p className="text-[12px] text-[#c4c4be] mt-1">Пул пуст.</p> : (
            <div className="mt-2 space-y-2">
              {pool.map(r => (
                <div key={r.id} className={`bg-white border border-amber-100 rounded-lg p-3 ${busy === r.id ? 'opacity-50' : ''}`}>
                  <pre className="text-[12px] whitespace-pre-wrap font-sans">{r.structured_text || `${r.client_name} · ${r.address ?? ''}`}</pre>
                  <p className="text-[11px] text-[#9a9a95] mt-1">от {r.manager_name || 'менеджера'} · гонорар замерщика: <b>{fmt(r.measurer_fee)}</b></p>
                  {schedFor === r.id ? (
                    <div className="flex items-center gap-2 mt-2">
                      <input type="date" value={sDate} onChange={e => setSDate(e.target.value)}
                        className="bg-white border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px]" />
                      <input type="time" value={sTime} onChange={e => setSTime(e.target.value)}
                        className="bg-white border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px]" />
                      <button onClick={() => take(r)} disabled={!sDate || busy === r.id}
                        className="text-[12px] font-semibold bg-emerald-600 text-white rounded-lg px-3 py-1 hover:bg-emerald-700 disabled:opacity-40">✅ Назначить</button>
                      <button onClick={() => setSchedFor(null)} className="text-[12px] text-[#9a9a95]">отмена</button>
                    </div>
                  ) : (
                    <button onClick={() => setSchedFor(r.id)}
                      className="mt-2 text-[12px] font-semibold bg-[#111110] text-white rounded-lg px-3 py-1.5 hover:bg-[#2a2a28]">📅 Взять и назначить время</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Мой календарь */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95] mb-2">{isOwnerView ? 'Календарь замерщиков' : 'Мой календарь'} · неделя</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {week.map(({ d, items }) => (
              <div key={d.toISOString()} className="border border-[#f0f0ec] rounded-lg p-2.5">
                <p className="text-[11px] font-bold capitalize">{d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', weekday: 'short', day: 'numeric', month: 'short' })}</p>
                {items.length === 0 ? <p className="text-[11px] text-emerald-600 mt-1">свободно</p> : (
                  <div className="mt-1 space-y-1.5">
                    {items.map(r => (
                      <div key={r.id} className={busy === r.id ? 'opacity-50' : ''}>
                        <p className="text-[11px]">
                          <span className="font-mono font-semibold">{new Date(r.scheduled_at!).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })}</span>
                          {' '}{r.client_name}{isOwnerView && r.measurer_name ? ` · ${r.measurer_name}` : ''}
                        </p>
                        {r.address && <p className="text-[10px] text-[#9a9a95]">📍 {r.address}</p>}
                        <div className="flex items-center gap-1 mt-0.5">
                          <button onClick={() => setStatus(r, 'done')} className="text-[10px] bg-emerald-600 text-white rounded px-1.5 py-0.5">✅</button>
                          <button onClick={() => setStatus(r, 'issue')} className="text-[10px] border border-red-200 text-red-600 rounded px-1.5 py-0.5">⚠️</button>
                          <label className="text-[10px] border border-[#e4e4e0] text-[#4b4b47] rounded px-1.5 py-0.5 cursor-pointer hover:bg-[#f0f0ec]">
                            📎 файл
                            <input type="file" accept="image/*,application/pdf" className="hidden"
                              onChange={e => { const f = e.target.files?.[0]; if (f) attachFile(r, f); e.target.value = '' }} />
                          </label>
                          {Array.isArray(r.photos) && r.photos.length > 0 && <span className="text-[10px] text-[#9a9a95]">{r.photos.length} 📎</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* История: выполненные и сложности */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95] mb-2">Выполненные и сложности</p>
          {mine.filter(r => r.status === 'done' || r.status === 'issue').length === 0 ? (
            <p className="text-[12px] text-[#c4c4be]">Пока пусто.</p>
          ) : (
            <div className="space-y-2">
              {mine.filter(r => r.status === 'done' || r.status === 'issue').slice(0, 30).map(r => (
                <div key={r.id} className="border border-[#f0f0ec] rounded-lg p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-medium">{r.status === 'done' ? '✅' : '⚠️'} {r.deal_number || `#${r.id}`} · {r.client_name}</span>
                    {r.scheduled_at && <span className="text-[11px] text-[#9a9a95]">{new Date(r.scheduled_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}</span>}
                    {isOwnerView && r.measurer_name && <span className="text-[11px] text-[#9a9a95]">· {r.measurer_name}</span>}
                    <span className="text-[12px] font-mono ml-auto">{fmt(r.measurer_fee)}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${r.fee_status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {r.fee_status === 'paid' ? 'выплачено' : 'к выплате'}
                    </span>
                    {isOwnerView && r.status === 'done' && r.fee_status !== 'paid' && (
                      <button onClick={() => markFeePaid(r)} disabled={busy === r.id}
                        className="text-[11px] font-semibold bg-emerald-600 text-white rounded-lg px-2 py-1 hover:bg-emerald-700 disabled:opacity-40">💰 Выплачено</button>
                    )}
                  </div>
                  {r.issue_text && (
                    <p className="text-[12px] text-red-600 mt-1">⚠️ {r.issue_text}{r.issue_solution ? ` → 💡 ${r.issue_solution}` : ''}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
