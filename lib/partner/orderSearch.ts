import type { PaymentView } from '@/lib/partner/orderMoney'

// Поиск и порядок заказов в кабинете (владелец 25.11.2026): у каждого заказа два номера —
// наш производственный и номер клиента; искать можно по любому. Неоплаченные — первыми.

type Searchable = { number: string; clientOrderNumber?: string | null; amount?: number | null; summary?: string | null; extra?: (string | null | undefined)[] }

const norm = (s: string) => s.toLowerCase().replace(/[\s№#]/g, '')
// «5831» находит «05831»: ведущие нули номера при сравнении не важны.
const noZeros = (s: string) => s.replace(/^0+(?=\d)/, '')

export function matchesOrder(o: Searchable, query: string): boolean {
  const q = norm(query)
  if (!q) return true
  const fields = [o.number, o.clientOrderNumber ?? '', o.amount ? String(Math.round(o.amount)) : '', o.summary ?? '', ...(o.extra ?? []).map(x => x ?? '')]
  return fields.some(f => {
    const v = norm(f)
    return v.includes(q) || (/^\d+$/.test(q) && noZeros(v).includes(noZeros(q)))
  })
}

const unpaidRank = (p?: PaymentView | null) => (p?.status === 'awaiting' || p?.status === 'partial' ? 0 : 1)

// Неоплаченные вверх, внутри групп порядок сохраняется (sort стабилен).
export function unpaidFirst<T extends { payment?: PaymentView | null }>(list: T[]): T[] {
  return [...list].sort((a, b) => unpaidRank(a.payment) - unpaidRank(b.payment))
}

export const CLIENT_NO_MAX = 40
export function cleanClientNo(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim().slice(0, CLIENT_NO_MAX)
  return s || null
}
