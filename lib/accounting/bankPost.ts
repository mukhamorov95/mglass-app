import type { SupabaseClient } from '@supabase/supabase-js'
import { recordPayment, voidPayment } from '@/lib/payments/recordPayment'
import { readPaged, readIn, num } from '@/lib/money/paged'
import { attachInvoicePayments, asInvoiceRows, loadPaymentsForInvoices, toInvoiceLike } from '@/lib/money/invoicePayments'
import { invoicePayment, manualPaymentKind, fmtRub } from '@/lib/money/invoiceStatus'
import { MANUAL_SOURCE, syncInvoiceStatus } from '@/lib/money/invoiceManualPayment'
import { rowEffect, type OpenInvoice } from './bankMatch'

// Б9: разнесение строки выписки. Приход по счёту — сначала платёж в ядро payments
// (единственный источник правды по деньгам), потом операция ДДС со ссылкой на него:
// так платёж не всплывает ещё раз в «К проведению», а уникальный индекс по payment_id
// не даст провести его дважды. Ошибка записи платежа — отказ, а не тихий «проведено».

const TOL = 0.5
export const BANK_SOURCE = 'bank_statement_import'

// Неоплаченные по платежам счета — для автоподбора и ручного выбора на вкладке «Выписка».
export async function loadOpenInvoices(svc: SupabaseClient): Promise<OpenInvoice[]> {
  const rows = await readPaged(() => svc.from('invoices')
    .select('id, invoice_no, payer_client_id, payer_name, amount, status, order_ids, issued_at')
    .neq('status', 'cancelled').order('id'))
  const withPay = await attachInvoicePayments(svc, asInvoiceRows(rows))
  const open = withPay.filter(i => i.derivedStatus !== 'paid' && i.remainder > TOL)
  const payerIds = [...new Set(open.map(i => num(i.payer_client_id)).filter(n => n > 0))]
  const clients = await readIn(payerIds, part => svc.from('b2b_clients').select('id, inn').in('id', part).order('id'))
  const innBy = new Map(clients.map(c => [num(c.id), String(c.inn ?? '').trim() || null]))
  return open.map(i => ({
    id: i.id,
    no: String(i.invoice_no ?? i.id),
    payer: (i.payer_name as string | null) ?? null,
    inn: innBy.get(num(i.payer_client_id)) ?? null,
    amount: num(i.amount),
    paid: i.paid,
    remainder: i.remainder,
    orders: i.order_ids ?? [],
    issued_at: (i.issued_at as string | null) ?? null,
  }))
}

export type BankRow = {
  id: number; unit: string; external_key: string; op_date: string; amount: number
  direction: 'in' | 'out'; counterparty: string | null; purpose: string | null
  account: string | null; status: string
}

export type PostInput = {
  fundId: number; subfundId: number | null; account: string | null
  requestId: number | null; invoiceId: number | null
}

export type PostResult =
  | {
      ok: true; entryId: number; paymentId: number | null; warnings: string[]
      invoice: { no: string; partial: boolean; rest: number; over: number; replaced: number } | null
    }
  | { ok: false; status: number; error: string }

