import { NextRequest, NextResponse } from 'next/server'
import { requirePageAccess } from '@/lib/apiAuth'
import { getSessionUser, getUserProfile } from '@/lib/getRole'
import { serviceAsMe } from '@/lib/serviceAs'
import { createServiceClient } from '@/lib/supabase-service'
import { paidByOrder, type InvoiceRow, type PaymentRow } from '@/lib/b2b/orderPayments'
import { isDayKey, presetPeriod } from '@/lib/b2b/clientReport'
import { isShipped } from '@/lib/b2b/todayPriorities'
import { isLaunched as isLiveLaunched, orderAmount } from '@/lib/liveOrders'
import { isTransferMark } from '@/lib/payments/marks'
import { SHOWER_GLASS, orderShipState, shareOf, shipLines, type EarlierLines, type ShipOrder } from '@/lib/production/clientShipments'
import { buildReconciliation, paymentCountsAsMoney, type ReconMoney, type ReconOrder } from '@/lib/production/clientReconciliation'
import { readIn, readPaged } from '@/lib/production/paged'
import { mskDayKey } from '@/lib/time'

// Акт сверки: чтение и запись только здесь и только тем, кому положено видеть деньги. Себестоимости в ответе нет.
// Клиент пока один, расчёт от него не зависит: другого клиента добавит одна строка.

const PAGE = '/production-app/shower-glass'
const CLIENT = { id: SHOWER_GLASS.clientId, name: SHOWER_GLASS.title }
const BANK_UNIT = 'ooo'  // производство работает через ООО

type Svc = ReturnType<typeof createServiceClient>
type RawOrder = ShipOrder & { id: number; custom_number: string | null; notes: string | null; launched_at: string | null; archived_at: string | null }
type Notes = { launched_at?: string | null; stages?: Record<string, unknown>; shipped_earlier?: { lines?: EarlierLines } | null }
type Payment = PaymentRow & { id: number; paid_at: string; source: string | null; method: string | null }
type BankRow = { id: number; op_date: string; amount: number; direction: string; payment_id: number | null }

function notesOf(raw: string | null): Notes {
  try { return raw ? JSON.parse(raw) as Notes : {} } catch { return {} }
}
function dayOf(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const t = new Date(v)
  return Number.isNaN(t.getTime()) ? null : mskDayKey(t)
}

