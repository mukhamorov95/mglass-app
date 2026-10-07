import { finalTotalOf } from '@/lib/b2b/priceOverride'
import { parseNotes, isShipped, orderRef } from '@/lib/b2b/todayPriorities'
import { stageDayKey } from '@/lib/production/dayLists'
import { mskDayKey } from '@/lib/time'
import { isOwnRetail } from '@/lib/liveOrders'

// Долг клиентов — ОДНА функция для /ceo, /cfo/receivables, прогноза кассы и утренней
// сводки. Раньше все четыре считали по notes.stages.invoice_sent, который с июня никто
// не ставит, — долг на экранах был 0 ₽ при 4,8 млн неоплаченных счетов.
//
// Долг = по запущенным (колонка launched_at) неархивным B2B-заказам итог (finalTotalOf,
// как в orderPayments) − оплачено по payments; только положительные остатки.
// Срок — дни с отгрузки, а если отгрузки нет — с запуска.

// С какого запуска считаем. Платежи в payments ведутся с конца августа (реестр счетов —
// с 26.08, выписки — с той же границы): у более ранних заказов оплаты в системе нет
// вообще, и они дали бы ~75 млн «долга», которого нет. Граница — решение владельца.
export const RECEIVABLES_SINCE = '2026-08-26'

// Ожидаемый срок оплаты после отгрузки/запуска — для прогноза кассы.
export const PAYMENT_TERM_DAYS = 14

export type RecOrder = {
  id: number
  custom_number: string | null
  client_id: number | null
  client_name: string | null
  launched_at: string | null
  total_after_discount: number | null
  total_sale_inc_vat: number | null
  notes: string | null
}

export type Bucket = 'b7' | 'b14' | 'b30' | 'b99'
export const BUCKETS: { key: Bucket; label: string; max: number }[] = [
  { key: 'b7', label: '0–7 дней', max: 7 },
  { key: 'b14', label: '8–14 дней', max: 14 },
  { key: 'b30', label: '15–30 дней', max: 30 },
  { key: 'b99', label: '30+ дней', max: Infinity },
]
export const bucketOf = (days: number): Bucket => BUCKETS.find(b => days <= b.max)!.key

export type DebtRow = {
  id: number
  ref: string
  clientId: number | null
  client: string
  total: number
  paid: number
  debt: number
  fromDay: string        // день отгрузки, иначе запуска
  shipped: boolean
  days: number
  bucket: Bucket
  invoiceNo: string | null
}

export type ClientDebt = { key: string; clientId: number | null; client: string; debt: number; count: number; maxDays: number }

export type Receivables = {
  since: string
  today: string
  total: number
  count: number
  rows: DebtRow[]
  byClient: ClientDebt[]
  buckets: { key: Bucket; label: string; sum: number; count: number }[]
  // Сколько заказов в окне вообще имеют платёж: без выписки банка часть «долга» —
  // незаведённые оплаты, и экран должен это говорить.
  coverage: { orders: number; withPayment: number }
  // M GLASS — своя розница, не клиент: её остаток не долг клиентов, показывается отдельно.
  ownRetail: { debt: number; count: number }
}

const DAY = 86_400_000
export const daysBetween = (a: string, b: string) =>
  Math.max(0, Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY))

export function computeReceivables(
  orders: RecOrder[],
  paid: Map<number, number>,
  opts: { today: string; since?: string; invoiceNoByOrder?: Map<number, string> },
): Receivables {
  const since = opts.since ?? RECEIVABLES_SINCE
  const rows: DebtRow[] = []
  let inScope = 0, withPayment = 0
  const own = { debt: 0, count: 0 }
  for (const o of orders) {
    if (!o.launched_at) continue
    const launchDay = mskDayKey(o.launched_at)
    if (launchDay < since) continue
    const n = parseNotes(o.notes)
    if (n.is_template === true) continue
    inScope++
    const total = Math.round(finalTotalOf(o) * 100) / 100
    const p = Math.round((paid.get(o.id) ?? 0) * 100) / 100
    if (p > 0) withPayment++
    const debt = Math.round((total - p) * 100) / 100
    if (!(debt > 1)) continue    // копейки раскладки счёта — не долг
    if (isOwnRetail(o.client_name)) { own.debt = Math.round((own.debt + debt) * 100) / 100; own.count++; continue }
    const shippedDay = isShipped(n) ? stageDayKey((n.stages as Record<string, unknown> | undefined)?.shipped) : null
    const fromDay = shippedDay ?? launchDay
    const days = daysBetween(fromDay, opts.today)
    rows.push({
      id: o.id, ref: orderRef(o), clientId: o.client_id, client: o.client_name?.trim() || '—',
      total, paid: p, debt, fromDay, shipped: isShipped(n), days, bucket: bucketOf(days),
      invoiceNo: opts.invoiceNoByOrder?.get(o.id) ?? null,
    })
  }
  rows.sort((a, b) => b.days - a.days || b.debt - a.debt)

  const clients = new Map<string, ClientDebt>()
  for (const r of rows) {
    const key = r.clientId != null ? `id:${r.clientId}` : `name:${r.client.toLowerCase()}`
    const c = clients.get(key) ?? { key, clientId: r.clientId, client: r.client, debt: 0, count: 0, maxDays: 0 }
    c.debt = Math.round((c.debt + r.debt) * 100) / 100
    c.count++
    c.maxDays = Math.max(c.maxDays, r.days)
    clients.set(key, c)
  }

  return {
    since, today: opts.today,
    total: Math.round(rows.reduce((s, r) => s + r.debt, 0) * 100) / 100,
    count: rows.length,
    rows,
    byClient: [...clients.values()].sort((a, b) => b.debt - a.debt),
    buckets: BUCKETS.map(b => {
      const list = rows.filter(r => r.bucket === b.key)
      return { key: b.key, label: b.label, sum: Math.round(list.reduce((s, r) => s + r.debt, 0) * 100) / 100, count: list.length }
    }),
    coverage: { orders: inScope, withPayment },
    ownRetail: own,
  }
}

const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10)

// Когда ждать деньги по строке долга: срок оплаты после отгрузки/запуска; просроченное —
// в ближайшие три дня (как раньше считал прогноз кассы).
export function expectedPayDay(row: Pick<DebtRow, 'fromDay'>, today: string): string {
  const due = addDays(row.fromDay, PAYMENT_TERM_DAYS)
  return due < today ? addDays(today, 3) : due
}

// Сколько долга ожидается в ближайшие N дней (для «Касса → 7 дней»).
export function expectedInflow(rows: Pick<DebtRow, 'fromDay' | 'debt'>[], today: string, horizonDays = 7): number {
  const edge = addDays(today, horizonDays)
  return Math.round(rows.filter(r => expectedPayDay(r, today) < edge).reduce((s, r) => s + r.debt, 0) * 100) / 100
}
