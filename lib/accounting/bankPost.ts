import type { SupabaseClient } from '@supabase/supabase-js'
import { recordPayment, voidPayment } from '@/lib/payments/recordPayment'
import { readPaged, readIn, num } from '@/lib/money/paged'
import { asInvoiceRows, loadPaymentsForInvoices, toInvoiceLike } from '@/lib/money/invoicePayments'
import { invoicePayment, invoicePayments, manualPaymentKind, fmtRub } from '@/lib/money/invoiceStatus'
import { syncInvoiceStatus } from '@/lib/money/invoiceManualPayment'
import { isTransferMark } from '@/lib/payments/marks'
import { finalTotalOf } from '@/lib/b2b/priceOverride'
import { orderNo, rowEffect, type OpenInvoice, type OpenOrder } from './bankMatch'

// Б9: разнесение строки выписки. Приход по счёту — сначала платёж в ядро payments
// (единственный источник правды по деньгам), потом операция ДДС со ссылкой на него:
// так платёж не всплывает ещё раз в «К проведению», а уникальный индекс по payment_id
// не даст провести его дважды. Ошибка записи платежа — отказ, а не тихий «проведено».

const TOL = 0.5
export const BANK_SOURCE = 'bank_statement_import'

// Счета, по которым деньги пришли не целиком, — для автоподбора и ручного выбора на вкладке
// «Выписка». Ручное «Оплачен» деньгами не считается: счёт, закрытый только отметкой, остаётся
// здесь, и пришедший перевод её подтвердит (14.10: 23 платежа ждали отмеченные счета).
export async function loadOpenInvoices(svc: SupabaseClient): Promise<OpenInvoice[]> {
  const rows = await readPaged(() => svc.from('invoices')
    .select('id, invoice_no, payer_client_id, payer_name, amount, status, order_ids, issued_at')
    .neq('status', 'cancelled').order('id'))
  const invs = asInvoiceRows(rows)
  const pays = invs.length ? await loadPaymentsForInvoices(svc, invs) : []
  const facts = invoicePayments(invs, pays.filter(p => !isTransferMark(p)))
  const marks = invoicePayments(invs, pays.filter(p => isTransferMark(p)))
  const orderIds = [...new Set(invs.flatMap(i => i.order_ids ?? []))]
  const orders = await readIn(orderIds, part => svc.from('b2b_orders').select('id, total_after_discount, total_sale_inc_vat').in('id', part).order('id'))
  const totalBy = new Map(orders.map(o => [num(o.id), finalTotalOf(o as { total_after_discount?: number; total_sale_inc_vat?: number })]))
  const open = invs
    .map(i => {
      const f = facts.get(i.id)!
      const ordersTotal = (i.order_ids ?? []).reduce((s, id) => s + (totalBy.get(Number(id)) ?? 0), 0)
      return Object.assign({}, i, f, {
        marked: marks.get(i.id)?.paid ?? 0,
        orderRemainder: ordersTotal > 0 ? Math.max(0, Math.round((ordersTotal - f.paid) * 100) / 100) : undefined,
      })
    })
    .filter(i => i.remainder > TOL || (i.orderRemainder ?? 0) > TOL)
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
    marked: i.marked,
    orderRemainder: i.orderRemainder,
    orders: i.order_ids ?? [],
    issued_at: (i.issued_at as string | null) ?? null,
  }))
}

// Заказы из назначений строк, у которых в приложении нет счёта. Остаток — по деньгам:
// отметка «Оплачен» его не уменьшает, пришедший перевод её подтвердит.
export async function loadOpenOrders(svc: SupabaseClient, ids: number[]): Promise<OpenOrder[]> {
  if (ids.length === 0) return []
  const [orders, withInvoice, pays] = await Promise.all([
    readIn(ids, part => svc.from('b2b_orders').select('id, client_name, total_after_discount, total_sale_inc_vat').in('id', part).order('id')),
    readIn(ids, part => svc.from('invoices').select('id, order_ids').overlaps('order_ids', part).neq('status', 'cancelled').order('id')),
    readIn(ids, part => svc.from('payments').select('id, amount, b2b_order_id, source, method').in('b2b_order_id', part).is('voided_at', null).order('id')),
  ])
  const invoiced = new Set(withInvoice.flatMap(i => (Array.isArray(i.order_ids) ? i.order_ids as unknown[] : []).map(Number)))
  return orders.filter(o => !invoiced.has(num(o.id))).map(o => {
    const id = num(o.id)
    const mine = pays.filter(p => num(p.b2b_order_id) === id)
    const fact = mine.filter(p => !isTransferMark(p as { source?: string; method?: string })).reduce((s, p) => s + num(p.amount), 0)
    const marked = mine.filter(p => isTransferMark(p as { source?: string; method?: string })).reduce((s, p) => s + num(p.amount), 0)
    const total = finalTotalOf(o as { total_after_discount?: number; total_sale_inc_vat?: number })
    return { id, no: orderNo(id), payer: (o.client_name as string | null) ?? null, total, remainder: Math.max(0, Math.round((total - fact) * 100) / 100), marked }
  }).filter(o => o.remainder > TOL)
}

