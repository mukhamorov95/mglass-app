import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { orderContribution, contributionColor, rub, pct, m2 } from '@/lib/unitEconomics'
import { isSheetMaterial } from '@/lib/materialUsage'
import { orderCutFacts, type CutRow, type CutRemnant } from '@/lib/production/cutFacts'
import { VAT } from '@/lib/b2bCalculator'

// Экономика ОДНОГО заказа — только владелец, под /cfo. Все цифры — из lib/unitEconomics
// (одно определение на всю систему). Цех на окладе: работу цеха на заказ не делим и
// ставок «за м², деталь, погонный метр» не показываем — решение владельца 15.09.

export const dynamic = 'force-dynamic'

const num = (x: unknown) => Number(x) || 0
const fmt = rub
const COLOR = { red: 'text-red-600', amber: 'text-amber-600', green: 'text-emerald-600' } as const

type RawItem = Record<string, unknown>

export default async function OrderEconomicsDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: o } = await svc.from('b2b_orders')
    .select('id, custom_number, client_name, total_after_discount, total_sale_inc_vat, discount_percent, items, launched_at')
    .eq('id', Number(id)).single()

  if (!o) {
    return <div className="bg-[#f5f5f3] min-h-screen p-8 text-center text-sm text-[#9a9a95]">Заказ не найден. <Link href="/cfo/order-economics" className="text-blue-600">← К списку</Link></div>
  }

  const rawItems = Array.isArray(o.items) ? (o.items as RawItem[]) : []
  const revenue = num(o.total_after_discount) || num(o.total_sale_inc_vat)
  const c = orderContribution(revenue, rawItems)
  const cls = COLOR[contributionColor(c.contributionPct)]

  // ── Материал: сколько заложено в просчёт и сколько вышло по факту нарезки. Отход по
  // раскрою больше не считаем (решение владельца 16.09) — факт даёт журнал листов. ──
  const planByMaterial = new Map<string, { label: string; netM2: number; billedM2: number; cost: number }>()
  for (const it of rawItems) {
    if (!isSheetMaterial(String(it.category ?? ''))) continue
    const name = String(it.materialName ?? ''), thk = num(it.thickness)
    const key = `${name}|${thk}`
    const netM2 = num(it.width) * num(it.height) * num(it.quantity) / 1_000_000
    const a = planByMaterial.get(key) ?? { label: `${name}${thk > 0 ? ' ' + thk + ' мм' : ''}`, netM2: 0, billedM2: 0, cost: 0 }
    a.netM2 += netM2
    a.billedM2 += num(it.totalAreaBilled) || netM2
    a.cost += num(it.costMaterial)
    planByMaterial.set(key, a)
  }
  const plan = [...planByMaterial.values()].sort((a, b) => b.cost - a.cost)
  const netTotal = plan.reduce((s2, p) => s2 + p.netM2, 0)

  const { data: cutRows } = await svc.from('sheet_cuts')
    .select('id, material_name, thickness, source, sheet_w, sheet_h, order_ids, created_by_name, created_at')
    .contains('order_ids', [Number(id)]).order('created_at')
  const cuts = (cutRows ?? []) as CutRow[]
  const { data: remRows } = cuts.length
    ? await svc.from('sheet_remnants').select('from_cut_id, code, width_mm, height_mm, status').in('from_cut_id', cuts.map(c => c.id))
    : { data: [] as CutRemnant[] }
  const fact = orderCutFacts(cuts, (remRows ?? []) as CutRemnant[], Number(id), netTotal)

  const numLabel = o.custom_number ?? `#${o.id}`
  const discount = num(o.discount_percent)

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[900px] mx-auto px-4 py-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-sm font-semibold text-[#111110]">Экономика заказа {numLabel} · {String(o.client_name ?? '—')}</h1>
            <p className="text-[10px] text-[#9a9a95] mt-0.5">
              Запущен {o.launched_at ? String(o.launched_at).slice(0, 10) : '—'} · {c.pieces} дет. · {m2(c.netM2)} м² нетто{discount > 0 ? ` · скидка ${discount}%` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/cfo/order-economics" className="px-3 py-1.5 text-xs border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-white">← Все заказы</Link>
            <Link href="/b2b-orders" className="px-3 py-1.5 text-xs border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-white">B2B заказы</Link>
          </div>
        </div>

        {/* Итог в одну строку: выручка − переменные − НДС = остаётся с заказа */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Выручка" value={`${fmt(c.revenue)} ₽`} sub="с НДС, после скидки" />
          <Kpi label="Переменные" value={`− ${fmt(c.variable)} ₽`} sub="материал, закалка, доставка, упаковка" />
          {c.vatToPay >= 0
            ? <Kpi label="НДС к уплате" value={`− ${fmt(c.vatToPay)} ₽`} sub="исходящий − входящий" />
            : <Kpi label="НДС к возмещению" value={`+ ${fmt(-c.vatToPay)} ₽`} sub="входящий больше исходящего" />}
          <Kpi label="Остаётся с заказа" value={`${fmt(c.contribution)} ₽`} cls={cls} sub={`${pct(c.contributionPct)}% от выручки без НДС`} bold />
        </div>

        {/* Что значит последняя цифра — простыми словами, на цифрах этого заказа */}
        <p className={`text-xs leading-relaxed rounded-lg px-3 py-2 border ${c.contribution > 0 ? 'bg-white border-[#e4e4e0] text-[#4b4b47]' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {c.contribution > 0
            ? <>Это не вложение, а то, что заказ приносит. Клиент заплатил {fmt(c.revenue)} ₽, из них {fmt(c.variable)} ₽ ушло на материал, закалку, доставку и упаковку, {fmt(Math.max(0, c.vatToPay))} ₽ — НДС в бюджет. <b>Остаётся {fmt(c.contribution)} ₽</b> — из таких остатков по всем заказам месяца платятся оклады, аренда, лизинг и кредит, а что сверху — прибыль.</>
            : <>Заказ в минусе на {fmt(-c.contribution)} ₽: материал, закалка, доставка, упаковка и НДС стоят больше, чем заплатил клиент. На оклады и аренду с этого заказа не остаётся ничего — их доплачивают другие заказы.</>}
        </p>

        {/* Себестоимость: что посчитано и как */}
        <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#e4e4e0]">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Себестоимость: что посчитано и как</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-[#9a9a95] border-b border-[#f5f5f3]">
                  <th className="px-4 py-2 text-left font-medium">Статья</th>
                  <th className="px-4 py-2 text-left font-medium">Как посчитано</th>
                  <th className="px-4 py-2 text-right font-medium whitespace-nowrap">Сумма</th>
                  <th className="px-4 py-2 text-right font-medium whitespace-nowrap">НДС к вычету</th>
                </tr>
              </thead>
              <tbody>
                {c.lines.map(l => (
                  <tr key={l.key} className="border-b border-[#f7f7f5]">
                    <td className="px-4 py-2 text-[#111110] whitespace-nowrap">{l.label}</td>
                    <td className="px-4 py-2 text-[#6b6b66]">{l.how}</td>
                    <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{fmt(l.amount)} ₽</td>
                    <td className="px-4 py-2 text-right font-mono text-[#9a9a95] whitespace-nowrap">{l.vatIn > 0 ? `${fmt(l.vatIn)} ₽` : '—'}</td>
                  </tr>
                ))}
                <tr className="border-b border-[#e4e4e0] bg-[#fafaf9]">
                  <td className="px-4 py-2 font-semibold text-[#111110]" colSpan={2}>Переменные итого</td>
                  <td className="px-4 py-2 text-right font-mono font-bold whitespace-nowrap">{fmt(c.variable)} ₽</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold whitespace-nowrap">{fmt(c.vatIn)} ₽</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-[#f0f0ec] grid md:grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
            <Row label={`НДС исходящий (${VAT}/${100 + VAT} выручки)`} value={`${fmt(c.vatOut)} ₽`} />
            <Row label="Выручка без НДС" value={`${fmt(c.revenueExVat)} ₽`} />
            <Row label="− НДС к вычету" value={`${fmt(c.vatIn)} ₽`} />
            <Row label="− Переменные без НДС" value={`${fmt(c.variable - c.vatIn)} ₽`} />
            <Row label={c.vatToPay >= 0 ? '= НДС к уплате' : '= НДС к возмещению'} value={`${fmt(Math.abs(c.vatToPay))} ₽`} bold />
            <Row label="= Остаётся с заказа" value={`${fmt(c.contribution)} ₽`} bold valueClass={cls} />
          </div>

        </div>

        <div>
          {/* Материал: план просчёта и факт нарезки */}
          <div className="bg-white rounded-lg border border-[#e4e4e0] p-4">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-3">Материал: расход</p>
            {plan.length === 0 ? (
              <p className="text-xs text-[#9a9a95]">В заказе нет листового стекла.</p>
            ) : (
              <div className="space-y-2.5">
                {plan.map(p => (
                  <div key={p.label} className="text-xs">
                    <p className="text-[#111110] font-medium">{p.label}</p>
                    <p className="text-[11px] text-[#6b6b66] mt-0.5 font-mono">
                      детали {m2(p.netM2)} м² · в просчёте {m2(p.billedM2)} м²
                      {p.netM2 > 0 && ` (+${Math.round((p.billedM2 / p.netM2 - 1) * 100)}% по справочнику)`}
                    </p>
                  </div>
                ))}

                <div className="pt-2 border-t border-[#f0f0ec]">
                  <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1.5">Факт нарезки</p>
                  {fact.rows.length === 0 ? (
                    <p className="text-[11px] text-[#9a9a95] leading-relaxed">
                      Резчик ещё не закрыл лист по этому заказу. Факт появится, когда он отметит лист и остатки на экране «Остатки» в цехе.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {fact.rows.map(r => (
                        <p key={r.cutId} className="text-[11px] text-[#6b6b66] font-mono">
                          {r.fromRemnant ? 'остаток' : 'лист'} {r.sheetLabel} ({m2(r.sheetM2)} м²)
                          {r.remnantM2 > 0 && ` · на стеллаж ${m2(r.remnantM2)} м²${r.remnantCodes.length ? ' (' + r.remnantCodes.join(', ') + ')' : ''}`}
                          {r.wasteM2 != null ? ` · отход ${m2(r.wasteM2)} м²` : ''}
                          {r.sharedWith.length > 0 && ` · лист общий с #${r.sharedWith.join(', #')}`}
                        </p>
                      ))}
                      {fact.wasteM2 != null && (
                        <p className="text-[11px] text-[#111110]">
                          Отход по факту: <span className="font-mono font-semibold">{m2(fact.wasteM2)} м²</span>
                          {fact.wastePct != null && ` (${fact.wastePct}% к деталям)`}, на стеллаж <span className="font-mono">{m2(fact.remnantM2)} м²</span>.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <p className="text-[10px] text-[#9a9a95] leading-relaxed pt-1 border-t border-[#f0f0ec]">
                  В просчёте расход по справочнику «Стекло». Отход по раскрою в себестоимость не берём: раскрой планирует резку, а расход считает резчик после нарезки.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Позиции */}
        <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#e4e4e0]"><p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Позиции</p></div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead><tr className="border-b border-[#f5f5f3] text-[10px] text-[#9a9a95]">
                {['Материал', 'Размер', 'Кол-во', 'Толщ.', 'Отход', 'Материал ₽', 'Закалка', 'Отв.'].map(h => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {rawItems.map((it, i) => (
                  <tr key={i} className="border-b border-[#f5f5f3] last:border-0">
                    <td className="px-3 py-2 text-[#111110]">{String(it.materialName ?? '')}</td>
                    <td className="px-3 py-2 font-mono text-[#6b6b66]">{num(it.width)}×{num(it.height)}</td>
                    <td className="px-3 py-2 font-mono">{num(it.quantity)}</td>
                    <td className="px-3 py-2 font-mono text-[#9a9a95]">{num(it.thickness)}</td>
                    <td className="px-3 py-2 font-mono text-[#6b6b66]">{pct(num(it.wastePercent))}%</td>
                    <td className="px-3 py-2 font-mono">{fmt(num(it.costMaterial))}</td>
                    <td className="px-3 py-2">{it.hasTempering ? '✓' : '—'}</td>
                    <td className="px-3 py-2">{it.hasHoles ? '✓' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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
function Row({ label, value, bold, valueClass }: { label: string; value: string; bold?: boolean; valueClass?: string }) {
  return (
    <div className="flex justify-between">
      <span className={bold ? 'text-[#111110] font-medium' : 'text-[#6b6b66]'}>{label}</span>
      <span className={`font-mono ${bold ? 'font-bold' : 'font-medium'} ${valueClass ?? 'text-[#111110]'}`}>{value}</span>
    </div>
  )
}
