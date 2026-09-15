import { finalTotalOf } from './priceOverride'
import { deadlineFor } from './deadline'
import { stageDayKey } from '../production/dayLists'

// «Мой день · B2B» — что сделать сегодня. Маршрут docs/FINMODEL_MANAGER_ROUTE.md, Н2.
//
// Три главных списка (ТЗ 4.2) считаются только по данным, которые реально ведутся:
//   • отгрузка — отметка notes.stages.shipped (ставит цех и экран заказов). Поле
//     notes.shipped_date не пишет никто, по нему «просрочены» были все заказы;
//   • оплата — счета и платежи (derivedStatus из /api/invoices, правило A23). Флажок
//     notes.payment_status с A23 не ведётся: по нему «ждали оплату» 529 заказов при 18
//     неоплаченных счетах;
//   • просчёт — дата последнего изменения.

// Отметка отгрузки умерла в июле и вернулась 01.09 (#370). Заказ со сроком раньше
// отметить было нечем — его отсутствие отметки ничего не говорит.
export const SHIP_MARKS_SINCE = '2026-09-01'
export const STALE_QUOTE_MIN_DAYS = 3
// Просчёт, к которому не прикасались полтора месяца, — уже не «остывает», а остыл.
export const STALE_QUOTE_MAX_DAYS = 45
export const TOP_LIMIT = 10

const DAY = 86_400_000

export type TodayOrder = {
  id: number
  client_name: string
  custom_number: string | null
  total_sale_inc_vat: number | null
  total_after_discount: number | null
  notes: string | null
  created_at: string
  updated_at: string | null
  launched_at: string | null
  created_by_name: string | null
}

export type TodayInvoice = {
  id: number
  invoice_no: string | null
  payer_name: string | null
  order_ids: number[] | null
  amount: number | null
  status: string | null
  issued_at: string | null
  created_at: string
  created_by_name: string | null
  derivedStatus: 'paid' | 'partial' | 'unpaid'
  paid: number
  remainder: number
}

export type PriorityRow = {
  key: string
  client: string
  ref: string
  href: string
  amount: number
  days: number
  daysLabel: string
  owner: string | null
  note?: string
  action: string
}

type Notes = Record<string, unknown>

export function parseNotes(n: string | null): Notes {
  if (!n) return {}
  try { const p = JSON.parse(n); return p && typeof p === 'object' ? p as Notes : {} } catch { return {} }
}

export const orderRef = (o: Pick<TodayOrder, 'id' | 'custom_number'>) => o.custom_number?.trim() || `#${o.id}`
const days = (fromMs: number, now: number) => Math.max(0, Math.floor((now - fromMs) / DAY))
const plural = (n: number) => {
  const d10 = n % 10, d100 = n % 100
  if (d10 === 1 && d100 !== 11) return 'день'
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return 'дня'
  return 'дней'
}
export const daysText = (n: number) => `${n} ${plural(n)}`

export function isLaunched(o: TodayOrder, n: Notes = parseNotes(o.notes)): boolean {
  return !!o.launched_at || n.status === 'sent' || n.status === 'confirmed'
}

// Отгружен: в stages.shipped есть что угодно, включая старое `true` без даты.
export function isShipped(n: Notes): boolean {
  const v = (n.stages as Record<string, unknown> | undefined)?.shipped
  return v === true || (typeof v === 'string' && v.trim() !== '')
}

// Срок — от КОЛОНКИ launched_at: JSON notes.launched_at заполнен у трети заказов.
export function orderDeadline(o: TodayOrder, n: Notes = parseNotes(o.notes)): Date {
  return deadlineFor({ ...n, launched_at: n.launched_at ?? o.launched_at ?? undefined }, o.created_at)
}

export function overdueShipments(orders: TodayOrder[], now: number): PriorityRow[] {
  const since = Date.parse(SHIP_MARKS_SINCE)
  const rows: PriorityRow[] = []
  for (const o of orders) {
    const n = parseNotes(o.notes)
    if (n.is_template === true || !isLaunched(o, n) || isShipped(n)) continue
    const dl = orderDeadline(o, n).getTime()
    if (dl < since || dl >= now) continue
    const d = days(dl, now)
    rows.push({
      key: `ship-${o.id}`, client: o.client_name, ref: orderRef(o), href: `/b2b-deal/${o.id}`,
      amount: finalTotalOf(o), days: d, daysLabel: `просрочка ${daysText(d)}`,
      owner: o.created_by_name,
      note: stageDayKey((n.stages as Record<string, unknown> | undefined)?.packaged) ? 'упакован, не отгружен' : undefined,
      action: 'Проверить отгрузку',
    })
  }
  return rows.sort((a, b) => b.days - a.days || b.amount - a.amount)
}

