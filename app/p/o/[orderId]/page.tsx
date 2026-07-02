'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'
import { type DetailStageKey, type DetailStageState, type DetailStages, itemNeedsTempering, getApplicableStages } from '@/lib/productionStages'

type OrderItem = {
  materialName?: string
  category?: string
  thickness?: number
  width?: number
  height?: number
  quantity?: number
  totalAreaNet?: number
  totalWeight?: number
  hasTempering?: boolean
  hasFacet?: boolean
  facetTypeMm?: number
  services?: { name: string; cost: number }[]
  comment?: string
}

type NotesData = {
  status?: string
  launched_at?: string
  work_started_at?: string
  production_days?: number
  user_notes?: string
  detail_stages?: DetailStages
}

type Order = {
  id: number
  client_name: string
  custom_number: string | null
  client_order_number: string | null
  items: OrderItem[]
  notes: string | null
  total_area: number
  total_weight: number
  created_at: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Used for the batch-stage checklist — excludes 'problem' (separate action)
const BATCH_STAGES: { key: Exclude<DetailStageKey, 'problem'>; label: string; icon: string }[] = [
  { key: 'cutting',   label: 'Резка',     icon: '✂️' },
  { key: 'polishing', label: 'Полировка', icon: '🔲' },
  { key: 'drilling',  label: 'Сверление', icon: '🔩' },
  { key: 'tempering', label: 'Закалка',   icon: '🔥' },
  { key: 'packaging', label: 'Упаковка',  icon: '📦' },
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

function plural(n: number, one: string, few: string, many: string): string {
  const mod10  = n % 10
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

function itemAreaM2(item: OrderItem): number {
  if ((item.totalAreaNet ?? 0) > 0) return item.totalAreaNet!
  const w = item.width ?? 0
  const h = item.height ?? 0
  const q = item.quantity ?? 1
  return w > 0 && h > 0 ? (w * h / 1_000_000) * q : 0
}

function itemWeightKg(item: OrderItem): number {
  if ((item.totalWeight ?? 0) > 0) return item.totalWeight!
  const area = itemAreaM2(item)
  const t = item.thickness ?? 0
  return area > 0 && t > 0 ? area * t * 2.5 : 0
}

// ─── ItemCard ─────────────────────────────────────────────────────────────────

function ItemCard({
  item, index, stages, selected, onToggle,
}: {
  item:    OrderItem
  index:   number
  stages:  { [stage in DetailStageKey]?: DetailStageState } | undefined
  selected: boolean
  onToggle: () => void
}) {
  const svcs           = Array.isArray(item.services) ? item.services.map(s => s.name) : []
  const facet          = item.hasFacet
    ? (item.facetTypeMm ? `Фацет ${item.facetTypeMm} мм` : 'Фацет')
    : null
  const needsTempering = itemNeedsTempering(item)
  const visibleStages  = getApplicableStages(item)
  const tags           = [needsTempering ? 'Закалка' : null, facet, ...svcs].filter(Boolean) as string[]
  const comment        = item.comment?.trim() || null
  const hasProblem     = stages?.problem?.status === 'problem'

  return (
    <div
      onClick={onToggle}
      className={`bg-surface rounded-xl overflow-hidden cursor-pointer transition-all ${
        selected
          ? 'border-2 border-ink shadow-sm'
          : 'border border-[#e8e8e4]'
      }`}
    >
      {/* Header */}
      <div className="px-3 py-3 border-b border-line-soft">
        <div className="flex items-start gap-2.5">

          {/* Checkbox */}
          <div className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            selected ? 'border-ink bg-ink' : 'border-[#d4d4d0] bg-surface'
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
                  <span className="text-[11px] font-semibold text-faint tabular-nums">#{index + 1}</span>
                  <span className="text-[14px] font-semibold text-ink leading-tight">
                    {item.materialName ?? '—'}
                    {item.thickness ? (
                      <span className="text-[12px] font-normal text-ink-soft ml-1">
                        {item.thickness} мм
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 flex-wrap text-[12px] text-ink-soft">
                  <span className="font-mono font-semibold text-ink tabular-nums">
                    {item.width ?? '—'}×{item.height ?? '—'}
                  </span>
                  <span>·</span>
                  <span>{item.quantity ?? 1} шт</span>
                  {(item.totalAreaNet ?? 0) > 0 && (
                    <>
                      <span>·</span>
                      <span className="text-[11px] tabular-nums">{(item.totalAreaNet ?? 0).toFixed(3)} м²</span>
                    </>
                  )}
                </div>
              </div>
              {item.category && (
                <span className="text-[11px] text-muted bg-[#f4f4f0] px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5">
                  {item.category}
                </span>
              )}
            </div>

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {tags.map((tag, ti) => (
                  <span key={ti} className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${
                    tag === 'Закалка'
                      ? 'bg-orange-50 text-orange-700 border border-orange-200'
                      : 'bg-blue-50 text-blue-700 border border-blue-200'
                  }`}>
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {comment && (
              <p className="mt-1 text-[11px] text-muted italic">{comment}</p>
            )}
          </div>
        </div>
      </div>

      {/* Stage badges */}
      <div className={`px-3 py-2 ${hasProblem ? 'bg-red-50' : 'bg-subtle'}`}>
        <div className="flex gap-1.5 flex-wrap">
          {visibleStages.map(stage => {
            const sd     = stages?.[stage.key]
            const isDone = sd?.status === 'done'
            return (
              <div key={stage.key} className="flex flex-col items-center gap-0.5">
                <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border whitespace-nowrap ${
                  isDone
                    ? 'bg-green-50 text-green-700 border-green-200'
                    : 'text-faint bg-[#f4f4f0] border-[#e8e8e4]'
                }`}>
                  {stage.label}
                </span>
                <span className={`text-[11px] ${isDone ? 'text-green-600' : 'text-faint'}`}>
                  {isDone && sd?.updated_at ? fmtDateShort(sd.updated_at) : isDone ? 'готово' : 'ожидает'}
                </span>
              </div>
            )
          })}

          {hasProblem && (
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded border bg-red-100 text-red-700 border-red-300 whitespace-nowrap">
                ⚠️ Проблема
              </span>
              <span className="text-[11px] text-red-500">
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

export default function MobileOrderWorkPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const id = Number(orderId)

  const [order,          setOrder]          = useState<Order | null>(null)
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState<string | null>(null)
  const [currentUser,    setCurrentUser]    = useState<{ id: string; email?: string } | null>(null)
  const [selectedItems,  setSelectedItems]  = useState<Set<number>>(new Set())
  const [selectedStages, setSelectedStages] = useState<Set<Exclude<DetailStageKey, 'problem'>>>(new Set())
  const [saving,         setSaving]         = useState(false)
  const [toast,          setToast]          = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    async function load() {
      const sb = createClient()
      const { data: { user } } = await sb.auth.getUser()
      if (!user) { setError('Не авторизован. Войдите в систему.'); setLoading(false); return }

      setCurrentUser({ id: user.id, email: user.email ?? undefined })

      const { data, error: dbErr } = await sb
        .from('b2b_orders')
        .select('id,client_name,custom_number,client_order_number,items,notes,total_area,total_weight,created_at')
        .eq('id', id)
        .single()

      if (dbErr || !data) { setError('Заказ не найден'); setLoading(false); return }

      setOrder({
        ...data,
        items: Array.isArray(data.items) ? (data.items as OrderItem[]) : [],
      })
      setLoading(false)
    }

    if (id && !isNaN(id)) load()
    else { setError('Неверный ID заказа'); setLoading(false) }
  }, [id])

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function buildNotesObj(): Record<string, unknown> {
    if (!order?.notes) return {}
    try {
      const p = JSON.parse(order.notes)
      if (typeof p === 'object' && p !== null) return { ...p }
    } catch {}
    return {}
  }

  function showToast(msg: string, ok: boolean, ms = 3500) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), ms)
  }

  // ─── Batch stage save ──────────────────────────────────────────────────────

  async function markSelectedStages() {
    if (!order || !currentUser || selectedItems.size === 0 || selectedStages.size === 0 || saving) return

    setSaving(true)
    const notesObj   = buildNotesObj()
    const existingDs = (notesObj.detail_stages ?? {}) as DetailStages
    const now        = new Date().toISOString()
    const newStages: DetailStages = { ...existingDs }
    const syncUpdates: { item_index: number; stage_key: string; action: 'done' }[] = []

    for (const stageKey of selectedStages) {
      // Tempering: only items that actually need it (non-mirror with hasTempering=true)
      const effectiveItems = stageKey === 'tempering'
        ? [...selectedItems].filter(idx => itemNeedsTempering(order.items[idx]))
        : [...selectedItems]

      for (const idx of effectiveItems) {
        newStages[String(idx)] = {
          ...newStages[String(idx)],
          [stageKey]: {
            status:           'done',
            updated_at:       now,
            updated_by:       currentUser.id,
            updated_by_email: currentUser.email,
          } satisfies DetailStageState,
        }
        syncUpdates.push({ item_index: idx, stage_key: stageKey, action: 'done' })
      }
    }

    const updatedNotes = { ...notesObj, detail_stages: newStages }
    const sb = createClient()
    const { error: updateErr } = await sb
      .from('b2b_orders')
      .update({ notes: JSON.stringify(updatedNotes) })
      .eq('id', order.id)

    if (updateErr) {
      showToast('Ошибка сохранения', false)
      setSaving(false)
      return
    }

    const itemCount  = selectedItems.size
    const stageCount = selectedStages.size
    // Check if tempering was skipped for some items
    const temperingSelected = selectedStages.has('tempering')
    const temperingEffective = temperingSelected
      ? [...selectedItems].filter(idx => itemNeedsTempering(order.items[idx])).length
      : 0
    const temperingSkipped = temperingSelected && temperingEffective < selectedItems.size

    // Обратное зеркало в production_tasks (best-effort).
    fetch(`/api/b2b-orders/${order.id}/sync-stages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: syncUpdates }),
    }).catch(() => {})

    setOrder(prev => prev ? { ...prev, notes: JSON.stringify(updatedNotes) } : prev)
    setSelectedItems(new Set())
    setSelectedStages(new Set())

    const suffix = temperingSkipped ? ` · закалка: ${temperingEffective} из ${itemCount} поз.` : ''
    showToast(`Сохранено: ${stageCount} эт. × ${itemCount} ${plural(itemCount, 'поз.', 'поз.', 'поз.')}${suffix}`, true)
    setSaving(false)
  }

  // ─── Problem save ──────────────────────────────────────────────────────────

  async function markProblem() {
    if (!order || !currentUser || selectedItems.size === 0 || saving) return

    setSaving(true)
    const notesObj   = buildNotesObj()
    const existingDs = (notesObj.detail_stages ?? {}) as DetailStages
    const now        = new Date().toISOString()
    const newStages: DetailStages = { ...existingDs }

    for (const idx of selectedItems) {
      newStages[String(idx)] = {
        ...newStages[String(idx)],
        problem: {
          status:           'problem',
          updated_at:       now,
          updated_by:       currentUser.id,
          updated_by_email: currentUser.email,
        } satisfies DetailStageState,
      }
    }

    const updatedNotes = { ...notesObj, detail_stages: newStages }
    const sb = createClient()
    const { error: updateErr } = await sb
      .from('b2b_orders')
      .update({ notes: JSON.stringify(updatedNotes) })
      .eq('id', order.id)

    if (updateErr) {
      showToast('Ошибка сохранения', false)
      setSaving(false)
      return
    }

    const count = selectedItems.size
    setOrder(prev => prev ? { ...prev, notes: JSON.stringify(updatedNotes) } : prev)
    setSelectedItems(new Set())
    setSelectedStages(new Set())
    showToast(`⚠️ Проблема зафиксирована (${count} ${plural(count, 'поз.', 'поз.', 'поз.')})`, true)
    setSaving(false)
  }

  // ─── Toggle stage checkbox ──────────────────────────────────────────────────

  function toggleStage(key: Exclude<DetailStageKey, 'problem'>) {
    setSelectedStages(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // ─── Loading ───────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="min-h-screen bg-canvas flex items-center justify-center">
      <div className="text-[14px] text-muted">Загрузка...</div>
    </div>
  )

  // ─── Error ─────────────────────────────────────────────────────────────────

  if (error || !order) return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="text-center max-w-xs">
        <div className="text-4xl mb-4">🔍</div>
        <p className="text-[15px] font-semibold text-ink mb-2">{error ?? 'Ошибка загрузки'}</p>
        <p className="text-[13px] text-muted mb-5">
          Попробуйте открыть производственный лист и сканировать QR ещё раз.
        </p>
        <Link href="/production-app" className="text-[13px] text-blue-600 underline underline-offset-2">
          К списку заказов
        </Link>
      </div>
    </div>
  )

  // ─── Derived ───────────────────────────────────────────────────────────────

  const pn           = parseNotes(order.notes)
  const detailStages = pn.detail_stages ?? {}
  const launchDate   = fmtDate(pn.launched_at ?? pn.work_started_at)
  const orderLabel   = order.custom_number?.trim() || `#${order.id}`
  const totalQty     = order.items.reduce((s, i) => s + (i.quantity ?? 1), 0)
  const itemsArea    = order.items.reduce((s, i) => s + itemAreaM2(i), 0)
  const itemsWeight  = order.items.reduce((s, i) => s + itemWeightKg(i), 0)
  const totalArea    = itemsArea   > 0 ? itemsArea   : (order.total_area   ?? 0)
  const totalWeight  = itemsWeight > 0 ? itemsWeight : (order.total_weight ?? 0)
  const allSelected  = order.items.length > 0 && selectedItems.size === order.items.length

  const selectedNeedTempering = [...selectedItems].some(idx => itemNeedsTempering(order.items[idx]))

  const canSave = selectedItems.size > 0 && selectedStages.size > 0 && !saving

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl shadow-lg text-[13px] font-semibold whitespace-nowrap pointer-events-none ${
          toast.ok ? 'bg-ink text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      <div className="min-h-screen bg-canvas pb-32">

        {/* ── Top bar ──────────────────────────────────────────────────────── */}
        <div className="sticky top-0 z-10 bg-surface border-b border-line px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link
              href="/production-app"
              className="text-ink-soft hover:text-ink transition-colors p-1 -ml-1"
              aria-label="Назад"
            >
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <p className="text-[11px] text-muted uppercase tracking-widest leading-none mb-0.5">Производство</p>
              <p className="text-[15px] font-semibold text-ink leading-none">{orderLabel}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-muted">
              {order.items.length}&nbsp;{plural(order.items.length, 'позиция', 'позиции', 'позиций')}
            </p>
            {selectedItems.size > 0 && (
              <p className="text-[11px] font-semibold text-ink">
                {selectedItems.size} выбрано
              </p>
            )}
          </div>
        </div>

        <div className="px-4 pt-4 space-y-4">

          {/* ── Order summary ─────────────────────────────────────────────── */}
          <div className="bg-surface border border-[#e8e8e4] rounded-xl px-4 py-3 space-y-1.5">
            <p className="text-[14px] font-semibold text-ink">{order.client_name}</p>
            {order.client_order_number && (
              <p className="text-[12px] text-ink-soft">
                Номер клиента: <span className="font-mono">{order.client_order_number}</span>
              </p>
            )}
            {launchDate && (
              <p className="text-[12px] text-ink-soft">
                Запуск: <span className="font-medium text-emerald-700">{launchDate}</span>
                {pn.production_days ? (
                  <span className="text-muted"> · {pn.production_days} дн.</span>
                ) : null}
              </p>
            )}
            <div className="flex gap-3 flex-wrap pt-0.5">
              <span className="text-[12px] text-ink-soft">
                <span className="font-semibold text-ink tabular-nums">{totalQty}</span> шт
              </span>
              {totalArea > 0 && (
                <span className="text-[12px] text-ink-soft">
                  <span className="font-semibold text-ink tabular-nums">{totalArea.toFixed(2)}</span> м²
                </span>
              )}
              {totalWeight > 0 && (
                <span className="text-[12px] text-ink-soft">
                  <span className="font-semibold text-ink tabular-nums">{totalWeight.toFixed(1)}</span> кг
                </span>
              )}
            </div>
          </div>

          {/* ── Items list ─────────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2.5 px-0.5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Позиции
              </p>
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
              <div className="bg-surface border border-[#e8e8e4] rounded-xl px-4 py-8 text-center">
                <p className="text-[14px] text-muted">В заказе нет позиций</p>
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
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Batch stage selection ─────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2.5 px-0.5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Отметить выполненные этапы
              </p>
              {saving && (
                <span className="text-[11px] text-muted">Сохранение...</span>
              )}
            </div>

            {selectedItems.size === 0 ? (
              <div className="bg-surface border border-[#e8e8e4] rounded-xl px-4 py-4 text-center">
                <p className="text-[13px] text-muted">
                  Выберите позиции выше, чтобы отметить этапы
                </p>
              </div>
            ) : (
              <>
                {/* Selection summary */}
                <div className="flex items-center gap-2 mb-3 px-0.5">
                  <span className="text-[12px] text-ink-soft">
                    Выбрано позиций:
                  </span>
                  <span className="text-[13px] font-semibold text-ink tabular-nums">{selectedItems.size}</span>
                  {selectedStages.size > 0 && (
                    <>
                      <span className="text-faint">·</span>
                      <span className="text-[12px] text-ink-soft">этапов:</span>
                      <span className="text-[13px] font-semibold text-ink tabular-nums">{selectedStages.size}</span>
                    </>
                  )}
                </div>

                {/* Stage checkboxes */}
                <div className="bg-surface border border-[#e8e8e4] rounded-xl overflow-hidden mb-3">
                  {BATCH_STAGES.map((stage, i) => {
                    const isTempering = stage.key === 'tempering'
                    const isDisabled  = isTempering && !selectedNeedTempering
                    const isChecked   = selectedStages.has(stage.key)

                    return (
                      <label
                        key={stage.key}
                        className={`flex items-center gap-3.5 px-4 py-4 transition-colors select-none ${
                          i > 0 ? 'border-t border-line-soft' : ''
                        } ${
                          isDisabled
                            ? 'opacity-40 cursor-not-allowed'
                            : 'cursor-pointer hover:bg-subtle active:bg-[#f4f4f0]'
                        }`}
                      >
                        {/* Large checkbox */}
                        <div className={`flex-shrink-0 w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all ${
                          isChecked
                            ? 'bg-ink border-ink'
                            : 'border-[#d4d4d0] bg-surface'
                        }`}>
                          {isChecked && (
                            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6l3 3 5-5" stroke="white" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={isChecked}
                          disabled={isDisabled}
                          onChange={() => { if (!isDisabled) toggleStage(stage.key) }}
                        />
                        <span className="text-[20px] leading-none flex-shrink-0">{stage.icon}</span>
                        <div className="flex-1">
                          <p className="text-[15px] font-medium text-ink">{stage.label}</p>
                          {isTempering && !selectedNeedTempering && (
                            <p className="text-[11px] text-muted mt-0.5">не требуется для выбранных позиций</p>
                          )}
                        </div>
                        {isChecked && (
                          <span className="text-[11px] text-green-600 font-semibold flex-shrink-0">✓</span>
                        )}
                      </label>
                    )
                  })}
                </div>

                {/* Save button */}
                <button
                  onClick={markSelectedStages}
                  disabled={!canSave}
                  className={`w-full py-4 rounded-xl text-[15px] font-semibold transition-all ${
                    canSave
                      ? 'bg-ink text-white active:bg-[#333] shadow-sm'
                      : 'bg-[#e8e8e4] text-faint cursor-not-allowed'
                  }`}
                >
                  {saving
                    ? 'Сохранение...'
                    : selectedStages.size === 0
                      ? 'Выберите этапы выше'
                      : `Сохранить ${selectedStages.size} ${plural(selectedStages.size, 'этап', 'этапа', 'этапов')} · ${selectedItems.size} ${plural(selectedItems.size, 'позиция', 'позиции', 'позиций')}`
                  }
                </button>

                {/* Problem — separate action */}
                <button
                  onClick={markProblem}
                  disabled={saving}
                  className="w-full mt-2.5 flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-xl text-[13px] font-medium border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 active:bg-red-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="text-[16px]">⚠️</span>
                  Зафиксировать проблему
                </button>
              </>
            )}
          </div>

        </div>
      </div>
    </>
  )
}
