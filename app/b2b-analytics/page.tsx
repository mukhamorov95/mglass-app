'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase-browser'
import {
  PageHeader, SegmentedTabs, SelectField, MetricTile, StatusPill,
  EmptyState, SkeletonRows, type PillTone,
} from '@/components/ds'

type Order = {
  id: number
  client_id: number
  client_name: string
  total_after_discount: number
  total_sale_inc_vat: number
  discount_percent: number
  margin_percent: number | null
  notes: string | null
  created_at: string
  manager_name?: string | null  // from notes JSON (no DB column yet)
}

type ClientRow = {
  client_id: number
  client_name: string
  months: Record<number, { total: number; orders: number }>
  yearTotal: number
  yearOrders: number
}

const MONTHS_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']
const MONTHS_FULL  = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']
const fmt  = (n: number) => n > 0 ? n.toLocaleString('ru-RU') + ' ₽' : '—'
const fmtK = (n: number) => n >= 1000 ? (n / 1000).toFixed(0) + 'к' : n > 0 ? String(n) : '—'

function parseNotes(notes: string | null): Record<string, unknown> {
  if (!notes) return {}
  try { const p = JSON.parse(notes); if (typeof p === 'object' && p !== null) return p } catch {}
  return {}
}

function getPrice(o: Order) {
  return (o.discount_percent ?? 0) > 0 ? (o.total_after_discount ?? 0) : (o.total_sale_inc_vat ?? 0)
}

type Tab = 'clients' | 'season' | 'funnel' | 'conversion'
type ClientsView = 'matrix' | 'ltv' | 'cohort'

