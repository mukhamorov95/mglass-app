'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import ProductionTabs from '@/components/ProductionTabs'
import { createClient } from '@/lib/supabase-browser'
import { STAGE_LABELS, type DetailStageKey } from '@/lib/productionStages'
import { REWORK_REASONS, type ReworkReason } from '@/lib/production/rework'
import { PROD_SINCE, parseNotes, materialStatus, urgencyRank, isUrgent, deadlineOf, launchedOf, daysLeftLabel } from '@/lib/orderFlags'
import LeadSummary from './LeadSummary'
import { materialLabelShort } from '@/lib/materialLabel'

// «Мои задачи»: карточка = ЗАКАЗ (раскрывается на месте — детали с кнопками и
// чертёж), сверху личное табло мастера по ИЗДЕЛИЯМ (сегодня/неделя, процент),
// очередь разбита по горизонту отгрузки: Сегодня → Завтра → Неделя → Позже,
// чтобы мастер мог брать работу наперёд, если на сегодня нет материала.

type TaskRow = {
  id: number
  order_id: number
  item_index: number
  stage_key: string
  sequence_order: number
  station: string
  status: 'queued' | 'in_progress' | 'done' | 'problem'
  blocked_by_task_id: number | null
  production_day: string | null
  layer_note: string | null
  rework_count: number | null
}
type DoneRow = { order_id: number; item_index: number; completed_at: string }
type ItemSpec = { materialName?: string; category?: string; thickness?: number; width?: number; height?: number; quantity?: number; shape?: string }
type OrderLite = { id: number; client_name: string; custom_number: string | null; items?: ItemSpec[]; notes?: unknown }
type BlockerLite = { id: number; status: string; stage_key: string }

const orderNo = (o: OrderLite | undefined, id: number) => o?.custom_number?.trim() || `00${id}`
const fmtShort = (s: string | null) => { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) }
const qtyOf = (o: OrderLite | undefined, idx: number) => Math.max(1, o?.items?.[idx]?.quantity ?? 1)

function specLine(item?: ItemSpec): string {
  if (!item) return ''
  const dims = item.width && item.height ? `${item.width}×${item.height}` : ''
  const mat = materialLabelShort(item)
  const qty = item.quantity && item.quantity > 1 ? `${item.quantity} шт` : ''
  return [dims, mat, qty].filter(Boolean).join(' · ')
}

// Горизонт отгрузки заказа: сегодня (вкл. просрочку) / завтра / эта неделя / позже
type Horizon = 'today' | 'tomorrow' | 'week' | 'later'
const HORIZONS: { key: Horizon; label: string; cls: string }[] = [
  { key: 'today',    label: 'На сегодня (и просроченные)', cls: 'text-red-700' },
  { key: 'tomorrow', label: 'На завтра',                   cls: 'text-amber-700' },
  { key: 'week',     label: 'На этой неделе',              cls: 'text-[#111110]' },
  { key: 'later',    label: 'Позже / без срока',           cls: 'text-[#9a9a95]' },
]

