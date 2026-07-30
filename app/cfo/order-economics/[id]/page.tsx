import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { computeOrderEconomics, type EcoOrder, type EcoItem } from '@/lib/orderEconomics'
import { computeMaterialUsage, DEFAULT_REUSE_RATE, type UsageItem } from '@/lib/materialUsage'
import { DEFAULT_SHOP_SALARIES, type ShopThroughput } from '@/lib/laborModel'

// Честная экономика ОДНОГО заказа — провал из /b2b-orders (только владелец, под
// /cfo). Себестоимость, реальный расход материала (раскрой), маржа система vs
// честная, разбивка по позициям. Всё из тех же lib, что и портфельный экран.

export const dynamic = 'force-dynamic'

const num = (x: unknown) => Number(x) || 0
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU')
function marginColor(m: number) { return m < 25 ? 'text-red-600' : m < 35 ? 'text-amber-600' : 'text-emerald-600' }

type RawItem = Record<string, unknown>
function toEcoItem(it: RawItem, sheet: Map<string, { w: number; h: number; pat: string }>): EcoItem {
  const billed = num(it.totalAreaBilled)
  const name = String(it.materialName ?? ''); const thk = num(it.thickness)
  const s = sheet.get(`${name}|${thk}`)
  const svc = Array.isArray(it.services) ? it.services as Record<string, unknown>[] : []
  const servicesCostPrice = svc.reduce((a, x) => a + num(x.costPrice), 0) + num(it.costFacet) + num(it.costTriplex)
  const servicesSale = svc.reduce((a, x) => a + num(x.cost), 0) + num(it.saleFacet) + num(it.saleTriplex)
  return {
    materialName: name, thickness: thk, category: String(it.category ?? ''),
    width: num(it.width), height: num(it.height), quantity: num(it.quantity),
    wastePercent: num(it.wastePercent), costPerM2: billed > 0 ? num(it.costMaterial) / billed : 0,
    hasTempering: !!it.hasTempering, hasHoles: !!it.hasHoles, perimeterM: num(it.perimeterM),
    sheetWidth: s?.w, sheetHeight: s?.h, patternDirection: (s?.pat ?? 'none') as EcoItem['patternDirection'],
    servicesCostPrice, servicesSale,
  }
}

