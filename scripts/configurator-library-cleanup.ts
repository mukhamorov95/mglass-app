// Чистка библиотеки прайса душевых и ходовые позиции АВ24 в моделях (маршрут
// docs/configurator/SHOWROOM_COST_ROUTE.md, этап Э3).
//
// По умолчанию — прогон без записи: что склеится, какие ссылки исправятся, что добавится
// и как сдвинутся итоги 9 моделей. С --apply: снимок «до» в --backup, запись библиотеки и
// комплектов, список будущей переоценки. С --apply --reprice — ещё и переоценка всех позиций
// по справочнику (цвет — по коду артикула). Повторный запуск ничего не склеивает заново.
//
//   NODE_PATH=<каталог с заглушкой server-only> npx tsx scripts/configurator-library-cleanup.ts --tier budget [--apply [--reprice] --backup /путь/снимок.json]
//
// Ключи окружения берутся из .env.local (service-role). Запускать только владельцу/оркестратору.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const envPath = process.env.ENV_FILE ?? '.env.local'
if (existsSync(envPath)) for (const l of readFileSync(envPath, 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const TIER = (arg('--tier') ?? 'budget') as 'budget' | 'premium'

// Ходовые АВ24 (заказ 0245, слова владельца 01.10: «ходовые позиции должны быть отображены
// в моделях», «нужно для обкатки»). Окончательный список — звёзды владельца в справочнике.
const HODOVYE: { role: string; bases: string[]; models: string[] }[] = [
  { role: 'hinge', bases: ['FDP-232 BR'], models: ['М2', 'М4', 'М7'] },              // стекло-стекло 180°
  { role: 'handle', bases: ['FDR-76 SUS304'], models: ['М2', 'М4', 'М7', 'М11'] },  // скоба 20×10, межось 200
  { role: 'mount-wall', bases: ['FDC-38 SUS304'], models: ['М1', 'М2', 'М4', 'М7', 'М8', 'М9', 'М10', 'М11', 'М12'] },
  { role: 'seal-magnet', bases: ['FDPP-503.8 PVC'], models: ['М4'] },               // 180° — дверь в линию со стеклом
  { role: 'seal-hinge', bases: ['FDPP-404.8 PVC'], models: ['М2', 'М4', 'М7', 'М11'] }, // А-образный
  { role: 'seal-bottom', bases: ['FDPP-402.8 PVC'], models: ['М2', 'М4', 'М7', 'М11'] }, // Ч-образный
  { role: 'profile', bases: ['FDPA-55.22 AL', 'FDPA-55.3 AL'], models: ['М2', 'М4', 'М7', 'М11'] },
  { role: 'tube', bases: ['FDT-302 SUS304'], models: ['М2', 'М4', 'М7', 'М11'] },
]

async function main() {
  const { createServiceClient } = await import('../lib/supabase-service')
  const { getKitStore, saveLibrary, saveAllKits } = await import('../lib/configurator/kitStore')
  const { cleanupLibrary, addVariant } = await import('../lib/configurator/libraryCleanup')
  const { pricesByFinish, colorAxisOfRole, isDefectRow } = await import('../lib/supplier/colorCode')
  const { parseLengthMm, computeKitQuantities, computeKitPrice, ROLE_META } = await import('../lib/configurator/kit')
  const { buildWithVariant } = await import('../lib/configurator/quoteContract')
  const { M_MODELS } = await import('../lib/configurator/arrangement')
  const { getFinance } = await import('../lib/configurator/financeStore')
  const { previewReprice, applyReprice } = await import('../lib/supplier/reprice')
  type Library = import('../lib/configurator/kit').Library
  type ModelKit = import('../lib/configurator/kit').ModelKit
  type LibraryItem = import('../lib/configurator/kit').LibraryItem
  type RoleId = import('../lib/configurator/kit').RoleId

  const svc = createServiceClient()
  const store = await getKitStore(TIER)
  const fin = await getFinance(TIER)

  const totals = (lib: Library, kits: Record<string, ModelKit>) => Object.fromEntries(M_MODELS.flatMap(m => ['chrome', 'black'].map(f => {
    const c = m.constraints
    const dims = { width: Math.round((c.width[0] + c.width[1]) / 20) * 10, height: 2000,
      width2: c.needsWidth2 && c.width2 ? Math.round((c.width2[0] + c.width2[1]) / 20) * 10 : undefined,
      doorWidth: c.doorWidth ? Math.round((c.doorWidth[0] + c.doorWidth[1]) / 20) * 10 : undefined }
    const q = computeKitQuantities(buildWithVariant(m, dims, 8), 8, m, store.rates.capMargin)
    const p = computeKitPrice(q, lib, kits[m.code] ?? { slots: [] }, store.rates, fin, { finishId: f, withDelivery: false })
    return [`${m.code} ${f}`, Math.round(p.hardwareCost)]
  })))
  const before = totals(store.library, store.kits)

  const { library: cleaned, kits: cleanedKits, report } = cleanupLibrary(store.library, store.kits)
  console.log(`\n[${TIER}] позиций ${store.library.items.length} → ${cleaned.items.length}; записей комплектов переведено ${report.entriesRepointed}`)
  for (const r of report.refFixed) console.log(`  ссылка: ${r.name.slice(0, 40)} — ${r.from} → ${r.to}`)
  for (const m of report.merged) console.log(`  склеено ${m.removed.length + 1}: ${m.key}`)
  for (const d of report.dropped) console.log(`  удалено: ${d.name.slice(0, 50)} (${d.why})`)

  let lib = cleaned
  let kits = cleanedKits
  if (TIER === 'budget') {
    for (const h of HODOVYE) {
      const role = h.role as RoleId
      const axis = colorAxisOfRole(role)
      const isBar = ROLE_META[role].kind === 'bar'
      const stocks: NonNullable<LibraryItem['stocks']> = []
      let item: LibraryItem | null = null
      for (const base of h.bases) {
        const { data, error } = await svc.from('supplier_price_rows')
          .select('article,name,color,retail_price,discount_percent,cost_price')
          .eq('supplier', 'av24').ilike('article', `${base}/%`).order('article')
        if (error) throw error
        const rows = (data ?? []).filter(r => !isDefectRow(r))
        if (rows.length === 0) { console.log(`  !! нет строк ${base} — пропуск`); continue }
        const prices = pricesByFinish('av24', rows, axis)
        const full = rows[0].name as string
        const ref = { supplier: 'av24', base, label: full.length > 60 ? full.slice(0, 60) + '…' : full }
        if (isBar) stocks.push({ len: parseLengthMm(full), prices, ref })
        item ??= { id: `av24-${base.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name: full.split('.')[0].slice(0, 48), role, ref, ...(isBar ? {} : { prices }) }
      }
      if (!item) continue
      if (isBar) item.stocks = stocks.sort((a, b) => a.len - b.len)
      const r = addVariant(lib, kits, h.models, item)
      lib = r.library; kits = r.kits
      console.log(`  ходовая ${h.bases.join(' + ')} → ${r.added.join(', ') || 'нет слотов'}`)
    }
  }

  const after = totals(lib, kits)
  const diff = Object.keys(before).filter(k => before[k] !== after[k]).map(k => `${k}: ${before[k]} → ${after[k]}`)
  console.log(`  итоги моделей до переоценки: ${diff.length ? diff.join('; ') : 'без изменений'}`)

  if (!APPLY) { console.log('\nПрогон без записи. Для записи: --apply --backup <файл>'); return }
  const backup = arg('--backup')
  if (!backup) throw new Error('--apply требует --backup <файл>: снимок «до» обязателен')
  writeFileSync(backup, JSON.stringify({ tier: TIER, at: new Date().toISOString(), updatedAt: store.updatedAt, library: store.library, kits: store.kits, rates: store.rates }, null, 1))
  console.log(`\nснимок «до» → ${backup}`)
  await saveLibrary(TIER, lib, store.rates, 'cleanup-script (Э3)')
  await saveAllKits(TIER, kits, 'cleanup-script (Э3)')
  console.log('библиотека и комплекты записаны')

  // Переоценка — отдельным шагом: сначала увидеть, какие цены поменяются, потом --reprice.
  const diffs = (await previewReprice(TIER)).filter(d => d.changes.length > 0)
  const isNew = (c: { was: number }) => !(c.was > 0)
  console.log(`переоценка: позиций ${diffs.length}, новых цен цвета ${diffs.flatMap(d => d.changes).filter(isNew).length}`)
  for (const d of diffs) for (const c of d.changes.filter(c => !isNew(c)))
    console.log(`  ${d.name.slice(0, 36).padEnd(36)} ${c.finish}${c.stockLen ? ' ' + c.stockLen : ''}: ${c.was} → ${c.now} (${c.deltaPct > 0 ? '+' : ''}${c.deltaPct}%)`)
  if (!process.argv.includes('--reprice')) { console.log('цены не тронуты; применить: --apply --reprice --backup <файл>'); return }
  const { applied } = await applyReprice(TIER, diffs.map(d => d.itemId), 'cleanup-script (Э3)')
  const fresh = await getKitStore(TIER)
  const final = totals(fresh.library, fresh.kits)
  console.log(`переоценено позиций ${applied}; итоги моделей:`)
  for (const k of Object.keys(before)) if (before[k] !== final[k]) console.log(`  ${k}: ${before[k]} → ${final[k]}`)
}

main().catch(e => { console.error(e); process.exit(1) })
