import { NextRequest, NextResponse } from 'next/server'
import { requirePageAccess } from '@/lib/apiAuth'
import { getSessionUser, getUserProfile } from '@/lib/getRole'
import { serviceAsMe } from '@/lib/serviceAs'
import { createServiceClient } from '@/lib/supabase-service'
import { CASCADE_FROM } from '@/lib/production/managerCascade'
import { closeOpenTasksOnOrderMark, reopenTasksOnOrderUnmark, syncShippedLineTasks } from '@/lib/production/closeOnOrderMark'
import { readIn, readPaged } from '@/lib/production/paged'
import { applyStageUpdates } from '@/lib/production/syncStages'
import { STAGE_TO_FLAG } from '@/lib/productionOrderMirror'
import { actorName } from '@/lib/production/executor'
import { mskDayKey } from '@/lib/time'
import { isLaunched, isShipped, orderDeadline, type TodayOrder } from '@/lib/b2b/todayPriorities'
import {
  ORDER_HIDDEN_LABEL, SHOWER_GLASS, addEarlier, orderHidden, orderShipState, orderStage, overdueDays, packedLineCount, requestProblem, shareOf, shipLines, takenByLine,
  type EarlierLines, type LineRequest, type ShipOrder, type ShipRow,
} from '@/lib/production/clientShipments'

// Отгрузка Шовер Гласс: заказы и изделия к отгрузке, отгрузки к дате, история.
// Таблица строк закрыта политиками, поэтому чтение и запись только здесь, после проверки роли.
// Сумма уходит только тем, кому положено видеть деньги (canViewMoney). Себестоимости в ответе нет.

const PAGE = '/production-app/shower-glass'
const REGION = SHOWER_GLASS.region
const SHIPPED_MARKS_SINCE = '2026-07-01'
// Кто отмечает этапы мимо очереди цеха: те же роли, что у карточки заказа (sync-stages).
const PACK_ROLES: readonly string[] = ['production', 'admin', 'ceo', 'buyer']

type Svc = ReturnType<typeof createServiceClient>
type RawOrder = ShipOrder & { id: number; custom_number: string | null; client_order_number?: string | null; notes: string | null; created_at: string; launched_at?: string | null; archived_at?: string | null; client_id?: number | null }
type Head = { id: number; ship_date: string | null; status: string; shipped_at: string | null; created_at: string; total_weight_kg: number | null; title: string | null }
type ItemRow = ShipRow & { label: string | null; weight_kg: number | null; amount: number | null }
type Notes = { shipped_earlier?: { lines?: EarlierLines; by?: string; at?: string } | null; ship_rest_off?: boolean | null; status?: string; historical?: boolean; launched_at?: string | null; stages?: Record<string, string | null>; client_shipment?: { id: number; date: string; prev_shipped: string | null } | null }

const ORDER_COLS = 'id, custom_number, client_order_number, items, notes, created_at, launched_at, archived_at, client_id, discount_percent, total_after_discount, total_sale_inc_vat'
const orderNo = (o: { custom_number: string | null; id: number }) => o.custom_number?.trim() || `00${o.id}`
// Дата из notes бывает кривой: один заказ не должен ронять весь экран.
function dayOf(v: Date | string | null | undefined): string | null {
  const t = v ? new Date(v) : null
  return t && !Number.isNaN(t.getTime()) ? mskDayKey(t) : null
}

function notesOf(raw: string | null): Notes {
  try { return raw ? JSON.parse(raw) as Notes : {} } catch { return {} }
}

