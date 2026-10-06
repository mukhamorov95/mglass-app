// Цифры для рекомендаций AI Control Center — из тех же источников и тем же кодом, что
// экраны: «Продажи M-Glass», «Маржа», «Показатели менеджеров», B2B-заказы, отгрузки.
// До 06.10 модель видела только счётчики заявок и расчётов и советовала вслепую.
// Каждая цифра — с id, периодом и источником: модель ссылается на id, а на карточку
// и в Telegram число попадает отсюда, а не из её текста.

import type { SupabaseClient } from '@supabase/supabase-js'
import { shiftMonth, monthLabel } from '@/lib/sales/period'
import { loadMarginMonths, periodTotals, type PeriodTotals } from '@/lib/sales/marginBook'
import { foldStats, type StatFact, type StatRow } from '@/lib/sales/managerStats'
import { launchedOrders, orderAmount, canonicalClient, isOwnRetail } from '@/lib/liveOrders'
import { overdueShipments, splitShipments, type TodayOrder } from '@/lib/b2b/todayPriorities'
import { mskDayKey } from '@/lib/time'
import type { Fact } from './recommendationTypes'

export const SOURCE = {
  sales: '«Продажи M-Glass»',
  margin: 'книга «Маржа», закрытые заказы',
  managers: 'управленческая книга, «Аналитика дохода»',
  b2b: 'B2B-заказы в работе, без собственной розницы M GLASS',
  ship: 'B2B: отметки отгрузки',
  leads: 'заявки Авито-бота',
  calcs: 'расчёты в приложении',
} as const

export type Slot = 'last_month' | 'prev_month'

// Имя в id: «Александра» → «александра», пробелы → «_».
export const slug = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, '_')

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
export const monthPeriod = (ym: string) => lower(monthLabel(ym))

type SaleRow = { sale_date: string; amount: number | string | null; manager: string | null }

export function salesFacts(rows: SaleRow[], month: string, slot: Slot): Fact[] {
  const period = monthPeriod(month), source = SOURCE.sales
  const own = rows.filter(r => r.sale_date.startsWith(month))
  const sum = own.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const out: Fact[] = [
    { id: `sales.sum.${slot}`, label: 'Продажи M-Glass, сумма', value: sum, unit: 'rub', period, source },
    { id: `sales.count.${slot}`, label: 'Продажи M-Glass, заказов', value: own.length, unit: 'count', period, source },
  ]
  if (own.length) out.push({ id: `sales.avg.${slot}`, label: 'Продажи M-Glass, средний чек', value: Math.round(sum / own.length), unit: 'rub', period, source })
  if (slot !== 'last_month') return out
  const byMgr = new Map<string, { sum: number; n: number }>()
  for (const r of own) {
    const k = r.manager?.trim() || 'без менеджера'
    const cur = byMgr.get(k) ?? { sum: 0, n: 0 }
    cur.sum += Number(r.amount) || 0; cur.n++
    byMgr.set(k, cur)
  }
  for (const [m, v] of [...byMgr].sort((a, b) => b[1].sum - a[1].sum)) {
    out.push(
      { id: `sales.mgr.${slug(m)}.sum.${slot}`, label: `Продажи ${m}, сумма`, value: v.sum, unit: 'rub', period, source },
      { id: `sales.mgr.${slug(m)}.count.${slot}`, label: `Продажи ${m}, заказов`, value: v.n, unit: 'count', period, source },
    )
  }
  return out
}

// Маржа — только закрытые заказы с полными расходами (правило экрана «Маржа», 05.10):
// у открытого расходы ещё набираются, и его маржа завышает итог.
export function marginFacts(t: PeriodTotals, period: string): Fact[] {
  const source = SOURCE.margin
  const out: Fact[] = [
    { id: 'margin.orders.q', label: 'Заказов в «Марже»', value: t.objects, unit: 'count', period, source },
    { id: 'margin.closed.q', label: 'Закрыто с полными расходами', value: t.closed, unit: 'count', period, source },
    { id: 'margin.to_fill.q', label: 'Закрыты, но расходы внесены не все', value: t.to_fill, unit: 'count', period, source },
  ]
  if (t.closed_sales > 0 && t.margin_pct != null) {
    out.push(
      { id: 'margin.closed_sales.q', label: 'Продажи закрытых заказов', value: t.closed_sales, unit: 'rub', period, source },
      { id: 'margin.sum.q', label: 'Маржа закрытых заказов, ₽', value: t.margin, unit: 'rub', period, source },
      { id: 'margin.pct.q', label: 'Маржа закрытых заказов, %', value: t.margin_pct, unit: 'pct', period, source },
    )
  }
  return out
}