export function unpaidInvoices(invoices: TodayInvoice[], now: number): PriorityRow[] {
  return invoices
    .filter(i => i.status !== 'cancelled' && i.derivedStatus !== 'paid')
    .map(i => {
      const d = days(Date.parse(i.issued_at ?? i.created_at), now)
      const ids = (i.order_ids ?? []).map(Number).filter(Boolean)
      const partial = i.derivedStatus === 'partial'
      return {
        key: `inv-${i.id}`, client: i.payer_name ?? '—',
        ref: `счёт ${i.invoice_no ?? `#${i.id}`}`,
        href: ids.length === 1 ? `/b2b-deal/${ids[0]}` : '/b2b-invoices',
        amount: Math.round(partial ? i.remainder : Number(i.amount) || 0),
        days: d, daysLabel: `выставлен ${daysText(d)} назад`,
        owner: i.created_by_name,
        note: partial ? `оплачено ${Math.round(i.paid).toLocaleString('ru-RU')} ₽, остаток` : undefined,
        action: 'Напомнить об оплате',
      }
    })
    .sort((a, b) => b.days - a.days || b.amount - a.amount)
}

export function staleQuotes(orders: TodayOrder[], now: number): PriorityRow[] {
  const rows: PriorityRow[] = []
  for (const o of orders) {
    const n = parseNotes(o.notes)
    if (n.is_template === true || isLaunched(o, n)) continue
    if (String(n.status ?? 'quote') !== 'quote' || n.public_opened_at) continue
    const d = days(Date.parse(o.updated_at ?? o.created_at), now)
    if (d < STALE_QUOTE_MIN_DAYS || d > STALE_QUOTE_MAX_DAYS) continue
    rows.push({
      key: `quote-${o.id}`, client: o.client_name, ref: orderRef(o), href: `/b2b-deal/${o.id}`,
      amount: finalTotalOf(o), days: d, daysLabel: `без движения ${daysText(d)}`,
      owner: o.created_by_name, action: 'Отправить клиенту',
    })
  }
  // Просчёты — по деньгам: из двадцати остывающих первым звонят по самому крупному.
  return rows.sort((a, b) => b.amount - a.amount || b.days - a.days)
}

export type OtherBucket = { key: string; title: string; hint: string; rows: PriorityRow[] }

// Остальные дела — ниже трёх главных, в том же формате строки.
export function otherBuckets(orders: TodayOrder[], now: number): OtherBucket[] {
  const answered: PriorityRow[] = [], agreed: PriorityRow[] = [], opened: PriorityRow[] = []
  const owner: PriorityRow[] = [], shipWeek: PriorityRow[] = []
  const weekAhead = now + 7 * DAY
  for (const o of orders) {
    const n = parseNotes(o.notes)
    if (n.is_template === true) continue
    const launched = isLaunched(o, n)
    const base = { client: o.client_name, ref: orderRef(o), href: `/b2b-deal/${o.id}`, amount: finalTotalOf(o), owner: o.created_by_name }
    const resp = n.client_response as { action?: string; comment?: string | null; at?: string } | undefined
    const approval = n.price_approval as { needed?: boolean; margin?: number } | undefined
    const touched = days(Date.parse(o.updated_at ?? o.created_at), now)

    if (resp?.action === 'question') {
      const d = resp.at ? days(Date.parse(resp.at), now) : touched
      answered.push({ ...base, key: `q-${o.id}`, days: d, daysLabel: `ждёт ${daysText(d)}`, note: resp.comment ? `«${resp.comment}»` : undefined, action: 'Ответить' })
    }
    if (!launched && approval?.needed) {
      owner.push({ ...base, key: `o-${o.id}`, days: touched, daysLabel: `ждёт ${daysText(touched)}`, note: `маржа ${approval.margin}%`, action: 'Ждём владельца' })
    }
    if (!launched && n.status === 'agreed') {
      agreed.push({ ...base, key: `a-${o.id}`, days: touched, daysLabel: `согласовано ${daysText(touched)} назад`, action: 'Запустить в работу' })
    }
    if (!launched && n.public_opened_at && !resp) {
      const d = days(Date.parse(String(n.public_opened_at)), now)
      opened.push({ ...base, key: `op-${o.id}`, days: d, daysLabel: `открыл ${daysText(d)} назад`, action: 'Позвонить' })
    }
    if (launched && !isShipped(n)) {
      const dl = orderDeadline(o, n).getTime()
      if (dl >= now && dl <= weekAhead) {
        const d = Math.ceil((dl - now) / DAY)
        shipWeek.push({ ...base, key: `w-${o.id}`, days: d, daysLabel: d <= 0 ? 'срок сегодня' : `через ${daysText(d)}`, action: 'Предупредить клиента' })
      }
    }
  }
  const byAmount = (a: PriorityRow, b: PriorityRow) => b.amount - a.amount
  return ([
    { key: 'answered', title: 'Вопрос от клиента',       hint: 'ответить сегодня',     rows: answered.sort(byAmount) },
    { key: 'agreed',   title: 'Согласовано клиентом',    hint: 'запустить в работу',   rows: agreed.sort(byAmount) },
    { key: 'shipweek', title: 'Отгрузка на этой неделе', hint: 'предупредить клиента', rows: shipWeek.sort((a, b) => a.days - b.days) },
    { key: 'opened',   title: 'Открыл КП и молчит',      hint: 'позвонить',            rows: opened.sort(byAmount) },
    { key: 'owner',    title: 'Цена у владельца',        hint: 'ждём решения',         rows: owner.sort(byAmount) },
  ] as OtherBucket[]).filter(b => b.rows.length > 0)
}
