'use client'

import { useEffect, useState, useCallback } from 'react'
import ProductionTabs from '@/components/ProductionTabs'
import { createClient } from '@/lib/supabase-browser'
import { STAGE_LABELS, getApplicableStages, type DetailStageKey } from '@/lib/productionStages'
import { ANDON_REASONS } from '@/lib/productionRouting'
import { urgencyRank, urgencyTone, isUrgent, deadlineOf, launchedOf, daysLeftLabel, parseNotes } from '@/lib/orderFlags'

// Единый экран «Заказы»: список по срочности → клик раскрывает заказ (чертёж
// сверху, детали × этапы кнопками, «Упаковано» = всё готово, «Проблема»).
// Отметить этап может «ответственный» (production_lead), owner или мастер своей
// станции — защита от случайных нажатий. Пишет через PATCH /api/production-tasks
// (двойная запись в production_tasks + notes.detail_stages — прогресс везде верен).

type Task = { id: number; order_id: number; item_index: number; stage_key: string; station: string; status: string; sequence_order: number }
type Item = { materialName?: string; category?: string; thickness?: number; width?: number; height?: number; quantity?: number; hasTempering?: boolean; hasFacet?: boolean; hasHoles?: boolean; shape?: 'rect' | 'curved'; hasTriplex?: boolean }
type Order = { id: number; custom_number: string | null; client_name: string; items: unknown; notes: unknown }
type Me = { role: string | null; production_stations: string[] | null; production_lead: boolean }

const OWNER = new Set(['admin', 'ceo'])
const OWNER_EMAIL = 'admin@mglass.ru'  // владелец опознаётся по email (см. lib/getRole)
const fmtShort = (s: string | null) => { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) }
const itemsArr = (v: unknown): Item[] => Array.isArray(v) ? v as Item[] : []
function specLine(it?: Item): string {
  if (!it) return ''
  const dims = it.width && it.height ? `${it.width}×${it.height}` : ''
  const mat = [it.materialName || it.category || '', it.thickness ? `${it.thickness}мм` : ''].filter(Boolean).join(' ')
  const qty = it.quantity && it.quantity > 1 ? `${it.quantity} шт` : ''
  return [dims, mat, qty].filter(Boolean).join(' · ')
}

