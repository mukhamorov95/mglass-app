'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'
import { useOwnerStrategy } from '@/lib/useOwnerStrategy'

type DashData = {
  revenueToday:    number
  revenueMonth:    number
  revenuePrev:     number
  ordersActive:    number
  ordersCompleted: number
  calcsToday:      number
  calcsWeek:       number
  avgMargin:       number
  unpaidAmount:    number
  unpaidCount:     number
  topManagers:     { name: string; revenue: number; count: number }[]
  byProduct:       { type: string; count: number; revenue: number }[]
  recentCalcs:     { id: number; type: string; price: number; margin: number; created_at: string; manager?: string }[]
  ordersInWork:    { id: string; number: string; client: string; price: number; deadline: string | null; payment: string | null }[]
}

const PRODUCT_LABELS: Record<string, string> = {
  mirror: 'Зеркала', loft: 'Лофт', shower: 'Душевые',
  shower_standard: 'Душевые', shower_budget: 'Душевые',
}

function fmt(n: number, compact = false) {
  if (compact) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' млн'
    if (n >= 1_000)     return Math.round(n / 1_000) + ' тыс'
  }
  return n.toLocaleString('ru-RU') + ' ₽'
}

function pctChange(cur: number, prev: number) {
  if (!prev) return null
  const d = Math.round(((cur - prev) / prev) * 100)
  return d
}

