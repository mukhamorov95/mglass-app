import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readPaged, readIn } from '@/lib/production/paged'
import { parseNotes, PROD_SINCE } from '@/lib/orderFlags'
import { isShipped, orderDeadline, type TodayOrder } from '@/lib/b2b/todayPriorities'
import { searchByName } from '@/lib/search/translitMatch'
import {
  ACTION_EVENT, canCloseCard, canCreateCard, isMissingTable, nextStatus, orderProgress, sortCards,
  type BoardCard, type BoardEvent, type CardAction, type CardInput, type StageProgress, type TaskLite,
} from './model'

// Табло цеха — чтение и запись через service-role. Роль проверяет вызывающий маршрут
// (/api/shop-board/*) до первого запроса; здесь — права на конкретное действие.
// Наружу из заказа уходят только номер, клиент, срок и отметки этапов — без сумм.

export type BoardActor = { id: string; name: string | null; role: string; permissions: { shop_board?: boolean } | null }

export type OrderRef = {
  id: number
  ref: string
  client: string | null
  deadline: string | null
  packaged: boolean
  shipped: boolean
  mine: boolean
  progress?: StageProgress[]
}

export type BoardCardView = BoardCard & { orders: OrderRef[]; events: BoardEvent[]; mine: boolean }

export type BoardView =
  | { missing: true }
  | { missing?: false; cards: BoardCardView[]; closed: BoardCardView[]; me: { id: string; canCreate: boolean; isOwner: boolean } }

const CARD_COLS = 'id,title,details,order_ids,due_at,hot,status,created_by,created_by_name,taken_by,taken_by_name,taken_at,done_by,done_by_name,done_at,closed_by,closed_by_name,closed_at,created_at'
const DAY = 86_400_000

class MissingTable extends Error {}

function rethrow(error: { code?: string | null; message: string } | null) {
  if (!error) return
  if (isMissingTable(error)) throw new MissingTable(error.message)
  throw new Error(error.message)
}

const isOwner = (role: string) => role === 'admin' || role === 'ceo'

type OrderRow = { id: number; custom_number: string | null; client_name: string | null; notes: unknown; launched_at: string | null; created_at: string; created_by: string | null }

function orderRef(o: OrderRow, viewerId: string): OrderRef {
  const n = parseNotes(o.notes)
  const stages = (n.stages ?? {}) as Record<string, unknown>
  const set = (v: unknown) => v === true || (typeof v === 'string' && v.trim() !== '')
  return {
    id: o.id,
    ref: o.custom_number?.trim() || `#${o.id}`,
    client: o.client_name,
    deadline: o.launched_at || n.launched_at || n.deadline_date ? orderDeadline(o as unknown as TodayOrder, n).toISOString() : null,
    packaged: set(stages.packaged),
    shipped: isShipped(n),
    mine: o.created_by === viewerId,
  }
}

