import type { SupabaseClient } from '@supabase/supabase-js'
import { recordPayment, voidPayment } from '@/lib/payments/recordPayment'
import { loadPaymentsForInvoices, toInvoiceLike } from './invoicePayments'
import {
  invoicePayment, columnStatusFor, manualPaymentKind, checkManualAmount, fmtRub,
  type InvoicePayment,
} from './invoiceStatus'

// Ручное «Оплачен» по счёту: не переключатель статуса, а платёж на остаток через
// единственного писателя payments (recordPayment). Колонка invoices.status после
// записи приводится к платежам — она зеркало, а не источник.

export const MANUAL_SOURCE = 'invoice_manual'

type Fail = { ok: false; status: number; error: string; state?: InvoicePayment }
type InvoiceHead = { id: number; invoice_no: string; amount: number; order_ids: number[]; status: string }

const mskToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })

async function readInvoice(svc: SupabaseClient, id: number): Promise<InvoiceHead | Fail> {
  const { data, error } = await svc.from('invoices').select('id, invoice_no, amount, order_ids, status').eq('id', id).maybeSingle()
  if (error) return { ok: false, status: 500, error: `Счёт не прочитан: ${error.message}` }
  if (!data) return { ok: false, status: 404, error: 'Счёт не найден' }
  return { ...toInvoiceLike(data), invoice_no: String((data as { invoice_no?: string }).invoice_no ?? id) } as InvoiceHead
}

async function stateOf(svc: SupabaseClient, inv: InvoiceHead): Promise<InvoicePayment> {
  return invoicePayment(inv, await loadPaymentsForInvoices(svc, [inv]))
}

// Привести колонку статуса к платежам. Возвращает итоговое состояние оплаты.
export async function syncInvoiceStatus(svc: SupabaseClient, invoiceId: number): Promise<{ ok: true; state: InvoicePayment; status: string } | Fail> {
  const inv = await readInvoice(svc, invoiceId)
  if ('ok' in inv) return inv
  const state = await stateOf(svc, inv)
  const next = columnStatusFor(inv.status, state.derivedStatus)
  if (next) {
    const { error } = await svc.from('invoices').update({
      status: next,
      paid_at: next === 'paid' ? (state.lastPaidAt ?? mskToday()) : null,
      updated_at: new Date().toISOString(),
    }).eq('id', invoiceId)
    if (error) return { ok: false, status: 500, error: `Статус счёта не обновлён: ${error.message}`, state }
  }
  return { ok: true, state, status: next ?? inv.status }
}

export async function payInvoice(svc: SupabaseClient, invoiceId: number, input: {
  amount?: unknown
  paidAt?: string | null
  actorId: string | null
  actorName: string | null
}): Promise<{ ok: true; paymentId: number | null; state: InvoicePayment; invoiceNo: string } | Fail> {
  const inv = await readInvoice(svc, invoiceId)
  if ('ok' in inv) return inv
  if (inv.status === 'cancelled') return { ok: false, status: 409, error: `Счёт № ${inv.invoice_no} отменён — оплату по нему не записать` }

  const before = await stateOf(svc, inv)
  if (before.derivedStatus === 'paid') {
    await syncInvoiceStatus(svc, invoiceId)
    return {
      ok: false, status: 409, state: before,
      error: `Счёт № ${inv.invoice_no} уже оплачен по платежам: ${fmtRub(before.paid)} из ${fmtRub(inv.amount)}`,
    }
  }

  const checked = checkManualAmount(input.amount ?? before.remainder, before.remainder)
  if (!checked.ok) return { ok: false, status: 400, error: checked.error, state: before }

  const paidAt = /^\d{4}-\d{2}-\d{2}$/.test(input.paidAt ?? '') ? input.paidAt! : mskToday()
  // Ключ от состояния «до»: двойной клик с одним и тем же остатком даёт одну строку.
  const externalKey = `invoice:${inv.id}:manual:${Math.round(before.paid * 100)}`
  let paymentId: number | null = null
  try {
    const p = await recordPayment(svc, {
      externalKey, amount: checked.amount, paidAt,
      kind: manualPaymentKind(before.paid, checked.amount, before.remainder),
      source: MANUAL_SOURCE, method: 'Счёт',
      invoiceId: inv.id,
      // Одно-заказный счёт — ещё и якорь заказа (контракт с бухгалтерией): так платёж видит и карточка заказа.
      b2bOrderId: inv.order_ids.length === 1 ? inv.order_ids[0] : null,
      enteredBy: input.actorId, enteredByName: input.actorName,
      note: `Счёт № ${inv.invoice_no}: оплата отмечена вручную`,
    })
    paymentId = p?.id ?? null
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : 'Платёж не записан' }
  }

  const synced = await syncInvoiceStatus(svc, invoiceId)
  if (!synced.ok) return { ...synced, error: `Платёж записан, но ${synced.error.toLowerCase()}` }
  return { ok: true, paymentId, state: synced.state, invoiceNo: inv.invoice_no }
}

// Снять ручную оплату: войднуть платежи, записанные кнопкой «Оплачен». Деньги из
// выписки и по заказу здесь не снимаются — у них свой писатель.
export async function unpayInvoice(svc: SupabaseClient, invoiceId: number, actorId: string | null): Promise<{ ok: true; voided: number; state: InvoicePayment } | Fail> {
  const inv = await readInvoice(svc, invoiceId)
  if ('ok' in inv) return inv
  const { data, error } = await svc.from('payments').select('external_key')
    .eq('invoice_id', invoiceId).eq('source', MANUAL_SOURCE).is('voided_at', null).order('id')
  if (error) return { ok: false, status: 500, error: `Платежи не прочитаны: ${error.message}` }
  const keys = (data ?? []).map(r => String((r as { external_key: string }).external_key))
  if (keys.length === 0) {
    return { ok: false, status: 409, error: `По счёту № ${inv.invoice_no} нет ручных оплат — деньги пришли из выписки или по заказу и снимаются там же` }
  }
  try {
    for (const k of keys) await voidPayment(svc, k, actorId ?? undefined)
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : 'Оплата не снята' }
  }
  const synced = await syncInvoiceStatus(svc, invoiceId)
  if (!synced.ok) return { ...synced, error: `Оплата снята, но ${synced.error.toLowerCase()}` }
  return { ok: true, voided: keys.length, state: synced.state }
}
