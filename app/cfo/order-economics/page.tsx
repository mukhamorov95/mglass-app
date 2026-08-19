import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import {
  computeOrderEconomics, summarizeEconomics,
  type EcoOrder, type EcoItem,
} from '@/lib/orderEconomics'
import { DEFAULT_SHOP_SALARIES, type ShopThroughput } from '@/lib/laborModel'
import { DEFAULT_REUSE_RATE } from '@/lib/materialUsage'

// Честная экономика заказа: раскрывает два места, где себестоимость B2B-заказа
// расходится с реальностью — материал (ручной процент vs фактический раскрой) и
// труд (резки и сверловки нет в себестоимости вообще). Только /cfo — это
// финансовая детализация (правило проекта).

export const dynamic = 'force-dynamic'

const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

function fmt(n: number) { return Math.round(n).toLocaleString('ru-RU') }
function fmtM(n: number) {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + ' млн'
  if (Math.abs(n) >= 1_000) return Math.round(n / 1_000) + ' тыс'
  return String(Math.round(n))
}
function marginColor(m: number) {
  if (m < 25) return 'text-red-600'
  if (m < 35) return 'text-amber-600'
  return 'text-emerald-600'
}

type RawItem = Record<string, unknown>
function num(x: unknown): number { return Number(x) || 0 }

type SheetInfo = { w: number; h: number; pat: string; fmts?: { width: number; height: number }[] }

