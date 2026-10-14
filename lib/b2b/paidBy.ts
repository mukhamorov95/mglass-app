// Кто отметил оплату заказа — по последнему живому платежу. Подпись короткая, чтобы
// влезть в метку «Оплачен · …» в строке заказа; подробности — в подсказке.

export type PaidByPayment = {
  id: number
  source: string | null
  entered_by_name: string | null
  paid_at: string | null
}

export type PaidBy = { label: string | null; title: string }

const BANK = 'bank_statement_import'
const RECONCILE = 'reconcile'

const ruDate = (d: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '')
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

const firstName = (name: string) => name.trim().split(/\s+/)[0]

export function latestPayment<T extends PaidByPayment>(pays: T[]): T | null {
  let best: T | null = null
  for (const p of pays) {
    if (!best || (p.paid_at ?? '') > (best.paid_at ?? '') || ((p.paid_at ?? '') === (best.paid_at ?? '') && p.id > best.id)) best = p
  }
  return best
}

export function paidByOf(p: PaidByPayment | null): PaidBy | null {
  if (!p) return null
  const date = ruDate(p.paid_at)
  const who = p.entered_by_name?.trim() || null
  if (p.source === BANK) {
    return { label: 'банк', title: `Пришло по выписке банка ${date}${who ? `, провёл(а) ${who}` : ''}` }
  }
  if (p.source === RECONCILE || !who) {
    // Сверка до 14.10 перезаписывала платёж кнопки «Оплачен» и стирала автора.
    return { label: null, title: `Оплата от ${date}: кто отметил — не сохранилось` }
  }
  return { label: firstName(who), title: `Отметил(а) ${who} — оплата от ${date}` }
}