function withEarlier(taken: ReturnType<typeof takenByLine>, orders: RawOrder[]) {
  for (const o of orders) addEarlier(taken, o.id, notesOf(o.notes).shipped_earlier?.lines)
  return taken
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
      .select(ORDER_COLS).eq('client_id', SHOWER_GLASS.clientId)
      .order('id', { ascending: true }).range(from, to) as never)
    const known = new Set(clientOrders.map(o => o.id))
    const extraIds = [...new Set(rows.map(r => r.order_id))].filter(id => !known.has(id))
    const orders = [...clientOrders, ...await loadOrders(svc, extraIds)]
    const byId = new Map(orders.map(o => [o.id, o]))
    withEarlier(taken, orders)

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
      const hidden = inShipment ? null : orderHidden(o.archived_at, notes)
      const lines = shipLines(o).map(l => {
        const t = taken.get(`${o.id}:${l.key}`) ?? { shipped: 0, drafted: 0 }
        return {
          key: l.key, label: l.label, size: l.size, qty: l.qty, weight: l.weight, amount: money(l.amount),
          shipped: t.shipped, drafted: t.drafted, earlier: t.earlier ?? 0, free: Math.max(0, l.qty - t.shipped - t.drafted),
          packed: !!stages.packaged || packedKeys.has(`${o.id}:${l.index}`),
        }
      })
      const state = orderShipState(lines, k => lines.find(l => l.key === k)?.shipped ?? 0)
      const markedOutside = !!stages.shipped && !notes.client_shipment && !inShipment
      if ((markedOutside || hidden) && o.created_at.slice(0, 10) < SHIPPED_MARKS_SINCE) return []
      const stage = orderStage(lines, state, isShipped(notes))
      // Срок только у запущенного: у незапущенного он считался бы от даты создания, а это выдумка.
      const asToday = o as unknown as TodayOrder
      const deadlineDay = !hidden && isLaunched(asToday, notes) ? dayOf(orderDeadline(asToday, notes)) : null
      return [{
        id: o.id, no: orderNo(o), launch_day: dayOf(o.launched_at ?? notes.launched_at) ?? o.created_at.slice(0, 10), deadline_day: deadlineDay,
        overdue_days: overdueDays(deadlineDay, today, stage), paid: !!stages.invoice_paid, state, stage, packed_lines: packedLineCount(lines),
        marked_day: typeof stages.shipped === 'string' ? dayOf(stages.shipped) : null, marked_outside: markedOutside,
        hidden, archived_day: dayOf(o.archived_at), rest_off: !!notes.ship_rest_off, lines,
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
          order_id: r.order_id, order_no: o ? orderNo(o) : String(r.order_id), client_no: o?.client_order_number?.trim() || null, key: r.line_key,
          label: r.label ?? line?.label ?? 'Строка удалена из заказа', size: r.label ? '' : line?.size ?? '',  // в снимке размер уже в названии
          qty: r.qty, lineQty: line?.qty ?? r.qty,
          weight: live ? shareOf(line.weight, line.qty, from, r.qty) : Number(r.weight_kg ?? 0),
          amount: money(live ? shareOf(line.amount, line.qty, from, r.qty) : r.amount),
        }
      }),
    }))

    return NextResponse.json({ canMoney, canPack: PACK_ROLES.includes(guard), title: SHOWER_GLASS.title, today, orders: views, shipments })
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
  withEarlier(taken, orders)
  const byId = new Map(orders.map(o => [o.id, o]))
  for (const r of requests) {
    const o = byId.get(Number(r.order_id))
    if (!o) return `Заказ ${r.order_id} не найден.`
    if (Number(o.client_id) !== SHOWER_GLASS.clientId) return `Заказ ${orderNo(o)} другого клиента.`
    const hidden = orderHidden(o.archived_at, notesOf(o.notes))
    if (hidden) return `Заказ ${orderNo(o)}: ${ORDER_HIDDEN_LABEL[hidden].toLowerCase()}, в отгрузку не идёт.`
    const line = shipLines(o).find(l => l.key === r.line_key)
    const already = alreadyInThis?.find(x => x.order_id === o.id && x.line_key === r.line_key)?.qty ?? 0
    const problem = requestProblem(r, line, taken.get(`${o.id}:${r.line_key}`), already)
    if (problem) return `Заказ ${orderNo(o)}. ${problem}`
  }
  return null
}

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