export type BankRow = {
  id: number; unit: string; external_key: string; op_date: string; amount: number
  direction: 'in' | 'out'; counterparty: string | null; purpose: string | null
  account: string | null; status: string
  // Оплата уже проставлена автоподбором — проводка в ДДС ссылается на тот же платёж
  payment_id?: number | null; invoice_id?: number | null
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

export type BankPayResult =
  | { ok: true; paymentId: number; warnings: string[]; invoice: NonNullable<Extract<PostResult, { ok: true }>['invoice']> }
  | { ok: false; status: number; error: string }

// Приход по счёту → платёж в ядро. Отдельно от ДДС: автоподбор при загрузке выписки
// проставляет оплату заказа сразу, а операцию ДДС бухгалтер проводит потом — тем же
// ключом строки, так что платёж не задваивается.
export async function applyBankPayment(
  svc: SupabaseClient, row: BankRow, invoiceId: number,
  me: { id: string | null; name: string | null }, opts: { note?: string; byOrder?: boolean } = {},
): Promise<BankPayResult> {
  const warnings: string[] = []
  const amount = Number(row.amount)
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
  // Свой же платёж (повтор после сбоя, проводка после автоподбора) не считаем «уже пришедшими» деньгами
  const others = pays.filter(p => p.external_key !== key)
  // Отметка «Оплачен» — до прихода денег. Пришли деньги из банка — отметку заменяем фактом,
  // а не копим переплату: остаток считаем по деньгам, отметки снимаем после записи платежа.
  const marks = others.filter(p => isTransferMark(p))
  const state = invoicePayment(inv, others.filter(p => !marks.includes(p)))
  if (state.remainder <= TOL) {
    return {
      ok: false, status: 409,
      error: `Счёт № ${no} уже оплачен по платежам: ${fmtRub(state.paid)} из ${fmtRub(invAmount)}. Проведите строку без счёта или выберите другой`,
    }
  }

  const eff = rowEffect(state.remainder, amount)
  let paymentId: number | null = null
  try {
    const p = await recordPayment(svc, {
      externalKey: key, amount, paidAt: String(row.op_date),
      kind: manualPaymentKind(state.paid, amount, state.remainder),
      source: BANK_SOURCE, method: 'Перевод',
      invoiceId: inv.id,
      // Якорь заказа — только когда счёт на один заказ, иначе деньги прилипли бы к произвольному
      b2bOrderId: invOrders.length === 1 ? invOrders[0] : null,
      enteredBy: me.id, enteredByName: me.name,
      note: opts.note ?? `Счёт № ${no} из выписки${eff.partial ? ' (частичная оплата)' : ''}`,
    })
    paymentId = p?.id ?? null
  } catch (e) {
    return { ok: false, status: 500, error: `Платёж не записан: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!paymentId) return { ok: false, status: 500, error: 'Платёж не записан' }

  let replaced = 0
  for (const m of marks) {
    try { await voidPayment(svc, String(m.external_key), me.id ?? undefined); replaced++ } catch (e) {
      warnings.push(`Отметка «Оплачен» не снята — по счёту возможна переплата: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  // Оплачен итог заказа, а счёт выставлен до правки — не переплата, а устаревший счёт
  if (eff.over > 0 && !opts.byOrder) warnings.push(`Переплата по счёту № ${no}: ${fmtRub(eff.over)} сверх остатка`)
  if (opts.byOrder) warnings.push(`Счёт № ${no} устарел: оплачен итог заказа ${fmtRub(amount)}, в счёте ${fmtRub(invAmount)}`)

  const synced = await syncInvoiceStatus(svc, inv.id)
  if (!synced.ok) warnings.push(synced.error)
  return { ok: true, paymentId, warnings, invoice: { no, partial: eff.partial, rest: eff.rest, over: eff.over, replaced } }
}

export type BankOrderPayResult =
  | { ok: true; paymentId: number; warnings: string[]; order: { no: string; partial: boolean; rest: number; over: number; replaced: number } }
  | { ok: false; status: number; error: string }

// Приход по заказу без счёта (номер заказа в назначении) → платёж в ядро с якорем заказа.
export async function applyBankOrderPayment(
  svc: SupabaseClient, row: BankRow, orderId: number,
  me: { id: string | null; name: string | null }, note?: string,
): Promise<BankOrderPayResult> {
  const warnings: string[] = []
  const amount = Number(row.amount)
  const no = orderNo(orderId)
  const { data: o, error: oErr } = await svc.from('b2b_orders')
    .select('id, total_after_discount, total_sale_inc_vat').eq('id', orderId).maybeSingle()
  if (oErr) return { ok: false, status: 500, error: `Заказ не прочитан: ${oErr.message}` }
  if (!o) return { ok: false, status: 404, error: `Заказ ${no} не найден` }
  const total = finalTotalOf(o as { total_after_discount?: number; total_sale_inc_vat?: number })

  const key = `bank:${row.unit}:${row.external_key}`
  const { data: payRows, error: pErr } = await svc.from('payments')
    .select('id, amount, external_key, source, method').eq('b2b_order_id', orderId).is('voided_at', null)
  if (pErr) return { ok: false, status: 500, error: `Платежи заказа не прочитаны: ${pErr.message}` }
  const others = (payRows ?? []).filter(p => p.external_key !== key)
  const marks = others.filter(p => isTransferMark(p))
  const paid = others.filter(p => !marks.includes(p)).reduce((s, p) => s + num(p.amount), 0)
  const remainder = Math.max(0, Math.round((total - paid) * 100) / 100)
  if (remainder <= TOL) return { ok: false, status: 409, error: `Заказ ${no} уже оплачен по платежам` }

  const eff = rowEffect(remainder, amount)
  let paymentId: number | null = null
  try {
    const p = await recordPayment(svc, {
      externalKey: key, amount, paidAt: String(row.op_date),
      kind: manualPaymentKind(paid, amount, remainder),
      source: BANK_SOURCE, method: 'Перевод', b2bOrderId: orderId,
      enteredBy: me.id, enteredByName: me.name,
      note: note ?? `Заказ ${no} из выписки (счёта в приложении нет)`,
    })
    paymentId = p?.id ?? null
  } catch (e) {
    return { ok: false, status: 500, error: `Платёж не записан: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!paymentId) return { ok: false, status: 500, error: 'Платёж не записан' }

  let replaced = 0
  for (const m of marks) {
    try { await voidPayment(svc, String(m.external_key), me.id ?? undefined); replaced++ } catch (e) {
      warnings.push(`Отметка «Оплачен» не снята — по заказу возможна переплата: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (eff.over > 0) warnings.push(`Переплата по заказу ${no}: ${fmtRub(eff.over)} сверх остатка`)
  return { ok: true, paymentId, warnings, order: { no, partial: eff.partial, rest: eff.rest, over: eff.over, replaced } }
}

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
    const res = await applyBankPayment(svc, row, invoiceId, me)
    if (!res.ok) {
      return res.status === 500 && res.error.startsWith('Платёж не записан')
        ? { ...res, error: `${res.error} — строка не проведена` }
        : res
    }
    paymentId = res.paymentId
    invoice = res.invoice
    warnings.push(...res.warnings)
  }

  const entry = {
    entry_date: row.op_date, unit: row.unit, kind: row.direction, fund_id: input.fundId,
    subfund_id: input.subfundId, amount,
    account: input.account ?? row.account ?? null,
    counterparty: row.counterparty,
    comment: row.purpose?.slice(0, 300) ?? null,
    entered_by: me.id, entered_by_name: me.name,
    payment_id: paymentId ?? row.payment_id ?? null,
  }
  let entryId: number
  const ins = await svc.from('cashflow_entries').insert(entry).select('id').single()
  if (ins.error) {
    // Повтор после сбоя: операция по этому платежу уже есть — берём её, а не плодим дубль
    if (ins.error.code === '23505' && entry.payment_id) {
      const { data: had } = await svc.from('cashflow_entries').select('id').eq('payment_id', entry.payment_id).maybeSingle()
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

  if (input.requestId) {
    // Заявка закрывается фактом платежа из банка — руками её больше не отмечают
    const { error } = await svc.from('payment_requests').update({
      status: 'paid', entry_id: entryId, status_changed_at: new Date().toISOString(),
      status_changed_by: me.name, updated_at: new Date().toISOString(),
    }).eq('id', input.requestId)
    if (error) warnings.push(`Заявка не закрыта: ${error.message}`)
  }

  const { data: marked, error: markErr } = await svc.from('bank_statement_rows')
    .update({
      status: 'posted', entry_id: entryId, request_id: input.requestId,
      invoice_id: invoiceId ?? row.invoice_id ?? null, payment_id: entry.payment_id,
    })
    .eq('id', row.id).select('id')
  if (markErr || !marked?.length) {
    return {
      ok: false, status: 500,
      error: `Операция ДДС создана (№ ${entryId}), но строка выписки не отмечена проведённой${markErr ? `: ${markErr.message}` : ''}. Не проводите её повторно — сообщите владельцу`,
    }
  }
  return { ok: true, entryId, paymentId, warnings, invoice }
}
