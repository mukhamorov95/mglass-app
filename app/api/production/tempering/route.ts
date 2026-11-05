import { NextRequest, NextResponse } from 'next/server'
import { requirePageAccess } from '@/lib/apiAuth'
import { getSessionUser, getUserProfile } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { actorName, buildSyncDonePatch } from '@/lib/production/executor'
import { readIn, readPaged } from '@/lib/production/paged'
import { applyRework, unmirrorReopenedStages } from '@/lib/production/reworkApply'
import { consumeCutting, loadCascadedTasks, reverseCutting } from '@/lib/production/consumeBridge'
import { cascadePriorStages } from '@/lib/productionCascade'
import { mirrorOrderStages } from '@/lib/productionOrderMirror'
import { PRODUCTION_STAGES } from '@/lib/productionStages'
import { reopenedStageEntries, type ReworkTask } from '@/lib/production/rework'
import { loadB2BRates } from '@/lib/b2b/rates'
import { findOrders } from '@/lib/b2b/findOrders'
import { isLaunched, isShipped, orderDeadline, type TodayOrder } from '@/lib/b2b/todayPriorities'
import { daysInWork } from '@/lib/b2b/inWorkOrders'
import { mskDayKey } from '@/lib/time'
import { ORDER_HIDDEN_LABEL, orderHidden, type ShipOrder } from '@/lib/production/clientShipments'
import {
  receiveProblem, rowOutstanding, temperFree, temperKey, temperLines, temperRequestProblem, temperSnapshot, temperTaken,
  type TemperLine, type TemperRates, type TemperRequest, type TemperRow,
} from '@/lib/production/tempering'

// Закалка: лист на закалку из заказов и изделий, отправка, приёмка, бой, история.
// Таблицы закрыты RLS, поэтому чтение и запись только здесь, после проверки роли: только цех и владелец,
// менеджер чужих заказов здесь не видит. Деньги уходят только тем, кому положено (canViewMoney).

const PAGE = '/production-app/tempering'
const ROLES: readonly string[] = ['production', 'admin', 'ceo', 'buyer']
const SENT_FROM = 'tempering_sent'

type Svc = ReturnType<typeof createServiceClient>
type RawOrder = ShipOrder & {
  id: number; custom_number: string | null; client_name: string | null; notes: string | null; created_at: string
  launched_at?: string | null; archived_at?: string | null
}
type Head = { id: number; batch_date: string; status: 'draft' | 'sent'; created_at: string; sent_at: string | null; sent_by_name: string | null }
type Notes = { status?: string; historical?: boolean; launched_at?: string | null; stages?: Record<string, string | null> }
type Task = { id: number; order_id: number; item_index: number; stage_key: string; sequence_order: number; status: string; layer: number | null; started_at: string | null; rework_count: number | null }
type Actor = { id: string; name: string | null; email?: string | null }

const ORDER_COLS = 'id, custom_number, client_name, items, notes, created_at, launched_at, archived_at, discount_percent, total_after_discount, total_sale_inc_vat'
const TASK_COLS = 'id, order_id, item_index, stage_key, sequence_order, status, layer, started_at, rework_count'
const ROW_COLS = 'id, batch_id, order_id, line_key, layer, item_index, qty, order_no, material, thickness, width, height, area_m2, weight_kg, rate_per_m2, cost, transport, amount, returned_qty, broken_qty, received_at, received_by_name'

const orderNo = (o: { custom_number: string | null; id: number }) => o.custom_number?.trim() || `00${o.id}`
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const stageLabel = (key: string) => PRODUCTION_STAGES.find(s => s.key === key)?.label ?? key

function notesOf(raw: string | null): Notes {
  try { return raw ? JSON.parse(raw) as Notes : {} } catch { return {} }
}
function dayOf(v: Date | string | null | undefined): string | null {
  const t = v ? new Date(v) : null
  return t && !Number.isNaN(t.getTime()) ? mskDayKey(t) : null
}