async function loadDoc(svc: Svc, from: string, to: string) {
  const raw = await readPaged<RawOrder>((a, b) => svc.from('b2b_orders')
    .select('id, custom_number, items, notes, launched_at, archived_at, discount_percent, total_after_discount, total_sale_inc_vat')
    .eq('client_id', CLIENT.id).order('id', { ascending: true }).range(a, b) as never)
  const ids = raw.map(o => o.id)

  const items = await readIn<{ shipment_id: number; order_id: number; line_key: string; qty: number; amount: number | null }, number>(ids, (part, a, b) =>
    svc.from('delivery_shipment_items').select('shipment_id, order_id, line_key, qty, amount').in('order_id', part).range(a, b) as never)
  const heads = await readIn<{ id: number; ship_date: string | null }, number>([...new Set(items.map(i => i.shipment_id))], (part, a, b) =>
    svc.from('delivery_shipments').select('id, ship_date').eq('status', 'shipped').in('id', part).range(a, b) as never)
  const shipDay = new Map(heads.map(h => [h.id, h.ship_date]))
  const sent = items.filter(i => shipDay.has(i.shipment_id))

  const invoices = await readPaged<InvoiceRow>((a, b) => svc.from('invoices').select('id, order_ids, amount').overlaps('order_ids', ids).range(a, b) as never)
  const cols = 'id, amount, b2b_order_id, invoice_id, voided_at, paid_at, source, method'
  const [direct, viaInvoice] = await Promise.all([
    readIn<Payment, number>(ids, (part, a, b) => svc.from('payments').select(cols).is('voided_at', null).in('b2b_order_id', part).range(a, b) as never),
    readIn<Payment, number>(invoices.map(i => i.id), (part, a, b) => svc.from('payments').select(cols).is('voided_at', null).in('invoice_id', part).range(a, b) as never),
  ])
  const payments = [...new Map([...direct, ...viaInvoice].map(p => [p.id, p])).values()]

  const { data: card, error: cardErr } = await svc.from('b2b_clients').select('inn').eq('id', CLIENT.id).maybeSingle()
  if (cardErr) throw new Error(cardErr.message)
  const { data: ents, error: entErr } = await svc.from('b2b_client_legal_entities').select('inn').eq('client_id', CLIENT.id)
  if (entErr) throw new Error(entErr.message)
  const inns = [...new Set([(card as { inn: string | null } | null)?.inn, ...((ents ?? []) as { inn: string | null }[]).map(e => e.inn)].filter((v): v is string => !!v))]
  const bankCols = 'id, op_date, amount, direction, payment_id'
  const [byInn, byPayment] = await Promise.all([
    readIn<BankRow, string>(inns, (part, a, b) => svc.from('bank_statement_rows').select(bankCols).in('inn', part).range(a, b) as never),
    readIn<BankRow, number>(payments.map(p => p.id), (part, a, b) => svc.from('bank_statement_rows').select(bankCols).in('payment_id', part).range(a, b) as never),
  ])
  const bankRows = [...new Map([...byInn, ...byPayment].map(r => [r.id, r])).values()]
  const edge = async (ascending: boolean) => {
    const { data, error } = await svc.from('bank_statement_rows').select('op_date').eq('unit', BANK_UNIT).order('op_date', { ascending }).limit(1)
    if (error) throw new Error(error.message)
    return (data?.[0] as { op_date: string } | undefined)?.op_date ?? null
  }
  const [bankFrom, bankTo] = await Promise.all([edge(true), edge(false)])

  const totals = new Map(raw.map(o => [o.id, orderAmount(o as never)]))
  const paymentsByOrder = new Map<number, { day: string; amount: number }[]>()
  for (const p of payments) {
    for (const [orderId, amount] of paidByOrder([p], invoices, totals)) {
      paymentsByOrder.set(orderId, [...(paymentsByOrder.get(orderId) ?? []), { day: p.paid_at, amount }])
    }
  }

  const orders: ReconOrder[] = raw.map(o => {
    const notes = notesOf(o.notes)
    const lines = shipLines(o)
    const events = sent.filter(i => i.order_id === o.id).map(i => ({ day: shipDay.get(i.shipment_id) ?? null, amount: Number(i.amount ?? 0), pieces: i.qty }))
    const earlier = Object.entries(notes.shipped_earlier?.lines ?? {}).flatMap(([key, qty]) => {
      const line = lines.find(l => l.key === key)
      return line && qty > 0 ? [{ day: null, amount: shareOf(line.amount, line.qty, 0, qty), pieces: qty }] : []
    })
    const shippedOf = (key: string) => sent.filter(i => i.order_id === o.id && i.line_key === key).reduce((n, i) => n + i.qty, 0) + (notes.shipped_earlier?.lines?.[key] ?? 0)
    const marked = isShipped(notes as Parameters<typeof isShipped>[0])
    const allEvents = [...events, ...earlier]
    const wholeByLines = orderShipState(lines, shippedOf) === 'full'
    const lastDay = events.map(e => e.day).filter((d): d is string => !!d).sort().pop() ?? null
    const launchDay = dayOf(o.launched_at ?? notes.launched_at)
    return {
      id: o.id, no: o.custom_number?.trim() || `00${o.id}`, launchDay,
      live: isLiveLaunched({ archived_at: o.archived_at, launched_at: o.launched_at }),
      amount: totals.get(o.id) ?? 0,
      pieces: lines.reduce((n, l) => n + l.qty, 0),
      full: marked ? { day: dayOf(notes.stages?.shipped) } : wholeByLines ? { day: lastDay } : null,
      events: allEvents,
      payments: paymentsByOrder.get(o.id) ?? [],
    }
  })

  const linked = new Set(bankRows.map(r => r.payment_id).filter((v): v is number => v != null))
  const money: ReconMoney[] = [
    ...bankRows.map(r => ({ day: r.op_date, amount: r.direction === 'out' ? -Number(r.amount) : Number(r.amount), source: 'bank' as const })),
    ...payments.filter(p => paymentCountsAsMoney({ source: p.source, method: p.method, paid_at: p.paid_at, linkedToBank: linked.has(p.id) }, bankFrom, bankTo, isTransferMark))
      .map(p => ({ day: p.paid_at, amount: Number(p.amount), source: 'mark' as const })),
  ]
  const ledgerFrom = heads.map(h => h.ship_date).filter((d): d is string => !!d).sort()[0] ?? null
  return buildReconciliation({ clientName: CLIENT.name, from, to, orders, money, bankFrom, bankTo, ledgerFrom })
}

