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

const n = (v: unknown) => Number(v) || 0

export async function GET(req: NextRequest) {
  const guard = await requireRole([...ALLOWED])
  if (guard instanceof NextResponse) return guard

  const svc = createServiceClient()

  const idsParam = req.nextUrl.searchParams.get('ids')
  const ids = idsParam
    ? idsParam.split(',').map(Number).filter(Number.isFinite).slice(0, 2000)
    : null

  // Суммы заказов нужны и для раскладки счетов по долям, и для остатка.
  let ordersQ = svc.from('b2b_orders').select('id, total_after_discount, total_sale_inc_vat')
  if (ids && ids.length) ordersQ = ordersQ.in('id', ids)
  else ordersQ = ordersQ.is('archived_at', null).gte('created_at', '2026-01-01').limit(6000)
  const { data: orders } = await ordersQ

  const orderTotals = new Map<number, number>()
  for (const o of (orders ?? []) as Record<string, unknown>[]) {
    orderTotals.set(n(o.id), finalTotalOf(o as { total_after_discount?: number; total_sale_inc_vat?: number }))
  }
  const orderIds = [...orderTotals.keys()]
  if (orderIds.length === 0) return NextResponse.json({ paid: {} })

  // Платежи по этим заказам напрямую + платежи по счетам, куда эти заказы входят.
  const { data: directPayments } = await svc
    .from('payments')
    .select('amount, b2b_order_id, invoice_id, voided_at')
    .in('b2b_order_id', orderIds)
    .is('voided_at', null)

  // Счета, покрывающие эти заказы (для оплат, привязанных к счёту).
  const { data: invoices } = await svc
    .from('invoices')
    .select('id, order_ids, amount')
    .overlaps('order_ids', orderIds)

  const invoiceIds = ((invoices ?? []) as { id: number }[]).map(i => i.id)
  let invoicePayments: PaymentRow[] = []
  if (invoiceIds.length) {
    const { data } = await svc
      .from('payments')
      .select('amount, b2b_order_id, invoice_id, voided_at')
      .in('invoice_id', invoiceIds)
      .is('voided_at', null)
    invoicePayments = ((data ?? []) as Record<string, unknown>[]).map(p => ({
      amount: n(p.amount), b2b_order_id: p.b2b_order_id == null ? null : n(p.b2b_order_id),
      invoice_id: p.invoice_id == null ? null : n(p.invoice_id), voided_at: (p.voided_at as string | null) ?? null,
    }))
  }

  const allPayments: PaymentRow[] = [
    ...((directPayments ?? []) as Record<string, unknown>[]).map(p => ({
      amount: n(p.amount), b2b_order_id: p.b2b_order_id == null ? null : n(p.b2b_order_id),
      invoice_id: p.invoice_id == null ? null : n(p.invoice_id), voided_at: (p.voided_at as string | null) ?? null,
    })),
    // Только платежи по счетам, у которых нет прямой привязки к заказу (иначе задвоим).
    ...invoicePayments.filter(p => p.b2b_order_id == null),
  ]

  const invRows: InvoiceRow[] = ((invoices ?? []) as Record<string, unknown>[]).map(i => ({
    id: n(i.id), order_ids: Array.isArray(i.order_ids) ? (i.order_ids as unknown[]).map(Number) : null, amount: n(i.amount),
  }))

  const paidMap = paidByOrder(allPayments, invRows, orderTotals)
  const paid: Record<number, number> = {}
  for (const [id, amt] of paidMap) paid[id] = Math.round(amt)

  return NextResponse.json({ paid }, { headers: { 'Cache-Control': 'no-store' } })
}
