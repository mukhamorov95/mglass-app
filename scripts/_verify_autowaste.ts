// Проверка авторасхода: сравнить авто-% с ручным по каждой позиции июля.
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { autoWasteByMaterial, type UsageItem } from '../lib/materialUsage'

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l && !l.startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
const num = (x: unknown) => Number(x) || 0

async function main() {
  const { data: mats } = await sb.from('b2b_materials').select('name,thickness,sheet_width,sheet_height,pattern_direction')
  const sheet = new Map<string, { w: number; h: number; pat: string }>()
  for (const m of (mats ?? []) as Record<string, unknown>[])
    sheet.set(`${m.name}|${num(m.thickness)}`, { w: num(m.sheet_width) || 3210, h: num(m.sheet_height) || 2250, pat: String(m.pattern_direction ?? 'none') })

  const { data } = await sb.from('b2b_orders')
    .select('id,items')
    .is('archived_at', null).not('launched_at', 'is', null)
    .gte('launched_at', '2026-07-01').lt('launched_at', '2026-08-01')
  const orders = (data ?? []) as { id: number; items: Record<string, unknown>[] }[]

  for (const reuse of [0.7, 0.85, 0.9]) {
    let manualCost = 0, autoCost = 0, netTotal = 0
    let higher = 0, lower = 0
    const samples: string[] = []
    for (const o of orders) {
      const raw = Array.isArray(o.items) ? o.items : []
      const usage: UsageItem[] = raw.filter(it => num(it.width) && num(it.height) && num(it.quantity)).map(it => {
        const s = sheet.get(`${it.materialName}|${num(it.thickness)}`)
        const billed = num(it.totalAreaBilled)
        return {
          materialName: String(it.materialName ?? ''), thickness: num(it.thickness), category: String(it.category ?? ''),
          width: num(it.width), height: num(it.height), quantity: num(it.quantity),
          costPerM2: billed > 0 ? num(it.costMaterial) / billed : 0,
          sheetWidth: s?.w, sheetHeight: s?.h, patternDirection: (s?.pat ?? 'none') as UsageItem['patternDirection'],
        }
      })
      if (!usage.length) continue
      const autoMap = autoWasteByMaterial(usage, reuse)
      for (const it of raw) {
        const w = num(it.width), h = num(it.height), q = num(it.quantity)
        if (!w || !h || !q) continue
        const net = w * h / 1e6 * q
        const cost = num(it.totalAreaBilled) > 0 ? num(it.costMaterial) / num(it.totalAreaBilled) : 0
        const manW = num(it.wastePercent)
        const autW = autoMap.get(`${it.materialName}|${num(it.thickness)}`) ?? manW
        netTotal += net
        manualCost += net * (1 + manW / 100) * cost
        autoCost += net * (1 + autW / 100) * cost
        if (reuse === 0.85 && samples.length < 12 && Math.abs(autW - manW) > 3)
          samples.push(`  ${String(it.materialName).slice(0, 26).padEnd(26)} q${String(q).padStart(3)} ${w}×${h}  ручной ${manW.toFixed(0).padStart(3)}% → авто ${autW.toFixed(0).padStart(3)}%`)
        if (autW > manW + 0.5) higher++; else if (autW < manW - 0.5) lower++
      }
    }
    console.log(`\n── reuseRate ${reuse} ──`)
    console.log(`Материал ручной: ${Math.round(manualCost).toLocaleString('ru-RU')} ₽   авто: ${Math.round(autoCost).toLocaleString('ru-RU')} ₽   Δ ${Math.round(autoCost - manualCost).toLocaleString('ru-RU')} ₽ (${((autoCost / manualCost - 1) * 100).toFixed(1)}%)`)
    console.log(`Позиций: авто выше ручного ${higher}, ниже ${lower}`)
    if (reuse === 0.85) { console.log('Примеры расхождений:'); samples.forEach(s => console.log(s)) }
  }
}
main()