async function history(svc: Svc) {
  const { data, error } = await svc.from('client_reconciliations')
    .select('id, date_from, date_to, created_at, created_by_name, closing_items:snapshot->items->>closing, closing_whole:snapshot->whole->>closing')
    .eq('client_id', CLIENT.id).order('id', { ascending: false }).limit(200)
  if (error) throw new Error(error.message)
  return data ?? []
}

async function guardMoney() {
  const guard = await requirePageAccess(PAGE)
  if (guard instanceof NextResponse) return guard
  const profile = await getUserProfile()
  if (profile?.canViewMoney !== true) return NextResponse.json({ error: 'Акт сверки видят те, кому открыты деньги.' }, { status: 403 })
  return null
}

export async function GET(req: NextRequest) {
  const denied = await guardMoney()
  if (denied) return denied
  const svc = createServiceClient()
  const url = new URL(req.url)
  try {
    const id = Number(url.searchParams.get('id'))
    if (id > 0) {
      const { data, error } = await svc.from('client_reconciliations').select('id, snapshot, created_at, created_by_name').eq('id', id).eq('client_id', CLIENT.id).maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) return NextResponse.json({ error: 'Такого акта нет.' }, { status: 404 })
      return NextResponse.json(data)
    }
    const today = mskDayKey()
    const fallback = presetPeriod('month', today)
    const from = url.searchParams.get('from') ?? fallback.from
    const to = url.searchParams.get('to') ?? fallback.to
    if (!isDayKey(from) || !isDayKey(to) || from > to) return NextResponse.json({ error: 'Проверьте даты периода.' }, { status: 400 })
    const [doc, list] = await Promise.all([loadDoc(svc, from, to), history(svc)])
    return NextResponse.json({ today, doc, history: list })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Ошибка загрузки' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const denied = await guardMoney()
  if (denied) return denied
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { action?: string; from?: string; to?: string; id?: number }
  const svc = await serviceAsMe()
  try {
    if (body.action === 'save') {
      if (!isDayKey(body.from) || !isDayKey(body.to) || body.from > body.to) return NextResponse.json({ error: 'Проверьте даты периода.' }, { status: 400 })
      const doc = await loadDoc(svc as unknown as Svc, body.from, body.to)
      const { data: prof } = await svc.from('users').select('name').eq('id', user.id).maybeSingle()
      const { data, error } = await svc.from('client_reconciliations').insert({
        client_id: CLIENT.id, date_from: body.from, date_to: body.to, snapshot: doc, created_by: user.id,
        created_by_name: (prof as { name: string | null } | null)?.name ?? user.email ?? null,
      }).select('id').single()
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true, id: (data as { id: number }).id })
    }
    if (body.action === 'delete') {
      const { data, error } = await svc.from('client_reconciliations').delete().eq('id', Number(body.id)).eq('client_id', CLIENT.id).select('id')
      if (error) throw new Error(error.message)
      if (!data?.length) return NextResponse.json({ error: 'Такого акта нет.' }, { status: 404 })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Ошибка записи' }, { status: 500 })
  }
}
