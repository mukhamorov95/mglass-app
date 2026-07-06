'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'

// «Обзор за 60 секунд»: деньги и алерты владельца поверх менеджерской сводки.
// Дебиторка и касса — та же логика, что /cfo/receivables и /cfo/cashflow;
// план vs ТБ — из finplan_models (юниты mglass+production).

type Pulse = {
  debtSum: number; debtCount: number; topDebtor: string; topDebtorDays: number; over30: number
  cash: number; cash7: number
  planRevenue: number; tb1: number | null
  shopActive: number; shopQueued: number; shopProblems: number
  alerts: { text: string; href: string }[]
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const parseNotes = (raw: unknown): Record<string, any> => {
  if (!raw) return {}
  if (typeof raw === 'string') { try { return JSON.parse(raw) } catch { return {} } }
  return raw as Record<string, any>
}
const marginOf = (m: any): number => ((m?.incomes ?? []) as any[]).reduce((s, i) => {
  const varPct = ((i.vars ?? []) as any[]).reduce((x, v) => x + (Number(v.pct) || 0), 0) / 100
  return s + (Number(i.plan) || 0) * (1 - varPct)
}, 0)
const revenueOf = (m: any): number => ((m?.incomes ?? []) as any[]).reduce((s, i) => s + (Number(i.plan) || 0), 0)
const fixedOf = (m: any): number => ((m?.fixed ?? []) as any[]).reduce((s, f) => s + (Number(f.amount) || 0), 0)

export default function MoneyPulse() {
  const [p, setP] = useState<Pulse | null>(null)

  useEffect(() => {
    const sb = createClient()
    ;(async () => {
      try {
        const now = new Date()
        const today = new Date(now); today.setHours(0, 0, 0, 0)
        const in7d = new Date(today.getTime() + 7 * 86400000)
        const [{ data: orders }, { data: fp }, { data: pp }, { data: tasks }] = await Promise.all([
          sb.from('b2b_orders').select('id, custom_number, client_name, total_sale_inc_vat, total_after_discount, notes')
            .order('created_at', { ascending: false }).limit(1000),
          sb.from('finplan_models').select('unit,data'),
          sb.from('planned_payments').select('kind, amount, due_date').eq('status', 'planned'),
          sb.from('production_tasks').select('status'),
        ])
        // дебиторка + приходы 7 дней
        let debtSum = 0, debtCount = 0, over30 = 0, inflow7 = 0
        let topDebtor = '', topDebt = 0, topDebtorDays = 0
        for (const o of orders ?? []) {
          const n = parseNotes(o.notes); const st = (n.stages ?? {}) as Record<string, string>
          if (!['confirmed', 'agreed', 'sent'].includes(n.status ?? '')) continue
          if (!st.invoice_sent || st.invoice_paid || n.payment_status === 'paid') continue
          const total = (o.total_after_discount ?? o.total_sale_inc_vat ?? 0) as number
          const debt = Math.max(0, total - (Number(n.prepayment_amount) || 0))
          if (debt <= 0) continue
          const days = Math.floor((now.getTime() - new Date(st.invoice_sent).getTime()) / 86400000)
          debtSum += debt; debtCount++
          if (days > 30) over30++
          if (debt > topDebt) { topDebt = debt; topDebtor = `№${o.custom_number || o.id} ${o.client_name || ''}`.trim(); topDebtorDays = days }
          const expect = new Date(new Date(st.invoice_sent).getTime() + 14 * 86400000)
          if (expect <= in7d) inflow7 += debt
        }
        // касса
        let cash = 0, fixedMonthly = 0, planRevenue = 0, margin = 0
        for (const row of fp ?? []) {
          if (row.unit === 'total' && row.data?.cashBalance != null) cash = Number(row.data.cashBalance) || 0
          if (row.unit === 'mglass' || row.unit === 'production') {
            fixedMonthly += fixedOf(row.data)
            planRevenue += revenueOf(row.data)
            margin += marginOf(row.data)
          }
        }
        let outflow7 = 0
        const firstNext = new Date(today.getFullYear(), today.getMonth() + (today.getDate() === 1 ? 0 : 1), 1)
        if (firstNext < in7d) outflow7 += fixedMonthly
        for (const x of pp ?? []) {
          if (new Date(x.due_date) < in7d) {
            if (x.kind === 'out') outflow7 += Number(x.amount) || 0
            else inflow7 += Number(x.amount) || 0
          }
        }
        const cash7 = cash + inflow7 - outflow7
        // ТБ-1 компании (фонды юнитов игнорируем для простоты — без фондов = ТБ-0..ТБ-1 нижняя граница)
        const wPct = planRevenue > 0 ? margin / planRevenue : 0
        const tb1 = wPct > 0 ? fixedMonthly / wPct : null
        // цех
        const shopActive = (tasks ?? []).filter(t => t.status === 'in_progress').length
        const shopQueued = (tasks ?? []).filter(t => t.status === 'queued').length
        const shopProblems = (tasks ?? []).filter(t => t.status === 'problem').length
        // алерты
        const alerts: Pulse['alerts'] = []
        if (over30 > 0) alerts.push({ text: `Счета 30+ дней без оплаты: ${over30}`, href: '/cfo/receivables' })
        if (cash7 < 0) alerts.push({ text: `Кассовый разрыв в ближайшие 7 дней: ${fmt(cash7)}`, href: '/cfo/cashflow' })
        if (tb1 != null && planRevenue < tb1) alerts.push({ text: `План ${fmt(planRevenue)} ниже точки безубыточности ${fmt(tb1)}`, href: '/cfo/breakeven' })
        if (shopProblems > 0) alerts.push({ text: `Проблемы в цехе: ${shopProblems} задач(и)`, href: '/production-app/today' })
        setP({ debtSum, debtCount, topDebtor, topDebtorDays, over30, cash, cash7, planRevenue, tb1, shopActive, shopQueued, shopProblems, alerts })
      } catch { /* блок не критичен для страницы */ }
    })()
  }, [])

  if (!p) return null

  const cards = [
    { href: '/cfo/receivables', label: '💸 Дебиторка', value: fmt(p.debtSum), sub: p.debtCount ? `${p.debtCount} счёт(ов) · топ: ${p.topDebtor} (${p.topDebtorDays} дн)` : 'долгов нет', warn: p.over30 > 0 },
    { href: '/cfo/cashflow', label: '💰 Касса → 7 дней', value: `${fmt(p.cash)} → ${fmt(p.cash7)}`, sub: p.cash7 < 0 ? 'прогноз уходит в минус' : 'разрыва нет', warn: p.cash7 < 0 },
    { href: '/cfo/breakeven', label: '🎯 План vs ТБ', value: p.tb1 != null ? `${Math.round(p.planRevenue / p.tb1 * 100)}% от точки` : '—', sub: p.tb1 != null ? `план ${fmt(p.planRevenue)} · ТБ ${fmt(p.tb1)}` : 'заполни финмодель', warn: p.tb1 != null && p.planRevenue < p.tb1 },
    { href: '/production-app/today', label: '🏭 Цех', value: `${p.shopActive} в работе`, sub: `${p.shopQueued} в очереди${p.shopProblems ? ` · ⚠️ ${p.shopProblems} проблем` : ''}`, warn: p.shopProblems > 0 },
  ]

  return (
    <div className="mb-5">
      {p.alerts.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {p.alerts.map((a, i) => (
            <Link key={i} href={a.href} className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[12px] font-medium text-red-700 hover:bg-red-100">
              <span>🔴</span>{a.text}<span className="ml-auto text-red-400">→</span>
            </Link>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map(c => (
          <Link key={c.href} href={c.href}
            className={`bg-white border rounded-xl p-4 hover:shadow-sm transition-shadow ${c.warn ? 'border-amber-300' : 'border-[#e4e4e0]'}`}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#9a9a95]">{c.label}</p>
            <p className="text-[15px] font-bold font-mono text-[#111110] mt-1">{c.value}</p>
            <p className={`text-[11px] mt-0.5 ${c.warn ? 'text-amber-600' : 'text-[#9a9a95]'}`}>{c.sub}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