export default async function OrderEconomicsDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: o } = await svc.from('b2b_orders')
    .select('id, custom_number, client_name, total_after_discount, total_sale_inc_vat, items, launched_at, created_at')
    .eq('id', Number(id)).single()

  if (!o) {
    return <div className="bg-[#f5f5f3] min-h-screen p-8 text-center text-sm text-[#9a9a95]">Заказ не найден. <Link href="/cfo/order-economics" className="text-blue-600">← К списку</Link></div>
  }

  const month = (o.launched_at ?? o.created_at ?? '').slice(0, 7)
  const from = `${month}-01`
  const [y, m] = month.split('-').map(Number)
  const to = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`

  const [{ data: mats }, { data: monthRaw }] = await Promise.all([
    svc.from('b2b_materials').select('name, thickness, sheet_width, sheet_height, pattern_direction'),
    svc.from('b2b_orders').select('items').is('archived_at', null).gte('launched_at', from).lt('launched_at', to),
  ])
  const sheet = new Map<string, { w: number; h: number; pat: string }>()
  for (const mt of (mats ?? []) as Record<string, unknown>[])
    sheet.set(`${mt.name}|${Number(mt.thickness)}`, { w: num(mt.sheet_width) || 3210, h: num(mt.sheet_height) || 2250, pat: String(mt.pattern_direction ?? 'none') })

  // Пропускная способность цеха за месяц запуска — знаменатель ставок труда.
  let thNet = 0, thEdge = 0, thDrilled = 0
  for (const mo of (monthRaw ?? []) as Record<string, unknown>[]) {
    for (const it of (Array.isArray(mo.items) ? mo.items as RawItem[] : [])) {
      const w = num(it.width), h = num(it.height), q = num(it.quantity)
      thNet += w * h / 1e6 * q
      thEdge += (num(it.perimeterM) || 2 * (w + h) / 1000) * q
      if (it.hasHoles) thDrilled += q
    }
  }
  const throughput: ShopThroughput = { netM2: thNet, edgeM: thEdge, drilledPcs: thDrilled, packedPcs: 0 }

  const rawItems = Array.isArray(o.items) ? (o.items as RawItem[]) : []
  const items = rawItems.map(it => toEcoItem(it, sheet))
  const order: EcoOrder = {
    id: Number(o.id), clientName: String(o.client_name ?? '—'),
    revenue: num(o.total_after_discount) || num(o.total_sale_inc_vat), items,
  }
  const e = computeOrderEconomics(order, DEFAULT_SHOP_SALARIES, throughput, DEFAULT_REUSE_RATE)

  // Расход материала по раскрою — на позиции
  const usage = computeMaterialUsage(items.filter(i => i.width > 0 && i.height > 0 && i.quantity > 0).map(i => ({
    materialName: i.materialName, thickness: i.thickness, category: i.category,
    width: i.width, height: i.height, quantity: i.quantity, costPerM2: i.costPerM2,
    sheetWidth: i.sheetWidth, sheetHeight: i.sheetHeight, patternDirection: i.patternDirection,
  } as UsageItem)), DEFAULT_REUSE_RATE)

  const numLabel = o.custom_number ?? `#${o.id}`
  const labor: [string, number, boolean][] = [
    ['Резка', e.laborCutting, true], ['Сверловка', e.laborDrilling, true],
    ['Кромка', e.laborEdge, false], ['Упаковка', e.laborPackaging, false],
    ['Закалка (подрядчик)', e.laborTempering, false], ['Доставка на закалку', e.laborTransport, false],
  ]
  // Разрыв доп-услуг: продано на servicesSale, а себестоимость заложена только на servicesCost.
  const servicesUncosted = e.servicesSale > 0 && e.servicesCost < e.servicesSale * 0.5

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[900px] mx-auto px-4 py-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-sm font-semibold text-[#111110]">Экономика заказа {numLabel} · {e.clientName}</h1>
            <p className="text-[10px] text-[#9a9a95] mt-0.5">Запущен {o.launched_at ?? '—'} · {e.pieces} дет. · {e.netM2} м² нетто</p>
          </div>
          <div className="flex gap-2">
            <Link href="/cfo/order-economics" className="px-3 py-1.5 text-xs border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-white">← Все заказы</Link>
            <Link href="/b2b-orders" className="px-3 py-1.5 text-xs border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-white">B2B заказы</Link>
          </div>
        </div>

        {/* Маржа + себестоимость */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Выручка" value={`${fmt(e.revenue)} ₽`} />
          <Kpi label="Маржа по системе" value={`${e.systemMargin}%`} cls={marginColor(e.systemMargin)} sub={`себест. ${fmt(e.systemCost)} ₽`} />
          <Kpi label="Маржа честная" value={`${e.honestMargin}%`} cls={marginColor(e.honestMargin)} sub={`себест. ${fmt(e.honestCost)} ₽`} bold />
          <Kpi label="Система приукрашивает" value={`${(e.systemMargin - e.honestMargin).toFixed(1)} п.п.`} cls="text-red-600" sub={`спрятано ${fmt(e.honestCost - e.systemCost)} ₽`} />
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          {/* Материал */}
          <div className="bg-white rounded-lg border border-[#e4e4e0] p-4">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-3">Материал: ручной % vs раскрой</p>
            <div className="space-y-1.5 text-xs">
              <Row label="Нетто (чистая площадь)" value={`${e.netM2} м²`} />
              <Row label="Реальных листов по раскрою" value={`${e.sheets} шт · ${fmt(e.sheets * 7.22)} м²`} />
              <Row label="Себест. по системе (ручной %)" value={`${fmt(e.systemMaterial)} ₽`} />
              <Row label="Себест. честная (раскрой)" value={`${fmt(e.honestMaterial)} ₽`} bold />
            </div>
            {usage.length > 0 && (
              <div className="mt-3 pt-2 border-t border-[#f0f0ec]">
                <p className="text-[10px] text-[#9a9a95] mb-1">Расход по материалам:</p>
                {usage.map(u => (
                  <div key={u.materialKey} className="flex justify-between text-[11px] py-0.5">
                    <span className="text-[#6b6b66] truncate mr-2">{u.materialLabel}</span>
                    <span className="font-mono text-[#111110] whitespace-nowrap">{u.netM2} м² · {u.sheets} л. · {u.cutLossPct}% рез</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Труд */}
          <div className="bg-white rounded-lg border border-[#e4e4e0] p-4">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-3">Труд по живым ставкам</p>
            <table className="w-full text-xs">
              <tbody>
                {labor.map(([l, v, hidden]) => (
                  <tr key={l} className="border-b border-[#f7f7f5] last:border-0">
                    <td className="py-1 text-[#6b6b66]">{l}{hidden && <span className="ml-1 text-[9px] text-red-500 font-medium">не в себест.</span>}</td>
                    <td className="py-1 text-right font-mono font-medium">{fmt(v)} ₽</td>
                  </tr>
                ))}
                <tr className="border-t border-[#e4e4e0]">
                  <td className="py-1.5 font-semibold text-[#111110]">Итого труд честно</td>
                  <td className="py-1.5 text-right font-mono font-bold">{fmt(e.honestLabor)} ₽</td>
                </tr>
                <tr><td className="py-1 text-[#9a9a95]">Заложено в себест. сейчас</td><td className="py-1 text-right font-mono text-[#9a9a95]">{fmt(e.systemLabor)} ₽</td></tr>
                {(e.servicesSale > 0 || e.servicesCost > 0) && (
                  <tr className="border-t border-[#e4e4e0]">
                    <td className="py-1.5 text-[#6b6b66]">
                      Доп. услуги / фацет / триплекс
                      {servicesUncosted && <span className="ml-1 text-[9px] text-red-500 font-medium">себест. не задана</span>}
                    </td>
                    <td className="py-1.5 text-right font-mono">
                      <span className="text-[#111110] font-medium">себест. {fmt(e.servicesCost)} ₽</span>
                      <span className="text-[#9a9a95]"> · продано {fmt(e.servicesSale)} ₽</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="text-[10px] text-[#9a9a95] mt-2">Кромка на м²: {e.edgeMPerM2} пог.м/м². Резка и сверловка окладами не заложены — сидят в марже.
              {servicesUncosted && <span className="text-red-500"> Доп-услуги проданы, но себестоимость в справочнике = 0 — задай её в «Услуги».</span>}</p>
          </div>
        </div>

        {/* Позиции */}
        <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#e4e4e0]"><p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Позиции</p></div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead><tr className="border-b border-[#f5f5f3] text-[10px] text-[#9a9a95]">
                {['Материал', 'Размер', 'Кол-во', 'Толщ.', 'Закалка', 'Отв.'].map(h => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {rawItems.map((it, i) => (
                  <tr key={i} className="border-b border-[#f5f5f3] last:border-0">
                    <td className="px-3 py-2 text-[#111110]">{String(it.materialName ?? '')}</td>
                    <td className="px-3 py-2 font-mono text-[#6b6b66]">{num(it.width)}×{num(it.height)}</td>
                    <td className="px-3 py-2 font-mono">{num(it.quantity)}</td>
                    <td className="px-3 py-2 font-mono text-[#9a9a95]">{num(it.thickness)}</td>
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
      {sub && <p className="text-[10px] text-[#c4c4be] mt-0.5">{sub}</p>}
    </div>
  )
}
function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return <div className="flex justify-between"><span className="text-[#6b6b66]">{label}</span><span className={`font-mono ${bold ? 'font-bold text-[#111110]' : 'font-medium'}`}>{value}</span></div>
}