async function whoOf(svc: Svc, user: { id: string; email?: string | null }): Promise<string> {
  const { data: prof } = await svc.from('users').select('name').eq('id', user.id).maybeSingle()
  return (prof as { name: string | null } | null)?.name ?? user.email ?? 'Цех'
}

async function headOf(svc: Svc, id: number): Promise<Head | null> {
  const { data } = await svc.from('delivery_shipments').select('id, ship_date, status, shipped_at, created_at, total_weight_kg, title')
    .eq('id', id).eq('region', REGION).maybeSingle()
  return (data as Head | null) ?? null
}

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
    action?: string; shipment_id?: number; ship_date?: string; lines?: LineRequest[]; order_id?: number; line_key?: string; show?: boolean
  }
  const svc = await serviceAsMe()
  const shipmentId = Number(body.shipment_id)
  const requests = Array.isArray(body.lines)
    ? body.lines.map(l => ({ order_id: Number(l.order_id), line_key: String(l.line_key), qty: Number(l.qty) }))
    : []

  if (body.action === 'pack' || body.action === 'unpack') {
    if (!PACK_ROLES.includes(guard)) return fail('Отмечать упаковку может цех или владелец.', 403)
    return packLine(svc, body.action, Number(body.order_id), String(body.line_key ?? ''), { id: user.id, email: user.email })
  }

  if (body.action === 'earlier' || body.action === 'rest') {
    if (!PACK_ROLES.includes(guard)) return fail('Это отмечает цех или владелец.', 403)
    const [order] = await loadOrders(svc, [Number(body.order_id)])
    if (!order) return fail('Заказ не найден.', 404)
    if (Number(order.client_id) !== SHOWER_GLASS.clientId) return fail(`Заказ ${orderNo(order)} другого клиента.`, 409)
    if (body.action === 'rest') {
      const { error } = await svc.rpc('patch_order_notes_shallow', { p_order_id: order.id, p_patch: { ship_rest_off: body.show === false ? true : null } })
      if (error) return fail(error.message, 500)
      return NextResponse.json({ ok: true })
    }
    return markEarlier(svc, order, shipmentId, requests, user.id, await whoOf(svc, user))
  }

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
    const head = await headOf(svc, shipmentId)
    if (!head) return fail('Отгрузка удалена. Обновите экран.', 409)
    const current = await loadRows(svc, [shipmentId])
    const problem = await checkRequests(svc, requests, shipmentId, current)
    if (problem) return fail(problem, 409)
    if (head.status === 'shipped') return addToSent(svc, head, requests, current, user.id, await whoOf(svc, user))
    const merged = requests.map(r => ({
      shipment_id: shipmentId, ...r,
      qty: r.qty + (current.find(c => c.order_id === r.order_id && c.line_key === r.line_key)?.qty ?? 0),
    }))
    const { error } = await svc.from('delivery_shipment_items').upsert(merged, { onConflict: 'shipment_id,order_id,line_key' })
    if (error) return fail(error.message, 500)
    return NextResponse.json({ ok: true, id: shipmentId })
  }

  if (body.action === 'remove') {
    const head = await headOf(svc, shipmentId)
    if (!head) return fail('Отгрузка удалена. Обновите экран.', 409)
    if (head.status === 'shipped') return removeFromSent(svc, head, Number(body.order_id), String(body.line_key ?? ''), user.id)
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
    return dispatch(svc, shipmentId, user.id, await whoOf(svc, user))
  }
  if (body.action === 'undo') return undo(svc, shipmentId, user.id)
  return fail('Неизвестное действие.')
}

