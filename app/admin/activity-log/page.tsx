'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { TABLES, describe, type LogEntry } from '@/lib/activityLogView'
import { mskDayKey } from '@/lib/time'
import { plural } from '@/lib/morning'

// Журнал действий — только владельцу (RLS activity_log: is_owner()). Кто, когда, в
// каком разделе, что было и что стало. Пишет триггер базы на ключевых таблицах
// (миграция 20261006_margin_edits_audit): правки людей подписаны их именем,
// утренние сверки книг и кроны — «система».

const PAGE = 300
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const mskStart = (d: string) => new Date(`${d}T00:00:00+03:00`).toISOString()
const fmtTime = (s: string) => new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })
const TONE = { add: 'bg-emerald-50 text-emerald-700', edit: 'bg-blue-50 text-blue-700', del: 'bg-red-50 text-red-700', info: 'bg-[#f5f5f3] text-[#6b6b66]' }
const PLACES = Object.entries(TABLES).filter(([k]) => k !== 'user')

export default function ActivityLogPage() {
  const today = mskDayKey()
  const [from, setFrom] = useState(addDays(today, -6))
  const [to, setTo] = useState(today)
  const [people, setPeople] = useState(true)
  const [place, setPlace] = useState('')
  const [who, setWho] = useState('')
  const [users, setUsers] = useState<{ id: string; name: string }[]>([])
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [sales, setSales] = useState(new Map<number, { order_no: string | null; client: string | null }>())
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (offset: number) => {
    setLoading(true); setError(null)
    const sb = createClient()
    let q = sb.from('activity_log').select('*')
      .gte('created_at', mskStart(from)).lt('created_at', mskStart(addDays(to, 1)))
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + PAGE - 1)
    if (people) q = q.neq('user_name', 'система')
    if (place) q = q.in('entity_type', place === 'users' ? ['users', 'user'] : [place])
    if (who) q = q.eq('user_id', who)
    const { data, error: err } = await q
    if (err) { setError(err.message); setLoading(false); return }
    const rows = (data ?? []) as LogEntry[]
    const ids = [...new Set(rows.filter(r => r.entity_type === 'margin_edits').map(r => Number((r.entity_id ?? '').split(' · ')[0])).filter(Boolean))]
    const found = new Map<number, { order_no: string | null; client: string | null }>()
    if (ids.length) {
      const { data: s, error: sErr } = await sb.from('crm_sales').select('id, order_no, client').in('id', ids)
      if (sErr) setError(`номера заказов не подтянулись: ${sErr.message}`)
      for (const x of (s ?? []) as { id: number; order_no: string | null; client: string | null }[]) found.set(x.id, x)
    }
    setSales(prev => (offset ? new Map([...prev, ...found]) : found))
    setEntries(prev => (offset ? [...prev, ...rows] : rows))
    setMore(rows.length === PAGE)
    setLoading(false)
  }, [from, to, people, place, who])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(0) }, [load])
  useEffect(() => {
    createClient().from('users').select('id, name, email').order('name').then(({ data }) =>
      setUsers(((data ?? []) as { id: string; name: string | null; email: string | null }[]).map(u => ({ id: u.id, name: u.name ?? u.email ?? u.id }))))
  }, [])

  const input = 'h-8 border border-[#e4e4e0] rounded-lg px-2.5 text-[12px] outline-none focus:border-[#9a9a95] bg-white text-[#4b4b47]'

  return (
    <div className="min-h-screen bg-[#f8f8f7] p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h1 className="text-[18px] font-semibold text-[#111110]">Журнал действий</h1>
            <p className="text-[12px] text-[#6b6b66] mt-0.5 max-w-[640px]">
              Кто, когда и что изменил: продажи, маржа, платежи, планы, права пользователей, КП, договоры, расчёты, настройки цен и мотивации.
              Пишется с 05.10.2026; утренние сверки книг и кроны подписаны «система».
            </p>
          </div>
          <button onClick={() => load(0)} className="px-3 py-1.5 text-[12px] border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-[#f5f5f3]">Обновить</button>
        </div>

        <div className="flex gap-2 mb-4 flex-wrap items-center">
          <label className="text-[12px] text-[#6b6b66]">с</label>
          <input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} className={input} />
          <label className="text-[12px] text-[#6b6b66]">по</label>
          <input type="date" value={to} min={from} max={today} onChange={e => e.target.value && setTo(e.target.value)} className={input} />
          <select value={place} onChange={e => setPlace(e.target.value)} className={input}>
            <option value="">Все разделы</option>
            {PLACES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select value={who} onChange={e => setWho(e.target.value)} className={input}>
            <option value="">Все сотрудники</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-[12px] text-[#4b4b47]">
            <input type="checkbox" checked={!people} onChange={e => setPeople(!e.target.checked)} />
            показывать «систему»
          </label>
          <span className="ml-auto text-[11px] text-[#6b6b66]">{entries.length}{more ? '+' : ''} {plural(entries.length, 'запись', 'записи', 'записей')}</span>
        </div>

        <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
          {error && <p role="alert" className="px-4 py-3 text-[13px] text-red-700 border-b border-[#f0f0ec]">Журнал не загрузился: {error}</p>}
          {!loading && !error && entries.length === 0 && (
            <p className="p-8 text-center text-[13px] text-[#6b6b66]">За эти дни {people ? 'люди ничего не меняли' : 'записей нет'}.</p>
          )}
          {entries.length > 0 && (
            <table className="w-full text-[12px]">
              <thead className="bg-[#fafaf9] border-b border-[#e4e4e0] text-[10px] font-semibold text-[#6b6b66] uppercase tracking-widest">
                <tr>
                  <th className="text-left px-4 py-2.5 w-28">Когда</th>
                  <th className="text-left px-3 py-2.5 w-32">Кто</th>
                  <th className="text-left px-3 py-2.5 w-44">Что и где</th>
                  <th className="text-left px-3 py-2.5">Было → стало</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f3f3f0]">
                {entries.map(e => {
                  const d = describe(e, sales)
                  return (
                    <tr key={e.id} className="align-top hover:bg-[#fafaf9]">
                      <td className="px-4 py-2.5 text-[11px] text-[#6b6b66] tabular-nums whitespace-nowrap">{fmtTime(e.created_at)}</td>
                      <td className="px-3 py-2.5 font-medium text-[#111110]">{e.user_name ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${TONE[d.tone]}`}>{d.verb}</span>
                        <span className="block text-[12px] text-[#111110] mt-1">{d.place}</span>
                        {d.object && <span className="block text-[11px] text-[#6b6b66]">{d.object}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-[12px] text-[#3d3d3a]">
                        {d.changes.length === 0 && <span className="text-[#9a9a95]">—</span>}
                        {d.changes.map((c, i) => (
                          <span key={i} className="block">
                            <span className="text-[#6b6b66]">{c.what}:</span>{' '}
                            {c.before && <span className={d.tone === 'del' ? 'text-red-700' : 'text-[#6b6b66] line-through decoration-[#c4c4be]'}>{c.before}</span>}
                            {c.before && c.after && ' → '}
                            {c.after && <span className="text-[#111110] font-medium">{c.after}</span>}
                          </span>
                        ))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {loading && <p className="p-6 text-center text-[13px] text-[#6b6b66]">Загрузка…</p>}
          {more && !loading && (
            <button onClick={() => load(entries.length)} className="w-full py-3 text-[12px] text-blue-600 hover:bg-[#fafaf9] border-t border-[#f0f0ec]">Показать ещё</button>
          )}
        </div>
      </div>
    </div>
  )
}
