'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'
import { type DetailStageKey, type DetailStageState, type DetailStages, isMirrorItem, itemNeedsTempering, PROBLEM_REASONS, STAGE_LABELS, getApplicableStages } from '@/lib/productionStages'

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderItem = {
  materialName?: string
  category?:     string
  thickness?:    number
  width?:        number
  height?:       number
  quantity?:     number
  totalAreaNet?: number
  totalWeight?:  number
  hasTempering?: boolean
  hasFacet?:     boolean
  facetTypeMm?:  number
  hasHoles?:     boolean
  shape?:        'rect' | 'curved'
  services?:     { name: string; cost: number }[]
  comment?:      string
}

type AuditEntry = {
  type:           'stage_unset'
  item_index:     number
  stage_key:      DetailStageKey
  previous_value: DetailStageState
  reason:         string
  created_at:     string
  created_by:     string
  created_by_email?: string
}

type NotesData = {
  status?:              string
  launched_at?:         string
  work_started_at?:     string
  production_days?:     number
  user_notes?:          string
  detail_stages?:       DetailStages
  detail_stage_audit?:  AuditEntry[]
  deadline_date?:       string
  urgent?:              boolean
}

type Order = {
  id:                  number
  client_name:         string
  custom_number:       string | null
  client_order_number: string | null
  items:               OrderItem[]
  notes:               string | null
  total_area:          number
  total_weight:        number
  created_at:          string
}

// ─── Constants ────────────────────────────────────────────────────────────────

// PRODUCTION_STAGES, STAGE_LABELS, getApplicableStages — imported from lib/productionStages

