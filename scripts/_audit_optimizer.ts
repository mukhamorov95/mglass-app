// Read-only аудит оптимизатора раскроя на реальных июльских заказах.
// npx tsx scripts/_audit_optimizer.ts
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import {
  runCuttingOptimizer, runCuttingOptimizerOptimized,
  DEFAULT_CUTTING_SETTINGS,
  type PieceGroup, type CuttingPiece, type MaterialCuttingResult,
} from '../lib/cuttingOptimizer'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)

type Item = {
  materialName?: string; thickness?: number; category?: string
  width?: number; height?: number; quantity?: number; wastePercent?: number
}
type Order = { id: number; client_name: string; launched_at: string; items: Item[] }

const SHEET_W = 3210, SHEET_H = 2250, SHEET_M2 = SHEET_W * SHEET_H / 1e6

function groupsFrom(orders: Order[], patternOf: Map<string, string>): Map<string, PieceGroup> {
  const groups = new Map<string, PieceGroup>()
  for (const o of orders) {
    for (const it of o.items ?? []) {
      if (!it.width || !it.height) continue
      const key = `${it.materialName}|${it.thickness}`
      if (!groups.has(key)) groups.set(key, {
        pieces: [], materialLabel: key, category: it.category ?? '',
        sheetWidth: SHEET_W, sheetHeight: SHEET_H,
        patternDirection: (patternOf.get(key) ?? 'none') as PieceGroup['patternDirection'],
      })
      const g = groups.get(key)!
      for (let i = 0; i < (it.quantity ?? 1); i++) {
        g.pieces.push({
          id: `${o.id}-${g.pieces.length}`, width: it.width, height: it.height,
          label: `${it.width}×${it.height}`, orderId: o.id, orderClientName: o.client_name,
          materialKey: key, canRotate: true,
        })
      }
    }
  }
  return groups
}

// ─── Инварианты: то, что обязано выполняться при любом раскрое ────────────────
function validate(res: MaterialCuttingResult, group: PieceGroup, gap: number, margin: number) {
  const errs: string[] = []
  const placed = res.sheets.flatMap(s => s.pieces)

  // 1. Ни одна деталь не потеряна и не задвоена
  const ids = new Set(placed.map(p => p.id))
  if (ids.size !== placed.length) errs.push(`ДУБЛИ: размещено ${placed.length}, уникальных ${ids.size}`)
  if (placed.length + res.unplacedCount !== group.pieces.length)
    errs.push(`ПОТЕРЯ: ${group.pieces.length} на входе, ${placed.length} размещено + ${res.unplacedCount} не влезло`)

  // 2. Габариты детали сохранены (не подменились при повороте)
  const src = new Map(group.pieces.map(p => [p.id, p]))
  for (const p of placed) {
    const s = src.get(p.id); if (!s) { errs.push(`ЧУЖАЯ деталь ${p.id}`); continue }
    const ok = p.rotated ? (p.w === s.height && p.h === s.width) : (p.w === s.width && p.h === s.height)
    if (!ok) errs.push(`ИСКАЖЕНИЕ ${p.id}: ${s.width}×${s.height} → ${p.w}×${p.h} (rot=${p.rotated})`)
    if (p.rotated && !s.canRotate) errs.push(`ПОВОРОТ запрещённой детали ${p.id}`)
  }

  for (const sh of res.sheets) {
    // 3. Всё внутри листа с учётом кромки
    for (const p of sh.pieces) {
      if (p.x < margin - 0.001 || p.y < margin - 0.001 ||
          p.x + p.w > res.sheetWidth - margin + 0.001 || p.y + p.h > res.sheetHeight - margin + 0.001)
        errs.push(`ЗА ЛИСТОМ [${sh.index}] ${p.label}: x=${p.x} y=${p.y} w=${p.w} h=${p.h}`)
    }
    // 4. Детали не налезают друг на друга (и держат зазор реза)
    for (let i = 0; i < sh.pieces.length; i++) for (let j = i + 1; j < sh.pieces.length; j++) {
      const a = sh.pieces[i], b = sh.pieces[j]
      const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      if (dx > 0.001 && dy > 0.001) errs.push(`НАЛОЖЕНИЕ [${sh.index}] ${a.label}@${a.x},${a.y} × ${b.label}@${b.x},${b.y}`)
      else if (dx > gap + 0.001 && dy > -0.001 && dy > -gap) { /* касание по нормали — ок */ }
    }
  }
  return errs
}

function summarize(results: MaterialCuttingResult[]) {
  let sheets = 0, netMm2 = 0, unplaced = 0
  for (const r of results) { sheets += r.sheetsNeeded; netMm2 += r.totalUsedArea; unplaced += r.unplacedCount }
  return { sheets, netM2: netMm2 / 1e6, unplaced, sheetM2: sheets * SHEET_M2 }
}

