'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

// Реферальная программа — экран владельца. Ставка %, клиенты партнёра, оборот.
// Клиент партнёра может быть ПРИВЯЗАН к карточке B2B-клиента (CRM) — тогда его
// оборот считается автоматически из заказов (b2b_orders, помесячно с 2026).
// Непривязанные клиенты — ручной ввод оборота, как раньше.

type User = { id: string; name: string | null; email: string | null; role: string | null; referral_rate_pct: number | null }
type Client = { id: number; referrer_id: string; name: string; note: string | null; b2b_client_id: number | null }
type Turnover = { referral_client_id: number; ym: string; amount: number }
type AutoTurnover = Record<number, { ym: string; amount: number }[]>
type B2BOption = { id: number; name: string }

const L = 'block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1'
const I = 'border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] bg-white'
const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU')
const MONTHS = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']
const ymLabel = (ym: string) => { const [y, m] = ym.split('-'); return `${MONTHS[Number(m) - 1] ?? m} ${y}` }

export default function ReferralsAdminPage() {
  const [users, setUsers] = useState<User[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [turnover, setTurnover] = useState<Turnover[]>([])
  const [autoTurnover, setAutoTurnover] = useState<AutoTurnover>({})
  const [b2bOptions, setB2bOptions] = useState<B2BOption[]>([])
  const [loading, setLoading] = useState(true)
  const [newPartner, setNewPartner] = useState('')
  const [newRate, setNewRate] = useState('1')
  const [toast, setToast] = useState<string | null>(null)

  async function load() {
    const [r, b2b] = await Promise.all([
      fetch('/api/referrals').then(x => x.json()).catch(() => null),
      createClient().from('b2b_clients').select('id,name').eq('active', true).order('name'),
    ])
    if (r) {
      setUsers(r.users ?? []); setClients(r.clients ?? [])
      setTurnover(r.turnover ?? []); setAutoTurnover(r.autoTurnover ?? {})
    }
    setB2bOptions((b2b.data ?? []) as B2BOption[])
    setLoading(false)
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [])

  const post = async (body: Record<string, unknown>) => {
    const r = await fetch('/api/referrals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      setToast(j.error ?? 'Ошибка'); setTimeout(() => setToast(null), 3000)
    }
    await load()
  }

  const partners = users.filter(u => u.referral_rate_pct != null)
  const nonPartners = users.filter(u => u.referral_rate_pct == null)
  const clientsOf = (rid: string) => clients.filter(c => c.referrer_id === rid)
  // итоговый оборот клиента: авто для привязанных, ручной для остальных
  const rowsOf = (c: Client): Turnover[] => c.b2b_client_id != null
    ? (autoTurnover[c.id] ?? []).map(t => ({ referral_client_id: c.id, ym: t.ym, amount: t.amount }))
    : turnover.filter(t => t.referral_client_id === c.id)
  const linkedIds = new Set(clients.map(c => c.b2b_client_id).filter(Boolean))

  if (loading) return <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка…</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      {toast && <div className="fixed top-4 right-4 z-50 bg-red-600 text-white text-[12px] px-4 py-2.5 rounded-xl shadow-lg">{toast}</div>}
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[18px] font-semibold text-[#111110]">Реферальная программа</h1>
            <p className="text-[12px] text-[#9a9a95] mt-0.5">Партнёр получает % от оборота приведённых клиентов. Привязанные к CRM клиенты считаются автоматически по заказам; остальных вносите вручную.</p>
          </div>
          <a href="/admin/referral-stats" className="text-[12px] font-medium px-3 py-2 rounded-lg bg-white border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] transition-colors">📊 Сводка по партнёрам →</a>
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
          <PartnerCard key={p.id} p={p} clients={clientsOf(p.id)} rowsOf={rowsOf} post={post}
            b2bOptions={b2bOptions.filter(o => !linkedIds.has(o.id))} />
        ))}
      </div>
    </div>
  )
}

