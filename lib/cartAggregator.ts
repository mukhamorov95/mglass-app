import { CartItem } from './CartContext'

export type OrderSummary = {
  itemsTotal: number
  mounting: number
  lifting: number
  delivery: number
  grandTotal: number
}

type ServiceLine = { name: string; total: number }

export function aggregateOrder(items: CartItem[]): OrderSummary {
  let itemsTotal = 0
  let mounting = 0
  let lifting = 0
  let delivery = 0

  for (const item of items) {
    itemsTotal += item.final_price
    const lines: ServiceLine[] = ((item.financial_breakdown as Record<string, unknown>).serviceLines as ServiceLine[]) ?? []
    for (const line of lines) {
      const name = line.name.toLowerCase()
      if (name.includes('монтаж')) mounting += line.total
      else if (name.includes('подъём') || name.includes('подъем')) lifting += line.total
      else if (name.includes('доставка')) delivery = Math.max(delivery, line.total)
    }
  }

  return { itemsTotal, mounting, lifting, delivery, grandTotal: itemsTotal + mounting + lifting + delivery }
}