async function main() {
  const { data: mats } = await sb.from('b2b_materials').select('name,thickness,pattern_direction,waste_percent,cost_price')
  const patternOf = new Map<string, string>()
  const costOf = new Map<string, number>()
  const wasteOf = new Map<string, number>()
  for (const m of (mats ?? []) as Record<string, unknown>[]) {
    const k = `${m.name}|${Number(m.thickness)}`
    patternOf.set(k, (m.pattern_direction as string) ?? 'none')
    costOf.set(k, Number(m.cost_price) || 0)
    wasteOf.set(k, Number(m.waste_percent) || 0)
  }

  const { data } = await sb.from('b2b_orders')
    .select('id,client_name,launched_at,items')
    .is('archived_at', null).not('launched_at', 'is', null)
    .gte('launched_at', '2026-07-01').lt('launched_at', '2026-08-01')
    .order('launched_at')
  const orders = (data ?? []) as Order[]
  console.log(`Июль 2026: ${orders.length} заказов в работе\n`)

  const settings = DEFAULT_CUTTING_SETTINGS

  // ── 1. Инварианты на месячном прогоне ──────────────────────────────────────
  const monthGroups = groupsFrom(orders, patternOf)
  const monthFast = runCuttingOptimizer(monthGroups, settings)
  let allErrs = 0
  for (const r of monthFast) {
    const errs = validate(r, monthGroups.get(r.materialKey)!, settings.gap_between_pieces, settings.edge_margin)
    if (errs.length) { allErrs += errs.length; console.log(`❌ ${r.materialKey}: ${errs.length} нарушений`); errs.slice(0, 5).forEach(e => console.log('   ', e)) }
  }
  console.log(allErrs === 0 ? '✅ Инварианты: наложений/потерь/выходов за лист нет\n' : `\n❌ Всего нарушений: ${allErrs}\n`)

  // ── 2. Три горизонта партии ────────────────────────────────────────────────
  const byOrder = orders.map(o => groupsFrom([o], patternOf))
  const byDay = new Map<string, Order[]>()
  for (const o of orders) { const d = o.launched_at; if (!byDay.has(d)) byDay.set(d, []); byDay.get(d)!.push(o) }
  const dayGroups = [...byDay.values()].map(os => groupsFrom(os, patternOf))

  function agg(gs: Map<string, PieceGroup>[], deep: boolean) {
    let sheets = 0, net = 0, unplaced = 0
    const perMat = new Map<string, { sheets: number; net: number }>()
    for (const g of gs) {
      const res = deep ? runCuttingOptimizerOptimized(g, settings, 800) : runCuttingOptimizer(g, settings)
      for (const r of res) {
        sheets += r.sheetsNeeded; net += r.totalUsedArea / 1e6; unplaced += r.unplacedCount
        const cur = perMat.get(r.materialKey) ?? { sheets: 0, net: 0 }
        cur.sheets += r.sheetsNeeded; cur.net += r.totalUsedArea / 1e6
        perMat.set(r.materialKey, cur)
      }
    }
    return { sheets, net, unplaced, perMat }
  }

  const scenarios: [string, ReturnType<typeof agg>][] = [
    ['по каждому заказу отдельно (как режут сейчас)', agg(byOrder, false)],
    ['партиями по дню запуска', agg(dayGroups, false)],
    ['весь месяц одной партией', agg([monthGroups], false)],
    ['весь месяц + глубокий поиск', agg([monthGroups], true)],
  ]

  console.log('Сценарий'.padEnd(46), 'листов', 'нетто м²', 'выдано м²', 'реальный расход')
  for (const [name, s] of scenarios) {
    const billed = s.sheets * SHEET_M2
    const waste = s.net > 0 ? (billed / s.net - 1) * 100 : 0
    console.log(name.padEnd(46), String(s.sheets).padStart(6), s.net.toFixed(1).padStart(9), billed.toFixed(1).padStart(10), (waste.toFixed(1) + '%').padStart(16), s.unplaced ? `  ⚠ не влезло ${s.unplaced}` : '')
  }

  // ── 3. Ручной процент против фактического (помесячный горизонт = потолок) ──
  let manualCost = 0, realCostOrder = 0, realCostDay = 0, netM2Total = 0
  const rows: string[] = []
  const perOrder = scenarios[0][1].perMat, perDay = scenarios[1][1].perMat
  for (const [key, g] of monthGroups) {
    const net = g.pieces.reduce((s, p) => s + p.width * p.height / 1e6, 0)
    const cost = costOf.get(key) ?? 0
    const manualW = wasteOf.get(key) ?? 0
    const shOrder = perOrder.get(key)?.sheets ?? 0
    const shDay = perDay.get(key)?.sheets ?? 0
    netM2Total += net
    manualCost += net * (1 + manualW / 100) * cost
    realCostOrder += shOrder * SHEET_M2 * cost
    realCostDay += shDay * SHEET_M2 * cost
    if (net > 3) rows.push([
      key.padEnd(42), net.toFixed(1).padStart(7),
      (manualW.toFixed(0) + '%').padStart(7),
      ((shOrder * SHEET_M2 / net - 1) * 100).toFixed(0).padStart(6) + '%',
      ((shDay * SHEET_M2 / net - 1) * 100).toFixed(0).padStart(6) + '%',
      Math.round(net * (1 + manualW / 100) * cost).toLocaleString('ru-RU').padStart(11),
      Math.round(shOrder * SHEET_M2 * cost).toLocaleString('ru-RU').padStart(11),
    ].join(' '))
  }
  console.log('\nМатериал'.padEnd(43), 'нетто', 'ручной', 'по зак.', 'по дню', ' стоимость руч.', 'стоимость факт')
  rows.forEach(r => console.log(r))
  console.log('\nИТОГО нетто м²:', netM2Total.toFixed(1))
  console.log('Материал по ручным процентам:', Math.round(manualCost).toLocaleString('ru-RU'), '₽')
  console.log('Материал по факту (раскрой по заказу):', Math.round(realCostOrder).toLocaleString('ru-RU'), '₽')
  console.log('Материал по факту (раскрой по дню):', Math.round(realCostDay).toLocaleString('ru-RU'), '₽')
  console.log('Разница ручной − факт(по дню):', Math.round(manualCost - realCostDay).toLocaleString('ru-RU'), '₽')

  // ── 4. Куда девается «отход» при раскрое по заказу: реальная потеря или ────
  //       крупный остаток, который возвращается на стеллаж? ──────────────────
  // Считаем по заказу: площадь листов − нетто = свободно. Из свободного —
  // «значимые остатки» (крупные прямоугольники) идут обратно в дело, остальное
  // (узкие полосы < порога) — безвозвратная потеря реза.
  let sheetArea = 0, netArea = 0, bigRemnant = 0
  for (const g of byOrder) {
    const res = runCuttingOptimizer(g, settings)
    for (const r of res) {
      sheetArea += r.totalSheetArea / 1e6
      netArea   += r.totalUsedArea / 1e6
      for (const sh of r.sheets)
        bigRemnant += sh.remnants.reduce((s, rm) => s + rm.w * rm.h / 1e6, 0)
    }
  }
  const freeArea = sheetArea - netArea
  const trueLoss = freeArea - bigRemnant
  console.log('\n── Разложение «отхода» при раскрое по каждому заказу ──')
  console.log('Площадь листов:', sheetArea.toFixed(1), 'м²   нетто:', netArea.toFixed(1), 'м²')
  console.log('Свободно на листах:', freeArea.toFixed(1), 'м² =',
    ((freeArea / netArea) * 100).toFixed(0) + '% сверх нетто')
  console.log('  из них крупные остатки (на стеллаж):', bigRemnant.toFixed(1), 'м² =',
    ((bigRemnant / freeArea) * 100).toFixed(0) + '% свободного')
  console.log('  безвозвратная потеря реза:', trueLoss.toFixed(1), 'м² =',
    ((trueLoss / netArea) * 100).toFixed(0) + '% сверх нетто — ЭТО честный минимум расхода')
  // ── 5. Честная потеря по КАЖДОМУ заказу (распределение, не среднее) ────────
  // Для одного заказа: (нетто + безвозвратная потеря) / нетто − 1. Крупный
  // остаток НЕ считаем расходом заказа (уходит на стеллаж). Это и есть число,
  // которым автоматика должна заменить ручной flat-процент.
  const lossPerOrder: number[] = []
  const patternLoss: number[] = [], plainLoss: number[] = []
  for (const g of byOrder) {
    const res = runCuttingOptimizer(g, settings)
    for (const r of res) {
      const net = r.totalUsedArea / 1e6
      if (net < 0.3) continue
      const big = r.sheets.reduce((s, sh) => s + sh.remnants.reduce((a, rm) => a + rm.w * rm.h / 1e6, 0), 0)
      const loss = (r.totalSheetArea / 1e6 - net - big)
      const pct = (loss / net) * 100
      lossPerOrder.push(pct)
      ;(r.patternDirection !== 'none' ? patternLoss : plainLoss).push(pct)
    }
  }
  const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0 }
  const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0
  console.log('\n── Честная потеря реза по каждому заказу (крупный остаток не в счёт) ──')
  console.log(`Групп заказ×материал: ${lossPerOrder.length}`)
  console.log(`Медиана потери: ${median(lossPerOrder).toFixed(1)}%   средняя: ${mean(lossPerOrder).toFixed(1)}%`)
  console.log(`  обычное стекло (можно вращать): медиана ${median(plainLoss).toFixed(1)}%  (${plainLoss.length} групп)`)
  console.log(`  рифлёное/направленное (без вращения): медиана ${median(patternLoss).toFixed(1)}%  (${patternLoss.length} групп)`)
  const p90 = [...lossPerOrder].sort((a, b) => a - b)[Math.floor(lossPerOrder.length * 0.9)] ?? 0
  console.log(`  90-й перцентиль: ${p90.toFixed(1)}% (мелкие/кривые заказы — верхний хвост)`)
}

main()