function PartnerCard({ p, clients, rowsOf, post, b2bOptions }: {
  p: User; clients: Client[]; rowsOf: (c: Client) => Turnover[]
  post: (b: Record<string, unknown>) => Promise<void>
  b2bOptions: B2BOption[]
}) {
  const [rate, setRate] = useState(String(p.referral_rate_pct ?? ''))
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [pickId, setPickId] = useState('')
  const [cName, setCName] = useState('')
  const [cNote, setCNote] = useState('')
  const [createInCrm, setCreateInCrm] = useState(true)
  const rateNum = Number(rate) || 0

  const total2026 = clients.reduce((s, c) =>
    s + rowsOf(c).filter(t => t.ym.startsWith('2026')).reduce((a, t) => a + Number(t.amount), 0), 0)
  const earned2026 = Math.round(total2026 * rateNum / 100)

  async function addClient() {
    if (mode === 'existing') {
      if (!pickId) return
      await post({ action: 'add_client', referrerId: p.id, b2bClientId: Number(pickId), note: cNote })
      setPickId('')
    } else {
      if (!cName.trim()) return
      await post({ action: 'add_client', referrerId: p.id, name: cName, note: cNote, createInCrm })
      setCName('')
    }
    setCNote('')
  }

  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div>
          <p className="text-[15px] font-semibold text-[#111110]">{p.name ?? p.email}</p>
          <p className="text-[11px] text-[#9a9a95]">{p.role} · клиентов: {clients.length} · оборот 2026: {RUB(total2026)} ₽ → заработок {RUB(earned2026)} ₽</p>
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
        {clients.map(c => <ClientRow key={c.id} c={c} turnover={rowsOf(c)} rate={rateNum} post={post} />)}
        {clients.length === 0 && <p className="text-[12px] text-[#9a9a95]">Клиентов пока нет — добавьте ниже.</p>}
      </div>

      {/* Добавление клиента: существующий из CRM или новый (сразу в CRM) */}
      <div className="mt-3 pt-3 border-t border-[#f0f0ec]">
        <div className="flex gap-1.5 mb-2">
          <button onClick={() => setMode('existing')}
            className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${mode === 'existing' ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66]'}`}>
            Из B2B-клиентов
          </button>
          <button onClick={() => setMode('new')}
            className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${mode === 'new' ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66]'}`}>
            Новый клиент
          </button>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          {mode === 'existing' ? (
            <div className="flex-1 min-w-[200px]"><label className={L}>Клиент из CRM (оборот — автоматически)</label>
              <select className={`${I} w-full`} value={pickId} onChange={e => setPickId(e.target.value)}>
                <option value="">— выберите клиента —</option>
                {b2bOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          ) : (
            <>
              <div className="flex-1 min-w-[160px]"><label className={L}>Имя / компания</label>
                <input className={`${I} w-full`} value={cName} onChange={e => setCName(e.target.value)} placeholder="Новый клиент" /></div>
              <label className="flex items-center gap-1.5 pb-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={createInCrm} onChange={e => setCreateInCrm(e.target.checked)} className="w-3.5 h-3.5 accent-[#111110]" />
                <span className="text-[11px] text-[#6b6b66]">создать в B2B-клиентах</span>
              </label>
            </>
          )}
          <div className="flex-1 min-w-[120px]"><label className={L}>Заметка</label>
            <input className={`${I} w-full`} value={cNote} onChange={e => setCNote(e.target.value)} placeholder="необязательно" /></div>
          <button disabled={mode === 'existing' ? !pickId : !cName.trim()} onClick={addClient}
            className="px-4 py-2 bg-[#E1442E] text-white text-[13px] font-medium rounded-lg disabled:opacity-40">+ клиент</button>
        </div>
      </div>
    </div>
  )
}

function ClientRow({ c, turnover, rate, post }: {
  c: Client; turnover: Turnover[]; rate: number; post: (b: Record<string, unknown>) => Promise<void>
}) {
  const [ym, setYm] = useState('2026-01')
  const [amount, setAmount] = useState('')
  const linked = c.b2b_client_id != null
  const sorted = [...turnover].sort((a, b) => a.ym.localeCompare(b.ym))
  const clientTotal = sorted.reduce((s, t) => s + Number(t.amount), 0)

  return (
    <div className="border border-[#f0f0ec] rounded-lg p-2.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-[13px] font-medium text-[#111110]">
          {c.name}
          {linked && <span className="ml-1.5 text-[9px] font-bold px-1.5 py-px rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">CRM · авто</span>}
          {c.note ? <span className="text-[#9a9a95] font-normal"> · {c.note}</span> : ''}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#6b6b66]">Σ {RUB(clientTotal)} ₽ → {RUB(clientTotal * rate / 100)} ₽</span>
          <button onClick={() => { if (confirm('Удалить клиента из партнёрки? (карточка в CRM останется)')) post({ action: 'del_client', clientId: c.id }) }} className="text-[#c4c4be] hover:text-red-500 text-[13px]">✕</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 items-center">
        {sorted.length === 0 && <span className="text-[11px] text-[#b0b0aa]">{linked ? 'заказов с 2026 пока нет' : 'оборот не внесён'}</span>}
        {sorted.map(t => {
          const ymShort = t.ym.slice(0, 7)
          return linked ? (
            <span key={t.ym} className="flex items-center gap-1 bg-emerald-50 border border-emerald-100 rounded-md px-2 py-1">
              <span className="text-[10px] text-emerald-700 w-12">{ymLabel(ymShort)}</span>
              <span className="text-[12px] font-medium text-emerald-800">{RUB(Number(t.amount))} ₽</span>
            </span>
          ) : (
            <label key={t.ym} className="flex items-center gap-1 bg-[#f5f5f3] rounded-md px-1.5 py-1">
              <span className="text-[10px] text-[#9a9a95] w-12">{ymLabel(ymShort)}</span>
              <input defaultValue={String(Number(t.amount))} onBlur={e => { const v = e.target.value; if (Number(v) !== Number(t.amount)) post({ action: 'set_turnover', clientId: c.id, ym: ymShort, amount: v }) }}
                className="w-24 border border-[#e4e4e0] rounded px-1.5 py-0.5 text-[12px] outline-none focus:border-[#111110] bg-white" />
            </label>
          )
        })}
      </div>
      {!linked && (
        <div className="flex items-end gap-1.5 mt-2">
          <div><label className={L}>Месяц</label><input type="month" value={ym} onChange={e => setYm(e.target.value)} className={`${I} py-1`} /></div>
          <div><label className={L}>Оборот ₽</label><input value={amount} onChange={e => setAmount(e.target.value)} className={`${I} py-1 w-28`} placeholder="0" /></div>
          <button disabled={!amount || !ym} onClick={() => { post({ action: 'set_turnover', clientId: c.id, ym, amount }); setAmount('') }}
            className="px-3 py-1.5 bg-[#111110] text-white text-[12px] font-medium rounded-lg disabled:opacity-40">Внести</button>
        </div>
      )}
    </div>
  )
}
