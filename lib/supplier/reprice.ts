import 'server-only'
import { createServiceClient } from '@/lib/supabase-service'
import type { Tier, PriceByColor } from '@/lib/configurator/pricing'
import { parseLengthMm, ROLE_META, type Library, type LibraryItem } from '@/lib/configurator/kit'
import { getLibrary, saveLibrary } from '@/lib/configurator/kitStore'
import { pricesByFinish, colorAxisOfRole, isDefectRow, articleBase, type ColorAxis } from '@/lib/supplier/colorCode'

// Переоценка комплектов: сравнить цены, зашитые в библиотеку, с текущими в справочнике
// поставщика. Прайсы меняются молча — без этой сверки себестоимость медленно уезжает,
// и мы продаём по позапрошлогодней цене.

export type PriceChange = { finish: string; was: number; now: number; deltaPct: number; stockLen?: number }
export type ItemDiff = {
  itemId: string
  name: string
  role: string
  supplier: string
  changes: PriceChange[]
  maxDeltaPct: number          // худшее изменение — по нему сортируем
  note?: string                // почему не смогли сопоставить
}

// Текущие цены позиции по цветам: строки справочника с той же базой артикула. Цвет — по
// коду артикула (lib/supplier/colorCode.ts), себестоимость — розница × (1 − скидка).
async function currentPrices(supplier: string, base: string, axis: ColorAxis): Promise<{ byFinish: PriceByColor; len: number }> {
  const supa = createServiceClient()
  const esc = base.replace(/[%_]/g, s => `\\${s}`)
  const { data } = await supa.from('supplier_price_rows')
    .select('article,name,color,retail_price,discount_percent,cost_price')
    .eq('supplier', supplier)
    .or(`article.eq.${base},article.ilike.${esc}/%`)
    .order('article')
  // Только строки ровно этой базы: у Ветро длина сидит в середине артикула («ПР-004/1500/Black»),
  // и поиск по префиксу захватывал бы соседние длины той же детали.
  const rows = (data ?? []).filter(r => r.article === base || articleBase(supplier, r.article) === base)
  const named = rows.find(r => !isDefectRow(r) && parseLengthMm(r.name ?? '') > 0)
  return { byFinish: pricesByFinish(supplier, rows, axis), len: named ? parseLengthMm(named.name ?? '') : 0 }
}

// Меньше рубля — не изменение: в библиотеке старые цены целые, новые — с копейками.
const changed = (was: number, now: number) => Math.abs(was - now) >= 1
const delta = (was: number, now: number) => (was > 0 ? Math.round(((now - was) / was) * 1000) / 10 : 100)

function diffPrices(cur: PriceByColor | undefined, byFinish: PriceByColor, stockLen?: number): PriceChange[] {
  const out: PriceChange[] = []
  for (const [finish, now] of Object.entries(byFinish)) {
    const was = cur?.[finish] ?? 0
    if (!changed(was, now)) continue
    out.push({ finish, was, now, deltaPct: delta(was, now), ...(stockLen != null ? { stockLen } : {}) })
  }
  return out
}

// У хлыста цена привязана к длине: FDPA-55.22 (2,2 м) и FDPA-55.3 (3 м) — разные артикулы.
// Хлыст со своей ссылкой сверяется по ней; старый хлыст без ссылки — по ссылке позиции,
// если длина из названия строки совпала (или хлыст один).
async function diffBar(it: LibraryItem, axis: ColorAxis): Promise<{ changes: PriceChange[]; note?: string }> {
  const stocks = it.stocks ?? []
  if (stocks.length === 0) return { changes: [], note: 'у позиции нет хлыстов' }
  const changes: PriceChange[] = []
  let matched = 0
  for (const st of stocks) {
    const ref = st.ref ?? it.ref
    if (!ref?.supplier || !ref.base) continue
    const { byFinish, len } = await currentPrices(ref.supplier, ref.base, axis)
    if (!st.ref && !(len > 0 ? len === st.len : stocks.length === 1)) continue
    matched += 1
    changes.push(...diffPrices(st.prices, byFinish, st.len))
  }
  return { changes, note: matched === 0 ? 'не совпала длина хлыста с прайсом' : undefined }
}

export async function previewReprice(tier: Tier): Promise<ItemDiff[]> {
  const { library } = await getLibrary(tier)
  const out: ItemDiff[] = []
  for (const it of library.items) {
    const supplier = it.ref?.supplier ?? it.stocks?.find(s => s.ref)?.ref?.supplier
    if (!supplier) continue
    const axis = colorAxisOfRole(it.role)
    const isBar = ROLE_META[it.role].kind === 'bar'
    let changes: PriceChange[] = []
    let note: string | undefined
    if (isBar) ({ changes, note } = await diffBar(it, axis))
    else if (it.ref?.base) {
      const { byFinish } = await currentPrices(it.ref.supplier, it.ref.base, axis)
      if (Object.keys(byFinish).length === 0) note = 'позиции больше нет в прайсе'
      else changes = diffPrices(it.prices, byFinish)
    }
    if (changes.length === 0 && !note) continue
    const maxDeltaPct = changes.reduce((m, c) => (Math.abs(c.deltaPct) > Math.abs(m) ? c.deltaPct : m), 0)
    out.push({ itemId: it.id, name: it.name, role: it.role, supplier, changes, maxDeltaPct, note })
  }
  return out.sort((a, b) => Math.abs(b.maxDeltaPct) - Math.abs(a.maxDeltaPct))
}

// Применяем только то, что владелец подтвердил: список id позиций.
export async function applyReprice(tier: Tier, itemIds: string[], updatedBy: string): Promise<{ applied: number }> {
  const { library, rates } = await getLibrary(tier)
  const diffs = await previewReprice(tier)
  const wanted = new Set(itemIds)
  let applied = 0
  const next: Library = { items: library.items.map(i => ({ ...i })) }
  for (const d of diffs) {
    if (!wanted.has(d.itemId) || d.changes.length === 0) continue
    const it = next.items.find(i => i.id === d.itemId)
    if (!it) continue
    for (const c of d.changes) {
      if (c.stockLen != null) {
        const st = (it.stocks ?? []).find(s => s.len === c.stockLen)
        if (st) st.prices = { ...st.prices, [c.finish]: c.now }
      } else {
        it.prices = { ...it.prices, [c.finish]: c.now }
      }
    }
    applied += 1
  }
  if (applied > 0) await saveLibrary(tier, next, rates, updatedBy)
  return { applied }
}
