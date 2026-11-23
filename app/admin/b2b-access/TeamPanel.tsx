'use client'

import { useEffect, useState } from 'react'
import { loadJson } from '@/lib/toast'
import { TEAM_ROLE_RU, type TeamRole } from '@/lib/partner/teamRoles'

// Команда клиента глазами M-Glass: кто входит, роль, логин, когда заходил, сколько просчётов.
// Паролей нет нигде — только хеш в Supabase Auth.

type Member = {
  userId: string; name: string | null; email: string | null; role: TeamRole; primary: boolean; disabled: boolean
  invitedBy: string | null; lastSeen: string | null; days30: number; quotes30: number; passwordSet: boolean
}
type Resp = { team: Member[]; seats: { used: number; max: number }; ownerName: string | null }

const fmt = (s: string | null) => s ? new Date(s).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export default function TeamPanel({ clientId }: { clientId: number }) {
  const [data, setData] = useState<Resp | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [max, setMax] = useState('')
  const [owner, setOwner] = useState('')
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const apply = (r: Awaited<ReturnType<typeof loadJson<Resp>>>) => {
    if (r.error === null) { setData(r.data); setMax(String(r.data.seats.max)); setOwner(r.data.ownerName ?? ''); setErr(null) } else setErr(r.error)
  }
  const load = () => loadJson<Resp>(`/api/admin/b2b-team?clientId=${clientId}`).then(apply)
  useEffect(() => { loadJson<Resp>(`/api/admin/b2b-team?clientId=${clientId}`).then(apply) }, [clientId])

  async function save() {
    setSaveMsg(null)
    const res = await fetch('/api/admin/b2b-team', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, maxMembers: Number(max), ownerName: owner }) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setSaveMsg(d.error || `Не сохранено (${res.status})`); return }
    setSaveMsg('Сохранено'); await load()
  }

  if (err) return <p className="text-[12px] text-red-600 mt-2">Команда не загрузилась: {err}</p>
  if (!data) return <p className="text-[12px] text-[#9a9a95] mt-2">Загрузка команды…</p>

  const active = data.team.filter(m => !m.disabled)
  const seen30 = active.filter(m => m.days30 > 0).length

  return (
    <div className="mt-3 rounded-lg border border-[#e4e4e0] bg-[#fafaf8] p-3">
      <p className="text-[12.5px] text-[#111110]">
        Людей: <b>{active.length}</b> из {data.seats.max} мест · заходили за 30 дней: <b>{seen30}</b>
        {data.team.length > active.length ? ` · отключено: ${data.team.length - active.length}` : ''}
      </p>
      <div className="overflow-x-auto mt-2">
        <table className="w-full min-w-[640px] text-[12px]">
          <thead className="text-left text-[#9a9a95]">
            <tr><th className="py-1 pr-2 font-medium">Человек</th><th className="py-1 pr-2 font-medium">Логин</th><th className="py-1 pr-2 font-medium">Роль</th>
              <th className="py-1 pr-2 font-medium">Последний вход</th><th className="py-1 pr-2 font-medium text-right">Дней за 30</th><th className="py-1 font-medium text-right">Просчётов за 30</th></tr>
          </thead>
          <tbody>
            {data.team.map(m => (
              <tr key={m.userId} className={`border-t border-[#ecece8] ${m.disabled ? 'text-[#9a9a95]' : 'text-[#111110]'}`}>
                <td className="py-1.5 pr-2">{m.name ?? '—'}{m.primary ? ' · основной вход' : ''}{m.invitedBy && !m.primary ? <span className="text-[#9a9a95]"> · пригласил {m.invitedBy}</span> : null}</td>
                <td className="py-1.5 pr-2 font-mono">{m.email ?? '—'}</td>
                <td className="py-1.5 pr-2">{TEAM_ROLE_RU[m.role]}{m.disabled ? ' · отключён' : ''}</td>
                <td className="py-1.5 pr-2 tabular-nums">{m.passwordSet ? fmt(m.lastSeen) : 'пароль не задан'}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{m.days30}</td>
                <td className="py-1.5 text-right tabular-nums">{m.quotes30}</td>
              </tr>
            ))}
            {data.team.length === 0 && <tr><td colSpan={6} className="py-2 text-[#9a9a95]">Пока никого</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-2 mt-3">
        <label className="text-[11px] text-[#9a9a95]">Руководитель (основной вход)
          <input value={owner} onChange={e => setOwner(e.target.value)} placeholder="Имя" maxLength={80}
            className="block mt-0.5 bg-white border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] text-[#111110] w-48" /></label>
        <label className="text-[11px] text-[#9a9a95]">Мест
          <input value={max} onChange={e => setMax(e.target.value)} inputMode="numeric"
            className="block mt-0.5 bg-white border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] text-[#111110] w-16" /></label>
        <button onClick={save} className="text-[12px] px-3 py-1.5 rounded-lg bg-[#1d1d1f] text-white font-semibold hover:bg-black">Сохранить</button>
        {saveMsg && <span className={`text-[11px] ${saveMsg === 'Сохранено' ? 'text-emerald-700' : 'text-red-600'}`}>{saveMsg}</span>}
      </div>
      <p className="text-[11px] text-[#9a9a95] mt-2">«Дней за 30» — дни, когда человек открывал приложение; «Просчётов» — созданные им в кабинете. Пароли не хранятся в открытом виде и нигде не показываются.</p>
    </div>
  )
}
