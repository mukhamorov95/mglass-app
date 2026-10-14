import type { SupabaseClient } from '@supabase/supabase-js'
import { recordPayment, voidPayment } from '@/lib/payments/recordPayment'
import { ADVANCE_SOURCE, isTransferMark } from '@/lib/payments/marks'
import { loadOrderPaid } from '@/lib/money/orderPaid'
import { readIn, readPaged, num, type Row } from '@/lib/money/paged'
import { manualPaymentKind, fmtRub } from '@/lib/money/invoiceStatus'
import { syncInvoiceStatus } from '@/lib/money/invoiceManualPayment'
import { finalTotalOf } from '@/lib/b2b/priceOverride'

// Аванс клиента: деньги пришли раньше заказов, запущенные заказы списываются с него
// (14.10, ГлассДекор: 400 000 ₽). Списание — платёж по заказу с ключом advance:<аванс>:<заказ>,
// так оплату видят все экраны без доработки, а деньги не задваиваются: сам аванс в payments
// не пишется. План пересчитывается целиком на каждом вызове — правка итога, оплата заказа
// напрямую, отмена заказа возвращают лишнее списание в остаток аванса.

export { ADVANCE_SOURCE }
const TOL = 0.5
const r2 = (v: number) => Math.round(v * 100) / 100
export const advanceKey = (advanceId: number, orderId: number) => `advance:${advanceId}:${orderId}`
const KEY = /^advance:(\d+):(\d+)$/
const isAdvanceKey = (k: string | null | undefined) => !!k && k.startsWith('advance:')
const ruDate = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`

export type Advance = { id: number; client_id: number; amount: number; received_at: string; applies_from: string }
// paid — уже пришло по заказу деньгами: без отметок «Оплачен» и без списаний авансов
export type AdvanceOrder = { id: number; launched: string; total: number; paid: number }

// Аванс за авансом (раньше полученный — первым), заказ за заказом в порядке запуска.
export function planAllocations(advances: Advance[], orders: AdvanceOrder[]): Map<string, number> {
  const plan = new Map<string, number>()
  const covered = new Map<number, number>()
  const advs = [...advances].sort((a, b) => a.received_at.localeCompare(b.received_at) || a.id - b.id)
  const ords = [...orders].sort((a, b) => a.launched.localeCompare(b.launched) || a.id - b.id)
  for (const a of advs) {
    let left = r2(a.amount)
    for (const o of ords) {
      if (left <= TOL) break
      if (o.launched < a.applies_from) continue
      const need = r2(o.total - o.paid - (covered.get(o.id) ?? 0))
      if (need <= TOL) continue
      const take = r2(Math.min(need, left))
      plan.set(advanceKey(a.id, o.id), take)
      covered.set(o.id, r2((covered.get(o.id) ?? 0) + take))
      left = r2(left - take)
    }
  }
  return plan
}

function notesStatus(raw: unknown): string | null {
  if (!raw) return null
  if (typeof raw === 'object') return ((raw as { status?: unknown }).status as string) ?? null
  try { return (JSON.parse(String(raw)) as { status?: string }).status ?? null } catch { return null }
}

const toAdvance = (a: Row): Advance => ({
  id: num(a.id), client_id: num(a.client_id), amount: num(a.amount),
  received_at: String(a.received_at).slice(0, 10), applies_from: String(a.applies_from).slice(0, 10),
})

export type AllocateResult = { written: number; voided: number; marksReplaced: number; warnings: string[] }

export async function allocateAdvances(svc: SupabaseClient, opts: { clientIds?: number[] } = {}): Promise<AllocateResult> {
  const out: AllocateResult = { written: 0, voided: 0, marksReplaced: 0, warnings: [] }
  const advRows = await readPaged(() => {
    const q = svc.from('client_advances').select('id, client_id, amount, received_at, applies_from').is('voided_at', null)
    return (opts.clientIds?.length ? q.in('client_id', opts.clientIds) : q).order('id')
  })
  const advances = advRows.map(toAdvance)
  if (advances.length === 0) return out
  const advIds = new Set(advances.map(a => a.id))

  const existing = await readPaged(() => svc.from('payments').select('id, external_key, amount')
    .eq('source', ADVANCE_SOURCE).is('voided_at', null).order('id'))
  const live = new Map<string, number>()
  for (const p of existing) {
    const m = KEY.exec(String(p.external_key ?? ''))
    if (m && advIds.has(Number(m[1]))) live.set(String(p.external_key), num(p.amount))
  }

  const clientIds = [...new Set(advances.map(a => a.client_id))]
  const fromBy = new Map<number, string>()
  for (const a of advances) if (!fromBy.has(a.client_id) || a.applies_from < fromBy.get(a.client_id)!) fromBy.set(a.client_id, a.applies_from)
  const orderRows = await readIn(clientIds, part => svc.from('b2b_orders')
    .select('id, client_id, launched_at, total_after_discount, total_sale_inc_vat, notes')
    .in('client_id', part).not('launched_at', 'is', null).is('archived_at', null).order('id'))
  const orders = orderRows
    .map(o => ({
      id: num(o.id), client_id: num(o.client_id), launched: String(o.launched_at).slice(0, 10),
      total: finalTotalOf(o as { total_after_discount?: number; total_sale_inc_vat?: number }),
      cancelled: notesStatus(o.notes) === 'cancelled',
    }))
    .filter(o => !o.cancelled && o.total > 0 && o.launched >= (fromBy.get(o.client_id) ?? '9999'))
  const orderById = new Map(orders.map(o => [o.id, o]))

  const paid = await loadOrderPaid(svc, new Map(orders.map(o => [o.id, o.total])), {
    skip: p => isAdvanceKey(p.external_key) || isTransferMark(p),
  })
  const plan = new Map<string, number>()
  for (const cid of clientIds) {
    const part = planAllocations(
      advances.filter(a => a.client_id === cid),
      orders.filter(o => o.client_id === cid).map(o => ({ id: o.id, launched: o.launched, total: o.total, paid: paid.get(o.id) ?? 0 })),
    )
    for (const [k, v] of part) plan.set(k, v)
  }

  // Счёт на один этот заказ — якорь списания: счёт становится «оплачен» вместе с заказом
  const touched = [...new Set([...plan.keys(), ...live.keys()].map(k => Number(KEY.exec(k)![2])))]
  const invRows = await readIn(touched, part => svc.from('invoices').select('id, order_ids')
    .overlaps('order_ids', part).neq('status', 'cancelled').order('id'))
  const ownInvoice = new Map<number, number>()
  for (const i of invRows) {
    const ids = Array.isArray(i.order_ids) ? (i.order_ids as unknown[]).map(Number) : []
    if (ids.length === 1) ownInvoice.set(ids[0], num(i.id))
  }
  const advById = new Map(advances.map(a => [a.id, a]))

  const paidOrders = new Set<number>()
  for (const [key, amount] of plan) {
    const [, a, o] = KEY.exec(key)!.map(Number)
    paidOrders.add(o)
    if (live.has(key) && Math.abs(live.get(key)! - amount) < 0.01) continue
    const adv = advById.get(a)!
    const ord = orderById.get(o)!
    const before = paid.get(o) ?? 0
    try {
      await recordPayment(svc, {
        externalKey: key, amount,
        paidAt: ord.launched > adv.received_at ? ord.launched : adv.received_at,
        kind: manualPaymentKind(before, amount, r2(ord.total - before)),
        source: ADVANCE_SOURCE, method: 'Перевод',
        b2bOrderId: o, invoiceId: ownInvoice.get(o) ?? null,
        note: `Списано с аванса от ${ruDate(adv.received_at)} (${fmtRub(adv.amount)})`,
      })
      out.written++
    } catch (e) {
      out.warnings.push(`Заказ ${String(o).padStart(5, '0')}: списание с аванса не записано — ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  for (const key of live.keys()) {
    if (plan.has(key)) continue
    try { await voidPayment(svc, key); out.voided++ } catch (e) {
      out.warnings.push(`Лишнее списание ${key} не снято — ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Деньги аванса заменяют отметку «Оплачен» переводом — как перевод из выписки (lib/payments/marks)
  const paidList = [...paidOrders]
  const invIds = paidList.map(o => ownInvoice.get(o)).filter((n): n is number => !!n)
  const [byOrder, byInvoice] = await Promise.all([
    readIn(paidList, part => svc.from('payments').select('id, external_key, source, method').in('b2b_order_id', part).is('voided_at', null).order('id')),
    readIn(invIds, part => svc.from('payments').select('id, external_key, source, method').in('invoice_id', part).is('voided_at', null).order('id')),
  ])
  const marks = new Map<string, Row>()
  for (const p of [...byOrder, ...byInvoice]) if (isTransferMark(p as { source?: string; method?: string })) marks.set(String(p.external_key), p)
  for (const key of marks.keys()) {
    try { await voidPayment(svc, key); out.marksReplaced++ } catch (e) {
      out.warnings.push(`Отметка «Оплачен» не снята — возможна переплата: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  for (const id of new Set(touched.map(o => ownInvoice.get(o)).filter((n): n is number => !!n))) {
    const st = await syncInvoiceStatus(svc, id)
    if (!st.ok) out.warnings.push(st.error)
  }
  return out
}

export type AdvanceSummary = {
  id: number; client: string; amount: number; used: number; left: number
  receivedAt: string; appliesFrom: string; orders: { id: number; no: string; amount: number }[]
}

// Для вкладки «Выписка»: у строки-аванса — сколько списано, на какие заказы, сколько осталось.
export async function loadAdvanceSummaries(svc: SupabaseClient, bankRowIds: number[]): Promise<Map<number, AdvanceSummary>> {
  const out = new Map<number, AdvanceSummary>()
  const advRows = await readIn(bankRowIds, part => svc.from('client_advances')
    .select('id, client_id, bank_row_id, amount, received_at, applies_from').in('bank_row_id', part).is('voided_at', null).order('id'))
  if (advRows.length === 0) return out
  const clientIds = [...new Set(advRows.map(a => num(a.client_id)))]
  const [clients, allocs] = await Promise.all([
    readIn(clientIds, part => svc.from('b2b_clients').select('id, name').in('id', part).order('id')),
    readPaged(() => svc.from('payments').select('id, external_key, amount, b2b_order_id').eq('source', ADVANCE_SOURCE).is('voided_at', null).order('id')),
  ])
  const nameBy = new Map(clients.map(c => [num(c.id), String(c.name ?? '')]))
  for (const a of advRows) {
    const id = num(a.id)
    const orders = allocs
      .filter(p => KEY.exec(String(p.external_key ?? ''))?.[1] === String(id))
      .map(p => ({ id: num(p.b2b_order_id), no: String(num(p.b2b_order_id)).padStart(5, '0'), amount: num(p.amount) }))
      .sort((x, y) => x.id - y.id)
    const used = r2(orders.reduce((s, o) => s + o.amount, 0))
    out.set(num(a.bank_row_id), {
      id, client: nameBy.get(num(a.client_id)) ?? `клиент #${num(a.client_id)}`,
      amount: num(a.amount), used, left: r2(num(a.amount) - used),
      receivedAt: String(a.received_at).slice(0, 10), appliesFrom: String(a.applies_from).slice(0, 10), orders,
    })
  }
  return out
}

type BankRowLite = { id: number; unit: string; op_date: string; amount: number; direction: string; inn?: string | null; payment_id?: number | null }

// Строка выписки → аванс клиента. Клиент — по ИНН плательщика, если не указан явно.
export async function createAdvance(svc: SupabaseClient, row: BankRowLite, input: {
  clientId?: number | null; appliesFrom?: string | null; me: { id: string | null; name: string | null }
}): Promise<{ ok: true; advanceId: number; allocated: AllocateResult } | { ok: false; status: number; error: string }> {
  if (row.direction !== 'in') return { ok: false, status: 400, error: 'Аванс — только приход' }
  if (row.payment_id) return { ok: false, status: 409, error: 'По строке уже проставлена оплата заказа — сначала снимите её' }
  const appliesFrom = input.appliesFrom ?? String(row.op_date).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appliesFrom)) return { ok: false, status: 400, error: 'Дата «списывать с заказов, запущенных с» — ГГГГ-ММ-ДД' }

  let clientId = Number(input.clientId) || 0
  if (!clientId) {
    const inn = String(row.inn ?? '').trim()
    if (!inn) return { ok: false, status: 400, error: 'В строке нет ИНН плательщика — укажите клиента' }
    const { data, error } = await svc.from('b2b_clients').select('id, name').eq('inn', inn)
    if (error) return { ok: false, status: 500, error: `Клиент не найден: ${error.message}` }
    if (!data?.length) return { ok: false, status: 404, error: `Клиента с ИНН ${inn} в B2B нет — впишите ИНН в карточку клиента` }
    if (data.length > 1) return { ok: false, status: 409, error: `ИНН ${inn} у нескольких клиентов (${data.map(c => c.name).join(', ')}) — укажите, чей аванс` }
    clientId = num(data[0].id)
  }

  const { data: ins, error } = await svc.from('client_advances').insert({
    client_id: clientId, unit: row.unit, bank_row_id: row.id, amount: num(row.amount),
    received_at: String(row.op_date).slice(0, 10), applies_from: appliesFrom,
    created_by: input.me.id, created_by_name: input.me.name,
  }).select('id').single()
  if (error) {
    return error.code === '23505'
      ? { ok: false, status: 409, error: 'Эта строка уже записана авансом' }
      : { ok: false, status: 500, error: `Аванс не записан: ${error.message}` }
  }
  const allocated = await allocateAdvances(svc, { clientIds: [clientId] })
  return { ok: true, advanceId: num((ins as { id: number }).id), allocated }
}

// Отменить аванс: списания снимаются, заказы снова ждут оплату.
export async function voidAdvance(svc: SupabaseClient, advanceId: number, me: { id: string | null }): Promise<{ ok: true; voided: number } | { ok: false; status: number; error: string }> {
  const { data, error } = await svc.from('client_advances').update({ voided_at: new Date().toISOString(), voided_by: me.id })
    .eq('id', advanceId).is('voided_at', null).select('id')
  if (error) return { ok: false, status: 500, error: `Аванс не отменён: ${error.message}` }
  if (!data?.length) return { ok: false, status: 404, error: 'Аванс не найден или уже отменён' }
  const allocs = await readPaged(() => svc.from('payments').select('id, external_key, invoice_id').eq('source', ADVANCE_SOURCE).is('voided_at', null).order('id'))
  const mine = allocs.filter(p => KEY.exec(String(p.external_key ?? ''))?.[1] === String(advanceId))
  for (const p of mine) await voidPayment(svc, String(p.external_key), me.id ?? undefined)
  for (const id of new Set(mine.map(p => num(p.invoice_id)).filter(n => n > 0))) await syncInvoiceStatus(svc, id)
  return { ok: true, voided: mine.length }
}
