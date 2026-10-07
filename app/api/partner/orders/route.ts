import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { resolvePartnerClient } from '@/lib/partnerClient'
import { partnerProgress, partnerDeadline } from '@/lib/partner/orderProgress'
import { readPaged } from '@/lib/partner/readPaged'
import { invoiceState, type UpdShort } from '@/lib/partner/documents'
import { loadUpdByOrders } from '@/lib/partner/updByOrders'
import { loadInvoicedOrders, markedPaid } from '@/lib/partner/orderMoney'
import { pointStage } from '@/lib/partner/pointPay'

// Кабинет партнёра — «мои заказы» (read-only, строго по своему клиенту).
// Клиент определяется по b2b_clients.user_id = auth.uid(). Никогда не отдаёт
// чужие данные. Если аккаунт не привязан (или колонка ещё не создана) — пусто.

function parseNotes(n: string | null): Record<string, unknown> {
  if (!n) return {}
  try { const p = JSON.parse(n); return typeof p === 'object' && p ? p as Record<string, unknown> : {} } catch { return {} }
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Привязанный клиент (первичный владелец ИЛИ участник команды). Нет → «не привязан».
  const client = await resolvePartnerClient<{ id: number; name: string; can_self_invoice: boolean | null; is_point: boolean | null }>(svc, user.id, 'id,name,can_self_invoice,is_point')
  if (!client) return NextResponse.json({ linked: false, client: null, orders: [] })

  // Все состояния: просчёт → отправлен в работу → в работе → отгружен.
  // Партнёр видит и просчёты, которые мы сделали для него.
  let data: Record<string, unknown>[]
  try {
    data = await readPaged<Record<string, unknown>>(() => svc
      .from('b2b_orders')
      .select('id,custom_number,client_order_number,created_at,updated_at,launched_at,total_after_discount,total_sale_inc_vat,notes,items')
      .eq('client_id', client.id)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }))
  } catch (e) {
    return NextResponse.json({ error: `Заказы не загрузились: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }

  // Реестр УПД не прочитался — список всё равно нужен; «Документы» скажут, что статус УПД неизвестен.
  let upds = new Map<number, UpdShort>()
  let updError: string | null = null
  try { upds = await loadUpdByOrders(svc, data.map(o => o.id as number)) }
  catch (e) { updError = e instanceof Error ? e.message : String(e) }

  // Точке счёт нужен до запуска — читаем реестр счетов только для неё.
  const isPoint = client.is_point === true
  let invoiced = new Set<number>()
  if (isPoint) {
    try { invoiced = await loadInvoicedOrders(svc, data.map(o => o.id as number)) }
    catch (e) { return NextResponse.json({ error: `Реестр счетов не прочитан: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 }) }
  }

  const orders = data.map((o: Record<string, unknown>) => {
    const pn = parseNotes(o.notes as string | null)
    const p = partnerProgress({ launched_at: o.launched_at as string | null }, pn)
    const lane = p.lane

    // Пересчитан ли просчёт нами и почему (для подсветки партнёру).
    const history = Array.isArray(pn.status_history) ? pn.status_history : []
    const lastComment = (pn.status_comment as string | undefined) || null

    // Что внутри — материалы + толщины (кратко) и число позиций.
    const items = Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : []
    const matLabels = [...new Set(items.map(it => {
      const nm = String(it.materialName ?? '').trim()
      const th = it.thickness ? `${it.thickness}мм` : ''
      return [nm, th].filter(Boolean).join(' ')
    }).filter(Boolean))]
    const summary = matLabels.slice(0, 2).join(' · ') + (matLabels.length > 2 ? ` +${matLabels.length - 2}` : '')

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
      deadline: partnerDeadline({ launched_at: o.launched_at as string | null, created_at: o.created_at as string }, pn).toISOString(),
      recalcNote: history.length > 0 ? lastComment : null,
      summary,
      positions: items.length,
      invoice: invoiceState({ launched: p.launched, canSelfInvoice: !!client.can_self_invoice, isPoint, invoiced: invoiced.has(o.id as number) }),
      point: pointStage({ isPoint, launched: p.launched, submitted: lane === 'submitted', invoiced: invoiced.has(o.id as number), paid: markedPaid(pn) }),
      upd: upds.get(o.id as number) ?? null,
    }
  })

  return NextResponse.json({ linked: true, client: { name: client.name }, orders, updError })
}
