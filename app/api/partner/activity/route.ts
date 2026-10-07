import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { resolvePartnerClient } from '@/lib/partnerClient'
import { chunk, readPaged } from '@/lib/partner/readPaged'
import { buildEvents, waitingActions, WAITING_RECENT_DAYS, type ActivityOrder, type DocEvent, type PaymentEvent } from '@/lib/partner/activity'
import { decisionOf, drawingUploadedAt, isDecisionStale } from '@/lib/partner/drawingApproval'
import { loadUpdByOrders } from '@/lib/partner/updByOrders'
import { loadInvoicedOrders, loadPaidByOrders, paymentView } from '@/lib/partner/orderMoney'
import { pointStage } from '@/lib/partner/pointPay'
import { partnerProgress } from '@/lib/partner/orderProgress'

// Табло: последние реальные события по заказам (отметки цеха, оплаты, счета, УПД) и
// «Ждут вашего действия». Строго по своему клиенту; суммы — только оплаты партнёра.

type Row = Record<string, unknown>

function parseNotes(n: unknown): Record<string, unknown> {
  if (!n) return {}
  if (typeof n === 'object') return n as Record<string, unknown>
  try { const p = JSON.parse(String(n)); return typeof p === 'object' && p ? p as Record<string, unknown> : {} } catch { return {} }
}

const MAX_DRAWING_CHECKS = 20

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const client = await resolvePartnerClient<{ id: number; is_point: boolean | null }>(svc, user.id, 'id,is_point')
  if (!client) return NextResponse.json({ linked: false, events: [], waiting: [] })

  try {
    const rows = await readPaged<Row>(() => svc.from('b2b_orders')
      .select('id, custom_number, created_at, launched_at, total_after_discount, total_sale_inc_vat, notes')
      .eq('client_id', client.id).is('archived_at', null).order('id'))
    const orders: (ActivityOrder & { total: number })[] = rows.map(o => ({
      id: Number(o.id),
      number: (o.custom_number as string | null)?.trim() || `#${o.id}`,
      created_at: o.created_at as string,
      launched_at: (o.launched_at as string | null) ?? null,
      notes: parseNotes(o.notes),
      total: Number(o.total_after_discount ?? o.total_sale_inc_vat ?? 0) || 0,
    }))
    const ids = orders.map(o => o.id)
    const own = new Set(ids)

    // Оплаты: прямые по заказу и по счёту, все заказы которого — этого клиента.
    const [direct, invoiceRows, upds] = await Promise.all([
      Promise.all(chunk(ids, 500).map(part => readPaged<Row>(() => svc.from('payments')
        .select('id, amount, paid_at, created_at, b2b_order_id').in('b2b_order_id', part).is('voided_at', null).order('id')))).then(x => x.flat()),
      Promise.all(chunk(ids, 500).map(part => readPaged<Row>(() => svc.from('invoices')
        .select('id, invoice_no, order_ids, status, issued_at, created_at').overlaps('order_ids', part).order('id')))).then(x => x.flat()),
      // Реестр УПД не прочитался — лента без событий УПД, остальное показываем.
      loadUpdByOrders(svc, ids).catch(e => { console.error('[partner/activity] реестр УПД:', e instanceof Error ? e.message : e); return new Map() as Awaited<ReturnType<typeof loadUpdByOrders>> }),
    ])
    const invoices = new Map<number, Row>()
    for (const i of invoiceRows) {
      const oids = Array.isArray(i.order_ids) ? (i.order_ids as unknown[]).map(Number) : []
      if (i.status !== 'cancelled' && oids.length && oids.every(id => own.has(id))) invoices.set(Number(i.id), i)
    }
    const viaInvoice = invoices.size
      ? (await Promise.all(chunk([...invoices.keys()], 500).map(part => readPaged<Row>(() => svc.from('payments')
        .select('id, amount, paid_at, created_at, b2b_order_id, invoice_id').in('invoice_id', part).is('voided_at', null).order('id'))))).flat()
        .filter(p => p.b2b_order_id == null)
      : []

    const payments: PaymentEvent[] = [
      ...direct.map(p => ({ orderId: Number(p.b2b_order_id), amount: Number(p.amount) || 0, paidAt: String(p.paid_at ?? p.created_at ?? '') })),
      ...viaInvoice.map(p => ({
        orderId: Number((invoices.get(Number(p.invoice_id))?.order_ids as unknown[])[0]),
        amount: Number(p.amount) || 0, paidAt: String(p.paid_at ?? p.created_at ?? ''),
      })),
    ].filter(p => p.amount > 0)

    const docs: DocEvent[] = []
    for (const i of invoices.values()) {
      const at = String(i.issued_at ?? i.created_at ?? '')
      for (const oid of (i.order_ids as unknown[]).map(Number)) docs.push({ orderId: oid, at, text: `Выставлен счёт № ${i.invoice_no}` })
    }
    for (const [oid, u] of upds) docs.push({ orderId: oid, at: u.docDate, text: `Выдан УПД № ${u.number}` })

    // Чертёж без действующего решения: решения нет, или после него загрузили новый файл.
    const now = Date.now()
    const drawingOpen = new Set<number>()
    let checks = 0
    for (const o of orders) {
      const url = typeof o.notes.drawing_url === 'string' ? o.notes.drawing_url : ''
      if (!url) continue
      const d = decisionOf(o.notes.drawing_approval)
      if (!d) { drawingOpen.add(o.id); continue }
      const since = Date.parse(String(o.launched_at ?? o.created_at))
      const p = partnerProgress({ launched_at: o.launched_at }, o.notes)
      if (p.lane === 'shipped' || p.progressPct > 0 || !Number.isFinite(since) || (now - since) / 86_400_000 > WAITING_RECENT_DAYS) continue
      if (checks++ >= MAX_DRAWING_CHECKS) break
      if (isDecisionStale(d, await drawingUploadedAt(svc, url))) drawingOpen.add(o.id)
    }

    // Точка: «Ждём вашей оплаты» — те же правила, что в списке заказов.
    const isPoint = client.is_point === true
    let invoiced = new Set<number>()
    let paid = new Map<number, number>()
    if (isPoint) {
      const notLaunched = orders.filter(o => !partnerProgress({ launched_at: o.launched_at }, o.notes).launched).map(o => o.id)
      const [inv, pd] = await Promise.all([loadInvoicedOrders(svc, notLaunched), loadPaidByOrders(svc, notLaunched)])
      invoiced = inv
      paid = pd
    }
    const byId = new Map(orders.map(o => [o.id, o]))
    const waiting = waitingActions(orders, {
      now,
      drawingOpen: o => drawingOpen.has(o.id),
      point: o => {
        if (!isPoint) return null
        const p = partnerProgress({ launched_at: o.launched_at }, o.notes)
        const full = byId.get(o.id)!
        return pointStage({
          isPoint, launched: p.launched, submitted: p.lane === 'submitted', invoiced: invoiced.has(o.id),
          paid: paymentView({ total: full.total, paidFromPayments: paid.get(o.id) ?? 0, notes: o.notes, due: true })?.status === 'paid',
        })
      },
    })

    return NextResponse.json({ linked: true, events: buildEvents(orders, payments, docs), waiting })
  } catch (e) {
    return NextResponse.json({ error: `События не загрузились: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}
