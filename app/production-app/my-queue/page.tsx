'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import ProductionTabs from '@/components/ProductionTabs'
import { createClient } from '@/lib/supabase-browser'
import { STAGE_LABELS, type DetailStageKey } from '@/lib/productionStages'
import { ANDON_REASONS } from '@/lib/productionRouting'
import { urgencyRank, urgencyTone, isUrgent, deadlineOf, launchedOf, daysLeftLabel } from '@/lib/orderFlags'
import LeadSummary from './LeadSummary'

// ─── Types ────────────────────────────────────────────────────────────────────

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

type ItemSpec = { materialName?: string; category?: string; thickness?: number; width?: number; height?: number; quantity?: number; shape?: string }
type OrderLite = { id: number; client_name: string; custom_number: string | null; items?: ItemSpec[]; notes?: unknown }
type BlockerLite = { id: number; status: string; stage_key: string }

function specLine(item?: ItemSpec): string {
  if (!item) return ''
  const dims = item.width && item.height ? `${item.width}×${item.height}` : ''
  const mat = [item.materialName || item.category || '', item.thickness ? `${item.thickness}мм` : ''].filter(Boolean).join(' ')
  const qty = item.quantity && item.quantity > 1 ? `${item.quantity} шт` : ''
  return [dims, mat, qty].filter(Boolean).join(' · ')
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MyQueuePage() {
  const sb = createClient()
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [orders, setOrders] = useState<Map<number, OrderLite>>(new Map())
  const [blockers, setBlockers] = useState<Map<number, BlockerLite>>(new Map())
  const [andonFor, setAndonFor] = useState<number | null>(null)
  const [andonReason, setAndonReason] = useState<string>(ANDON_REASONS[0].code)
  const [andonComment, setAndonComment] = useState('')
  const [myStations, setMyStations] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await sb.auth.getUser()
    if (!user) { setLoading(false); return }

    const { data: profile } = await sb.from('users').select('production_stations').eq('id', user.id).single()
    const stations = (profile as { production_stations: string[] | null } | null)?.production_stations ?? []
    setMyStations(stations)

    const orFilter = stations.length
      ? `assigned_to.eq.${user.id},and(assigned_to.is.null,station.in.(${stations.join(',')}))`
      : `assigned_to.eq.${user.id}`

    const { data: taskRows } = await sb
      .from('production_tasks')
      .select('id,order_id,item_index,stage_key,sequence_order,station,status,blocked_by_task_id,production_day,layer_note')
      .or(orFilter)
      .in('status', ['queued', 'in_progress'])
      .order('sequence_order', { ascending: true })

    const list = (taskRows ?? []) as TaskRow[]
    setTasks(list)

    const orderIds = [...new Set(list.map(t => t.order_id))]
    const blockerIds = [...new Set(list.map(t => t.blocked_by_task_id).filter((x): x is number => x != null))]

    const [{ data: orderRows }, { data: blockerRows }] = await Promise.all([
      orderIds.length
        ? sb.from('b2b_orders').select('id,client_name,custom_number,items,notes').in('id', orderIds)
        : Promise.resolve({ data: [] as OrderLite[] }),
      blockerIds.length
        ? sb.from('production_tasks').select('id,status,stage_key').in('id', blockerIds)
        : Promise.resolve({ data: [] as BlockerLite[] }),
    ])

    setOrders(new Map((orderRows ?? []).map((o: OrderLite) => [o.id, o])))
    setBlockers(new Map((blockerRows ?? []).map((b: BlockerLite) => [b.id, b])))
    setLoading(false)
  }, [sb])

  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  async function markStart(taskId: number) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'in_progress' } : t)) // optimistic
    await fetch(`/api/production-tasks/${taskId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start' }),
    }).catch(() => {})
  }

  async function markDone(taskId: number) {
    setTasks(prev => prev.filter(t => t.id !== taskId)) // optimistic
    // Через API — пишет и в production_tasks, и в notes.detail_stages (прогресс заказа).
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

  // Сортировка по срочности: срочные и с ближайшей отгрузкой — выше.
  const rankOf = (t: TaskRow) => urgencyRank(orders.get(t.order_id)?.notes)
  const byUrgency = (a: TaskRow, b: TaskRow) => rankOf(a) - rankOf(b)
  const ready   = tasks.filter(isReady).sort(byUrgency)
  const waiting = tasks.filter(t => !isReady(t)).sort(byUrgency)

  if (loading) return (
    <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка...</div>
  )

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Мои задачи</h1>
            <p className="text-[13px] text-[#9a9a95] mt-0.5">{ready.length} готово к работе · {waiting.length} ожидаю</p>
          </div>
          <Link href={`/production-app/station/${myStations[0] ?? 'cutting'}`}
            className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] transition-colors whitespace-nowrap flex-shrink-0">
            Партиями →
          </Link>
        </div>
        <ProductionTabs />
      </div>

      <div className="px-4 pt-4">
        <LeadSummary />
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-3">Готово к работе</p>
        {ready.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-6 text-center mb-6">
            <p className="text-[13px] text-[#9a9a95]">Нет задач в очереди</p>
          </div>
        ) : (
          <div className="space-y-2 mb-6">
            {ready.map(t => (
              <TaskCard key={t.id} task={t} order={orders.get(t.order_id)} onStart={() => markStart(t.id)} onDone={() => markDone(t.id)} onAndon={() => setAndonFor(t.id)} />
            ))}
          </div>
        )}

        {waiting.length > 0 && (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-amber-700 mb-3">
              Ожидаю с предыдущего этапа
            </p>
            <div className="space-y-2">
              {waiting.map(t => {
                const blocker = t.blocked_by_task_id ? blockers.get(t.blocked_by_task_id) : null
                const wn = orders.get(t.order_id)?.notes
                const wDays = daysLeftLabel(deadlineOf(wn))
                return (
                  <div key={t.id} className={`rounded-xl border px-4 py-3 ${isUrgent(wn) ? 'bg-red-50 border-red-300' : 'bg-amber-50/50 border-amber-200'}`}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="min-w-0">
                        <p className="text-[14px] font-bold text-[#111110] truncate flex items-center gap-1.5">
                          {isUrgent(wn) && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white">🔥 СРОЧНО</span>}
                          {orders.get(t.order_id)?.custom_number?.trim() || `#${t.order_id}`}
                        </p>
                        <p className="text-[12px] text-[#6b6b66] truncate">{orders.get(t.order_id)?.client_name}{wDays ? ` · ${wDays}` : ''}</p>
                      </div>
                      <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap flex-shrink-0">
                        Поз. {t.item_index + 1} · {STAGE_LABELS[t.stage_key as DetailStageKey] ?? t.stage_key}{t.layer_note ? ` · ${t.layer_note}` : ''}
                      </span>
                    </div>
                    <p className="text-[12px] text-amber-700">
                      Ещё не пришло: {blocker ? STAGE_LABELS[blocker.stage_key as DetailStageKey] ?? blocker.stage_key : 'предыдущий этап'} не выполнен
                    </p>
                  </div>
                )
              })}
            </div>
          </>
        )}
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

