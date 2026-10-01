import 'server-only'
import { createServiceClient } from '@/lib/supabase-service'
import type { Tier, PriceByColor, CatalogRef } from '@/lib/configurator/pricing'
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
async function currentPrices(supplier: string, base: string, axis: ColorAxis): Promise<{ byFinish: PriceByColor; len: number; asOf?: string }> {
  const supa = createServiceClient()
  const esc = base.replace(/[%_]/g, s => `\\${s}`)
  const { data } = await supa.from('supplier_price_rows')
    .select('article,name,color,retail_price,discount_percent,cost_price,updated_at')
    .eq('supplier', supplier)
    .or(`article.eq.${base},article.ilike.${esc}/%`)
    .order('article')
  // Только строки ровно этой базы: у Ветро длина сидит в середине артикула («ПР-004/1500/Black»),
  // и поиск по префиксу захватывал бы соседние длины той же детали.
  const rows = (data ?? []).filter(r => r.article === base || articleBase(supplier, r.article) === base)
  const named = rows.find(r => !isDefectRow(r) && parseLengthMm(r.name ?? '') > 0)
  const asOf = rows.map(r => String(r.updated_at ?? '')).filter(Boolean).sort().pop()?.slice(0, 10)
  return { byFinish: pricesByFinish(supplier, rows, axis), len: named ? parseLengthMm(named.name ?? '') : 0, asOf }
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
// asOf — дата строк прайса по длинам хлыста (ключ — длина) или по позиции целиком (ключ 0).
type ItemCheck = { supplier: string; changes: PriceChange[]; note?: string; asOf: Map<number, string> }

async function diffBar(it: LibraryItem, axis: ColorAxis): Promise<Omit<ItemCheck, 'supplier'>> {
  const stocks = it.stocks ?? []
  const asOf = new Map<number, string>()
  if (stocks.length === 0) return { changes: [], note: 'у позиции нет хлыстов', asOf }
  const changes: PriceChange[] = []
  let matched = 0
  for (const st of stocks) {
    const ref = st.ref ?? it.ref
    if (!ref?.supplier || !ref.base) continue
    const cur = await currentPrices(ref.supplier, ref.base, axis)
    if (!st.ref && !(cur.len > 0 ? cur.len === st.len : stocks.length === 1)) continue
    matched += 1
    if (cur.asOf) asOf.set(st.len, cur.asOf)
    changes.push(...diffPrices(st.prices, cur.byFinish, st.len))
  }
  return { changes, note: matched === 0 ? 'не совпала длина хлыста с прайсом' : undefined, asOf }
}

async function checkItem(it: LibraryItem): Promise<ItemCheck | null> {
  const supplier = it.ref?.supplier ?? it.stocks?.find(s => s.ref)?.ref?.supplier
  if (!supplier) return null
  const axis = colorAxisOfRole(it.role)
  if (ROLE_META[it.role].kind === 'bar') return { supplier, ...(await diffBar(it, axis)) }
  const asOf = new Map<number, string>()
  if (!it.ref?.base) return { supplier, changes: [], asOf }
  const cur = await currentPrices(it.ref.supplier, it.ref.base, axis)
  if (Object.keys(cur.byFinish).length === 0) return { supplier, changes: [], note: 'позиции больше нет в прайсе', asOf }
  if (cur.asOf) asOf.set(0, cur.asOf)
  return { supplier, changes: diffPrices(it.prices, cur.byFinish), asOf }
}

export async function previewReprice(tier: Tier): Promise<ItemDiff[]> {
  const { library } = await getLibrary(tier)
  const out: ItemDiff[] = []
  for (const it of library.items) {
    const c = await checkItem(it)
    if (!c || (c.changes.length === 0 && !c.note)) continue
    const maxDeltaPct = c.changes.reduce((m, x) => (Math.abs(x.deltaPct) > Math.abs(m) ? x.deltaPct : m), 0)
    out.push({ itemId: it.id, name: it.name, role: it.role, supplier: c.supplier, changes: c.changes, maxDeltaPct, note: c.note })
  }
  return out.sort((a, b) => Math.abs(b.maxDeltaPct) - Math.abs(a.maxDeltaPct))
}

// Применяем только то, что владелец подтвердил: список id позиций. Дата цены ставится
// применённым и тем, чья цена и так совпала с прайсом; отклонённые остаются со старой датой.
export async function applyReprice(tier: Tier, itemIds: string[], updatedBy: string): Promise<{ applied: number; dated: number }> {
  const { library, rates } = await getLibrary(tier)
  const wanted = new Set(itemIds)
  let applied = 0
  let dated = 0
  const next: Library = { items: structuredClone(library.items) }
  for (const it of next.items) {
    const c = await checkItem(it)
    if (!c) continue
    const take = c.changes.length > 0 && wanted.has(it.id)
    if (c.changes.length > 0 && !take) continue
    for (const ch of take ? c.changes : []) {
      if (ch.stockLen != null) {
        const st = (it.stocks ?? []).find(s => s.len === ch.stockLen)
        if (st) st.prices = { ...st.prices, [ch.finish]: ch.now }
      } else {
        it.prices = { ...it.prices, [ch.finish]: ch.now }
      }
    }
    if (take) applied += 1
    if (stampAsOf(it, c.asOf)) dated += 1
  }
  if (applied > 0 || dated > 0) await saveLibrary(tier, next, rates, updatedBy)
  return { applied, dated }
}

function stampAsOf(it: LibraryItem, asOf: Map<number, string>): boolean {
  let changed = false
  const put = <T extends { ref?: CatalogRef }>(o: T, date: string | undefined, fallback?: CatalogRef) => {
    const ref = o.ref ?? fallback
    if (!date || !ref || ref.asOf === date) return
    o.ref = { ...ref, asOf: date }
    changed = true
  }
  put(it, asOf.get(0))
  for (const st of it.stocks ?? []) {
    if (st.ref) put(st, asOf.get(st.len))
    else if (asOf.has(st.len)) put(it, asOf.get(st.len))   // старый хлыст без своей ссылки — дата на позиции
  }
  return changed
}
