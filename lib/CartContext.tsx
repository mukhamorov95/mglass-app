'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'

export type CostLine = { name: string; qty: number; unit: string; price: number; total: number }

export type CartItem = {
  localId: string
  product_type: 'mirror' | 'loft' | 'shower'
  label: string
  input_data: Record<string, unknown>
  cost_breakdown: { lines: CostLine[]; totalCost: number }
  financial_breakdown: Record<string, unknown>
  base_price: number
  discount: number
  partner_percent: number
  final_price: number
  grand_total: number
  margin: number
  profit: number
  manager_bonus: number
  client_text: string
}

type CartContextValue = {
  items: CartItem[]
  hydrated: boolean
  addItem: (item: Omit<CartItem, 'localId'>) => void
  removeItem: (localId: string) => void
  clearCart: () => void
  grandTotal: number
  totalProfit: number
}

const CART_KEY = 'mglass_cart_v1'

const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems]       = useState<CartItem[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CART_KEY)
      if (stored) setItems(JSON.parse(stored))
    } catch {}
    setHydrated(true)
  }, [])

  const addItem = useCallback((item: Omit<CartItem, 'localId'>) => {
    setItems(prev => {
      const next = [...prev, { ...item, localId: crypto.randomUUID() }]
      localStorage.setItem(CART_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const removeItem = useCallback((localId: string) => {
    setItems(prev => {
      const next = prev.filter(i => i.localId !== localId)
      localStorage.setItem(CART_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const clearCart = useCallback(() => {
    setItems([])
    localStorage.removeItem(CART_KEY)
  }, [])

  const grandTotal  = items.reduce((s, i) => s + i.grand_total, 0)
  const totalProfit = items.reduce((s, i) => s + i.profit, 0)

  return (
    <CartContext.Provider value={{ items, hydrated, addItem, removeItem, clearCart, grandTotal, totalProfit }}>
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside CartProvider')
  return ctx
}