const fmtShort = (s: string | null) => { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) }

function TaskCard({ task, order, onStart, onDone, onAndon }: {
  task: TaskRow
  order: OrderLite | undefined
  onStart: () => void
  onDone: () => void
  onAndon: () => void
}) {
  const spec = specLine(order?.items?.[task.item_index])
  const active = task.status === 'in_progress'
  const tone = urgencyTone(order?.notes)
  const urgent = isUrgent(order?.notes)
  const deadline = deadlineOf(order?.notes)
  const launched = launchedOf(order?.notes)
  const daysLbl = daysLeftLabel(deadline)
  const cardBorder = tone === 'red' ? 'border-red-300 bg-red-50' : tone === 'amber' ? 'border-amber-300 bg-amber-50/40' : active ? 'border-emerald-300 bg-white' : 'border-[#e4e4e0] bg-white'
  const dLeftCls = tone === 'red' ? 'text-red-700 font-semibold' : tone === 'amber' ? 'text-amber-700 font-medium' : 'text-[#6b6b66]'
  return (
    <div className={`rounded-xl border px-4 py-3 ${cardBorder}`}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <Link href={`/p/o/${task.order_id}`} className="min-w-0">
          <p className="text-[14px] font-bold text-[#111110] truncate flex items-center gap-1.5">
            {urgent && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white">🔥 СРОЧНО</span>}
            {order?.custom_number?.trim() || `#${task.order_id}`}
          </p>
          <p className="text-[12px] text-[#6b6b66] truncate">{order?.client_name}</p>
        </Link>
        <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-[#f0f0ec] text-[#6b6b66] whitespace-nowrap flex-shrink-0">
          Поз. {task.item_index + 1} · {STAGE_LABELS[task.stage_key as DetailStageKey] ?? task.stage_key}{task.layer_note ? ` · ${task.layer_note}` : ''}
        </span>
      </div>
      {(launched || deadline) && (
        <p className="text-[11px] mb-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5">
          {fmtShort(launched) && <span className="text-[#9a9a95]">запуск {fmtShort(launched)}</span>}
          {fmtShort(deadline) && <span className="text-[#9a9a95]">отгрузка {fmtShort(deadline)}</span>}
          {daysLbl && <span className={dLeftCls}>{daysLbl}</span>}
        </p>
      )}
      {spec && <p className="text-[12px] font-mono text-[#111110] mb-2.5">{spec}</p>}
      {active && <p className="text-[11px] font-medium text-emerald-700 mb-2">🔧 в работе</p>}
      <div className="flex gap-2">
        {!active && (
          <button onClick={onStart} className="px-3 py-2 rounded-lg border border-[#e4e4e0] text-[#6b6b66] text-[13px] font-medium hover:border-[#111110] hover:text-[#111110] transition-colors">Взял</button>
        )}
        <button onClick={onDone} className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-[13px] font-medium">Выполнено</button>
        <button onClick={onAndon} className="px-3 py-2 rounded-lg border border-red-200 text-red-600 text-[13px] font-medium">Проблема</button>
      </div>
    </div>
  )
}
