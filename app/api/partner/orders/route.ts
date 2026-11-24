import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { isSettledOrder } from '@/lib/b2b/settledBefore'
import { resolvePartnerMember } from '@/lib/partnerClient'
import { permsOf } from '@/lib/partner/teamRoles'
import { partnerProgress, partnerDeadline, isLaunched, noteStatus } from '@/lib/partner/orderProgress'
import { quoteState } from '@/lib/partner/quoteState'
import { readPaged } from '@/lib/partner/readPaged'
import { invoiceState, type UpdShort } from '@/lib/partner/documents'
import { loadUpdByOrders } from '@/lib/partner/updByOrders'
import { loadInvoicedOrders, loadPaidByOrders, paymentView } from '@/lib/partner/orderMoney'
import { pointStage } from '@/lib/partner/pointPay'
import { materialWithKind } from '@/lib/materialLabel'
import { earlierLines, loadShippedLines, shipPartial } from '@/lib/partner/shipProgress'

// Кабинет партнёра — «мои заказы» (read-only, строго по своему клиенту).
// Клиент определяется по b2b_clients.user_id = auth.uid(). Никогда не отдаёт
// чужие данные. Если аккаунт не привязан (или колонка ещё не создана) — пусто.

function parseNotes(n: string | null): Record<string, unknown> {
  if (!n) return {}
  try { const p = JSON.parse(n); return typeof p === 'object' && p ? p as Record<string, unknown> : {} } catch { return {} }
}

// В базе «Компания · Имя» — партнёру компания не нужна, она у него одна.
function authorOf(raw: string | null, clientName: string): string | null {
  const v = (raw ?? '').trim()
  if (!v || v === clientName) return null
  const prefix = `${clientName} · `
  return v.startsWith(prefix) ? v.slice(prefix.length).trim() || null : v
}

