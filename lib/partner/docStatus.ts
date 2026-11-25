import type { PaymentView } from '@/lib/partner/orderMoney'

// Плашки «оплачен / отгружен» и фильтр в «Документах» кабинета (владелец 25.11.2026):
// зелёный — сделано, красный — нет, жёлтый — частично. Только у заказов в работе и отгруженных:
// у просчёта ни оплаты, ни отгрузки ещё нет.

export type Tone = 'ok' | 'bad' | 'part' | 'muted'
export type Badge = { label: string; tone: Tone }
export type DocFilter = 'all' | 'unpaid' | 'paid' | 'unshipped' | 'shipped'

type Doc = {
  lane: string
  payment?: PaymentView | null
  shipPartial?: { shipped: number; total: number } | null
}

const rub = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const launched = (d: Doc) => d.lane === 'in_work' || d.lane === 'shipped'

export function payBadge(d: Doc): Badge | null {
  if (!launched(d) || !d.payment) return null
  const p = d.payment
  if (p.status === 'paid') return { label: 'Оплачен', tone: 'ok' }
  if (p.status === 'own_cost') return { label: 'За наш счёт', tone: 'muted' }
  if (p.status === 'partial') return { label: `Оплачено ${rub(p.paid)} из ${rub(p.total)}`, tone: 'part' }
  return { label: 'Не оплачен', tone: 'bad' }
}

export function shipBadge(d: Doc): Badge | null {
  if (!launched(d)) return null
  if (d.lane === 'shipped') return { label: 'Отгружен', tone: 'ok' }
  if (d.shipPartial) return { label: `Отгружено ${d.shipPartial.shipped} из ${d.shipPartial.total} шт.`, tone: 'part' }
  return { label: 'Не отгружен', tone: 'bad' }
}

export const isUnpaid = (d: Doc) => d.payment?.status === 'awaiting' || d.payment?.status === 'partial'

export function inDocFilter(d: Doc, f: DocFilter): boolean {
  if (f === 'all') return true
  if (!launched(d)) return false
  if (f === 'unpaid') return launched(d) && isUnpaid(d)
  if (f === 'paid') return d.payment?.status === 'paid' || d.payment?.status === 'own_cost'
  if (f === 'shipped') return d.lane === 'shipped'
  return d.lane === 'in_work'
}

export const DOC_FILTERS: { key: DocFilter; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'unpaid', label: 'Не оплачены' },
  { key: 'paid', label: 'Оплачены' },
  { key: 'unshipped', label: 'Не отгружены' },
  { key: 'shipped', label: 'Отгружены' },
]

export const TONE_CLASS: Record<Tone, string> = { ok: 'p-ready', bad: 'p-bad', part: 'p-sub', muted: 'p-ship' }