// Кнопка у позиции. Запись та же, что у карточки заказа: задача упаковки, каскад резки и закалки,
// склад, зеркала. Снятие возвращает ровно то, что закрыла эта отметка.
async function packLine(svc: Svc, action: 'pack' | 'unpack', orderId: number, lineKey: string, user: { id: string; email?: string | null }) {
  const [order] = await loadOrders(svc, [orderId])
  if (!order) return fail('Заказ не найден.', 404)
  if (Number(order.client_id) !== SHOWER_GLASS.clientId) return fail(`Заказ ${orderNo(order)} другого клиента.`, 409)
  const notes = notesOf(order.notes)
  if (isShipped(notes)) return fail(`Заказ ${orderNo(order)} уже отгружен, упаковку не меняем. Обновите экран.`, 409)
  const hiddenReason = orderHidden(order.archived_at, notes)
  if (hiddenReason) return fail(`Заказ ${orderNo(order)}: ${ORDER_HIDDEN_LABEL[hiddenReason].toLowerCase()}, упаковку не меняем.`, 409)
  const line = shipLines(order).find(l => l.key === lineKey)
  if (!line) return fail('Строка не найдена, заказ могли изменить. Обновите экран.', 409)

  if (action === 'unpack') {
    const heads = await loadHeads(svc)
    const rows = await loadRows(svc, heads.map(h => h.id))
    const statusById = new Map(heads.map(h => [h.id, h.status]))
    const t = withEarlier(takenByLine(rows, id => statusById.get(id)), [order]).get(`${orderId}:${lineKey}`)
    if (t && t.shipped + t.drafted > 0) return fail(`${line.label}: изделие уже в отгрузке, сначала уберите его оттуда.`, 409)
  }

  const { data: prof } = await svc.from('users').select('name').eq('id', user.id).maybeSingle()
  const actor = { id: user.id, email: user.email, name: actorName((prof as { name: string | null } | null)?.name, user.email) }
  const res = await applyStageUpdates(svc, orderId, [{ item_index: line.index, stage_key: 'packaging', action: action === 'pack' ? 'done' : 'unset' }], actor)
  if (res.failed.length) return fail(`Не записалось: ${res.failed.join('; ')}`, 500)
  if (res.updated === 0) return fail(`${line.label}: у позиции нет задачи упаковки в цехе. Заказ запущен в цех?`, 409)

  const now = new Date().toISOString()
  const status = action === 'pack' ? 'done' : 'queued'
  const entry = { status, updated_at: now, updated_by: user.id, ...(action === 'pack' ? { updated_by_email: user.email ?? undefined } : {}) }
  const back = res.reopened.flatMap(r => r.stages)
  const warnings: string[] = []
  const { error: detailErr } = await svc.rpc('mark_detail_stages', {
    p_order_id: orderId,
    p_updates: ['packaging', ...back].map((stage, i) => ({ item: String(line.index), stage, entry: i === 0 ? entry : { ...entry, auto: true } })),
  })
  if (detailErr) warnings.push(`Карточка заказа не обновилась: ${detailErr.message}`)

  // Зеркало заказа только продвигает флаги: снятую упаковку и вернувшиеся этапы снимаем сами,
  // иначе заказ остался бы «упакован» с неупакованной позицией.
  if (action === 'unpack') {
    const stages = notes.stages ?? {}
    const clear = Object.fromEntries(['packaging', ...back].map(k => STAGE_TO_FLAG[k]).filter(f => f && stages[f]).map(f => [f, null]))
    if (Object.keys(clear).length) {
      const { error } = await svc.rpc('mark_order_stages', { p_order_id: orderId, p_stages: clear })
      if (error) warnings.push(`Отметка заказа не снята: ${error.message}`)
    }
  }
  return NextResponse.json({ ok: true, cascaded: res.cascaded.length, reopened: back.length, warnings })
}

// Уехавшая целиком позиция закрывает свои этапы в цехе, убранная из отгрузки получает их назад (владелец 12.11).
async function syncLines(svc: Svc, orderIds: number[], shippedOf: (orderId: number, key: string) => number, actor: { id: string; name?: string | null }, warnings: string[]) {
  for (const id of new Set(orderIds)) {
    const res = await syncShippedLineTasks(svc, id, key => shippedOf(id, key), actor)
    if (res.error) warnings.push(`Заказ ${id}: этапы цеха по отгруженным позициям не обновлены, ${res.error}`)
  }
}

