import type { SupabaseClient } from '@supabase/supabase-js'
import { finalTotalOf } from '@/lib/b2b/priceOverride'
import { mskDayKey } from '@/lib/time'
import { readPaged, readIn, num } from './paged'
import { loadOrderPaid } from './orderPaid'
import { computeReceivables, RECEIVABLES_SINCE, type RecOrder, type Receivables } from './receivables'

// Серверная сборка долга клиентов (lib/money/receivables): заказы, платежи и счета —
// постранично, мимо потолка 1000 строк. Только service-role после проверки роли.

const COLS = 'id, custom_number, client_id, client_name, launched_at, total_after_discount, total_sale_inc_vat, notes'

export async function loadReceivables(svc: SupabaseClient, opts: { today?: string; since?: string } = {}): Promise<Receivables> {
  const today = opts.today ?? mskDayKey()
  const since = opts.since ?? RECEIVABLES_SINCE
  // launched_at — timestamptz; день запуска считаем по Москве, поэтому берём с запасом в сутки.
  const from = new Date(Date.parse(since + 'T00:00:00Z') - 86_400_000).toISOString()
  const rows = await readPaged(() => svc.from('b2b_orders').select(COLS)
    .is('archived_at', null).not('launched_at', 'is', null).gte('launched_at', from).order('id'))
  const orders = rows as unknown as RecOrder[]

  const totals = new Map(orders.map(o => [num(o.id), finalTotalOf(o)]))
  const paid = await loadOrderPaid(svc, totals)

  // Номер действующего счёта по заказу — чтобы видеть «запущен, а счёта нет».
  const invoices = await readIn([...totals.keys()], part => svc.from('invoices')
    .select('id, invoice_no, order_ids').overlaps('order_ids', part).neq('status', 'cancelled').order('id'))
  const invoiceNoByOrder = new Map<number, string>()
  for (const inv of invoices) {
    for (const oid of (inv.order_ids as number[] | null) ?? []) invoiceNoByOrder.set(Number(oid), String(inv.invoice_no ?? inv.id))
  }

  return computeReceivables(orders, paid, { today, since, invoiceNoByOrder })
}
