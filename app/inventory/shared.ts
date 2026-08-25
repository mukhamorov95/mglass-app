import type { InventoryItem, Contour, Kind } from '@/lib/inventory/types'

export const CARD   = 'bg-white border border-[#e4e4e0] rounded-lg'
export const INPUT  = 'border border-[#e4e4e0] rounded px-2 py-1 text-[13px] bg-white focus:outline-none focus:border-[#9a9a95]'
export const BTN    = 'px-3 py-1.5 text-[13px] rounded border border-[#e4e4e0] bg-white hover:bg-[#f5f5f3] transition-colors'
export const BTN_P  = 'px-3 py-1.5 text-[13px] rounded bg-[#111110] text-white hover:bg-[#2a2a28] transition-colors disabled:opacity-40'

export const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`

export const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res  = await fetch(url, init)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? 'Ошибка запроса')
  return json as T
}

export const post = <T,>(url: string, body: unknown) =>
  api<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const patch = <T,>(url: string, body: unknown) =>
  api<T>(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export type ItemsResponse = { items: InventoryItem[]; canSeeCost: boolean; role: string }

export type Summary = {
  items: number
  b2b: { items: number; value: number }
  b2c: { items: number; value: number }
  totalValue: number
  deficit: number
  zero: number
  noCost: number
  untouched: number
}

export const CONTOUR_TABS: { v: Contour | 'all'; l: string }[] = [
  { v: 'all',  l: 'Всё'  },
  { v: 'b2b',  l: 'B2B'  },
  { v: 'b2c',  l: 'B2C'  },
]

export const KIND_ORDER: Kind[] = [
  'glass', 'mirror', 'hardware', 'profile', 'seal', 'led', 'consumable', 'packaging', 'other',
]