function toEcoItem(it: RawItem, sheet: Map<string, SheetInfo>): EcoItem {
  const billed = num(it.totalAreaBilled)
  const costPerM2 = billed > 0 ? num(it.costMaterial) / billed : 0
  const name = String(it.materialName ?? '')
  const thk = num(it.thickness)
  const s = sheet.get(`${name}|${thk}`)
  const svc = Array.isArray(it.services) ? it.services as Record<string, unknown>[] : []
  return {
    materialName: name, thickness: thk, category: String(it.category ?? ''),
    width: num(it.width), height: num(it.height), quantity: num(it.quantity),
    wastePercent: num(it.wastePercent), costPerM2,
    hasTempering: !!it.hasTempering, hasHoles: !!it.hasHoles,
    perimeterM: num(it.perimeterM),
    sheetWidth: s?.w, sheetHeight: s?.h, sheetFormats: s?.fmts,
    patternDirection: (s?.pat ?? 'none') as EcoItem['patternDirection'],
    servicesCostPrice: svc.reduce((a, x) => a + num(x.costPrice), 0) + num(it.costFacet) + num(it.costTriplex),
    servicesSale: svc.reduce((a, x) => a + num(x.cost), 0) + num(it.saleFacet) + num(it.saleTriplex),
  }
}

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

  const [{ data: ordersRaw }, { data: mats }, { data: variants }] = await Promise.all([
    // launched_at IS NOT NULL обеспечивается самим .gte (NULL не проходит сравнение),
    // поэтому .not() не нужен — заодно обходим взрыв типов в next build на .not().
    svc.from('b2b_orders')
      .select('id, client_name, total_after_discount, total_sale_inc_vat, items, launched_at')
      .is('archived_at', null)
      .gte('launched_at', from).lt('launched_at', to)
      .order('launched_at'),
    svc.from('b2b_materials').select('id, name, thickness, sheet_width, sheet_height, pattern_direction'),
    svc.from('b2b_material_sheet_variants').select('material_id, sheet_width, sheet_height, is_default, sort_order').eq('active', true).order('material_id').order('is_default', { ascending: false }).order('sort_order'),
  ])

  const fmtById = new Map<number, { width: number; height: number }[]>()
  for (const v of (variants ?? []) as Record<string, unknown>[]) {
    const w = Number(v.sheet_width) || 0, h = Number(v.sheet_height) || 0
    if (w <= 0 || h <= 0) continue
    const mid = Number(v.material_id)
    const arr = fmtById.get(mid) ?? []
    arr.push({ width: w, height: h }); fmtById.set(mid, arr)
  }
  const sheet = new Map<string, SheetInfo>()
  for (const mt of (mats ?? []) as Record<string, unknown>[]) {
    sheet.set(`${mt.name}|${Number(mt.thickness)}`, {
      w: Number(mt.sheet_width) || 3210, h: Number(mt.sheet_height) || 2250,
      pat: String(mt.pattern_direction ?? 'none'), fmts: fmtById.get(Number(mt.id)),
    })
  }

  // Пропускная способность цеха за месяц — знаменатель живых ставок труда.
  const orders: EcoOrder[] = []
  let thNet = 0, thEdge = 0, thDrilled = 0
  for (const o of (ordersRaw ?? []) as Record<string, unknown>[]) {
    const rawItems = Array.isArray(o.items) ? (o.items as RawItem[]) : []
    const items = rawItems.map(it => toEcoItem(it, sheet))
    for (const it of items) {
      const net = it.width * it.height / 1_000_000 * it.quantity
      thNet += net
      thEdge += (it.perimeterM || 2 * (it.width + it.height) / 1000) * it.quantity
      if (it.hasHoles) thDrilled += it.quantity
    }
    orders.push({
      id: Number(o.id), clientName: String(o.client_name ?? '—'),
      revenue: num(o.total_after_discount) || num(o.total_sale_inc_vat),
      items,
    })
  }
  const throughput: ShopThroughput = { netM2: thNet, edgeM: thEdge, drilledPcs: thDrilled, packedPcs: 0 }

  const eco = orders.map(o => computeOrderEconomics(o, DEFAULT_SHOP_SALARIES, throughput, DEFAULT_REUSE_RATE))
    .filter(e => e.revenue > 0)
    .sort((a, b) => a.honestMargin - b.honestMargin)
  const p = summarizeEconomics(eco)

  const monthLabel = `${MONTHS[m - 1]} ${y}`
  const prevM = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
  const nextM = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`

  const laborRows: [string, number, boolean][] = [
    ['Резка (Бекмурза)', p.laborBreakdown.cutting, true],
    ['Сверловка (Адилет)', p.laborBreakdown.drilling, true],
    ['Кромка', p.laborBreakdown.edge, false],
    ['Упаковка (Никита)', p.laborBreakdown.packaging, false],
    ['Закалка (подрядчик)', p.laborBreakdown.tempering, false],
    ['Доставка на закалку', p.laborBreakdown.transport, false],
  ]

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[1080px] mx-auto px-4 py-4 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-sm font-semibold text-[#111110]">Честная экономика заказа — B2B-цех</h1>
            <p className="text-[10px] text-[#9a9a95] mt-0.5">
              Что система насчитала против того, сколько заказ стоит на самом деле · {monthLabel}
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <Link href={`/cfo/order-economics?month=${prevM}`} className="px-2 py-1.5 text-xs border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-white">←</Link>
            <span className="text-xs font-mono text-[#6b6b66]">{monthLabel}</span>
            <Link href={`/cfo/order-economics?month=${nextM}`} className="px-2 py-1.5 text-xs border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-white">→</Link>
            <Link href="/cfo" className="px-3 py-1.5 text-xs bg-[#111110] text-white rounded-lg font-medium hover:bg-[#2a2a28]">CFO →</Link>
          </div>
        </div>

        {eco.length === 0 ? (
          <div className="bg-white rounded-lg border border-[#e4e4e0] px-4 py-8 text-center text-xs text-[#9a9a95]">
            За {monthLabel} нет запущенных заказов с выручкой.
          </div>
        ) : (
        <>
        {/* Headline: маржа система vs честно */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white rounded-lg border border-[#e4e4e0] px-3 py-3">
            <p className="text-[10px] text-[#9a9a95] font-medium">Выручка ({p.count} зак.)</p>
            <p className="text-lg font-bold font-mono mt-0.5 text-[#111110]">{fmtM(p.revenue)} ₽</p>
          </div>
          <div className="bg-white rounded-lg border border-[#e4e4e0] px-3 py-3">
            <p className="text-[10px] text-[#9a9a95] font-medium">Маржа по системе</p>
            <p className={`text-lg font-bold font-mono mt-0.5 ${marginColor(p.systemMargin)}`}>{p.systemMargin}%</p>
            <p className="text-[10px] text-[#c4c4be] mt-0.5">себест. {fmtM(p.systemCost)} ₽</p>
          </div>
          <div className="bg-white rounded-lg border-2 border-[#111110] px-3 py-3">
            <p className="text-[10px] text-[#111110] font-semibold">Маржа честная</p>
            <p className={`text-lg font-bold font-mono mt-0.5 ${marginColor(p.honestMargin)}`}>{p.honestMargin}%</p>
            <p className="text-[10px] text-[#c4c4be] mt-0.5">себест. {fmtM(p.honestCost)} ₽</p>
          </div>
          <div className="bg-white rounded-lg border border-[#e4e4e0] px-3 py-3">
            <p className="text-[10px] text-[#9a9a95] font-medium">Система приукрашивает на</p>
            <p className="text-lg font-bold font-mono mt-0.5 text-red-600">{(p.systemMargin - p.honestMargin).toFixed(1)} п.п.</p>
            <p className="text-[10px] text-[#c4c4be] mt-0.5">спрятано {fmtM(p.honestCost - p.systemCost)} ₽</p>
          </div>
        </div>

        {/* Материал + Труд */}
        <div className="grid md:grid-cols-2 gap-3">
          {/* Материал */}
          <div className="bg-white rounded-lg border border-[#e4e4e0] p-4">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-3">Материал: ручной процент vs раскрой</p>
            <div className="space-y-1.5 text-xs">
              <Row label="Нетто (чистая площадь деталей)" value={`${fmt(p.netM2)} м²`} />
              <Row label="Реальных листов по раскрою" value={`${p.sheets} шт · ${fmt(p.sheets * 7.22)} м²`} />
              <Row label="Себестоимость по системе (ручной %)" value={`${fmt(p.systemMaterial)} ₽`} />
              <Row label="Себестоимость честная (раскрой)" value={`${fmt(p.honestMaterial)} ₽`} bold />
              <div className="border-t border-[#f0f0ec] pt-1.5">
                <Row label={p.honestMaterial >= p.systemMaterial ? 'Ручной процент ЗАНИЖАЕТ материал на' : 'Ручной процент ЗАВЫШАЕТ материал на'}
                  value={`${fmt(Math.abs(p.honestMaterial - p.systemMaterial))} ₽`}
                  valueClass={p.honestMaterial >= p.systemMaterial ? 'text-red-600' : 'text-emerald-600'} />
              </div>
            </div>
            <p className="text-[10px] text-[#9a9a95] mt-3 leading-relaxed">
              Раскрой при возврате {Math.round(DEFAULT_REUSE_RATE * 100)}% крупных остатков на стеллаж.
              Физический минимум потери реза по июлю — ~5% сверх нетто; ручные 18–45% — это в основном
              оценка того, сколько остатка со стеллажа со временем уходит в лом.
            </p>
          </div>

          {/* Труд */}
          <div className="bg-white rounded-lg border border-[#e4e4e0] p-4">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-3">Труд цеха по живым ставкам</p>
            <table className="w-full text-xs">
              <tbody>
                {laborRows.map(([label, val, hidden]) => (
                  <tr key={label} className="border-b border-[#f7f7f5] last:border-0">
                    <td className="py-1 text-[#6b6b66]">
                      {label}
                      {hidden && <span className="ml-1 text-[9px] text-red-500 font-medium">не в себест.</span>}
                    </td>
                    <td className="py-1 text-right font-mono font-medium">{fmt(val)} ₽</td>
                  </tr>
                ))}
                <tr className="border-t border-[#e4e4e0]">
                  <td className="py-1.5 font-semibold text-[#111110]">Итого труд честно</td>
                  <td className="py-1.5 text-right font-mono font-bold">{fmt(p.honestLabor)} ₽</td>
                </tr>
                <tr>
                  <td className="py-1 text-[#9a9a95]">Заложено в себестоимость сейчас</td>
                  <td className="py-1 text-right font-mono text-[#9a9a95]">{fmt(p.systemLabor)} ₽</td>
                </tr>
              </tbody>
            </table>
            <p className="text-[10px] text-[#9a9a95] mt-3 leading-relaxed">
              Ставка = оклад ÷ объём месяца. Резка и сверловка окладами не заложены в себестоимость — сидят в марже.
              При росте объёма ставка падает: те же оклады на бо́льшем метраже дешевле за единицу.
            </p>
          </div>
        </div>

        {/* Таблица заказов */}
        <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#e4e4e0]">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Заказы — от худшей честной маржи</p>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b border-[#f5f5f3] text-[10px] text-[#9a9a95]">
                {['#', 'Клиент', 'Выручка', 'Дет.', 'Нетто м²', 'Листов', 'Маржа сист.', 'Маржа честн.', 'Разрыв'].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {eco.slice(0, 80).map(e => (
                <tr key={e.orderId} className="border-b border-[#f5f5f3] last:border-0 hover:bg-[#fafaf9]">
                  <td className="px-3 py-2 text-[#9a9a95] font-mono">{e.orderId}</td>
                  <td className="px-3 py-2 text-[#6b6b66] max-w-[160px] truncate">{e.clientName}</td>
                  <td className="px-3 py-2 font-mono">{fmt(e.revenue)}</td>
                  <td className="px-3 py-2 font-mono text-[#9a9a95]">{e.pieces}</td>
                  <td className="px-3 py-2 font-mono text-[#9a9a95]">{e.netM2}</td>
                  <td className="px-3 py-2 font-mono text-[#9a9a95]">{e.sheets}</td>
                  <td className={`px-3 py-2 font-mono ${marginColor(e.systemMargin)}`}>{e.systemMargin}%</td>
                  <td className={`px-3 py-2 font-mono font-bold ${marginColor(e.honestMargin)}`}>{e.honestMargin}%</td>
                  <td className="px-3 py-2 font-mono text-red-500">{e.marginGap > 0 ? '−' + e.marginGap : e.marginGap}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {eco.length > 80 && <p className="px-4 py-2 text-[10px] text-[#9a9a95]">Показаны 80 из {eco.length} заказов (худшие по честной марже).</p>}
        </div>
        </>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, bold, valueClass }: { label: string; value: string; bold?: boolean; valueClass?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[#6b6b66]">{label}</span>
      <span className={`font-mono ${bold ? 'font-bold text-[#111110]' : valueClass ?? 'font-medium'}`}>{value}</span>
    </div>
  )
}
