// ФП Ф4а: деньги заявки. Четыре суммы: запрошено, одобрено, оплачено, осталось.
// Резерв фонда = одобрено − оплачено у заявок окончательно утверждённой недели,
// пока заявка не закрыта. Свободно к одобрению = остаток фонда − резервы.
// Деньги — в копейках внутри, рубли на выходе.

export type ReqLike = {
  id: number; fund_id: number; amount: number; approved_amount: number | null
  status: string; week_end: string | null; closed_at: string | null; decision?: string | null
}
export type PayLike = { request_id: number; amount: number }

const k = (v: number | null | undefined) => Math.round(Number(v ?? 0) * 100)
const r = (v: number) => v / 100

export function paidOf(id: number, pays: PayLike[]): number {
  return r(pays.reduce((s, p) => s + (p.request_id === id ? k(p.amount) : 0), 0))
}

export type Sums = { requested: number; approved: number; paid: number; remaining: number; reserve: number }

// reserved — неделя заявки утверждена окончательно.
export function sumsOf(req: ReqLike, pays: PayLike[], reserved: boolean): Sums {
  const approved = req.status === 'approved' || req.status === 'paid' ? k(req.approved_amount ?? req.amount) : 0
  const paid = k(paidOf(req.id, pays))
  const remaining = req.closed_at ? 0 : Math.max(0, approved - paid)
  return { requested: r(k(req.amount)), approved: r(approved), paid: r(paid), remaining: r(remaining), reserve: reserved ? r(remaining) : 0 }
}

export function reservesByFund(reqs: ReqLike[], pays: PayLike[], finalWeeks: ReadonlySet<string>, exceptWeek?: string): Map<number, number> {
  const out = new Map<number, number>()
  for (const q of reqs) {
    if (!q.week_end || !finalWeeks.has(q.week_end) || q.week_end === exceptWeek) continue
    const s = sumsOf(q, pays, true)
    if (s.reserve > 0) out.set(q.fund_id, r((k(out.get(q.fund_id)) + k(s.reserve))))
  }
  return out
}

// Совет идёт по заявкам фонда сверху вниз: каждая видит, сколько осталось после
// предыдущих. Две заявки не могут занять одни и те же деньги.
export type Limit = { id: number; asked: number; max: number; short: number }

export function proposalLimits(free: number, asks: { id: number; amount: number }[]): Limit[] {
  let left = Math.max(0, k(free))
  return asks.map(a => {
    const ask = k(a.amount)
    const max = Math.min(ask, left)
    left -= max
    return { id: a.id, asked: r(ask), max: r(max), short: r(ask - max) }
  })
}

// Проверка директивы перед окончательным утверждением: сумма одобренного по
// фонду в этой неделе не больше свободного.
export type Shortage = { fund_id: number; free: number; approved: number; over: number }

export function directiveShortages(freeByFund: ReadonlyMap<number, number>, approved: { fund_id: number; amount: number }[]): Shortage[] {
  const sum = new Map<number, number>()
  for (const a of approved) sum.set(a.fund_id, (sum.get(a.fund_id) ?? 0) + k(a.amount))
  const out: Shortage[] = []
  for (const [fund_id, ap] of sum) {
    const free = Math.max(0, k(freeByFund.get(fund_id)))
    if (ap > free) out.push({ fund_id, free: r(free), approved: r(ap), over: r(ap - free) })
  }
  return out
}

// Оплата сверх остатка одобренного — повод для повторного рассмотрения, а не
// молчаливого перерасхода.
export function paymentCheck(s: Sums, amount: number): { ok: true; closes: boolean } | { ok: false; over: number } {
  const a = k(amount)
  const rem = k(s.remaining)
  if (a > rem) return { ok: false, over: r(a - rem) }
  return { ok: true, closes: a === rem }
}
