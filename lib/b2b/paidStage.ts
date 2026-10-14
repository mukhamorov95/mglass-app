import type { SupabaseClient } from '@supabase/supabase-js'
import { loadOrderPaid } from '@/lib/money/orderPaid'
import { readIn, readPaged, num } from '@/lib/money/paged'
import { isTransferMark, ADVANCE_SOURCE } from '@/lib/payments/marks'
import { finalTotalOf } from '@/lib/b2b/priceOverride'

// Банк подтвердил оплату — этап «Оплачен» в заказе ставится сам, датой денег: дата перевода
// из выписки или списания с аванса. 14.10 владелец: у ShowerGlass «Оплачен · банк» стоял, а
// этап жали руками, и дата была днём нажатия (14.10 при деньгах 09.10).
// Пишет то же, что кнопка «Оплачен» (/api/b2b-orders/[id]/payment): payment_status и
// stages.invoice_paid; продажу в ведомость с этой датой дописывает ночная сверка.
// payment_source помечает, что этап поставили деньги: снимут платёж — этап снимется сам,
// а отметку, поставленную человеком, синхронизация не трогает.

const BANK_SOURCE = 'bank_statement_import'
const EPS = 1

type Notes = { payment_status?: string | null; payment_source?: string | null; stages?: { invoice_paid?: string | null } }
function parse(raw: unknown): Notes {
  if (!raw) return {}
  if (typeof raw === 'object') return raw as Notes
  try { return JSON.parse(String(raw)) as Notes } catch { return {} }
}

export type PaidStageChange = { orderId: number; from: string | null; to: string | null }

// Что сделать с этапом заказа. date — последняя дата денег из банка/аванса по заказу.
export function paidStageChange(
  n: Notes, input: { total: number; paid: number; date: string | null; source: 'bank' | 'advance' | null },
): { stage: string | null; status: string | null; source: string | null } | null {
  const covered = input.total > 0 && input.paid >= input.total - EPS && !!input.date
  const current = n.stages?.invoice_paid ?? null
  if (covered) {
    if (current === input.date && n.payment_status === 'paid' && n.payment_source === input.source) return null
    return { stage: input.date, status: 'paid', source: input.source }
  }
  // Деньгами больше не покрыт: снимаем только то, что сами поставили
  if (n.payment_source && current) return { stage: null, status: null, source: null }
  return null
}

export async function syncPaidStages(svc: SupabaseClient, opts: { paidSince?: string; orderIds?: number[] } = {}): Promise<{
  changed: PaidStageChange[]; warnings: string[]
}> {
  const out = { changed: [] as PaidStageChange[], warnings: [] as string[] }
  // Все живые деньги (отметки «Оплачен» переводом — заявления, не деньги): заказ, который
  // добили наличными после перевода, оплачен днём наличных
  const pays = (await readPaged(() => {
    let q = svc.from('payments').select('id, b2b_order_id, invoice_id, paid_at, source, method').is('voided_at', null)
    if (opts.paidSince) q = q.gte('paid_at', opts.paidSince)
    return q.order('id')
  })).filter(p => !isTransferMark(p as { source?: string | null; method?: string | null }) && (p.b2b_order_id != null || p.invoice_id != null))
  const invIds = [...new Set(pays.filter(p => p.b2b_order_id == null).map(p => num(p.invoice_id)))]
  const invoices = await readIn(invIds, part => svc.from('invoices').select('id, order_ids').in('id', part).order('id'))
  const ordersOf = new Map(invoices.map(i => [num(i.id), Array.isArray(i.order_ids) ? (i.order_ids as unknown[]).map(Number) : []]))

  // Этап ведут только заказы, где есть деньги выписки или аванса; дата — последний платёж любого вида
  const last = new Map<number, { date: string; source: 'bank' | 'advance' | null }>()
  for (const p of pays) {
    const ids = p.b2b_order_id != null ? [num(p.b2b_order_id)] : ordersOf.get(num(p.invoice_id)) ?? []
    const date = String(p.paid_at).slice(0, 10)
    const source = p.source === ADVANCE_SOURCE ? 'advance' as const : p.source === BANK_SOURCE ? 'bank' as const : null
    for (const id of ids) {
      const had = last.get(id)
      last.set(id, { date: !had || date > had.date ? date : had.date, source: source ?? had?.source ?? null })
    }
  }
  for (const [id, v] of last) if (!v.source) last.delete(id)

  // Заказы, где этап поставили деньги, — проверить, что деньги ещё на месте
  const marked = await readPaged(() => svc.from('b2b_orders').select('id, notes')
    .like('notes', '%payment_source%').order('id'))
  let ids = [...new Set([...last.keys(), ...marked.filter(o => !!parse(o.notes).payment_source).map(o => num(o.id))])]
  if (opts.orderIds) { const want = new Set(opts.orderIds); ids = ids.filter(id => want.has(id)) }
  if (ids.length === 0) return out

  const orders = await readIn(ids, part => svc.from('b2b_orders')
    .select('id, total_after_discount, total_sale_inc_vat, notes').in('id', part).order('id'))
  const totals = new Map(orders.map(o => [num(o.id), finalTotalOf(o as { total_after_discount?: number; total_sale_inc_vat?: number })]))
  // Деньги — без отметок «Оплачен» переводом: их ставили люди, а этап здесь — по факту
  const paid = await loadOrderPaid(svc, totals, { skip: p => isTransferMark(p) })

  for (const o of orders) {
    const id = num(o.id)
    const n = parse(o.notes)
    const money = last.get(id) ?? null
    const ch = paidStageChange(n, { total: totals.get(id) ?? 0, paid: paid.get(id) ?? 0, date: money?.date ?? null, source: money?.source ?? null })
    if (!ch) continue
    const { error: e1 } = await svc.rpc('patch_order_notes_shallow', { p_order_id: id, p_patch: {
      payment_status: ch.status, payment_source: ch.source, ...(ch.status === 'paid' ? { prepayment_amount: null } : {}),
    } })
    const { error: e2 } = e1 ? { error: null } : await svc.rpc('mark_order_stages', { p_order_id: id, p_stages: { invoice_paid: ch.stage } })
    const err = e1 ?? e2
    if (err) { out.warnings.push(`Заказ ${String(id).padStart(5, '0')}: этап «Оплачен» не записан — ${err.message}`); continue }
    out.changed.push({ orderId: id, from: n.stages?.invoice_paid ?? null, to: ch.stage })
  }
  return out
}

// Для маршрутов, которые только что записали деньги: свежие платежи за 90 дней
export const recentPaidSince = () => new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10)
