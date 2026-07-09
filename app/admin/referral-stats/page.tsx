'use client'

import { useEffect, useState } from 'react'

// Сводка по партнёрам (владелец): сколько клиентов привёл каждый, оборот и
// заработок — итого и помесячно с 2026 года, с раскладкой по клиентам.

type User = { id: string; name: string | null; email: string | null; role: string | null; referral_rate_pct: number | null }
type Client = { id: number; referrer_id: string; name: string; note: string | null; b2b_client_id: number | null }
type Turnover = { referral_client_id: number; ym: string; amount: number }
type AutoTurnover = Record<number, { ym: string; amount: number }[]>

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU')
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']
const ymTitle = (ym: string) => { const [y, m] = ym.split('-'); return `${MONTHS[Number(m) - 1] ?? m} ${y}` }

export default function ReferralStatsPage() {
  const [users, setUsers] = useState<User[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [turnover, setTurnover] = useState<Turnover[]>([])
  const [autoTurnover, setAutoTurnover] = useState<AutoTurnover>({})
  const [loading, setLoading] = useState(true)
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set())

  async function load() {
    const r = await fetch('/api/referrals').then(x => x.json()).catch(() => null)
    if (r) { setUsers(r.users ?? []); setClients(r.clients ?? []); setTurnover(r.turnover ?? []); setAutoTurnover(r.autoTurnover ?? {}) }
    setLoading(false)
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [])

  const partners = users.filter(u => u.referral_rate_pct != null)
  const rowsOf = (c: Client): Turnover[] => c.b2b_client_id != null
    ? (autoTurnover[c.id] ?? []).map(t => ({ referral_client_id: c.id, ym: t.ym, amount: t.amount }))
    : turnover.filter(t => t.referral_client_id === c.id)

  if (loading) return <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка…</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[18px] font-semibold text-[#111110]">Партнёры — сводка</h1>
            <p className="text-[12px] text-[#9a9a95] mt-0.5">Кто сколько привёл, оборот и заработок — итого и помесячно с 2026 года.</p>
          </div>
          <a href="/admin/referrals" className="text-[12px] font-medium px-3 py-2 rounded-lg bg-white border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] transition-colors">← Управление партнёрами</a>
        </div>

        {partners.length === 0 && <div className="bg-white border border-[#e4e4e0] rounded-xl p-8 text-center text-[13px] text-[#9a9a95]">Партнёров пока нет.</div>}

        {partners.map(p => {
          const myClients = clients.filter(c => c.referrer_id === p.id)
          const rate = Number(p.referral_rate_pct) || 0
          // все строки оборота партнёра за 2026+
          const rows = myClients.flatMap(c => rowsOf(c).map(t => ({ ...t, clientName: c.name })))
            .filter(t => t.ym >= '2026-01-01')
          const total = rows.reduce((s, t) => s + Number(t.amount), 0)
          const earned = Math.round(total * rate / 100)
          // помесячно, свежие сверху
          const byMonth = new Map<string, typeof rows>()
          for (const t of rows) { const k = t.ym.slice(0, 7); const g = byMonth.get(k) ?? []; g.push(t); byMonth.set(k, g) }
          const months = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]))
          const activeClients = new Set(rows.map(t => t.referral_client_id)).size

          return (
            <div key={p.id} className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              {/* Табло партнёра */}
              <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                <p className="text-[15px] font-semibold text-[#111110]">{p.name ?? p.email} <span className="text-[11px] font-normal text-[#9a9a95]">· ставка {rate}%</span></p>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-[#f8f8f7] rounded-lg px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95]">Клиентов</p>
                  <p className="text-[18px] font-bold text-[#111110]">{myClients.length}<span className="text-[11px] font-normal text-[#9a9a95] ml-1">акт. {activeClients}</span></p>
                </div>
                <div className="bg-[#f8f8f7] rounded-lg px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95]">Оборот 2026</p>
                  <p className="text-[18px] font-bold text-[#111110]">{RUB(total)} ₽</p>
                </div>
                <div className="bg-emerald-50 rounded-lg px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600">Заработал</p>
                  <p className="text-[18px] font-bold text-emerald-700">{RUB(earned)} ₽</p>
                </div>
              </div>

              {/* Помесячно */}
              {months.length === 0 ? (
                <p className="text-[12px] text-[#9a9a95]">Оборота за 2026 пока нет.</p>
              ) : (
                <div className="space-y-1.5">
                  {months.map(([mk, list]) => {
                    const mTotal = list.reduce((s, t) => s + Number(t.amount), 0)
                    const key = `${p.id}:${mk}`
                    const open = openMonths.has(key)
                    return (
                      <div key={mk} className="border border-[#f0f0ec] rounded-lg overflow-hidden">
                        <button
                          onClick={() => setOpenMonths(prev => { const n = new Set(prev); if (open) { n.delete(key) } else { n.add(key) } return n })}
                          className="w-full px-3 py-2 flex items-center justify-between gap-2 hover:bg-[#fafaf9] transition-colors">
                          <span className="text-[13px] font-medium text-[#111110]">{ymTitle(mk)}</span>
                          <span className="text-[12px] text-[#6b6b66]">
                            {new Set(list.map(t => t.referral_client_id)).size} кл. · {RUB(mTotal)} ₽ →
                            <span className="font-semibold text-emerald-700"> {RUB(mTotal * rate / 100)} ₽</span>
                            <span className="text-[#c4c4be] ml-1.5">{open ? '▾' : '▸'}</span>
                          </span>
                        </button>
                        {open && (
                          <div className="border-t border-[#f0f0ec] divide-y divide-[#f8f8f7]">
                            {list.sort((a, b) => Number(b.amount) - Number(a.amount)).map((t, i) => (
                              <div key={i} className="px-3 py-1.5 flex items-center justify-between">
                                <span className="text-[12px] text-[#111110]">{t.clientName}</span>
                                <span className="text-[12px] text-[#6b6b66]">{RUB(Number(t.amount))} ₽ → <span className="text-emerald-700">{RUB(Number(t.amount) * rate / 100)} ₽</span></span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
