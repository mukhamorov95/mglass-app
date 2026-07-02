'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'
import dynamic from 'next/dynamic'

const MglassProductionTab = dynamic(() => import('./MglassProductionTab'), { ssr: false })

const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']

const STAGES = [
  { key: 'invoice_sent',     label: 'Счёт' },
  { key: 'invoice_paid',     label: 'Оплачен' },
  { key: 'added_to_group',   label: 'В группу' },
  { key: 'printed',          label: 'Распечатан' },
  { key: 'material_ordered', label: 'Материал' },
  { key: 'cut',              label: 'Нарезан' },
  { key: 'edge_processed',   label: 'Кромка' },
  { key: 'drilled',          label: 'Просверлен' },
  { key: 'tempering',        label: 'Закалка' },
  { key: 'packaged',         label: 'Упакован' },
  { key: 'shipped',          label: 'Отгружен' },
] as const

type StageKey = typeof STAGES[number]['key']

const STAGE_FILTERS = [
  { key: 'all_active',  label: 'Все активные' },
  { key: 'cut',         label: 'Нарезка',    prev: 'printed'        as StageKey, curr: 'cut'            as StageKey },
  { key: 'edge',        label: 'Кромка',      prev: 'cut'            as StageKey, curr: 'edge_processed'  as StageKey },
  { key: 'drill',       label: 'Сверловка',  prev: 'edge_processed' as StageKey, curr: 'drilled'          as StageKey },
  { key: 'tempering',   label: 'Закалка',    prev: 'drilled'        as StageKey, curr: 'tempering'         as StageKey },
  { key: 'packaging',   label: 'Упаковка',   prev: 'tempering'      as StageKey, curr: 'packaged'          as StageKey },
  { key: 'packed',      label: 'Упакованы',  prev: 'packaged'       as StageKey, curr: 'shipped'            as StageKey },
  { key: 'shipped',     label: 'Отгружены',  prev: 'shipped'        as StageKey, curr: null },
] as const

const PROGRESS_STAGES = STAGES.slice(0, 10)

type NotesData = {
  status?: string
  launched_at?: string
  production_days?: number
  user_notes?: string
  stages?: Partial<Record<StageKey, string | null>>
  stage_comments?: Partial<Record<StageKey, string>>
}

type Order = {
  id: number
  client_name: string
  discount_percent: number
  items: unknown[]
  total_sale_inc_vat: number
  total_after_discount: number
  notes: string | null
  created_at: string
  parsedNotes: NotesData
}

function parseNotes(notes: string | null): NotesData {
  if (!notes) return {}
  try {
    const p = JSON.parse(notes)
    if (typeof p === 'object' && p !== null) return p as NotesData
  } catch {}
  return {}
}

function calcProgress(stages: Partial<Record<StageKey, string | null>>) {
  return Math.round(PROGRESS_STAGES.filter(s => !!stages?.[s.key]).length / PROGRESS_STAGES.length * 100)
}