export function managerFacts(rows: StatRow[], totals: StatRow, month: string): Fact[] {
  const period = monthPeriod(month), source = SOURCE.managers
  const out: Fact[] = []
  for (const r of [...rows, totals]) {
    const who = r === totals ? 'команда' : r.manager
    const id = (k: string) => `mgr.${slug(who)}.${k}.last_month`
    const name = r === totals ? 'Команда' : r.manager
    out.push(
      { id: id('talks'), label: `${name}: разговоры`, value: r.talks, unit: 'count', period, source },
      { id: id('measure_done'), label: `${name}: замеров проведено`, value: r.measure_done, unit: 'count', period, source },
      { id: id('payments'), label: `${name}: оплат`, value: r.payments, unit: 'count', period, source },
      { id: id('money'), label: `${name}: денег всего`, value: r.money_total, unit: 'rub', period, source },
    )
    if (r.toMeasure != null) out.push({ id: id('conv_measure'), label: `${name}: разговор → замер назначен`, value: r.toMeasure, unit: 'pct', period, source })
    // Других долей нет и на экране (StatRow.toMeasure): проведённые замеры и оплаты месяца
    // идут и по замерам прошлых месяцев, у Айжан в сентябре «замер → оплата» вышло 250 %.
  }
  return out
}

type B2bRow = { launched_at: string; client_name: string | null; total_after_discount?: number | null; total_sale_inc_vat?: number | null }

export function b2bFacts(rows: B2bRow[], month: string, slot: Slot): Fact[] {
  const period = monthPeriod(month), source = SOURCE.b2b
  const own = rows.filter(r => !isOwnRetail(r.client_name) && mskDayKey(r.launched_at).startsWith(month))
  const sum = own.reduce((s, r) => s + orderAmount(r), 0)
  const byClient = new Map<string, number>()
  for (const r of own) byClient.set(canonicalClient(r.client_name), (byClient.get(canonicalClient(r.client_name)) ?? 0) + orderAmount(r))
  const out: Fact[] = [
    { id: `b2b.sum.${slot}`, label: 'B2B: запущено в работу, сумма', value: sum, unit: 'rub', period, source },
    { id: `b2b.count.${slot}`, label: 'B2B: запущено заказов', value: own.length, unit: 'count', period, source },
    { id: `b2b.clients.${slot}`, label: 'B2B: клиентов с заказами', value: byClient.size, unit: 'count', period, source },
  ]
  if (slot === 'last_month' && sum > 0) {
    const [top, topSum] = [...byClient].sort((a, b) => b[1] - a[1])[0]
    out.push({ id: `b2b.top_share.${slot}`, label: `B2B: доля крупнейшего клиента (${top})`, value: topSum / sum * 100, unit: 'pct', period, source })
  }
  return out
}

// Отгрузки: просрочка до 14 дней — живая; старше почти всегда отгружено без отметки
// (решение владельца 30.09), поэтому отдельной цифрой, а не в общей куче.
export function shipFacts(orders: TodayOrder[], now: Date): Fact[] {
  const { recent, old } = splitShipments(overdueShipments(orders, now.getTime()))
  const [y, m, d] = mskDayKey(now).split('-')
  const period = `на ${d}.${m}.${y}`, source = SOURCE.ship
  return [
    { id: 'b2b.overdue.count', label: 'B2B: просрочена отгрузка (до 14 дней)', value: recent.length, unit: 'count', period, source },
    { id: 'b2b.overdue.sum', label: 'B2B: сумма просроченных отгрузок (до 14 дней)', value: recent.reduce((s, r) => s + r.amount, 0), unit: 'rub', period, source },
    { id: 'b2b.overdue_old.count', label: 'B2B: срок прошёл больше 14 дней назад, отгрузка не отмечена', value: old.length, unit: 'count', period, source },
  ]
}

export type FactsResult = { facts: Fact[]; missing: string[] }

const since = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString()
const mskMonthStart = (ym: string) => `${ym}-01T00:00:00+03:00`

async function count(q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const r = await q
  if (r.error) throw new Error(r.error.message)
  return r.count ?? 0
}