export default function MyQueuePage() {
  const sb = createClient()
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [doneWeek, setDoneWeek] = useState<DoneRow[]>([])
  const [doneOrders, setDoneOrders] = useState<Map<number, OrderLite>>(new Map())
  const [orders, setOrders] = useState<Map<number, OrderLite>>(new Map())
  const [blockers, setBlockers] = useState<Map<number, BlockerLite>>(new Map())
  // П3: вместо андона — «Переделать». Хранится задача, на которой рабочий нашёл брак.
  const [reworkFor, setReworkFor] = useState<number | null>(null)
  const [reworkBusy, setReworkBusy] = useState(false)
  const [myStations, setMyStations] = useState<string[]>([])
  const [me, setMe] = useState<{ id: string; name: string } | null>(null)
  // Статус закупки материала по заказам с пометками: 'orderId:all' / 'orderId:idx' → need|ordered|arrived + дата прибытия
  const [matReq, setMatReq] = useState<Map<string, { status: string; expected: string | null }>>(new Map())
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  // Начальник/владелец выбрал мастера в сводке — показываем ЕГО очередь
  const [viewMaster, setViewMaster] = useState<{ id: string; name: string; stations: string[] } | null>(null)
  const [search, setSearch] = useState('')
  // Режим резчика: те же заказы, но пересобранные по материалу и толщине —
  // видно, какие заказы можно объединить в один крой и сколько изделий выйдет
  const [groupMode, setGroupMode] = useState<'time' | 'material'>('time')
  const [matFilter, setMatFilter] = useState<'all' | 'glass' | 'mirror'>('all')
  const [expandedMat, setExpandedMat] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await sb.auth.getUser()
    if (!user) { setLoading(false); return }

    let queueUserId = user.id
    const { data: profile } = await sb.from('users').select('production_stations,name').eq('id', user.id).single()
    const prof = profile as { production_stations: string[] | null; name: string | null } | null
    setMe({ id: user.id, name: prof?.name ?? user.email ?? 'Цех' })
    let stations: string[]
    if (viewMaster) {
      queueUserId = viewMaster.id
      stations = viewMaster.stations
    } else {
      stations = prof?.production_stations ?? []
    }
    setMyStations(stations)

    const orFilter = stations.length
      ? `assigned_to.eq.${queueUserId},and(assigned_to.is.null,station.in.(${stations.join(',')}))`
      : `assigned_to.eq.${queueUserId}`

    // Понедельник этой недели — для табло «за неделю»
    const monday = new Date()
    monday.setHours(0, 0, 0, 0)
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))

    const [{ data: taskRows }, { data: doneRows }] = await Promise.all([
      // Берём и закрытые задачи: в обычном списке они не показываются, но
      // нужны поиску — иначе отмеченный заказ пропадает и его не найти.
      sb.from('production_tasks')
        .select('id,order_id,item_index,stage_key,sequence_order,station,status,blocked_by_task_id,production_day,layer_note,rework_count')
        .or(orFilter)
        .in('status', ['queued', 'in_progress', 'done', 'problem'])
        .order('sequence_order', { ascending: true }),
      stations.length
        ? sb.from('production_tasks').select('order_id,item_index,completed_at')
            .eq('status', 'done').in('station', stations).gte('completed_at', monday.toISOString())
        : Promise.resolve({ data: [] as DoneRow[] }),
    ])

    const list = (taskRows ?? []) as TaskRow[]
    const dw = (doneRows ?? []) as DoneRow[]

    const orderIds = [...new Set(list.map(t => t.order_id))]
    const doneOrderIds = [...new Set(dw.map(t => t.order_id))].filter(id => !orderIds.includes(id))
    const blockerIds = [...new Set(list.map(t => t.blocked_by_task_id).filter((x): x is number => x != null))]

    const [{ data: orderRows }, { data: doneOrderRows }, { data: blockerRows }] = await Promise.all([
      orderIds.length
        ? sb.from('b2b_orders').select('id,client_name,custom_number,items,notes').in('id', orderIds).gte('created_at', PROD_SINCE)
        : Promise.resolve({ data: [] as OrderLite[] }),
      doneOrderIds.length
        ? sb.from('b2b_orders').select('id,items').in('id', doneOrderIds).gte('created_at', PROD_SINCE)
        : Promise.resolve({ data: [] as OrderLite[] }),
      blockerIds.length
        ? sb.from('production_tasks').select('id,status,stage_key').in('id', blockerIds)
        : Promise.resolve({ data: [] as BlockerLite[] }),
    ])

    // Производственный контур — только заказы с PROD_SINCE
    const freshOrders = new Map((orderRows ?? []).map((o: OrderLite) => [o.id, o]))
    setTasks(list.filter(t => freshOrders.has(t.order_id)))
    setOrders(freshOrders)

    // Статус закупки для заказов с пометкой «нет материала» — мастер видит,
    // когда стекло заказано и когда пришло, не выходя из очереди
    const marked = [...freshOrders.values()].filter(o => {
      const n = parseNotes(o.notes)
      return materialStatus(o.notes) === 'needed' || (Array.isArray(n.material_needed_items) && (n.material_needed_items as number[]).length > 0)
    }).map(o => o.id)
    if (marked.length) {
      const { data: reqs } = await sb.from('shop_purchase_requests')
        .select('id,b2b_order_id,item_index,status,expected_date')
        .in('b2b_order_id', marked)
        .order('id', { ascending: true })
      const m = new Map<string, { status: string; expected: string | null }>()
      for (const r of (reqs ?? []) as { b2b_order_id: number; item_index: number | null; status: string; expected_date: string | null }[]) {
        m.set(`${r.b2b_order_id}:${r.item_index ?? 'all'}`, { status: r.status, expected: r.expected_date }) // позднейшая заявка перезаписывает
      }
      setMatReq(m)
    } else setMatReq(new Map())
    const dMap = new Map<number, OrderLite>(((doneOrderRows ?? []) as OrderLite[]).map(o => [o.id, o]))
    for (const [id, o] of freshOrders) dMap.set(id, o)
    setDoneOrders(dMap)
    setDoneWeek(dw.filter(t => dMap.has(t.order_id)))
    setBlockers(new Map((blockerRows ?? []).map((b: BlockerLite) => [b.id, b])))
    setLoading(false)
  }, [sb, viewMaster])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  const handlePick = useCallback((m: { id: string; name: string; stations: string[] } | null) => {
    setViewMaster(prev => ((prev?.id ?? null) === (m?.id ?? null) ? prev : m))
  }, [])

  // Один вход на все старты (П2): и явное «Взял», и автостарт при раскрытии
  // карточки. via отличает сильный сигнал от слабого — см. lib/production/start.ts.
  function sendStart(taskIds: number[], via: 'button' | 'open', orderId: number | null) {
    if (taskIds.length) setTasks(prev => prev.map(t => taskIds.includes(t.id) ? { ...t, status: 'in_progress' } : t))
    return fetch('/api/production/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_ids: taskIds, order_id: orderId, via }),
    }).catch(() => {})
  }

  async function markStart(taskId: number) {
    await sendStart([taskId], 'button', tasks.find(t => t.id === taskId)?.order_id ?? null)
  }

  async function markStartOrder(taskIds: number[]) {
    await sendStart(taskIds, 'button', tasks.find(t => taskIds.includes(t.id))?.order_id ?? null)
  }

  async function markDone(taskId: number) {
    const task = tasks.find(t => t.id === taskId)
    setTasks(prev => prev.filter(t => t.id !== taskId))
    await fetch(`/api/production-tasks/${taskId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'done' }),
    }).catch(() => {})
    // Деталь готова = материал на неё был: гасим её пометку «ждёт материал»
    if (task) {
      const marked = parseNotes(orders.get(task.order_id)?.notes).material_needed_items
      if (Array.isArray(marked) && (marked as number[]).includes(task.item_index)) {
        await mergeNotes(task.order_id, n => {
          const prev = Array.isArray(n.material_needed_items) ? (n.material_needed_items as number[]) : []
          return { ...n, material_needed_items: prev.filter(i => i !== task.item_index) }
        })
      }
    }
    load()
  }

  async function markDoneOrder(taskIds: number[]) {
    const orderId = tasks.find(t => taskIds.includes(t.id))?.order_id
    setTasks(prev => prev.filter(t => !taskIds.includes(t.id)))
    await Promise.all(taskIds.map(id =>
      fetch(`/api/production-tasks/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'done' }),
      }).catch(() => {})
    ))
    // Весь заказ готов — пометки «ждёт материал» больше не актуальны, гасим все
    if (orderId != null) {
      const n0 = parseNotes(orders.get(orderId)?.notes)
      const hadMarks = materialStatus(orders.get(orderId)?.notes) === 'needed'
        || (Array.isArray(n0.material_needed_items) && (n0.material_needed_items as number[]).length > 0)
      if (hadMarks) {
        await mergeNotes(orderId, n => ({
          ...n,
          material_needed_items: [],
          ...(n.material_status === 'needed' ? { material_status: 'ready' } : {}),
        }))
      }
    }
    load()
  }

  // Заявка в канбан «Купить» (как делает вкладка «Материал») — снабжение видит
  // номер заказа и что именно без материала; связь order/item даёт мастеру
  // видеть статус закупки (заказано/пришло) прямо в очереди
  async function purchaseRequest(title: string, details: string | null, orderId: number, itemIndex: number | null) {
    await sb.from('shop_purchase_requests').insert({ title, qty: null, details, author_id: me?.id, author_name: me?.name ?? 'Цех', b2b_order_id: orderId, item_index: itemIndex })
    fetch('/api/shop-purchases/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, qty: '', author: me?.name ?? 'Цех', link: '' }) }).catch(() => {})
  }

  // Свежий read-merge-write notes — параллельные экраны не должны терять поля (урок #4960)
  async function mergeNotes(orderId: number, patch: (n: Record<string, unknown>) => Record<string, unknown>) {
    const { data: fresh } = await sb.from('b2b_orders').select('notes').eq('id', orderId).single()
    const n = parseNotes((fresh as { notes: string | null } | null)?.notes ?? null)
    await sb.from('b2b_orders').update({ notes: JSON.stringify(patch(n)) }).eq('id', orderId)
  }

  // «Нет материала на весь заказ» (повторное нажатие = материал пришёл)
  async function toggleNoMaterialOrder(orderId: number) {
    const o = orders.get(orderId)
    const turnOn = materialStatus(o?.notes) !== 'needed'
    await mergeNotes(orderId, n => ({ ...n, material_status: turnOn ? 'needed' : 'ready', material_checked_at: new Date().toISOString(), material_checked_by: me?.name ?? null }))
    if (turnOn) {
      const details = (o?.items ?? []).map(it => specLine(it)).filter(Boolean).join('; ')
      await purchaseRequest(`Материал: ${orderNo(o, orderId)} — весь заказ (${o?.client_name ?? ''})`, details || null, orderId, null)
    }
    load()
  }

  // «Нет материала» на конкретную деталь: остальной заказ идёт дальше, эта позиция ждёт
  async function toggleNoMaterialItem(orderId: number, itemIndex: number) {
    const o = orders.get(orderId)
    const cur = parseNotes(o?.notes).material_needed_items
    const arr = Array.isArray(cur) ? (cur as number[]) : []
    const turnOn = !arr.includes(itemIndex)
    await mergeNotes(orderId, n => {
      const prev = Array.isArray(n.material_needed_items) ? (n.material_needed_items as number[]) : []
      const next = turnOn ? [...new Set([...prev, itemIndex])] : prev.filter(i => i !== itemIndex)
      return { ...n, material_needed_items: next }
    })
    if (turnOn) await purchaseRequest(`Материал: ${orderNo(o, orderId)} · поз. ${itemIndex + 1} (${o?.client_name ?? ''})`, specLine(o?.items?.[itemIndex]) || null, orderId, itemIndex)
    load()
  }

  // Тап по причине И ЕСТЬ подтверждение — ни модалки с «Отправить», ни обязательного
  // комментария. Два тапа вместо четырёх, и второй несёт причину.
  async function submitRework(reason: ReworkReason) {
    if (reworkFor == null || reworkBusy) return
    setReworkBusy(true)
    await fetch('/api/production/rework', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: reworkFor, reason }),
    }).catch(() => {})
    setReworkFor(null)
    setReworkBusy(false)
    load()
  }

  const isReady = (t: TaskRow) => {
    if (t.blocked_by_task_id == null) return true
    const b = blockers.get(t.blocked_by_task_id)
    return b?.status === 'done'
  }

  // П2: раскрыл карточку заказа на своей станции — значит взялся за него.
  // Кнопка «Взял» существует с 30.06 и за два месяца собрала 0 нажатий, поэтому
  // сигнал берём из действия, которое рабочий и так делает, а кнопку оставляем жить.
  // Без await и без блокировки UI: он пришёл посмотреть, что делать, а не отмечаться.
  // Свёрнутая карточка задачу НЕ снимает — он мог свернуть список и продолжать работу;
  // прежний автостарт снимет сервер, когда рабочий раскроет другой заказ.
  const toggleOrder = (orderId: number) => {
    const opening = !expanded.has(orderId)
    setExpanded(prev => {
      const n = new Set(prev)
      if (n.has(orderId)) n.delete(orderId); else n.add(orderId)
      return n
    })
    if (!opening) return
    const ids = tasks.filter(t => t.order_id === orderId && t.status === 'queued' && isReady(t)).map(t => t.id)
    sendStart(ids, 'open', orderId)
  }

  // Закрытые задачи держим в памяти только ради поиска — во всех счётчиках,
  // табло и группировках участвуют активные.
  const activeTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'problem')
  const q = search.trim().toLowerCase()
  const orderMatches = (id: number) => {
    if (!q) return true
    const o = orders.get(id)
    return orderNo(o, id).toLowerCase().includes(q) || (o?.client_name ?? '').toLowerCase().includes(q)
  }

  // ── Группировка по заказам ──
  // Без запроса — только незакрытые задачи (рабочий список). В поиске
  // показываем и выполненные: мастеру нужно найти заказ, который он уже отметил.
  const byOrder = new Map<number, TaskRow[]>()
  for (const t of tasks) {
    if (!q && (t.status === 'done' || t.status === 'problem')) continue
    if (!orderMatches(t.order_id)) continue
    byOrder.set(t.order_id, [...(byOrder.get(t.order_id) ?? []), t])
  }

  // Горизонт по дате отгрузки заказа
  const todayStr = new Date(); todayStr.setHours(0, 0, 0, 0)
  const dayMs = 86400000
  const sunday = new Date(todayStr.getTime() + (7 - ((todayStr.getDay() + 6) % 7) - 1) * dayMs)
  const horizonOf = (id: number): Horizon => {
    const d = deadlineOf(orders.get(id)?.notes)
    if (!d) return 'later'
    const dd = new Date(d); dd.setHours(0, 0, 0, 0)
    if (dd.getTime() <= todayStr.getTime()) return 'today'
    if (dd.getTime() === todayStr.getTime() + dayMs) return 'tomorrow'
    if (dd.getTime() <= sunday.getTime()) return 'week'
    return 'later'
  }
  const groups: Record<Horizon, number[]> = { today: [], tomorrow: [], week: [], later: [] }
  for (const id of byOrder.keys()) groups[horizonOf(id)].push(id)
  const rankOrder = (id: number) => urgencyRank(orders.get(id)?.notes)
  for (const k of Object.keys(groups) as Horizon[]) groups[k].sort((a, b) => rankOrder(a) - rankOrder(b))

  // ── Группировка по материалу и толщине ──
  // Деталь считаем один раз, даже если у мастера по ней две задачи (резка+кромка)
  type MatGroup = { key: string; kind: 'glass' | 'mirror'; label: string; perOrder: Map<number, { details: number; pieces: number }>; details: number; pieces: number; areaM2: number }
  const byMaterial = new Map<string, MatGroup>()
  if (groupMode === 'material') {
    const seenDetail = new Set<string>()
    for (const t of activeTasks) {
      if (!orderMatches(t.order_id)) continue
      const dk = `${t.order_id}:${t.item_index}`
      if (seenDetail.has(dk)) continue
      seenDetail.add(dk)
      const it = orders.get(t.order_id)?.items?.[t.item_index]
      const cat = (it?.category ?? '').trim().toLowerCase()
      const mat = (it?.materialName || it?.category || '').trim() || 'Материал не указан'
      // Зеркало: категория «зеркало» или готовое изделие/материал с «зеркал…»;
      // всё остальное (стекло/тонированное/сатин/рифленое…) — стекло
      const kind: 'glass' | 'mirror' = cat === 'зеркало' || cat === 'изделие' || /зеркал/i.test(mat) ? 'mirror' : 'glass'
      const key = `${kind}|${mat.toLowerCase()}|${it?.thickness ?? ''}`
      const typed = kind === 'mirror' && !/^зеркал/i.test(mat) ? `Зеркало · ${mat}` : kind === 'glass' ? `Стекло · ${mat}` : mat
      const g = byMaterial.get(key) ?? { key, kind, label: [typed, it?.thickness ? `${it.thickness} мм` : ''].filter(Boolean).join(' · '), perOrder: new Map(), details: 0, pieces: 0, areaM2: 0 }
      const qty = qtyOf(orders.get(t.order_id), t.item_index)
      const po = g.perOrder.get(t.order_id) ?? { details: 0, pieces: 0 }
      po.details += 1; po.pieces += qty
      g.perOrder.set(t.order_id, po)
      g.details += 1; g.pieces += qty
      if (it?.width && it?.height) g.areaM2 += it.width * it.height * qty / 1e6
      byMaterial.set(key, g)
    }
  }
  const matGroups = [...byMaterial.values()]
    .filter(g => matFilter === 'all' || g.kind === matFilter)
    .sort((a, b) => b.pieces - a.pieces)

  // ── Табло мастера: по ИЗДЕЛИЯМ (quantity), сегодня и неделя ──
  // Деталь считается ОДИН раз, даже если у мастера на неё несколько задач
  // (две станции = две задачи на одну стекляшку) — иначе выработка врёт вдвое.
  const piecesOf = (rows: { order_id: number; item_index: number }[], src: Map<number, OrderLite>) => {
    const seen = new Set<string>()
    return rows.reduce((s, t) => {
      const k = `${t.order_id}:${t.item_index}`
      if (seen.has(k)) return s
      seen.add(k)
      return s + qtyOf(src.get(t.order_id), t.item_index)
    }, 0)
  }
  const todayIso = new Date(); todayIso.setHours(0, 0, 0, 0)
  const doneToday = doneWeek.filter(t => new Date(t.completed_at) >= todayIso)
  const donePiecesToday = piecesOf(doneToday, doneOrders)
  const donePiecesWeek = piecesOf(doneWeek, doneOrders)
  const leftToday = activeTasks.filter(t => ['today'].includes(horizonOf(t.order_id)))
  const leftWeek = activeTasks.filter(t => ['today', 'tomorrow', 'week'].includes(horizonOf(t.order_id)))
  const leftPiecesToday = piecesOf(leftToday, orders)
  const leftPiecesWeek = piecesOf(leftWeek, orders)
  const planToday = donePiecesToday + leftPiecesToday
  const planWeek = donePiecesWeek + leftPiecesWeek
  const pctToday = planToday > 0 ? Math.round(donePiecesToday / planToday * 100) : null
  const pctWeek = planWeek > 0 ? Math.round(donePiecesWeek / planWeek * 100) : null

  const totalReady = activeTasks.filter(isReady).length
  const totalWaiting = activeTasks.length - totalReady
  const totalDetails = new Set(activeTasks.map(t => `${t.order_id}:${t.item_index}`)).size

  if (loading) return (
    <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка...</div>
  )

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Мои задачи{viewMaster ? ` · ${viewMaster.name}` : ''}</h1>
            <p className="text-[13px] text-[#9a9a95] mt-0.5">{byOrder.size} заказов · {totalDetails} деталей · {totalReady} задач готово · {totalWaiting} ждут этапа</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск: № заказа"
              className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] bg-white w-44 outline-none focus:border-[#111110]" />
          </div>
        </div>
        <ProductionTabs />
      </div>

      <div className="px-4 pt-4">
        <LeadSummary onPick={handlePick} />

        {/* Табло мастера: изделия за сегодня и за неделю */}
        {myStations.length > 0 && (
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-[#9a9a95]">Сегодня · изделий</p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-[22px] font-bold text-[#111110]">{donePiecesToday}</span>
                <span className="text-[13px] text-[#9a9a95]">из {planToday}</span>
                {pctToday != null && <span className={`text-[13px] font-semibold ${pctToday >= 100 ? 'text-emerald-700' : pctToday >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{pctToday}%</span>}
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-[#f0f0ee] overflow-hidden">
                <div className={`h-full rounded-full ${pctToday != null && pctToday >= 100 ? 'bg-emerald-500' : 'bg-[#111110]'}`} style={{ width: `${Math.min(pctToday ?? 0, 100)}%` }} />
              </div>
            </div>
            <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-[#9a9a95]">Неделя · изделий</p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-[22px] font-bold text-[#111110]">{donePiecesWeek}</span>
                <span className="text-[13px] text-[#9a9a95]">из {planWeek}</span>
                {pctWeek != null && <span className={`text-[13px] font-semibold ${pctWeek >= 100 ? 'text-emerald-700' : pctWeek >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{pctWeek}%</span>}
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-[#f0f0ee] overflow-hidden">
                <div className={`h-full rounded-full ${pctWeek != null && pctWeek >= 100 ? 'bg-emerald-500' : 'bg-[#111110]'}`} style={{ width: `${Math.min(pctWeek ?? 0, 100)}%` }} />
              </div>
              {leftPiecesWeek > 0 && (
                <p className="mt-1.5 text-[11px] text-[#6b6b66]">
                  к отгрузкам недели осталось <b>{leftPiecesWeek} изд.</b> · ≈{Math.ceil(leftPiecesWeek / Math.max(1, 7 - ((todayIso.getDay() + 6) % 7)))} в день
                </p>
              )}
            </div>
          </div>
        )}

        {/* Переключатель вида очереди: по срокам / по материалу и толщине (для резчика) */}
        <div className="flex gap-1.5 mb-4">
          <button onClick={() => setGroupMode('time')}
            className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${groupMode === 'time' ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110]'}`}>
            📅 По срокам
          </button>
          <button onClick={() => setGroupMode('material')}
            className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${groupMode === 'material' ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110]'}`}>
            🪟 По материалу и толщине
          </button>
        </div>

        {/* Фильтр типа материала — только в режиме резчика */}
        {groupMode === 'material' && (
          <div className="flex gap-1.5 mb-4 -mt-2">
            {([['all', 'Все'], ['glass', 'Стекло'], ['mirror', 'Зеркало']] as const).map(([k, lbl]) => (
              <button key={k} onClick={() => setMatFilter(k)}
                className={`px-3 py-1 rounded-full text-[12px] font-medium border transition-colors ${matFilter === k ? 'bg-[#6b6b66] text-white border-[#6b6b66]' : 'bg-white text-[#9a9a95] border-[#e4e4e0] hover:border-[#6b6b66] hover:text-[#6b6b66]'}`}>
                {lbl}
              </button>
            ))}
          </div>
        )}

        {byOrder.size === 0 && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-6 text-center">
            <p className="text-[13px] text-[#9a9a95]">{q ? `По запросу «${search}» ничего не найдено` : 'Нет задач в очереди'}</p>
          </div>
        )}

        {groupMode === 'material' && matGroups.map(g => {
          const openG = expandedMat.has(g.key)
          return (
          <div key={g.key} className="mb-2">
            <button
              onClick={() => setExpandedMat(prev => { const n = new Set(prev); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })}
              className={`w-full flex items-baseline justify-between gap-2 bg-white rounded-xl border px-4 py-3 text-left ${openG ? 'border-[#111110] rounded-b-none' : 'border-[#e4e4e0] hover:border-[#111110]'}`}>
              <p className="text-[13px] font-bold text-[#111110]"><span className="text-[#9a9a95] mr-1.5">{openG ? '▾' : '▸'}</span>{g.label}</p>
              <p className="text-[11px] text-[#9a9a95] flex-shrink-0">
                {g.perOrder.size} зак. · {g.details} дет. · <span className="font-semibold text-[#111110]">{g.pieces} изд.</span>
                {/* прикидка листов: jumbo 3210×2250, полезный выход раскроя ~85% */}
                {g.areaM2 > 0 && ` · ${Math.round(g.areaM2 * 10) / 10} м² · ≈${Math.max(1, Math.ceil(g.areaM2 / (3.21 * 2.25 * 0.85)))} лист.`}
              </p>
            </button>
            {openG && (
            <div className="bg-white rounded-b-xl border border-t-0 border-[#111110] overflow-hidden">
              {[...g.perOrder.entries()]
                .sort((a, b) => rankOrder(a[0]) - rankOrder(b[0]))
                .map(([oid, cnt]) => {
                  const o = orders.get(oid)
                  const launched = launchedOf(o?.notes)
                  const deadline = deadlineOf(o?.notes)
                  const daysLbl = daysLeftLabel(deadline)
                  const overdue = daysLbl?.includes('роср')
                  return (
                    <Link key={oid} href={`/p/o/${oid}`} className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-[#f8f8f7] last:border-0 hover:bg-[#fafaf9]">
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold text-[#111110] truncate">
                          {isUrgent(o?.notes) && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white mr-1.5">🔥 СРОЧНО</span>}
                          {orderNo(o, oid)}
                        </p>
                        <p className="text-[11px] text-[#6b6b66] truncate">{o?.client_name}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[12px] font-mono text-[#111110]">{cnt.details} дет. · {cnt.pieces} изд.</p>
                        <p className="text-[11px] flex gap-x-2 justify-end">
                          {fmtShort(launched) && <span className="text-[#9a9a95]">запуск {fmtShort(launched)}</span>}
                          {fmtShort(deadline) && <span className={overdue ? 'text-red-700 font-semibold' : 'text-[#9a9a95]'}>отгрузка {fmtShort(deadline)}</span>}
                        </p>
                      </div>
                    </Link>
                  )
                })}
            </div>
            )}
          </div>
        )})}

        {groupMode === 'time' && HORIZONS.map(h => groups[h.key].length > 0 && (
          <div key={h.key} className="mb-5">
            <p className={`text-[11px] font-semibold uppercase tracking-widest mb-2 ${h.cls}`}>
              {h.label} · {groups[h.key].length}
            </p>
            <div className="space-y-2">
              {groups[h.key].map(id => (
                <OrderCard key={id}
                  order={orders.get(id)} orderId={id}
                  tasks={byOrder.get(id) ?? []}
                  blockers={blockers}
                  open={expanded.has(id)}
                  onToggle={() => toggleOrder(id)}
                  isReady={isReady}
                  onStart={markStart}
                  onStartAll={markStartOrder}
                  onDone={markDone}
                  onDoneAll={markDoneOrder}
                  onRework={setReworkFor}
                  onNoMatOrder={toggleNoMaterialOrder}
                  onNoMatItem={toggleNoMaterialItem}
                  matReq={matReq}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Лист причин переделки. Кнопки крупные — цех работает с телефона и в перчатках. */}
      {reworkFor != null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center" onClick={() => setReworkFor(null)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h2 className="text-[15px] font-bold text-[#111110]">Что случилось?</h2>
            <p className="text-[12px] text-[#9a9a95] mt-1 mb-3">Деталь вернётся в работу, этап переоткроется</p>
            <div className="space-y-2">
              {REWORK_REASONS.map(r => (
                <button key={r.code} disabled={reworkBusy} onClick={() => submitRework(r.code)}
                  className="w-full px-4 py-3.5 rounded-xl border border-[#e4e4e0] text-[15px] font-medium text-[#111110] text-left active:scale-[0.99] hover:border-red-300 hover:bg-red-50 disabled:opacity-50">
                  {r.label}
                </button>
              ))}
            </div>
            <button onClick={() => setReworkFor(null)} className="w-full mt-3 py-2.5 rounded-lg text-[13px] font-medium text-[#9a9a95]">Отмена</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Карточка заказа: раскрывается на месте, внутри детали и чертёж ───────────

function OrderCard({ order, orderId, tasks, blockers, open, onToggle, isReady, onStart, onStartAll, onDone, onDoneAll, onRework, onNoMatOrder, onNoMatItem, matReq }: {
  order: OrderLite | undefined
  orderId: number
  tasks: TaskRow[]
  blockers: Map<number, BlockerLite>
  open: boolean
  onToggle: () => void
  isReady: (t: TaskRow) => boolean
  onStart: (id: number) => void
  onStartAll: (ids: number[]) => void
  onDone: (id: number) => void
  onDoneAll: (ids: number[]) => void
  onRework: (id: number) => void
  onNoMatOrder: (orderId: number) => void
  onNoMatItem: (orderId: number, itemIndex: number) => void
  matReq: Map<string, { status: string; expected: string | null }>
}) {
  const notes = order?.notes
  const urgent = isUrgent(notes)
  const deadline = deadlineOf(notes)
  const launched = launchedOf(notes)
  const daysLbl = daysLeftLabel(deadline)
  const pn = parseNotes(notes)
  const drawingUrl = (pn.drawing_url as string | undefined) ?? null
  const isImg = drawingUrl ? /\.(png|jpe?g|webp|gif)(\?|$)/i.test(drawingUrl) : false
  const noMatOrder = materialStatus(notes) === 'needed'
  const noMatItems = Array.isArray(pn.material_needed_items) ? (pn.material_needed_items as number[]) : []
  // В поиске в карточку попадают и закрытые задачи — их показываем отдельной
  // строкой «уже сделано», а в счётчиках работы они не участвуют.
  const doneTasks = tasks.filter(t => t.status === 'done')
  const live = tasks.filter(t => t.status !== 'done' && t.status !== 'problem')
  const ready = live.filter(isReady)
  const waiting = live.filter(t => !isReady(t))
  const inWork = live.filter(t => t.status === 'in_progress').length
  // Деталь ≠ задача: у мастера с двумя станциями (закалка+упаковка) на одну
  // стекляшку приходится две задачи. Считаем детали по уникальному item_index,
  // иначе карточка пишет «4 дет.» там, где деталей две (как в режиме «По материалу»).
  const liveItems = [...new Set(live.map(t => t.item_index))]
  const pieces = liveItems.reduce((s, i) => s + qtyOf(order, i), 0)
  const startable = ready.filter(t => t.status === 'queued').map(t => t.id)
  const doneable = ready.filter(t => t.status === 'queued' || t.status === 'in_progress').map(t => t.id)
  const overdue = daysLbl?.includes('роср')
  const border = urgent || overdue ? 'border-red-300' : open ? 'border-[#111110]' : 'border-[#e4e4e0]'

  return (
    <div className={`rounded-xl border bg-white ${border}`}>
      {/* Шапка — div, не button: внутри живут кнопки-действия (вложенные button невалидны) */}
      <div onClick={onToggle} className="w-full text-left px-4 py-3 cursor-pointer">
        <div className="flex items-center justify-between gap-x-3 gap-y-1.5 flex-wrap">
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-[#111110] truncate flex items-center gap-1.5">
              <span className="text-[#9a9a95]">{open ? '▾' : '▸'}</span>
              {urgent && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white">🔥 СРОЧНО</span>}
              {orderNo(order, orderId)}
              {drawingUrl && <span title="Есть чертёж">📐</span>}
              {noMatOrder && (() => {
                const r = matReq.get(`${orderId}:all`)
                return r?.status === 'arrived'
                  ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">📦 материал пришёл</span>
                  : r?.status === 'ordered'
                  ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">🚚 материал заказан{r.expected ? ` · к ${fmtShort(r.expected)}` : ''}</span>
                  : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">🛒 ждёт материал</span>
              })()}
              {!noMatOrder && noMatItems.length > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">🛒 нет мат. на {noMatItems.length} поз.</span>}
            </p>
            <p className="text-[12px] text-[#6b6b66] truncate">{order?.client_name}</p>
          </div>
          {/* Быстрые действия по заказу — доступны со свёрнутой карточки */}
          {!open && (
            <div className="flex items-center gap-1.5 flex-wrap ml-auto" onClick={e => e.stopPropagation()}>
              {startable.length > 0 && (
                <button onClick={() => onStartAll(startable)} title="Взял весь заказ в работу"
                  className="px-3 py-2 rounded-lg border border-emerald-300 text-emerald-700 text-[12px] font-medium hover:bg-emerald-50">
                  Взял весь ({startable.length})
                </button>
              )}
              {doneable.length > 0 && (
                <button onClick={() => onDoneAll(doneable)} title="Весь заказ готов"
                  className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-[12px] font-medium hover:opacity-90">
                  ✅ Готов весь ({doneable.length})
                </button>
              )}
              <button onClick={() => onNoMatOrder(orderId)} title={noMatOrder ? 'Материал пришёл' : 'Нет материала на весь заказ'}
                className={`px-3 py-2 rounded-lg text-[12px] font-medium border ${noMatOrder ? 'bg-[#111110] text-white border-[#111110]' : 'border-red-200 text-red-600 hover:bg-red-50'}`}>
                {noMatOrder ? '✅ Пришёл' : '🛒 Нет мат.'}
              </button>
            </div>
          )}
          <div className="text-right flex-shrink-0">
            <p className="text-[12px] font-mono text-[#111110]">
              {liveItems.length} дет. · {pieces} изд.{live.length !== liveItems.length ? ` · ${live.length} задач` : ''}{inWork > 0 ? ` · 🔧 ${inWork}` : ''}
              {doneTasks.length > 0 && <span className="text-emerald-700"> · ✓ {doneTasks.length} сделано</span>}
            </p>
            <p className="text-[11px] flex gap-x-2 justify-end flex-wrap">
              {fmtShort(launched) && <span className="text-[#9a9a95]">запуск {fmtShort(launched)}</span>}
              {fmtShort(deadline) && <span className="text-[#9a9a95]">отгрузка {fmtShort(deadline)}</span>}
              {daysLbl && <span className={urgent || overdue ? 'text-red-700 font-semibold' : 'text-[#6b6b66]'}>{daysLbl}</span>}
            </p>
          </div>
        </div>
      </div>

      {open && (
        <div className="border-t border-[#f0f0ee] px-4 py-3 space-y-3">
          {/* Чертёж заказа (прикрепляется менеджером или в «Заказах»);
              bucket приватный — грузим через прокси с подписанной ссылкой */}
          {drawingUrl && (
            <a href={`/api/b2b/drawing/${orderId}`} target="_blank" rel="noreferrer" className="block">
              {isImg
                ? <img src={`/api/b2b/drawing/${orderId}`} alt="Чертёж" className="max-h-56 rounded-lg border border-[#e4e4e0] object-contain" />
                : <span className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#e4e4e0] text-[13px] text-[#111110] hover:border-[#111110]">📐 Открыть чертёж (PDF)</span>}
            </a>
          )}

          {startable.length > 1 && (
            <button onClick={() => onStartAll(startable)}
              className="w-full py-2 rounded-lg border border-emerald-300 text-emerald-700 text-[13px] font-medium hover:bg-emerald-50">
              Взял весь заказ в работу ({startable.length} задач)
            </button>
          )}

          {/* Действия по всему заказу: готов целиком / нет материала целиком */}
          <div className="flex gap-2">
            {doneable.length > 1 && (
              <button onClick={() => onDoneAll(doneable)}
                className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold">
                ✅ Весь заказ готов ({doneable.length} задач)
              </button>
            )}
            <button onClick={() => onNoMatOrder(orderId)}
              className={`flex-1 py-2 rounded-lg text-[13px] font-semibold border ${noMatOrder ? 'bg-[#111110] text-white border-[#111110]' : 'border-red-200 text-red-600 hover:bg-red-50'}`}>
              {noMatOrder ? '✅ Материал пришёл' : '🛒 Нет материала на весь заказ'}
            </button>
          </div>

          {/* Одна карточка = ОДНА ДЕТАЛЬ, внутри её этапы. Раньше карточка была
              на задачу, и у мастера с двумя станциями одна стекляшка выглядела
              как два разных изделия. */}
          <div className="space-y-1.5">
            {liveItems.map(idx => {
              const itemTasks = live.filter(t => t.item_index === idx).sort((a, b) => a.sequence_order - b.sequence_order)
              const itemReady = itemTasks.filter(isReady)
              const itemWaiting = itemTasks.filter(t => !isReady(t))
              const anyActive = itemTasks.some(t => t.status === 'in_progress')
              const noMat = noMatOrder || noMatItems.includes(idx)
              return (
                <div key={idx} className={`rounded-lg border px-3 py-2 ${noMat ? 'border-red-200 bg-red-50/50' : anyActive ? 'border-emerald-300 bg-emerald-50/40' : 'border-[#eceff1]'}`}>
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-[12px] font-mono text-[#111110]">{specLine(order?.items?.[idx]) || `Поз. ${idx + 1}`}</p>
                      <p className={`text-[11px] ${noMat ? 'text-red-700' : 'text-[#6b6b66]'}`}>
                        Поз. {idx + 1}
                        {noMat && (() => {
                          const r = matReq.get(`${orderId}:${idx}`) ?? matReq.get(`${orderId}:all`)
                          return r?.status === 'arrived' ? ' · 📦 материал пришёл'
                            : r?.status === 'ordered' ? ` · 🚚 материал заказан${r.expected ? ` · к ${fmtShort(r.expected)}` : ''}`
                            : ' · 🛒 ждёт материал'
                        })()}
                      </p>
                    </div>
                    <button onClick={() => onNoMatItem(orderId, idx)} title={noMatItems.includes(idx) ? 'Материал пришёл' : 'Нет материала на эту деталь'}
                      className={`px-2.5 py-1.5 rounded-lg text-[12px] font-medium border flex-shrink-0 ${noMatItems.includes(idx) ? 'bg-[#111110] text-white border-[#111110]' : 'border-amber-300 text-amber-700 hover:bg-amber-50'}`}>
                      {noMatItems.includes(idx) ? 'Мат. есть' : 'Нет мат.'}
                    </button>
                  </div>

                  {/* Этапы этой детали: доступные — с кнопками, заблокированные — строкой */}
                  <div className="mt-2 space-y-1">
                    {itemReady.map(t => {
                      const active = t.status === 'in_progress'
                      return (
                        <div key={t.id} className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-[11px] text-[#111110]">
                            {STAGE_LABELS[t.stage_key as DetailStageKey] ?? t.stage_key}
                            {t.layer_note ? ` · ${t.layer_note}` : ''}{active ? ' · 🔧 в работе' : ''}
                            {(t.rework_count ?? 0) > 0 && (
                              <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-600"
                                title="Этот этап уже переделывали">
                                переделка{(t.rework_count ?? 0) > 1 ? ` ×${t.rework_count}` : ''}
                              </span>
                            )}
                          </span>
                          <div className="flex gap-1.5 flex-shrink-0">
                            {!active && <button onClick={() => onStart(t.id)} className="px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] text-[12px] font-medium hover:border-[#111110] hover:text-[#111110]">Взял</button>}
                            <button onClick={() => onDone(t.id)} className="px-3.5 py-1 rounded-lg bg-emerald-600 text-white text-[12px] font-medium">Готово</button>
                            <button onClick={() => onRework(t.id)} title="Брак — деталь надо изготовить заново"
                              className="px-2.5 py-1 rounded-lg border border-red-200 text-red-600 text-[12px] font-medium">Переделать</button>
                          </div>
                        </div>
                      )
                    })}
                    {itemWaiting.map(t => {
                      const blocker = t.blocked_by_task_id ? blockers.get(t.blocked_by_task_id) : null
                      return (
                        <p key={t.id} className="text-[11px] text-amber-700">
                          {STAGE_LABELS[t.stage_key as DetailStageKey] ?? t.stage_key} — ждёт: {blocker ? STAGE_LABELS[blocker.stage_key as DetailStageKey] ?? blocker.stage_key : 'предыдущий этап'}
                        </p>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <Link href={`/p/o/${orderId}`} className="inline-block text-[12px] text-[#9a9a95] underline underline-offset-2">
            Открыть карточку заказа →
          </Link>
        </div>
      )}
    </div>
  )
}