export async function postBankRow(
  svc: SupabaseClient, row: BankRow, input: PostInput, me: { id: string | null; name: string },
): Promise<PostResult> {
  if (row.status === 'posted') return { ok: false, status: 409, error: 'Строка уже проведена' }
  const warnings: string[] = []
  const amount = Number(row.amount)
  const invoiceId = row.direction === 'in' ? input.invoiceId : null

  let paymentId: number | null = null
  let invoice: Extract<PostResult, { ok: true }>['invoice'] = null
  if (invoiceId) {
    const { data: invRow, error: invErr } = await svc.from('invoices')
      .select('id, invoice_no, amount, order_ids, status').eq('id', invoiceId).maybeSingle()
    if (invErr) return { ok: false, status: 500, error: `Счёт не прочитан: ${invErr.message}` }
    if (!invRow) return { ok: false, status: 404, error: 'Счёт не найден' }
    const inv = toInvoiceLike(invRow)
    const invAmount = num(inv.amount)
    const invOrders = inv.order_ids ?? []
    const no = String((invRow as { invoice_no?: string }).invoice_no ?? invoiceId)
    if (invRow.status === 'cancelled') return { ok: false, status: 409, error: `Счёт № ${no} отменён — выберите другой или проведите без счёта` }

    const key = `bank:${row.unit}:${row.external_key}`
    let pays
    try { pays = await loadPaymentsForInvoices(svc, [inv]) } catch (e) {
      return { ok: false, status: 500, error: `Платежи по счёту не прочитаны: ${e instanceof Error ? e.message : String(e)}` }
    }
    // Свой же платёж (повтор после сбоя) не считаем «уже пришедшими» деньгами
    const others = pays.filter(p => p.external_key !== key)
    // Ручное «Оплачен» — отметка до прихода денег. Пришли деньги из банка и не
    // помещаются в остаток из-за неё — отметку заменяем фактом, а не копим переплату.
    const manual = others.filter(p => p.source === MANUAL_SOURCE && p.invoice_id === inv.id)
    const withManual = invoicePayment(inv, others)
    const noManual = invoicePayment(inv, others.filter(p => !manual.includes(p)))
    const replace = manual.length > 0 && amount > withManual.remainder + TOL && noManual.remainder > TOL
    const state = replace ? noManual : withManual
    if (state.remainder <= TOL) {
      return {
        ok: false, status: 409,
        error: `Счёт № ${no} уже оплачен по платежам: ${fmtRub(state.paid)} из ${fmtRub(invAmount)}. Проведите строку без счёта или выберите другой`,
      }
    }

    const eff = rowEffect(state.remainder, amount)
    try {
      const p = await recordPayment(svc, {
        externalKey: key, amount, paidAt: String(row.op_date),
        kind: manualPaymentKind(state.paid, amount, state.remainder),
        source: BANK_SOURCE, method: 'Перевод',
        invoiceId: inv.id,
        // Якорь заказа — только когда счёт на один заказ, иначе деньги прилипли бы к произвольному
        b2bOrderId: invOrders.length === 1 ? invOrders[0] : null,
        enteredBy: me.id, enteredByName: me.name,
        note: `Счёт № ${no} из выписки${eff.partial ? ' (частичная оплата)' : ''}`,
      })
      paymentId = p?.id ?? null
    } catch (e) {
      return { ok: false, status: 500, error: `Платёж не записан — строка не проведена: ${e instanceof Error ? e.message : String(e)}` }
    }
    if (!paymentId) return { ok: false, status: 500, error: 'Платёж не записан — строка не проведена' }

    let replaced = 0
    if (replace) {
      for (const m of manual) {
        try { await voidPayment(svc, String(m.external_key), me.id ?? undefined); replaced++ } catch (e) {
          warnings.push(`Ручная отметка оплаты не снята — по счёту возможна переплата: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
    if (eff.over > 0) warnings.push(`Переплата по счёту № ${no}: ${fmtRub(eff.over)} сверх остатка`)
    invoice = { no, partial: eff.partial, rest: eff.rest, over: eff.over, replaced }
  }

  const entry = {
    entry_date: row.op_date, unit: row.unit, kind: row.direction, fund_id: input.fundId,
    subfund_id: input.subfundId, amount,
    account: input.account ?? row.account ?? null,
    counterparty: row.counterparty,
    comment: row.purpose?.slice(0, 300) ?? null,
    entered_by: me.id, entered_by_name: me.name,
    payment_id: paymentId,
  }
  let entryId: number
  const ins = await svc.from('cashflow_entries').insert(entry).select('id').single()
  if (ins.error) {
    // Повтор после сбоя: операция по этому платежу уже есть — берём её, а не плодим дубль
    if (ins.error.code === '23505' && paymentId) {
      const { data: had } = await svc.from('cashflow_entries').select('id').eq('payment_id', paymentId).maybeSingle()
      if (!had) return { ok: false, status: 500, error: ins.error.message }
      entryId = num(had.id)
    } else {
      return {
        ok: false, status: 500,
        error: paymentId
          ? `Платёж записан, но операция ДДС не создана: ${ins.error.message}. Он виден во вкладке «К проведению»`
          : ins.error.message,
      }
    }
  } else {
    entryId = num((ins.data as { id: number }).id)
  }

  if (invoiceId) {
    const synced = await syncInvoiceStatus(svc, invoiceId)
    if (!synced.ok) warnings.push(synced.error)
  }

  if (input.requestId) {
    // Заявка закрывается фактом платежа из банка — руками её больше не отмечают
    const { error } = await svc.from('payment_requests').update({
      status: 'paid', entry_id: entryId, status_changed_at: new Date().toISOString(),
      status_changed_by: me.name, updated_at: new Date().toISOString(),
    }).eq('id', input.requestId)
    if (error) warnings.push(`Заявка не закрыта: ${error.message}`)
  }

  const { data: marked, error: markErr } = await svc.from('bank_statement_rows')
    .update({ status: 'posted', entry_id: entryId, request_id: input.requestId, invoice_id: invoiceId, payment_id: paymentId })
    .eq('id', row.id).select('id')
  if (markErr || !marked?.length) {
    return {
      ok: false, status: 500,
      error: `Операция ДДС создана (№ ${entryId}), но строка выписки не отмечена проведённой${markErr ? `: ${markErr.message}` : ''}. Не проводите её повторно — сообщите владельцу`,
    }
  }
  return { ok: true, entryId, paymentId, warnings, invoice }
}
