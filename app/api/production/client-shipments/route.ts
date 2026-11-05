import { NextRequest, NextResponse } from 'next/server'
import { requirePageAccess } from '@/lib/apiAuth'
import { getSessionUser, getUserProfile } from '@/lib/getRole'
import { serviceAsMe } from '@/lib/serviceAs'
import { createServiceClient } from '@/lib/supabase-service'
import { CASCADE_FROM } from '@/lib/production/managerCascade'
import { closeOpenTasksOnOrderMark, reopenTasksOnOrderUnmark } from '@/lib/production/closeOnOrderMark'
import { readIn, readPaged } from '@/lib/production/paged'
import { mskDayKey } from '@/lib/time'
import { isLaunched, isShipped, orderDeadline, type TodayOrder } from '@/lib/b2b/todayPriorities'
import {
  SHOWER_GLASS, orderShipState, orderStage, overdueDays, packedLineCount, requestProblem, shareOf, shipLines, takenByLine,
  type LineRequest, type ShipOrder, type ShipRow,
} from '@/lib/production/clientShipments'

// Отгрузка Шовер Гласс: заказы и изделия к отгрузке, отгрузки к дате, история.
// Таблица строк закрыта политиками, поэтому чтение и запись только здесь, после проверки роли.
// Сумма уходит только тем, кому положено видеть деньги (canViewMoney). Себестоимости в ответе нет.

const PAGE = '/production-app/shower-glass'
const REGION = SHOWER_GLASS.region
const SHIPPED_MARKS_SINCE = '2026-07-01'

type Svc = ReturnType<typeof createServiceClient>
type RawOrder = ShipOrder & { id: number; custom_number: string | null; notes: string | null; created_at: string; launched_at?: string | null; client_id?: number | null }
type Head = { id: number; ship_date: string | null; status: string; shipped_at: string | null; created_at: string; total_weight_kg: number | null; title: string | null }
type ItemRow = ShipRow & { label: string | null; weight_kg: number | null; amount: number | null }
type Notes = { status?: string; historical?: boolean; launched_at?: string | null; stages?: Record<string, string | null>; client_shipment?: { id: number; date: string; prev_shipped: string | null } | null }

const ORDER_COLS = 'id, custom_number, items, notes, created_at, launched_at, client_id, discount_percent, total_after_discount, total_sale_inc_vat'
const orderNo = (o: { custom_number: string | null; id: number }) => o.custom_number?.trim() || `00${o.id}`
// Дата из notes бывает кривой: один заказ не должен ронять весь экран.
function dayOf(v: Date | string | null | undefined): string | null {
  const t = v ? new Date(v) : null
  return t && !Number.isNaN(t.getTime()) ? mskDayKey(t) : null
}

function notesOf(raw: string | null): Notes {
  try { return raw ? JSON.parse(raw) as Notes : {} } catch { return {} }
}

