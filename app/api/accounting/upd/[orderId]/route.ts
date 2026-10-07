import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { stageDayKey } from '@/lib/production/dayLists'
import { mskDayKey } from '@/lib/time'
import { parseNotes } from '@/lib/b2b/publicQuote'
import { orderRef } from '@/lib/b2b/todayPriorities'
import { updDocDate } from '@/lib/b2b/updLines'
import { moscowDate, nextUpdNumber, updDateError, updIssueBlockers } from '@/lib/b2b/updView'
import { UPD_ACCOUNTING_ROLES, loadUpdIssued, loadUpdSeries } from '@/lib/b2b/updRegistry'
import { UPD_ORDER_COLS, buildUpdForOrder, issueUpdForOrder, parseEntityId, updOrderState, type UpdOrder } from '@/lib/b2b/updIssue'

// УПД заказа в «Бухгалтерия → УПД» (этапы 8 и 8б docs/b2b/ORDER_PANEL_ROUTE.md). Выданный —
// закреплённая копия из реестра. Невыданный — черновик, который собирает сервер: бухгалтеру
// /b2b-quotes закрыт, и сырые позиции заказа (в них себестоимость) на клиент не уходят —
// только содержимое документа. Выдача — та же функция, что у менеджера.

const DAY = /^\d{4}-\d{2}-\d{2}$/

async function loadOrder(svc: ReturnType<typeof createServiceClient>, id: number): Promise<UpdOrder | null> {
  const { data, error } = await svc.from('b2b_orders').select(UPD_ORDER_COLS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as UpdOrder | null) ?? null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const guard = await requireRole(UPD_ACCOUNTING_ROLES)
  if (guard instanceof NextResponse) return guard
  const { orderId } = await params
  const id = Number(orderId)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })
  const svc = createServiceClient()
  try {
    const issued = await loadUpdIssued(svc, id)
    if (issued) return NextResponse.json({ issued })

    const order = await loadOrder(svc, id)
    if (!order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })
    const notes = parseNotes(order.notes)
    const today = moscowDate()

    const [entRes, invRes, state, series] = await Promise.all([
      order.client_id != null
        ? svc.from('b2b_client_legal_entities').select('id, full_name, inn, kpp, is_default')
          .eq('client_id', order.client_id).eq('active', true)
          .order('is_default', { ascending: false }).order('id', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      svc.from('invoices').select('payer_entity_id, created_at').contains('order_ids', [order.id])
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      updOrderState(svc, order),
      loadUpdSeries(svc),
    ])
    if (entRes.error) throw new Error(entRes.error.message)
    const entities = (entRes.data ?? []) as { id: number; full_name: string | null; inn: string | null; kpp: string | null; is_default: boolean }[]

    // Покупатель по умолчанию — как у менеджера: плательщик из счёта, иначе основное юрлицо.
    const sp = req.nextUrl.searchParams
    const asked = parseEntityId(sp.get('entity_id'))
    const payer = (invRes.data?.payer_entity_id as number | null | undefined) ?? null
    const entityId = (asked != null && entities.some(e => e.id === asked) ? asked : null)
      ?? entities.find(e => e.id === payer)?.id ?? entities.find(e => e.is_default)?.id ?? entities[0]?.id ?? null

    // Дата по умолчанию — отметка «Отгружен», если она уже была; иначе сегодня.
    const askedDate = sp.get('doc_date')
    const dd = updDocDate(notes, order.created_at)
    const docDate = askedDate && DAY.test(askedDate) ? askedDate
      : dd.source === 'shipped' && moscowDate(dd.date) <= today ? moscowDate(dd.date) : today

    const built = await buildUpdForOrder(svc, order, entityId, docDate)
    const body = built.ok ? built.body : null
    const year = Number(docDate.slice(0, 4))
    const cur = series?.find(s => s.year === year) ?? null
    const shippedDay = stageDayKey((notes.stages as Record<string, unknown> | undefined)?.shipped)
    const switchDay = cur ? mskDayKey(cur.set_at) : null

    return NextResponse.json({
      draft: {
        orderId: order.id,
        orderRef: orderRef(order),
        clientName: order.client_name ?? '',
        entities: entities.map(e => ({ id: e.id, full_name: e.full_name, inn: e.inn, kpp: e.kpp, is_default: e.is_default })),
        entityId,
        docDate,
        body,
        buyerError: built.ok ? null : built.error,
        blockers: body ? updIssueBlockers(body) : [],
        dateError: updDateError(docDate, order.created_at, today),
        launched: state.launched,
        archived: state.archived,
        shippedDay,
        // Отгрузку до включения серии УПД оформляла программа — второй документ на неё не нужен.
        shippedBeforeSwitch: !!(shippedDay && switchDay && shippedDay < switchDay),
        series: {
          pendingSql: series === null,
          year,
          set: !!cur,
          switchDay,
          nextNumber: cur ? nextUpdNumber(cur.start_number, cur.last_number) : null,
          lastNumber: cur?.last_number ?? null,
          lastDate: cur?.last_date ?? null,
        },
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const guard = await requireRole(UPD_ACCOUNTING_ROLES)
  if (guard instanceof NextResponse) return guard
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Нужно войти' }, { status: 401 })
  const { orderId } = await params
  const id = Number(orderId)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })
  const body = await req.json().catch(() => ({})) as { doc_date?: unknown; entity_id?: unknown }
  const svc = createServiceClient()
  try {
    const order = await loadOrder(svc, id)
    if (!order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })
    const out = await issueUpdForOrder(svc, order, { docDate: String(body.doc_date ?? ''), entityId: parseEntityId(body.entity_id) }, user)
    return NextResponse.json(out.json, { status: out.status })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
