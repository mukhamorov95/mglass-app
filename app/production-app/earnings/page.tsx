'use client'

import { useEffect, useState, useCallback } from 'react'
import ProductionTabs from '@/components/ProductionTabs'
import { createClient } from '@/lib/supabase-browser'

// «Мой заработок» — реферальный кабинет сотрудника (напр. Одилет на сверловке).
// Read-only: владелец ведёт клиентов и оборот, здесь сотрудник видит свой доход
// (ставка % от оборота приведённых клиентов) за текущий месяц и итого за 2026.

type Client = { id: number; name: string; note: string | null }
type Turnover = { referral_client_id: number; ym: string; amount: number }

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU')
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']
const pad = (n: number) => String(n).padStart(2, '0')

export default function EarningsPage() {
  const sb = createClient()
  const [loading, setLoading] = useState(true)
  const [rate, setRate] = useState<number | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [turnover, setTurnover] = useState<Turnover[]>([])

  const load = useCallback(async () => {
    const { data: { user } } = await sb.auth.getUser()
    if (!user) { setLoading(false); return }
    const { data: profile } = await sb.from('users').select('referral_rate_pct').eq('id', user.id).single()
    const r = (profile as { referral_rate_pct: number | null } | null)?.referral_rate_pct ?? null
    setRate(r)
    const { data: cl } = await sb.from('referral_clients').select('id,name,note').eq('referrer_id', user.id)
    const list = (cl ?? []) as Client[]
    setClients(list)
    if (list.length) {
      const { data: tv } = await sb.from('referral_turnover').select('referral_client_id,ym,amount').in('referral_client_id', list.map(c => c.id))
      setTurnover((tv ?? []) as Turnover[])
    }
    setLoading(false)
  }, [sb])
  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  const rateNum = rate ?? 0
  const now = new Date()
  const curYm = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`

  const earn = (rows: Turnover[]) => Math.round(rows.reduce((s, t) => s + Number(t.amount), 0) * rateNum / 100)
  const turn = (rows: Turnover[]) => rows.reduce((s, t) => s + Number(t.amount), 0)

  const in2026 = turnover.filter(t => t.ym.startsWith('2026'))
  const thisMonth = turnover.filter(t => t.ym.slice(0, 7) === curYm)

  // Помесячная разбивка за 2026.
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
          {/* Итоговые карточки */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95]">{MONTHS[now.getMonth()]} {now.getFullYear()}</p>
              <p className="text-[26px] font-bold text-[#111110] mt-1 tracking-tight">{RUB(earn(thisMonth))} ₽</p>
              <p className="text-[11px] text-[#9a9a95] mt-0.5">оборот {RUB(turn(thisMonth))} ₽</p>
            </div>
            <div className="bg-[#111110] rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-white/50">Итого за 2026</p>
              <p className="text-[26px] font-bold text-white mt-1 tracking-tight">{RUB(earn(in2026))} ₽</p>
              <p className="text-[11px] text-white/50 mt-0.5">оборот {RUB(turn(in2026))} ₽</p>
            </div>
          </div>

          {/* Помесячно */}
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <p className="text-[13px] font-semibold text-[#111110] mb-3">По месяцам · 2026</p>
            {months.length === 0 ? (
              <p className="text-[13px] text-[#9a9a95]">Оборота за 2026 пока нет.</p>
            ) : (
              <div className="space-y-1.5">
                {months.map(([ym, rows]) => {
                  const m = Number(ym.split('-')[1]) - 1
                  return (
                    <div key={ym} className="flex items-center justify-between py-1.5 border-b border-[#f5f5f3] last:border-0">
                      <span className="text-[13px] text-[#111110]">{MONTHS[m]}</span>
                      <span className="flex items-center gap-3">
                        <span className="text-[12px] text-[#9a9a95]">оборот {RUB(turn(rows))} ₽</span>
                        <span className="text-[14px] font-semibold text-emerald-700 w-24 text-right">{RUB(earn(rows))} ₽</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* По клиентам */}
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
                      <span className="text-[13px] text-[#111110] truncate">{clientName.get(c.id)}</span>
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

          <p className="text-[11px] text-[#9a9a95] px-1">Данные вносит руководитель. Начисление — {rate}% от подтверждённого оборота приведённых вами клиентов.</p>
        </div>
      )}
    </div>
  )
}