export default function DashboardPage() {
  const [data, setData] = useState<DashData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [usersMap, setUsersMap] = useState<Record<string, string>>({})
  const [role, setRole] = useState<string | null>(null)
  const { strategy } = useOwnerStrategy()

  useEffect(() => {
    async function loadRole() {
      const sb = createClient()
      const { data: { user } } = await sb.auth.getUser()
      if (user) {
        const { data: prof } = await sb.from('users').select('role').eq('id', user.id).maybeSingle()
        setRole((prof as { role?: string } | null)?.role ?? null)
      }
    }
    loadRole()
  }, [])

  useEffect(() => { load() }, [])

  async function load() {
    setError(false)
    const supabase = createClient()
    const now = new Date()
    try {
    const todayStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const monthStart  = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
    const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString()
    const weekStart   = new Date(now.getTime() - 7 * 86400000).toISOString()

    const [
      { data: orders },
      { data: calcsToday },
      { data: calcsWeek },
      { data: calcsMonth },
      { data: calcsPrev },
      { data: users },
    ] = await Promise.all([
      supabase.from('orders').select('id,number,client_name,total_sale_price,margin_percent,status,deadline,payment_status,prepayment_amount,manager_id,created_at'),
      supabase.from('calculations').select('id,product_type,final_price,margin,created_by,created_at').gte('created_at', todayStart),
      supabase.from('calculations').select('id,product_type,final_price,margin,created_by,created_at').gte('created_at', weekStart).order('created_at', { ascending: false }),
      supabase.from('calculations').select('final_price,margin,created_by,product_type').gte('created_at', monthStart),
      supabase.from('calculations').select('final_price').gte('created_at', prevMonthStart).lte('created_at', prevMonthEnd),
      supabase.from('users').select('id,name,email'),
    ])

    const uMap: Record<string, string> = {}
    for (const u of (users ?? [])) uMap[u.id] = u.name || u.email || u.id
    setUsersMap(uMap)

    const allOrders = orders ?? []
    const allCalcM  = calcsMonth ?? []

    // Revenue
    const revenueMonth = allOrders
      .filter(o => o.status !== 'cancelled' && o.created_at >= monthStart)
      .reduce((s, o) => s + o.total_sale_price, 0)
    const revenueToday = allOrders
      .filter(o => o.status !== 'cancelled' && o.created_at >= todayStart)
      .reduce((s, o) => s + o.total_sale_price, 0)
    const revenuePrev = (calcsPrev ?? []).reduce((s, c) => s + c.final_price, 0)

    // Orders
    const ordersActive    = allOrders.filter(o => ['approved', 'in_work'].includes(o.status)).length
    const ordersCompleted = allOrders.filter(o => o.status === 'completed').length

    // Avg margin
    const margins = allCalcM.map(c => c.margin).filter(m => m > 0)
    const avgMargin = margins.length ? margins.reduce((s, m) => s + m, 0) / margins.length : 0

    // Unpaid
    const unpaid = allOrders.filter(o => (!o.payment_status || o.payment_status === 'unpaid') && ['approved', 'in_work'].includes(o.status))
    const unpaidAmount = unpaid.reduce((s, o) => s + o.total_sale_price, 0)

    // Top managers
    const mgRevMap: Record<string, { revenue: number; count: number }> = {}
    for (const c of allCalcM) {
      if (!c.created_by) continue
      const e = mgRevMap[c.created_by] ?? { revenue: 0, count: 0 }
      e.revenue += c.final_price; e.count++
      mgRevMap[c.created_by] = e
    }
    const topManagers = Object.entries(mgRevMap)
      .map(([id, v]) => ({ name: uMap[id] ?? id, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)

    // By product
    const prodMap: Record<string, { count: number; revenue: number }> = {}
    for (const c of allCalcM) {
      const key = c.product_type === 'shower_standard' || c.product_type === 'shower_budget' ? 'shower' : c.product_type
      const e = prodMap[key] ?? { count: 0, revenue: 0 }
      e.count++; e.revenue += c.final_price
      prodMap[key] = e
    }
    const byProduct = Object.entries(prodMap).map(([type, v]) => ({ type, ...v })).sort((a, b) => b.revenue - a.revenue)

    // Recent calcs
    const recentCalcs = (calcsWeek ?? []).slice(0, 8).map(c => ({
      id: c.id, type: c.product_type, price: c.final_price,
      margin: c.margin, created_at: c.created_at,
      manager: c.created_by ? (uMap[c.created_by] ?? undefined) : undefined,
    }))

    // Orders in work
    const ordersInWork = allOrders
      .filter(o => ['approved', 'in_work'].includes(o.status))
      .sort((a, b) => (a.deadline ?? '9') < (b.deadline ?? '9') ? -1 : 1)
      .slice(0, 6)
      .map(o => ({
        id: o.id, number: o.number, client: o.client_name,
        price: o.total_sale_price, deadline: o.deadline,
        payment: o.payment_status ?? null,
      }))

    setData({
      revenueToday, revenueMonth, revenuePrev,
      ordersActive, ordersCompleted,
      calcsToday: (calcsToday ?? []).length,
      calcsWeek: (calcsWeek ?? []).length,
      avgMargin,
      unpaidAmount, unpaidCount: unpaid.length,
      topManagers, byProduct, recentCalcs, ordersInWork,
    })
    } catch (e) {
      console.error(e)
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  if (error) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85] p-6">
      <div className="text-center">
        <p className="mb-3">Не удалось загрузить дашборд.</p>
        <button onClick={() => { setLoading(true); load() }} className="px-4 py-2 bg-[#111110] text-white rounded-lg">Повторить</button>
      </div>
    </div>
  )
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка дашборда...</div>
  )
  if (!data) return null

  const monthDelta = pctChange(data.revenueMonth, data.revenuePrev)

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-semibold text-[#111110]">Дашборд</h1>
          <p className="text-[13px] text-[#8a8a85] mt-0.5">
            {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(role === 'admin' || role === 'ceo') && (
            <Link
              href="/admin/health-check"
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
            >
              <span>✓</span> Проверить систему
            </Link>
          )}
          <button onClick={load} className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4] transition-colors">
            Обновить
          </button>
        </div>
      </div>

      {/* Alerts */}
      {data.unpaidCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex items-start gap-3">
          <span className="text-amber-500 text-xl mt-0.5">⚠️</span>
          <div>
            <p className="text-[14px] font-semibold text-amber-900">
              {data.unpaidCount} активных заказов без оплаты — {fmt(data.unpaidAmount, true)}
            </p>
            <p className="text-[12px] text-amber-700 mt-0.5">
              Заказы в работе без предоплаты. Финансовый риск.
            </p>
            <Link href="/orders" className="text-[12px] font-semibold text-amber-800 underline mt-1 inline-block">
              Посмотреть заказы →
            </Link>
          </div>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: strategy.peak_months.includes(new Date().getMonth() + 1)
              ? 'Выручка этот месяц 📈'
              : 'Выручка этот месяц',
            value: fmt(data.revenueMonth, true),
            sub: strategy.monthly_revenue_target > 0
              ? `${Math.round((data.revenueMonth / strategy.monthly_revenue_target) * 100)}% от плана · ${fmt(strategy.monthly_revenue_target, true)}`
              : monthDelta !== null ? `${monthDelta >= 0 ? '+' : ''}${monthDelta}% к прошлому` : 'по расчётам',
            subColor: strategy.monthly_revenue_target > 0
              ? (data.revenueMonth >= strategy.monthly_revenue_target ? 'text-emerald-600'
                : data.revenueMonth >= strategy.monthly_revenue_target * 0.7 ? 'text-amber-600'
                : 'text-red-500')
              : monthDelta !== null ? (monthDelta >= 0 ? 'text-emerald-600' : 'text-red-500') : 'text-[#8a8a85]',
            icon: '💰',
          },
          {
            label: 'Сегодня',
            value: data.calcsToday > 0 ? `${data.calcsToday} расчётов` : '— расчётов',
            sub: fmt(data.revenueToday, true) + ' по расчётам',
            subColor: 'text-[#8a8a85]',
            icon: '📊',
          },
          {
            label: 'В работе',
            value: `${data.ordersActive} заказов`,
            sub: `${data.ordersCompleted} завершено всего`,
            subColor: 'text-[#8a8a85]',
            icon: '⚙️',
          },
          {
            label: 'Средняя маржа',
            value: `${data.avgMargin.toFixed(1)}%`,
            sub: 'за текущий месяц',
            subColor: data.avgMargin >= strategy.target_margin ? 'text-emerald-600' : data.avgMargin >= strategy.min_margin ? 'text-amber-600' : 'text-red-500',
            icon: data.avgMargin >= strategy.target_margin ? '🟢' : data.avgMargin >= strategy.min_margin ? '🟡' : '🔴',
          },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white border border-[#e4e4e0] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-semibold text-[#9a9a95] uppercase tracking-wide">{kpi.label}</p>
              <span className="text-lg">{kpi.icon}</span>
            </div>
            <p className="text-[22px] font-bold text-[#111110] leading-tight">{kpi.value}</p>
            <p className={`text-[11px] mt-1 ${kpi.subColor}`}>{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Middle row: orders in work + by product */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Orders in work */}
        <div className="lg:col-span-2 bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#f0f0ec] flex items-center justify-between">
            <p className="text-[13px] font-semibold text-[#111110]">Заказы в работе</p>
            <Link href="/orders" className="text-[11px] text-blue-600 hover:underline">Все заказы →</Link>
          </div>
          {data.ordersInWork.length === 0 ? (
            <div className="px-5 py-8 text-center text-[13px] text-[#9a9a95]">Нет активных заказов</div>
          ) : (
            <div className="divide-y divide-[#f0f0ec]">
              {data.ordersInWork.map(o => {
                const days = o.deadline ? Math.ceil((new Date(o.deadline).getTime() - Date.now()) / 86400000) : null
                const isPaid = o.payment === 'paid'
                return (
                  <Link key={o.id} href={`/orders/${o.id}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-[#f8f8f7] transition-colors">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isPaid ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-mono font-semibold text-[#111110]">{o.number}</span>
                        <span className="text-[12px] text-[#6b6b66] truncate">{o.client}</span>
                      </div>
                      {!isPaid && (
                        <span className="text-[10px] text-amber-600 font-medium">не оплачен</span>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[12px] font-mono font-semibold text-[#111110]">{fmt(o.price, true)}</p>
                      {days !== null && (
                        <p className={`text-[10px] ${days < 0 ? 'text-red-600 font-bold' : days <= 3 ? 'text-amber-600' : 'text-[#9a9a95]'}`}>
                          {days < 0 ? `просрочка ${Math.abs(days)}д` : `${days}д`}
                        </p>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* By product */}
        <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#f0f0ec]">
            <p className="text-[13px] font-semibold text-[#111110]">По продуктам (месяц)</p>
          </div>
          <div className="p-4 space-y-3">
            {data.byProduct.map(p => {
              const total = data.byProduct.reduce((s, x) => s + x.revenue, 0)
              const pct   = total > 0 ? Math.round((p.revenue / total) * 100) : 0
              return (
                <div key={p.type}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] font-medium text-[#111110]">{PRODUCT_LABELS[p.type] ?? p.type}</span>
                    <span className="text-[11px] text-[#6b6b66] font-mono">{fmt(p.revenue, true)}</span>
                  </div>
                  <div className="h-2 bg-[#f0f0ec] rounded-full overflow-hidden">
                    <div className="h-full bg-[#111110] rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[10px] text-[#9a9a95] mt-0.5">{p.count} расчётов · {pct}%</p>
                </div>
              )
            })}
            {data.byProduct.length === 0 && (
              <p className="text-[12px] text-[#9a9a95] text-center py-4">Нет данных</p>
            )}
          </div>
        </div>
      </div>

      {/* Bottom row: top managers + recent calcs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top managers */}
        <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#f0f0ec]">
            <p className="text-[13px] font-semibold text-[#111110]">Менеджеры — этот месяц</p>
          </div>
          <div className="divide-y divide-[#f0f0ec]">
            {data.topManagers.map((m, i) => (
              <div key={m.name} className="flex items-center gap-3 px-5 py-3">
                <span className="text-[12px] font-bold text-[#c4c4be] w-4">{i + 1}</span>
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-[#111110]">{m.name}</p>
                  <p className="text-[11px] text-[#9a9a95]">{m.count} расчётов</p>
                </div>
                <p className="text-[13px] font-mono font-semibold text-[#111110]">{fmt(m.revenue, true)}</p>
              </div>
            ))}
            {data.topManagers.length === 0 && (
              <p className="px-5 py-6 text-[12px] text-[#9a9a95] text-center">Нет данных за этот месяц</p>
            )}
          </div>
        </div>

        {/* Recent calcs */}
        <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#f0f0ec] flex items-center justify-between">
            <p className="text-[13px] font-semibold text-[#111110]">Последние расчёты (7 дней)</p>
            <Link href="/calculations" className="text-[11px] text-blue-600 hover:underline">Все →</Link>
          </div>
          <div className="divide-y divide-[#f0f0ec]">
            {data.recentCalcs.map(c => {
              const mColor = c.margin >= 35 ? 'text-emerald-600' : c.margin >= 25 ? 'text-amber-600' : 'text-red-500'
              return (
                <Link key={c.id} href={`/calculations/${c.id}`}
                  className="flex items-center gap-3 px-5 py-2.5 hover:bg-[#f8f8f7] transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-[#c4c4be] font-mono">#{c.id}</span>
                      <span className="text-[11px] text-[#9a9a95]">{PRODUCT_LABELS[c.type] ?? c.type}</span>
                      {c.manager && <span className="text-[10px] text-[#b4b4b0] truncate">{c.manager}</span>}
                    </div>
                    <p className="text-[11px] text-[#9a9a95]">
                      {new Date(c.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[13px] font-mono font-semibold text-[#111110]">{fmt(c.price, true)}</p>
                    <p className={`text-[11px] font-semibold ${mColor}`}>{c.margin.toFixed(1)}%</p>
                  </div>
                </Link>
              )
            })}
            {data.recentCalcs.length === 0 && (
              <p className="px-5 py-6 text-[12px] text-[#9a9a95] text-center">Расчётов за 7 дней нет</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
