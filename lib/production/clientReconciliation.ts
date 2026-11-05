// Акт сверки с клиентом (владелец 05.11.2026): что запущено, отгружено и оплачено за период и кто кому должен.
// Только расчёт, чтение из базы в маршруте. Клиент не зашит: дальше то же для других крупных клиентов.
//
// Два счёта долга. «Целиком»: заказ считается отгруженным, только когда уехал весь. «По изделиям»: считаются и уехавшие части.
// Деньги берём из выписки: отметка «Оплачен» не деньги и часто датирована днём отметки, а не днём перевода.

const round2 = (n: number) => Math.round(n * 100) / 100
const sum = (ns: number[]) => round2(ns.reduce((s, n) => s + n, 0))

export type ReconShipEvent = { day: string | null; amount: number; pieces: number }  // day null: уехало, дата не записана
export type ReconOrder = {
  id: number; no: string; launchDay: string | null; live: boolean  // live: запущен и не в архиве
  amount: number; pieces: number
  full: { day: string | null } | null  // заказ отгружен целиком
  events: ReconShipEvent[]
  payments: { day: string; amount: number }[]  // платежи, разнесённые на этот заказ, в том числе отметки
}
export type ReconMoney = { day: string; amount: number; source: 'bank' | 'mark' }
export type ReconMode = 'whole' | 'items'

const inRange = (day: string, from: string, to: string) => day >= from && day <= to
// Без даты уехало не раньше запуска: до него заказа не существовало.
const undatedSeen = (o: ReconOrder, to: string) => !o.launchDay || o.launchDay <= to

function shippedEvents(o: ReconOrder, mode: ReconMode): ReconShipEvent[] {
  if (mode === 'whole') return o.full ? [{ day: o.full.day, amount: o.amount, pieces: o.pieces }] : []
  if (!o.full) return o.events
  // Отметка «отгружен» закрывает то, что не прошло через отгрузки: иначе старый заказ остался бы неотгруженным.
  const amount = round2(o.amount - sum(o.events.map(e => e.amount)))
  const pieces = o.pieces - o.events.reduce((n, e) => n + e.pieces, 0)
  return amount > 0 || pieces > 0 ? [...o.events, { day: o.full.day, amount: Math.max(0, amount), pieces: Math.max(0, pieces) }] : o.events
}

export function shippedBy(o: ReconOrder, to: string, mode: ReconMode): number {
  return sum(shippedEvents(o, mode).filter(e => (e.day ? e.day <= to : undatedSeen(o, to))).map(e => e.amount))
}
export const paidBy = (o: ReconOrder, to: string) => sum(o.payments.filter(p => p.day <= to).map(p => p.amount))
export const moneyBy = (money: ReconMoney[], to: string) => sum(money.filter(m => m.day <= to).map(m => m.amount))

function flow(orders: ReconOrder[], from: string, to: string, mode: ReconMode) {
  const dated = orders.flatMap(o => shippedEvents(o, mode).filter(e => e.day && inRange(e.day, from, to)))
  // Дата не записана: в движение за период идёт отдельной строкой тот период, где заказ запущен.
  const undated = orders.flatMap(o => (o.launchDay && inRange(o.launchDay, from, to) ? shippedEvents(o, mode).filter(e => !e.day) : []))
  return {
    dated: sum(dated.map(e => e.amount)), datedPieces: dated.reduce((n, e) => n + e.pieces, 0),
    undated: sum(undated.map(e => e.amount)), undatedPieces: undated.reduce((n, e) => n + e.pieces, 0),
  }
}

