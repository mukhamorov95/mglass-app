// Переделка за наш счёт (владелец 12.11.2026): заказ был и сумма у него есть, но клиенту она не выставляется —
// в долг, дебиторку, акт сверки и разнесение платежей не входит. Переделку, которую запускает сам клиент,
// клиент оплачивает: это обычный заказ, без отметки. Отметка живёт в notes.own_cost_remake.

// Ставить и снимать отметку — решение о деньгах: владелец и финансист.
export const OWN_COST_ROLES = ['admin', 'ceo', 'cfo'] as const

export type OwnCostRemake = { of: string | null; by: string | null; at: string | null }

export function ownCostRemakeOf(notes: unknown): OwnCostRemake | null {
  const n = (typeof notes === 'string' ? safeParse(notes) : notes) as { own_cost_remake?: unknown } | null
  const v = n?.own_cost_remake
  if (!v || typeof v !== 'object') return v === true ? { of: null, by: null, at: null } : null
  const o = v as Record<string, unknown>
  const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null)
  return { of: str(o.of), by: str(o.by), at: str(o.at) }
}

// Сколько заказ должен клиент: у переделки за наш счёт — ноль, у остальных — итог заказа.
export const billableTotal = (total: number, notes: unknown) => (ownCostRemakeOf(notes) ? 0 : total)

export const ownCostRemakeLabel = (r: OwnCostRemake) => `За счёт M GLASS${r.of ? `, переделка ${r.of}` : ''}`

function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}