function getOrderNum(pn: NotesData) {
  const m = (pn.user_notes ?? '').match(/[Зз]аказ\s*([\w\-]+)/)
  return m ? m[1] : ''
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

type CommentModal = { orderId: number; stageKey: StageKey; text: string }

export default function ProductionPage() {
  const [activeTab, setActiveTab] = useState<'mglass' | 'b2b'>('mglass')
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('all_active')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [commentModal, setCommentModal] = useState<CommentModal | null>(null)
  const [savingComment, setSavingComment] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const currentMonthKey = new Date().toISOString().slice(0, 7)
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(() => new Set([currentMonthKey]))

  function toggleMonth(key: string) {
    setExpandedMonths(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  useEffect(() => {
    async function load() {
      const sb = createClient()
      const { data } = await sb
        .from('b2b_orders')
        .select('*')
        .not('notes', 'ilike', '%"status":"quote"%')
        .order('created_at', { ascending: true })

      setOrders((data ?? []).map(o => ({
        ...o,
        items: Array.isArray(o.items) ? o.items : [],
        parsedNotes: parseNotes(o.notes),
      })) as Order[])
      setLoading(false)
    }
    load().catch(() => setLoading(false))
  }, [])

  async function toggleStage(orderId: number, stageKey: StageKey) {
    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o
      const stages = { ...(o.parsedNotes.stages ?? {}) } as Partial<Record<StageKey, string | null>>
      stages[stageKey] = stages[stageKey] ? null : new Date().toISOString().slice(0, 10)
      const newParsed: NotesData = { ...o.parsedNotes, stages }
      createClient().from('b2b_orders').update({ notes: JSON.stringify(newParsed) }).eq('id', orderId).then()
      return { ...o, parsedNotes: newParsed }
    }))
  }

  function openComment(orderId: number, stageKey: StageKey) {
    const order = orders.find(o => o.id === orderId)
    const existing = order?.parsedNotes.stage_comments?.[stageKey] ?? ''
    setCommentModal({ orderId, stageKey, text: existing })
  }

  async function saveComment() {
    if (!commentModal) return
    setSavingComment(true)
    setOrders(prev => prev.map(o => {
      if (o.id !== commentModal.orderId) return o
      const stage_comments = { ...(o.parsedNotes.stage_comments ?? {}) }
      if (commentModal.text.trim()) {
        stage_comments[commentModal.stageKey] = commentModal.text.trim()
      } else {
        delete stage_comments[commentModal.stageKey]
      }
      const newParsed: NotesData = { ...o.parsedNotes, stage_comments }
      createClient().from('b2b_orders').update({ notes: JSON.stringify(newParsed) }).eq('id', commentModal.orderId).then()
      return { ...o, parsedNotes: newParsed }
    }))
    setSavingComment(false)
    setCommentModal(null)
  }

  const filtered = useMemo(() => {
    return orders.filter(o => {
      const pn = o.parsedNotes
      const stages = pn.stages ?? {}
      const isShipped = !!stages.shipped

      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const num = getOrderNum(pn).toLowerCase()
        if (!num.includes(q) && !o.client_name.toLowerCase().includes(q)) return false
      }

      const launched = pn.launched_at ?? o.created_at.slice(0, 10)
      if (dateFrom && launched < dateFrom) return false
      if (dateTo && launched > dateTo) return false

      const sf = STAGE_FILTERS.find(f => f.key === stageFilter)
      if (!sf || stageFilter === 'all_active') return !isShipped
      if (stageFilter === 'shipped') return isShipped
      if (stageFilter === 'packed') return !!stages.packaged && !isShipped
      const f = sf as { prev: StageKey; curr: StageKey | null }
      return !!stages[f.prev] && !stages[f.curr!]
    })
  }, [orders, search, stageFilter, dateFrom, dateTo])

  const monthGroups = useMemo(() => {
    const map = new Map<string, Order[]>()
    for (const o of filtered) {
      const launched = o.parsedNotes.launched_at ?? o.created_at.slice(0, 7)
      const key = launched.slice(0, 7)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(o)
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка...</div>
  )

  return (
    <div className="max-w-[1100px] mx-auto px-3 sm:px-4 py-4 sm:py-5">

      {/* Шапка + вкладки */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-[18px] font-semibold text-[#111110] tracking-tight">Производство</h1>
        <div className="flex gap-1 bg-[#f0f0ec] rounded-xl p-1">
          <button onClick={() => setActiveTab('mglass')}
            className={`px-4 py-1.5 rounded-lg text-[13px] font-medium transition-all ${
              activeTab === 'mglass' ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66] hover:text-[#111110]'
            }`}>
            МГласс
          </button>
          <button onClick={() => setActiveTab('b2b')}
            className={`px-4 py-1.5 rounded-lg text-[13px] font-medium transition-all ${
              activeTab === 'b2b' ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66] hover:text-[#111110]'
            }`}>
            B2B
          </button>
        </div>
      </div>

      {activeTab === 'mglass' ? (
        <MglassProductionTab />
      ) : (<>

      {/* Фильтры */}
      <div className="bg-white border border-[#e4e4e0] rounded-xl px-3 sm:px-4 py-3 mb-3 space-y-2.5">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#b4b4ae]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"/>
            </svg>
            <input
              ref={searchRef}
              type="text"
              placeholder="Номер заказа или клиент…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 sm:py-1.5 text-[13px] sm:text-[12px] border border-[#e4e4e0] rounded-lg outline-none focus:border-[#111110] text-[#111110] placeholder:text-[#b4b4ae]"
            />
          </div>
          <div className="flex items-center gap-1.5 text-[12px] text-[#8a8a85]">
            <span>с</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="flex-1 sm:flex-none border border-[#e4e4e0] rounded-lg px-2 py-2 sm:py-1.5 text-[12px] text-[#111110] outline-none focus:border-[#111110]"/>
            <span>по</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="flex-1 sm:flex-none border border-[#e4e4e0] rounded-lg px-2 py-2 sm:py-1.5 text-[12px] text-[#111110] outline-none focus:border-[#111110]"/>
          </div>
          {(search || dateFrom || dateTo || stageFilter !== 'all_active') && (
            <button
              onClick={() => { setSearch(''); setStageFilter('all_active'); setDateFrom(''); setDateTo('') }}
              className="text-[12px] text-[#8a8a85] hover:text-[#111110] px-3 py-2 sm:py-1.5 rounded-lg hover:bg-[#f0f0ec] transition-colors whitespace-nowrap">
              Сбросить
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {STAGE_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setStageFilter(f.key)}
              className={`px-3 sm:px-2.5 py-1.5 sm:py-1 rounded-lg text-[12px] sm:text-[11px] font-medium transition-all border select-none ${
                stageFilter === f.key
                  ? 'bg-[#111110] text-white border-[#111110]'
                  : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110] hover:text-[#111110]'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Список по месяцам */}
      {monthGroups.length === 0 ? (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-10 text-center text-[13px] text-[#8a8a85]">
          Нет заказов по выбранным фильтрам
        </div>
      ) : (
        <div className="space-y-2">
          {monthGroups.map(([monthKey, monthOrders]) => {
            const [year, month] = monthKey.split('-')
            const monthLabel = `${MONTH_NAMES[parseInt(month) - 1]} ${year}`
            const isOpen = expandedMonths.has(monthKey)

            return (
              <div key={monthKey} className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">

                <button
                  onClick={() => toggleMonth(monthKey)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#f8f8f7] transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-[#111110]">{monthLabel}</span>
                    <span className="text-[11px] text-[#9a9a95]">{monthOrders.length} заказов</span>
                  </div>
                  <svg className={`w-4 h-4 text-[#9a9a95] transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isOpen && (
                  <div className="divide-y divide-[#f0f0ec] border-t border-[#f0f0ec]">
                    {monthOrders.map(order => {
                      const pn = order.parsedNotes
                      const isShipped = !!pn.stages?.shipped
                      const progress = calcProgress(pn.stages ?? {})
                      const orderNum = getOrderNum(pn)
                      const launched = pn.launched_at ?? order.created_at.slice(0, 10)
                      const deadline = (() => {
                        if (!pn.launched_at || !pn.production_days) return null
                        const d = new Date(pn.launched_at)
                        d.setDate(d.getDate() + pn.production_days)
                        return d
                      })()
                      const daysLeft = deadline ? Math.ceil((deadline.getTime() - Date.now()) / 86400000) : null

                      return (
                        <div key={order.id} className="px-3 sm:px-4 py-3">

                          {/* Заголовок */}
                          <div className="flex items-center justify-between gap-3 mb-2.5">
                            <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                              {orderNum && (
                                <span className="text-[12px] font-bold text-[#111110] bg-[#f0f0ec] px-2 py-0.5 rounded font-mono flex-shrink-0">
                                  {orderNum}
                                </span>
                              )}
                              <span className="text-[13px] font-semibold text-[#111110]">{order.client_name}</span>
                              <span className="text-[11px] text-[#9a9a95]">{fmtDate(launched)}</span>
                              {isShipped ? (
                                <span className="text-[10px] font-medium px-1.5 py-px rounded-full bg-emerald-50 text-emerald-700">отгружен</span>
                              ) : daysLeft !== null ? (
                                daysLeft < 0
                                  ? <span className="text-[10px] font-medium px-1.5 py-px rounded-full bg-red-50 text-red-600">просрочен {Math.abs(daysLeft)} д.</span>
                                  : daysLeft <= 2
                                    ? <span className="text-[10px] font-medium px-1.5 py-px rounded-full bg-orange-50 text-orange-600">осталось {daysLeft} д.</span>
                                    : null
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {!isShipped && (
                                <span className={`text-[12px] font-bold tabular-nums ${progress === 100 ? 'text-emerald-600' : progress >= 60 ? 'text-amber-600' : 'text-[#9a9a95]'}`}>
                                  {progress}%
                                </span>
                              )}
                              <div className="w-16 sm:w-20 h-1.5 bg-[#f0f0ec] rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${progress === 100 ? 'bg-emerald-500' : 'bg-[#111110]'}`} style={{ width: `${progress}%` }} />
                              </div>
                            </div>
                          </div>

                          {/* Этапы */}
                          <div className="grid grid-cols-4 sm:flex sm:flex-wrap gap-1 sm:gap-1">
                            {STAGES.map(stage => {
                              const doneDate = pn.stages?.[stage.key]
                              const done = !!doneDate
                              const comment = pn.stage_comments?.[stage.key]
                              return (
                                <div key={stage.key} className="relative">
                                  <button
                                    onClick={() => toggleStage(order.id, stage.key)}
                                    title={done ? `Выполнено: ${doneDate}${comment ? '\n' + comment : ''}` : 'Нажать чтобы отметить'}
                                    className={`w-full sm:w-auto flex flex-col items-center px-1 sm:px-2 py-2 sm:py-0.5 rounded text-[11px] sm:text-[10px] font-medium transition-all border select-none active:scale-95 min-h-[44px] sm:min-h-0 justify-center ${
                                      done
                                        ? 'bg-emerald-600 text-white border-emerald-600'
                                        : 'bg-white text-[#9a9a95] border-[#e4e4e0] hover:border-[#111110] hover:text-[#111110]'
                                    }`}>
                                    {stage.label}
                                    {done && doneDate && (
                                      <span className="text-[8px] font-normal opacity-60 leading-none mt-0.5">
                                        {new Date(doneDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                                      </span>
                                    )}
                                  </button>
                                  {done && (
                                    <button
                                      onClick={() => openComment(order.id, stage.key)}
                                      title={comment ? 'Заметка: ' + comment : 'Добавить заметку'}
                                      className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] border transition-colors ${
                                        comment
                                          ? 'bg-amber-400 border-amber-400 text-white'
                                          : 'bg-white border-[#d4d4ce] text-[#9a9a95] hover:border-[#111110] hover:text-[#111110] opacity-0 group-hover:opacity-100'
                                      }`}>
                                      {comment ? '!' : '✎'}
                                    </button>
                                  )}
                                </div>
                              )
                            })}
                          </div>

                          {/* Заметки к этапам */}
                          {pn.stage_comments && Object.keys(pn.stage_comments).length > 0 && (
                            <div className="mt-2 space-y-1">
                              {STAGES.filter(s => pn.stage_comments?.[s.key]).map(stage => (
                                <div key={stage.key} className="flex items-start gap-1.5 text-[11px]">
                                  <span className="text-[#9a9a95] flex-shrink-0">{stage.label}:</span>
                                  <span className="text-[#6b6b66] italic">{pn.stage_comments![stage.key]}</span>
                                  <button
                                    onClick={() => openComment(order.id, stage.key)}
                                    className="text-[#c4c4be] hover:text-[#111110] flex-shrink-0 ml-0.5">✎</button>
                                </div>
                              ))}
                            </div>
                          )}

                        </div>
                      )
                    })}
                  </div>
                )}

              </div>
            )
          })}
        </div>
      )}

      {/* Модальное окно заметки */}
      {commentModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-sm shadow-xl">
            <h2 className="text-[15px] font-semibold text-[#111110] mb-1">
              Заметка: {STAGES.find(s => s.key === commentModal.stageKey)?.label}
            </h2>
            <p className="text-[12px] text-[#9a9a95] mb-3">Причина задержки, уточнение, передача смены</p>
            <textarea
              autoFocus
              rows={3}
              value={commentModal.text}
              onChange={e => setCommentModal(prev => prev ? { ...prev, text: e.target.value } : null)}
              placeholder="Напишите заметку…"
              className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110] resize-none mb-4 placeholder:text-[#c4c4be]"
            />
            <div className="flex gap-2">
              <button onClick={() => setCommentModal(null)}
                className="flex-1 py-2.5 rounded-lg border border-[#e4e4e0] text-[13px] font-medium text-[#6b6b66] hover:bg-[#f8f8f7] transition-colors">
                Отмена
              </button>
              <button onClick={saveComment} disabled={savingComment}
                className="flex-1 py-2.5 rounded-lg bg-[#111110] text-white text-[13px] font-medium hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      </>)}

    </div>
  )
}
