import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }
function pct(n: number)  { return n.toFixed(1) + '%' }

const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']

type MonthRow = {
  key:        string
  label:      string
  orders:     number
  revenue:    number
  cogs:       number
  grossProfit:number
  grossMargin:number
  expenses:   number
  netProfit:  number
  netMargin:  number
}

export default async function PnLPage() {
  const role = await getRole()
  if (role !== 'admin') redirect('/')

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Fetch orders (completed + in_work)
  const { data: orders } = await supabase
    .from('orders')
    .select('id, total_sale_price, total_cost_price, gross_profit, created_at, status')
    .in('status', ['completed', 'in_work', 'approved'])
    .order('created_at', { ascending: true })

  // Fetch financial settings for expenses %
  const { data: fin } = await supabase
    .from('financial_settings')
    .select('tax_percent, manager_percent, realization_percent, marketing_percent, transport_percent, operation_percent')
    .is('product_type', null)
    .limit(1)
    .single()

  const expensesRate = fin
    ? (fin.tax_percent + fin.manager_percent + fin.realization_percent +
       fin.marketing_percent + fin.transport_percent + fin.operation_percent) / 100
    : 0.37

  // Group by year-month
  const monthMap = new Map<string, MonthRow>()

  for (const o of (orders ?? [])) {
    const d     = new Date(o.created_at)
    const year  = d.getFullYear()
    const month = d.getMonth()
    const key   = `${year}-${String(month + 1).padStart(2, '0')}`
    const label = `${MONTH_NAMES[month]} ${year}`

    const existing = monthMap.get(key) ?? {
      key, label, orders: 0,
      revenue: 0, cogs: 0, grossProfit: 0, grossMargin: 0,
      expenses: 0, netProfit: 0, netMargin: 0,
    }

    existing.orders++
    existing.revenue    += o.total_sale_price    ?? 0
    existing.cogs       += o.total_cost_price    ?? 0
    existing.grossProfit += o.gross_profit       ?? 0

    monthMap.set(key, existing)
  }

  const rows: MonthRow[] = Array.from(monthMap.values()).map(r => {
    const expenses  = Math.round(r.revenue * expensesRate)
    const netProfit = r.grossProfit - expenses
    return {
      ...r,
      grossMargin: r.revenue > 0 ? (r.grossProfit / r.revenue) * 100 : 0,
      expenses,
      netProfit,
      netMargin: r.revenue > 0 ? (netProfit / r.revenue) * 100 : 0,
    }
  }).reverse()

  const totals = rows.reduce((acc, r) => ({
    orders:      acc.orders + r.orders,
    revenue:     acc.revenue + r.revenue,
    cogs:        acc.cogs + r.cogs,
    grossProfit: acc.grossProfit + r.grossProfit,
    expenses:    acc.expenses + r.expenses,
    netProfit:   acc.netProfit + r.netProfit,
  }), { orders: 0, revenue: 0, cogs: 0, grossProfit: 0, expenses: 0, netProfit: 0 })

  const totalGrossMargin = totals.revenue > 0 ? (totals.grossProfit / totals.revenue) * 100 : 0
  const totalNetMargin   = totals.revenue > 0 ? (totals.netProfit   / totals.revenue) * 100 : 0

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">P&amp;L — Финансовый отчёт</h1>
        <p className="text-[13px] text-[#8a8a85] mt-0.5">
          Выручка / Себестоимость / Валовая прибыль / Расходы / Чистая прибыль по месяцам
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Выручка всего',    value: fmt(totals.revenue),     color: 'text-[#111110]' },
          { label: 'Валовая прибыль',  value: fmt(totals.grossProfit),  color: 'text-emerald-700', sub: pct(totalGrossMargin) },
          { label: 'Расходы',          value: fmt(totals.expenses),     color: 'text-amber-700' },
          { label: 'Чистая прибыль',   value: fmt(totals.netProfit),    color: totals.netProfit >= 0 ? 'text-emerald-700' : 'text-red-700', sub: pct(totalNetMargin) },
        ].map(card => (
          <div key={card.label} className="bg-white border border-[#e4e4e0] rounded-xl px-5 py-4">
            <p className="text-[10px] font-bold text-[#9a9a95] uppercase tracking-widest mb-1">{card.label}</p>
            <p className={`text-[18px] font-bold font-mono ${card.color}`}>{card.value}</p>
            {card.sub && <p className="text-[11px] text-[#9a9a95] mt-0.5">{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* Expenses breakdown note */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 mb-5 flex items-center gap-2">
        <p className="text-[12px] text-amber-800">
          Расходы рассчитаны как <b>{Math.round(expensesRate * 100)}%</b> от выручки (налог + менеджер + реализация + маркетинг + транспорт + операционные)
        </p>
      </div>

      {/* Monthly table */}
      <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-[#f8f8f7] border-b border-[#e4e4e0]">
                <th className="px-4 py-3 text-left text-[10px] font-bold text-[#9a9a95] uppercase tracking-wider">Месяц</th>
                <th className="px-4 py-3 text-center text-[10px] font-bold text-[#9a9a95] uppercase tracking-wider">Заказов</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-[#9a9a95] uppercase tracking-wider">Выручка</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-[#9a9a95] uppercase tracking-wider">Себест.</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-[#9a9a95] uppercase tracking-wider">Вал. прибыль</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-[#9a9a95] uppercase tracking-wider">Маржа %</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-[#9a9a95] uppercase tracking-wider">Расходы</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-[#9a9a95] uppercase tracking-wider">Чист. приб.</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-[#9a9a95] uppercase tracking-wider">ЧМ %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0ec]">
              {rows.map(r => (
                <tr key={r.key} className="hover:bg-[#fafaf9] transition-colors">
                  <td className="px-4 py-3 font-medium text-[#111110]">{r.label}</td>
                  <td className="px-4 py-3 text-center text-[#6b6b66]">{r.orders}</td>
                  <td className="px-4 py-3 text-right font-mono text-[#111110]">{fmt(r.revenue)}</td>
                  <td className="px-4 py-3 text-right font-mono text-[#9a9a95]">{fmt(r.cogs)}</td>
                  <td className="px-4 py-3 text-right font-mono text-emerald-700 font-semibold">{fmt(r.grossProfit)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                      r.grossMargin >= 40 ? 'bg-emerald-50 text-emerald-700' :
                      r.grossMargin >= 30 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
                    }`}>{pct(r.grossMargin)}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-amber-700">{fmt(r.expenses)}</td>
                  <td className={`px-4 py-3 text-right font-mono font-semibold ${r.netProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {fmt(r.netProfit)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                      r.netMargin >= 15 ? 'bg-emerald-50 text-emerald-700' :
                      r.netMargin >= 5  ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
                    }`}>{pct(r.netMargin)}</span>
                  </td>
                </tr>
              ))}

              {/* Totals row */}
              <tr className="bg-[#f8f8f7] font-bold border-t-2 border-[#e4e4e0]">
                <td className="px-4 py-3 text-[#111110]">Итого</td>
                <td className="px-4 py-3 text-center text-[#111110]">{totals.orders}</td>
                <td className="px-4 py-3 text-right font-mono text-[#111110]">{fmt(totals.revenue)}</td>
                <td className="px-4 py-3 text-right font-mono text-[#9a9a95]">{fmt(totals.cogs)}</td>
                <td className="px-4 py-3 text-right font-mono text-emerald-700">{fmt(totals.grossProfit)}</td>
                <td className="px-4 py-3 text-right">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                    totalGrossMargin >= 40 ? 'bg-emerald-100 text-emerald-800' :
                    totalGrossMargin >= 30 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'
                  }`}>{pct(totalGrossMargin)}</span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-amber-700">{fmt(totals.expenses)}</td>
                <td className={`px-4 py-3 text-right font-mono ${totals.netProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {fmt(totals.netProfit)}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                    totalNetMargin >= 15 ? 'bg-emerald-100 text-emerald-800' :
                    totalNetMargin >= 5  ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'
                  }`}>{pct(totalNetMargin)}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {rows.length === 0 && (
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-12 text-center mt-4">
          <p className="text-[13px] text-[#9a9a95]">Нет данных по заказам</p>
        </div>
      )}
    </div>
  )
}
