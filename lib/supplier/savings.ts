import 'server-only'
import { createServiceClient } from '@/lib/supabase-service'
import { supplierColorToFinish, type Tier } from '@/lib/configurator/pricing'
import { ROLE_META, type Library, type LibraryItem, type ModelKit, type RoleId } from '@/lib/configurator/kit'
import { getKitStore } from '@/lib/configurator/kitStore'
import { isDefect, similarity, tokens } from '@/lib/supplier/similar'

// «Где мы переплачиваем»: по позициям, которые реально стоят в комплектах моделей,
// ищем у других поставщиков то же самое дешевле. Считаем не абстрактную разницу в
// прайсе, а деньги: экономия × сколько штук идёт в изделие × в скольких моделях стоит.
// Экспортируется функцией, а не только экраном, — этим же слоем пользуется закупка.

export type Alternative = {
  rowId: number
  supplier: string
  name: string
  color: string
  cost: number
  url: string
  imageUrl: string
  match: number              // насколько похоже название, 0..1
}
export type SavingRow = {
  itemId: string
  name: string
  role: RoleId
  roleLabel: string
  supplier: string
  cost: number               // наша цена в базовом цвете
  best: Alternative
  savePerUnit: number
  usedInModels: string[]     // где эта позиция стоит в комплекте
  savePerItem: number        // экономия на одном изделии (по типовому количеству роли)
}
export type SavingsReport = { rows: SavingRow[]; totalPerItem: number; checked: number }

const BASE_FINISH = 'chrome'
const priceOf = (it: LibraryItem): number =>
  ROLE_META[it.role].kind === 'bar'
    ? (it.stocks ?? []).map(s => s.prices?.[BASE_FINISH] ?? 0).find(p => p > 0) ?? 0
    : it.prices?.[BASE_FINISH] ?? 0

// Позиции, которые стоят в комплектах: остальные — мусор в библиотеке, экономить не на чем.
function usage(kits: Record<string, ModelKit>): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const [code, kit] of Object.entries(kits)) {
    for (const slot of kit.slots) for (const e of slot.entries) {
      m.set(e.itemId, [...(m.get(e.itemId) ?? []), code])
    }
  }
  return m
}

export async function findSavings(tier: Tier, minSavePct = 5): Promise<SavingsReport> {
  const { library, kits } = await getKitStore(tier)
  const used = usage(kits)
  const supa = createServiceClient()
  const rows: SavingRow[] = []
  let checked = 0

  for (const it of (library as Library).items) {
    const models = used.get(it.id)
    if (!models || models.length === 0) continue
    const cost = priceOf(it)
    if (cost <= 0) continue
    checked += 1

    // Ищем по значимым словам названия у ВСЕХ поставщиков, включая своего:
    // у того же поставщика бывает та же железка в другой серии дешевле.
    let query = supa.from('supplier_price_rows').select('id,supplier,article,name,color,cost_price,url,image_url')
    for (const t of tokens(it.name)) query = query.ilike('name', `%${t}%`)
    const { data } = await query.limit(60)

    const alts = (data ?? [])
      .filter(r => Number(r.cost_price) > 0 && !isDefect(r.name ?? ''))
      .filter(r => !(it.ref && r.supplier === it.ref.supplier && (r.article ?? '').startsWith(it.ref.base)))
      .map(r => ({
        rowId: r.id as number, supplier: r.supplier as string, name: r.name as string,
        color: (r.color ?? '') as string, cost: Math.round(Number(r.cost_price)),
        url: (r.url ?? '') as string, imageUrl: (r.image_url ?? '') as string,
        match: similarity(it.name, r.name ?? ''),
      }))
      // Цвет должен совпадать с базовым, иначе сравним хром с золотом и «сэкономим» на бумаге.
      .filter(a => a.match >= 0.6 && (supplierColorToFinish(a.color) ?? BASE_FINISH) === BASE_FINISH)
      .sort((a, b) => a.cost - b.cost)

    const best = alts[0]
    if (!best || best.cost >= cost) continue
    const savePerUnit = cost - best.cost
    if ((savePerUnit / cost) * 100 < minSavePct) continue

    rows.push({
      itemId: it.id, name: it.name, role: it.role, roleLabel: ROLE_META[it.role].label,
      supplier: it.ref?.supplier ?? '', cost, best, savePerUnit,
      usedInModels: models,
      // Штучные роли идут в изделие обычно 1–3 раза; точное количество зависит от размеров,
      // поэтому здесь честная нижняя оценка — экономия на одной штуке.
      savePerItem: savePerUnit,
    })
  }

  return {
    rows: rows.sort((a, b) => b.savePerUnit - a.savePerUnit),
    totalPerItem: rows.reduce((s, r) => s + r.savePerItem, 0),
    checked,
  }
}
