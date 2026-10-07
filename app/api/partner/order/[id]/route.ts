import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { resolvePartnerClient } from '@/lib/partnerClient'
import { paymentsEnabled } from '@/lib/payments/provider'
import { DEFAULT_WORKING_DAYS } from '@/lib/b2b/deadline'
import { partnerProgress, partnerDeadline } from '@/lib/partner/orderProgress'
import { loadInvoicedOrders, markedPaid } from '@/lib/partner/orderMoney'
import { invoiceState } from '@/lib/partner/documents'
import { pointStage } from '@/lib/partner/pointPay'
import { loadUpdIssued } from '@/lib/b2b/updRegistry'

// Карточка заказа для кабинета. СТРОГО по своему client_id. Отдаём только
// клиентское: позиции (материал/размер/кол-во/цена), стадии производства,
// срок, ссылку на чертёж. Никакой себестоимости/маржи.

function parseNotes(n: unknown): Record<string, unknown> {
  if (!n) return {}
  if (typeof n === 'object') return n as Record<string, unknown>
  try { const p = JSON.parse(String(n)); return typeof p === 'object' && p ? p as Record<string, unknown> : {} } catch { return {} }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const oid = Number(id)
  if (!oid) return NextResponse.json({ error: 'Плохой id' }, { status: 400 })

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const client = await resolvePartnerClient<{ id: number; name: string; full_name: string | null; inn: string | null; kpp: string | null; ogrn: string | null; legal_address: string | null; bank_account: string | null; bank_name: string | null; bik: string | null; corr_account: string | null; can_self_invoice: boolean | null; is_point: boolean | null }>(
    svc, user.id, 'id, name, full_name, inn, kpp, ogrn, legal_address, bank_account, bank_name, bik, corr_account, can_self_invoice, is_point')
  if (!client) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })

  const { data: o } = await svc.from('b2b_orders')
    .select('id, client_id, custom_number, client_order_number, created_at, launched_at, discount_percent, total_after_discount, total_sale_inc_vat, items, notes')
    .eq('id', oid).maybeSingle()
  if (!o || o.client_id !== client.id) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  const pn = parseNotes(o.notes)
  const p = partnerProgress({ launched_at: o.launched_at as string | null }, pn)
  const { lane, launched } = p

  const discount = Number(o.discount_percent) || 0
  const rawItems = Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : []
  const items = rawItems.map(it => {
    const sale = Number(it.saleIncVat ?? 0)
    const price = Number(it.manualTotal ?? Math.round(sale * (1 - discount / 100)))
    return {
      material: String(it.materialName ?? ''),
      thickness: Number(it.thickness ?? 0),
      width: Number(it.width ?? 0),
      height: Number(it.height ?? 0),
      quantity: Number(it.quantity ?? 0),
      tempering: !!it.hasTempering,
      facet: !!it.hasFacet,
      triplex: !!it.hasTriplex,
      price,
    }
  })

  // Срок — единый источник lib/b2b/deadline (та же норма, что launch-production).
  // Для запущенных — реальная дата; для незапущенных отдаём null (в кабинете показываем
  // ориентир «~N раб.дней после запуска» через estimateDays, а не фабрикованную дату).
  const deadline = launched ? partnerDeadline({ launched_at: o.launched_at as string | null, created_at: o.created_at as string }, pn).toISOString() : null

  const history = Array.isArray(pn.status_history) ? pn.status_history : []
  const drawingUrl = typeof pn.drawing_url === 'string' && pn.drawing_url ? `/api/b2b/drawing/${o.id}` : null
  const da = pn.drawing_approval as { status?: string; comment?: string | null; at?: string } | undefined
  const drawingApproval = da && (da.status === 'approved' || da.status === 'rework')
    ? { status: da.status as 'approved' | 'rework', comment: da.comment ?? null, at: da.at ?? null }
    : null
  const dl = pn.delivery as { method?: string; address?: string | null; comment?: string | null; status?: string | null } | undefined
  const delivery = dl && (dl.method === 'pickup' || dl.method === 'delivery')
    ? { method: dl.method as 'pickup' | 'delivery', address: dl.address ?? null, comment: dl.comment ?? null, status: dl.status ?? null }
    : null

  // Точка платит до запуска: счёт ей открыт, как только менеджер его выставил.
  const isPoint = client.is_point === true
  let invoiced = false
  if (isPoint) {
    try { invoiced = (await loadInvoicedOrders(svc, [oid])).has(oid) }
    catch (e) { return NextResponse.json({ error: `Реестр счетов не прочитан: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 }) }
  }
  const paid = markedPaid(pn)
  const point = pointStage({ isPoint, launched, submitted: lane === 'submitted', invoiced, paid })

  // paid — оплачен; awaiting — в работе/отгружен (или точка с выставленным счётом), а
  // оплата не отмечена; null — просчёт.
  const paymentStatus: 'paid' | 'awaiting' | null = paid ? 'paid' : (launched || point === 'await_payment' ? 'awaiting' : null)

  const canInvoice = invoiceState({ launched, canSelfInvoice: !!client.can_self_invoice, isPoint, invoiced }) === 'open'
  // УПД — только выданный документ (этап 7), и любому партнёру заказа: флаг — для счёта.
  const upd = await loadUpdIssued(svc, oid).catch(e => { console.error('[partner/order] УПД не прочитан:', oid, e instanceof Error ? e.message : e); return null })

  return NextResponse.json({
    id: o.id,
    number: (o.custom_number as string | null)?.trim() || `#${o.id}`,
    clientOrderNumber: (o.client_order_number as string | null) ?? null,
    clientName: client.name,
    buyer: {
      name: client.full_name || client.name,
      inn: client.inn ?? null, kpp: client.kpp ?? null, ogrn: client.ogrn ?? null,
      legalAddress: client.legal_address ?? null,
      bankAccount: client.bank_account ?? null, bankName: client.bank_name ?? null,
      bik: client.bik ?? null, corrAccount: client.corr_account ?? null,
    },
    created_at: o.created_at,
    lane,
    ready: p.ready,
    progressPct: p.progressPct,
    deadline,
    estimateDays: DEFAULT_WORKING_DAYS,
    paymentStatus,
    onlinePayEnabled: paymentStatus === 'awaiting' && paymentsEnabled(),
    canInvoice,
    point,
    updIssued: !!upd,
    upd: upd ? { number: upd.number, year: upd.year, docDate: upd.doc_date } : null,
    total: Number(o.total_after_discount ?? o.total_sale_inc_vat ?? 0),
    items,
    timeline: p.timeline,
    drawingUrl,
    drawingApproval,
    delivery,
    recalcNote: history.length > 0 ? ((pn.status_comment as string) || null) : null,
  })
}