// Заказ, у которого уехало всё, становится отгруженным той датой, что в отгрузке.
async function markFullOrders(
  svc: Svc, orders: RawOrder[], shipmentId: number, date: string,
  shippedOf: (orderId: number, key: string) => number, userId: string, who: string, nowIso: string, warnings: string[],
): Promise<number[]> {
  const out: number[] = []
  for (const o of orders) {
    if (orderShipState(shipLines(o), key => shippedOf(o.id, key)) !== 'full') continue
    const prev = notesOf(o.notes).stages?.shipped ?? null
    const { error: markErr } = await svc.rpc('mark_order_stages', { p_order_id: o.id, p_stages: { shipped: `${date}T12:00:00+03:00` } })
    if (markErr) { warnings.push(`Заказ ${orderNo(o)}: отметка не поставлена, ${markErr.message}`); continue }
    const { error: traceErr } = await svc.rpc('patch_order_notes_shallow', { p_order_id: o.id, p_patch: { client_shipment: { id: shipmentId, date, prev_shipped: prev, by: who, at: nowIso } } })
    if (traceErr) warnings.push(`Заказ ${orderNo(o)}: след отгрузки не записан, ${traceErr.message}`)
    await svc.from('b2b_orders').update({ updated_by_name: who, updated_at: nowIso }).eq('id', o.id)
    const shop = await closeOpenTasksOnOrderMark(svc, o.id, 'shipped', CASCADE_FROM.shipping.shipped, { id: userId, name: who })
    if (shop.error) warnings.push(`Заказ ${orderNo(o)}: задачи цеха не закрыты, ${shop.error}`)
    out.push(o.id)
  }
  return out
}

// Заказ перестал быть уехавшим целиком: возвращаем прежнюю отметку. Только тем, кого отметила отгрузка (след).
async function revertOrders(svc: Svc, orders: RawOrder[], taken: ReturnType<typeof takenByLine>, userId: string, warnings: string[]): Promise<number[]> {
  const out: number[] = []
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
    out.push(o.id)
  }
  return out
}

const money2 = (n: number) => Math.round(n * 100) / 100

// Отмечаем, что часть заказа уехала раньше учёта: только из отправленной отгрузки, где заказ есть.
// Заказ, который этим закрылся, становится отгруженным её датой; снятая галочка возвращает прежнюю отметку.
async function markEarlier(svc: Svc, order: RawOrder, shipmentId: number, requests: LineRequest[], userId: string, who: string) {
  const head = await headOf(svc, shipmentId)
  if (!head || head.status !== 'shipped' || !isDay(head.ship_date)) return fail('Отгрузка не отправлена или удалена. Обновите экран.', 409)
  const heads = await loadHeads(svc)
  const allRows = await loadRows(svc, heads.map(h => h.id))
  if (!allRows.some(r => r.shipment_id === head.id && r.order_id === order.id)) return fail(`Заказа ${orderNo(order)} нет в этой отгрузке. Обновите экран.`, 409)
  const statusById = new Map(heads.map(h => [h.id, h.status]))
  const inShipments = takenByLine(allRows, id => statusById.get(id))
  const lines = shipLines(order)

  const notes = notesOf(order.notes)
  const next: EarlierLines = { ...notes.shipped_earlier?.lines }
  for (const r of requests) {
    const line = lines.find(l => l.key === r.line_key)
    if (!line) return fail('Строка не найдена, заказ могли изменить. Обновите экран.', 409)
    if (!Number.isInteger(r.qty) || r.qty < 0) return fail(`${line.label}: количество должно быть целым.`)
    const t = inShipments.get(`${order.id}:${r.line_key}`)
    const room = line.qty - (t?.shipped ?? 0) - (t?.drafted ?? 0)
    if (r.qty > room) return fail(`${line.label}: раньше могло уехать не больше ${Math.max(0, room)} шт., остальное уже в отгрузках.`, 409)
    if (r.qty === 0) delete next[r.line_key]
    else next[r.line_key] = r.qty
  }
  const hasAny = Object.keys(next).length > 0
  const { error } = await svc.rpc('patch_order_notes_shallow', {
    p_order_id: order.id,
    p_patch: { shipped_earlier: hasAny ? { lines: next, by: who, at: new Date().toISOString() } : null },
  })
  if (error) return fail(error.message, 500)

  const warnings: string[] = []
  const [fresh] = await loadOrders(svc, [order.id])
  const taken = withEarlier(inShipments, [fresh])
  const shippedOf = (orderId: number, key: string) => taken.get(`${orderId}:${key}`)?.shipped ?? 0
  const full = orderShipState(lines, key => shippedOf(order.id, key)) === 'full'
  // След уже есть: заказ закрыт отгрузкой раньше, второй раз отмечать нельзя, иначе потеряется прежняя дата.
  const shipped = full && !notesOf(fresh.notes).client_shipment
    ? await markFullOrders(svc, [fresh], head.id, head.ship_date as string, shippedOf, userId, who, new Date().toISOString(), warnings)
    : []
  const reverted = full ? [] : await revertOrders(svc, [fresh], taken, userId, warnings)
  await syncLines(svc, [order.id], shippedOf, { id: userId, name: who }, warnings)
  return NextResponse.json({ ok: true, shipped_orders: shipped, reverted_orders: reverted, warnings })
}

