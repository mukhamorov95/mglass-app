'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase-browser'

type Order = {
  id: number
  client_id: number
  client_name: string
  total_after_discount: number
  total_sale_inc_vat: number
  discount_percent: number
  notes: string | null
  created_at: string
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

type Tab = 'clients' | 'season' | 'funnel'

export default function B2BAnalyticsPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [allOrders, setAllOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [year, setYear] = useState(new Date().getFullYear())
  const [tab, setTab] = useState<Tab>('clients')

  useEffect(() => {
    async function load() {
      const sb = createClient()
      const { data } = await sb
        .from('b2b_orders')
        .select('id,client_id,client_name,total_after_discount,total_sale_inc_vat,discount_percent,notes,created_at')
        .order('created_at')
      setAllOrders(data ?? [])
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
    { key: 'clients', label: 'По клиентам' },
    { key: 'season',  label: 'Сезонность' },
    { key: 'funnel',  label: 'Воронка' },
  ]

  return (
    <div className="min-h-screen bg-[#f8f8f7]">
      <div className="max-w-[1400px] mx-auto px-6 py-8">

        {/* Шапка */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">Аналитика B2B</h1>
            <p className="text-[13px] text-[#8a8a85] mt-0.5">Клиенты, сезонность, воронка продаж</p>
          </div>
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] text-[#111110] outline-none focus:border-[#111110] bg-white">
            {(availableYears.length > 0 ? availableYears : [new Date().getFullYear()]).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: `Выручка ${year}`, value: summary.total > 0 ? summary.total.toLocaleString('ru-RU') + ' ₽' : '—' },
            { label: 'Заказов',         value: summary.count  || '—' },
            { label: 'Клиентов',        value: summary.clients || '—' },
            { label: 'Конверсия',       value: funnelData.conversion + '%' },
          ].map(c => (
            <div key={c.label} className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-1">{c.label}</p>
              <p className="text-[22px] font-bold text-[#111110] tabular-nums">{c.value}</p>
            </div>
          ))}
        </div>

        {/* Вкладки */}
        <div className="flex gap-1 mb-4">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                tab === t.key ? 'bg-[#111110] text-white' : 'text-[#6b6b66] hover:bg-[#f0f0ec]'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-12 text-center text-[13px] text-[#8a8a85]">Загрузка...</div>
        ) : (
          <>
            {/* ── По клиентам ── */}
            {tab === 'clients' && (
              <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
                {clients.length === 0 ? (
                  <div className="p-12 text-center">
                    <p className="text-[14px] font-medium text-[#111110] mb-1">Нет данных за {year} год</p>
                    <p className="text-[13px] text-[#8a8a85]">Заказы появятся здесь после сохранения в калькуляторе</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-[#f0f0ec] bg-[#fafaf9]">
                          <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest sticky left-0 bg-[#fafaf9] min-w-[180px]">Клиент</th>
                          {MONTHS_SHORT.map((m, i) => (
                            <th key={i} className={`text-right px-3 py-2.5 text-[10px] font-semibold uppercase tracking-widest w-16 ${i + 1 === currentMonth ? 'text-[#111110]' : 'text-[#9a9a95]'}`}>{m}</th>
                          ))}
                          <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#111110] uppercase tracking-widest w-28 border-l border-[#f0f0ec]">Итого {year}</th>
                          <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest w-16">Зак.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clients.map((c, idx) => (
                          <tr key={c.client_id} className="border-b border-[#f8f8f7] last:border-0 hover:bg-[#fafaf9]">
                            <td className="px-4 py-2.5 sticky left-0 bg-white hover:bg-[#fafaf9]">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold text-[#c4c4be] w-4 flex-shrink-0">#{idx + 1}</span>
                                <span className="font-medium text-[#111110]">{c.client_name}</span>
                              </div>
                            </td>
                            {MONTHS_SHORT.map((_, i) => {
                              const mn = i + 1; const cell = c.months[mn]
                              return (
                                <td key={mn} className={`px-3 py-2.5 text-right font-mono ${cell ? 'text-[#111110]' : 'text-[#d4d4ce]'} ${mn === currentMonth ? 'bg-blue-50/40' : ''}`}>
                                  {cell ? fmtK(cell.total) : '—'}
                                </td>
                              )
                            })}
                            <td className="px-4 py-2.5 text-right font-mono font-semibold text-[#111110] border-l border-[#f0f0ec]">{c.yearTotal.toLocaleString('ru-RU')} ₽</td>
                            <td className="px-4 py-2.5 text-right text-[#6b6b66]">{c.yearOrders}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-[#e4e4e0] bg-[#fafaf9]">
                          <td className="px-4 py-2.5 font-semibold text-[#111110] sticky left-0 bg-[#fafaf9]">Итого</td>
                          {MONTHS_SHORT.map((_, i) => {
                            const mn = i + 1
                            const monthTotal = clients.reduce((s, c) => s + (c.months[mn]?.total ?? 0), 0)
                            return (
                              <td key={mn} className={`px-3 py-2.5 text-right font-mono font-semibold text-[#111110] ${mn === currentMonth ? 'bg-blue-50/40' : ''}`}>
                                {monthTotal > 0 ? fmtK(monthTotal) : '—'}
                              </td>
                            )
                          })}
                          <td className="px-4 py-2.5 text-right font-mono font-bold text-[#111110] border-l border-[#e4e4e0]">{summary.total.toLocaleString('ru-RU')} ₽</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-[#111110]">{summary.count}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── Сезонность ── */}
            {tab === 'season' && (
              <div className="space-y-4">
                {seasonData.years.length === 0 ? (
                  <div className="bg-white border border-[#e4e4e0] rounded-xl p-12 text-center text-[13px] text-[#8a8a85]">Нет данных</div>
                ) : (
                  <>
                    {/* Сравнение по годам */}
                    <div className="bg-white border border-[#e4e4e0] rounded-xl p-6">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-5">Выручка по месяцам (тыс. ₽)</p>
                      <div className="flex items-end gap-1.5" style={{ height: 180 }}>
                        {MONTHS_SHORT.map((m, mi) => {
                          const vals = seasonData.years.map(y => ({ y, v: seasonData.byYear[y]?.[mi] ?? 0 }))
                          return (
                            <div key={mi} className="flex-1 flex flex-col items-center gap-0.5">
                              <div className="w-full flex items-end justify-center gap-0.5" style={{ height: 150 }}>
                                {vals.map(({ y, v }) => {
                                  const h = seasonData.maxVal > 0 ? Math.round(v / seasonData.maxVal * 150) : 0
                                  const colors: Record<number, string> = {
                                    [seasonData.years[0] ?? 0]: 'bg-[#d4d4ce]',
                                    [seasonData.years[seasonData.years.length - 1] ?? 0]: 'bg-[#111110]',
                                  }
                                  const color = colors[y] ?? 'bg-[#8a8a85]'
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
                              <span className={`text-[10px] ${mi + 1 === currentMonth ? 'font-bold text-[#111110]' : 'text-[#9a9a95]'}`}>{m}</span>
                            </div>
                          )
                        })}
                      </div>
                      {seasonData.years.length > 1 && (
                        <div className="flex gap-4 mt-4">
                          {seasonData.years.map((y, i) => (
                            <div key={y} className="flex items-center gap-1.5">
                              <div className={`w-3 h-2 rounded-sm ${i === 0 ? 'bg-[#d4d4ce]' : i === seasonData.years.length - 1 ? 'bg-[#111110]' : 'bg-[#8a8a85]'} ${y === year ? '' : 'opacity-50'}`} />
                              <span className="text-[11px] text-[#6b6b66]">{y}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Таблица по месяцам выбранного года */}
                    <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="border-b border-[#f0f0ec] bg-[#fafaf9]">
                            <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Месяц</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Выручка</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Заказов</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Ср. чек</th>
                          </tr>
                        </thead>
                        <tbody>
                          {MONTHS_FULL.map((m, mi) => {
                            const monthOrders = confirmed.filter(o => new Date(o.created_at).getMonth() === mi)
                            const revenue = monthOrders.reduce((s, o) => s + getPrice(o), 0)
                            const avg = monthOrders.length > 0 ? Math.round(revenue / monthOrders.length) : 0
                            const isCurrent = mi + 1 === currentMonth
                            return (
                              <tr key={mi} className={`border-b border-[#f8f8f7] last:border-0 ${isCurrent ? 'bg-blue-50/30' : 'hover:bg-[#fafaf9]'}`}>
                                <td className="px-4 py-2.5 font-medium text-[#111110]">
                                  {m} {isCurrent && <span className="text-[10px] text-blue-600 font-normal ml-1">текущий</span>}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono font-semibold text-[#111110]">{revenue > 0 ? revenue.toLocaleString('ru-RU') + ' ₽' : '—'}</td>
                                <td className="px-4 py-2.5 text-right text-[#6b6b66]">{monthOrders.length || '—'}</td>
                                <td className="px-4 py-2.5 text-right font-mono text-[#6b6b66]">{avg > 0 ? avg.toLocaleString('ru-RU') + ' ₽' : '—'}</td>
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
                    <div key={c.label} className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3.5">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-1">{c.label}</p>
                      <p className="text-[22px] font-bold text-[#111110] tabular-nums">{c.value}</p>
                      <p className="text-[11px] text-[#9a9a95] mt-0.5">{c.sub}</p>
                    </div>
                  ))}
                </div>

                {/* Воронка визуально */}
                <div className="bg-white border border-[#e4e4e0] rounded-xl p-6">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-4">Путь просчёта</p>
                  <div className="space-y-2">
                    {[
                      { label: 'Просчётов создано', count: funnelData.quotesCount + funnelData.confirmedCount, color: 'bg-[#f0f0ec]', text: 'text-[#111110]' },
                      { label: 'Подтверждено и запущено', count: funnelData.confirmedCount, color: 'bg-[#111110]', text: 'text-white' },
                    ].map((step, i) => {
                      const total = funnelData.quotesCount + funnelData.confirmedCount
                      const w = total > 0 ? Math.round(step.count / total * 100) : 0
                      return (
                        <div key={i}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[12px] text-[#6b6b66]">{step.label}</span>
                            <span className="text-[12px] font-semibold text-[#111110]">{step.count}</span>
                          </div>
                          <div className="h-8 bg-[#f8f8f7] rounded-lg overflow-hidden">
                            <div className={`h-full ${step.color} rounded-lg flex items-center px-3 transition-all`} style={{ width: `${Math.max(w, 4)}%` }}>
                              <span className={`text-[11px] font-bold ${step.text} whitespace-nowrap`}>{w}%</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* По месяцам */}
                <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-[#f0f0ec] bg-[#fafaf9]">
                        <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Месяц</th>
                        <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Просчётов</th>
                        <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Заказов</th>
                        <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Конверсия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {funnelData.monthly.map((row, i) => {
                        const total = row.quotes + row.orders
                        const conv = total > 0 ? Math.round(row.orders / total * 100) : null
                        const isCurrent = i + 1 === currentMonth
                        return (
                          <tr key={i} className={`border-b border-[#f8f8f7] last:border-0 ${isCurrent ? 'bg-blue-50/30' : 'hover:bg-[#fafaf9]'}`}>
                            <td className="px-4 py-2 font-medium text-[#111110]">
                              {MONTHS_FULL[i]} {isCurrent && <span className="text-[10px] text-blue-600 font-normal ml-1">текущий</span>}
                            </td>
                            <td className="px-4 py-2 text-right text-[#6b6b66]">{row.quotes || '—'}</td>
                            <td className="px-4 py-2 text-right text-[#6b6b66]">{row.orders || '—'}</td>
                            <td className="px-4 py-2 text-right font-semibold text-[#111110]">
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
