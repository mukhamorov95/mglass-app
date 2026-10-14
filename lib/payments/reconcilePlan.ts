// Ночная сверка «Оплачен» в notes ↔ платежи B2B-заказа. Только дописывает недостающее.
// Платёж, который уже есть (живой или снятый), не трогает: upsert поверх него стирал
// автора отметки (14.10: у всех 168 платежей сверки автор пустой) и оживлял «остаток»,
// снятый кнопкой, потому что деньги уже пришли по выписке, — заказ оплачивался дважды.

export type KeyState = 'live' | 'voided' | undefined

export type ReconcileStep =
  | { op: 'insert'; part: 'prepayment' | 'settlement'; amount: number; kind: 'prepayment' | 'remainder' | 'full' }
  | { op: 'void'; part: 'prepayment' | 'settlement' }

export type ReconcileOrder = {
  paid: boolean
  partial: boolean
  total: number
  prepay: number
  prepayKey: KeyState
  settleKey: KeyState
  // Живые платежи заказа помимо «остатка»: предоплата, выписка, счёт (доля счёта на заказ).
  paidOther: number
}

const round2 = (v: number) => Math.round(v * 100) / 100

export function reconcileOrder(o: ReconcileOrder): ReconcileStep[] {
  const steps: ReconcileStep[] = []
  if (o.paid && o.total > 0) {
    let covered = o.paidOther
    if (o.prepay > 0 && o.prepayKey === undefined) {
      steps.push({ op: 'insert', part: 'prepayment', amount: o.prepay, kind: 'prepayment' })
      covered += o.prepay
    }
    if (o.settleKey === undefined) {
      // Как у кнопки: меньше рубля — копейки раскладки счёта по заказам, не долг.
      const rest = round2(o.total - covered)
      if (rest > 1) steps.push({ op: 'insert', part: 'settlement', amount: rest, kind: covered > 0 ? 'remainder' : 'full' })
    }
    return steps
  }
  if (o.partial && o.prepay > 0) {
    if (o.prepayKey === undefined) steps.push({ op: 'insert', part: 'prepayment', amount: o.prepay, kind: 'prepayment' })
    if (o.settleKey === 'live') steps.push({ op: 'void', part: 'settlement' })
    return steps
  }
  if (o.prepayKey === 'live') steps.push({ op: 'void', part: 'prepayment' })
  if (o.settleKey === 'live') steps.push({ op: 'void', part: 'settlement' })
  return steps
}