// Довезли изделие в уже отправленной отгрузке: строка сразу со снимком веса и суммы, заказ — по факту уехавшего.
async function addToSent(svc: Svc, head: Head, requests: LineRequest[], current: ItemRow[], userId: string, who: string) {
  const date = head.ship_date
  if (!isDay(date)) return fail('У отгрузки нет даты.')
  const heads = await loadHeads(svc)
  const allRows = await loadRows(svc, heads.map(h => h.id))
  const statusById = new Map(heads.map(h => [h.id, h.status]))
  const taken = takenByLine(allRows, id => statusById.get(id), head.id)
  const orders = await loadOrders(svc, [...new Set(requests.map(r => r.order_id))])
  const byId = new Map(orders.map(o => [o.id, o]))
  withEarlier(taken, orders)

  const merged = requests.map(r => {
    const o = byId.get(r.order_id)!
    const line = shipLines(o).find(l => l.key === r.line_key)!
    const cur = current.find(c => c.order_id === r.order_id && c.line_key === r.line_key)
    const before = (taken.get(`${r.order_id}:${r.line_key}`)?.shipped ?? 0) + (cur?.qty ?? 0)
    return {
      shipment_id: head.id, order_id: r.order_id, line_key: r.line_key, qty: r.qty + (cur?.qty ?? 0),
      label: cur?.label ?? (line.size ? `${line.label}, ${line.size} мм` : line.label),
      weight_kg: money2(Number(cur?.weight_kg ?? 0) + shareOf(line.weight, line.qty, before, r.qty)),
      amount: money2(Number(cur?.amount ?? 0) + shareOf(line.amount, line.qty, before, r.qty)),
    }
  })
  const { error } = await svc.from('delivery_shipment_items').upsert(merged, { onConflict: 'shipment_id,order_id,line_key' })
  if (error) return fail(error.message, 500)

  const warnings: string[] = []
  const after = [...current.filter(c => !merged.some(m => m.order_id === c.order_id && m.line_key === c.line_key)), ...merged]
  const { error: totalErr } = await svc.from('delivery_shipments')
    .update({ total_weight_kg: money2(after.reduce((sum, x) => sum + Number(x.weight_kg ?? 0), 0)) }).eq('id', head.id)
  if (totalErr) warnings.push(`Итоговый вес не обновлён: ${totalErr.message}`)

  const shippedOf = (orderId: number, key: string) => (taken.get(`${orderId}:${key}`)?.shipped ?? 0) + (after.find(x => x.order_id === orderId && x.line_key === key)?.qty ?? 0)
  const shippedOrders = await markFullOrders(svc, orders, head.id, date, shippedOf, userId, who, new Date().toISOString(), warnings)
  await syncLines(svc, orders.map(o => o.id), shippedOf, { id: userId, name: who }, warnings)
  return NextResponse.json({ ok: true, id: head.id, shipped_orders: shippedOrders, warnings })
}

