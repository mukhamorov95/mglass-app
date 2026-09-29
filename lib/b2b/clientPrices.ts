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

// Загрузка прайса клиента. Сбой чтения — исключение, а не пустой прайс: пустой
// молча считал бы по общему прайсу, и клиент с договорной ценой получил бы другую
// цену в КП (29.09, находка У1). Что показать человеку — решает вызывающий.
// Клиент передаётся как есть (браузерный или серверный) — типы Supabase здесь не
// разворачиваем, иначе дженерики схемы уходят в бесконечную глубину.
export class ClientPricesLoadError extends Error {}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadClientPrices(sb: any, clientId: number | null | undefined): Promise<Map<number, number>> {
  if (!clientId) return new Map()
  let res: { data: unknown; error: { message: string } | null }
  try {
    res = await sb
      .from('b2b_client_prices')
      .select('material_id, sale_price, active')
      .eq('client_id', clientId)
  } catch (e) {
    throw new ClientPricesLoadError(e instanceof Error ? e.message : 'сеть недоступна')
  }
  if (res.error) throw new ClientPricesLoadError(res.error.message)
  return clientPriceMap(res.data as ClientPriceRow[])
}
