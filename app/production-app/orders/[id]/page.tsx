'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

type DetailStageKey = 'cutting' | 'polishing' | 'drilling' | 'tempering' | 'packaging' | 'problem'

type DetailStageState = {
  status:            'done' | 'problem'
  updated_at:        string
  updated_by:        string
  updated_by_email?: string
  note?:             string
}

type DetailStages = {
  [itemIndex: string]: { [stage in DetailStageKey]?: DetailStageState }
}

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
  services?:     { name: string; cost: number }[]
  comment?:      string
}

type NotesData = {
  status?:          string
  launched_at?:     string
  work_started_at?: string
  production_days?: number
  user_notes?:      string
  detail_stages?:   DetailStages
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

const ITEM_STAGES = [
  { key: 'cutting',   label: 'Резка'     },
  { key: 'polishing', label: 'Полировка' },
  { key: 'drilling',  label: 'Сверление' },
  { key: 'tempering', label: 'Закалка'   },
  { key: 'packaging', label: 'Упаковка'  },
] as const

const GROUP_ACTIONS: { key: DetailStageKey; label: string; danger?: boolean }[] = [
  { key: 'cutting',   label: 'Резка выполнена'     },
  { key: 'polishing', label: 'Полировка выполнена' },
  { key: 'drilling',  label: 'Сверление выполнено' },
  { key: 'tempering', label: 'Закалка выполнена'   },
  { key: 'packaging', label: 'Упаковано'           },
  { key: 'problem',   label: 'Проблема',  danger: true },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MIRROR_RE = /зеркало|mirror|silver|серебро|сильвер/i

function isMirror(item: OrderItem): boolean {
  return MIRROR_RE.test(`${item.materialName ?? ''} ${item.category ?? ''}`)
}

function needsTempering(item: OrderItem): boolean {
  return item.hasTempering === true && !isMirror(item)
}

function getVisibleStages(item: OrderItem) {
  return ITEM_STAGES.filter(s => s.key !== 'tempering' || needsTempering(item))
}

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

// ─── ItemCard ─────────────────────────────────────────────────────────────────

function ItemCard({
  item, index, stages, selected, onToggle,
}: {
  item:     OrderItem
  index:    number
  stages:   { [stage in DetailStageKey]?: DetailStageState } | undefined
  selected: boolean
  onToggle: () => void
}) {
  const svcs          = Array.isArray(item.services) ? item.services.map(s => s.name) : []
  const facet         = item.hasFacet
    ? (item.facetTypeMm ? `Фацет ${item.facetTypeMm} мм` : 'Фацет')
    : null
  const visibleStages = getVisibleStages(item)
  const tags          = [needsTempering(item) ? 'Закалка' : null, facet, ...svcs].filter(Boolean) as string[]
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
                <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded border whitespace-nowrap ${
                  isDone
                    ? 'bg-green-50 text-green-700 border-green-200'
                    : 'text-[#c4c4be] bg-[#f4f4f0] border-[#e8e8e4]'
                }`}>
                  {stage.label}
                </span>
                <span className={`text-[8px] ${isDone ? 'text-green-600' : 'text-[#c4c4be]'}`}>
                  {isDone && sd?.updated_at ? fmtDateShort(sd.updated_at) : isDone ? 'готово' : 'ожидает'}
                </span>
              </div>
            )
          })}

          {hasProblem && (
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded border bg-red-100 text-red-700 border-red-300 whitespace-nowrap">
                Проблема
              </span>
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

  // ─── Mark stage ───────────────────────────────────────────────────────────

  async function markStage(stageKey: DetailStageKey) {
    if (!order || !currentUser || selectedItems.size === 0 || saving) return

    const effectiveItems = stageKey === 'tempering'
      ? [...selectedItems].filter(idx => needsTempering(order.items[idx]))
      : [...selectedItems]

    if (effectiveItems.length === 0) {
      setToast({ msg: 'В выбранных позициях нет закалки', ok: false })
      setTimeout(() => setToast(null), 3000)
      return
    }

    setSaving(true)

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

    for (const idx of effectiveItems) {
      newStages[String(idx)] = {
        ...newStages[String(idx)],
        [stageKey]: {
          status:           stageKey === 'problem' ? 'problem' : 'done',
          updated_at:       now,
          updated_by:       currentUser.id,
          updated_by_email: currentUser.email,
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
      setSaving(false)
      return
    }

    const count = effectiveItems.length
    const partial = stageKey === 'tempering' && effectiveItems.length < selectedItems.size
    setOrder(prev => prev ? { ...prev, notes: JSON.stringify(updatedNotes) } : prev)
    setSelectedItems(new Set())
    setToast({
      msg: partial
        ? `Закалка: ${count} из ${selectedItems.size} поз.`
        : `Сохранено (${count} ${plural(count, 'позиция', 'позиции', 'позиций')})`,
      ok: true,
    })
    setTimeout(() => setToast(null), 3000)
    setSaving(false)
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
  const orderLabel     = order.custom_number?.trim() || `#${order.id}`
  const totalQty       = order.items.reduce((s, i) => s + (i.quantity ?? 1), 0)
  const itemsArea      = order.items.reduce((s, i) => s + itemAreaM2(i), 0)
  const itemsWeight    = order.items.reduce((s, i) => s + itemWeightKg(i), 0)
  const totalArea      = itemsArea   > 0 ? itemsArea   : (order.total_area   ?? 0)
  const totalWeight    = itemsWeight > 0 ? itemsWeight : (order.total_weight ?? 0)
  const allSelected    = order.items.length > 0 && selectedItems.size === order.items.length
  const selNeedTemp    = [...selectedItems].some(idx => needsTempering(order.items[idx]))

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl shadow-lg text-[13px] font-semibold whitespace-nowrap pointer-events-none ${
          toast.ok ? 'bg-[#111110] text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.ok ? '✓ ' : '✗ '}{toast.msg}
        </div>
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
          <div className="text-right">
            <p className="text-[11px] text-[#9a9a95]">
              {order.items.length}&nbsp;{plural(order.items.length, 'позиция', 'позиции', 'позиций')}
            </p>
            {selectedItems.size > 0 && (
              <p className="text-[11px] font-bold text-[#111110]">{selectedItems.size} выбрано</p>
            )}
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

        </div>
      </div>
    </>
  )
}
