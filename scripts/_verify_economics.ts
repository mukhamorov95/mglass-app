// Прогон честной экономики на живых июльских заказах — проверка цифр экрана.
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { computeOrderEconomics, summarizeEconomics, type EcoOrder, type EcoItem } from '../lib/orderEconomics'
import { DEFAULT_SHOP_SALARIES, type ShopThroughput } from '../lib/laborModel'
import { DEFAULT_REUSE_RATE } from '../lib/materialUsage'

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l && !l.startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
const num = (x: unknown) => Number(x) || 0

async function main() {
  const { data: mats } = await sb.from('b2b_materials').select('name,thickness,sheet_width,sheet_height,pattern_direction')
  const sheet = new Map<string, { w: number; h: number; pat: string }>()
  for (const m of (mats ?? []) as Record<string, unknown>[])
    sheet.set(`${m.name}|${Number(m.thickness)}`, { w: num(m.sheet_width) || 3210, h: num(m.sheet_height) || 2250, pat: String(m.pattern_direction ?? 'none') })

  const { data } = await sb.from('b2b_orders')
    .select('id,client_name,total_after_discount,total_sale_inc_vat,items')
    .is('archived_at', null).not('launched_at', 'is', null)
    .gte('launched_at', '2026-07-01').lt('launched_at', '2026-08-01')

  const orders: EcoOrder[] = []
  let thNet = 0, thEdge = 0, thDrilled = 0
  for (const o of (data ?? []) as Record<string, unknown>[]) {
    const raw = Array.isArray(o.items) ? o.items as Record<string, unknown>[] : []
    const items: EcoItem[] = raw.map(it => {
      const billed = num(it.totalAreaBilled)
      const s = sheet.get(`${it.materialName}|${num(it.thickness)}`)
      return {
        materialName: String(it.materialName ?? ''), thickness: num(it.thickness), category: String(it.category ?? ''),
        width: num(it.width), height: num(it.height), quantity: num(it.quantity),
        wastePercent: num(it.wastePercent), costPerM2: billed > 0 ? num(it.costMaterial) / billed : 0,
        hasTempering: !!it.hasTempering, hasHoles: !!it.hasHoles, perimeterM: num(it.perimeterM),
        sheetWidth: s?.w, sheetHeight: s?.h, patternDirection: (s?.pat ?? 'none') as EcoItem['patternDirection'],
      }
    })
    for (const it of items) {
      thNet += it.width * it.height / 1e6 * it.quantity
      thEdge += (it.perimeterM || 2 * (it.width + it.height) / 1000) * it.quantity
      if (it.hasHoles) thDrilled += it.quantity
    }
    orders.push({ id: num(o.id), clientName: String(o.client_name ?? '—'), revenue: num(o.total_after_discount) || num(o.total_sale_inc_vat), items })
  }
  const thru: ShopThroughput = { netM2: thNet, edgeM: thEdge, drilledPcs: thDrilled, packedPcs: 0 }
  const eco = orders.map(o => computeOrderEconomics(o, DEFAULT_SHOP_SALARIES, thru, DEFAULT_REUSE_RATE)).filter(e => e.revenue > 0)
  const p = summarizeEconomics(eco)

  const f = (n: number) => Math.round(n).toLocaleString('ru-RU')
  console.log(`Заказов с выручкой: ${p.count}`)
  console.log(`Выручка: ${f(p.revenue)} ₽`)
  console.log(`Нетто: ${p.netM2.toFixed(1)} м²   реальных листов: ${p.sheets}`)
  console.log(`\nМАРЖА:`)
  console.log(`  по системе:  ${p.systemMargin}%   себест ${f(p.systemCost)} ₽`)
  console.log(`  честная:     ${p.honestMargin}%   себест ${f(p.honestCost)} ₽`)
  console.log(`  система приукрашивает на ${(p.systemMargin - p.honestMargin).toFixed(1)} п.п. (спрятано ${f(p.honestCost - p.systemCost)} ₽)`)
  console.log(`\nМАТЕРИАЛ: система ${f(p.systemMaterial)} → честно ${f(p.honestMaterial)} (${p.honestMaterial >= p.systemMaterial ? 'занижение' : 'завышение'} ${f(Math.abs(p.honestMaterial - p.systemMaterial))})`)
  console.log(`ТРУД: заложено ${f(p.systemLabor)} → честно ${f(p.honestLabor)}`)
  const lb = p.laborBreakdown
  console.log(`  резка ${f(lb.cutting)}  сверловка ${f(lb.drilling)}  кромка ${f(lb.edge)}  упаковка ${f(lb.packaging)}  закалка ${f(lb.tempering)}  доставка ${f(lb.transport)}`)
  console.log(`\nХудшие 5 по честной марже:`)
  for (const e of [...eco].sort((a, b) => a.honestMargin - b.honestMargin).slice(0, 5))
    console.log(`  #${e.orderId} ${e.clientName.slice(0, 22).padEnd(22)} выр ${f(e.revenue).padStart(9)} · сист ${String(e.systemMargin).padStart(5)}% → честн ${String(e.honestMargin).padStart(6)}%`)
  console.log(`\nЛучшие 5 по честной марже:`)
  for (const e of [...eco].sort((a, b) => b.honestMargin - a.honestMargin).slice(0, 5))
    console.log(`  #${e.orderId} ${e.clientName.slice(0, 22).padEnd(22)} выр ${f(e.revenue).padStart(9)} · сист ${String(e.systemMargin).padStart(5)}% → честн ${String(e.honestMargin).padStart(6)}%`)
}
main()
