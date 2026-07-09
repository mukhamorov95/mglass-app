'use client'

import { useEffect, useState } from 'react'
import ProductionTabs from '@/components/ProductionTabs'

// «Мой заработок» — кабинет партнёра. Табло: активные клиенты, общий оборот,
// заработано. Помесячно с 2026: клиенты месяца, оборот каждого и начисление.
// Оборот привязанных к CRM клиентов считается автоматически по заказам
// (/api/referrals/my), для остальных — данные вносит руководитель.

type Client = { id: number; name: string; note: string | null; linked: boolean }
type Turnover = { referral_client_id: number; ym: string; amount: number; source: 'auto' | 'manual' }

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU')
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']
const pad = (n: number) => String(n).padStart(2, '0')

export default function EarningsPage() {
  const [loading, setLoading] = useState(true)
  const [rate, setRate] = useState<number | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [turnover, setTurnover] = useState<Turnover[]>([])
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set())

  async function load() {
    try {
      const r = await fetch('/api/referrals/my')
      const j = await r.json()
      setRate(j.rate ?? null)
      setClients(j.clients ?? [])
      setTurnover(j.turnover ?? [])
    } finally { setLoading(false) }
  }
   
  useEffect(() => { load() }, [])

  const rateNum = rate ?? 0
  const now = new Date()
  const curYm = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`

  const turn = (rows: Turnover[]) => rows.reduce((s, t) => s + Number(t.amount), 0)
  const earn = (rows: Turnover[]) => Math.round(turn(rows) * rateNum / 100)

  const in2026 = turnover.filter(t => t.ym >= '2026-01-01')
  const thisMonth = in2026.filter(t => t.ym.slice(0, 7) === curYm)
  const activePartners = new Set(in2026.map(t => t.referral_client_id)).size

  const byMonth = new Map<string, Turnover[]>()
  for (const t of in2026) { const k = t.ym.slice(0, 7); const g = byMonth.get(k) ?? []; g.push(t); byMonth.set(k, g) }
  const months = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]))

  const clientName = new Map(clients.map(c => [c.id, c.name]))

  if (loading) return <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка…</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Мой заработок</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">
          {rate != null ? `${rate}% от оборота приведённых клиентов` : 'Реферальная программа'}
        </p>
        <ProductionTabs />
      </div>

      {rate == null ? (
        <div className="px-4 pt-4 max-w-[720px] mx-auto">
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center">
            <p className="text-[14px] text-[#111110] font-medium">Вы пока не участвуете в реферальной программе</p>
            <p className="text-[13px] text-[#9a9a95] mt-1">Если вы приводите клиентов — обратитесь к руководителю, чтобы подключить процент от оборота.</p>
          </div>
        </div>
      ) : (
        <div className="px-4 pt-4 max-w-[720px] mx-auto space-y-4">
          {/* Табло */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white rounded-xl border border-[#e4e4e0] p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95]">Клиентов</p>
              <p className="text-[22px] font-bold text-[#111110] mt-0.5">{clients.length}</p>
              <p className="text-[10px] text-[#9a9a95]">активных: {activePartners}</p>
            </div>
            <div className="bg-white rounded-xl border border-[#e4e4e0] p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95]">Оборот 2026</p>
              <p className="text-[22px] font-bold text-[#111110] mt-0.5 tracking-tight">{RUB(turn(in2026))} ₽</p>
              <p className="text-[10px] text-[#9a9a95]">{MONTHS[now.getMonth()]}: {RUB(turn(thisMonth))} ₽</p>
            </div>
            <div className="bg-[#111110] rounded-xl p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">Заработано</p>
              <p className="text-[22px] font-bold text-white mt-0.5 tracking-tight">{RUB(earn(in2026))} ₽</p>
              <p className="text-[10px] text-white/50">{MONTHS[now.getMonth()]}: {RUB(earn(thisMonth))} ₽</p>
            </div>
          </div>

          {/* Помесячно с раскладкой по клиентам */}
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <p className="text-[13px] font-semibold text-[#111110] mb-3">По месяцам · 2026</p>
            {months.length === 0 ? (
              <p className="text-[13px] text-[#9a9a95]">Оборота за 2026 пока нет.</p>
            ) : (
              <div className="space-y-1.5">
                {months.map(([ym, rows]) => {
                  const m = Number(ym.split('-')[1]) - 1
                  const open = openMonths.has(ym)
                  const monthClients = new Set(rows.map(t => t.referral_client_id)).size
                  return (
                    <div key={ym} className="border border-[#f0f0ec] rounded-lg overflow-hidden">
                      <button
                        onClick={() => setOpenMonths(prev => { const n = new Set(prev); if (open) { n.delete(ym) } else { n.add(ym) } return n })}
                        className="w-full px-3 py-2 flex items-center justify-between gap-2 hover:bg-[#fafaf9] transition-colors">
                        <span className="text-[13px] font-medium text-[#111110]">{MONTHS[m]}</span>
                        <span className="flex items-center gap-2.5">
                          <span className="text-[11px] text-[#9a9a95]">{monthClients} кл. · {RUB(turn(rows))} ₽</span>
                          <span className="text-[14px] font-semibold text-emerald-700">{RUB(earn(rows))} ₽</span>
                          <span className="text-[#c4c4be] text-[11px]">{open ? '▾' : '▸'}</span>
                        </span>
                      </button>
                      {open && (
                        <div className="border-t border-[#f0f0ec] divide-y divide-[#f8f8f7]">
                          {rows.sort((a, b) => Number(b.amount) - Number(a.amount)).map((t, i) => (
                            <div key={i} className="px-3 py-1.5 flex items-center justify-between">
                              <span className="text-[12px] text-[#111110] truncate">{clientName.get(t.referral_client_id) ?? '—'}</span>
                              <span className="text-[12px] text-[#6b6b66] flex-shrink-0">{RUB(Number(t.amount))} ₽ → <span className="text-emerald-700 font-medium">{RUB(Number(t.amount) * rateNum / 100)} ₽</span></span>
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

          {/* Мои клиенты */}
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <p className="text-[13px] font-semibold text-[#111110] mb-3">Мои клиенты · {clients.length}</p>
            {clients.length === 0 ? (
              <p className="text-[13px] text-[#9a9a95]">Клиенты пока не добавлены.</p>
            ) : (
              <div className="space-y-1.5">
                {clients.map(c => {
                  const rows = in2026.filter(t => t.referral_client_id === c.id)
                  return (
                    <div key={c.id} className="flex items-center justify-between py-1.5 border-b border-[#f5f5f3] last:border-0">
                      <span className="text-[13px] text-[#111110] truncate">
                        {c.name}
                        {c.linked && <span className="ml-1.5 text-[9px] font-bold px-1.5 py-px rounded-full bg-emerald-50 text-emerald-700">авто</span>}
                      </span>
                      <span className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-[12px] text-[#9a9a95]">оборот {RUB(turn(rows))} ₽</span>
                        <span className="text-[14px] font-semibold text-[#111110] w-24 text-right">{RUB(earn(rows))} ₽</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <p className="text-[11px] text-[#9a9a95] px-1">Оборот клиентов с пометкой «авто» считается по заказам в системе; остальных вносит руководитель. Начисление — {rate}% от оборота.</p>
        </div>
      )}
    </div>
  )
}