function column(orders: ReconOrder[], money: ReconMoney[], from: string, to: string, mode: ReconMode) {
  const dayBefore = new Date(Date.parse(`${from}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
  const opening = round2(moneyBy(money, dayBefore) - sum(orders.map(o => shippedBy(o, dayBefore, mode))))
  const shippedTotal = sum(orders.map(o => shippedBy(o, to, mode)))
  const paidTotal = moneyBy(money, to)
  const closing = round2(paidTotal - shippedTotal)
  const deltas = orders.map(o => round2(paidBy(o, to) - shippedBy(o, to, mode)))
  const weOwe = sum(deltas.filter(d => d > 0))
  const theyOwe = round2(-sum(deltas.filter(d => d < 0)))
  const f = flow(orders, from, to, mode)
  return {
    opening, shipped: f.dated, shippedPieces: f.datedPieces, undated: f.undated, undatedPieces: f.undatedPieces,
    paidTotal, shippedTotal, closing, weOwe, theyOwe,
    // Сходится по построению: closing = weOwe − theyOwe + unassigned. Плюс: деньги не разнесены; минус: отмечено сверх денег.
    unassigned: round2(closing - weOwe + theyOwe),
  }
}

export type ReconColumn = ReturnType<typeof column>
export type ReconOrderRow = {
  id: number; no: string; launchDay: string | null; amount: number; paid: number
  shippedItems: number; shippedWhole: number; state: 'none' | 'partial' | 'full'; balance: number  // balance по изделиям: плюс — должны мы
}
export type ReconNotes = {
  bankFrom: string | null; bankTo: string | null; undatedOrders: number; undatedAmount: number
  ledgerFrom: string | null; archived: { orders: number; amount: number }
  settled: { before: string; orders: number; amount: number } | null
}
export type ReconDoc = {
  clientName: string; from: string; to: string
  launched: { orders: number; pieces: number; amount: number; paid: number; unpaid: number; openUnpaid: number }
  closedOrders: { orders: number; amount: number }
  moneyInPeriod: { total: number; rows: ReconMoney[] }
  whole: ReconColumn; items: ReconColumn
  orders: ReconOrderRow[]
  notes: ReconNotes
}

// Поступления сводятся по дням: 14 платежей одного дня это один приход денег, а сроки оплаты видны по дням.
function byDay(money: ReconMoney[]): ReconMoney[] {
  const m = new Map<string, ReconMoney>()
  for (const r of money) {
    const k = `${r.day}:${r.source}`
    m.set(k, { ...r, amount: round2((m.get(k)?.amount ?? 0) + r.amount) })
  }
  return [...m.values()].sort((a, b) => a.day.localeCompare(b.day))
}

export function buildReconciliation(input: {
  clientName: string; from: string; to: string; orders: ReconOrder[]; money: ReconMoney[]
  bankFrom: string | null; bankTo: string | null; ledgerFrom: string | null; archived?: { orders: number; amount: number }
  settled?: { before: string; orders: number; amount: number }
}): ReconDoc {
  const { orders, money, from, to } = input
  const launchedHere = orders.filter(o => o.live && o.launchDay && inRange(o.launchDay, from, to))
  const openLaunched = orders.filter(o => o.live && o.launchDay && o.launchDay <= to)
  const unpaidOf = (o: ReconOrder) => Math.max(0, round2(o.amount - paidBy(o, to)))
  const launchedAmount = sum(launchedHere.map(o => o.amount))
  const launchedUnpaid = sum(launchedHere.map(unpaidOf))
  const closed = orders.filter(o => o.full?.day && inRange(o.full.day, from, to))
  const undated = orders.filter(o => o.full && !o.full.day && undatedSeen(o, to))

  const rows: ReconOrderRow[] = orders.flatMap(o => {
    const paid = paidBy(o, to)
    const shippedItems = shippedBy(o, to, 'items')
    const shippedWhole = shippedBy(o, to, 'whole')
    const balance = round2(paid - shippedItems)
    const launchedInPeriod = !!o.launchDay && inRange(o.launchDay, from, to)
    const movedInPeriod = o.events.some(e => e.day && inRange(e.day, from, to)) || (!!o.full?.day && inRange(o.full.day, from, to)) || o.payments.some(p => inRange(p.day, from, to))
    if (!launchedInPeriod && !movedInPeriod && balance === 0) return []
    if (o.launchDay && o.launchDay > to && paid === 0) return []
    const state = shippedWhole > 0 ? 'full' as const : shippedItems > 0 ? 'partial' as const : 'none' as const
    return [{ id: o.id, no: o.no, launchDay: o.launchDay, amount: o.amount, paid, shippedItems, shippedWhole, state, balance }]
  }).sort((a, b) => (a.launchDay ?? '').localeCompare(b.launchDay ?? '') || a.id - b.id)

  return {
    clientName: input.clientName, from, to,
    launched: {
      orders: launchedHere.length, pieces: launchedHere.reduce((n, o) => n + o.pieces, 0), amount: launchedAmount,
      unpaid: launchedUnpaid, paid: round2(launchedAmount - launchedUnpaid), openUnpaid: sum(openLaunched.map(unpaidOf)),
    },
    closedOrders: { orders: closed.length, amount: sum(closed.map(o => o.amount)) },
    moneyInPeriod: {
      total: sum(money.filter(m => inRange(m.day, from, to)).map(m => m.amount)),
      rows: byDay(money.filter(m => inRange(m.day, from, to))),
    },
    whole: column(orders, money, from, to, 'whole'),
    items: column(orders, money, from, to, 'items'),
    orders: rows,
    notes: {
      bankFrom: input.bankFrom, bankTo: input.bankTo, ledgerFrom: input.ledgerFrom,
      undatedOrders: undated.length, undatedAmount: sum(undated.map(o => o.amount)),
      archived: input.archived ?? { orders: 0, amount: 0 },
      settled: input.settled ?? null,
    },
  }
}

// Какие платежи считать деньгами. Перевод из выписки считает сама строка выписки, поэтому его платёж не считается дважды.
// Отметка внутри загруженной выписки только утверждает деньги: сверять её не с чем, кроме самой выписки.
// Отметка вне выписки и наличные другого следа не имеют, это всё, что есть.
export function paymentCountsAsMoney(
  p: { source?: string | null; method?: string | null; paid_at: string; linkedToBank: boolean },
  bankFrom: string | null, bankTo: string | null, isTransferMark: (p: { source?: string | null; method?: string | null }) => boolean,
): boolean {
  if (p.linkedToBank || p.source === 'client_advance') return false
  if (!isTransferMark(p) || !bankFrom || !bankTo) return true
  return p.paid_at < bankFrom || p.paid_at > bankTo
}

export const debtText = (n: number, client: string) => (n === 0 ? 'Никто никому не должен' : n > 0 ? `Мы должны ${client}` : `${client} должен нам`)