export async function GET() {
  const t0 = Date.now()
  const marks: string[] = []
  const mark = (n: string) => marks.push(`${n};dur=${Date.now() - t0}`)
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Привязанный клиент (первичный владелец ИЛИ участник команды). Нет → «не привязан».
  const pm = await resolvePartnerMember<{ id: number; name: string; can_self_invoice: boolean | null; is_point: boolean | null }>(svc, user.id, 'id,name,can_self_invoice,is_point')
  if (!pm) return NextResponse.json({ linked: false, client: null, orders: [] })
  const client = pm.client
  mark('member')

  // Все состояния: просчёт → отправлен в работу → в работе → отгружен.
  // Партнёр видит и просчёты, которые мы сделали для него.
  let data: Record<string, unknown>[]
  try {
    data = await readPaged<Record<string, unknown>>(() => svc
      .from('b2b_orders')
      .select('id,custom_number,client_order_number,created_at,updated_at,launched_at,total_after_discount,total_sale_inc_vat,notes,items,source,created_by_name')
      .eq('client_id', client.id)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }))
  } catch (e) {
    return NextResponse.json({ error: `Заказы не загрузились: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }

  mark('orders')
  // Реестр УПД не прочитался — список всё равно нужен; «Документы» скажут, что статус УПД неизвестен.
  let upds = new Map<number, UpdShort>()
  let updError: string | null = null
  try { upds = await loadUpdByOrders(svc, data.map(o => o.id as number)) }
  catch (e) { updError = e instanceof Error ? e.message : String(e) }

  // Точке счёт нужен до запуска — читаем реестр счетов только для неё.
  // Оплата нужна по запущенным заказам любому партнёру, а точке — ещё и по незапущенным (она платит до запуска).
  const isPoint = client.is_point === true
  let invoiced = new Set<number>()
  let paidMap = new Map<number, number>()
  try {
    if (isPoint) invoiced = await loadInvoicedOrders(svc, data.map(o => o.id as number))
    const need = isPoint ? data : data.filter(o => isLaunched({ launched_at: o.launched_at as string | null }, parseNotes(o.notes as string | null)))
    paidMap = await loadPaidByOrders(svc, need.map(o => o.id as number))
  } catch (e) {
    return NextResponse.json({ error: `Счета и оплаты не прочитаны: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }

  mark('money')
  // Отгрузки по изделиям: без них заказ, уехавший частично, висит «в работе» без подсказки.
  let shippedLines = new Map<string, number>()
  try { shippedLines = await loadShippedLines(svc, data.filter(o => o.launched_at || isLaunched({ launched_at: null }, parseNotes(o.notes as string | null))).map(o => o.id as number)) }
  catch (e) { return NextResponse.json({ error: `Отгрузки не прочитаны: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 }) }

  const orders = data.map((o: Record<string, unknown>) => {
    const pn = parseNotes(o.notes as string | null)
    const p = partnerProgress({ launched_at: o.launched_at as string | null }, pn)
    const lane = p.lane

    // Пересчитан ли просчёт нами и почему (для подсветки партнёру).
    const history = Array.isArray(pn.status_history) ? pn.status_history : []
    const lastComment = (pn.status_comment as string | undefined) || null
    // Комментарий к «Согласовано» / «Отказ» — не пересчёт: он идёт подписью к состоянию.
    const qs = lane === 'quote' ? quoteState(noteStatus(pn)) : null
    const stateNote = qs && qs !== 'draft' ? lastComment : null

    // Что внутри — материалы + толщины (кратко) и число позиций.
    const items = Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : []
    const matLabels = [...new Set(items.map(it => {
      const nm = materialWithKind(it as { materialName?: string | null; category?: string | null })
      const th = it.thickness ? `${it.thickness}мм` : ''
      return [nm, th].filter(Boolean).join(' ')
    }).filter(Boolean))]
    const summary = matLabels.slice(0, 2).join(' · ') + (matLabels.length > 2 ? ` +${matLabels.length - 2}` : '')

    const total = Number(o.total_after_discount ?? o.total_sale_inc_vat ?? 0)
    const earlier = earlierLines(pn)
    const partial = lane === 'in_work'
      ? shipPartial(items as { localId?: string | null; quantity?: unknown }[], k => (shippedLines.get(`${o.id}:${k}`) ?? 0) + (earlier[k] ?? 0))
      : null
    const payment = paymentView({ total, paidFromPayments: paidMap.get(o.id as number) ?? 0, notes: pn, due: p.launched, settled: isSettledOrder(client.id, o.launched_at, pn) })

    return {
      id: o.id as number,
      number: (o.custom_number as string | null)?.trim() || `#${o.id}`,
      clientOrderNumber: (o.client_order_number as string | null) ?? null,
      created_at: o.created_at as string,
      updatedAt: (o.updated_at as string | null) ?? (o.created_at as string),
      amount: (o.total_after_discount as number | null) ?? (o.total_sale_inc_vat as number | null) ?? 0,
      lane,
      progressPct: p.progressPct,
      stage: p.stage,
      shipped: p.shipped,
      ready: p.ready,
      shipPartial: partial,
      // Автор — только у просчётов, сделанных в кабинете: у наших там имя нашего сотрудника.
      byPartner: o.source === 'partner',
      author: o.source === 'partner' ? authorOf(o.created_by_name as string | null, client.name) : null,
      deadline: partnerDeadline({ launched_at: o.launched_at as string | null, created_at: o.created_at as string }, pn).toISOString(),
      recalcNote: history.length > 0 && !stateNote && (qs === null || qs === 'draft') ? lastComment : null,
      quoteState: qs,
      stateNote,
      summary,
      positions: items.length,
      invoice: invoiceState({ launched: p.launched, canSelfInvoice: !!client.can_self_invoice, isPoint, invoiced: invoiced.has(o.id as number) }),
      point: pointStage({
        isPoint, launched: p.launched, submitted: lane === 'submitted', invoiced: invoiced.has(o.id as number),
        paid: isPoint && paymentView({ total, paidFromPayments: paidMap.get(o.id as number) ?? 0, notes: pn, due: true })?.status === 'paid',
      }),
      upd: upds.get(o.id as number) ?? null,
      payment,
    }
  })

  // Права роли режут ответ: без «цен» — ни сумм, ни оплаты; без «финансов» — ни счёта, ни УПД.
  const perms = permsOf(pm.role)
  const shaped = orders.map(o => ({
    ...o,
    amount: perms.prices ? o.amount : null,
    payment: perms.payStatus ? o.payment : null,
    invoice: perms.finance ? o.invoice : null,
    upd: perms.finance ? o.upd : null,
  }))
  mark('done')
  // Server-Timing: замер «кабинет открывается 20 с» (24.11) — видно, какой шаг держит.
  return NextResponse.json({ linked: true, client: { name: client.name }, role: pm.role, perms, orders: shaped, updError }, { headers: { 'Server-Timing': marks.join(', ') } })
}
