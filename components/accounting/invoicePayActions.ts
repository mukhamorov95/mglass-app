import { confirmDialog, promptDialog } from '@/lib/dialog'
import { toast, responseError, NETWORK_ERROR } from '@/lib/toast'
import { checkManualAmount, fmtRub } from '@/lib/money/invoiceStatus'

// «Оплачен» по счёту с двух экранов (Бухгалтерия → Документы, /cfo/invoices):
// подтверждение суммы своим окном → платёж на остаток → статус по платежам.

export type PayableInvoice = { id: number; no: string; amount: number; paid: number; remainder: number }

// true — данные на экране устарели, перечитать.
export async function askAndPayInvoice(inv: PayableInvoice): Promise<boolean> {
  if (inv.remainder <= 0) { toast.info(`Счёт № ${inv.no} уже оплачен по платежам`); return false }
  const raw = await promptDialog({
    title: `Оплата по счёту № ${inv.no}`,
    text: `Сумма счёта ${fmtRub(inv.amount)}${inv.paid > 0 ? `, уже оплачено ${fmtRub(inv.paid)}` : ''}. `
      + 'Запишется платёж — статус счёта считается по платежам.',
    label: 'Сумма платежа, ₽',
    defaultValue: String(Math.round(inv.remainder * 100) / 100),
    confirmLabel: 'Записать оплату',
  })
  if (raw == null) return false
  const checked = checkManualAmount(raw, inv.remainder)
  if (!checked.ok) { toast.error('Оплата не записана', { detail: checked.error }); return false }

  let r: Response
  try {
    r = await fetch(`/api/invoices/${inv.id}/payment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: checked.amount }),
    })
  } catch {
    toast.error('Оплата не записана', { detail: NETWORK_ERROR }); return false
  }
  if (r.status === 409) { toast.info(await responseError(r)); return true }
  if (!r.ok) { toast.error('Оплата не записана', { detail: await responseError(r) }); return false }
  const j = await r.json().catch(() => ({})) as { derivedStatus?: string; remainder?: number }
  toast.success(`Оплата ${fmtRub(checked.amount)} записана`, {
    detail: j.derivedStatus === 'paid' ? `Счёт № ${inv.no} оплачен` : `Остаток по счёту ${fmtRub(Number(j.remainder) || 0)}`,
  })
  return true
}

export async function askAndUnpayInvoice(inv: { id: number; no: string }): Promise<boolean> {
  const ok = await confirmDialog({
    title: `Снять ручную оплату по счёту № ${inv.no}?`,
    text: 'Платежи, записанные кнопкой «Оплачен», станут снятыми (история остаётся). Деньги из выписки и по заказу здесь не снимаются.',
    confirmLabel: 'Снять оплату', danger: true,
  })
  if (!ok) return false
  let r: Response
  try { r = await fetch(`/api/invoices/${inv.id}/payment`, { method: 'DELETE' }) } catch {
    toast.error('Оплата не снята', { detail: NETWORK_ERROR }); return false
  }
  if (!r.ok) { toast.error('Оплата не снята', { detail: await responseError(r) }); return false }
  toast.success(`Ручная оплата по счёту № ${inv.no} снята`)
  return true
}