async function loadHeads(svc: Svc): Promise<Head[]> {
  const { data, error } = await svc.from('tempering_batches').select('id, batch_date, status, created_at, sent_at, sent_by_name').order('id', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as Head[]
}
async function loadRows(svc: Svc): Promise<TemperRow[]> {
  return readPaged<TemperRow>((from, to) => svc.from('tempering_batch_items').select(ROW_COLS).order('id', { ascending: true }).range(from, to) as never)
}
async function loadOrders(svc: Svc, ids: number[]): Promise<RawOrder[]> {
  return readIn<RawOrder, number>(ids, (part, from, to) => svc.from('b2b_orders').select(ORDER_COLS).in('id', part).range(from, to) as never)
}
async function loadTasks(svc: Svc, ids: number[]): Promise<Task[]> {
  return readIn<Task, number>(ids, (part, from, to) => svc.from('production_tasks').select(TASK_COLS).in('order_id', part).range(from, to) as never)
}

const temperTaskOf = (tasks: Task[], orderId: number, index: number, layer: number) =>
  tasks.find(t => t.order_id === orderId && t.item_index === index && t.stage_key === 'tempering' && (t.layer ?? 1) === layer)
    ?? tasks.find(t => t.order_id === orderId && t.item_index === index && t.stage_key === 'tempering' && !t.layer)

// Что до закалки ещё не отмечено: отправка закроет это сама, и экран говорит об этом заранее.
function openBefore(tasks: Task[], temper: Task | undefined): string[] {
  if (!temper) return []
  const own = tasks.filter(t => t.order_id === temper.order_id && t.item_index === temper.item_index)
  return own.filter(t => t.sequence_order < temper.sequence_order && t.status !== 'done' && (!t.layer || !temper.layer || t.layer === temper.layer))
    .sort((a, b) => a.sequence_order - b.sequence_order).map(t => stageLabel(t.stage_key))
}

export async function GET(req: NextRequest) {
  const guard = await requirePageAccess(PAGE)
  if (guard instanceof NextResponse) return guard
  if (!ROLES.includes(guard)) return fail('Закалку ведёт цех и владелец.', 403)
  const profile = await getUserProfile()
  const canMoney = profile?.canViewMoney === true
  const svc = createServiceClient()

  try {
    const [heads, rows] = await Promise.all([loadHeads(svc), loadRows(svc)])
    const statusById = new Map(heads.map(h => [h.id, h.status]))
    const taken = temperTaken(rows, id => statusById.get(id))
    const today = mskDayKey()

    const lineView = (o: RawOrder, l: TemperLine, tasks: Task[]) => {
      const t = taken.get(temperKey(o.id, l.key, l.layer))
      const task = temperTaskOf(tasks, o.id, l.index, l.layer)
      return {
        key: l.key, layer: l.layer, material: l.material, thickness: l.thickness, width: l.width, height: l.height, qty: l.qty, area: l.area, weight: l.weight,
        free: temperFree(l.qty, t), drafted: t?.drafted ?? 0, away: t?.away ?? 0, returned: t?.returned ?? 0, broken: t?.broken ?? 0,
        task: !task ? 'none' as const : task.status === 'done' ? 'done' as const : 'open' as const,
        before: openBefore(tasks, task),
      }
    }

    const find = req.nextUrl.searchParams.get('find')?.trim()
    if (find) {
      const found = await findOrders(svc, find)
      const ids = found.map(f => f.id)
      const [orders, tasks] = await Promise.all([loadOrders(svc, ids), loadTasks(svc, ids)])
      return NextResponse.json({
        found: found.map(f => {
          const o = orders.find(x => x.id === f.id)
          const notes = o ? notesOf(o.notes) : {}
          return {
            id: f.id, no: f.no, client: f.client, status: f.status,
            blocked: !o || !!orderHidden(o.archived_at, notes) || isShipped(notes),
            lines: o ? temperLines(o).map(l => lineView(o, l, tasks)) : [],
          }
        }),
      })
    }

    const openIds = await readPaged<{ id: number; order_id: number }>((from, to) => svc.from('production_tasks')
      .select('id, order_id').eq('stage_key', 'tempering').neq('status', 'done').order('id', { ascending: true }).range(from, to) as never)
    const poolIds = [...new Set(openIds.map(t => t.order_id))]
    const [orders, tasks, ratesRes] = await Promise.all([loadOrders(svc, poolIds), loadTasks(svc, poolIds), loadB2BRates(svc)])

    const pool = orders.flatMap(o => {
      const notes = notesOf(o.notes)
      if (orderHidden(o.archived_at, notes) || isShipped(notes)) return []
      const lines = temperLines(o).map(l => lineView(o, l, tasks))
      if (!lines.some(l => l.free > 0 && l.task === 'open')) return []
      const asToday = o as unknown as TodayOrder
      const deadline = isLaunched(asToday, notes) ? dayOf(orderDeadline(asToday, notes)) : null
      return [{
        id: o.id, no: orderNo(o), client: o.client_name,
        launch_day: dayOf(o.launched_at ?? notes.launched_at) ?? o.created_at.slice(0, 10),
        deadline_day: deadline, overdue_days: deadline ? daysInWork(deadline, today) : 0, lines,
      }]
    })

    const batches = heads.map(h => ({
      ...h,
      lines: rows.filter(r => r.batch_id === h.id).map(r => ({
        ...r,
        area_m2: Number(r.area_m2), weight_kg: Number(r.weight_kg), thickness: r.thickness == null ? null : Number(r.thickness),
        width: r.width == null ? null : Number(r.width), height: r.height == null ? null : Number(r.height),
        rate_per_m2: canMoney && r.rate_per_m2 != null ? Number(r.rate_per_m2) : null,
        cost: canMoney && r.cost != null ? Number(r.cost) : null,
        no_rate: r.cost == null,
        transport: canMoney ? Number(r.transport) : 0,
        amount: canMoney ? Number(r.amount) : 0,
      })),
    }))

    return NextResponse.json({ canMoney, today, pool, batches, ratesMissing: ratesRes.missing })
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Не удалось загрузить закалку', 500)
  }
}

function parseRequests(raw: unknown): TemperRequest[] {
  if (!Array.isArray(raw)) return []
  return raw.map(r => {
    const x = r as Record<string, unknown>
    return { order_id: Number(x.order_id), line_key: String(x.line_key ?? ''), layer: Number(x.layer) || 1, qty: Number(x.qty) }
  })
}

// Снимок на момент действия: название, размер и деньги в истории не плывут за правками заказа.
function snapshotRows(batchId: number, requests: TemperRequest[], orders: RawOrder[], rates: TemperRates, current: TemperRow[], taken: ReturnType<typeof temperTaken>) {
  return requests.map(r => {
    const o = orders.find(x => x.id === r.order_id)!
    const line = temperLines(o).find(l => l.key === r.line_key && l.layer === r.layer)!
    const cur = current.find(c => c.order_id === r.order_id && c.line_key === r.line_key && c.layer === r.layer)
    const t = taken.get(temperKey(r.order_id, r.line_key, r.layer))
    const qty = r.qty + (cur?.qty ?? 0)
    const from = (t?.drafted ?? 0) + (t?.away ?? 0) + (t?.returned ?? 0)
    return {
      batch_id: batchId, order_id: r.order_id, line_key: r.line_key, layer: r.layer, item_index: line.index, qty,
      order_no: orderNo(o), material: line.material, thickness: line.thickness, width: line.width, height: line.height,
      ...temperSnapshot(line, qty, rates, Math.max(0, Math.min(from, line.qty - qty))),
    }
  })
}

async function checkRequests(svc: Svc, requests: TemperRequest[], taken: ReturnType<typeof temperTaken>, current: TemperRow[]) {
  if (requests.length === 0) return { problem: 'Не выбрано ни одного изделия.', orders: [] as RawOrder[] }
  const orders = await loadOrders(svc, [...new Set(requests.map(r => r.order_id))])
  for (const r of requests) {
    const o = orders.find(x => x.id === r.order_id)
    if (!o) return { problem: `Заказ ${r.order_id} не найден.`, orders }
    const notes = notesOf(o.notes)
    const hidden = orderHidden(o.archived_at, notes)
    if (hidden) return { problem: `Заказ ${orderNo(o)}: ${ORDER_HIDDEN_LABEL[hidden].toLowerCase()}, на закалку не идёт.`, orders }
    if (isShipped(notes)) return { problem: `Заказ ${orderNo(o)} уже отгружен, на закалку не идёт.`, orders }
    const line = temperLines(o).find(l => l.key === r.line_key && l.layer === r.layer)
    const already = current.find(c => c.order_id === r.order_id && c.line_key === r.line_key && c.layer === r.layer)?.qty ?? 0
    // current входит в taken только у чужой партии: свою партию считаем отдельно.
    const problem = temperRequestProblem(r, line, taken.get(temperKey(r.order_id, r.line_key, r.layer)), already)
    if (problem) return { problem: `Заказ ${orderNo(o)}. ${problem}`, orders }
  }
  return { problem: null, orders }
}

// Уехало: закалка началась, а всё, что до неё, сделано — если строка уехала целиком.
async function afterSent(svc: Svc, rows: Pick<TemperRow, 'order_id' | 'line_key' | 'layer' | 'item_index'>[], actor: Actor, warnings: string[]) {
  const now = new Date().toISOString()
  const orderIds = [...new Set(rows.map(r => r.order_id))]
  const [tasks, orders, heads, all] = await Promise.all([loadTasks(svc, orderIds), loadOrders(svc, orderIds), loadHeads(svc), loadRows(svc)])
  const statusById = new Map(heads.map(h => [h.id, h.status]))
  const taken = temperTaken(all, id => statusById.get(id))
  for (const orderId of orderIds) {
    const order = orders.find(o => o.id === orderId)
    const entries: Record<string, unknown>[] = []
    for (const r of rows.filter(x => x.order_id === orderId)) {
      const task = temperTaskOf(tasks, orderId, r.item_index, r.layer)
      if (!task) { warnings.push(`Заказ ${order ? orderNo(order) : orderId}: у позиции ${r.item_index + 1} нет этапа закалки в цехе.`); continue }
      if (task.status === 'queued') {
        const { error } = await svc.from('production_tasks')
          .update({ status: 'in_progress', started_at: now, started_by: actor.id, started_by_name: actor.name, started_via: 'button' }).eq('id', task.id)
        if (error) warnings.push(`Заказ ${order ? orderNo(order) : orderId}: закалка не отмечена начатой, ${error.message}`)
      }
      const line = order ? temperLines(order).find(l => l.key === r.line_key && l.layer === r.layer) : undefined
      const t = taken.get(temperKey(orderId, r.line_key, r.layer))
      if (!line || (t?.away ?? 0) + (t?.returned ?? 0) < line.qty) continue
      const keys = await cascadePriorStages(svc, orderId, r.item_index, task.sequence_order, now, { id: actor.id, name: actor.name, stage: SENT_FROM })
      if (keys.length === 0) continue
      await consumeCutting(orderId, await loadCascadedTasks(svc, orderId, r.item_index, keys), 'cascade', { userId: actor.id, name: actor.name ?? undefined })
      for (const stage of keys) entries.push({ item: String(r.item_index), stage, entry: { status: 'done', updated_at: now, updated_by: actor.id, updated_by_email: actor.email ?? undefined, auto: true } })
    }
    if (entries.length) {
      const { error } = await svc.rpc('mark_detail_stages', { p_order_id: orderId, p_updates: entries })
      if (error) warnings.push(`Заказ ${order ? orderNo(order) : orderId}: карточка заказа не обновлена, ${error.message}`)
    }
    await mirrorOrderStages(svc, orderId)
  }
}

// Строка больше не на закалке: возвращаем ровно то, что закрыла отправка. Живые отметки не трогаем.
async function afterUnsent(svc: Svc, rows: Pick<TemperRow, 'order_id' | 'line_key' | 'layer' | 'item_index'>[], actor: Actor, warnings: string[]) {
  const orderIds = [...new Set(rows.map(r => r.order_id))]
  const [heads, all] = await Promise.all([loadHeads(svc), loadRows(svc)])
  const statusById = new Map(heads.map(h => [h.id, h.status]))
  const taken = temperTaken(all, id => statusById.get(id))
  const now = new Date().toISOString()
  for (const orderId of orderIds) {
    const reopened: ReworkTask[] = []
    for (const r of rows.filter(x => x.order_id === orderId)) {
      const t = taken.get(temperKey(orderId, r.line_key, r.layer))
      if ((t?.away ?? 0) + (t?.returned ?? 0) > 0) continue
      const { data } = await svc.from('production_tasks').select(TASK_COLS)
        .eq('order_id', orderId).eq('item_index', r.item_index).eq('auto_closed', true).eq('auto_closed_from', SENT_FROM)
      const back = ((data ?? []) as Task[]).filter(x => !x.layer || x.layer === r.layer)
      if (back.length) {
        const { error } = await svc.from('production_tasks')
          .update({ status: 'queued', completed_at: null, completed_by: null, completed_by_name: null, started_at: null, started_by: null, started_by_name: null, started_via: null, auto_closed: false, auto_closed_by: null, auto_closed_by_name: null, auto_closed_from: null })
          .in('id', back.map(x => x.id))
        if (error) { warnings.push(`Заказ ${orderId}: этапы не возвращены, ${error.message}`); continue }
        await reverseCutting(orderId, back.map(x => ({ item_index: x.item_index, stage_key: x.stage_key, rework_count: x.rework_count ?? 0 })), 'unset', { userId: actor.id, name: actor.name ?? undefined })
        reopened.push(...back.map(x => ({ id: x.id, stage_key: x.stage_key, sequence_order: x.sequence_order, status: 'queued' })))
        const entries = reopenedStageEntries(r.item_index, back as unknown as ReworkTask[], { at: now, by: actor.id, reasonLabel: 'лист на закалку отменён' })
        await svc.rpc('mark_detail_stages', { p_order_id: orderId, p_updates: entries })
      }
      await svc.from('production_tasks')
        .update({ status: 'queued', started_at: null, started_by: null, started_by_name: null, started_via: null })
        .eq('order_id', orderId).eq('item_index', r.item_index).eq('stage_key', 'tempering').eq('layer', r.layer).eq('status', 'in_progress')
    }
    if (reopened.length) await unmirrorReopenedStages(svc, orderId, reopened)
    await mirrorOrderStages(svc, orderId)
  }
}

// Вернулось всё по строке: этап закалки закрыт. Закрывает строку только полный возврат.
async function closeTempering(svc: Svc, orderId: number, r: Pick<TemperRow, 'item_index' | 'layer'>, actor: Actor, warnings: string[]) {
  const now = new Date().toISOString()
  const tasks = await loadTasks(svc, [orderId])
  const task = temperTaskOf(tasks, orderId, r.item_index, r.layer)
  if (!task) { warnings.push(`Заказ ${orderId}: у позиции ${r.item_index + 1} нет этапа закалки в цехе.`); return }
  if (task.status !== 'done') {
    const { error } = await svc.from('production_tasks').update(buildSyncDonePatch(actor, now)).eq('id', task.id)
    if (error) { warnings.push(`Заказ ${orderId}: этап закалки не закрыт, ${error.message}`); return }
  }
  const keys = await cascadePriorStages(svc, orderId, r.item_index, task.sequence_order, now, { id: actor.id, name: actor.name, stage: 'tempering' })
  if (keys.length) await consumeCutting(orderId, await loadCascadedTasks(svc, orderId, r.item_index, keys), 'cascade', { userId: actor.id, name: actor.name ?? undefined })
  // Триплекс: в карточке заказа этап один на изделие, готов, когда приехали все стёкла.
  const allDone = tasks.filter(t => t.item_index === r.item_index && t.stage_key === 'tempering' && t.id !== task.id).every(t => t.status === 'done')
  const entries = [
    ...keys.map(stage => ({ item: String(r.item_index), stage, entry: { status: 'done', updated_at: now, updated_by: actor.id, auto: true } })),
    ...(allDone ? [{ item: String(r.item_index), stage: 'tempering', entry: { status: 'done', updated_at: now, updated_by: actor.id } }] : []),
  ]
  if (entries.length) await svc.rpc('mark_detail_stages', { p_order_id: orderId, p_updates: entries })
  await mirrorOrderStages(svc, orderId)
}

async function totalsCheck(svc: Svc, batchId: number) {
  const { data } = await svc.from('tempering_batches').select('id, batch_date, status, created_at, sent_at, sent_by_name').eq('id', batchId).maybeSingle()
  return (data as Head | null) ?? null
}

export async function POST(req: NextRequest) {
  const guard = await requirePageAccess(PAGE)
  if (guard instanceof NextResponse) return guard
  if (!ROLES.includes(guard)) return fail('Закалку ведёт цех и владелец.', 403)
  const user = await getSessionUser()
  if (!user) return fail('Не авторизован', 401)
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return fail('Пустой запрос')
  const svc = createServiceClient()
  const { data: prof } = await svc.from('users').select('name').eq('id', user.id).maybeSingle()
  const actor: Actor = { id: user.id, email: user.email, name: actorName((prof as { name: string | null } | null)?.name, user.email) }
  const warnings: string[] = []
  const batchId = Number(body.batch_id) || 0

  try {
    if (body.action === 'create' || body.action === 'add') {
      const requests = parseRequests(body.lines)
      const head = body.action === 'add' ? await totalsCheck(svc, batchId) : null
      if (body.action === 'add' && !head) return fail('Лист удалён. Обновите экран.', 409)
      if (body.action === 'create' && !isDay(body.batch_date)) return fail('Укажите дату.')
      const [heads, all, ratesRes] = await Promise.all([loadHeads(svc), loadRows(svc), loadB2BRates(svc)])
      const statusById = new Map(heads.map(h => [h.id, h.status]))
      const current = head ? all.filter(r => r.batch_id === head.id) : []
      const taken = temperTaken(all, id => statusById.get(id), head?.id)
      const { problem, orders } = await checkRequests(svc, requests, taken, current)
      if (problem) return fail(problem, 409)

      let id = head?.id ?? 0
      if (!head) {
        const { data, error } = await svc.from('tempering_batches').insert({ batch_date: body.batch_date, status: 'draft', created_by: user.id }).select('id').single()
        if (error || !data) return fail(error?.message ?? 'Лист не создан', 500)
        id = (data as { id: number }).id
      }
      const snapshot = snapshotRows(id, requests, orders, ratesRes.rates, current, taken)
      const { error } = await svc.from('tempering_batch_items').upsert(snapshot, { onConflict: 'batch_id,order_id,line_key,layer' })
      if (error) {
        if (!head) await svc.from('tempering_batches').delete().eq('id', id)
        return fail(error.message, 500)
      }
      if (head?.status === 'sent') await afterSent(svc, snapshot, actor, warnings)
      return NextResponse.json({ ok: true, id, warnings })
    }

    if (!batchId) return fail('Не указан лист.')
    const head = await totalsCheck(svc, batchId)
    if (!head) return fail('Лист удалён. Обновите экран.', 409)
    const { data: rawRows, error: rowsErr } = await svc.from('tempering_batch_items').select(ROW_COLS).eq('batch_id', batchId)
    if (rowsErr) return fail(rowsErr.message, 500)
    const rows = (rawRows ?? []) as TemperRow[]

    if (body.action === 'remove') {
      const row = rows.find(r => r.id === Number(body.row_id))
      if (!row) return fail('Строка уже убрана. Обновите экран.', 409)
      if (row.returned_qty + row.broken_qty > 0) return fail(`${row.material}: строку уже принимали, убрать нельзя.`, 409)
      const { error } = await svc.from('tempering_batch_items').delete().eq('id', row.id)
      if (error) return fail(error.message, 500)
      if (head.status === 'sent') await afterUnsent(svc, [row], actor, warnings)
      let deleted = false
      if (rows.length === 1) {
        const { error: delErr } = await svc.from('tempering_batches').delete().eq('id', batchId)
        if (delErr) warnings.push(`Пустой лист не удалён: ${delErr.message}`)
        deleted = !delErr
      }
      return NextResponse.json({ ok: true, deleted, warnings })
    }

    if (body.action === 'delete') {
      if (head.status !== 'draft') return fail('Лист уже отправлен. Сначала верните его в черновик.', 409)
      const { error } = await svc.from('tempering_batches').delete().eq('id', batchId)
      if (error) return fail(error.message, 500)
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'send') {
      if (head.status !== 'draft') return fail('Лист уже отправлен. Обновите экран.', 409)
      if (rows.length === 0) return fail('В листе нет изделий.', 409)
      if (head.batch_date > mskDayKey()) return fail('Дата листа ещё не наступила.', 409)
      const orders = await loadOrders(svc, [...new Set(rows.map(r => r.order_id))])
      const ratesRes = await loadB2BRates(svc)
      for (const r of rows) {
        const o = orders.find(x => x.id === r.order_id)
        const line = o ? temperLines(o).find(l => l.key === r.line_key && l.layer === r.layer) : undefined
        if (!o || !line) return fail(`Заказ ${r.order_no}: строку изменили, уберите её из листа и добавьте заново.`, 409)
        if (r.qty > line.qty) return fail(`Заказ ${r.order_no}: в заказе теперь ${line.qty} шт., в листе ${r.qty}.`, 409)
        const snap = { item_index: line.index, material: line.material, thickness: line.thickness, width: line.width, height: line.height, ...temperSnapshot(line, r.qty, ratesRes.rates) }
        const { error } = await svc.from('tempering_batch_items').update(snap).eq('id', r.id)
        if (error) return fail(error.message, 500)
        r.item_index = line.index
      }
      const { data: sent, error } = await svc.from('tempering_batches')
        .update({ status: 'sent', sent_at: new Date().toISOString(), sent_by: user.id, sent_by_name: actor.name }).eq('id', batchId).eq('status', 'draft').select('id')
      if (error) return fail(error.message, 500)
      if (!sent?.length) return fail('Лист уже отправлен. Обновите экран.', 409)
      await afterSent(svc, rows, actor, warnings)
      return NextResponse.json({ ok: true, warnings })
    }

    if (body.action === 'undo') {
      if (head.status !== 'sent') return fail('Лист ещё не отправлен.', 409)
      if (rows.some(r => r.returned_qty + r.broken_qty > 0)) return fail('По листу уже была приёмка, вернуть в черновик нельзя.', 409)
      const { error } = await svc.from('tempering_batches').update({ status: 'draft', sent_at: null, sent_by: null, sent_by_name: null }).eq('id', batchId)
      if (error) return fail(error.message, 500)
      await afterUnsent(svc, rows, actor, warnings)
      return NextResponse.json({ ok: true, warnings })
    }

    if (body.action === 'receive') {
      if (head.status !== 'sent') return fail('Лист ещё не отправлен.', 409)
      // Без строк в запросе: «всё приехало» по всем строкам, что ещё на закалке.
      const asked = Array.isArray(body.rows)
        ? (body.rows as Record<string, unknown>[]).map(x => ({ id: Number(x.id), returned: Number(x.returned ?? 0), broken: Number(x.broken ?? 0), comment: typeof x.comment === 'string' ? x.comment.trim().slice(0, 300) : '' }))
        : rows.filter(r => rowOutstanding(r) > 0).map(r => ({ id: r.id, returned: rowOutstanding(r), broken: 0, comment: '' }))
      const work = asked.filter(a => a.returned + a.broken > 0)
      if (work.length === 0) return fail('Ничего не отмечено.', 409)
      for (const a of work) {
        const row = rows.find(r => r.id === a.id)
        if (!row) return fail('Строку убрали из листа. Обновите экран.', 409)
        const problem = receiveProblem(a.returned, a.broken, row)
        if (problem) return fail(`Заказ ${row.order_no}. ${problem}`, 409)
      }

      const now = new Date().toISOString()
      let returned = 0, broken = 0
      for (const a of work) {
        const row = rows.find(r => r.id === a.id)!
        const { data: saved, error } = await svc.from('tempering_batch_items')
          .update({ returned_qty: row.returned_qty + a.returned, broken_qty: row.broken_qty + a.broken, received_at: now, received_by_name: actor.name })
          .eq('id', row.id).eq('returned_qty', row.returned_qty).eq('broken_qty', row.broken_qty).select('id')
        if (error) { warnings.push(`Заказ ${row.order_no}: не записалось, ${error.message}`); continue }
        if (!saved?.length) { warnings.push(`Заказ ${row.order_no}: строку уже приняли, обновите экран.`); continue }
        row.returned_qty += a.returned
        row.broken_qty += a.broken
        returned += a.returned
        broken += a.broken

        const [heads, all, orders] = await Promise.all([loadHeads(svc), loadRows(svc), loadOrders(svc, [row.order_id])])
        const statusById = new Map(heads.map(h => [h.id, h.status]))
        const t = temperTaken(all, id => statusById.get(id)).get(temperKey(row.order_id, row.line_key, row.layer))
        const order = orders[0]
        const line = order ? temperLines(order).find(l => l.key === row.line_key && l.layer === row.layer) : undefined

        // Бой: деталь делают заново, журнал брака и сообщение менеджеру — внутри одного действия цеха.
        if (a.broken > 0 && order) {
          const tasks = await loadTasks(svc, [row.order_id])
          const rework = await applyRework(svc, {
            order: { id: order.id, custom_number: order.custom_number, client_name: order.client_name },
            itemIndex: row.item_index, reason: 'break_tempering', foundTaskId: temperTaskOf(tasks, row.order_id, row.item_index, row.layer)?.id,
            comment: `Бой на закалке: ${a.broken} из ${line?.qty ?? row.qty} шт., ${row.material}${a.comment ? `. ${a.comment}` : ''}`,
            actor: { id: actor.id, name: actor.name },
          })
          if ('error' in rework) warnings.push(`Заказ ${row.order_no}: бой записан в листе, но переделка не поставлена: ${rework.error}`)
        } else if (a.returned > 0 && line && (t?.returned ?? 0) >= line.qty) {
          await closeTempering(svc, row.order_id, row, actor, warnings)
        }
      }
      if (returned + broken === 0) return fail(warnings.join('; ') || 'Приёмка не записана.', 409)
      return NextResponse.json({ ok: true, returned, broken, warnings })
    }

    return fail('Неизвестное действие')
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Не удалось записать', 500)
  }
}