const GROUP_ACTIONS: { key: DetailStageKey; label: string; danger?: boolean }[] = [
  { key: 'cutting',   label: 'Резка выполнена'     },
  { key: 'curved',    label: 'Криволинейка выполнена' },
  { key: 'polishing', label: 'Полировка выполнена' },
  { key: 'drilling',  label: 'Сверление выполнено' },
  { key: 'facet',     label: 'Фацет выполнен'      },
  { key: 'tempering', label: 'Закалка выполнена'   },
  { key: 'triplex',   label: 'Триплекс выполнен'   },
  { key: 'packaging', label: 'Упаковано'           },
  { key: 'problem',   label: 'Проблема',  danger: true },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseNotes(notes: string | null): NotesData {
  if (!notes) return {}
  try {
    const p = JSON.parse(notes)
    if (typeof p === 'object' && p !== null) return p as NotesData
  } catch {}
  return {}
}

function fmtDate(s: string | undefined | null): string {
  if (!s) return ''
  return new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtDateShort(s: string): string {
  const d = new Date(s)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtDateTime(s: string | undefined): string {
  if (!s) return '—'
  try {
    const d = new Date(s)
    if (isNaN(d.getTime())) return '—'
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return '—'
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10; const m100 = n % 100
  if (m100 >= 11 && m100 <= 14) return many
  if (m10 === 1) return one
  if (m10 >= 2 && m10 <= 4) return few
  return many
}

function itemAreaM2(item: OrderItem): number {
  if ((item.totalAreaNet ?? 0) > 0) return item.totalAreaNet!
  const w = item.width ?? 0; const h = item.height ?? 0; const q = item.quantity ?? 1
  return w > 0 && h > 0 ? (w * h / 1_000_000) * q : 0
}

function itemWeightKg(item: OrderItem): number {
  if ((item.totalWeight ?? 0) > 0) return item.totalWeight!
  const area = itemAreaM2(item); const t = item.thickness ?? 0
  return area > 0 && t > 0 ? area * t * 2.5 : 0
}

// ─── ProblemModal ─────────────────────────────────────────────────────────────

function ProblemModal({
  itemCount,
  saving,
  onConfirm,
  onCancel,
}: {
  itemCount: number
  saving:    boolean
  onConfirm: (reason: string, note: string) => void
  onCancel:  () => void
}) {
  const [reason, setReason] = useState('')
  const [note,   setNote]   = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px]">
      <div className="w-full max-w-sm bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-[#f0f0ec]">
          <div className="flex items-center justify-between mb-0.5">
            <h2 className="text-[16px] font-bold text-[#111110]">Фиксация проблемы</h2>
            <button onClick={onCancel} className="p-1 -mr-1 text-[#9a9a95] hover:text-[#111110] transition-colors">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-[12px] text-[#9a9a95]">
            {itemCount} {itemCount === 1 ? 'позиция' : itemCount < 5 ? 'позиции' : 'позиций'}
          </p>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">

          {/* Reason list */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-2">Причина</p>
            <div className="space-y-1.5">
              {PROBLEM_REASONS.map(r => (
                <button
                  key={r}
                  onClick={() => setReason(prev => prev === r ? '' : r)}
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl text-[13px] font-medium border transition-all ${
                    reason === r
                      ? 'border-red-400 bg-red-50 text-red-700'
                      : 'border-[#e8e8e4] bg-[#fafaf9] text-[#3a3a35] hover:border-[#c4c4be] hover:bg-white'
                  }`}
                >
                  {reason === r && (
                    <span className="mr-1.5 text-red-500">✓</span>
                  )}
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Comment */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-2">Комментарий (необязательно)</p>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="Уточните деталь, номер позиции и т.д."
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#e8e8e4] bg-[#fafaf9] text-[13px] text-[#111110] placeholder-[#c4c4be] resize-none focus:outline-none focus:border-[#9a9a95]"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-2 flex gap-2.5">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-3 rounded-xl border border-[#e8e8e4] text-[13px] font-medium text-[#6b6b66] hover:bg-[#f4f4f0] transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={() => onConfirm(reason, note)}
            disabled={saving || !reason}
            className={`flex-1 py-3 rounded-xl text-[13px] font-semibold transition-all ${
              saving || !reason
                ? 'bg-red-100 text-red-300 cursor-not-allowed'
                : 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800'
            }`}
          >
            {saving ? 'Сохранение...' : 'Зафиксировать'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── UndoModal ────────────────────────────────────────────────────────────────

function UndoModal({
  stageLabel,
  saving,
  onConfirm,
  onCancel,
}: {
  stageLabel: string
  saving:     boolean
  onConfirm:  (reason: string) => void
  onCancel:   () => void
}) {
  const [reason, setReason] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px]">
      <div className="w-full max-w-sm bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-[#f0f0ec]">
          <div className="flex items-center justify-between mb-0.5">
            <h2 className="text-[16px] font-bold text-[#111110]">Отменить отметку</h2>
            <button onClick={onCancel} className="p-1 -mr-1 text-[#9a9a95] hover:text-[#111110] transition-colors">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-[12px] text-[#9a9a95]">{stageLabel}</p>
        </div>

        <div className="px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-2">Причина отмены</p>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            rows={3}
            placeholder="Например: ошибочная отметка, перепутали позицию..."
            className="w-full px-3.5 py-2.5 rounded-xl border border-[#e8e8e4] bg-[#fafaf9] text-[13px] text-[#111110] placeholder-[#c4c4be] resize-none focus:outline-none focus:border-[#9a9a95]"
          />
        </div>

        <div className="px-5 pb-5 pt-0 flex gap-2.5">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-3 rounded-xl border border-[#e8e8e4] text-[13px] font-medium text-[#6b6b66] hover:bg-[#f4f4f0] transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={() => onConfirm(reason.trim())}
            disabled={saving || !reason.trim()}
            className={`flex-1 py-3 rounded-xl text-[13px] font-semibold transition-all ${
              saving || !reason.trim()
                ? 'bg-[#f0f0ec] text-[#c4c4be] cursor-not-allowed'
                : 'bg-[#111110] text-white hover:bg-[#2a2a28] active:bg-[#3a3a38]'
            }`}
          >
            {saving ? 'Сохранение...' : 'Отменить этап'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── ItemCard ─────────────────────────────────────────────────────────────────

function ItemCard({
  item, index, stages, selected, onToggle, onUnsetStage,
}: {
  item:          OrderItem
  index:         number
  stages:        { [stage in DetailStageKey]?: DetailStageState } | undefined
  selected:      boolean
  onToggle:      () => void
  onUnsetStage?: (stageKey: DetailStageKey, previousValue: DetailStageState) => void
}) {
  const svcs          = Array.isArray(item.services) ? item.services.map(s => s.name) : []
  const facet         = item.hasFacet
    ? (item.facetTypeMm ? `Фацет ${item.facetTypeMm} мм` : 'Фацет')
    : null
  const visibleStages = getApplicableStages(item)
  const tags          = [itemNeedsTempering(item) ? 'Закалка' : null, facet, ...svcs].filter(Boolean) as string[]
  const comment       = item.comment?.trim() || null
  const hasProblem    = stages?.problem?.status === 'problem'

  return (
    <div
      onClick={onToggle}
      className={`bg-white rounded-xl overflow-hidden cursor-pointer transition-all ${
        selected ? 'border-2 border-[#111110] shadow-sm' : 'border border-[#e8e8e4]'
      }`}
    >
      {/* Header */}
      <div className="px-3 py-3 border-b border-[#f0f0ec]">
        <div className="flex items-start gap-2.5">

          {/* Checkbox */}
          <div className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            selected ? 'border-[#111110] bg-[#111110]' : 'border-[#d4d4d0] bg-white'
          }`}>
            {selected && (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path d="M2 6l3 3 5-5" stroke="white" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-1.5">
              <div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-bold text-[#c4c4be]">#{index + 1}</span>
                  <span className="text-[14px] font-bold text-[#111110] leading-tight">
                    {item.materialName ?? '—'}
                    {item.thickness ? (
                      <span className="text-[12px] font-normal text-[#6b6b66] ml-1">{item.thickness} мм</span>
                    ) : null}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 flex-wrap text-[12px] text-[#6b6b66]">
                  <span className="font-mono font-semibold text-[#111110]">
                    {item.width ?? '—'}×{item.height ?? '—'}
                  </span>
                  <span>·</span>
                  <span>{item.quantity ?? 1} шт</span>
                  {(item.totalAreaNet ?? 0) > 0 && (
                    <><span>·</span><span className="text-[11px]">{(item.totalAreaNet ?? 0).toFixed(3)} м²</span></>
                  )}
                </div>
              </div>
              {item.category && (
                <span className="text-[10px] text-[#9a9a95] bg-[#f4f4f0] px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5">
                  {item.category}
                </span>
              )}
            </div>

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {tags.map((tag, ti) => (
                  <span key={ti} className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                    tag === 'Закалка'
                      ? 'bg-orange-50 text-orange-700 border border-orange-200'
                      : 'bg-blue-50 text-blue-700 border border-blue-200'
                  }`}>{tag}</span>
                ))}
              </div>
            )}

            {comment && (
              <p className="mt-1 text-[10px] text-[#8a8a85] italic">{comment}</p>
            )}
          </div>
        </div>
      </div>

      {/* Stage badges */}
      <div className={`px-3 py-2 ${hasProblem ? 'bg-red-50' : 'bg-[#fafaf9]'}`}>
        <div className="flex gap-1.5 flex-wrap">
          {visibleStages.map(stage => {
            const sd     = stages?.[stage.key]
            const isDone = sd?.status === 'done'
            return (
              <div key={stage.key} className="flex flex-col items-center gap-0.5">
                <div className="flex items-center gap-0.5">
                  <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded border whitespace-nowrap ${
                    isDone
                      ? 'bg-green-50 text-green-700 border-green-200'
                      : 'text-[#c4c4be] bg-[#f4f4f0] border-[#e8e8e4]'
                  }`}>
                    {stage.label}
                  </span>
                  {isDone && sd && onUnsetStage && (
                    <button
                      onClick={e => { e.stopPropagation(); onUnsetStage(stage.key, sd) }}
                      className="text-[9px] text-[#c4c4be] hover:text-red-400 leading-none px-0.5 transition-colors"
                      title="Отменить"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <span className={`text-[8px] ${isDone ? 'text-green-600' : 'text-[#c4c4be]'}`}>
                  {isDone && sd?.updated_at ? fmtDateShort(sd.updated_at) : isDone ? 'готово' : 'ожидает'}
                </span>
              </div>
            )
          })}

          {hasProblem && (
            <div className="flex flex-col items-center gap-0.5">
              <div className="flex items-center gap-0.5">
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded border bg-red-100 text-red-700 border-red-300 whitespace-nowrap">
                  Проблема
                </span>
                {stages?.problem && onUnsetStage && (
                  <button
                    onClick={e => { e.stopPropagation(); onUnsetStage('problem', stages.problem!) }}
                    className="text-[9px] text-[#c4c4be] hover:text-red-400 leading-none px-0.5 transition-colors"
                    title="Отменить"
                  >
                    ✕
                  </button>
                )}
              </div>
              <span className="text-[8px] text-red-500">
                {stages?.problem?.updated_at ? fmtDateShort(stages.problem.updated_at) : ''}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProductionOrderPage() {
  const { id: rawId } = useParams<{ id: string }>()
  const id = Number(rawId)

  const [order,         setOrder]         = useState<Order | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [currentUser,   setCurrentUser]   = useState<{ id: string; email?: string } | null>(null)
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set())
  const [saving,        setSaving]        = useState(false)
  const [toast,         setToast]         = useState<{ msg: string; ok: boolean } | null>(null)
  const [problemModal,  setProblemModal]  = useState<{ items: number[] } | null>(null)
  const [undoModal,     setUndoModal]     = useState<{
    itemIndex:     number
    stageKey:      DetailStageKey
    stageLabel:    string
    previousValue: DetailStageState
  } | null>(null)

  useEffect(() => {
    async function load() {
      const sb = createClient()
      const { data: { user } } = await sb.auth.getUser()
      if (!user) { setError('Не авторизован'); setLoading(false); return }

      setCurrentUser({ id: user.id, email: user.email ?? undefined })

      const { data, error: dbErr } = await sb
        .from('b2b_orders')
        .select('id,client_name,custom_number,client_order_number,items,notes,total_area,total_weight,created_at')
        .eq('id', id)
        .single()

      if (dbErr || !data) { setError('Заказ не найден'); setLoading(false); return }

      setOrder({ ...data, items: Array.isArray(data.items) ? (data.items as OrderItem[]) : [] })
      setLoading(false)
    }

    if (id && !isNaN(id)) load()
    else { setError('Неверный ID заказа'); setLoading(false) }
  }, [id])

  // ─── Persist stage update ─────────────────────────────────────────────────

  async function persistStageUpdate(
    stageKey: DetailStageKey,
    targetItems: number[],
    extraFields?: { reason?: string; note?: string },
  ) {
    if (!order || !currentUser) return

    let notesObj: Record<string, unknown> = {}
    if (order.notes) {
      try {
        const p = JSON.parse(order.notes)
        if (typeof p === 'object' && p !== null) notesObj = { ...p }
      } catch {}
    }

    const existingStages = (notesObj.detail_stages ?? {}) as DetailStages
    const now            = new Date().toISOString()
    const newStages: DetailStages = { ...existingStages }

    for (const idx of targetItems) {
      newStages[String(idx)] = {
        ...newStages[String(idx)],
        [stageKey]: {
          status:           stageKey === 'problem' ? 'problem' : 'done',
          updated_at:       now,
          updated_by:       currentUser.id,
          updated_by_email: currentUser.email,
          ...extraFields,
        },
      }
    }

    const updatedNotes = { ...notesObj, detail_stages: newStages }
    const sb           = createClient()
    const { error: updateErr } = await sb
      .from('b2b_orders')
      .update({ notes: JSON.stringify(updatedNotes) })
      .eq('id', order.id)

    if (updateErr) {
      setToast({ msg: 'Ошибка сохранения', ok: false })
      setTimeout(() => setToast(null), 3000)
      return
    }

    setOrder(prev => prev ? { ...prev, notes: JSON.stringify(updatedNotes) } : prev)
    return updatedNotes
  }

  // Флаг «Срочно» (notes.urgent) — поднимает заказ в самый верх очередей мастеров.
  async function toggleUrgent() {
    if (!order) return
    let notesObj: Record<string, unknown> = {}
    if (order.notes) { try { const p = JSON.parse(order.notes); if (typeof p === 'object' && p !== null) notesObj = { ...p } } catch {} }
    const nextUrgent = !notesObj.urgent
    const updatedNotes = { ...notesObj, urgent: nextUrgent }
    const sb = createClient()
    const { error } = await sb.from('b2b_orders').update({ notes: JSON.stringify(updatedNotes) }).eq('id', order.id)
    if (error) { setToast({ msg: 'Ошибка сохранения', ok: false }); setTimeout(() => setToast(null), 3000); return }
    setOrder(prev => prev ? { ...prev, notes: JSON.stringify(updatedNotes) } : prev)
    setToast({ msg: nextUrgent ? '🔥 Заказ отмечен срочным' : 'Срочность снята', ok: true }); setTimeout(() => setToast(null), 2500)
  }

  // ─── Mark stage ───────────────────────────────────────────────────────────

  async function markStage(stageKey: DetailStageKey) {
    if (!order || !currentUser || selectedItems.size === 0 || saving) return

    if (stageKey === 'problem') {
      setProblemModal({ items: [...selectedItems] })
      return
    }

    const effectiveItems = stageKey === 'tempering'
      ? [...selectedItems].filter(idx => itemNeedsTempering(order.items[idx]))
      : stageKey === 'curved'
      ? [...selectedItems].filter(idx => order.items[idx]?.shape === 'curved')
      : [...selectedItems]

    if (effectiveItems.length === 0) {
      setToast({ msg: stageKey === 'curved' ? 'В выбранных позициях нет криволинейки' : 'В выбранных позициях нет закалки', ok: false })
      setTimeout(() => setToast(null), 3000)
      return
    }

    setSaving(true)
    const result = await persistStageUpdate(stageKey, effectiveItems)
    setSaving(false)

    if (result) {
      // Обратное зеркало в production_tasks (best-effort): держим новую модель очередей в синхроне.
      fetch(`/api/b2b-orders/${order.id}/sync-stages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: effectiveItems.map(idx => ({ item_index: idx, stage_key: stageKey, action: 'done' })) }),
      }).catch(() => {})
      const count   = effectiveItems.length
      const partial = stageKey === 'tempering' && effectiveItems.length < selectedItems.size
      setSelectedItems(new Set())
      setToast({
        msg: partial
          ? `Закалка: ${count} из ${selectedItems.size} поз.`
          : `Сохранено (${count} ${plural(count, 'позиция', 'позиции', 'позиций')})`,
        ok: true,
      })
      setTimeout(() => setToast(null), 3000)
    }
  }

  // ─── Save problem ─────────────────────────────────────────────────────────

  async function saveProblem(reason: string, note: string) {
    if (!problemModal || !order || !currentUser) return
    setSaving(true)
    const result = await persistStageUpdate('problem', problemModal.items, {
      reason: reason || undefined,
      note:   note.trim() || undefined,
    })
    setSaving(false)
    setProblemModal(null)

    if (result) {
      const count = problemModal.items.length
      setSelectedItems(new Set())
      setToast({ msg: `Проблема зафиксирована (${count} ${plural(count, 'позиция', 'позиции', 'позиций')})`, ok: false })
      setTimeout(() => setToast(null), 4000)
    }
  }

  // ─── Unset stage ──────────────────────────────────────────────────────────

  async function unsetStage(
    itemIndex:     number,
    stageKey:      DetailStageKey,
    previousValue: DetailStageState,
    reason:        string,
  ) {
    if (!order || !currentUser || saving) return

    let notesObj: Record<string, unknown> = {}
    if (order.notes) {
      try {
        const p = JSON.parse(order.notes)
        if (typeof p === 'object' && p !== null) notesObj = { ...p }
      } catch {}
    }

    // Copy detail_stages and remove the specific stage key
    const existingStages = (notesObj.detail_stages ?? {}) as DetailStages
    const newStages: DetailStages = { ...existingStages }
    const itemStages: { [stage in DetailStageKey]?: DetailStageState } = { ...(newStages[String(itemIndex)] ?? {}) }
    delete itemStages[stageKey]
    newStages[String(itemIndex)] = itemStages

    // Append to audit log
    const auditEntry: AuditEntry = {
      type:              'stage_unset',
      item_index:        itemIndex,
      stage_key:         stageKey,
      previous_value:    previousValue,
      reason,
      created_at:        new Date().toISOString(),
      created_by:        currentUser.id,
      created_by_email:  currentUser.email,
    }
    const existingAudit = Array.isArray(notesObj.detail_stage_audit) ? notesObj.detail_stage_audit : []
    const newAudit      = [...existingAudit, auditEntry]

    const updatedNotes = { ...notesObj, detail_stages: newStages, detail_stage_audit: newAudit }
    const sb           = createClient()
    const { error: updateErr } = await sb
      .from('b2b_orders')
      .update({ notes: JSON.stringify(updatedNotes) })
      .eq('id', order.id)

    if (updateErr) {
      setToast({ msg: 'Ошибка сохранения', ok: false })
      setTimeout(() => setToast(null), 3000)
      return
    }

    setOrder(prev => prev ? { ...prev, notes: JSON.stringify(updatedNotes) } : prev)
    // Обратное зеркало отмены этапа в production_tasks (best-effort).
    fetch(`/api/b2b-orders/${order.id}/sync-stages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: [{ item_index: itemIndex, stage_key: stageKey, action: 'unset' }] }),
    }).catch(() => {})
    return updatedNotes
  }

  // ─── Loading / error states ────────────────────────────────────────────────

  if (loading) return (
    <div className="min-h-screen bg-[#f8f8f7] flex items-center justify-center">
      <div className="text-[14px] text-[#8a8a85]">Загрузка...</div>
    </div>
  )

  if (error || !order) return (
    <div className="min-h-screen bg-[#f8f8f7] flex items-center justify-center px-4">
      <div className="text-center max-w-xs">
        <p className="text-[15px] font-semibold text-[#111110] mb-2">{error ?? 'Ошибка загрузки'}</p>
        <Link href="/production-app" className="text-[13px] text-blue-600 underline underline-offset-2">
          К списку заказов
        </Link>
      </div>
    </div>
  )

  // ─── Derived values ────────────────────────────────────────────────────────

  const pn             = parseNotes(order.notes)
  const detailStages   = pn.detail_stages ?? {}
  const launchDate     = fmtDate(pn.launched_at ?? pn.work_started_at)
  const orderLabel     = order.custom_number?.trim() || `00${order.id}`
  const totalQty       = order.items.reduce((s, i) => s + (i.quantity ?? 1), 0)
  const itemsArea      = order.items.reduce((s, i) => s + itemAreaM2(i), 0)
  const itemsWeight    = order.items.reduce((s, i) => s + itemWeightKg(i), 0)
  const totalArea      = itemsArea   > 0 ? itemsArea   : (order.total_area   ?? 0)
  const totalWeight    = itemsWeight > 0 ? itemsWeight : (order.total_weight ?? 0)
  const allSelected    = order.items.length > 0 && selectedItems.size === order.items.length
  const selNeedTemp    = [...selectedItems].some(idx => itemNeedsTempering(order.items[idx]))
  const auditLog       = [...(Array.isArray(pn.detail_stage_audit) ? pn.detail_stage_audit : [])]
    .sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      return tb - ta
    })
    .slice(0, 10)

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl shadow-lg text-[13px] font-semibold whitespace-nowrap pointer-events-none ${
          toast.ok ? 'bg-[#111110] text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.ok ? '✓ ' : '⚠ '}{toast.msg}
        </div>
      )}

      {problemModal && (
        <ProblemModal
          itemCount={problemModal.items.length}
          saving={saving}
          onConfirm={saveProblem}
          onCancel={() => setProblemModal(null)}
        />
      )}

      {undoModal && (
        <UndoModal
          stageLabel={`Поз.${undoModal.itemIndex + 1} — ${undoModal.stageLabel}`}
          saving={saving}
          onConfirm={async (reason) => {
            setSaving(true)
            const result = await unsetStage(undoModal.itemIndex, undoModal.stageKey, undoModal.previousValue, reason)
            setSaving(false)
            if (result) {
              setUndoModal(null)
              setToast({ msg: `Отмена: ${undoModal.stageLabel} (поз.${undoModal.itemIndex + 1})`, ok: true })
              setTimeout(() => setToast(null), 3500)
            }
          }}
          onCancel={() => setUndoModal(null)}
        />
      )}

      <div className="min-h-screen bg-[#f8f8f7] pb-32">

        {/* Top bar */}
        <div className="sticky top-0 z-10 bg-white border-b border-[#e4e4e0] px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link
              href="/production-app"
              className="text-[#6b6b66] hover:text-[#111110] transition-colors p-1 -ml-1"
              aria-label="Назад"
            >
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <p className="text-[10px] text-[#9a9a95] uppercase tracking-widest leading-none mb-0.5">Производство</p>
              <p className="text-[15px] font-bold text-[#111110] leading-none">{orderLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <p className="text-[11px] text-[#9a9a95]">
                {order.items.length}&nbsp;{plural(order.items.length, 'позиция', 'позиции', 'позиций')}
              </p>
              {selectedItems.size > 0 && (
                <p className="text-[11px] font-bold text-[#111110]">{selectedItems.size} выбрано</p>
              )}
            </div>
            <button
              onClick={toggleUrgent}
              className={`inline-flex min-h-10 items-center justify-center rounded-full border px-4 py-2 text-xs font-semibold transition-colors ${
                pn.urgent ? 'border-red-300 bg-red-600 text-white hover:bg-red-700' : 'border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f3]'
              }`}
            >
              {pn.urgent ? '🔥 Срочный' : '🔥 Срочно'}
            </button>
            <Link
              href={`/production-app/orders/${order.id}/labels`}
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-[#e4e4e0] px-4 py-2 text-xs font-semibold text-[#6b6b66] hover:bg-[#f5f5f3]"
            >
              🖨 Наклейки
            </Link>
            <a
              href={`/p/o/${order.id}`}
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-blue-200 px-4 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50"
              onClick={(event) => event.stopPropagation()}
            >
              QR-экран
            </a>
          </div>
        </div>

        <div className="px-4 pt-4 space-y-4">

          {/* Order summary */}
          <div className="bg-white border border-[#e8e8e4] rounded-xl px-4 py-3 space-y-1.5">
            <p className="text-[14px] font-bold text-[#111110]">{order.client_name}</p>
            {order.client_order_number && (
              <p className="text-[12px] text-[#6b6b66]">
                Номер клиента: <span className="font-mono">{order.client_order_number}</span>
              </p>
            )}
            {launchDate && (
              <p className="text-[12px] text-[#6b6b66]">
                Запуск: <span className="font-medium text-emerald-700">{launchDate}</span>
                {pn.production_days && (
                  <span className="text-[#9a9a95]"> · {pn.production_days} дн.</span>
                )}
              </p>
            )}
            <div className="flex gap-3 flex-wrap pt-0.5">
              <span className="text-[12px] text-[#6b6b66]">
                <span className="font-semibold text-[#111110]">{totalQty}</span> шт
              </span>
              {totalArea > 0 && (
                <span className="text-[12px] text-[#6b6b66]">
                  <span className="font-semibold text-[#111110]">{totalArea.toFixed(2)}</span> м²
                </span>
              )}
              {totalWeight > 0 && (
                <span className="text-[12px] text-[#6b6b66]">
                  <span className="font-semibold text-[#111110]">{totalWeight.toFixed(1)}</span> кг
                </span>
              )}
            </div>
          </div>

          {/* Items list */}
          <div>
            <div className="flex items-center justify-between mb-2.5 px-0.5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95]">Позиции</p>
              {order.items.length > 0 && (
                <button
                  onClick={() => allSelected
                    ? setSelectedItems(new Set())
                    : setSelectedItems(new Set(order.items.map((_, i) => i)))
                  }
                  className="text-[11px] font-medium text-blue-600 hover:text-blue-800 transition-colors py-1"
                >
                  {allSelected ? 'Снять выбор' : 'Выбрать все'}
                </button>
              )}
            </div>

            {order.items.length === 0 ? (
              <div className="bg-white border border-[#e8e8e4] rounded-xl px-4 py-8 text-center">
                <p className="text-[14px] text-[#9a9a95]">В заказе нет позиций</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {order.items.map((item, idx) => (
                  <ItemCard
                    key={idx}
                    item={item}
                    index={idx}
                    stages={detailStages[String(idx)]}
                    selected={selectedItems.has(idx)}
                    onToggle={() => setSelectedItems(prev => {
                      const next = new Set(prev)
                      if (next.has(idx)) next.delete(idx)
                      else next.add(idx)
                      return next
                    })}
                    onUnsetStage={(stageKey, previousValue) => {
                      setUndoModal({
                        itemIndex:     idx,
                        stageKey,
                        stageLabel:    STAGE_LABELS[stageKey],
                        previousValue,
                      })
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Group actions */}
          <div>
            <div className="flex items-center justify-between mb-2.5 px-0.5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95]">Действия</p>
              {saving && <span className="text-[11px] text-[#9a9a95]">Сохранение...</span>}
            </div>

            {selectedItems.size === 0 && (
              <p className="text-[11px] text-[#b0b0aa] mb-2 px-0.5">
                Выберите позиции выше, чтобы отметить этап
              </p>
            )}

            <div className="space-y-2">
              {GROUP_ACTIONS.map(action => {
                const isDisabled = action.key === 'tempering'
                  ? (selectedItems.size === 0 || saving || !selNeedTemp)
                  : (selectedItems.size === 0 || saving)
                return (
                  <button
                    key={action.key}
                    onClick={() => markStage(action.key)}
                    disabled={isDisabled}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-[13px] font-medium border transition-all ${
                      action.danger
                        ? isDisabled
                          ? 'border-red-100 text-red-300 bg-red-50 cursor-not-allowed'
                          : 'border-red-300 text-red-600 bg-red-50 hover:bg-red-100 active:bg-red-200'
                        : isDisabled
                          ? 'border-[#e8e8e4] text-[#c4c4be] bg-[#f8f8f7] cursor-not-allowed'
                          : 'border-[#111110] text-[#111110] bg-white hover:bg-[#f4f4f0] active:bg-[#ebebeb] shadow-sm'
                    }`}
                  >
                    {action.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Audit trail */}
          {auditLog.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-2.5 px-0.5">
                История изменений
              </p>
              <div className="bg-white border border-[#e8e8e4] rounded-xl overflow-hidden divide-y divide-[#f0f0ec]">
                {auditLog.map((entry, i) => (
                  <div key={i} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-semibold text-[#111110]">
                          Поз.{(entry.item_index ?? 0) + 1}
                        </span>
                        <span className="text-[10px] text-[#c4c4be]">—</span>
                        <span className="text-[11px] font-medium text-[#111110]">
                          {STAGE_LABELS[entry.stage_key] ?? entry.stage_key}
                        </span>
                        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded border bg-[#f4f4f0] text-[#6b6b66] border-[#e8e8e4]">
                          отмена
                        </span>
                      </div>
                      <span className="text-[10px] text-[#9a9a95] whitespace-nowrap flex-shrink-0">
                        {fmtDateTime(entry.created_at)}
                      </span>
                    </div>
                    {entry.reason && (
                      <p className="text-[11px] text-[#6b6b66] leading-snug mb-0.5">
                        Причина: {entry.reason}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                      {entry.created_by_email && (
                        <span className="text-[10px] text-[#9a9a95]">
                          Кто: {entry.created_by_email}
                        </span>
                      )}
                      {entry.previous_value && (
                        <span className="text-[10px] text-[#9a9a95]">
                          Было: {entry.previous_value.status === 'done' ? 'выполнено' : 'проблема'}
                          {entry.previous_value.updated_at
                            ? ` от ${fmtDateTime(entry.previous_value.updated_at)}`
                            : ''}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  )
}