export default function OrdersScreen() {
  const sb = createClient()
  const [tasks, setTasks] = useState<Task[]>([])
  const [orders, setOrders] = useState<Map<number, Order>>(new Map())
  const [me, setMe] = useState<Me>({ role: null, production_stations: [], production_lead: false })
  const [open, setOpen] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [problemFor, setProblemFor] = useState<number | null>(null)
  const [pReason, setPReason] = useState(ANDON_REASONS[0].code)
  const [pComment, setPComment] = useState('')

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2800) }

  const load = useCallback(async () => {
    const { data: { user } } = await sb.auth.getUser()
    if (user) {
      // role + stations — давно есть; production_lead отдельно (новая колонка может
      // ещё не попасть в кэш схемы PostgREST — тогда не роняем owner-детекцию).
      const { data: p } = await sb.from('users').select('role,production_stations').eq('id', user.id).single()
      let lead = false
      try { const { data: l } = await sb.from('users').select('production_lead').eq('id', user.id).maybeSingle(); lead = !!(l as { production_lead?: boolean } | null)?.production_lead } catch { /* колонка ещё не в кэше */ }
      const role = user.email === OWNER_EMAIL ? 'admin' : (p as Me | null)?.role ?? null
      setMe({ role, production_stations: (p as Me | null)?.production_stations ?? [], production_lead: lead })
    }
    const { data: taskRows } = await sb.from('production_tasks')
      .select('id,order_id,item_index,stage_key,station,status,sequence_order')
      .in('status', ['queued', 'in_progress', 'problem']).order('sequence_order')
    const ts = (taskRows ?? []) as Task[]
    setTasks(ts)
    const ids = [...new Set(ts.map(t => t.order_id))]
    if (ids.length) {
      const { data: ords } = await sb.from('b2b_orders').select('id,custom_number,client_name,items,notes').in('id', ids)
      setOrders(new Map((ords ?? []).map((o: Order) => [o.id, o])))
    }
    setLoading(false)
  }, [sb])
  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  const canMark = (station: string) => me.production_lead || (me.role != null && OWNER.has(me.role)) || (me.production_stations ?? []).includes(station)

  async function markDone(taskId: number, station: string) {
    if (!canMark(station)) { flash('Этот этап отмечает мастер своей станции или ответственный'); return }
    const r = await fetch(`/api/production-tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'done' }) })
    if (!r.ok) { const d = await r.json().catch(() => ({})); flash(d.message || 'Не удалось отметить'); return }
    await load()
  }

  async function packAll(orderId: number) {
    if (!(me.production_lead || (me.role != null && OWNER.has(me.role)))) { flash('«Упаковано разом» — только ответственный'); return }
    const rest = tasks.filter(t => t.order_id === orderId && t.status !== 'done')
    for (const t of rest) await fetch(`/api/production-tasks/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'done', force: true }) }).catch(() => {})
    await load(); flash('Заказ отмечен готовым')
  }

  async function submitProblem(orderId: number) {
    const frontier = tasks.filter(t => t.order_id === orderId && t.status !== 'done').sort((a, b) => a.sequence_order - b.sequence_order)[0]
    if (!frontier) return
    await fetch(`/api/production-tasks/${frontier.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'problem', reason_code: pReason, comment: pComment || null }) }).catch(() => {})
    setProblemFor(null); setPComment(''); await load(); flash('Проблема зафиксирована')
  }

  async function uploadDrawing(order: Order, file: File) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `order-drawings/${order.id}.${ext}`
    const { error } = await sb.storage.from('b2b-attachments').upload(path, file, { upsert: true })
    if (error) { flash('Не удалось загрузить'); return }
    const { data } = sb.storage.from('b2b-attachments').getPublicUrl(path)
    const url = `${data.publicUrl}?t=${path.length}`
    await sb.from('b2b_orders').update({ notes: JSON.stringify({ ...parseNotes(order.notes), drawing_url: url }) }).eq('id', order.id)
    await load()
  }

  // Заказы по срочности.
  const orderIds = [...new Set(tasks.map(t => t.order_id))]
    .sort((a, b) => urgencyRank(orders.get(a)?.notes) - urgencyRank(orders.get(b)?.notes))

  if (loading) return <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка…</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl shadow-lg text-[13px] font-semibold bg-[#111110] text-white">{toast}</div>}

      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Заказы</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">{orderIds.length} в работе · по срочности · клик — раскрыть{me.production_lead ? ' · вы ответственный' : ''}</p>
        <ProductionTabs />
      </div>

      <div className="px-4 pt-4 space-y-2 max-w-[760px] mx-auto">
        {orderIds.length === 0 && <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center text-[13px] text-[#9a9a95]">Нет заказов в работе</div>}
        {orderIds.map(oid => {
          const o = orders.get(oid)
          const oTasks = tasks.filter(t => t.order_id === oid)
          const done = oTasks.filter(t => t.status === 'done').length
          const problem = oTasks.some(t => t.status === 'problem')
          const total = oTasks.length
          const tone = urgencyTone(o?.notes)
          const urgent = isUrgent(o?.notes)
          const deadline = deadlineOf(o?.notes)
          const daysLbl = daysLeftLabel(deadline)
          const border = problem ? 'border-red-300' : tone === 'red' ? 'border-red-300' : tone === 'amber' ? 'border-amber-300' : 'border-[#e4e4e0]'
          const items = itemsArr(o?.items)
          const drawingUrl = parseNotes(o?.notes).drawing_url as string | undefined
          const isOpen = open === oid
          return (
            <div key={oid} className={`bg-white rounded-xl border ${border} overflow-hidden`}>
              <button onClick={() => setOpen(isOpen ? null : oid)} className="w-full text-left px-4 py-3 hover:bg-[#fafaf9]">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[14px] font-bold text-[#111110] truncate flex items-center gap-1.5">
                      {urgent && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white">🔥 СРОЧНО</span>}
                      {o?.custom_number?.trim() || `#${oid}`}
                    </p>
                    <p className="text-[12px] text-[#6b6b66] truncate">
                      {o?.client_name}{fmtShort(deadline) ? ` · отгрузка ${fmtShort(deadline)}` : ''}{daysLbl ? ` · ${daysLbl}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {problem && <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-red-100 text-red-700">проблема</span>}
                    <span className="text-[12px] font-semibold text-[#111110]">{done}/{total}</span>
                    <span className="text-[#9a9a95] text-[13px]">{isOpen ? '▲' : '▼'}</span>
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-[#f0f0ec] px-4 py-3 space-y-3">
                  {/* Чертёж */}
                  <div>
                    {drawingUrl ? (
                      /\.pdf(\?|$)/i.test(drawingUrl)
                        ? <a href={drawingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-[13px] font-medium text-blue-600">📄 Открыть чертёж (PDF)</a>
                        : <a href={drawingUrl} target="_blank" rel="noreferrer" className="block">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={drawingUrl} alt="чертёж" className="max-h-48 rounded-lg border border-[#e4e4e0]" />
                            <span className="text-[11px] text-blue-600">открыть чертёж →</span>
                          </a>
                    ) : (
                      <label className="inline-flex items-center gap-2 text-[13px] text-[#6b6b66] cursor-pointer border border-dashed border-[#d8d8d3] rounded-lg px-3 py-2 hover:bg-[#fafaf9]">
                        📐 Прикрепить чертёж
                        <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f && o) uploadDrawing(o, f); e.target.value = '' }} />
                      </label>
                    )}
                  </div>

                  {/* Детали × этапы */}
                  <div className="space-y-2">
                    {items.map((it, i) => {
                      const stages = getApplicableStages(it)
                      return (
                        <div key={i} className="border border-[#f0f0ec] rounded-lg p-2.5">
                          <p className="text-[12px] font-mono text-[#111110] mb-1.5">Поз.{i + 1} · {specLine(it) || '—'}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {stages.map(s => {
                              const t = oTasks.find(x => x.item_index === i && x.stage_key === s.key)
                              const status = t?.status ?? 'queued'
                              const cls = status === 'done' ? 'bg-emerald-600 text-white' : status === 'problem' ? 'bg-red-600 text-white' : status === 'in_progress' ? 'bg-blue-600 text-white' : 'bg-[#f0f0ec] text-[#6b6b66]'
                              const allowed = t && status !== 'done' && canMark(t.station)
                              return (
                                <button key={s.key} disabled={!allowed}
                                  onClick={() => t && markDone(t.id, t.station)}
                                  className={`text-[11px] font-medium px-2.5 py-1.5 rounded-lg ${cls} ${allowed ? 'ring-1 ring-inset ring-black/10 hover:opacity-90' : 'cursor-default'}`}>
                                  {status === 'done' ? '✓ ' : ''}{STAGE_LABELS[s.key as DetailStageKey]}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Действия по заказу */}
                  <div className="flex gap-2 pt-1">
                    {(me.production_lead || (me.role != null && OWNER.has(me.role))) && (
                      <button onClick={() => packAll(oid)} className="flex-1 py-2 rounded-lg bg-[#111110] text-white text-[13px] font-semibold">📦 Упаковано — всё готово</button>
                    )}
                    <button onClick={() => setProblemFor(problemFor === oid ? null : oid)} className="px-4 py-2 rounded-lg border border-red-200 text-red-600 text-[13px] font-semibold">Проблема</button>
                  </div>

                  {problemFor === oid && (
                    <div className="border border-red-200 bg-red-50 rounded-lg p-3 space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {ANDON_REASONS.map(r => (
                          <button key={r.code} onClick={() => setPReason(r.code)} className={`text-[12px] px-2.5 py-1 rounded-full ${pReason === r.code ? 'bg-red-600 text-white' : 'bg-white border border-red-200 text-red-700'}`}>{r.label}</button>
                        ))}
                      </div>
                      <textarea value={pComment} onChange={e => setPComment(e.target.value)} rows={2} placeholder="Что случилось (необязательно)" className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
                      <div className="flex gap-2">
                        <button onClick={() => setProblemFor(null)} className="flex-1 py-2 rounded-lg border border-[#e4e4e0] text-[13px] text-[#6b6b66]">Отмена</button>
                        <button onClick={() => submitProblem(oid)} className="flex-1 py-2 rounded-lg bg-red-600 text-white text-[13px] font-semibold">Сообщить о проблеме</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
