// Деньги замера. Правила владельца 01.10.2026:
//  · цена выезда, которую поставил менеджер (visit_price), остаётся как была; если на
//    объекте вышло иначе — замерщик пишет свою (actual_price) и коротко почему (price_note);
//  · гонорар замерщика — цена выезда или отдельно прописанная сумма. Поэтому гонорар
//    идёт за ценой, пока его не задали отдельно: он не указан (0) или равен текущей цене;
//  · как оплачен выезд — замерщику на объекте, на компанию или не оплачен. Владельцу важно,
//    чтобы платили на объекте.

export type VisitPayment = 'onsite' | 'company' | 'unpaid'
export const VISIT_PAYMENTS: VisitPayment[] = ['onsite', 'company', 'unpaid']
export const PAYMENT_LABEL: Record<VisitPayment, string> = {
  onsite: 'оплачено замерщику на объекте',
  company: 'оплачено на компанию',
  unpaid: 'не оплачено',
}

export type PriceFields = { visit_price: number | string | null; actual_price: number | string | null; measurer_fee: number | string | null }

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

export function finalPrice(r: Pick<PriceFields, 'visit_price' | 'actual_price'>): number {
  return r.actual_price == null || r.actual_price === '' ? num(r.visit_price) : num(r.actual_price)
}

// Новая цена от замерщика → что записать. Совпала с ценой менеджера — поправки нет.
export function applyActualPrice(r: PriceFields, price: number, note: string | null):
  { actual_price: number | null; price_note: string | null; measurer_fee: number } {
  const current = finalPrice(r)
  const fee = num(r.measurer_fee)
  const feeFollows = fee === 0 || fee === current
  const same = price === num(r.visit_price)
  return {
    actual_price: same ? null : price,
    price_note: same ? null : note,
    measurer_fee: feeFollows ? price : fee,
  }
}

// Компания должна замерщику гонорар за выполненный замер, если выезд не оплачен
// ему на объекте и выплату ещё не отметили.
export function companyOwes(r: { status: string; visit_payment: VisitPayment | null; fee_status: string; measurer_fee: number | string | null }): number {
  if (r.status !== 'done' || r.visit_payment === 'onsite' || r.fee_status === 'paid') return 0
  return num(r.measurer_fee)
}

export type EarningRow = PriceFields & {
  status: string
  is_repeat?: boolean | null
  visit_payment: VisitPayment | null
  fee_status: string
}
type Bucket = { count: number; sum: number }
export type EarningsSummary = {
  done: Bucket
  onsite: Bucket
  company: Bucket
  unpaid: Bucket
  unmarked: Bucket
  repeat: number                 // из сделанных — повторных (владелец 01.10: новые и повторные раздельно)
  noPrice: number
  fee: { total: number; onsite: number; paidOut: number; owed: number; notSet: number }
}

// Итоги «Заработка» по выполненным замерам периода. Тождества, которые экран печатает:
// done = onsite + company + unpaid + unmarked (и штуки, и рубли);
// fee.total = fee.onsite + fee.paidOut + fee.owed.
export function summarizeEarnings(rows: EarningRow[]): EarningsSummary {
  const b = (): Bucket => ({ count: 0, sum: 0 })
  const out: EarningsSummary = { done: b(), onsite: b(), company: b(), unpaid: b(), unmarked: b(), repeat: 0, noPrice: 0, fee: { total: 0, onsite: 0, paidOut: 0, owed: 0, notSet: 0 } }
  for (const r of rows) {
    if (r.status !== 'done') continue
    const price = finalPrice(r)
    const fee = num(r.measurer_fee)
    const bucket = r.visit_payment ? out[r.visit_payment] : out.unmarked
    out.done.count++; out.done.sum += price
    if (r.is_repeat) out.repeat++
    bucket.count++; bucket.sum += price
    if (price === 0) out.noPrice++
    out.fee.total += fee
    if (fee === 0) out.fee.notSet++
    if (r.visit_payment === 'onsite') out.fee.onsite += fee
    else if (r.fee_status === 'paid') out.fee.paidOut += fee
    else out.fee.owed += fee
  }
  return out
}
