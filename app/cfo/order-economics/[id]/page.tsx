import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { orderContribution, contributionColor, rub, pct, m2 } from '@/lib/unitEconomics'
import { computeMaterialUsage, isSheetMaterial, type UsageItem } from '@/lib/materialUsage'
import { CALC_REUSE_RATE } from '@/lib/autoWasteApply'
import { REMNANT_MIN_SHORT, REMNANT_MIN_LONG } from '@/lib/cuttingOptimizer'
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

  const [{ data: mats }, { data: variants }] = await Promise.all([
    svc.from('b2b_materials').select('id, name, thickness, sheet_width, sheet_height, pattern_direction'),
    svc.from('b2b_material_sheet_variants').select('material_id, sheet_width, sheet_height, is_default, sort_order').eq('active', true).order('material_id').order('is_default', { ascending: false }).order('sort_order'),
  ])

  const rawItems = Array.isArray(o.items) ? (o.items as RawItem[]) : []
  const revenue = num(o.total_after_discount) || num(o.total_sale_inc_vat)
  const c = orderContribution(revenue, rawItems)
  const cls = COLOR[contributionColor(c.contributionPct)]

  // ── Материал: как получился отход. Тот же раскрой и тот же возврат остатка, что
  // в калькуляторе (CALC_REUSE_RATE), — чтобы не было второй цифры материала. ──
  const fmtById = new Map<number, { width: number; height: number }[]>()
  for (const v of (variants ?? []) as Record<string, unknown>[]) {
    const w = num(v.sheet_width), h = num(v.sheet_height)
    if (!(w > 0) || !(h > 0)) continue
    const arr = fmtById.get(Number(v.material_id)) ?? []
    arr.push({ width: w, height: h }); fmtById.set(Number(v.material_id), arr)
  }
  const sheet = new Map<string, { w: number; h: number; pat: string; fmts?: { width: number; height: number }[] }>()
  for (const mt of (mats ?? []) as Record<string, unknown>[])
    sheet.set(`${mt.name}|${Number(mt.thickness)}`, { w: num(mt.sheet_width) || 3210, h: num(mt.sheet_height) || 2250, pat: String(mt.pattern_direction ?? 'none'), fmts: fmtById.get(Number(mt.id)) })

  const usageItems: UsageItem[] = rawItems
    .filter(it => num(it.width) > 0 && num(it.height) > 0 && num(it.quantity) > 0 && isSheetMaterial(String(it.category ?? '')))
    .map(it => {
      const name = String(it.materialName ?? ''), thk = num(it.thickness)
      const s = sheet.get(`${name}|${thk}`)
      const billed = num(it.totalAreaBilled)
      return {
        materialName: name, thickness: thk, category: String(it.category ?? ''),
        width: num(it.width), height: num(it.height), quantity: num(it.quantity),
        costPerM2: billed > 0 ? num(it.costMaterial) / billed : 0,
        sheetWidth: s?.w, sheetHeight: s?.h, sheetFormats: s?.fmts,
        patternDirection: (s?.pat ?? 'none') as UsageItem['patternDirection'],
      }
    })
  const usage = computeMaterialUsage(usageItems, CALC_REUSE_RATE)
  const storedByMaterial = new Map<string, number>()
  for (const it of rawItems) {
    const key = `${String(it.materialName ?? '')}|${num(it.thickness)}|${String(it.category ?? '')}`
    storedByMaterial.set(key, (storedByMaterial.get(key) ?? 0) + num(it.costMaterial))
  }
  // Риск остатков: если крупный остаток не вернётся на стеллаж, в материал уходят целые листы.
  const scrapRisk = usage.reduce((s, u) => s + Math.max(0, u.fullSheetsCost - (storedByMaterial.get(u.materialKey) ?? 0)), 0)
  const contributionIfScrap = c.contribution - Math.round(scrapRisk - scrapRisk * VAT / (100 + VAT))

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
          {/* Материал: откуда отход */}
          <div className="bg-white rounded-lg border border-[#e4e4e0] p-4">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-3">Материал: откуда отход</p>
            {usage.length === 0 ? (
              <p className="text-xs text-[#9a9a95]">В заказе нет листового стекла — раскрой не нужен.</p>
            ) : (
              <div className="space-y-2.5">
                {usage.map(u => (
                  <div key={u.materialKey} className="text-xs">
                    <p className="text-[#111110] font-medium">{u.materialLabel}</p>
                    <p className="text-[11px] text-[#6b6b66] mt-0.5 font-mono">
                      нетто {m2(u.netM2)} м² · {u.sheets} л. ({m2(u.sheetM2)} м²) · остаток {m2(u.remnantM2)} м²
                    </p>
                  </div>
                ))}
                <p className="text-[10px] text-[#9a9a95] leading-relaxed pt-1 border-t border-[#f0f0ec]">
                  Заказ платит за детали, рез и полосы. Кусок от {REMNANT_MIN_SHORT}×{REMNANT_MIN_LONG} мм — не отход: он ложится на стеллаж и оплачивается заказом, который его возьмёт. Так же считает калькулятор.
                </p>
                {scrapRisk > 0 && (
                  <p className="text-[11px] text-[#6b6b66] leading-relaxed">
                    <span className="font-medium text-amber-700">Риск остатков: </span>
                    если остаток не уйдёт в другие заказы, материал дороже на {fmt(scrapRisk)} ₽ и с заказа останется <span className={`font-mono font-semibold ${COLOR[contributionColor(c.revenueExVat > 0 ? contributionIfScrap / c.revenueExVat * 100 : 0)]}`}>{fmt(contributionIfScrap)} ₽</span>.
                  </p>
                )}
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
