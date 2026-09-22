// Себестоимость позиции просчёта — на строки, прямо в таблице позиций.
//
// Правило владельца: любой итог раскрывается, и строки сходятся с итогом.
// До сих пор состав изделия был виден только в конфигураторе (до добавления
// позиции) и в экономике сохранённого заказа — а в самом просчёте «Себест.»
// висела одним числом: «не вижу профиль, сборку зеркала, вот это всё».
//
// Две тонкости, из-за которых это не просто печать bom:
//  1. У изделия строки состава — с НДС (покупаем с НДС), а колонка «Себест.»
//     показывает без НДС. Разницу показываем строкой, иначе сумма строк не
//     сойдётся с числом, из которого её раскрыли.
//  2. У обычного стекла состава-bom нет, но себестоимость всё равно складывается
//     из материала, закалки, фацета, кромки, доставки, упаковки и услуг —
//     это такие же строки, просто из другого места.

import { reconcile, type BreakdownLine, type ProductBreakdown } from './productBreakdown'

export type CostPanelItem = {
  bom?: unknown
  costMaterial?: unknown
  costTempering?: unknown
  costFacet?: unknown
  costEdge?: unknown
  costTransport?: unknown
  costPackaging?: unknown
  costTriplex?: unknown
  servicesCost?: unknown
  costWithVat?: unknown
  inputVat?: unknown
  costExVat?: unknown
  services?: unknown
}

export type CostPanel = ProductBreakdown & {
  vat: number          // НДС к вычету (строки с НДС → колонка без НДС)
  exVat: number        // себестоимость без НДС — то, что стоит в колонке
  kind: 'product' | 'glass'
}

const n = (x: unknown) => Number(x) || 0

const GLASS_LINES: { key: keyof CostPanelItem; name: string }[] = [
  { key: 'costMaterial',  name: 'Материал' },
  { key: 'costTriplex',   name: 'Триплексация' },
  { key: 'costTempering', name: 'Закалка' },
  { key: 'costFacet',     name: 'Фацет' },
  { key: 'costEdge',      name: 'Обработка кромки' },
  { key: 'costTransport', name: 'Доставка' },
  { key: 'costPackaging', name: 'Упаковка' },
]

export function itemCostPanel(item: CostPanelItem): CostPanel | null {
  const withVat = n(item.costWithVat)
  const bom = Array.isArray(item.bom) ? (item.bom as BreakdownLine[]).filter(l => l && n(l.total) !== 0) : []

  let lines: BreakdownLine[] = []
  let kind: CostPanel['kind'] = 'glass'

  if (bom.length) {
    kind = 'product'
    lines = bom.map(l => ({ name: String(l.name ?? ''), unit: String(l.unit ?? ''), qty: n(l.qty), price: l.price, total: n(l.total) }))
  } else {
    for (const { key, name } of GLASS_LINES) {
      const total = n(item[key])
      if (total) lines.push({ name, qty: 1, unit: '₽', total })
    }
  }

  // Услуги считаются отдельно от материала и в bom изделия не попадают.
  const services = n(item.servicesCost)
  if (services) {
    const names = Array.isArray(item.services)
      ? (item.services as { name?: unknown }[]).map(s => String(s?.name ?? '').trim()).filter(Boolean)
      : []
    lines.push({ name: names.length ? `Услуги: ${names.join(', ')}` : 'Доп. услуги', qty: 1, unit: '₽', total: services })
  }

  if (!lines.length) return null

  const base = reconcile(lines, withVat, bom.length ? 'saved' : 'recalc')
  // НДС выводим остатком: обе величины округлены, и печатать их независимо
  // значит показать равенство, которое не сходится на рубль.
  const exVat = Math.round(n(item.costExVat))
  return { ...base, kind, exVat, vat: base.stored - exVat }
}