async function loadHeads(svc: Svc): Promise<Head[]> {
  const { data, error } = await svc.from('delivery_shipments')
    .select('id, ship_date, status, shipped_at, created_at, total_weight_kg, title')
    .eq('region', REGION).order('id', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as Head[]
}

async function loadRows(svc: Svc, shipmentIds: number[]): Promise<ItemRow[]> {
  return readIn<ItemRow, number>(shipmentIds, (part, from, to) => svc.from('delivery_shipment_items')
    .select('shipment_id, order_id, line_key, qty, label, weight_kg, amount')
    .in('shipment_id', part).range(from, to) as never)
}

async function loadOrders(svc: Svc, ids: number[]): Promise<RawOrder[]> {
  return readIn<RawOrder, number>(ids, (part, from, to) => svc.from('b2b_orders')
    .select(ORDER_COLS).in('id', part).range(from, to) as never)
}

export async function GET() {
  const guard = await requirePageAccess(PAGE)
  if (guard instanceof NextResponse) return guard
  const profile = await getUserProfile()
  const canMoney = profile?.canViewMoney === true
  const svc = createServiceClient()

  try {
    const heads = await loadHeads(svc)
    const rows = await loadRows(svc, heads.map(h => h.id))
    const statusById = new Map(heads.map(h => [h.id, h.status]))
    const taken = takenByLine(rows, id => statusById.get(id))

    const clientOrders = await readPaged<RawOrder>((from, to) => svc.from('b2b_orders')
      .select(ORDER_COLS).eq('client_id', SHOWER_GLASS.clientId).is('archived_at', null)
      .order('id', { ascending: true }).range(from, to) as never)
    const known = new Set(clientOrders.map(o => o.id))
    const extraIds = [...new Set(rows.map(r => r.order_id))].filter(id => !known.has(id))
    const orders = [...clientOrders, ...await loadOrders(svc, extraIds)]
    const byId = new Map(orders.map(o => [o.id, o]))

    // Упаковано по строке: задача упаковки закрыта или заказ целиком отмечен упакованным.
    const packedKeys = new Set<string>()
    const tasks = await readIn<{ order_id: number; item_index: number | null }, number>(orders.map(o => o.id), (part, from, to) =>
      svc.from('production_tasks').select('order_id, item_index').eq('stage_key', 'packaging').eq('status', 'done').in('order_id', part).range(from, to) as never)
    for (const t of tasks) packedKeys.add(`${t.order_id}:${t.item_index}`)

    const money = (n: number | null | undefined) => (canMoney ? Number(n ?? 0) : undefined)

    const today = mskDayKey()
    const views = orders.flatMap(o => {
      const notes = notesOf(o.notes)
      const stages = notes.stages ?? {}
      const inShipment = rows.some(r => r.order_id === o.id)
      if (!inShipment && (notes.status === 'quote' || notes.historical)) return []
      const lines = shipLines(o).map(l => {
        const t = taken.get(`${o.id}:${l.key}`) ?? { shipped: 0, drafted: 0 }
        return {
          key: l.key, label: l.label, size: l.size, qty: l.qty, weight: l.weight, amount: money(l.amount),
          shipped: t.shipped, drafted: t.drafted, free: Math.max(0, l.qty - t.shipped - t.drafted),
          packed: !!stages.packaged || packedKeys.has(`${o.id}:${l.index}`),
        }
      })
      const state = orderShipState(lines, k => lines.find(l => l.key === k)?.shipped ?? 0)
      const markedOutside = !!stages.shipped && !notes.client_shipment && !inShipment
      if (markedOutside && o.created_at.slice(0, 10) < SHIPPED_MARKS_SINCE) return []
      const stage = orderStage(lines, state, isShipped(notes))
      // Срок только у запущенного: у незапущенного он считался бы от даты создания, а это выдумка.
      const asToday = o as unknown as TodayOrder
      const deadlineDay = isLaunched(asToday, notes) ? dayOf(orderDeadline(asToday, notes)) : null
      return [{
        id: o.id, no: orderNo(o), launch_day: dayOf(o.launched_at ?? notes.launched_at) ?? o.created_at.slice(0, 10), deadline_day: deadlineDay,
        overdue_days: overdueDays(deadlineDay, today, stage), paid: !!stages.invoice_paid, state, stage, packed_lines: packedLineCount(lines),
        marked_day: typeof stages.shipped === 'string' ? dayOf(stages.shipped) : null, marked_outside: markedOutside, lines,
      }]
    })

    const shipments = heads.map(h => ({
      id: h.id, ship_date: h.ship_date, status: h.status, shipped_at: h.shipped_at,
      lines: rows.filter(r => r.shipment_id === h.id).map(r => {
        const o = byId.get(r.order_id)
        const line = o ? shipLines(o).find(l => l.key === r.line_key) : undefined
        const from = taken.get(`${r.order_id}:${r.line_key}`)?.shipped ?? 0
        // В черновике вес и сумма считаются по заказу сейчас, у отправленной — снимок.
        const live = h.status !== 'shipped' && line
        return {
          order_id: r.order_id, order_no: o ? orderNo(o) : String(r.order_id), key: r.line_key,
          label: r.label ?? line?.label ?? 'Строка удалена из заказа', size: r.label ? '' : line?.size ?? '',  // в снимке размер уже в названии
          qty: r.qty, lineQty: line?.qty ?? r.qty,
          weight: live ? shareOf(line.weight, line.qty, from, r.qty) : Number(r.weight_kg ?? 0),
          amount: money(live ? shareOf(line.amount, line.qty, from, r.qty) : r.amount),
        }
      }),
    }))

    return NextResponse.json({ canMoney, title: SHOWER_GLASS.title, today, orders: views, shipments })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Ошибка загрузки' }, { status: 500 })
  }
}

// Строки запроса сверяем с заказами и с тем, что уже занято другими отгрузками.
async function checkRequests(svc: Svc, requests: LineRequest[], exceptShipment?: number, alreadyInThis?: ItemRow[]): Promise<string | null> {
  if (requests.length === 0) return 'Не выбрано ни одного изделия.'
  const heads = await loadHeads(svc)
  const rows = await loadRows(svc, heads.map(h => h.id))
  const statusById = new Map(heads.map(h => [h.id, h.status]))
  const taken = takenByLine(rows, id => statusById.get(id), exceptShipment)
  const orders = await loadOrders(svc, [...new Set(requests.map(r => Number(r.order_id)))])
  const byId = new Map(orders.map(o => [o.id, o]))
  for (const r of requests) {
    const o = byId.get(Number(r.order_id))
    if (!o) return `Заказ ${r.order_id} не найден.`
    if (Number(o.client_id) !== SHOWER_GLASS.clientId) return `Заказ ${orderNo(o)} другого клиента.`
    const line = shipLines(o).find(l => l.key === r.line_key)
    const already = alreadyInThis?.find(x => x.order_id === o.id && x.line_key === r.line_key)?.qty ?? 0
    const problem = requestProblem(r, line, taken.get(`${o.id}:${r.line_key}`), already)
    if (problem) return `Заказ ${orderNo(o)}. ${problem}`
  }
  return null
}

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

async function draftOf(svc: Svc, id: number): Promise<Head | null> {
  const { data } = await svc.from('delivery_shipments').select('id, ship_date, status, shipped_at, created_at, total_weight_kg, title')
    .eq('id', id).eq('region', REGION).eq('status', 'draft').maybeSingle()
  return (data as Head | null) ?? null
}

export async function POST(req: NextRequest) {
  const guard = await requirePageAccess(PAGE)
  if (guard instanceof NextResponse) return guard
  const user = await getSessionUser()
  if (!user) return fail('Не авторизован', 401)
  const body = await req.json().catch(() => ({})) as {
    action?: string; shipment_id?: number; ship_date?: string; lines?: LineRequest[]; order_id?: number; line_key?: string
  }
  const svc = await serviceAsMe()
  const shipmentId = Number(body.shipment_id)
  const requests = Array.isArray(body.lines)
    ? body.lines.map(l => ({ order_id: Number(l.order_id), line_key: String(l.line_key), qty: Number(l.qty) }))
    : []

  if (body.action === 'create') {
    if (!isDay(body.ship_date)) return fail('Укажите дату отгрузки.')
    const problem = await checkRequests(svc, requests)
    if (problem) return fail(problem, 409)
    const { data: head, error } = await svc.from('delivery_shipments')
      .insert({ region: REGION, title: SHOWER_GLASS.title, ship_date: body.ship_date, status: 'draft', created_by: user.id })
      .select('id').single()
    if (error || !head) return fail(error?.message ?? 'Отгрузка не создана', 500)
    const { error: rowsErr } = await svc.from('delivery_shipment_items').insert(requests.map(r => ({ shipment_id: head.id, ...r })))
    if (rowsErr) {
      await svc.from('delivery_shipments').delete().eq('id', head.id)
      return fail(rowsErr.message, 500)
    }
    return NextResponse.json({ ok: true, id: head.id })
  }

  if (!shipmentId) return fail('Не указана отгрузка.')

  if (body.action === 'add') {
    if (!await draftOf(svc, shipmentId)) return fail('Отгрузка уже отправлена или удалена. Обновите экран.', 409)
    const current = await loadRows(svc, [shipmentId])
    const problem = await checkRequests(svc, requests, shipmentId, current)
    if (problem) return fail(problem, 409)
    const merged = requests.map(r => ({
      shipment_id: shipmentId, ...r,
      qty: r.qty + (current.find(c => c.order_id === r.order_id && c.line_key === r.line_key)?.qty ?? 0),
    }))
    const { error } = await svc.from('delivery_shipment_items').upsert(merged, { onConflict: 'shipment_id,order_id,line_key' })
    if (error) return fail(error.message, 500)
    return NextResponse.json({ ok: true, id: shipmentId })
  }

  if (body.action === 'remove') {
    if (!await draftOf(svc, shipmentId)) return fail('Отгрузка уже отправлена или удалена. Обновите экран.', 409)
    let q = svc.from('delivery_shipment_items').delete().eq('shipment_id', shipmentId).eq('order_id', Number(body.order_id))
    if (body.line_key) q = q.eq('line_key', body.line_key)
    const { data, error } = await q.select('order_id')
    if (error) return fail(error.message, 500)
    if (!data?.length) return fail('Строка уже убрана. Обновите экран.', 409)
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'set_date') {
    if (!isDay(body.ship_date)) return fail('Укажите дату отгрузки.')
    const { data, error } = await svc.from('delivery_shipments').update({ ship_date: body.ship_date })
      .eq('id', shipmentId).eq('region', REGION).eq('status', 'draft').select('id')
    if (error) return fail(error.message, 500)
    if (!data?.length) return fail('Отгрузка уже отправлена или удалена. Обновите экран.', 409)
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'delete') {
    const { data, error } = await svc.from('delivery_shipments').delete()
      .eq('id', shipmentId).eq('region', REGION).eq('status', 'draft').select('id')
    if (error) return fail(error.message, 500)
    if (!data?.length) return fail('Отгрузка уже отправлена или удалена. Обновите экран.', 409)
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'dispatch') {
    const { data: prof } = await svc.from('users').select('name').eq('id', user.id).maybeSingle()
    return dispatch(svc, shipmentId, user.id, (prof as { name: string | null } | null)?.name ?? user.email ?? 'Цех')
  }
  if (body.action === 'undo') return undo(svc, shipmentId, user.id)
  return fail('Неизвестное действие.')
}

async function dispatch(svc: Svc, shipmentId: number, userId: string, who: string) {
  const head = await draftOf(svc, shipmentId)
  if (!head) return fail('Отгрузка уже отправлена или удалена. Обновите экран.', 409)
  const date = head.ship_date
  if (!isDay(date)) return fail('Укажите дату отгрузки.')
  if (date > mskDayKey()) return fail(`Дата отгрузки ${date} ещё не наступила. Отправить можно в день отгрузки.`)

  const current = await loadRows(svc, [shipmentId])
  if (current.length === 0) return fail('В отгрузке нет изделий.')
  const heads = await loadHeads(svc)
  const allRows = await loadRows(svc, heads.map(h => h.id))
  const statusById = new Map(heads.map(h => [h.id, h.status]))
  const taken = takenByLine(allRows, id => statusById.get(id), shipmentId)
  const orders = await loadOrders(svc, [...new Set(current.map(r => r.order_id))])
  const byId = new Map(orders.map(o => [o.id, o]))

  // Снимок: заказ потом могут поправить, а уехавшее уже уехало.
  const snapshot: { order_id: number; line_key: string; label: string; weight_kg: number; amount: number }[] = []
  for (const r of current) {
    const o = byId.get(r.order_id)
    const line = o ? shipLines(o).find(l => l.key === r.line_key) : undefined
    if (!o || !line) return fail(`Заказ ${o ? orderNo(o) : r.order_id}: строки больше нет, заказ изменили. Уберите её из отгрузки.`, 409)
    const shippedBefore = taken.get(`${r.order_id}:${r.line_key}`)?.shipped ?? 0
    if (shippedBefore + r.qty > line.qty) return fail(`Заказ ${orderNo(o)}. ${line.label}: в заказе ${line.qty} шт., уже отгружено ${shippedBefore}.`, 409)
    snapshot.push({
      order_id: r.order_id, line_key: r.line_key, label: line.size ? `${line.label}, ${line.size} мм` : line.label,
      weight_kg: shareOf(line.weight, line.qty, shippedBefore, r.qty),
      amount: shareOf(line.amount, line.qty, shippedBefore, r.qty),
    })
  }

  const nowIso = new Date().toISOString()
  const { data: claimed, error: claimErr } = await svc.from('delivery_shipments')
    .update({ status: 'shipped', shipped_at: nowIso, total_weight_kg: snapshot.reduce((s, x) => s + x.weight_kg, 0) })
    .eq('id', shipmentId).eq('status', 'draft').select('id')
  if (claimErr) return fail(claimErr.message, 500)
  if (!claimed?.length) return fail('Отгрузку уже отправил кто-то другой. Обновите экран.', 409)

  const warnings: string[] = []
  for (const s of snapshot) {
    const { error } = await svc.from('delivery_shipment_items')
      .update({ label: s.label, weight_kg: s.weight_kg, amount: s.amount })
      .eq('shipment_id', shipmentId).eq('order_id', s.order_id).eq('line_key', s.line_key)
    if (error) warnings.push(`Снимок строки заказа ${s.order_id}: ${error.message}`)
  }

  // Заказ, у которого уехало всё, становится отгруженным той датой, что в отгрузке.
  const shippedOrders: number[] = []
  for (const o of orders) {
    const lines = shipLines(o)
    const shippedOf = (key: string) => (taken.get(`${o.id}:${key}`)?.shipped ?? 0) + (current.find(r => r.order_id === o.id && r.line_key === key)?.qty ?? 0)
    if (orderShipState(lines, shippedOf) !== 'full') continue
    const prev = notesOf(o.notes).stages?.shipped ?? null
    const { error: markErr } = await svc.rpc('mark_order_stages', { p_order_id: o.id, p_stages: { shipped: `${date}T12:00:00+03:00` } })
    if (markErr) { warnings.push(`Заказ ${orderNo(o)}: отметка не поставлена, ${markErr.message}`); continue }
    const { error: traceErr } = await svc.rpc('patch_order_notes_shallow', { p_order_id: o.id, p_patch: { client_shipment: { id: shipmentId, date, prev_shipped: prev } } })
    if (traceErr) warnings.push(`Заказ ${orderNo(o)}: след отгрузки не записан, ${traceErr.message}`)
    await svc.from('b2b_orders').update({ updated_by_name: who, updated_at: nowIso }).eq('id', o.id)
    const shop = await closeOpenTasksOnOrderMark(svc, o.id, 'shipped', CASCADE_FROM.shipping.shipped, { id: userId, name: who })
    if (shop.error) warnings.push(`Заказ ${orderNo(o)}: задачи цеха не закрыты, ${shop.error}`)
    shippedOrders.push(o.id)
  }
  return NextResponse.json({ ok: true, shipped_orders: shippedOrders, warnings })
}

async function undo(svc: Svc, shipmentId: number, userId: string) {
  const { data: claimed, error: claimErr } = await svc.from('delivery_shipments')
    .update({ status: 'draft', shipped_at: null, total_weight_kg: null })
    .eq('id', shipmentId).eq('region', REGION).eq('status', 'shipped').select('id')
  if (claimErr) return fail(claimErr.message, 500)
  if (!claimed?.length) return fail('Отгрузка уже не отправлена. Обновите экран.', 409)

  const warnings: string[] = []
  const { error: clearErr } = await svc.from('delivery_shipment_items').update({ label: null, weight_kg: null, amount: null }).eq('shipment_id', shipmentId)
  if (clearErr) warnings.push(`Снимок не снят: ${clearErr.message}`)

  const current = await loadRows(svc, [shipmentId])
  const heads = await loadHeads(svc)
  const allRows = await loadRows(svc, heads.map(h => h.id))
  const statusById = new Map(heads.map(h => [h.id, h.status]))
  const taken = takenByLine(allRows, id => statusById.get(id))
  const orders = await loadOrders(svc, [...new Set(current.map(r => r.order_id))])
  const reverted: number[] = []
  for (const o of orders) {
    const trace = notesOf(o.notes).client_shipment
    if (!trace) continue
    if (orderShipState(shipLines(o), k => taken.get(`${o.id}:${k}`)?.shipped ?? 0) === 'full') continue
    const { error: markErr } = await svc.rpc('mark_order_stages', { p_order_id: o.id, p_stages: { shipped: trace.prev_shipped } })
    if (markErr) { warnings.push(`Заказ ${orderNo(o)}: отметка не снята, ${markErr.message}`); continue }
    const { error: traceErr } = await svc.rpc('patch_order_notes_shallow', { p_order_id: o.id, p_patch: { client_shipment: null } })
    if (traceErr) warnings.push(`Заказ ${orderNo(o)}: след отгрузки не снят, ${traceErr.message}`)
    if (!trace.prev_shipped) {
      const shop = await reopenTasksOnOrderUnmark(svc, o.id, [CASCADE_FROM.shipping.shipped], { id: userId })
      if (shop.error) warnings.push(`Заказ ${orderNo(o)}: задачи цеха не возвращены, ${shop.error}`)
    }
    reverted.push(o.id)
  }
  return NextResponse.json({ ok: true, reverted_orders: reverted, warnings })
}