export async function loadBoard(svc: SupabaseClient, viewer: BoardActor, opts: { lite?: boolean; now?: number } = {}): Promise<BoardView> {
  const now = opts.now ?? Date.now()
  try {
    // readPaged бросает Error(message) — «таблицы нет» узнаём по тексту в catch ниже.
    const open = await readPaged<BoardCard>((from, to) => svc.from('shop_board_cards')
      .select(CARD_COLS).neq('status', 'closed').order('id').range(from, to))
    let closed: BoardCard[] = []
    if (!opts.lite) {
      const { data, error } = await svc.from('shop_board_cards').select(CARD_COLS)
        .eq('status', 'closed').gte('closed_at', new Date(now - 7 * DAY).toISOString())
        .order('closed_at', { ascending: false }).limit(50)
      rethrow(error)
      closed = (data ?? []) as BoardCard[]
    }
    const all = [...open, ...closed]

    const orderIds = [...new Set(all.flatMap(c => c.order_ids ?? []).map(Number))]
    const orders = await readIn<OrderRow, number>(orderIds, (part, from, to) => svc.from('b2b_orders')
      .select('id,custom_number,client_name,notes,launched_at,created_at,created_by').in('id', part).order('id').range(from, to))
    const refs = new Map(orders.map(o => [o.id, orderRef(o, viewer.id)]))

    if (!opts.lite && orderIds.length) {
      const tasks = await readIn<TaskLite & { order_id: number }, number>(orderIds, (part, from, to) =>
        svc.from('production_tasks').select('id,order_id,stage_key,status,completed_at,completed_by_name').in('order_id', part).order('id').range(from, to))
      const byOrder = new Map<number, TaskLite[]>()
      for (const t of tasks) {
        const list = byOrder.get(Number(t.order_id)) ?? []
        list.push(t)
        byOrder.set(Number(t.order_id), list)
      }
      for (const [id, r] of refs) r.progress = orderProgress(byOrder.get(id) ?? [])
    }

    const events = opts.lite ? [] : await readIn<BoardEvent, number>(all.map(c => c.id), (part, from, to) =>
      svc.from('shop_board_events').select('id,card_id,kind,text,by_name,created_at').in('card_id', part).order('id').range(from, to))
    const evByCard = new Map<number, BoardEvent[]>()
    for (const e of events) {
      const list = evByCard.get(Number(e.card_id)) ?? []
      list.push(e)
      evByCard.set(Number(e.card_id), list)
    }

    const view = (c: BoardCard): BoardCardView => {
      const os = (c.order_ids ?? []).map(id => refs.get(Number(id))).filter((r): r is OrderRef => !!r)
      return { ...c, orders: os, events: evByCard.get(c.id) ?? [], mine: os.some(o => o.mine) }
    }
    return {
      cards: sortCards(open, now).map(view),
      closed: closed.map(view),
      me: { id: viewer.id, canCreate: canCreateCard(viewer.role, viewer.permissions), isOwner: isOwner(viewer.role) },
    }
  } catch (e) {
    if (e instanceof MissingTable || isMissingTable({ message: e instanceof Error ? e.message : String(e) })) return { missing: true }
    throw e
  }
}

export type WriteResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string }

export async function createCard(svc: SupabaseClient, input: CardInput, actor: BoardActor): Promise<WriteResult<BoardCard>> {
  if (!canCreateCard(actor.role, actor.permissions)) return { ok: false, status: 403, error: 'Ставить поручения могут владелец, цех и Дима' }
  // Заказы — только существующие и не в архиве: ссылка на чужой мусор табло не нужна.
  let orderIds: number[] = []
  if (input.order_ids.length) {
    const { data, error } = await svc.from('b2b_orders').select('id').in('id', input.order_ids).is('archived_at', null)
    if (error) return { ok: false, status: 500, error: `Заказы не прочитались: ${error.message}` }
    const found = new Set((data ?? []).map(r => Number(r.id)))
    orderIds = input.order_ids.filter(id => found.has(id))
  }
  const { data, error } = await svc.from('shop_board_cards').insert({
    title: input.title, details: input.details, order_ids: orderIds, due_at: input.due_at, hot: input.hot,
    created_by: actor.id, created_by_name: actor.name,
  }).select(CARD_COLS).single()
  if (error) return { ok: false, status: isMissingTable(error) ? 503 : 500, error: isMissingTable(error) ? 'Табло ждёт SQL владельца' : error.message }
  const card = data as BoardCard
  const { error: evErr } = await svc.from('shop_board_events').insert({ card_id: card.id, kind: 'created', by_id: actor.id, by_name: actor.name })
  if (evErr) console.error(`[shop-board] event created card=${card.id}: ${evErr.message}`)
  return { ok: true, value: card }
}

