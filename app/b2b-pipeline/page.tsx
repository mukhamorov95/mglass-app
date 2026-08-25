'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { createClient } from '@/lib/supabase-browser'
import { finalTotalOf } from '@/lib/b2b/priceOverride'

type Quote = {
  id: number
  client_name: string
  total_after_discount: number
  total_sale_inc_vat: number
  discount_percent: number
  margin_percent: number
  notes: string | null
  created_at: string
}

type ColStatus = 'quote' | 'sent' | 'negotiation' | 'agreed' | 'confirmed' | 'in_production' | 'completed' | 'cancelled'

const COLUMNS: { key: ColStatus; label: string; color: string; bg: string; border: string }[] = [
  { key: 'quote',         label: 'Новый',           color: 'text-[#6b6b66]',   bg: 'bg-[#f0f0ec]',   border: 'border-[#c4c4be]' },
  { key: 'sent',          label: 'Отправлено',       color: 'text-blue-700',    bg: 'bg-blue-50',     border: 'border-blue-300'  },
  { key: 'negotiation',   label: 'Переговоры',       color: 'text-indigo-700',  bg: 'bg-indigo-50',   border: 'border-indigo-300'},
  { key: 'agreed',        label: 'Согласовано',      color: 'text-emerald-700', bg: 'bg-emerald-50',  border: 'border-emerald-300'},
  { key: 'confirmed',     label: 'В заказе',         color: 'text-purple-700',  bg: 'bg-purple-50',   border: 'border-purple-300'},
  { key: 'in_production', label: 'В производстве',   color: 'text-orange-700',  bg: 'bg-orange-50',   border: 'border-orange-300'},
  { key: 'completed',     label: 'Завершено',        color: 'text-teal-700',    bg: 'bg-teal-50',     border: 'border-teal-300'  },
  { key: 'cancelled',     label: 'Отменено',         color: 'text-red-600',     bg: 'bg-red-50',      border: 'border-red-300'   },
]

function parseNotes(n: string | null): Record<string, unknown> {
  if (!n) return {}
  try { const p = JSON.parse(n); if (typeof p === 'object') return p } catch {}
  return {}
}

function getStatus(q: Quote): ColStatus {
  const s = parseNotes(q.notes).status as string
  if (s === 'in_production') return 'in_production'
  if (s === 'completed')     return 'completed'
  if (s === 'cancelled' || s === 'rejected') return 'cancelled'
  if (s === 'confirmed')     return 'confirmed'
  if (s === 'negotiation')   return 'negotiation'
  if (s === 'agreed')        return 'agreed'
  if (s === 'sent')          return 'sent'
  return 'quote'
}

function daysInStatus(q: Quote): number {
  const n = parseNotes(q.notes)
  const history = n.status_history
  if (Array.isArray(history) && history.length > 0) {
    const last = history[history.length - 1] as { date?: string }
    if (last.date) return Math.floor((Date.now() - new Date(last.date).getTime()) / 86_400_000)
  }
  return Math.floor((Date.now() - new Date(q.created_at).getTime()) / 86_400_000)
}

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

// ── Draggable card ────────────────────────────────────────────────────────────
function DraggableCard({ quote, isOverlay }: { quote: Quote; isOverlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: quote.id,
    data: { quote },
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging && !isOverlay ? 0.35 : 1,
    transition: isOverlay ? undefined : 'opacity 0.15s',
  }

  const total = finalTotalOf(quote)
  const isLowMargin = quote.margin_percent > 0 && quote.margin_percent < 15
  const days = daysInStatus(quote)
  const manager = parseNotes(quote.notes).manager_name as string | null
  const managerShort = manager ? manager.split('@')[0] : null

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`bg-white border border-[#e4e4e0] rounded-xl p-3 cursor-grab active:cursor-grabbing select-none
        hover:shadow-sm hover:border-[#c4c4be] transition-shadow
        ${isOverlay ? 'shadow-xl rotate-1 border-[#111110]' : ''}`}>
      <div className="flex items-start justify-between gap-1 mb-1.5">
        <p className="text-[13px] font-semibold text-[#111110] leading-snug">{quote.client_name}</p>
        {isLowMargin && (
          <span className="text-[9px] font-bold bg-red-50 text-red-600 px-1 py-0.5 rounded shrink-0">
            {quote.margin_percent}%
          </span>
        )}
      </div>
      <p className="text-[14px] font-bold font-mono text-[#111110] mb-1.5">{fmt(total)}</p>
      <div className="flex items-center justify-between text-[10px] text-[#9a9a95]">
        <span>{new Date(quote.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>
        <span className={`font-medium ${days >= 7 ? 'text-amber-600' : days >= 14 ? 'text-red-600' : ''}`}>
          {days}д
        </span>
      </div>
      {managerShort && (
        <p className="text-[10px] text-[#c4c4be] mt-1 truncate">👤 {managerShort}</p>
      )}
    </div>
  )
}