export default function B2BAnalyticsPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [allOrders, setAllOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [year, setYear] = useState(new Date().getFullYear())
  const [tab, setTab] = useState<Tab>('clients')
  const [clientsView, setClientsView] = useState<ClientsView>('matrix')

  useEffect(() => {
    async function load() {
      const sb = createClient()
      const { data } = await sb
        .from('b2b_orders')
        .select('id,client_id,client_name,total_after_discount,total_sale_inc_vat,discount_percent,margin_percent,notes,created_at')
        .order('created_at')
        .limit(5000)
      // Extract manager_name from notes JSON (stored there since no DB column yet)
      const enriched = (data ?? []).map((o: Order) => ({
        ...o,
        manager_name: (parseNotes(o.notes).manager_name as string | null) ?? null,
      }))
      setAllOrders(enriched)
      setLoading(false)
    }
    load()
  }, [])

  useEffect(() => {
    setOrders(allOrders.filter(o => {
      const y = new Date(o.created_at).getFullYear()
      return y === year
    }))
  }, [allOrders, year])

  const confirmed = useMemo(() => orders.filter(o => parseNotes(o.notes).status !== 'quote'), [orders])
  const quotes    = useMemo(() => orders.filter(o => parseNotes(o.notes).status === 'quote'),  [orders])

  /* ── Вкладка Клиенты ── */
  const { clients, summary } = useMemo(() => {
    const map = new Map<number, ClientRow>()
    for (const o of confirmed) {
      const month = new Date(o.created_at).getMonth() + 1
      if (!map.has(o.client_id)) map.set(o.client_id, { client_id: o.client_id, client_name: o.client_name, months: {}, yearTotal: 0, yearOrders: 0 })
      const row = map.get(o.client_id)!
      if (!row.months[month]) row.months[month] = { total: 0, orders: 0 }
      const price = getPrice(o)
      row.months[month].total  += price
      row.months[month].orders += 1
      row.yearTotal  += price
      row.yearOrders += 1
    }
    const clients = [...map.values()].sort((a, b) => b.yearTotal - a.yearTotal)
    const summary = { total: clients.reduce((s, c) => s + c.yearTotal, 0), count: confirmed.length, clients: clients.length }
    return { clients, summary }
  }, [confirmed])

  /* ── Вкладка Сезонность ── */
  const seasonData = useMemo(() => {
    const years = [...new Set(allOrders.map(o => new Date(o.created_at).getFullYear()))].sort()
    const byYear: Record<number, number[]> = {}
    for (const y of years) {
      byYear[y] = Array(12).fill(0)
    }
    for (const o of allOrders) {
      if (parseNotes(o.notes).status === 'quote') continue
      const d = new Date(o.created_at)
      byYear[d.getFullYear()][d.getMonth()] += getPrice(o)
    }
    const maxVal = Math.max(...Object.values(byYear).flat())
    return { years, byYear, maxVal }
  }, [allOrders])

  /* ── LTV клиентов (все годы) ── */
  const ltvData = useMemo(() => {
    const allConf = allOrders.filter(o => parseNotes(o.notes).status !== 'quote')
    const map = new Map<number, {
      client_id: number; client_name: string
      first_order_date: string; last_order_date: string
      total_orders_count: number; total_revenue: number
    }>()
    for (const o of allConf) {
      if (!map.has(o.client_id)) {
        map.set(o.client_id, { client_id: o.client_id, client_name: o.client_name, first_order_date: o.created_at, last_order_date: o.created_at, total_orders_count: 0, total_revenue: 0 })
      }
      const row = map.get(o.client_id)!
      const price = getPrice(o)
      row.total_revenue += price
      row.total_orders_count++
      if (o.created_at < row.first_order_date) row.first_order_date = o.created_at
      if (o.created_at > row.last_order_date)  row.last_order_date  = o.created_at
    }
    const now = Date.now()
    return [...map.values()]
      .map(r => ({
        ...r,
        avg_order_value:       r.total_orders_count > 0 ? Math.round(r.total_revenue / r.total_orders_count) : 0,
        days_since_last_order: Math.floor((now - new Date(r.last_order_date).getTime()) / 86_400_000),
      }))
      .sort((a, b) => b.total_revenue - a.total_revenue)
  }, [allOrders])

  /* ── Сегментация по активности ── */
  const segmentation = useMemo(() => ({
    active:     ltvData.filter(c => c.total_orders_count > 1 && c.days_since_last_order < 90),
    newClients: ltvData.filter(c => c.total_orders_count === 1),
    atRisk:     ltvData.filter(c => c.total_orders_count > 1 && c.days_since_last_order >= 90  && c.days_since_last_order < 180),
    churned:    ltvData.filter(c => c.total_orders_count > 1 && c.days_since_last_order >= 180),
  }), [ltvData])

  /* ── Когортный анализ ── */
  const cohortData = useMemo(() => {
    const allConf = allOrders.filter(o => parseNotes(o.notes).status !== 'quote')
    const firstOrderYm = new Map<number, string>()
    for (const o of allConf) {
      const ym = o.created_at.slice(0, 7)
      if (!firstOrderYm.has(o.client_id) || ym < firstOrderYm.get(o.client_id)!) {
        firstOrderYm.set(o.client_id, ym)
      }
    }
    const cohorts = new Map<string, { size: number; months: Map<number, Set<number>> }>()
    for (const [, firstYm] of firstOrderYm) {
      if (!cohorts.has(firstYm)) cohorts.set(firstYm, { size: 0, months: new Map() })
      cohorts.get(firstYm)!.size++
    }
    for (const o of allConf) {
      const firstYm = firstOrderYm.get(o.client_id)
      if (!firstYm) continue
      const cohort = cohorts.get(firstYm)!
      const fd = new Date(firstYm + '-01')
      const od = new Date(o.created_at.slice(0, 7) + '-01')
      const diff = (od.getFullYear() - fd.getFullYear()) * 12 + (od.getMonth() - fd.getMonth())
      if (diff >= 0 && diff <= 11) {
        if (!cohort.months.has(diff)) cohort.months.set(diff, new Set())
        cohort.months.get(diff)!.add(o.client_id)
      }
    }
    return [...cohorts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, data]) => ({
        cohort: ym,
        size:   data.size,
        months: Array.from({ length: 12 }, (_, i) => {
          const count = data.months.get(i)?.size ?? 0
          return { count, pct: data.size > 0 ? Math.round(count / data.size * 100) : 0 }
        }),
      }))
  }, [allOrders])

  /* ── Вкладка Воронка ── */
  const funnelData = useMemo(() => {
    const quotesCount    = quotes.length
    const confirmedCount = confirmed.length
    const total          = quotesCount + confirmedCount
    const conversion     = total > 0 ? Math.round(confirmedCount / total * 100) : 0
    const avgQuote       = quotesCount > 0 ? Math.round(quotes.reduce((s, o) => s + getPrice(o), 0) / quotesCount) : 0
    const avgOrder       = confirmedCount > 0 ? Math.round(confirmed.reduce((s, o) => s + getPrice(o), 0) / confirmedCount) : 0

    // По месяцам
    const monthly: { month: number; quotes: number; orders: number }[] = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, quotes: 0, orders: 0 }))
    for (const o of quotes)    monthly[new Date(o.created_at).getMonth()].quotes++
    for (const o of confirmed) monthly[new Date(o.created_at).getMonth()].orders++

    return { quotesCount, confirmedCount, conversion, avgQuote, avgOrder, monthly }
  }, [quotes, confirmed])

  const currentMonth = new Date().getMonth() + 1
  const availableYears = useMemo(() => [...new Set(allOrders.map(o => new Date(o.created_at).getFullYear()))].sort((a,b) => b-a), [allOrders])

  const TABS: { key: Tab; label: string }[] = [
    { key: 'clients',    label: 'По клиентам' },
    { key: 'season',     label: 'Сезонность' },
    { key: 'funnel',     label: 'Воронка' },
    { key: 'conversion', label: 'Менеджеры' },
  ]

  // Конверсия по менеджерам
  const managerStats = useMemo(() => {
    const map = new Map<string, { name: string; kpCount: number; orderCount: number; revenue: number; margins: number[] }>()
    for (const o of orders) {
      const name = o.manager_name ?? 'Без менеджера'
      if (!map.has(name)) map.set(name, { name, kpCount: 0, orderCount: 0, revenue: 0, margins: [] })
      const row = map.get(name)!
      row.kpCount++
      const status = parseNotes(o.notes).status as string
      if (status === 'confirmed' || status === 'agreed') {
        row.orderCount++
        row.revenue += getPrice(o)
        if (o.margin_percent != null && o.margin_percent > 0) row.margins.push(o.margin_percent)
      }
    }
    return [...map.values()]
      .map(r => ({ ...r, conversion: r.kpCount > 0 ? Math.round(r.orderCount / r.kpCount * 100) : 0, avgMargin: r.margins.length > 0 ? Math.round(r.margins.reduce((a, b) => a + b) / r.margins.length) : 0 }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [orders])

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-[1400px] mx-auto px-6 py-8">

        {/* Шапка */}
        <PageHeader
          title="Аналитика B2B"
          subtitle="Клиенты, сезонность, воронка продаж"
          actions={
            <SelectField value={year} onChange={e => setYear(Number(e.target.value))}>
              {(availableYears.length > 0 ? availableYears : [new Date().getFullYear()]).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </SelectField>
          }
        />

        {/* KPI */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: `Выручка ${year}`, value: summary.total > 0 ? summary.total.toLocaleString('ru-RU') + ' ₽' : '—' },
            { label: 'Заказов',         value: summary.count  || '—' },
            { label: 'Клиентов',        value: summary.clients || '—' },
            { label: 'Конверсия',       value: funnelData.conversion + '%' },
          ].map(c => (
            <MetricTile key={c.label} label={c.label} value={c.value} />
          ))}
        </div>

        {/* Вкладки */}
        <div className="mb-4">
          <SegmentedTabs value={tab} onChange={setTab} tabs={TABS.map(t => ({ value: t.key, label: t.label }))} />
        </div>

        {loading ? (
          <SkeletonRows count={5} />
        ) : (
          <>
            {/* ── По клиентам ── */}
            {tab === 'clients' && (
              <div className="space-y-4">
                {/* Sub-tabs */}
                <div className="flex gap-1">
                  {([
                    { key: 'matrix', label: 'По месяцам' },
                    { key: 'ltv',    label: 'LTV и сегменты' },
                    { key: 'cohort', label: 'Когорты' },
                  ] as { key: ClientsView; label: string }[]).map(v => (
                    <button key={v.key} onClick={() => setClientsView(v.key)}
                      className={`px-3 py-1 rounded-lg text-[12px] font-medium transition-colors border ${
                        clientsView === v.key ? 'bg-ink text-white border-ink' : 'text-ink-soft border-line hover:bg-line-soft'
                      }`}>
                      {v.label}
                    </button>
                  ))}
                </div>

                {/* По месяцам (matrix) */}
                {clientsView === 'matrix' && (
                  <div className="bg-surface border border-line rounded-xl overflow-hidden">
                    {clients.length === 0 ? (
                      <EmptyState
                        title={`Нет данных за ${year} год`}
                        hint="Заказы появятся здесь после сохранения в калькуляторе"
                      />
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="border-b border-line-soft bg-subtle">
                              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest sticky left-0 bg-subtle min-w-[180px]">Клиент</th>
                              {MONTHS_SHORT.map((m, i) => (
                                <th key={i} className={`text-right px-3 py-2.5 text-[10px] font-semibold uppercase tracking-widest w-16 ${i + 1 === currentMonth ? 'text-ink' : 'text-muted'}`}>{m}</th>
                              ))}
                              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-ink uppercase tracking-widest w-28 border-l border-line-soft">Итого {year}</th>
                              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest w-16">Зак.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {clients.map((c, idx) => (
                              <tr key={c.client_id} className="border-b border-line-soft last:border-0 hover:bg-subtle">
                                <td className="px-4 py-2.5 sticky left-0 bg-surface hover:bg-subtle">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-semibold text-faint w-4 flex-shrink-0 tabular-nums">#{idx + 1}</span>
                                    <span className="font-medium text-ink">{c.client_name}</span>
                                  </div>
                                </td>
                                {MONTHS_SHORT.map((_, i) => {
                                  const mn = i + 1; const cell = c.months[mn]
                                  return (
                                    <td key={mn} className={`px-3 py-2.5 text-right font-mono tabular-nums ${cell ? 'text-ink' : 'text-faint'} ${mn === currentMonth ? 'bg-blue-50/40' : ''}`}>
                                      {cell ? fmtK(cell.total) : '—'}
                                    </td>
                                  )
                                })}
                                <td className="px-4 py-2.5 text-right font-mono font-semibold text-ink border-l border-line-soft tabular-nums">{c.yearTotal.toLocaleString('ru-RU')} ₽</td>
                                <td className="px-4 py-2.5 text-right text-ink-soft tabular-nums">{c.yearOrders}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-line bg-subtle">
                              <td className="px-4 py-2.5 font-semibold text-ink sticky left-0 bg-subtle">Итого</td>
                              {MONTHS_SHORT.map((_, i) => {
                                const mn = i + 1
                                const monthTotal = clients.reduce((s, c) => s + (c.months[mn]?.total ?? 0), 0)
                                return (
                                  <td key={mn} className={`px-3 py-2.5 text-right font-mono font-semibold text-ink tabular-nums ${mn === currentMonth ? 'bg-blue-50/40' : ''}`}>
                                    {monthTotal > 0 ? fmtK(monthTotal) : '—'}
                                  </td>
                                )
                              })}
                              <td className="px-4 py-2.5 text-right font-mono font-semibold text-ink border-l border-line tabular-nums">{summary.total.toLocaleString('ru-RU')} ₽</td>
                              <td className="px-4 py-2.5 text-right font-semibold text-ink tabular-nums">{summary.count}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* LTV и сегменты */}
                {clientsView === 'ltv' && (
                  <div className="space-y-4">
                    {/* Сегментация */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: 'Активные',     count: segmentation.active.length,     sub: 'заказ < 90 дней',   color: 'text-emerald-600' },
                        { label: 'Новые',         count: segmentation.newClients.length, sub: 'только 1 заказ',     color: 'text-blue-600'    },
                        { label: 'Под риском',    count: segmentation.atRisk.length,     sub: '90–180 дней',        color: 'text-amber-600'   },
                        { label: 'Потерянные',    count: segmentation.churned.length,    sub: 'заказ > 180 дней',  color: 'text-red-500'     },
                      ].map(s => (
                        <div key={s.label} className="bg-surface border border-line rounded-xl px-4 py-3.5">
                          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted mb-1">{s.label}</p>
                          <p className={`text-[22px] font-semibold tabular-nums ${s.color}`}>{s.count}</p>
                          <p className="text-[10px] text-muted mt-0.5">{s.sub}</p>
                        </div>
                      ))}
                    </div>

                    {/* Топ-10 по LTV */}
                    <div className="bg-surface border border-line rounded-xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-line-soft">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Топ клиентов по LTV (все время)</p>
                      </div>
                      {ltvData.length === 0 ? (
                        <div className="p-12 text-center text-[13px] text-muted">Нет данных</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[12px]">
                            <thead>
                              <tr className="border-b border-line-soft bg-subtle">
                                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest min-w-[180px]">Клиент</th>
                                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">LTV</th>
                                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">Заказов</th>
                                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">Ср. чек</th>
                                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">Первый заказ</th>
                                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">Последний</th>
                                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">Дней назад</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ltvData.slice(0, 10).map((c, idx) => {
                                const segment = c.total_orders_count === 1 ? { label: 'Новый', tone: 'accent' as PillTone }
                                  : c.days_since_last_order < 90    ? { label: 'Активен', tone: 'success' as PillTone }
                                  : c.days_since_last_order < 180   ? { label: 'Риск',    tone: 'warning' as PillTone }
                                  :                                    { label: 'Потерян', tone: 'danger' as PillTone }
                                return (
                                  <tr key={c.client_id} className="border-b border-line-soft last:border-0 hover:bg-subtle">
                                    <td className="px-4 py-2.5">
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-semibold text-faint w-4 flex-shrink-0 tabular-nums">#{idx + 1}</span>
                                        <span className="font-medium text-ink">{c.client_name}</span>
                                        <StatusPill tone={segment.tone}>{segment.label}</StatusPill>
                                      </div>
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-ink tabular-nums">{c.total_revenue.toLocaleString('ru-RU')} ₽</td>
                                    <td className="px-4 py-2.5 text-right text-ink-soft tabular-nums">{c.total_orders_count}</td>
                                    <td className="px-4 py-2.5 text-right font-mono text-ink-soft tabular-nums">{c.avg_order_value.toLocaleString('ru-RU')} ₽</td>
                                    <td className="px-4 py-2.5 text-right text-muted">{new Date(c.first_order_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
                                    <td className="px-4 py-2.5 text-right text-muted">{new Date(c.last_order_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
                                    <td className="px-4 py-2.5 text-right">
                                      <span className={`font-semibold tabular-nums ${c.days_since_last_order < 90 ? 'text-emerald-600' : c.days_since_last_order < 180 ? 'text-amber-600' : 'text-red-500'}`}>
                                        {c.days_since_last_order}д
                                      </span>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Полный список по сегментам */}
                    {[
                      { label: 'Под риском (90–180 дней)',   list: segmentation.atRisk,     border: 'border-amber-200',  header: 'bg-amber-50' },
                      { label: 'Потерянные (> 180 дней)',    list: segmentation.churned,    border: 'border-red-200',    header: 'bg-red-50'   },
                    ].map(seg => seg.list.length > 0 && (
                      <div key={seg.label} className={`bg-surface border ${seg.border} rounded-xl overflow-hidden`}>
                        <div className={`px-4 py-3 border-b ${seg.border} ${seg.header}`}>
                          <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-soft">{seg.label} — {seg.list.length} клиентов</p>
                        </div>
                        <div className="divide-y divide-line-soft">
                          {seg.list.map(c => (
                            <div key={c.client_id} className="px-4 py-2.5 flex items-center justify-between gap-4 hover:bg-subtle">
                              <span className="text-[12px] font-medium text-ink truncate">{c.client_name}</span>
                              <div className="flex items-center gap-4 shrink-0 text-[11px] text-muted">
                                <span className="font-mono tabular-nums">{c.total_revenue.toLocaleString('ru-RU')} ₽</span>
                                <span className="tabular-nums">{c.total_orders_count} зак.</span>
                                <span className="font-semibold text-amber-600 tabular-nums">{c.days_since_last_order}д</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Когортная таблица */}
                {clientsView === 'cohort' && (
                  <div className="bg-surface border border-line rounded-xl overflow-hidden">
                    {cohortData.length === 0 ? (
                      <div className="p-12 text-center text-[13px] text-muted">Нет данных для когортного анализа</div>
                    ) : (
                      <>
                        <div className="px-4 py-3 border-b border-line-soft bg-subtle">
                          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Когортный анализ — удержание клиентов по месяцам</p>
                          <p className="text-[11px] text-faint mt-0.5">% клиентов из когорты, совершивших хотя бы 1 заказ в месяц N после первого</p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="border-b border-line-soft">
                                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest sticky left-0 bg-surface min-w-[110px]">Когорта</th>
                                <th className="text-center px-2 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest w-12">Кл.</th>
                                {Array.from({ length: 12 }, (_, i) => (
                                  <th key={i} className="text-center px-2 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest w-12">М{i}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {cohortData.map(row => {
                                const [cohortYear, cohortMo] = row.cohort.split('-').map(Number)
                                const label = `${MONTHS_SHORT[(cohortMo ?? 1) - 1]} ${cohortYear}`
                                return (
                                  <tr key={row.cohort} className="border-b border-line-soft last:border-0">
                                    <td className="px-4 py-2 font-medium text-ink sticky left-0 bg-surface">{label}</td>
                                    <td className="px-2 py-2 text-center font-semibold text-ink-soft tabular-nums">{row.size}</td>
                                    {row.months.map((m, mi) => {
                                      const bg = m.pct === 0
                                        ? 'transparent'
                                        : `rgba(17,17,16,${(m.pct / 100) * 0.65})`
                                      const textCol = m.pct > 45 ? '#fff' : m.pct > 0 ? '#111110' : '#c4c4be'
                                      return (
                                        <td key={mi} className="px-2 py-2 text-center rounded tabular-nums"
                                          style={{ background: bg, color: textCol }}>
                                          {m.pct > 0 ? m.pct + '%' : '—'}
                                        </td>
                                      )
                                    })}
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Сезонность ── */}
            {tab === 'season' && (
              <div className="space-y-4">
                {seasonData.years.length === 0 ? (
                  <div className="bg-surface border border-line rounded-xl p-12 text-center text-[13px] text-muted">Нет данных</div>
                ) : (
                  <>
                    {/* Сравнение по годам */}
                    <div className="bg-surface border border-line rounded-xl p-6">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted mb-5">Выручка по месяцам (тыс. ₽)</p>
                      <div className="flex items-end gap-1.5" style={{ height: 180 }}>
                        {MONTHS_SHORT.map((m, mi) => {
                          const vals = seasonData.years.map(y => ({ y, v: seasonData.byYear[y]?.[mi] ?? 0 }))
                          return (
                            <div key={mi} className="flex-1 flex flex-col items-center gap-0.5">
                              <div className="w-full flex items-end justify-center gap-0.5" style={{ height: 150 }}>
                                {vals.map(({ y, v }) => {
                                  const h = seasonData.maxVal > 0 ? Math.round(v / seasonData.maxVal * 150) : 0
                                  const colors: Record<number, string> = {
                                    [seasonData.years[0] ?? 0]: 'bg-faint',
                                    [seasonData.years[seasonData.years.length - 1] ?? 0]: 'bg-ink',
                                  }
                                  const color = colors[y] ?? 'bg-muted'
                                  return (
                                    <div key={y} className="relative group flex-1 flex items-end">
                                      <div
                                        className={`w-full rounded-t-sm transition-all ${color} ${y === year ? 'opacity-100' : 'opacity-50'}`}
                                        style={{ height: h || 2 }}
                                        title={`${y}: ${v > 0 ? v.toLocaleString('ru-RU') + ' ₽' : '—'}`}
                                      />
                                    </div>
                                  )
                                })}
                              </div>
                              <span className={`text-[10px] ${mi + 1 === currentMonth ? 'font-semibold text-ink' : 'text-muted'}`}>{m}</span>
                            </div>
                          )
                        })}
                      </div>
                      {seasonData.years.length > 1 && (
                        <div className="flex gap-4 mt-4">
                          {seasonData.years.map((y, i) => (
                            <div key={y} className="flex items-center gap-1.5">
                              <div className={`w-3 h-2 rounded-sm ${i === 0 ? 'bg-faint' : i === seasonData.years.length - 1 ? 'bg-ink' : 'bg-muted'} ${y === year ? '' : 'opacity-50'}`} />
                              <span className="text-[11px] text-ink-soft tabular-nums">{y}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Таблица по месяцам выбранного года */}
                    <div className="bg-surface border border-line rounded-xl overflow-hidden">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="border-b border-line-soft bg-subtle">
                            <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">Месяц</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">Выручка</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">Заказов</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">Ср. чек</th>
                          </tr>
                        </thead>
                        <tbody>
                          {MONTHS_FULL.map((m, mi) => {
                            const monthOrders = confirmed.filter(o => new Date(o.created_at).getMonth() === mi)
                            const revenue = monthOrders.reduce((s, o) => s + getPrice(o), 0)
                            const avg = monthOrders.length > 0 ? Math.round(revenue / monthOrders.length) : 0
                            const isCurrent = mi + 1 === currentMonth
                            return (
                              <tr key={mi} className={`border-b border-line-soft last:border-0 ${isCurrent ? 'bg-blue-50/30' : 'hover:bg-subtle'}`}>
                                <td className="px-4 py-2.5 font-medium text-ink">
                                  {m} {isCurrent && <span className="text-[10px] text-blue-600 font-normal ml-1">текущий</span>}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono font-semibold text-ink tabular-nums">{revenue > 0 ? revenue.toLocaleString('ru-RU') + ' ₽' : '—'}</td>
                                <td className="px-4 py-2.5 text-right text-ink-soft tabular-nums">{monthOrders.length || '—'}</td>
                                <td className="px-4 py-2.5 text-right font-mono text-ink-soft tabular-nums">{avg > 0 ? avg.toLocaleString('ru-RU') + ' ₽' : '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Менеджеры / Конверсия ── */}
            {tab === 'conversion' && (
              <div className="space-y-4">
                {managerStats.length === 0 ? (
                  <div className="bg-surface border border-line rounded-xl p-12 text-center text-[13px] text-muted">
                    Нет данных за {year} год
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[
                        { label: 'Менеджеров', value: managerStats.length },
                        { label: 'КП за период', value: orders.length },
                        { label: 'Ср. конверсия', value: managerStats.length > 0 ? Math.round(managerStats.reduce((s, r) => s + r.conversion, 0) / managerStats.length) + '%' : '—' },
                      ].map(c => (
                        <MetricTile key={c.label} label={c.label} value={c.value} />
                      ))}
                    </div>

                    <div className="bg-surface border border-line rounded-xl overflow-hidden">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="border-b border-line-soft bg-subtle">
                            <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">Менеджер</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">КП</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">Заказов</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">Конверсия</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">Выручка</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">Ср. маржа</th>
                          </tr>
                        </thead>
                        <tbody>
                          {managerStats.map((r, idx) => (
                            <tr key={r.name} className="border-b border-line-soft last:border-0 hover:bg-subtle">
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-semibold text-faint w-4 tabular-nums">{idx + 1}</span>
                                  <span className="font-medium text-ink">{r.name}</span>
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-right text-ink-soft tabular-nums">{r.kpCount}</td>
                              <td className="px-4 py-2.5 text-right text-ink-soft tabular-nums">{r.orderCount || '—'}</td>
                              <td className="px-4 py-2.5 text-right">
                                <span className={`font-semibold tabular-nums ${r.conversion >= 50 ? 'text-emerald-600' : r.conversion >= 25 ? 'text-ink' : 'text-red-500'}`}>
                                  {r.kpCount > 0 ? r.conversion + '%' : '—'}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono font-semibold text-ink tabular-nums">
                                {r.revenue > 0 ? r.revenue.toLocaleString('ru-RU') + ' ₽' : '—'}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                {r.avgMargin > 0 ? (
                                  <span className={`font-semibold tabular-nums ${r.avgMargin < 15 ? 'text-red-500' : 'text-emerald-600'}`}>
                                    {r.avgMargin}%
                                  </span>
                                ) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Прогресс-бар конверсии */}
                    <div className="bg-surface border border-line rounded-xl p-6">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted mb-4">Конверсия по менеджерам</p>
                      <div className="space-y-3">
                        {managerStats.map(r => (
                          <div key={r.name}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[12px] text-ink-soft">{r.name}</span>
                              <span className="text-[12px] font-semibold text-ink tabular-nums">{r.kpCount > 0 ? r.conversion + '%' : '—'}</span>
                            </div>
                            <div className="h-5 bg-line-soft rounded-lg overflow-hidden">
                              <div
                                className={`h-full rounded-lg transition-all ${r.conversion >= 50 ? 'bg-emerald-500' : r.conversion >= 25 ? 'bg-ink' : 'bg-red-400'}`}
                                style={{ width: `${Math.max(r.conversion, 2)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Воронка ── */}
            {tab === 'funnel' && (
              <div className="space-y-4">
                {/* Сводка */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Просчётов создано',   value: funnelData.quotesCount,    sub: 'за ' + year },
                    { label: 'Подтверждено',         value: funnelData.confirmedCount, sub: 'запущено в производство' },
                    { label: 'Конверсия',            value: funnelData.conversion + '%', sub: 'просчёт → заказ' },
                    { label: 'Средний чек заказа',   value: funnelData.avgOrder > 0 ? funnelData.avgOrder.toLocaleString('ru-RU') + ' ₽' : '—', sub: 'подтверждённые' },
                  ].map(c => (
                    <div key={c.label} className="bg-surface border border-line rounded-xl px-4 py-3.5">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted mb-1">{c.label}</p>
                      <p className="text-[22px] font-semibold text-ink tabular-nums">{c.value}</p>
                      <p className="text-[11px] text-muted mt-0.5">{c.sub}</p>
                    </div>
                  ))}
                </div>

                {/* Воронка визуально */}
                <div className="bg-surface border border-line rounded-xl p-6">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted mb-4">Путь просчёта</p>
                  <div className="space-y-2">
                    {[
                      { label: 'Просчётов создано', count: funnelData.quotesCount + funnelData.confirmedCount, color: 'bg-line-soft', text: 'text-ink' },
                      { label: 'Подтверждено и запущено', count: funnelData.confirmedCount, color: 'bg-ink', text: 'text-white' },
                    ].map((step, i) => {
                      const total = funnelData.quotesCount + funnelData.confirmedCount
                      const w = total > 0 ? Math.round(step.count / total * 100) : 0
                      return (
                        <div key={i}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[12px] text-ink-soft">{step.label}</span>
                            <span className="text-[12px] font-semibold text-ink tabular-nums">{step.count}</span>
                          </div>
                          <div className="h-8 bg-canvas rounded-lg overflow-hidden">
                            <div className={`h-full ${step.color} rounded-lg flex items-center px-3 transition-all`} style={{ width: `${Math.max(w, 4)}%` }}>
                              <span className={`text-[11px] font-semibold ${step.text} whitespace-nowrap tabular-nums`}>{w}%</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* По месяцам */}
                <div className="bg-surface border border-line rounded-xl overflow-hidden">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-line-soft bg-subtle">
                        <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">Месяц</th>
                        <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">Просчётов</th>
                        <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">Заказов</th>
                        <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">Конверсия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {funnelData.monthly.map((row, i) => {
                        const total = row.quotes + row.orders
                        const conv = total > 0 ? Math.round(row.orders / total * 100) : null
                        const isCurrent = i + 1 === currentMonth
                        return (
                          <tr key={i} className={`border-b border-line-soft last:border-0 ${isCurrent ? 'bg-blue-50/30' : 'hover:bg-subtle'}`}>
                            <td className="px-4 py-2 font-medium text-ink">
                              {MONTHS_FULL[i]} {isCurrent && <span className="text-[10px] text-blue-600 font-normal ml-1">текущий</span>}
                            </td>
                            <td className="px-4 py-2 text-right text-ink-soft tabular-nums">{row.quotes || '—'}</td>
                            <td className="px-4 py-2 text-right text-ink-soft tabular-nums">{row.orders || '—'}</td>
                            <td className="px-4 py-2 text-right font-semibold text-ink tabular-nums">
                              {conv !== null ? conv + '%' : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
