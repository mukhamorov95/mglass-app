'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import ProductionTabs from '@/components/ProductionTabs'
import { createClient } from '@/lib/supabase-browser'
import { STAGE_LABELS, type DetailStageKey } from '@/lib/productionStages'
import { ANDON_REASONS } from '@/lib/productionRouting'
import { PROD_SINCE, parseNotes, urgencyRank, isUrgent, deadlineOf, launchedOf, daysLeftLabel } from '@/lib/orderFlags'
import LeadSummary from './LeadSummary'

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
  const mat = [item.materialName || item.category || '', item.thickness ? `${item.thickness}мм` : ''].filter(Boolean).join(' ')
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
  const [andonFor, setAndonFor] = useState<number | null>(null)
  const [andonReason, setAndonReason] = useState<string>(ANDON_REASONS[0].code)
  const [andonComment, setAndonComment] = useState('')
  const [myStations, setMyStations] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  // Начальник/владелец выбрал мастера в сводке — показываем ЕГО очередь
  const [viewMaster, setViewMaster] = useState<{ id: string; name: string; stations: string[] } | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await sb.auth.getUser()
    if (!user) { setLoading(false); return }

    let queueUserId = user.id
    let stations: string[]
    if (viewMaster) {
      queueUserId = viewMaster.id
      stations = viewMaster.stations
    } else {
      const { data: profile } = await sb.from('users').select('production_stations').eq('id', user.id).single()
      stations = (profile as { production_stations: string[] | null } | null)?.production_stations ?? []
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
      sb.from('production_tasks')
        .select('id,order_id,item_index,stage_key,sequence_order,station,status,blocked_by_task_id,production_day,layer_note')
        .or(orFilter)
        .in('status', ['queued', 'in_progress'])
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
    const dMap = new Map<number, OrderLite>(((doneOrderRows ?? []) as OrderLite[]).map(o => [o.id, o]))
    for (const [id, o] of freshOrders) dMap.set(id, o)
    setDoneOrders(dMap)
    setDoneWeek(dw.filter(t => dMap.has(t.order_id)))
    setBlockers(new Map((blockerRows ?? []).map((b: BlockerLite) => [b.id, b])))
    setLoading(false)
  }, [sb, viewMaster])

  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  const handlePick = useCallback((m: { id: string; name: string; stations: string[] } | null) => {
    setViewMaster(prev => ((prev?.id ?? null) === (m?.id ?? null) ? prev : m))
  }, [])

  async function markStart(taskId: number) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'in_progress' } : t))
    await fetch(`/api/production-tasks/${taskId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start' }),
    }).catch(() => {})
  }

  async function markStartOrder(taskIds: number[]) {
    setTasks(prev => prev.map(t => taskIds.includes(t.id) ? { ...t, status: 'in_progress' } : t))
    await Promise.all(taskIds.map(id =>
      fetch(`/api/production-tasks/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      }).catch(() => {})
    ))
  }

  async function markDone(taskId: number) {
    setTasks(prev => prev.filter(t => t.id !== taskId))
    await fetch(`/api/production-tasks/${taskId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'done' }),
    }).catch(() => {})
    load()
  }

  async function submitAndon() {
    if (andonFor == null) return
    await fetch(`/api/production-tasks/${andonFor}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'problem', reason_code: andonReason, comment: andonComment || null }),
    }).catch(() => {})
    setAndonFor(null)
    setAndonComment('')
    load()
  }

  const isReady = (t: TaskRow) => {
    if (t.blocked_by_task_id == null) return true
    const b = blockers.get(t.blocked_by_task_id)
    return b?.status === 'done'
  }

  const q = search.trim().toLowerCase()
  const orderMatches = (id: number) => {
    if (!q) return true
    const o = orders.get(id)
    return orderNo(o, id).toLowerCase().includes(q) || (o?.client_name ?? '').toLowerCase().includes(q)
  }

  // ── Группировка по заказам ──
  const byOrder = new Map<number, TaskRow[]>()
  for (const t of tasks) {
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

  // ── Табло мастера: по ИЗДЕЛИЯМ (quantity), сегодня и неделя ──
  const piecesOf = (rows: { order_id: number; item_index: number }[], src: Map<number, OrderLite>) =>
    rows.reduce((s, t) => s + qtyOf(src.get(t.order_id), t.item_index), 0)
  const todayIso = new Date(); todayIso.setHours(0, 0, 0, 0)
  const doneToday = doneWeek.filter(t => new Date(t.completed_at) >= todayIso)
  const donePiecesToday = piecesOf(doneToday, doneOrders)
  const donePiecesWeek = piecesOf(doneWeek, doneOrders)
  const leftToday = tasks.filter(t => ['today'].includes(horizonOf(t.order_id)))
  const leftWeek = tasks.filter(t => ['today', 'tomorrow', 'week'].includes(horizonOf(t.order_id)))
  const leftPiecesToday = piecesOf(leftToday, orders)
  const leftPiecesWeek = piecesOf(leftWeek, orders)
  const planToday = donePiecesToday + leftPiecesToday
  const planWeek = donePiecesWeek + leftPiecesWeek
  const pctToday = planToday > 0 ? Math.round(donePiecesToday / planToday * 100) : null
  const pctWeek = planWeek > 0 ? Math.round(donePiecesWeek / planWeek * 100) : null

  const totalReady = tasks.filter(isReady).length
  const totalWaiting = tasks.length - totalReady

  if (loading) return (
    <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка...</div>
  )

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Мои задачи{viewMaster ? ` · ${viewMaster.name}` : ''}</h1>
            <p className="text-[13px] text-[#9a9a95] mt-0.5">{byOrder.size} заказов · {totalReady} деталей готово к работе · {totalWaiting} ожидают этапа</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск: № заказа"
              className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] bg-white w-44 outline-none focus:border-[#111110]" />
            <Link href={`/production-app/station/${myStations[0] ?? 'cutting'}`}
              className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] transition-colors whitespace-nowrap flex-shrink-0">
              Партиями →
            </Link>
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
            </div>
          </div>
        )}

        {byOrder.size === 0 && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-6 text-center">
            <p className="text-[13px] text-[#9a9a95]">{q ? `По запросу «${search}» ничего не найдено` : 'Нет задач в очереди'}</p>
          </div>
        )}

        {HORIZONS.map(h => groups[h.key].length > 0 && (
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
                  onToggle={() => setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })}
                  isReady={isReady}
                  onStart={markStart}
                  onStartAll={markStartOrder}
                  onDone={markDone}
                  onAndon={setAndonFor}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Andon modal */}
      {andonFor != null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center" onClick={() => setAndonFor(null)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h2 className="text-[15px] font-bold text-[#111110] mb-3">Что случилось?</h2>
            <div className="space-y-1.5 mb-3">
              {ANDON_REASONS.map(r => (
                <label key={r.code} className={`flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer transition-colors ${andonReason === r.code ? 'border-red-400 bg-red-50' : 'border-[#e4e4e0]'}`}>
                  <input type="radio" name="andon" checked={andonReason === r.code} onChange={() => setAndonReason(r.code)} className="accent-[#111110]" />
                  <span className="text-[13px] text-[#111110]">{r.label}</span>
                </label>
              ))}
            </div>
            <textarea
              value={andonComment}
              onChange={e => setAndonComment(e.target.value)}
              placeholder="Комментарий (необязательно)"
              className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] mb-3"
              rows={2}
            />
            <div className="flex gap-2">
              <button onClick={() => setAndonFor(null)} className="flex-1 py-2.5 rounded-lg border border-[#e4e4e0] text-[13px] font-medium text-[#6b6b66]">Отмена</button>
              <button onClick={submitAndon} className="flex-1 py-2.5 rounded-lg bg-red-600 text-white text-[13px] font-medium">Сообщить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Карточка заказа: раскрывается на месте, внутри детали и чертёж ───────────

function OrderCard({ order, orderId, tasks, blockers, open, onToggle, isReady, onStart, onStartAll, onDone, onAndon }: {
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
  onAndon: (id: number) => void
}) {
  const notes = order?.notes
  const urgent = isUrgent(notes)
  const deadline = deadlineOf(notes)
  const launched = launchedOf(notes)
  const daysLbl = daysLeftLabel(deadline)
  const drawingUrl = (parseNotes(notes).drawing_url as string | undefined) ?? null
  const isImg = drawingUrl ? /\.(png|jpe?g|webp|gif)(\?|$)/i.test(drawingUrl) : false
  const ready = tasks.filter(isReady)
  const waiting = tasks.filter(t => !isReady(t))
  const inWork = tasks.filter(t => t.status === 'in_progress').length
  const pieces = tasks.reduce((s, t) => s + qtyOf(order, t.item_index), 0)
  const startable = ready.filter(t => t.status === 'queued').map(t => t.id)
  const overdue = daysLbl?.includes('роср')
  const border = urgent || overdue ? 'border-red-300' : open ? 'border-[#111110]' : 'border-[#e4e4e0]'

  return (
    <div className={`rounded-xl border bg-white ${border}`}>
      <button onClick={onToggle} className="w-full text-left px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-[#111110] truncate flex items-center gap-1.5">
              <span className="text-[#9a9a95]">{open ? '▾' : '▸'}</span>
              {urgent && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white">🔥 СРОЧНО</span>}
              {orderNo(order, orderId)}
              {drawingUrl && <span title="Есть чертёж">📐</span>}
            </p>
            <p className="text-[12px] text-[#6b6b66] truncate">{order?.client_name}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-[12px] font-mono text-[#111110]">{tasks.length} дет. · {pieces} изд.{inWork > 0 ? ` · 🔧 ${inWork}` : ''}</p>
            <p className="text-[11px] flex gap-x-2 justify-end flex-wrap">
              {fmtShort(launched) && <span className="text-[#9a9a95]">запуск {fmtShort(launched)}</span>}
              {fmtShort(deadline) && <span className="text-[#9a9a95]">отгрузка {fmtShort(deadline)}</span>}
              {daysLbl && <span className={urgent || overdue ? 'text-red-700 font-semibold' : 'text-[#6b6b66]'}>{daysLbl}</span>}
            </p>
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-[#f0f0ee] px-4 py-3 space-y-3">
          {/* Чертёж заказа (прикрепляется менеджером или в «Заказах») */}
          {drawingUrl && (
            <a href={drawingUrl} target="_blank" rel="noreferrer" className="block">
              {isImg
                ? <img src={drawingUrl} alt="Чертёж" className="max-h-56 rounded-lg border border-[#e4e4e0] object-contain" />
                : <span className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#e4e4e0] text-[13px] text-[#111110] hover:border-[#111110]">📐 Открыть чертёж (PDF)</span>}
            </a>
          )}

          {startable.length > 1 && (
            <button onClick={() => onStartAll(startable)}
              className="w-full py-2 rounded-lg border border-emerald-300 text-emerald-700 text-[13px] font-medium hover:bg-emerald-50">
              Взял весь заказ в работу ({startable.length} дет.)
            </button>
          )}

          <div className="space-y-1.5">
            {ready.map(t => {
              const active = t.status === 'in_progress'
              return (
                <div key={t.id} className={`rounded-lg border px-3 py-2 ${active ? 'border-emerald-300 bg-emerald-50/40' : 'border-[#eceff1]'}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-[12px] font-mono text-[#111110]">{specLine(order?.items?.[t.item_index]) || `Поз. ${t.item_index + 1}`}</p>
                      <p className="text-[11px] text-[#6b6b66]">
                        Поз. {t.item_index + 1} · {STAGE_LABELS[t.stage_key as DetailStageKey] ?? t.stage_key}{t.layer_note ? ` · ${t.layer_note}` : ''}{active ? ' · 🔧 в работе' : ''}
                      </p>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      {!active && <button onClick={() => onStart(t.id)} className="px-2.5 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66] text-[12px] font-medium hover:border-[#111110] hover:text-[#111110]">Взял</button>}
                      <button onClick={() => onDone(t.id)} className="px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[12px] font-medium">Готово</button>
                      <button onClick={() => onAndon(t.id)} className="px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 text-[12px] font-medium">Проблема</button>
                    </div>
                  </div>
                </div>
              )
            })}
            {waiting.map(t => {
              const blocker = t.blocked_by_task_id ? blockers.get(t.blocked_by_task_id) : null
              return (
                <div key={t.id} className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2">
                  <p className="text-[12px] font-mono text-[#111110]">{specLine(order?.items?.[t.item_index]) || `Поз. ${t.item_index + 1}`}</p>
                  <p className="text-[11px] text-amber-700">
                    Поз. {t.item_index + 1} · {STAGE_LABELS[t.stage_key as DetailStageKey] ?? t.stage_key} — ждёт: {blocker ? STAGE_LABELS[blocker.stage_key as DetailStageKey] ?? blocker.stage_key : 'предыдущий этап'}
                  </p>
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
