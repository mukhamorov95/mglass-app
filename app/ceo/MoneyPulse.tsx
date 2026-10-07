'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import { loadJson } from '@/lib/toast'
import { revenueToCover, splitFixed, companyFixed, type FixedRow } from '@/lib/breakeven'
import { expectedInflow, type Receivables } from '@/lib/money/receivables'

// «Обзор за 60 секунд»: деньги и алерты владельца поверх менеджерской сводки.
// Долг клиентов — одна функция на все экраны (/api/accounting/receivables, как /cfo/receivables,
// прогноз кассы и утренняя сводка); касса — та же логика, что /cfo/cashflow;
// план vs операционная ТБ — из finplan_models (юниты mglass+production).

type Pulse = {
  debtSum: number; debtCount: number; topDebtor: string; topDebtorDays: number; over30: number
  debtError: string | null; coverage: Receivables['coverage'] | null
  cash: number; cash7: number
  planRevenue: number; tb0: number | null
  shopActive: number; shopQueued: number; shopProblems: number
  alerts: { text: string; href: string }[]
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
type PnlIncome = { plan?: unknown; vars?: { pct?: unknown }[] }
type PnlMonth = { incomes?: PnlIncome[]; fixed?: { amount?: unknown }[] } | null | undefined
const marginOf = (m: PnlMonth): number => (m?.incomes ?? []).reduce((s, i) => {
  const varPct = (i.vars ?? []).reduce((x, v) => x + (Number(v.pct) || 0), 0) / 100
  return s + (Number(i.plan) || 0) * (1 - varPct)
}, 0)
const revenueOf = (m: PnlMonth): number => (m?.incomes ?? []).reduce((s, i) => s + (Number(i.plan) || 0), 0)
const fixedOf = (m: PnlMonth): number => (m?.fixed ?? []).reduce((s, f) => s + (Number(f.amount) || 0), 0)

export default function MoneyPulse() {
  const [p, setP] = useState<Pulse | null>(null)

  useEffect(() => {
    const sb = createClient()
    ;(async () => {
      try {
        const now = new Date()
        const today = new Date(now); today.setHours(0, 0, 0, 0)
        const in7d = new Date(today.getTime() + 7 * 86400000)
        // Задачи цеха — счётчиками: строк больше 1000, и выборка упиралась в потолок PostgREST.
        const tasksWith = (status: string) => sb.from('production_tasks').select('id', { count: 'exact', head: true }).eq('status', status)
        const [{ data: fp }, { data: pp }, active, queued, problems, rec] = await Promise.all([
          sb.from('finplan_models').select('unit,data'),
          sb.from('planned_payments').select('kind, amount, due_date').eq('status', 'planned'),
          tasksWith('in_progress'), tasksWith('queued'), tasksWith('problem'),
          loadJson<Receivables>('/api/accounting/receivables'),
        ])
        // Долг клиентов: запущенные заказы минус оплаты из payments. Не загрузился — так и
        // пишем, а не 0 ₽: ноль здесь читается как «никто не должен».
        let debtSum = 0, debtCount = 0, over30 = 0, inflow7 = 0
        let topDebtor = '', topDebtorDays = 0
        const debtError = rec.error
        if (rec.data) {
          debtSum = rec.data.total
          debtCount = rec.data.count
          over30 = rec.data.rows.filter(r => r.days > 30).length
          const top = [...rec.data.rows].sort((a, b) => b.debt - a.debt)[0]
          if (top) { topDebtor = `${top.ref} ${top.client}`.trim(); topDebtorDays = top.days }
          inflow7 = expectedInflow(rec.data.rows, rec.data.today)
        }
        // касса
        let cash = 0, fixedMonthly = 0, fixedPnl = 0, planRevenue = 0, margin = 0
        for (const row of fp ?? []) {
          if (row.unit === 'total' && row.data?.cashBalance != null) cash = Number(row.data.cashBalance) || 0
          if (row.unit === 'mglass' || row.unit === 'production') {
            fixedMonthly += fixedOf(row.data)
            fixedPnl += splitFixed((row.data?.fixed ?? []) as FixedRow[]).pnl
            planRevenue += revenueOf(row.data)
            margin += marginOf(row.data)
          }
        }
        // нераспределённый остаток общих статей (если владелец сохранил суммы по компании)
        const extra = companyFixed((fp ?? []) as { unit: string; data: unknown }[]).extra.reduce((s, f) => s + f.amount, 0)
        fixedMonthly += extra
        fixedPnl += extra
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
        // Операционная точка безубыточности компании — без фондов
        const tb0 = revenueToCover(fixedPnl, planRevenue > 0 ? margin / planRevenue : 0)
        // цех
        const shopActive = active.count ?? 0
        const shopQueued = queued.count ?? 0
        const shopProblems = problems.count ?? 0
        // алерты
        const alerts: Pulse['alerts'] = []
        if (over30 > 0) alerts.push({ text: `Заказы с долгом 30+ дней: ${over30}`, href: '/cfo/receivables' })
        if (cash7 < 0) alerts.push({ text: `Кассовый разрыв в ближайшие 7 дней: ${fmt(cash7)}`, href: '/cfo/cashflow' })
        if (tb0 != null && planRevenue < tb0) alerts.push({ text: `План ${fmt(planRevenue)} ниже операционной точки безубыточности ${fmt(tb0)}`, href: '/cfo/breakeven' })
        if (shopProblems > 0) alerts.push({ text: `Проблемы в цехе: ${shopProblems} задач(и)`, href: '/production-app/today' })
        setP({ debtSum, debtCount, topDebtor, topDebtorDays, over30, debtError, coverage: rec.data?.coverage ?? null, cash, cash7, planRevenue, tb0, shopActive, shopQueued, shopProblems, alerts })
      } catch { /* блок не критичен для страницы */ }
    })()
  }, [])

  if (!p) return null

  const cards = [
    p.debtError
      ? { href: '/cfo/receivables', label: '💸 Долг клиентов', value: '—', sub: `не загрузился: ${p.debtError}`, warn: true }
      : {
          href: '/cfo/receivables', label: '💸 Долг клиентов', value: fmt(p.debtSum),
          sub: (p.debtCount ? `${p.debtCount} заказ(ов) · топ: ${p.topDebtor} (${p.topDebtorDays} дн)` : 'долгов нет')
            + (p.coverage ? ` · оплаты заведены у ${p.coverage.withPayment} из ${p.coverage.orders}` : ''),
          warn: p.over30 > 0,
        },
    { href: '/cfo/cashflow', label: '💰 Касса → 7 дней', value: `${fmt(p.cash)} → ${fmt(p.cash7)}`, sub: p.cash7 < 0 ? 'прогноз уходит в минус' : 'разрыва нет', warn: p.cash7 < 0 },
    { href: '/cfo/breakeven', label: '🎯 План vs операционная ТБ', value: p.tb0 != null ? `${Math.round(p.planRevenue / p.tb0 * 100)}% от точки` : '—', sub: p.tb0 != null ? `план ${fmt(p.planRevenue)} · точка ${fmt(p.tb0)}` : 'заполни финмодель', warn: p.tb0 != null && p.planRevenue < p.tb0 },
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
