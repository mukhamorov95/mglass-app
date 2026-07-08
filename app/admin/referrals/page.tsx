'use client'

import { useEffect, useState, useCallback } from 'react'

// Реферальная программа — экран владельца. Задаёт сотруднику ставку %, добавляет
// его клиентов и вносит их оборот по месяцам. Сотрудник видит итог в «Мой заработок».

type User = { id: string; name: string | null; email: string | null; role: string | null; referral_rate_pct: number | null }
type Client = { id: number; referrer_id: string; name: string; note: string | null }
type Turnover = { referral_client_id: number; ym: string; amount: number }

const L = 'block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1'
const I = 'border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] bg-white'
const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU')
const MONTHS = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']
const ymLabel = (ym: string) => { const [y, m] = ym.split('-'); return `${MONTHS[Number(m) - 1] ?? m} ${y}` }

export default function ReferralsAdminPage() {
  const [users, setUsers] = useState<User[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [turnover, setTurnover] = useState<Turnover[]>([])
  const [loading, setLoading] = useState(true)
  const [newPartner, setNewPartner] = useState('')
  const [newRate, setNewRate] = useState('1')

  const load = useCallback(async () => {
    const r = await fetch('/api/referrals').then(x => x.json()).catch(() => null)
    if (r) { setUsers(r.users ?? []); setClients(r.clients ?? []); setTurnover(r.turnover ?? []) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const post = async (body: Record<string, unknown>) => {
    await fetch('/api/referrals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    await load()
  }

  const partners = users.filter(u => u.referral_rate_pct != null)
  const nonPartners = users.filter(u => u.referral_rate_pct == null)
  const clientsOf = (rid: string) => clients.filter(c => c.referrer_id === rid)
  const turnoverOf = (cid: number) => turnover.filter(t => t.referral_client_id === cid).sort((a, b) => a.ym.localeCompare(b.ym))

  if (loading) return <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка…</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div>
          <h1 className="text-[18px] font-semibold text-[#111110]">Реферальная программа</h1>
          <p className="text-[12px] text-[#9a9a95] mt-0.5">Сотрудник получает % от оборота приведённых клиентов. Задайте ставку, добавьте клиентов и внесите оборот по месяцам — сотрудник увидит заработок в своём кабинете.</p>
        </div>

        {/* Добавить партнёра */}
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
          <p className="text-[13px] font-semibold text-[#111110] mb-3">Назначить партнёра</p>
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[200px]"><label className={L}>Сотрудник</label>
              <select className={`${I} w-full`} value={newPartner} onChange={e => setNewPartner(e.target.value)}>
                <option value="">— выберите —</option>
                {nonPartners.map(u => <option key={u.id} value={u.id}>{u.name ?? u.email} · {u.role}</option>)}
              </select>
            </div>
            <div className="w-24"><label className={L}>Ставка %</label><input className={`${I} w-full`} value={newRate} onChange={e => setNewRate(e.target.value)} /></div>
            <button disabled={!newPartner} onClick={() => { post({ action: 'set_rate', userId: newPartner, rate: newRate }); setNewPartner('') }}
              className="px-4 py-2 bg-[#111110] text-white text-[13px] font-medium rounded-lg disabled:opacity-40">Назначить</button>
          </div>
        </div>

        {/* Партнёры */}
        {partners.length === 0 && <div className="bg-white border border-[#e4e4e0] rounded-xl p-8 text-center text-[13px] text-[#9a9a95]">Пока нет партнёров. Назначьте сотрудника выше.</div>}
        {partners.map(p => (
          <PartnerCard key={p.id} p={p} clients={clientsOf(p.id)} turnoverOf={turnoverOf} post={post} />
        ))}
      </div>
    </div>
  )
}

function PartnerCard({ p, clients, turnoverOf, post }: {
  p: User; clients: Client[]; turnoverOf: (cid: number) => Turnover[]
  post: (b: Record<string, unknown>) => Promise<void>
}) {
  const [rate, setRate] = useState(String(p.referral_rate_pct ?? ''))
  const [cName, setCName] = useState('')
  const [cNote, setCNote] = useState('')
  const rateNum = Number(rate) || 0

  const total2026 = clients.reduce((s, c) =>
    s + turnoverOf(c.id).filter(t => t.ym.startsWith('2026')).reduce((a, t) => a + Number(t.amount), 0), 0)
  const earned2026 = Math.round(total2026 * rateNum / 100)

  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div>
          <p className="text-[15px] font-semibold text-[#111110]">{p.name ?? p.email}</p>
          <p className="text-[11px] text-[#9a9a95]">{p.role} · оборот 2026: {RUB(total2026)} ₽ → заработок {RUB(earned2026)} ₽</p>
        </div>
        <div className="flex items-end gap-2">
          <div className="w-20"><label className={L}>Ставка %</label>
            <input className={`${I} w-full`} value={rate} onChange={e => setRate(e.target.value)}
              onBlur={() => { if (rate !== String(p.referral_rate_pct ?? '')) post({ action: 'set_rate', userId: p.id, rate }) }} />
          </div>
          <button onClick={() => { if (confirm('Убрать сотрудника из партнёрской программы?')) post({ action: 'set_rate', userId: p.id, rate: null }) }}
            className="text-[11px] text-red-400 hover:text-red-600 pb-2.5">убрать</button>
        </div>
      </div>

      <div className="space-y-2">
        {clients.map(c => <ClientRow key={c.id} c={c} turnover={turnoverOf(c.id)} rate={rateNum} post={post} />)}
        {clients.length === 0 && <p className="text-[12px] text-[#9a9a95]">Клиентов пока нет — добавьте ниже.</p>}
      </div>

      <div className="flex items-end gap-2 mt-3 pt-3 border-t border-[#f0f0ec] flex-wrap">
        <div className="flex-1 min-w-[160px]"><label className={L}>Новый клиент</label><input className={`${I} w-full`} value={cName} onChange={e => setCName(e.target.value)} placeholder="Имя / компания" /></div>
        <div className="flex-1 min-w-[120px]"><label className={L}>Заметка</label><input className={`${I} w-full`} value={cNote} onChange={e => setCNote(e.target.value)} placeholder="необязательно" /></div>
        <button disabled={!cName.trim()} onClick={() => { post({ action: 'add_client', referrerId: p.id, name: cName, note: cNote }); setCName(''); setCNote('') }}
          className="px-4 py-2 bg-[#E1442E] text-white text-[13px] font-medium rounded-lg disabled:opacity-40">+ клиент</button>
      </div>
    </div>
  )
}

function ClientRow({ c, turnover, rate, post }: {
  c: Client; turnover: Turnover[]; rate: number; post: (b: Record<string, unknown>) => Promise<void>
}) {
  const [ym, setYm] = useState('2026-01')
  const [amount, setAmount] = useState('')
  const sorted = [...turnover].sort((a, b) => a.ym.localeCompare(b.ym))
  const clientTotal = sorted.reduce((s, t) => s + Number(t.amount), 0)

  return (
    <div className="border border-[#f0f0ec] rounded-lg p-2.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-[13px] font-medium text-[#111110]">{c.name}{c.note ? <span className="text-[#9a9a95] font-normal"> · {c.note}</span> : ''}</p>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#6b6b66]">Σ {RUB(clientTotal)} ₽ → {RUB(clientTotal * rate / 100)} ₽</span>
          <button onClick={() => { if (confirm('Удалить клиента и его обороты?')) post({ action: 'del_client', clientId: c.id }) }} className="text-[#c4c4be] hover:text-red-500 text-[13px]">✕</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 items-center">
        {sorted.map(t => {
          const ymShort = t.ym.slice(0, 7)
          return (
            <label key={t.ym} className="flex items-center gap-1 bg-[#f5f5f3] rounded-md px-1.5 py-1">
              <span className="text-[10px] text-[#9a9a95] w-12">{ymLabel(ymShort)}</span>
              <input defaultValue={String(Number(t.amount))} onBlur={e => { const v = e.target.value; if (Number(v) !== Number(t.amount)) post({ action: 'set_turnover', clientId: c.id, ym: ymShort, amount: v }) }}
                className="w-24 border border-[#e4e4e0] rounded px-1.5 py-0.5 text-[12px] outline-none focus:border-[#111110] bg-white" />
            </label>
          )
        })}
      </div>
      <div className="flex items-end gap-1.5 mt-2">
        <div><label className={L}>Месяц</label><input type="month" value={ym} onChange={e => setYm(e.target.value)} className={`${I} py-1`} /></div>
        <div><label className={L}>Оборот ₽</label><input value={amount} onChange={e => setAmount(e.target.value)} className={`${I} py-1 w-28`} placeholder="0" /></div>
        <button disabled={!amount || !ym} onClick={() => { post({ action: 'set_turnover', clientId: c.id, ym, amount }); setAmount('') }}
          className="px-3 py-1.5 bg-[#111110] text-white text-[12px] font-medium rounded-lg disabled:opacity-40">Внести</button>
      </div>
    </div>
  )
}
