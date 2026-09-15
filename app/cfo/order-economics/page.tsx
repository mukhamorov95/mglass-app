import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { orderContribution, sumContributions, contributionColor, type OrderContribution } from '@/lib/unitEconomics'

// Экономика B2B-заказов за месяц — только /cfo. Себестоимость и вклад каждого
// заказа — из lib/unitEconomics, тем же расчётом, что на карточке заказа и в списке
// просчётов. Сумма вкладов сравнивается с постоянными расходами производства из
// финмодели (finplan_models) — единственного источника постоянных.

export const dynamic = 'force-dynamic'

const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
const COLOR = { red: 'text-red-600', amber: 'text-amber-600', green: 'text-emerald-600' } as const

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU')
function fmtM(n: number) {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2).replace('.', ',') + ' млн'
  if (Math.abs(n) >= 1_000) return Math.round(n / 1_000) + ' тыс'
  return String(Math.round(n))
}
const num = (x: unknown) => Number(x) || 0

type Row = OrderContribution & { id: number; client: string }

export default async function OrderEconomicsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams
  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const now = new Date()
  const monthStr = sp.month && /^\d{4}-\d{2}$/.test(sp.month)
    ? sp.month
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [y, m] = monthStr.split('-').map(Number)
  const from = `${monthStr}-01`
  const to = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`

  const [{ data: ordersRaw }, { data: model }] = await Promise.all([
    // launched_at IS NOT NULL обеспечивается самим .gte (NULL не проходит сравнение).
    svc.from('b2b_orders')
      .select('id, client_name, total_after_discount, total_sale_inc_vat, items, launched_at')
      .is('archived_at', null)
      .gte('launched_at', from).lt('launched_at', to)
      .order('launched_at'),
    svc.from('finplan_models').select('data').eq('unit', 'production').maybeSingle(),
  ])

  const rows: Row[] = ((ordersRaw ?? []) as Record<string, unknown>[])
    .map(o => ({
      ...orderContribution(num(o.total_after_discount) || num(o.total_sale_inc_vat), Array.isArray(o.items) ? o.items as Record<string, unknown>[] : []),
      id: Number(o.id), client: String(o.client_name ?? '—'),
    }))
    .filter(r => r.revenue > 0)
    .sort((a, b) => a.contributionPct - b.contributionPct)
  const p = sumContributions(rows)

  const fixedLines = ((model?.data as { fixed?: { amount?: number }[] } | null)?.fixed ?? [])
  const fixed = fixedLines.reduce((s, f) => s + num(f.amount), 0)
  const coverage = fixed > 0 ? Math.round(p.contribution / fixed * 100) : 0
  const gap = fixed - p.contribution

  const isCurrent = monthStr === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthLabel = `${MONTHS[m - 1]} ${y}`
  const prevM = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
  const nextM = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[1080px] mx-auto px-4 py-4 space-y-4">

        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-sm font-semibold text-[#111110]">Экономика заказов — B2B-цех</h1>
            <p className="text-[10px] text-[#9a9a95] mt-0.5">
              Выручка минус переменные расходы и НДС к уплате — вклад в покрытие постоянных · {monthLabel}
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <Link href={`/cfo/order-economics?month=${prevM}`} className="px-2 py-1.5 text-xs border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-white">←</Link>
            <span className="text-xs font-mono text-[#6b6b66]">{monthLabel}</span>
            <Link href={`/cfo/order-economics?month=${nextM}`} className="px-2 py-1.5 text-xs border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-white">→</Link>
            <Link href="/cfo" className="px-3 py-1.5 text-xs bg-[#111110] text-white rounded-lg font-medium hover:bg-[#2a2a28]">CFO →</Link>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="bg-white rounded-lg border border-[#e4e4e0] px-4 py-8 text-center text-xs text-[#9a9a95]">
            За {monthLabel} нет запущенных заказов с выручкой.
          </div>
        ) : (
        <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label={`Выручка · ${p.count} зак.`} value={`${fmtM(p.revenue)} ₽`} sub="с НДС" />
          <Kpi label="Переменные" value={`− ${fmtM(p.variable)} ₽`} sub="материал, закалка, доставка, упаковка" />
          <Kpi label="НДС к уплате" value={`− ${fmtM(p.vatToPay)} ₽`} sub="исходящий − входящий" />
          <Kpi label="Вклад" value={`${fmtM(p.contribution)} ₽`} cls={COLOR[contributionColor(p.contributionPct)]}
               sub={`${p.contributionPct.toLocaleString('ru-RU')}% от выручки без НДС`} bold />
        </div>

        {/* Покрытие постоянных — ради этой цифры и считается вклад */}
        {fixed > 0 && (
          <div className="bg-white rounded-lg border border-[#e4e4e0] p-4">
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Покрытие постоянных расходов производства</p>
              <p className="text-[10px] text-[#9a9a95]">постоянные из финмодели: {fmt(fixed)} ₽/мес</p>
            </div>
            <div className="mt-3 h-2.5 rounded-full bg-[#f0f0ee] overflow-hidden">
              <div className={`h-full rounded-full ${coverage >= 100 ? 'bg-emerald-600' : 'bg-amber-500'}`} style={{ width: `${Math.min(coverage, 100)}%` }} />
            </div>
            <div className="mt-2 flex items-baseline justify-between flex-wrap gap-2 text-xs">
              <span className="text-[#111110]">
                Вклад покрывает <span className="font-mono font-bold">{coverage}%</span>
                {gap > 0
                  ? <> · не хватает <span className="font-mono font-bold text-amber-700">{fmt(gap)} ₽</span></>
                  : <> · сверх постоянных <span className="font-mono font-bold text-emerald-700">{fmt(-gap)} ₽</span></>}
              </span>
              {isCurrent && <span className="text-[10px] text-[#9a9a95]">месяц ещё идёт — считаются заказы, запущенные на сегодня</span>}
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#e4e4e0]">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Заказы — от меньшего вклада</p>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b border-[#f5f5f3] text-[10px] text-[#9a9a95]">
                {['#', 'Клиент', 'Выручка', 'Переменные', 'НДС к уплате', 'Вклад', 'Вклад %'].map(h => (
                  <th key={h} className={`px-3 py-2 font-medium ${h === '#' || h === 'Клиент' ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 80).map(r => (
                <tr key={r.id} className="border-b border-[#f5f5f3] last:border-0 hover:bg-[#fafaf9]">
                  <td className="px-3 py-2 font-mono"><Link href={`/cfo/order-economics/${r.id}`} className="text-[#0071e3] hover:underline">{r.id}</Link></td>
                  <td className="px-3 py-2 text-[#6b6b66] max-w-[180px] truncate">{r.client}</td>
                  <td className="px-3 py-2 font-mono text-right">{fmt(r.revenue)}</td>
                  <td className="px-3 py-2 font-mono text-right text-[#6b6b66]">{fmt(r.variable)}</td>
                  <td className="px-3 py-2 font-mono text-right text-[#9a9a95]">{fmt(r.vatToPay)}</td>
                  <td className={`px-3 py-2 font-mono text-right font-semibold ${COLOR[contributionColor(r.contributionPct)]}`}>{fmt(r.contribution)}</td>
                  <td className={`px-3 py-2 font-mono text-right font-bold ${COLOR[contributionColor(r.contributionPct)]}`}>{r.contributionPct.toLocaleString('ru-RU')}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {rows.length > 80 && <p className="px-4 py-2 text-[10px] text-[#9a9a95]">Показаны 80 из {rows.length} заказов — с наименьшим вкладом.</p>}
        </div>

        <p className="text-[10px] text-[#9a9a95] leading-relaxed">
          Вклад = выручка − переменные − НДС к уплате. Переменные: материал по раскрою, закалка, доставка на закалку, упаковка, подрядные услуги.
          Оклады цеха, аренда, лизинг и кредит — постоянные расходы, в себестоимость заказа не входят и покрываются суммой вкладов.
        </p>
        </>
        )}
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, cls, bold }: { label: string; value: string; sub?: string; cls?: string; bold?: boolean }) {
  return (
    <div className={`bg-white rounded-lg px-3 py-3 ${bold ? 'border-2 border-[#111110]' : 'border border-[#e4e4e0]'}`}>
      <p className="text-[10px] text-[#9a9a95] font-medium">{label}</p>
      <p className={`text-lg font-bold font-mono mt-0.5 ${cls ?? 'text-[#111110]'}`}>{value}</p>
      {sub && <p className="text-[10px] text-[#9a9a95] mt-0.5">{sub}</p>}
    </div>
  )
}
