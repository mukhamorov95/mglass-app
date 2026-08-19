import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'

const MARGIN_RED    = 25
const MARGIN_AMBER  = 35

function fmtMoney(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + ' млн ₽'
  if (n >= 1_000)     return Math.round(n / 1_000) + ' тыс ₽'
  return n.toLocaleString('ru-RU') + ' ₽'
}

function marginColor(m: number) {
  if (m < MARGIN_RED)   return 'text-red-600 bg-red-50'
  if (m < MARGIN_AMBER) return 'text-amber-600 bg-amber-50'
  return 'text-emerald-600 bg-emerald-50'
}

const PRODUCT_LABEL: Record<string, string> = {
  mirror:          'Зеркало',
  mirror_light:    'Зеркало ПС',
  loft:            'Лофт',
  shower:          'Душевая',
  shower_standard: 'Душевая',
  shower_budget:   'Душевая',
}

export default async function CfoDashboardPage() {
  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [{ data: allCalcs }, { data: monthCalcs }] = await Promise.all([
    svc
      .from('calculations')
      .select('id, created_at, product_type, final_price, margin, profit, status, client_name')
      .order('created_at', { ascending: false })
      .limit(200),
    svc
      .from('calculations')
      .select('final_price, margin, profit, status, product_type')
      .gte('created_at', monthStart),
  ])

  const all   = allCalcs   ?? []
  const month = monthCalcs ?? []

  const approved = month.filter(c => c.status === 'approved')
  const revenue  = approved.reduce((s, c) => s + (c.final_price ?? 0), 0)
  const profit   = approved.reduce((s, c) => s + (c.profit ?? 0), 0)
  const avgMargin = approved.length > 0
    ? approved.reduce((s, c) => s + (c.margin ?? 0), 0) / approved.length
    : 0

  // All calculations this month (any status) for margin distribution
  const allMonth = month
  const belowMin   = allMonth.filter(c => (c.margin ?? 0) < MARGIN_RED).length
  const belowTarget = allMonth.filter(c => (c.margin ?? 0) < MARGIN_AMBER && (c.margin ?? 0) >= MARGIN_RED).length
  const onTarget   = allMonth.filter(c => (c.margin ?? 0) >= MARGIN_AMBER).length

  // Product type revenue (approved)
  const byProduct: Record<string, number> = {}
  for (const c of approved) {
    const t = PRODUCT_LABEL[c.product_type ?? ''] ?? c.product_type ?? 'Другое'
    byProduct[t] = (byProduct[t] ?? 0) + (c.final_price ?? 0)
  }

  const recent = all.slice(0, 15)

  const kpiCards = [
    { label: 'Выручка (месяц, факт)', value: fmtMoney(revenue),        color: 'text-[#111110]', hint: `${approved.length} одобренных` },
    { label: 'Прибыль (месяц)',        value: fmtMoney(profit),         color: profit > 0 ? 'text-emerald-700' : 'text-red-600', hint: 'после налогов' },
    { label: 'Средняя маржа',          value: `${avgMargin.toFixed(1)}%`, color: avgMargin >= MARGIN_AMBER ? 'text-emerald-700' : avgMargin >= MARGIN_RED ? 'text-amber-600' : 'text-red-600', hint: 'одобренные расчёты' },
    { label: 'Расчётов за месяц',      value: String(allMonth.length),  color: 'text-[#111110]', hint: `одобрено: ${approved.length}` },
  ]

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[960px] mx-auto px-4 py-4 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-sm font-semibold text-[#111110]">CFO Center — Дашборд</h1>
            <p className="text-[10px] text-[#9a9a95] mt-0.5">
              Финансовый контур MGlass · {now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/cfo/model" className="px-3 py-1.5 text-xs border border-[#0f8b93] rounded-lg text-[#0f8b93] font-medium hover:bg-[#e6f1f1] transition-colors">
              Финмодель →
            </Link>
            <Link href="/cfo/b2b" className="px-3 py-1.5 text-xs border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-white transition-colors">
              B2B аналитика →
            </Link>
            <Link href="/cfo/margins" className="px-3 py-1.5 text-xs border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-white transition-colors">
              Маржинальность →
            </Link>
            <Link href="/admin/cfo" className="px-3 py-1.5 text-xs bg-[#111110] text-white rounded-lg font-medium hover:bg-[#2a2a28] transition-colors">
              Финмодели / ДДС →
            </Link>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-4 gap-3">
          {kpiCards.map(c => (
            <div key={c.label} className="bg-white rounded-lg border border-[#e4e4e0] px-3 py-3">
              <p className="text-[10px] text-[#9a9a95] font-medium">{c.label}</p>
              <p className={`text-lg font-bold font-mono mt-0.5 leading-tight ${c.color}`}>{c.value}</p>
              <p className="text-[10px] text-[#c4c4be] mt-0.5">{c.hint}</p>
            </div>
          ))}
        </div>

        {/* Alerts */}
        {(belowMin > 0) && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center gap-3">
            <span className="text-red-500 text-lg">⚠️</span>
            <div>
              <p className="text-xs font-semibold text-red-700">
                {belowMin} расчёт(ов) с маржой ниже {MARGIN_RED}% в этом месяце
              </p>
              <p className="text-[10px] text-red-500 mt-0.5">
                Проверь скидки и себестоимость
              </p>
            </div>
            <Link href="/cfo/margins?filter=low" className="ml-auto text-xs text-red-600 font-medium hover:underline">
              Смотреть →
            </Link>
          </div>
        )}

        <div className="grid grid-cols-[1fr_260px] gap-3">

          {/* Recent calculations */}
          <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#e4e4e0] flex items-center justify-between">
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Последние расчёты</p>
              <Link href="/cfo/margins" className="text-[10px] text-[#9a9a95] hover:text-[#111110]">Все →</Link>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#f5f5f3]">
                  {['#', 'Продукт', 'Клиент', 'Цена', 'Маржа', 'Статус'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] text-[#9a9a95] font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map(c => (
                  <tr key={c.id} className="border-b border-[#f5f5f3] last:border-0 hover:bg-[#fafaf9]">
                    <td className="px-3 py-2 text-[#9a9a95] font-mono">{c.id}</td>
                    <td className="px-3 py-2">{PRODUCT_LABEL[c.product_type ?? ''] ?? c.product_type}</td>
                    <td className="px-3 py-2 text-[#6b6b66] max-w-[120px] truncate">{c.client_name || '—'}</td>
                    <td className="px-3 py-2 font-mono font-medium">{fmtMoney(c.final_price ?? 0)}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${marginColor(c.margin ?? 0)}`}>
                        {(c.margin ?? 0).toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-medium ${
                        c.status === 'approved' ? 'text-emerald-600' :
                        c.status === 'sent' ? 'text-blue-600' : 'text-[#9a9a95]'
                      }`}>
                        {c.status === 'approved' ? 'Одобрен' : c.status === 'sent' ? 'Отправлен' : c.status ?? 'Черновик'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Right column */}
          <div className="space-y-3">
            {/* Margin distribution */}
            <div className="bg-white rounded-lg border border-[#e4e4e0] p-4">
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-3">Распределение маржи</p>
              <div className="space-y-2">
                {[
                  { label: `Ниже ${MARGIN_RED}%`,               count: belowMin,    color: 'bg-red-400',   text: 'text-red-600' },
                  { label: `${MARGIN_RED}–${MARGIN_AMBER}%`,     count: belowTarget, color: 'bg-amber-400', text: 'text-amber-600' },
                  { label: `Выше ${MARGIN_AMBER}%`,              count: onTarget,    color: 'bg-emerald-400', text: 'text-emerald-600' },
                ].map(item => {
                  const total = allMonth.length || 1
                  const pct   = Math.round((item.count / total) * 100)
                  return (
                    <div key={item.label}>
                      <div className="flex justify-between text-[10px] mb-0.5">
                        <span className={`font-medium ${item.text}`}>{item.label}</span>
                        <span className="text-[#9a9a95]">{item.count} шт · {pct}%</span>
                      </div>
                      <div className="h-1.5 bg-[#f0f0ec] rounded-full overflow-hidden">
                        <div className={`h-full ${item.color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Revenue by product */}
            {Object.keys(byProduct).length > 0 && (
              <div className="bg-white rounded-lg border border-[#e4e4e0] p-4">
                <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-3">Выручка по продуктам</p>
                <div className="space-y-2">
                  {Object.entries(byProduct)
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, rev]) => (
                      <div key={name} className="flex justify-between text-xs">
                        <span className="text-[#6b6b66]">{name}</span>
                        <span className="font-mono font-medium text-[#111110]">{fmtMoney(rev)}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Quick links */}
            <div className="bg-white rounded-lg border border-[#e4e4e0] p-4 space-y-1">
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2">Быстрые ссылки</p>
              {[
                { href: '/cfo/model',   label: 'Финмодель — факт и сценарии' },
                { href: '/cfo/b2b',     label: 'B2B аналитика (оборот/материал/закалка)' },
                { href: '/cfo/order-economics', label: 'Честная экономика заказа (раскрой + труд)' },
                { href: '/cfo/margins', label: 'Таблица маржинальности' },
                { href: '/cfo/unit',    label: 'Unit-экономика заказов' },
                { href: '/admin/cfo',   label: 'Финмодели и ДДС' },
                { href: '/admin/pnl',   label: 'P&L отчёт' },
                { href: '/admin/settings', label: 'Финансовые настройки' },
              ].map(l => (
                <Link key={l.href} href={l.href}
                  className="flex items-center justify-between py-1 text-xs text-[#6b6b66] hover:text-[#111110] transition-colors group">
                  <span>{l.label}</span>
                  <span className="opacity-0 group-hover:opacity-100 text-[#9a9a95]">→</span>
                </Link>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
