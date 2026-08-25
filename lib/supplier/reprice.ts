import 'server-only'
import { createServiceClient } from '@/lib/supabase-service'
import { supplierColorToFinish, type Tier } from '@/lib/configurator/pricing'
import { parseLengthMm, ROLE_META, type Library, type LibraryItem } from '@/lib/configurator/kit'
import { getLibrary, saveLibrary } from '@/lib/configurator/kitStore'

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

// Текущие цены позиции по цветам: строки справочника с тем же базовым артикулом.
async function currentPrices(supplier: string, base: string): Promise<{ byFinish: Record<string, number>; lenByFinish: Record<string, number> }> {
  const supa = createServiceClient()
  const esc = base.replace(/[%_]/g, s => `\\${s}`)
  const { data } = await supa.from('supplier_price_rows')
    .select('article,name,color,cost_price')
    .eq('supplier', supplier)
    .or(`article.eq.${base},article.ilike.${esc}/%`)
  const byFinish: Record<string, number> = {}
  const lenByFinish: Record<string, number> = {}
  for (const r of data ?? []) {
    if (/дефект|-def\b|уценк/i.test(r.name ?? '')) continue          // брак ценой не считается
    const f = supplierColorToFinish(r.color ?? '')
    const cost = Math.round(Number(r.cost_price) || 0)
    if (!f || cost <= 0 || byFinish[f]) continue
    byFinish[f] = cost
    lenByFinish[f] = parseLengthMm(r.name ?? '')
  }
  return { byFinish, lenByFinish }
}

function diffPiece(it: LibraryItem, byFinish: Record<string, number>): PriceChange[] {
  const out: PriceChange[] = []
  for (const [finish, now] of Object.entries(byFinish)) {
    const was = it.prices?.[finish] ?? 0
    if (was === now) continue
    out.push({ finish, was, now, deltaPct: was > 0 ? Math.round(((now - was) / was) * 1000) / 10 : 100 })
  }
  return out
}

// У хлыста цена привязана к длине: одна и та же позиция бывает 2.2 м и 3 м с разной ценой.
// Сопоставляем по длине из названия строки справочника; если длина не читается, а хлыст
// один — считаем, что речь о нём.
function diffBar(it: LibraryItem, byFinish: Record<string, number>, lenByFinish: Record<string, number>): { changes: PriceChange[]; note?: string } {
  const stocks = it.stocks ?? []
  if (stocks.length === 0) return { changes: [], note: 'у позиции нет хлыстов' }
  const changes: PriceChange[] = []
  for (const [finish, now] of Object.entries(byFinish)) {
    const len = lenByFinish[finish] || 0
    const idx = len > 0 ? stocks.findIndex(s => s.len === len) : (stocks.length === 1 ? 0 : -1)
    if (idx < 0) continue
    const was = stocks[idx].prices?.[finish] ?? 0
    if (was === now) continue
    changes.push({ finish, was, now, deltaPct: was > 0 ? Math.round(((now - was) / was) * 1000) / 10 : 100, stockLen: stocks[idx].len })
  }
  const note = changes.length === 0 && Object.keys(byFinish).length > 0 ? 'не совпала длина хлыста с прайсом' : undefined
  return { changes, note }
}

export async function previewReprice(tier: Tier): Promise<ItemDiff[]> {
  const { library } = await getLibrary(tier)
  const out: ItemDiff[] = []
  for (const it of library.items) {
    if (!it.ref?.supplier || !it.ref.base) continue
    const { byFinish, lenByFinish } = await currentPrices(it.ref.supplier, it.ref.base)
    if (Object.keys(byFinish).length === 0) {
      out.push({ itemId: it.id, name: it.name, role: it.role, supplier: it.ref.supplier, changes: [], maxDeltaPct: 0, note: 'позиции больше нет в прайсе' })
      continue
    }
    const isBar = ROLE_META[it.role].kind === 'bar'
    const { changes, note } = isBar ? diffBar(it, byFinish, lenByFinish) : { changes: diffPiece(it, byFinish), note: undefined }
    if (changes.length === 0 && !note) continue
    const maxDeltaPct = changes.reduce((m, c) => (Math.abs(c.deltaPct) > Math.abs(m) ? c.deltaPct : m), 0)
    out.push({ itemId: it.id, name: it.name, role: it.role, supplier: it.ref.supplier, changes, maxDeltaPct, note })
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
