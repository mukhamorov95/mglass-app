import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { paidByOrder, type PaymentRow, type InvoiceRow } from '@/lib/b2b/orderPayments'
import { finalTotalOf } from '@/lib/b2b/priceOverride'

export const dynamic = 'force-dynamic'

// A23: сколько оплачено по заказам — из payments (единственный источник денег,
// не notes). Отдаём ТОЛЬКО суммы оплаты; себестоимость/маржа наружу не идут.
// Принимает ?ids=1,2,3 (заказы на экране); без ids — свежий срез.
const ALLOWED = ['admin', 'ceo', 'manager', 'commercial', 'buyer', 'cfo'] as const

// PostgREST отдаёт не больше 1000 строк за запрос, а заказов на экране у владельца больше
// (07.10 — 1213): без пачек молча терялись самые новые. Пачка по 500 id, и каждая ещё
// дочитывается страницами — платежей и счетов на 500 заказов может набраться за 1000.
const CHUNK = 500
const PAGE = 1000

type Row = Record<string, unknown>
type Paged = { range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> }

const n = (v: unknown) => Number(v) || 0

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// build() должен сортировать по уникальной колонке, иначе страницы range() перекрываются.
async function readPaged(build: () => Paged): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as Row[]))
    if ((data?.length ?? 0) < PAGE) return rows
  }
}

async function readIn(ids: number[], build: (part: number[]) => Paged): Promise<Row[]> {
  const parts = await Promise.all(chunk(ids, CHUNK).map(part => readPaged(() => build(part))))
  return parts.flat()
}

const toPayment = (p: Row): PaymentRow => ({
  amount: n(p.amount), b2b_order_id: p.b2b_order_id == null ? null : n(p.b2b_order_id),
  invoice_id: p.invoice_id == null ? null : n(p.invoice_id), voided_at: (p.voided_at as string | null) ?? null,
})

export async function GET(req: NextRequest) {
  const guard = await requireRole([...ALLOWED])
  if (guard instanceof NextResponse) return guard

  const svc = createServiceClient()

  const idsParam = req.nextUrl.searchParams.get('ids')
  const ids = idsParam
    ? [...new Set(idsParam.split(',').map(Number).filter(Number.isFinite))].slice(0, 2000)
    : null

  try {
    // Суммы заказов нужны и для раскладки счетов по долям, и для остатка.
    const orders = ids && ids.length
      ? await readIn(ids, part => svc.from('b2b_orders').select('id, total_after_discount, total_sale_inc_vat').in('id', part).order('id'))
      : await readPaged(() => svc.from('b2b_orders').select('id, total_after_discount, total_sale_inc_vat')
        .is('archived_at', null).gte('created_at', '2026-01-01').order('id'))

    const orderTotals = new Map<number, number>()
    for (const o of orders) {
      orderTotals.set(n(o.id), finalTotalOf(o as { total_after_discount?: number; total_sale_inc_vat?: number }))
    }
    const orderIds = [...orderTotals.keys()]
    if (orderIds.length === 0) return NextResponse.json({ paid: {} })

    // Платежи по этим заказам напрямую + счета, куда эти заказы входят (для оплат, привязанных к счёту).
    const [directPayments, invoiceParts] = await Promise.all([
      readIn(orderIds, part => svc.from('payments').select('id, amount, b2b_order_id, invoice_id, voided_at')
        .in('b2b_order_id', part).is('voided_at', null).order('id')),
      readIn(orderIds, part => svc.from('invoices').select('id, order_ids, amount').overlaps('order_ids', part).order('id')),
    ])

    // Счёт на заказы из разных пачек приходит в каждую из них: без склейки по id его оплата
    // попала бы в две пачки invoice_id и засчиталась дважды.
    const invoicesById = new Map<number, Row>()
    for (const i of invoiceParts) invoicesById.set(n(i.id), i)
    const invoiceIds = [...invoicesById.keys()]

    const invoicePayments = invoiceIds.length
      ? (await readIn(invoiceIds, part => svc.from('payments').select('id, amount, b2b_order_id, invoice_id, voided_at')
        .in('invoice_id', part).is('voided_at', null).order('id'))).map(toPayment)
      : []

    const allPayments: PaymentRow[] = [
      ...directPayments.map(toPayment),
      // Только платежи по счетам, у которых нет прямой привязки к заказу (иначе задвоим).
      ...invoicePayments.filter(p => p.b2b_order_id == null),
    ]

    const invRows: InvoiceRow[] = [...invoicesById.values()].map(i => ({
      id: n(i.id), order_ids: Array.isArray(i.order_ids) ? (i.order_ids as unknown[]).map(Number) : null, amount: n(i.amount),
    }))

    const paidMap = paidByOrder(allPayments, invRows, orderTotals)
    const paid: Record<number, number> = {}
    for (const [id, amt] of paidMap) paid[id] = Math.round(amt)

    return NextResponse.json({ paid }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
