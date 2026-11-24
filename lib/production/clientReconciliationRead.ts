import { billableTotal, ownCostRemakeOf } from '@/lib/b2b/ownCostRemake'
import { createServiceClient } from '@/lib/supabase-service'
import { paidByOrder, type InvoiceRow, type PaymentRow } from '@/lib/b2b/orderPayments'
import { isShipped } from '@/lib/b2b/todayPriorities'
import { isLaunched as isLiveLaunched, orderAmount } from '@/lib/liveOrders'
import { isTransferMark } from '@/lib/payments/marks'
import { SHOWER_GLASS, orderShipState, shareOf, shipLines, type EarlierLines, type ShipOrder } from '@/lib/production/clientShipments'
import { buildReconciliation, paymentCountsAsMoney, type ReconMoney, type ReconOrder } from '@/lib/production/clientReconciliation'
import { readIn, readPaged } from '@/lib/production/paged'
import { mskDayKey } from '@/lib/time'
import { settledBeforeOf } from '@/lib/b2b/settledBefore'

// Чтение акта сверки — одна функция для цеха и кабинета партнёра. Проверка роли — у вызывающего.

// settledBefore: заказы старше акта бухгалтера (он начат с этой даты) закрыты. Оплат тех месяцев в приложении нет,
// и 10 таких заказов показывали клиента должником на 276 333 ₽, хотя по акту на эту дату остатка нет.
export const CLIENT = { id: SHOWER_GLASS.clientId, name: SHOWER_GLASS.title, settledBefore: settledBeforeOf(SHOWER_GLASS.clientId)! }
const BANK_UNIT = 'ooo'  // производство работает через ООО

export type Svc = ReturnType<typeof createServiceClient>
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

export async function loadDoc(svc: Svc, from: string, to: string) {
  const all = await readPaged<RawOrder>((a, b) => svc.from('b2b_orders')
    .select('id, custom_number, items, notes, launched_at, archived_at, discount_percent, total_after_discount, total_sale_inc_vat')
    .eq('client_id', CLIENT.id).order('id', { ascending: true }).range(a, b) as never)
  // Архив не считаем: 30.06 туда ушли дубли импортированной истории, отмеченные отгруженными, и клиент выходил должником на 800 тысяч.
  const launchOf = (o: RawOrder) => dayOf(o.launched_at ?? notesOf(o.notes).launched_at)
  const isSettled = (o: RawOrder) => { const d = launchOf(o); return !!d && d < CLIENT.settledBefore }
  const settled = all.filter(o => !o.archived_at && isSettled(o))
  const raw = all.filter(o => !o.archived_at && !isSettled(o))
  const inArchive = all.filter(o => o.archived_at)
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

  // Заказ за счёт M GLASS клиенту не выставляется: в акте он с нулём, отгрузки по нему — тоже.
  const totals = new Map(raw.map(o => [o.id, billableTotal(orderAmount(o as never), o.notes)]))
  const ownCost = new Set(raw.filter(o => ownCostRemakeOf(o.notes)).map(o => o.id))
  const paymentsByOrder = new Map<number, { day: string; amount: number }[]>()
  for (const p of payments) {
    for (const [orderId, amount] of paidByOrder([p], invoices, totals)) {
      paymentsByOrder.set(orderId, [...(paymentsByOrder.get(orderId) ?? []), { day: p.paid_at, amount }])
    }
  }

  const orders: ReconOrder[] = raw.map(o => {
    const notes = notesOf(o.notes)
    const lines = shipLines(o)
    const events = sent.filter(i => i.order_id === o.id).map(i => ({ day: shipDay.get(i.shipment_id) ?? null, amount: ownCost.has(o.id) ? 0 : Number(i.amount ?? 0), pieces: i.qty }))
    const earlier = Object.entries(notes.shipped_earlier?.lines ?? {}).flatMap(([key, qty]) => {
      const line = lines.find(l => l.key === key)
      return line && qty > 0 ? [{ day: null, amount: ownCost.has(o.id) ? 0 : shareOf(line.amount, line.qty, 0, qty), pieces: qty }] : []
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
  return buildReconciliation({
    clientName: CLIENT.name, from, to, orders, money, bankFrom, bankTo, ledgerFrom,
    archived: { orders: inArchive.length, amount: inArchive.reduce((s, o) => s + orderAmount(o as never), 0) },
    settled: { before: CLIENT.settledBefore, orders: settled.length, amount: settled.reduce((s, o) => s + orderAmount(o as never), 0) },
  })
}

export async function history(svc: Svc) {
  const { data, error } = await svc.from('client_reconciliations')
    .select('id, date_from, date_to, created_at, created_by_name, closing_items:snapshot->items->>closing, closing_whole:snapshot->whole->>closing')
    .eq('client_id', CLIENT.id).order('id', { ascending: false }).limit(200)
  if (error) throw new Error(error.message)
  return data ?? []
}

