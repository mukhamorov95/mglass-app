import type { B2BMaterial } from '../types'

// А12: индивидуальный прайс клиента поверх общего.
//
// Приоритет цены: ручная цена позиции → прайс клиента → общий прайс.
// К индивидуальной цене скидка клиента НЕ применяется: это уже конечная
// договорённость, иначе скидка задвоится. Такие материалы помечаем флагом
// clientPriced, чтобы движок и UI видели, откуда взялась цена.

export type ClientPriceRow = {
  material_id: number
  sale_price: number
  comment?: string | null
  active?: boolean
}

export type PricedMaterial = B2BMaterial & { clientPriced?: boolean }

export function clientPriceMap(rows: ClientPriceRow[] | null | undefined): Map<number, number> {
  const m = new Map<number, number>()
  for (const r of rows ?? []) {
    if (r.active === false) continue
    const p = Number(r.sale_price)
    if (Number.isFinite(p) && p > 0) m.set(Number(r.material_id), p)
  }
  return m
}

// Накладывает прайс клиента на уже подготовленные материалы (после prepPricedMaterials).
export function applyClientPrices(materials: B2BMaterial[], prices: Map<number, number>): PricedMaterial[] {
  if (prices.size === 0) return materials
  return materials.map(m => {
    const own = prices.get(m.id)
    return own != null ? { ...m, sale_price: own, clientPriced: true } : m
  })
}

// Скидка, которую можно применить к позиции: у материалов с индивидуальной ценой — ноль.
export function discountForMaterial(material: PricedMaterial | null | undefined, clientDiscount: number): number {
  return material?.clientPriced ? 0 : clientDiscount
}

// Загрузка прайса клиента. Таблица появляется миграцией 20260828 — пока она не
// применена, читаем пустой прайс и работаем на общем: фича не должна ломать расчёт.
// Клиент передаётся как есть (браузерный или серверный) — типы Supabase здесь не
// разворачиваем, иначе дженерики схемы уходят в бесконечную глубину.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadClientPrices(sb: any, clientId: number | null | undefined): Promise<Map<number, number>> {
  if (!clientId) return new Map()
  try {
    const { data, error } = await sb
      .from('b2b_client_prices')
      .select('material_id, sale_price, active')
      .eq('client_id', clientId)
    if (error) return new Map()
    return clientPriceMap(data as ClientPriceRow[])
  } catch { return new Map() }
}