// Убрали строку из отправленной: изделие снова свободно, заказ, переставший быть целиком уехавшим, теряет отметку.
async function removeFromSent(svc: Svc, head: Head, orderId: number, lineKey: string, userId: string) {
  if (!lineKey) return fail('Не указана строка.')
  const { data, error } = await svc.from('delivery_shipment_items').delete()
    .eq('shipment_id', head.id).eq('order_id', orderId).eq('line_key', lineKey).select('order_id')
  if (error) return fail(error.message, 500)
  if (!data?.length) return fail('Строка уже убрана. Обновите экран.', 409)

  const warnings: string[] = []
  const heads = await loadHeads(svc)
  const allRows = await loadRows(svc, heads.map(h => h.id))
  const statusById = new Map(heads.map(h => [h.id, h.status]))
  const orders = await loadOrders(svc, [orderId])
  const taken = withEarlier(takenByLine(allRows, id => statusById.get(id)), orders)
  const reverted = await revertOrders(svc, orders, taken, userId, warnings)
  await syncLines(svc, [orderId], (id, key) => taken.get(`${id}:${key}`)?.shipped ?? 0, { id: userId }, warnings)

  const left = allRows.filter(r => r.shipment_id === head.id)
  if (left.length === 0) {
    const { error: delErr } = await svc.from('delivery_shipments').delete().eq('id', head.id).eq('status', 'shipped')
    if (delErr) warnings.push(`Пустая отгрузка не удалена: ${delErr.message}`)
    return NextResponse.json({ ok: true, deleted: !delErr, reverted_orders: reverted, warnings })
  }
  const { error: totalErr } = await svc.from('delivery_shipments')
    .update({ total_weight_kg: money2(left.reduce((sum, x) => sum + Number(x.weight_kg ?? 0), 0)) }).eq('id', head.id)
  if (totalErr) warnings.push(`Итоговый вес не обновлён: ${totalErr.message}`)
  return NextResponse.json({ ok: true, reverted_orders: reverted, warnings })
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
  withEarlier(taken, orders)

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
    .update({ status: 'shipped', shipped_at: nowIso, shipped_by: userId, shipped_by_name: who, total_weight_kg: snapshot.reduce((s, x) => s + x.weight_kg, 0) })
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

  const shippedOf = (orderId: number, key: string) => (taken.get(`${orderId}:${key}`)?.shipped ?? 0) + (current.find(r => r.order_id === orderId && r.line_key === key)?.qty ?? 0)
  const shippedOrders = await markFullOrders(svc, orders, shipmentId, date, shippedOf, userId, who, nowIso, warnings)
  await syncLines(svc, orders.map(o => o.id), shippedOf, { id: userId, name: who }, warnings)
  return NextResponse.json({ ok: true, shipped_orders: shippedOrders, warnings })
}

async function undo(svc: Svc, shipmentId: number, userId: string) {
  const { data: claimed, error: claimErr } = await svc.from('delivery_shipments')
    .update({ status: 'draft', shipped_at: null, shipped_by: null, shipped_by_name: null, total_weight_kg: null })
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
  withEarlier(taken, orders)
  const reverted = await revertOrders(svc, orders, taken, userId, warnings)
  await syncLines(svc, orders.map(o => o.id), (id, key) => taken.get(`${id}:${key}`)?.shipped ?? 0, { id: userId }, warnings)
  return NextResponse.json({ ok: true, reverted_orders: reverted, warnings })
}