export async function actOnCard(svc: SupabaseClient, id: number, action: CardAction, actor: BoardActor): Promise<WriteResult<{ card: BoardCard; previous: BoardCard }>> {
  const { data: cur, error } = await svc.from('shop_board_cards').select(CARD_COLS).eq('id', id).maybeSingle()
  if (error) return { ok: false, status: 500, error: error.message }
  if (!cur) return { ok: false, status: 404, error: 'Поручение не найдено' }
  const card = cur as BoardCard
  const allowed = action === 'close' ? canCloseCard(card, actor.id, actor.role) : canCreateCard(actor.role, actor.permissions)
  if (!allowed) {
    return { ok: false, status: 403, error: action === 'close' ? 'Закрыть может тот, кто поставил, или владелец' : 'Двигать поручения могут владелец, цех и Дима' }
  }
  const next = nextStatus(card, action)
  if (!next) return { ok: false, status: 409, error: 'Поручение уже в другом состоянии — обновите табло' }

  const now = new Date().toISOString()
  const who = { id: actor.id, name: actor.name }
  const patch: Record<string, unknown> = { status: next, updated_at: now }
  if (action === 'take') Object.assign(patch, { taken_by: who.id, taken_by_name: who.name, taken_at: now })
  if (action === 'done') Object.assign(patch, { done_by: who.id, done_by_name: who.name, done_at: now })
  if (action === 'reopen') Object.assign(patch, { done_by: null, done_by_name: null, done_at: null, closed_by: null, closed_by_name: null, closed_at: null })
  if (action === 'close') Object.assign(patch, { closed_by: who.id, closed_by_name: who.name, closed_at: now })

  // Условие на прежний статус: две одновременные кнопки — вторая получит «уже изменили».
  const { data: upd, error: uErr } = await svc.from('shop_board_cards').update(patch)
    .eq('id', id).eq('status', card.status).select(CARD_COLS)
  if (uErr) return { ok: false, status: 500, error: uErr.message }
  if (!upd?.length) return { ok: false, status: 409, error: 'Поручение уже изменили — обновите табло' }

  const { error: evErr } = await svc.from('shop_board_events').insert({ card_id: id, kind: ACTION_EVENT[action], by_id: who.id, by_name: who.name })
  if (evErr) console.error(`[shop-board] event ${action} card=${id}: ${evErr.message}`)
  return { ok: true, value: { card: upd[0] as BoardCard, previous: card } }
}

export async function commentCard(svc: SupabaseClient, id: number, text: string, actor: BoardActor): Promise<WriteResult<BoardCard>> {
  const t = text.trim()
  if (!t) return { ok: false, status: 400, error: 'Пустой комментарий' }
  if (t.length > 1000) return { ok: false, status: 400, error: 'Комментарий — до 1000 знаков' }
  const { data: cur, error } = await svc.from('shop_board_cards').select(CARD_COLS).eq('id', id).maybeSingle()
  if (error) return { ok: false, status: 500, error: error.message }
  if (!cur) return { ok: false, status: 404, error: 'Поручение не найдено' }
  const { error: evErr } = await svc.from('shop_board_events').insert({ card_id: id, kind: 'comment', text: t, by_id: actor.id, by_name: actor.name })
  if (evErr) return { ok: false, status: 500, error: evErr.message }
  return { ok: true, value: cur as BoardCard }
}

export type OrderOption = { id: number; ref: string; client: string | null; deadline: string | null }

// Заказ для поручения: живые (запущен, не в архиве, не уехал), поиск по номеру и клиенту в обеих раскладках.
export async function searchOrders(svc: SupabaseClient, q: string): Promise<OrderOption[]> {
  const rows = await readPaged<OrderRow>((from, to) => svc.from('b2b_orders')
    .select('id,custom_number,client_name,notes,launched_at,created_at,created_by')
    .is('archived_at', null).not('launched_at', 'is', null).gte('created_at', PROD_SINCE)
    .order('id', { ascending: false }).range(from, to))
  const live = rows.filter(o => {
    const n = parseNotes(o.notes)
    return n.is_template !== true && !isShipped(n)
  })
  const hits = searchByName(live, q, o => [o.custom_number, o.client_name, String(o.id)], 10)
  return hits.map(o => {
    const r = orderRef(o, '')
    return { id: r.id, ref: r.ref, client: r.client, deadline: r.deadline }
  })
}

export async function loadActor(svc: SupabaseClient, userId: string, role: string, permissions: { shop_board?: boolean } | null): Promise<BoardActor> {
  const { data } = await svc.from('users').select('name,email').eq('id', userId).maybeSingle()
  const row = data as { name?: string | null; email?: string | null } | null
  return { id: userId, name: row?.name?.trim() || row?.email || null, role, permissions }
}
