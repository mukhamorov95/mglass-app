// Себестоимость заказа С НДС из сохранённого. total_cost_vat — это ВХОДНОЙ НДС, а не
// себестоимость (калькулятор пишет net = без НДС, vat = НДС), поэтому по отдельности он ничего
// не значит. Нет ни позиций, ни обеих колонок — «нет данных», а не ноль и не догадка.
export function storedCostWithVat(o: { items?: unknown; total_cost_net?: number | string | null; total_cost_vat?: number | string | null }): number | null {
  let items: Record<string, unknown>[] = []
  if (Array.isArray(o.items)) items = o.items as Record<string, unknown>[]
  else if (typeof o.items === 'string') {
    try { const p = JSON.parse(o.items); if (Array.isArray(p)) items = p } catch { /* не позиции */ }
  }
  const fromItems = items.reduce((s, it) => s + (Number(it?.costWithVat) || 0), 0)
  if (fromItems > 0) return fromItems
  if (o.total_cost_net == null || o.total_cost_vat == null) return null
  const total = Number(o.total_cost_net) + Number(o.total_cost_vat)
  return total > 0 ? total : null
}