// Каждый блок отдельно: не загрузилась «Маржа» — остальные цифры всё равно идут в
// анализ, а модель узнаёт, чего нет, и не выдумывает это.
export async function collectFacts(sb: SupabaseClient, now = new Date()): Promise<FactsResult> {
  const cur = mskDayKey(now).slice(0, 7)
  const last = shiftMonth(cur, -1), prev = shiftMonth(cur, -2), third = shiftMonth(cur, -3)
  const blocks: [string, () => Promise<Fact[]>][] = [
    [SOURCE.sales, async () => {
      const { data, error } = await sb.from('crm_sales').select('sale_date, amount, manager')
        .gte('sale_date', `${prev}-01`).lt('sale_date', `${cur}-01`).eq('voided', false).neq('department', 'b2b').range(0, 4999)
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as SaleRow[]
      return [...salesFacts(rows, last, 'last_month'), ...salesFacts(rows, prev, 'prev_month')]
    }],
    [SOURCE.margin, async () => {
      const { byMonth } = await loadMarginMonths(sb, [third, prev, last])
      return marginFacts(periodTotals(byMonth.flatMap(m => m.objects)), `${monthPeriod(third).split(' ')[0]} — ${monthPeriod(last)}`)
    }],
    [SOURCE.managers, async () => {
      const { data, error } = await sb.from('manager_stats_monthly').select('manager, metric, value').eq('month', last).limit(5000)
      if (error) throw new Error(error.message)
      const facts = ((data ?? []) as { manager: string; metric: string; value: number }[]).map(r => ({ ...r, stat_date: `${last}-01` }) as StatFact)
      const { rows, totals } = foldStats(facts)
      return rows.length ? managerFacts(rows, totals, last) : []
    }],
    [SOURCE.b2b, async () => {
      const q = launchedOrders(sb, 'launched_at, client_name, total_after_discount, total_sale_inc_vat') as unknown as {
        gte(c: string, v: string): { lt(c: string, v: string): { range(a: number, b: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> } }
      }
      const { data, error } = await q.gte('launched_at', mskMonthStart(prev)).lt('launched_at', mskMonthStart(cur)).range(0, 4999)
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as B2bRow[]
      return [...b2bFacts(rows, last, 'last_month'), ...b2bFacts(rows, prev, 'prev_month')]
    }],
    [SOURCE.ship, async () => {
      // Тот же набор, что у «Мой день · B2B» (loadTodayOrders), но без пользователя: крон.
      const { data, error } = await sb.from('b2b_orders')
        .select('id,client_name,custom_number,total_sale_inc_vat,total_after_discount,notes,created_at,updated_at,launched_at,created_by_name')
        .is('archived_at', null).gte('created_at', since(now, 120)).order('created_at', { ascending: false }).limit(1000)
      if (error) throw new Error(error.message)
      return shipFacts((data ?? []) as TodayOrder[], now)
    }],
    [SOURCE.leads, async () => {
      const base = () => sb.from('crm_leads').select('id', { count: 'exact', head: true }).gte('created_at', since(now, 30))
      const [total, qualified, measure] = await Promise.all([
        count(base()), count(base().eq('qualified', true)), count(base().eq('stage', 'Замер назначен')),
      ])
      const period = 'последние 30 дней', source = SOURCE.leads
      return [
        { id: 'leads.total.30d', label: 'Заявок Авито-бота', value: total, unit: 'count', period, source },
        { id: 'leads.qualified.30d', label: 'Из них квалифицированы', value: qualified, unit: 'count', period, source },
        { id: 'leads.measure.30d', label: 'Из них дошли до «Замер назначен»', value: measure, unit: 'count', period, source },
      ]
    }],
    [SOURCE.calcs, async () => [{
      id: 'calcs.count.30d', label: 'Расчётов в приложении', unit: 'count', period: 'последние 30 дней', source: SOURCE.calcs,
      value: await count(sb.from('calculations').select('id', { count: 'exact', head: true }).gte('created_at', since(now, 30))),
    }]],
  ]
  const facts: Fact[] = [], missing: string[] = []
  await Promise.all(blocks.map(async ([name, run]) => {
    try { facts.push(...await run()) } catch (e) { missing.push(`${name}: ${e instanceof Error ? e.message : String(e)}`) }
  }))
  const order = blocks.map(([n]) => n)
  facts.sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source))
  return { facts, missing }
}