// ── Droppable column ──────────────────────────────────────────────────────────
function DroppableColumn({
  col, quotes,
}: {
  col: typeof COLUMNS[number]
  quotes: Quote[]
}) {
  const { isOver, setNodeRef } = useDroppable({ id: col.key })
  const total = quotes.reduce((s, q) => s + finalTotalOf(q), 0)

  return (
    <div className="flex-shrink-0 w-[230px]">
      {/* Column header */}
      <div className={`rounded-xl px-3 py-2.5 mb-2 border ${col.bg} ${isOver ? col.border + ' border-2' : 'border-transparent'} transition-all`}>
        <div className="flex items-center justify-between">
          <span className={`text-[11px] font-semibold ${col.color}`}>{col.label}</span>
          <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${col.bg} ${col.color}`}>
            {quotes.length}
          </span>
        </div>
        {quotes.length > 0 && (
          <p className={`text-[10px] font-mono mt-0.5 ${col.color} opacity-75`}>{fmt(total)}</p>
        )}
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={`min-h-[120px] space-y-2 rounded-xl transition-all p-1 -m-1
          ${isOver ? 'bg-blue-50/50 ring-2 ring-blue-300 ring-inset' : ''}`}>
        {quotes.map(q => (
          <DraggableCard key={q.id} quote={q} />
        ))}
        {quotes.length === 0 && !isOver && (
          <div className="py-8 text-center text-[11px] text-[#c4c4be] border border-dashed border-[#e4e4e0] rounded-xl">
            Пусто
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function B2BPipelinePage() {
  const [quotes, setQuotes]     = useState<Quote[]>([])
  const [loading, setLoading]   = useState(true)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [toast, setToast]       = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<'kanban' | 'list'>('kanban')
  const toastTimer              = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  // eslint-disable-next-line react-hooks/immutability
  useEffect(() => { load().catch(() => setLoading(false)) }, [])

  async function load() {
    setLoading(true)
    const sb = createClient()
    const { data } = await sb
      .from('b2b_orders')
      .select('id,client_name,total_after_discount,total_sale_inc_vat,discount_percent,margin_percent,notes,created_at')
      .order('created_at', { ascending: false })
      .limit(500)
    setQuotes(data ?? [])
    setLoading(false)
  }

  function showToast(msg: string) {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2500)
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as number)
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return

    const quoteId   = active.id as number
    const newStatus = over.id as ColStatus
    const quote     = quotes.find(q => q.id === quoteId)
    if (!quote) return
    if (getStatus(quote) === newStatus) return

    const parsed   = parseNotes(quote.notes)
    const history  = Array.isArray(parsed.status_history) ? [...(parsed.status_history as unknown[])] : []
    history.push({ from: getStatus(quote), to: newStatus, date: new Date().toISOString() })
    const newNotes = JSON.stringify({ ...parsed, status: newStatus, status_history: history })

    // Optimistic update
    setQuotes(prev => prev.map(q => q.id === quoteId ? { ...q, notes: newNotes } : q))

    const sb = createClient()
    const { error } = await sb.from('b2b_orders').update({ notes: newNotes }).eq('id', quoteId)

    if (error) {
      // Rollback
      setQuotes(prev => prev.map(q => q.id === quoteId ? quote : q))
      showToast('Ошибка при обновлении статуса')
    } else {
      showToast('Статус обновлён')
    }
  }

  const columns = useMemo(() => {
    const map = Object.fromEntries(COLUMNS.map(c => [c.key, [] as Quote[]])) as Record<ColStatus, Quote[]>
    for (const q of quotes) map[getStatus(q)].push(q)
    return map
  }, [quotes])

  const activeQuote = activeId !== null ? quotes.find(q => q.id === activeId) : null

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка...</div>
  )

  return (
    <div className="min-h-screen bg-[#f8f8f7]">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-[#111110] text-white text-[12px] px-4 py-2.5 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      <div className="px-4 py-5">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
          <h1 className="text-[16px] font-semibold text-[#111110] tracking-tight">Воронка продаж B2B</h1>
          <div className="flex items-center gap-2">
            <p className="text-[12px] text-[#9a9a95] hidden sm:block">{quotes.length} заказов · перетащи для смены статуса</p>
            {/* Mobile view toggle */}
            <div className="flex bg-[#f0f0ec] rounded-lg p-0.5 sm:hidden">
              {(['kanban', 'list'] as const).map(v => (
                <button key={v} onClick={() => setMobileView(v)}
                  className={`px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${mobileView === v ? 'bg-white text-[#111110] shadow-sm' : 'text-[#8a8a85]'}`}>
                  {v === 'kanban' ? '⠿ Канбан' : '☰ Список'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Mobile list view */}
        {mobileView === 'list' && (
          <div className="sm:hidden space-y-2">
            {COLUMNS.filter(col => columns[col.key].length > 0).map(col => (
              <div key={col.key} className={`rounded-xl border ${col.border} overflow-hidden`}>
                <div className={`px-3 py-2 flex items-center justify-between ${col.bg}`}>
                  <span className={`text-[12px] font-semibold ${col.color}`}>{col.label}</span>
                  <span className={`text-[11px] font-bold ${col.color}`}>{columns[col.key].length}</span>
                </div>
                <div className="divide-y divide-[#f8f8f7]">
                  {columns[col.key].map(q => {
                    const total = finalTotalOf(q)
                    const days = daysInStatus(q)
                    return (
                      <div key={q.id} className="px-3 py-2.5 bg-white flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-[#111110] truncate">{q.client_name}</p>
                          <p className="text-[11px] text-[#9a9a95]">{total.toLocaleString('ru-RU')} ₽</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {q.margin_percent > 0 && q.margin_percent < 15 && (
                            <span className="text-[9px] font-bold bg-red-50 text-red-600 px-1 py-0.5 rounded">{q.margin_percent}%</span>
                          )}
                          <span className={`text-[10px] font-medium ${days >= 14 ? 'text-red-600' : days >= 7 ? 'text-amber-600' : 'text-[#9a9a95]'}`}>{days}д</span>
                          <select
                            value={col.key}
                            onChange={async e => {
                              const newStatus = e.target.value as typeof col.key
                              const parsed = parseNotes(q.notes)
                              const history = Array.isArray(parsed.status_history) ? [...(parsed.status_history as unknown[])] : []
                              history.push({ from: col.key, to: newStatus, date: new Date().toISOString() })
                              const newNotes = JSON.stringify({ ...parsed, status: newStatus, status_history: history })
                              setQuotes(prev => prev.map(x => x.id === q.id ? { ...x, notes: newNotes } : x))
                              const sb = createClient()
                              const { error } = await sb.from('b2b_orders').update({ notes: newNotes }).eq('id', q.id)
                              if (error) { setQuotes(prev => prev.map(x => x.id === q.id ? q : x)); showToast('Ошибка') }
                              else showToast('Статус обновлён')
                            }}
                            className="text-[10px] border border-[#e4e4e0] rounded-lg px-1.5 py-1 bg-white text-[#6b6b66] outline-none"
                            onClick={e => e.stopPropagation()}>
                            {COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                          </select>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Kanban (desktop always, mobile when kanban mode) */}
        <div className={mobileView === 'kanban' ? '' : 'hidden sm:block'}>
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: '70vh' }}>
            {COLUMNS.map(col => (
              <DroppableColumn key={col.key} col={col} quotes={columns[col.key]} />
            ))}
          </div>

          <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
            {activeQuote && <DraggableCard quote={activeQuote} isOverlay />}
          </DragOverlay>
        </DndContext>
        </div>
      </div>
    </div>
  )
}
