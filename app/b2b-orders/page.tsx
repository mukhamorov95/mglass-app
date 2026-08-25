'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'
import { computeProductionSummary, type MatLight } from '@/lib/productionSummary'
import { runCuttingOptimizer, DEFAULT_CUTTING_SETTINGS, type PieceGroup } from '@/lib/cuttingOptimizer'
import { type DetailStageKey, type DetailStageState, type DetailStages, PRODUCTION_STAGES, calcOrderProgress } from '@/lib/productionStages'
import { materialLabel, materialLabelShort } from '@/lib/materialLabel'
import { finalTotalOf } from '@/lib/b2b/priceOverride'

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
  { key: 'all_active',  label: 'Все активные', desc: '' },
  { key: 'cut',         label: 'Нарезка',      prev: 'printed'          as StageKey, curr: 'cut'           as StageKey },
  { key: 'edge',        label: 'Кромка',        prev: 'cut'              as StageKey, curr: 'edge_processed' as StageKey },
  { key: 'drill',       label: 'Сверловка',    prev: 'edge_processed'   as StageKey, curr: 'drilled'        as StageKey },
  { key: 'tempering',   label: 'Закалка',      prev: 'drilled'          as StageKey, curr: 'tempering'      as StageKey },
  { key: 'packaging',   label: 'Упаковка',     prev: 'tempering'        as StageKey, curr: 'packaged'       as StageKey },
  { key: 'packed',      label: 'Упакованы',    prev: 'packaged'         as StageKey, curr: 'shipped'        as StageKey },
  { key: 'shipped',     label: 'Отгружены',    prev: 'shipped'          as StageKey, curr: null },
] as const

type MaterialStatus =
  | 'not_checked'
  | 'need_to_buy'
  | 'ordered'
  | 'invoice_received'
  | 'paid'
  | 'shipped'
  | 'received'
  | 'ready'   // ставит цех («Материал есть» во вкладке Материал / Моих задачах)
  | 'needed'  // ставит цех («Нет материала» → заявка в закупку)

const MATERIAL_STATUS_META: Record<MaterialStatus, { label: string; badge: string }> = {
  not_checked:      { label: 'Не проверен',     badge: 'bg-[#f0f0ec] text-[#9a9a95] border-[#e4e4e0]' },
  need_to_buy:      { label: 'Нужно купить',     badge: 'bg-red-50 text-red-700 border-red-200' },
  ordered:          { label: 'Заказан',          badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  invoice_received: { label: 'Счёт получен',     badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  paid:             { label: 'Оплачен',          badge: 'bg-teal-50 text-teal-700 border-teal-200' },
  shipped:          { label: 'В пути / забрать', badge: 'bg-purple-50 text-purple-700 border-purple-200' },
  received:         { label: 'Принят',           badge: 'bg-green-50 text-green-700 border-green-200' },
  ready:            { label: 'Материал есть (цех)',        badge: 'bg-green-50 text-green-700 border-green-200' },
  needed:           { label: 'Нет материала — в закупке (цех)', badge: 'bg-red-50 text-red-700 border-red-200' },
}

const MATERIAL_STATUS_TRIGGERS_ORDERED = new Set<MaterialStatus>([
  'ordered', 'invoice_received', 'paid', 'shipped', 'received',
])

type SheetVariantMin = {
  id: number
  material_id: number
  sheet_width: number
  sheet_height: number
  supplier_id: string | null
  supplier_material_name: string | null
  is_default: boolean
  active: boolean
}

type MatFull = MatLight & {
  id: number
  category?: string | null
  supplier_id?: number | null
  supplier_material_name?: string | null
}

type MatReqGroup = {
  materialKey: string
  materialName: string
  category: string
  thickness: number
  sheetWidth: number | null
  sheetHeight: number | null
  wastePercent: number
  areaM2: number
  weightKg: number
  itemCount: number
  orderNums: string[]
  orderIds: number[]
  unmatched: boolean
  costPrice: number | null
  requiredAreaWithWaste: number
  sheetAreaM2: number | null
  sheetsCount: number | null
  estimatedCost: number | null
  sheetVariantId: number | null
  sheetFormatSource: 'variant_default' | 'variant_first_active' | 'material_fallback'
  supplierId: string | null
  supplierMaterialName: string | null
}

const PROGRESS_STAGES = STAGES.slice(0, 10) as readonly { key: StageKey; label: string }[]

function calcProgress(stages: Partial<Record<StageKey, string | null>>): number {
  const done = PROGRESS_STAGES.filter(s => !!stages?.[s.key]).length
  return Math.round(done / PROGRESS_STAGES.length * 100)
}

type DeadlineControl = {
  reason?: string
  next_action?: string
  responsible?: string
  next_check_date?: string
  updated_at?: string
}

type BulkAction = {
  type: 'bulk_mark_shipped'
  scope: 'production_day_month'
  month_key: string
  order_id: number
  previous_stages: Partial<Record<StageKey, string | null>>
  created_at: string
  created_by: string
}

const DC_REASONS = [
  'Материал', 'Закалка', 'Фацет / триплекс', 'Производство',
  'Упаковка', 'Ожидание клиента', 'Логистика', 'Другое',
] as const

type NotesData = {
  status?: string
  quote_date?: string
  launched_at?: string
  production_days?: number
  deadline_date?: string
  user_notes?: string
  stages?: Partial<Record<StageKey, string | null>>
  detail_stages?: DetailStages
  material_status?: MaterialStatus
  material_status_updated_at?: string
  material_status_updated_by?: string
  deadline_control?: DeadlineControl
  drawing_url?: string
  bulk_actions?: BulkAction[]
  payment_status?: string
  prepayment_amount?: number
}

type Order = {
  id: number
  client_id: number | null
  client_name: string
  custom_number: string | null
  client_order_number: string | null
  discount_percent: number
  items: unknown[]
  total_area: number
  total_weight: number
  total_cost_net: number
  total_sale_inc_vat: number
  total_after_discount: number
  notes: string | null
  created_at: string
  parsedNotes: NotesData
  // Column-level authorship — backed by 20260630_b2b_orders_authorship.sql.
  // Optional/nullable so the UI keeps working against pre-migration rows.
  created_by_name?:     string | null
  launched_at?:         string | null
  launched_by_name?:    string | null
  launched_by_user_id?: string | null
  converted_by_name?:   string | null
  updated_by_name?:     string | null
  updated_at?:          string | null
}

// Effective launch date: prefer the new column, fall back to JSON notes.
// Returns null when neither has it — caller decides if it should treat the
// order as "not yet launched" or use a fallback like created_at for display.
function effectiveLaunchDate(o: Order): string | null {
  if (o.launched_at) return o.launched_at
  if (o.parsedNotes.launched_at) return o.parsedNotes.launched_at
  return null
}

// "Who launched" name with fallback chain.
function getLaunchedByName(o: Order): string | null {
  return o.launched_by_name ?? null
}

// "Who calculated" name with notes fallback for legacy rows.
function getCreatedByName(o: Order): string | null {
  if (o.created_by_name) return o.created_by_name
  const mn = o.parsedNotes && (o.parsedNotes as Record<string, unknown>).manager_name
  return typeof mn === 'string' ? mn : null
}

function parseNotes(notes: string | null): NotesData {
  if (!notes) return {}
  try {
    const p = JSON.parse(notes)
    if (typeof p === 'object' && p !== null) return p as NotesData
  } catch {}
  return {}
}

function getFinalPrice(order: Order): number {
  return finalTotalOf(order)
}

function getDeadline(launched_at: string | undefined, production_days: number | undefined): Date | null {
  if (!launched_at || !production_days) return null
  const d = new Date(launched_at)
  d.setDate(d.getDate() + production_days)
  return d
}

type DeadlineStatus = 'overdue' | 'today' | 'tomorrow' | 'normal' | 'ready' | 'shipped' | 'unknown'

const DEADLINE_FILTER_OPTIONS: { key: DeadlineStatus | 'all'; label: string }[] = [
  { key: 'all',      label: 'Все' },
  { key: 'overdue',  label: 'Просрочены' },
  { key: 'today',    label: 'Сегодня' },
  { key: 'tomorrow', label: 'Завтра' },
  { key: 'normal',   label: 'В сроке' },
  { key: 'ready',    label: 'Готовы' },
  { key: 'shipped',  label: 'Отгружены' },
  { key: 'unknown',  label: 'Без срока' },
]

const DEADLINE_BADGE: Record<DeadlineStatus, string> = {
  overdue:  'bg-red-50 text-red-600',
  today:    'bg-amber-50 text-amber-700',
  tomorrow: 'bg-yellow-50 text-yellow-700',
  normal:   'bg-[#f0f0ec] text-[#6b6b66]',
  ready:    'bg-emerald-50 text-emerald-700',
  shipped:  'bg-emerald-50 text-emerald-700',
  unknown:  'bg-[#f8f8f7] text-[#b0b0aa]',
}

const DEADLINE_RISK_ORDER: Record<DeadlineStatus | 'all', number> = {
  overdue: 0, today: 1, tomorrow: 2, normal: 3, ready: 4, shipped: 5, unknown: 6, all: 7,
}

function getPlannedReadyDate(pn: NotesData, createdAt: string): Date {
  if (pn.deadline_date) return new Date(pn.deadline_date)   // явный срок сдачи — приоритет
  const explicit = getDeadline(pn.launched_at, pn.production_days)
  if (explicit) return explicit
  if (pn.launched_at) {
    const d = new Date(pn.launched_at)
    d.setDate(d.getDate() + 7)
    return d
  }
  const d = new Date(createdAt)
  d.setDate(d.getDate() + 10)
  return d
}

function getDeadlineStatus(order: Order): {
  status: DeadlineStatus
  label: string
  plannedReadyDate: string | null
  daysDiff: number | null
} {
  const pn = order.parsedNotes
  const stages = pn.stages ?? {}
  if (stages.shipped)  return { status: 'shipped', label: 'Отгружен',         plannedReadyDate: null, daysDiff: null }
  if (stages.packaged) return { status: 'ready',   label: 'Готов / упакован', plannedReadyDate: null, daysDiff: null }
  const planned = getPlannedReadyDate(pn, order.created_at)
  const today   = new Date(); today.setHours(0, 0, 0, 0)
  const planDay = new Date(planned); planDay.setHours(0, 0, 0, 0)
  const daysDiff = Math.round((planDay.getTime() - today.getTime()) / 86400000)
  const plannedReadyDate = planned.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  if (daysDiff < 0)  return { status: 'overdue',  label: `Просрочен на ${Math.abs(daysDiff)} дн.`, plannedReadyDate, daysDiff }
  if (daysDiff === 0) return { status: 'today',   label: 'Срок сегодня',                           plannedReadyDate, daysDiff }
  if (daysDiff === 1) return { status: 'tomorrow', label: 'Срок завтра',                            plannedReadyDate, daysDiff }
  return { status: 'normal', label: 'В сроке', plannedReadyDate, daysDiff }
}

function hasDeadlineControl(order: Order): boolean {
  const dc = order.parsedNotes.deadline_control
  return Boolean(dc?.reason || dc?.next_action)
}

function requiresDeadlineControl(order: Order): boolean {
  const status = getDeadlineStatus(order).status
  return (status === 'overdue' || status === 'today' || status === 'tomorrow') && !hasDeadlineControl(order)
}

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const fmt = (n: number) => (n ?? 0).toLocaleString('ru-RU') + ' ₽'
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function tomorrowDateStr() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

function getOrderMonthKey(order: Order): string {
  const pn = order.parsedNotes
  const dateStr = pn.launched_at || order.created_at
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatMonthKey(key: string): string {
  const [year, month] = key.split('-')
  return `${MONTH_NAMES[parseInt(month) - 1]} ${year}`
}

type OrderPayStatus = 'paid' | 'partial' | 'unpaid' | 'unknown'

const PAY_BADGE: Record<OrderPayStatus, { label: string; cls: string } | null> = {
  paid:    { label: 'Оплачен',    cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  partial: { label: 'Частично',   cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
  unpaid:  { label: 'Не опл.',    cls: 'bg-red-50 text-red-600 border border-red-100' },
  unknown: null,
}

function getOrderPayStatus(order: Order): OrderPayStatus {
  const pn = order.parsedNotes
  const stages = pn.stages ?? {}
  // Production stage invoice_paid is the strongest signal
  if (stages.invoice_paid)              return 'paid'
  // payment_status carried over from b2b-quotes flow
  if (pn.payment_status === 'paid')     return 'paid'
  if (pn.payment_status === 'partial')  return 'partial'
  if (pn.payment_status === 'unpaid')   return 'unpaid'
  // invoice sent but not yet paid
  if (stages.invoice_sent)              return 'unpaid'
  return 'unknown'
}

function getOrderNum(pn: NotesData): string {
  const notes = pn.user_notes ?? ''
  const m = notes.match(/[Зз]аказ\s*([\w\-]+)/)
  return m ? m[1] : ''
}

// Progress is tracked per position (itemIndex), not per piece count.
// A position with quantity=13 counts as 1, not 13 — detail_stages is keyed by itemIndex.
// Future: source will move to b2b_order_details table.
type ProgressItem = { hasTempering?: boolean; materialName?: string; category?: string }

function getProductionProgress(order: Order) {
  const orderProg  = calcOrderProgress(
    order.items as ProgressItem[],
    order.parsedNotes.detail_stages ?? {},
  )
  const { items, totalItems } = orderProg

  // Items with tempering applicable have totalStages === PRODUCTION_STAGES.length (5),
  // items without have one fewer stage (4).
  const temperingTotal = items.filter(p => p.totalStages === PRODUCTION_STAGES.length).length

  const stages = PRODUCTION_STAGES.map(st => ({
    key:   st.key,
    label: st.label,
    done:  items.filter(p => (p.completedKeys as string[]).includes(st.key)).length,
    total: st.key === 'tempering' ? temperingTotal : totalItems,
  })).filter(s => s.key !== 'tempering' || s.total > 0)

  const problemCount = items.filter(p => p.hasProblem).length
  const hasAnyMark   = items.some(p => p.doneStages > 0 || p.hasProblem)

  // Weighted percentage: total done stage-slots / total possible stage-slots
  const totalDone     = stages.reduce((sum, s) => sum + s.done, 0)
  const totalPossible = stages.reduce((sum, s) => sum + s.total, 0)
  const progressPct   = totalPossible > 0 ? Math.round(totalDone / totalPossible * 100) : 0

  return { stages, problemCount, hasAnyMark, progressPct }
}

// ── Production board ──────────────────────────────────────────────────────────
// Counts active (non-shipped, non-quote) orders by production state.
// Uses calcOrderProgress — single source of truth. No new API calls.

type BoardBucket = 'not_started' | 'in_progress' | 'ready_for_tempering' | 'on_packaging' | 'packed'
type ProductionBoardFilter = BoardBucket | 'problems' | null

function classifyOrderForBoard(order: Order): { bucket: BoardBucket; problemCount: number } {
  const prog = calcOrderProgress(
    order.items as ProgressItem[],
    order.parsedNotes.detail_stages ?? {},
  )
  const { items, packedItems, totalItems } = prog

  const problemCount = items.filter(p => p.hasProblem).length

  if (totalItems === 0) return { bucket: 'not_started', problemCount }

  // All items packaged
  if (packedItems === totalItems) return { bucket: 'packed', problemCount }

  // No marks at all
  const hasAnyMark = items.some(p => p.doneStages > 0 || p.hasProblem)
  if (!hasAnyMark) return { bucket: 'not_started', problemCount }

  // All items awaiting packaging or already packaged
  const awaitingPackaging = items.filter(p => !p.packagingDone && p.doneStages >= p.totalStages - 1)
  if (awaitingPackaging.length + packedItems === totalItems) {
    return { bucket: 'on_packaging', problemCount }
  }

  // All tempering items have cutting+polishing done but tempering not yet done
  const temperingItems = items.filter(p => p.totalStages === PRODUCTION_STAGES.length)
  if (temperingItems.length > 0 && temperingItems.every(p => {
    const keys = p.completedKeys as string[]
    return keys.includes('cutting') && keys.includes('polishing') && !keys.includes('tempering')
  })) {
    return { bucket: 'ready_for_tempering', problemCount }
  }

  return { bucket: 'in_progress', problemCount }
}

const BOARD_SLOTS: { bucket: BoardBucket; label: string; numCls: string; bgCls: string; borderCls: string; ringCls: string }[] = [
  { bucket: 'not_started',         label: 'Не начато',  numCls: 'text-[#6b6b66]',  bgCls: 'bg-[#f8f8f7]',  borderCls: 'border-[#e4e4e0]',   ringCls: 'ring-[#9a9a95]'   },
  { bucket: 'in_progress',         label: 'В работе',   numCls: 'text-blue-700',    bgCls: 'bg-blue-50',     borderCls: 'border-blue-200',    ringCls: 'ring-blue-400'    },
  { bucket: 'ready_for_tempering', label: 'К закалке',  numCls: 'text-orange-700',  bgCls: 'bg-orange-50',   borderCls: 'border-orange-200',  ringCls: 'ring-orange-400'  },
  { bucket: 'on_packaging',        label: 'Упаковка',   numCls: 'text-purple-700',  bgCls: 'bg-purple-50',   borderCls: 'border-purple-200',  ringCls: 'ring-purple-400'  },
  { bucket: 'packed',              label: 'Упаковано',  numCls: 'text-emerald-700', bgCls: 'bg-emerald-50',  borderCls: 'border-emerald-200', ringCls: 'ring-emerald-400' },
]

const BOARD_FILTER_LABELS: Record<NonNullable<ProductionBoardFilter>, string> = {
  not_started:         'Не начато',
  in_progress:         'В работе',
  ready_for_tempering: 'К закалке',
  on_packaging:        'Упаковка',
  packed:              'Упаковано',
  problems:            'Проблемы',
}

function ProductionBoard({
  orders,
  activeFilter,
  onFilterChange,
}: {
  orders: Order[]
  activeFilter: ProductionBoardFilter
  onFilterChange: (f: ProductionBoardFilter) => void
}) {
  const active = orders.filter(o => {
    const stages = o.parsedNotes.stages ?? {}
    return !stages.shipped && o.parsedNotes.status !== 'quote'
  })
  if (active.length === 0) return null

  // Counts always reflect ALL active orders, independent of current filter
  const counts: Record<BoardBucket, number> = {
    not_started: 0, in_progress: 0, ready_for_tempering: 0, on_packaging: 0, packed: 0,
  }
  let totalProblems = 0
  for (const o of active) {
    const { bucket, problemCount } = classifyOrderForBoard(o)
    counts[bucket]++
    totalProblems += problemCount
  }

  return (
    <div className="mb-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-2">
        Производственное табло
        <span className="ml-2 font-normal text-[#c4c4be] normal-case tracking-normal">· {active.length} заказов</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {BOARD_SLOTS.map(slot => {
          const isActive = activeFilter === slot.bucket
          return (
            <button
              key={slot.bucket}
              onClick={() => onFilterChange(isActive ? null : slot.bucket)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all ${slot.bgCls} ${slot.borderCls} ${
                isActive
                  ? `ring-2 ring-offset-1 ${slot.ringCls} shadow-sm`
                  : 'hover:shadow-sm hover:brightness-95 cursor-pointer'
              }`}
            >
              <span className={`text-[11px] font-medium ${slot.numCls}`}>{slot.label}</span>
              <span className={`text-[17px] font-bold font-mono leading-none ${slot.numCls}`}>{counts[slot.bucket]}</span>
            </button>
          )
        })}
        {totalProblems > 0 && (() => {
          const isActive = activeFilter === 'problems'
          return (
            <button
              onClick={() => onFilterChange(isActive ? null : 'problems')}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all bg-red-50 border-red-200 ${
                isActive
                  ? 'ring-2 ring-offset-1 ring-red-400 shadow-sm'
                  : 'hover:shadow-sm cursor-pointer'
              }`}
            >
              <span className="text-[11px] font-medium text-red-700">Проблемы</span>
              <span className="text-[17px] font-bold font-mono leading-none text-red-700">{totalProblems}</span>
            </button>
          )
        })()}
      </div>
    </div>
  )
}

function buildProductionMessage(order: Order): string {
  const items = order.items as Record<string, unknown>[]
  const finalPrice = getFinalPrice(order)

  type MatGroup = {
    label: string
    hasTemp: boolean
    lines: { w: number; h: number; qty: number; area: number }[]
  }
  const groups = new Map<string, MatGroup>()

  for (const item of items) {
    const key = `${item.materialName}|${item.thickness}`
    const qty = Number(item.quantity ?? 0)
    const w = Number(item.width ?? 0)
    const h = Number(item.height ?? 0)
    const area = Number(item.totalAreaNet ?? 0)
    if (!groups.has(key)) {
      groups.set(key, {
        // materialLabel сам подписывает зеркало/рифлёное и не дублирует толщину,
        // если она уже в названии (изделия производства).
        label: materialLabel(item as { materialName?: string; category?: string; thickness?: number }),
        hasTemp: !!item.hasTempering,
        lines: [],
      })
    }
    const g = groups.get(key)!
    if (item.hasTempering) g.hasTemp = true
    g.lines.push({ w, h, qty, area })
  }

  const msgLines: string[] = []
  msgLines.push(order.custom_number?.trim() || `00${order.id}`)   // номер заказа: 00XXXX, если своего нет
  if (order.client_order_number) msgLines.push(`(${order.client_order_number})`)
  msgLines.push('')
  msgLines.push(order.client_name)

  const hasAnyTemp = [...groups.values()].some(g => g.hasTemp)

  for (const g of groups.values()) {
    msgLines.push('')
    let header = g.label
    if (g.hasTemp) header += ', закалённое'
    header += ', упакованное'
    msgLines.push(header)
    const totalQty = g.lines.reduce((s, l) => s + l.qty, 0)
    const totalArea = g.lines.reduce((s, l) => s + l.area, 0)
    for (const l of g.lines) {
      msgLines.push(`  ${l.w}×${l.h} мм — ${l.qty} шт`)
    }
    msgLines.push(`  Итого: ${totalQty} шт · ${totalArea.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} м²`)
  }

  msgLines.push('')
  msgLines.push(`💰 ${finalPrice.toLocaleString('ru-RU')} ₽`)
  return msgLines.join('\n')
}

export default function B2BOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set())
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set())

  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [editNumId, setEditNumId]           = useState<number | null>(null)
  const [editCustomNum, setEditCustomNum]   = useState('')
  const [editClientNum, setEditClientNum]   = useState('')
  const [savingNum, setSavingNum]           = useState(false)
  // Правка итоговой суммы запущенного заказа (владелец, только вниз)
  const [editTotalId, setEditTotalId]       = useState<number | null>(null)
  const [editTotalVal, setEditTotalVal]     = useState('')
  const [savingTotal, setSavingTotal]       = useState(false)
  const [totalErr, setTotalErr]             = useState<string | null>(null)

  // Production extras
  const [materials, setMaterials]     = useState<MatFull[]>([])
  const [variantsByMaterialId, setVariantsByMaterialId] = useState<Record<number, SheetVariantMin[]>>({})
  const [managerCode, setManagerCode] = useState<number>(0)
  const [canDelete, setCanDelete]     = useState(false)
  const [isOwner, setIsOwner]         = useState(false)   // admin/ceo — видят экономику заказа
  const [generatingNum, setGeneratingNum] = useState<number | null>(null)
  const [msgOpenId, setMsgOpenId]     = useState<number | null>(null)
  const [nowTs, setNowTs]             = useState(0)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNowTs(Date.now())
  }, [])
  const [copiedMsg, setCopiedMsg]     = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [toastMsg, setToastMsg]       = useState<string | null>(null)
  const [toastError, setToastError]   = useState(false)
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<number>>(new Set())
  const [showMaterialReq, setShowMaterialReq]   = useState(false)
  const [creatingPurchaseOrder, setCreatingPurchaseOrder] = useState(false)
  const [dcEdit, setDcEdit]   = useState<Record<number, Partial<DeadlineControl>>>({})
  const [dcSaving, setDcSaving] = useState<number | null>(null)
  const [productionDayMode, setProductionDayMode] = useState(false)
  const [showOnlyNeedsControl, setShowOnlyNeedsControl] = useState(false)
  const [bulkActionLoading, setBulkActionLoading] = useState<string | null>(null)

  // А16: логистика отгрузки. Способ получения партнёр может выбрать сам в кабинете —
  // пишем в тот же notes.delivery, чтобы запись была одна.
  const [deliverySaving, setDeliverySaving] = useState<number | null>(null)
  const [deliveryAddr, setDeliveryAddr] = useState<Record<number, string>>({})
  async function saveDelivery(orderId: number, patch: { method?: 'pickup' | 'delivery'; status?: string; address?: string; date?: string }) {
    setDeliverySaving(orderId)
    try {
      const r = await fetch(`/api/b2b-orders/${orderId}/delivery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setToastError(true); setToastMsg(j.error || 'Не удалось сохранить'); return }
      setOrders(prev => prev.map(o => o.id === orderId
        ? { ...o, parsedNotes: { ...o.parsedNotes, delivery: j.delivery } as typeof o.parsedNotes }
        : o))
      setToastError(false); setToastMsg('Логистика обновлена')
    } finally { setDeliverySaving(null) }
  }

  // А3: повтор заказа — новый просчёт с теми же позициями и ценами, которые клиент
  // уже согласовал. Номера, оплаты и следы запуска не тащим: это новый черновик.
  const [repeating, setRepeating] = useState<number | null>(null)
  async function repeatOrder(order: Order) {
    setRepeating(order.id)
    try {
      const sb = createClient()
      const { data: { user } } = await sb.auth.getUser()
      let authorName: string | null = null
      if (user?.id) {
        const { data: prof } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
        authorName = (prof?.name as string | null) ?? user.email ?? null
      }
      const notes = JSON.stringify({
        status: 'quote',
        quote_date: new Date().toISOString(),
        manager_name: authorName ?? undefined,
        repeated_from: order.id,
        production_days: order.parsedNotes?.production_days ?? undefined,
      })
      const { data, error } = await sb.from('b2b_orders').insert({
        client_id: order.client_id,
        client_name: order.client_name,
        discount_percent: order.discount_percent,
        items: order.items,
        total_area: order.total_area,
        total_weight: order.total_weight,
        total_cost_net: order.total_cost_net ?? 0,
        total_sale_inc_vat: order.total_sale_inc_vat,
        total_after_discount: order.total_after_discount,
        notes,
        created_by: user?.id ?? null,
        created_by_name: authorName,
      }).select('id').single()
      if (error || !data) {
        setToastError(true); setToastMsg('Не удалось повторить заказ')
        return
      }
      setToastError(false)
      setToastMsg(`Создан просчёт #${data.id} — открываю просчёты`)
      setTimeout(() => { window.location.href = '/b2b-quotes' }, 900)
    } finally { setRepeating(null) }
  }

  function startEditNum(order: Order) {
    setEditNumId(order.id)
    setEditCustomNum(order.custom_number ?? '')
    setEditClientNum(order.client_order_number ?? '')
  }

  async function saveNum(orderId: number) {
    setSavingNum(true)
    const sb = createClient()
    await sb.from('b2b_orders').update({
      custom_number: editCustomNum.trim() || null,
      client_order_number: editClientNum.trim() || null,
    }).eq('id', orderId)
    setOrders(prev => prev.map(o => o.id === orderId
      ? { ...o, custom_number: editCustomNum.trim() || null, client_order_number: editClientNum.trim() || null }
      : o
    ))
    setSavingNum(false)
    setEditNumId(null)
  }

  // Владелец меняет итог заказа: серверный роут пересчитывает все позиции
  // пропорционально (НДС/маржа заново), синхронит реестр продаж. Только вниз.
  async function saveOrderTotal(orderId: number, oldTotal: number) {
    setTotalErr(null)
    const nt = Math.round(Number(editTotalVal))
    if (!nt || nt <= 0) { setTotalErr('Введите сумму'); return }
    if (nt >= oldTotal) { setTotalErr(`Меньше ${Math.round(oldTotal).toLocaleString('ru-RU')} ₽`); return }
    setSavingTotal(true)
    try {
      const res = await fetch(`/api/b2b-orders/${orderId}/adjust-total`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newTotal: nt }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setTotalErr(json.error || 'Ошибка'); return }
      setEditTotalId(null); setEditTotalVal('')
      await loadOrders()
    } catch {
      setTotalErr('Сеть недоступна')
    } finally { setSavingTotal(false) }
  }

  async function generateNumber(orderId: number) {
    setGeneratingNum(orderId)
    try {
      const sb = createClient()
      const { data: allOrders } = await sb
        .from('b2b_orders')
        .select('custom_number')
        .not('custom_number', 'is', null)

      let maxNum = 0
      let hasFormat = false
      for (const o of allOrders ?? []) {
        if (o.custom_number) {
          const m = (o.custom_number as string).match(/^(\d+)-\d+$/)
          if (m) {
            hasFormat = true
            const n = parseInt(m[1])
            if (n > maxNum) maxNum = n
          }
        }
      }

      if (!hasFormat) {
        const { count } = await sb
          .from('b2b_orders')
          .select('id', { count: 'exact', head: true })
        maxNum = (count ?? 0) + 999
      }

      const newNum = `${maxNum + 1}-${String(managerCode).padStart(2, '0')}`
      const order = orders.find(o => o.id === orderId)
      if (order) {
        setEditNumId(orderId)
        setEditCustomNum(newNum)
        setEditClientNum(order.client_order_number ?? '')
      }
    } finally {
      setGeneratingNum(null)
    }
  }

  async function handleDelete() {
    if (!deletingId) return
    setDeleting(true)
    await createClient()
      .from('b2b_orders')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', deletingId)
    setOrders(prev => prev.filter(o => o.id !== deletingId))
    if (expanded === deletingId) setExpanded(null)
    setDeletingId(null)
    setDeleting(false)
  }

  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('all_active')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineStatus | 'all'>('all')
  const [boardFilter, setBoardFilter] = useState<ProductionBoardFilter>(null)

  async function loadOrders() {
    setLoading(true)
    setLoadError(null)
    const sb = createClient()
    try {
      const { data: { user } } = await sb.auth.getUser()
      if (!user) { return }
      setCurrentUserId(user.id)

      const { data: profile } = await sb
        .from('users')
        .select('role, see_all_orders, manager_code, can_delete')
        .eq('id', user.id)
        .single()

      const canSeeAll = profile?.role === 'admin' || profile?.role === 'buyer' || profile?.see_all_orders === true
      setManagerCode(profile?.manager_code ?? 0)
      setCanDelete(profile?.role === 'admin' || profile?.can_delete === true)
      setIsOwner(profile?.role === 'admin' || profile?.role === 'ceo')

      // Пагинация: тянем ВСЕ заказы. Supabase режет выборку на 1000 строк/запрос,
      // а с историей 2024/2025 их >2600 — при одном .limit(1000) новые месяцы
      // (июль) просто не попадали в выборку. Грузим постранично, новые сверху.
      const uid = user.id
      async function fetchAllOrders() {
        const acc: Record<string, unknown>[] = []
        for (let from = 0; ; from += 1000) {
          let q = sb
            .from('b2b_orders')
            .select('*')
            .not('notes', 'ilike', '%"status":"quote"%')
            .not('notes', 'ilike', '%"historical":true%')   // история 2024/2025 — только в аналитике /cfo/b2b, не в операционном списке
            .is('archived_at', null)
            .order('created_at', { ascending: false })
            .range(from, from + 999)
          if (!canSeeAll) q = q.eq('created_by', uid)
          const { data, error } = await q
          if (error || !data?.length) break
          acc.push(...data)
          if (data.length < 1000) break
        }
        return acc
      }

      const [ordersData, { data: mats }, { data: varData }] = await Promise.all([
        fetchAllOrders(),
        sb.from('b2b_materials')
          .select('id,name,category,thickness,sheet_width,sheet_height,cost_price,waste_percent,supplier_id,supplier_material_name')
          .eq('active', true),
        sb.from('b2b_material_sheet_variants')
          .select('id,material_id,sheet_width,sheet_height,supplier_id,supplier_material_name,is_default,active')
          .eq('active', true)
          .order('sort_order')
          .order('id'),
      ])

      const groupedVariants: Record<number, SheetVariantMin[]> = {}
      for (const v of (varData ?? []) as SheetVariantMin[]) {
        if (!groupedVariants[v.material_id]) groupedVariants[v.material_id] = []
        groupedVariants[v.material_id].push(v)
      }
      setVariantsByMaterialId(groupedVariants)
      setMaterials((mats ?? []) as MatFull[])

      const parsed = (ordersData ?? []).map(o => ({
        ...o,
        items: Array.isArray(o.items) ? o.items : [],
        parsedNotes: parseNotes(o.notes as string | null),
      })) as Order[]
      setOrders(parsed)

      // По умолчанию раскрыт ТОЛЬКО текущий месяц (и его год); все остальные свёрнуты.
      const now = new Date()
      const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      setExpandedMonths(new Set([currentKey]))
      setExpandedYears(new Set([now.getFullYear()]))
    } catch (err) {
      console.error('[b2b-orders] load error:', err)
      setLoadError(err instanceof Error ? err.message : 'Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadOrders().catch(() => setLoading(false)) }, [])

  const isFiltered = search.trim() !== '' || stageFilter !== 'all_active' || dateFrom !== '' || dateTo !== '' || deadlineFilter !== 'all' || boardFilter !== null

  const filteredOrders = useMemo(() => {
    const filtered = orders.filter(o => {
      const pn = o.parsedNotes
      const stages = pn.stages ?? {}
      const isShipped = !!stages.shipped

      if (search.trim()) {
        const q = search.trim().toLowerCase()
        // Заказы без custom_number идентифицируются по id (в ленте показаны как
        // 05066 = падинг id). Поэтому ищем и по id, нормализуя ведущие нули.
        const qn = q.replace(/\D/g, '').replace(/^0+/, '')
        const match =
          o.client_name.toLowerCase().includes(q) ||
          (o.custom_number ?? '').toLowerCase().includes(q) ||
          (o.client_order_number ?? '').toLowerCase().includes(q) ||
          getOrderNum(pn).toLowerCase().includes(q) ||
          (qn !== '' && String(o.id).includes(qn))
        if (!match) return false
      }

      const launchedAt = pn.launched_at ?? o.created_at.slice(0, 10)
      if (dateFrom && launchedAt < dateFrom) return false
      if (dateTo && launchedAt > dateTo) return false

      // Deadline filter overrides stageFilter (allows showing shipped/ready via deadline tab)
      if (deadlineFilter !== 'all') {
        return getDeadlineStatus(o).status === deadlineFilter
      }

      const sf = STAGE_FILTERS.find(f => f.key === stageFilter)
      if (!sf) return true

      if (stageFilter === 'all_active') return !isShipped
      if (stageFilter === 'shipped') return isShipped

      const f = sf as { prev: StageKey; curr: StageKey | null }
      if (stageFilter === 'packed') {
        return !!stages.packaged && !isShipped
      }
      return !!stages[f.prev] && !stages[f.curr!]
    })

    if (deadlineFilter !== 'all') {
      const sorted = [...filtered].sort((a, b) =>
        DEADLINE_RISK_ORDER[getDeadlineStatus(a).status] - DEADLINE_RISK_ORDER[getDeadlineStatus(b).status]
      )
      if (boardFilter !== null) {
        return sorted.filter(o => {
          const { bucket, problemCount } = classifyOrderForBoard(o)
          return boardFilter === 'problems' ? problemCount > 0 : bucket === boardFilter
        })
      }
      return sorted
    }

    if (boardFilter !== null) {
      return filtered.filter(o => {
        const { bucket, problemCount } = classifyOrderForBoard(o)
        return boardFilter === 'problems' ? problemCount > 0 : bucket === boardFilter
      })
    }

    return filtered
  }, [orders, search, stageFilter, deadlineFilter, dateFrom, dateTo, boardFilter])

  // Internal B2B registry: group by month of effective launch date (column
  // launched_at, fallback notes.launched_at). Orders without any launch date go
  // into a separate "no_launch" group at the end of the list. Inside each
  // month, orders are sorted by launch date ASC (1st of month at top, 31st at
  // bottom) — first order launched in the month is on top.
  const monthGroups = useMemo(() => {
    const groups: { key: string; label: string; orders: Order[]; total: number; noLaunch: boolean }[] = []
    const noLaunchGroup = { key: 'no_launch', label: 'Без даты запуска', orders: [] as Order[], total: 0, noLaunch: true }
    for (const order of orders) {
      const launch = effectiveLaunchDate(order)
      if (!launch) {
        noLaunchGroup.orders.push(order)
        noLaunchGroup.total += getFinalPrice(order)
        continue
      }
      const d = new Date(launch)
      if (Number.isNaN(d.getTime())) {
        noLaunchGroup.orders.push(order)
        noLaunchGroup.total += getFinalPrice(order)
        continue
      }
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      let group = groups.find(g => g.key === key)
      if (!group) {
        group = { key, label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`, orders: [], total: 0, noLaunch: false }
        groups.push(group)
      }
      group.orders.push(order)
      group.total += getFinalPrice(order)
    }
    // Sort orders inside each month by launch date ASC (earliest at the top).
    for (const g of groups) {
      g.orders.sort((a, b) => {
        const da = effectiveLaunchDate(a) ?? ''
        const db = effectiveLaunchDate(b) ?? ''
        return da.localeCompare(db)
      })
    }
    // Chronological month order (oldest month at top, newest at bottom). Pushing
    // the "no launch" bucket to the very end so it is visible but separate.
    // Новые месяцы сверху (июль → январь). Внутри месяца порядок запуска — ASC (см. выше).
    groups.sort((a, b) => b.key.localeCompare(a.key))
    if (noLaunchGroup.orders.length > 0) groups.push(noLaunchGroup)
    return groups
  }, [orders])

  // Группировка месяцев по годам (год → месяцы → заказы). Год «0» — «Без даты запуска».
  const yearGroups = useMemo(() => {
    const map = new Map<number, { year: number; months: typeof monthGroups; total: number; count: number }>()
    for (const g of monthGroups) {
      const year = g.noLaunch ? 0 : Number(g.key.slice(0, 4))
      let y = map.get(year)
      if (!y) { y = { year, months: [], total: 0, count: 0 }; map.set(year, y) }
      y.months.push(g); y.total += g.total; y.count += g.orders.length
    }
    // Годы по убыванию; «Без даты запуска» (0) — в самый низ.
    return [...map.values()].sort((a, b) => (a.year === 0 ? 1 : b.year === 0 ? -1 : b.year - a.year))
  }, [monthGroups])

  const productionDayGroups = useMemo(() => {
    const base = search.trim()
      ? orders.filter(o => {
          const q = search.trim().toLowerCase()
          const qn = q.replace(/\D/g, '').replace(/^0+/, '')
          const pn = o.parsedNotes
          return (
            o.client_name.toLowerCase().includes(q) ||
            (o.custom_number ?? '').toLowerCase().includes(q) ||
            (o.client_order_number ?? '').toLowerCase().includes(q) ||
            getOrderNum(pn).toLowerCase().includes(q) ||
            (qn !== '' && String(o.id).includes(qn))
          )
        })
      : orders
    return {
      overdue:  base.filter(o => getDeadlineStatus(o).status === 'overdue'),
      today:    base.filter(o => getDeadlineStatus(o).status === 'today'),
      tomorrow: base.filter(o => getDeadlineStatus(o).status === 'tomorrow'),
      ready:    base.filter(o => getDeadlineStatus(o).status === 'ready'),
    }
  }, [orders, search])

  function toggleMonth(key: string) {
    setExpandedMonths(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleYear(year: number) {
    setExpandedYears(prev => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }

  async function toggleStage(orderId: number, stageKey: StageKey) {
    const order = orders.find(o => o.id === orderId)
    if (!order) return
    const stages = { ...(order.parsedNotes.stages ?? {}) } as Partial<Record<StageKey, string | null>>
    // «Счёт оплачен» — событие денег, пишется единым роутом (Д2), не напрямую.
    if (stageKey === 'invoice_paid') {
      const willBePaid = !stages.invoice_paid
      const r = await fetch(`/api/b2b-orders/${orderId}/payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: willBePaid ? 'paid' : 'unpaid' }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) return
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, parsedNotes: (d.notes ?? o.parsedNotes) as NotesData } : o))
      return
    }
    stages[stageKey] = stages[stageKey] ? null : new Date().toISOString().slice(0, 10)
    const newParsed: NotesData = { ...order.parsedNotes, stages }
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, parsedNotes: newParsed } : o))
    const { error } = await createClient().from('b2b_orders').update({ notes: JSON.stringify(newParsed) }).eq('id', orderId)
    if (error) {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, parsedNotes: order.parsedNotes } : o))
    }
  }

  async function updateMaterialStatus(orderId: number, newStatus: MaterialStatus) {
    const order = orders.find(o => o.id === orderId)
    if (!order) return

    const now = new Date().toISOString()
    const currentStages = { ...(order.parsedNotes.stages ?? {}) } as Partial<Record<StageKey, string | null>>

    const newStages = MATERIAL_STATUS_TRIGGERS_ORDERED.has(newStatus)
      ? { ...currentStages, material_ordered: currentStages.material_ordered ?? now.slice(0, 10) }
      : currentStages

    const newParsed: NotesData = {
      ...order.parsedNotes,
      stages: newStages,
      material_status: newStatus,
      material_status_updated_at: now,
      material_status_updated_by: currentUserId ?? undefined,
    }

    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, parsedNotes: newParsed } : o))

    const { error } = await createClient()
      .from('b2b_orders')
      .update({ notes: JSON.stringify(newParsed) })
      .eq('id', orderId)

    if (error) {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, parsedNotes: order.parsedNotes } : o))
      setToastError(true)
      setToastMsg('Ошибка обновления статуса материала')
    } else {
      setToastError(false)
      setToastMsg('Статус материала обновлён')
    }
    setTimeout(() => setToastMsg(null), 3000)
  }

  async function saveDeadlineControl(orderId: number) {
    const order = orders.find(o => o.id === orderId)
    if (!order) return
    setDcSaving(orderId)
    const draft = dcEdit[orderId] ?? {}
    const merged: DeadlineControl = {
      ...(order.parsedNotes.deadline_control ?? {}),
      ...draft,
      updated_at: new Date().toISOString(),
    }
    const newParsed: NotesData = { ...order.parsedNotes, deadline_control: merged }
    const { error } = await createClient()
      .from('b2b_orders')
      .update({ notes: JSON.stringify(newParsed) })
      .eq('id', orderId)
    setDcSaving(null)
    if (error) {
      setToastError(true)
      setToastMsg('Ошибка сохранения контроля срока')
    } else {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, parsedNotes: newParsed } : o))
      setDcEdit(prev => { const next = { ...prev }; delete next[orderId]; return next })
      setToastError(false)
      setToastMsg('Контроль срока сохранён')
    }
    setTimeout(() => setToastMsg(null), 3000)
  }

  async function quickPatchDc(orderId: number, patch: Partial<DeadlineControl>) {
    const order = orders.find(o => o.id === orderId)
    if (!order) return
    setDcSaving(orderId)
    const merged: DeadlineControl = {
      ...(order.parsedNotes.deadline_control ?? {}),
      ...patch,
      updated_at: new Date().toISOString(),
    }
    const newParsed: NotesData = { ...order.parsedNotes, deadline_control: merged }
    const { error } = await createClient()
      .from('b2b_orders')
      .update({ notes: JSON.stringify(newParsed) })
      .eq('id', orderId)
    setDcSaving(null)
    if (error) {
      setToastError(true)
      setToastMsg('Ошибка сохранения')
    } else {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, parsedNotes: newParsed } : o))
      setToastError(false)
      setToastMsg('Следующий контроль: завтра')
    }
    setTimeout(() => setToastMsg(null), 3000)
  }

  async function bulkMarkMonthAsShipped(monthKey: string, ordersToUpdate: Order[]) {
    setBulkActionLoading(monthKey)
    const now = new Date().toISOString()
    let updatedCount = 0

    for (const order of ordersToUpdate) {
      if (getDeadlineStatus(order).status !== 'overdue') continue

      const currentNotes = order.parsedNotes
      const nextNotes: NotesData = {
        ...currentNotes,
        stages: {
          ...(currentNotes.stages || {}),
          packaged: currentNotes.stages?.packaged || now,
          shipped: now,
        },
        bulk_actions: [
          ...(Array.isArray(currentNotes.bulk_actions) ? currentNotes.bulk_actions : []),
          {
            type: 'bulk_mark_shipped' as const,
            scope: 'production_day_month' as const,
            month_key: monthKey,
            order_id: order.id,
            previous_stages: currentNotes.stages || {},
            created_at: now,
            created_by: currentUserId || 'unknown',
          },
        ],
      }

      const { error } = await createClient()
        .from('b2b_orders')
        .update({ notes: JSON.stringify(nextNotes) })
        .eq('id', order.id)

      if (error) {
        setBulkActionLoading(null)
        alert(`Ошибка при обновлении заказа #${order.id}. Успешно обновлено: ${updatedCount} из ${ordersToUpdate.length}.`)
        return
      }

      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, parsedNotes: nextNotes } : o))
      updatedCount++
    }

    setBulkActionLoading(null)
    setToastError(false)
    setToastMsg(`Отгружено: ${updatedCount} заказов`)
    setTimeout(() => setToastMsg(null), 4000)
  }

  function toggleOrderSelection(orderId: number) {
    setSelectedOrderIds(prev => {
      const next = new Set(prev)
      next.has(orderId) ? next.delete(orderId) : next.add(orderId)
      return next
    })
  }

  function normalizeName(s: string): string {
    return s.toLowerCase().trim().replace(/\s+/g, ' ')
  }

  function findMatchingMaterial(item: Record<string, unknown>, mats: MatFull[]): MatFull | null {
    const itemMaterialId = item.materialId as number | undefined
    const itemName       = normalizeName(String(item.materialName ?? ''))
    const itemThickness  = Number(item.thickness ?? 0)
    if (itemMaterialId) {
      const byId = mats.find(m => m.id === itemMaterialId)
      if (byId) return byId
    }
    const exact = mats.find(m => normalizeName(m.name) === itemName && m.thickness === itemThickness)
    if (exact) return exact
    return mats.find(m => {
      const mn = normalizeName(m.name)
      return m.thickness === itemThickness && (itemName.includes(mn) || mn.includes(itemName))
    }) ?? null
  }

  function getItemAreaM2(item: Record<string, unknown>): number {
    const net = Number(item.totalAreaNet ?? 0)
    if (net > 0) return net
    const w   = Number(item.width ?? 0)
    const h   = Number(item.height ?? 0)
    const qty = Number(item.quantity ?? 1)
    return w * h / 1_000_000 * qty
  }

  function getItemWeightKg(item: Record<string, unknown>, areaM2: number): number {
    const tw = Number(item.totalWeight ?? 0)
    if (tw > 0) return tw
    return areaM2 * Number(item.thickness ?? 0) * 2.5
  }

  function resolveSheetVariantForMaterial(
    material: MatFull,
    variantsByMatId: Record<number, SheetVariantMin[]>,
  ): {
    sheetVariantId: number | null
    sheetWidth: number
    sheetHeight: number
    sheetFormatSource: 'variant_default' | 'variant_first_active' | 'material_fallback'
    supplierId: string | null
    supplierMaterialName: string | null
  } {
    const variants = variantsByMatId[material.id] ?? []
    const defaultVariant = variants.find(v => v.is_default && v.active)
    const firstActive    = variants.find(v => v.active)
    const chosen = defaultVariant ?? firstActive ?? null
    if (chosen) {
      return {
        sheetVariantId:       chosen.id,
        sheetWidth:           chosen.sheet_width,
        sheetHeight:          chosen.sheet_height,
        sheetFormatSource:    defaultVariant ? 'variant_default' : 'variant_first_active',
        supplierId:           chosen.supplier_id,
        supplierMaterialName: chosen.supplier_material_name,
      }
    }
    return {
      sheetVariantId:       null,
      sheetWidth:           material.sheet_width ?? 3210,
      sheetHeight:          material.sheet_height ?? 2250,
      sheetFormatSource:    'material_fallback',
      supplierId:           null,
      supplierMaterialName: material.supplier_material_name ?? null,
    }
  }

  function computeMaterialRequirement(
    selectedIds: Set<number>,
    allOrders: Order[],
    mats: MatFull[],
    variantsByMatId: Record<number, SheetVariantMin[]> = {},
  ): MatReqGroup[] {
    const groupMap = new Map<string, MatReqGroup>()

    for (const order of allOrders) {
      if (!selectedIds.has(order.id)) continue
      const orderNum = order.custom_number ?? order.client_order_number ?? `#${order.id}`

      for (const rawItem of order.items as Record<string, unknown>[]) {
        const matched       = findMatchingMaterial(rawItem, mats)
        const materialName  = String(rawItem.materialName ?? 'Неизвестный материал')
        const category      = String(rawItem.category ?? '')
        const thickness     = Number(rawItem.thickness ?? 0)
        const areaM2        = getItemAreaM2(rawItem)
        const weightKg      = getItemWeightKg(rawItem, areaM2)
        const matKey        = matched ? String(matched.id) : `${materialName}|${category}|${thickness}`

        if (!groupMap.has(matKey)) {
          const waste = matched?.waste_percent ?? (Number(rawItem.wastePercent ?? 0) || 10)
          let sheetW: number | null = null
          let sheetH: number | null = null
          let sheetVariantId: number | null = null
          let sheetFormatSource: MatReqGroup['sheetFormatSource'] = 'material_fallback'
          let supplierId: string | null = null
          let supplierMaterialName: string | null = null
          if (matched) {
            const resolved = resolveSheetVariantForMaterial(matched, variantsByMatId)
            sheetW               = resolved.sheetWidth
            sheetH               = resolved.sheetHeight
            sheetVariantId       = resolved.sheetVariantId
            sheetFormatSource    = resolved.sheetFormatSource
            supplierId           = resolved.supplierId
            supplierMaterialName = resolved.supplierMaterialName
          }
          const sheetAreaM2 = sheetW && sheetH ? sheetW * sheetH / 1_000_000 : null
          groupMap.set(matKey, {
            materialKey: matKey,
            materialName: matched ? matched.name : materialName,
            category: matched?.category ?? category,
            thickness: matched ? matched.thickness : thickness,
            sheetWidth: sheetW,
            sheetHeight: sheetH,
            wastePercent: waste,
            areaM2: 0, weightKg: 0, itemCount: 0,
            orderNums: [], orderIds: [],
            unmatched: !matched,
            costPrice: matched?.cost_price ?? null,
            requiredAreaWithWaste: 0,
            sheetAreaM2,
            sheetsCount: null,
            estimatedCost: null,
            sheetVariantId,
            sheetFormatSource,
            supplierId,
            supplierMaterialName,
          })
        }

        const g = groupMap.get(matKey)!
        g.areaM2    += areaM2
        g.weightKg  += weightKg
        g.itemCount++
        if (!g.orderIds.includes(order.id)) {
          g.orderIds.push(order.id)
          g.orderNums.push(orderNum)
        }
      }
    }

    for (const g of groupMap.values()) {
      g.requiredAreaWithWaste = g.areaM2 * (1 + g.wastePercent / 100)
      if (g.sheetAreaM2 && g.sheetAreaM2 > 0) {
        g.sheetsCount = Math.ceil(g.requiredAreaWithWaste / g.sheetAreaM2)
        if (g.costPrice != null) g.estimatedCost = g.sheetsCount * g.sheetAreaM2 * g.costPrice
      } else if (g.costPrice != null) {
        g.estimatedCost = g.areaM2 * g.costPrice
      }
    }

    return Array.from(groupMap.values()).sort((a, b) => a.materialName.localeCompare(b.materialName, 'ru'))
  }

  function buildPurchaseOrderPayload(groups: MatReqGroup[]) {
    const knownCostGroups = groups.filter(g => g.estimatedCost != null)
    const totalKnownCost  = knownCostGroups.reduce((s, g) => s + (g.estimatedCost ?? 0), 0)
    const hasPartialCost  = knownCostGroups.length < groups.length
    const allOrderRefs    = Array.from(new Set(groups.flatMap(g => g.orderNums)))

    const items = groups.map(g => ({
      material_name:          g.materialName,
      category:               g.category ?? null,
      thickness:              g.thickness,
      sheet_width:            g.sheetWidth,
      sheet_height:           g.sheetHeight,
      area_m2:                g.areaM2,
      required_area_m2:       g.requiredAreaWithWaste,
      sheets_count:           g.sheetsCount,
      weight_kg:              g.weightKg,
      estimated_cost:         g.estimatedCost,
      waste_percent:          g.wastePercent,
      order_ids:              g.orderIds,
      order_refs:             g.orderNums,
      unmatched:              g.unmatched,
      sheet_variant_id:       g.sheetVariantId,
      sheet_format_source:    g.sheetFormatSource,
      supplier_id:            g.supplierId,
      supplier_material_name: g.supplierMaterialName,
    }))

    let comment = 'Создано из ориентировочной потребности материала'
    if (hasPartialCost) comment += '. Стоимость частичная: есть материалы без цены/справочника'

    return {
      supplier_name:  'Не выбран',
      invoice_number: null,
      amount:         knownCostGroups.length > 0 ? totalKnownCost : null,
      status:         'invoice_received',
      order_refs:     allOrderRefs,
      b2b_order_ids:  [...selectedOrderIds],
      items,
      created_by:     currentUserId,
      comment,
    }
  }

  async function handleCreatePurchaseOrder(groups: MatReqGroup[]) {
    if (!window.confirm('Создать закупочную заявку для выбранных заказов?')) return
    setCreatingPurchaseOrder(true)
    try {
      const sb = createClient()
      const payload = buildPurchaseOrderPayload(groups)
      const { data, error } = await sb
        .from('purchase_orders')
        .insert(payload)
        .select('id')
        .single()
      if (error) {
        setToastError(true)
        setToastMsg(`Ошибка создания закупки: ${error.message}`)
      } else {
        setToastError(false)
        setToastMsg(`Закупочная заявка создана${data?.id ? ` (ID ${data.id})` : ''}`)
      }
    } catch {
      setToastError(true)
      setToastMsg('Ошибка создания закупки')
    } finally {
      setCreatingPurchaseOrder(false)
    }
    setTimeout(() => setToastMsg(null), 4000)
  }

  // Точный раскрой через оптимайзер для развёрнутого заказа
  const cuttingResultsMap = useMemo(() => {
    if (!expanded || materials.length === 0) return new Map<string, number>()
    const order = orders.find(o => o.id === expanded)
    if (!order) return new Map<string, number>()

    const items = order.items as Record<string, unknown>[]
    const matLookup = new Map(materials.map(m => [`${m.name}|${m.thickness}`, m]))
    const groups = new Map<string, PieceGroup>()

    for (const item of items) {
      const name = String(item.materialName ?? '')
      const t = Number(item.thickness ?? 0)
      const w = Number(item.width ?? 0)
      const h = Number(item.height ?? 0)
      const qty = Number(item.quantity ?? 0)
      if (!name || !t || !w || !h || !qty) continue
      const key = `${name}|${t}`
      const mat = matLookup.get(key)
      if (!groups.has(key)) {
        groups.set(key, {
          pieces: [],
          materialLabel: `${name} ${t} мм`,
          category: String(item.category ?? ''),
          sheetWidth:  mat?.sheet_width  ?? 3210,
          sheetHeight: mat?.sheet_height ?? 2250,
          patternDirection: 'none' as const,
        })
      }
      const g = groups.get(key)!
      for (let i = 0; i < qty; i++) {
        g.pieces.push({
          id: `${key}-${i}`,
          width: w, height: h,
          label: `${w}×${h}`,
          orderId: order.id,
          orderClientName: order.client_name,
          materialKey: key,
          canRotate: true,
        })
      }
    }

    if (groups.size === 0) return new Map<string, number>()
    const results = runCuttingOptimizer(groups, DEFAULT_CUTTING_SETTINGS)
    return new Map(results.map(r => [r.materialKey, r.sheetsNeeded]))
  }, [expanded, orders, materials])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка...</div>
  )

  if (loadError) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center px-4">
      <p className="text-[13px] text-red-600">Не удалось загрузить данные</p>
      <p className="text-[11px] text-[#9a9a95]">{loadError}</p>
      <button onClick={loadOrders} className="px-4 py-2 bg-[#111110] text-white text-[13px] rounded-lg hover:bg-[#2a2a28]">
        Повторить
      </button>
    </div>
  )

  const totalSum = orders.reduce((s, o) => s + getFinalPrice(o), 0)
  // Готовность производства: отгружен ли заказ. Не связано с тем, найден ли клиент в базе.
  const shippedCount = orders.filter(o => !!o.parsedNotes.stages?.shipped).length
  const notShippedCount = orders.length - shippedCount

  // ── Shared: expanded order body ─────────────────────────────────────────────
  function renderOrderBody(order: Order) {
    const items = order.items as Record<string, unknown>[]
    const pn = order.parsedNotes
    const quoteDate = fmtDate(order.created_at)
    const launchedDate = pn.launched_at ? fmtDate(pn.launched_at) : null
    const deadline = getDeadline(pn.launched_at, pn.production_days)
    const deadlineStr = deadline ? deadline.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null
    const daysLeft = deadline && nowTs ? Math.ceil((deadline.getTime() - nowTs) / 86400000) : null
    const isShipped = !!pn.stages?.shipped
    const finalPrice = getFinalPrice(order)
    const isPlainNotes = order.notes && !order.notes.trim().startsWith('{')
    const userNotes = typeof pn.user_notes === 'string'
      ? pn.user_notes
      : (isPlainNotes ? order.notes : null)
    const isMsgOpen = msgOpenId === order.id

    // Production summary — используем точный раскрой из оптимайзера
    const summary = computeProductionSummary(
      items.map(item => ({
        materialName: String(item.materialName ?? ''),
        thickness: Number(item.thickness ?? 0),
        totalAreaNet: Number(item.totalAreaNet ?? 0),
        totalAreaBilled: Number(item.totalAreaBilled ?? 0) || undefined,
        hasTempering: !!item.hasTempering,
        wastePercent: Number(item.wastePercent ?? 0) || undefined,
      })),
      materials,
      cuttingResultsMap,
    )

    return (
      <div className="border-t border-[#f0f0ec] px-4 py-3 space-y-3 bg-[#fafaf9]">

        {/* Счёт / КП / правка суммы (владелец) */}
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/b2b-quotes/${order.id}/invoice`} target="_blank"
            className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] transition-colors">🧾 Счёт клиенту</Link>
          <Link href={`/b2b-quotes/${order.id}/kp`} target="_blank"
            className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] transition-colors">📄 КП</Link>
          {/* А7: УПД — тот же документ, что в кабинете партнёра */}
          <Link href={`/b2b-quotes/${order.id}/upd`} target="_blank"
            className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] transition-colors">📑 УПД</Link>
          {/* А16: упаковочный лист на отгрузку */}
          <Link href={`/b2b-orders/${order.id}/packing`} target="_blank"
            className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] transition-colors">📦 Упаковочный лист</Link>
          {/* А3: повторить заказ — те же позиции новым просчётом */}
          <button onClick={() => repeatOrder(order)} disabled={repeating === order.id}
            title="Создать новый просчёт с этими же позициями"
            className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] disabled:opacity-40 transition-colors">
            {repeating === order.id ? '…' : '↻ Повторить'}
          </button>
          {isOwner && (editTotalId === order.id ? (
            <span className="flex items-center gap-1.5">
              <span className="text-[10px] text-[#9a9a95]">Новая сумма ₽:</span>
              <input autoFocus type="number" value={editTotalVal}
                onChange={e => { setEditTotalVal(e.target.value); setTotalErr(null) }}
                placeholder={String(Math.round(finalPrice))}
                className="border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] font-mono w-28 bg-white outline-none focus:border-[#111110]"
                onKeyDown={e => { if (e.key === 'Enter') saveOrderTotal(order.id, finalPrice); if (e.key === 'Escape') { setEditTotalId(null); setTotalErr(null) } }} />
              <button onClick={() => saveOrderTotal(order.id, finalPrice)} disabled={savingTotal}
                className="px-2.5 py-1 bg-[#111110] text-white text-[11px] rounded-lg hover:bg-black disabled:opacity-40">{savingTotal ? '…' : 'Пересчитать'}</button>
              <button onClick={() => { setEditTotalId(null); setEditTotalVal(''); setTotalErr(null) }} className="px-1.5 py-1 text-[11px] text-[#9a9a95] hover:text-[#111110]">Отмена</button>
              {totalErr && <span className="text-[10px] text-red-500">{totalErr}</span>}
            </span>
          ) : (
            <button onClick={() => { setEditTotalId(order.id); setEditTotalVal(''); setTotalErr(null) }}
              title="Пересчитать все позиции под новую (меньшую) сумму"
              className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] transition-colors">✎ Изменить сумму ({fmt(finalPrice)})</button>
          ))}
        </div>

        {/* А16: способ получения и статус отгрузки */}
        {(() => {
          const d = (order.parsedNotes as unknown as { delivery?: { method?: string; address?: string | null; comment?: string | null; status?: string; date?: string; by?: string } }).delivery
          const busy = deliverySaving === order.id
          const STATUS_LABEL: Record<string, string> = { packed: 'Собрана', in_transit: 'В пути', delivered: 'Вручена' }
          return (
            <div className="flex items-center gap-2 flex-wrap text-[11px]">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95]">Отгрузка</span>
              <button onClick={() => saveDelivery(order.id, { method: 'pickup' })} disabled={busy}
                className={`px-2.5 py-1 rounded-lg border transition-colors ${d?.method === 'pickup' ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110]'}`}>
                Самовывоз
              </button>
              <input
                value={deliveryAddr[order.id] ?? d?.address ?? ''}
                onChange={e => setDeliveryAddr(p => ({ ...p, [order.id]: e.target.value }))}
                placeholder="адрес доставки"
                className="border border-[#e4e4e0] rounded-lg px-2 py-1 text-[11px] bg-white outline-none focus:border-[#111110] w-56" />
              <button onClick={() => saveDelivery(order.id, { method: 'delivery', address: deliveryAddr[order.id] ?? d?.address ?? '' })} disabled={busy}
                className={`px-2.5 py-1 rounded-lg border transition-colors ${d?.method === 'delivery' ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110]'}`}>
                Доставка
              </button>
              <span className="text-[#c4c4be]">·</span>
              {(['packed', 'in_transit', 'delivered'] as const).map(st => (
                <button key={st} onClick={() => saveDelivery(order.id, { status: st })} disabled={busy}
                  title={st === 'delivered' ? 'Проставит дату отгрузки заказа' : undefined}
                  className={`px-2.5 py-1 rounded-lg border transition-colors ${d?.status === st ? 'bg-emerald-600 text-white border-emerald-600' : 'border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110]'}`}>
                  {STATUS_LABEL[st]}
                </button>
              ))}
              {d?.by && <span className="text-[10px] text-[#9a9a95]">указал: {d.by}</span>}
            </div>
          )
        })()}

        {/* Номера заказа */}
        {editNumId === order.id ? (
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-1">Наш номер</p>
              <input
                autoFocus
                className="border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[12px] font-mono text-[#111110] outline-none focus:border-[#111110] bg-white w-32"
                value={editCustomNum}
                onChange={e => setEditCustomNum(e.target.value)}
                placeholder="МГ-001"
                onKeyDown={e => { if (e.key === 'Enter') saveNum(order.id); if (e.key === 'Escape') setEditNumId(null) }}
              />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-1">№ клиента</p>
              <input
                className="border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[12px] font-mono text-[#111110] outline-none focus:border-[#111110] bg-white w-32"
                value={editClientNum}
                onChange={e => setEditClientNum(e.target.value)}
                placeholder="необязательно"
                onKeyDown={e => { if (e.key === 'Enter') saveNum(order.id); if (e.key === 'Escape') setEditNumId(null) }}
              />
            </div>
            <button
              onClick={() => saveNum(order.id)}
              disabled={savingNum}
              className="px-3 py-1.5 bg-[#111110] text-white text-[11px] font-medium rounded-lg hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
              {savingNum ? '...' : 'Сохранить'}
            </button>
            <button onClick={() => setEditNumId(null)} className="px-3 py-1.5 text-[11px] text-[#9a9a95] hover:text-[#111110] transition-colors">
              Отмена
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            {order.custom_number && (
              isOwner ? (
                <Link href={`/cfo/order-economics/${order.id}`} title="Открыть экономику заказа (себестоимость, расход, маржа)"
                  className="text-[13px] font-bold font-mono text-[#111110] underline decoration-dotted underline-offset-2 hover:text-blue-600">
                  {order.custom_number} ₽
                </Link>
              ) : (
                <span className="text-[13px] font-bold font-mono text-[#111110]">{order.custom_number}</span>
              )
            )}
            {order.client_order_number && (
              <span className="text-[11px] font-mono text-[#6b6b66] bg-[#f0f0ec] px-1.5 py-0.5 rounded">кл. {order.client_order_number}</span>
            )}
            <button
              onClick={() => startEditNum(order)}
              className="text-[11px] text-[#9a9a95] hover:text-[#111110] underline underline-offset-2 transition-colors">
              {order.custom_number ? 'Изменить номера' : '+ Добавить номер заказа'}
            </button>
            <button
              onClick={() => generateNumber(order.id)}
              disabled={generatingNum === order.id}
              className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40 transition-colors">
              {generatingNum === order.id ? '...' : '⚡ Сгенерировать номер'}
            </button>
          </div>
        )}

        {/* Этапы производства */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-1.5">Этапы производства</p>
          <div className="flex flex-wrap gap-1">
            {STAGES.map(stage => {
              const doneDate = pn.stages?.[stage.key]
              const done = !!doneDate
              return (
                <button
                  key={stage.key}
                  onClick={() => toggleStage(order.id, stage.key)}
                  title={done ? `Выполнено: ${doneDate}` : 'Нажмите чтобы отметить'}
                  className={`flex flex-col items-center px-2 py-1 rounded-md text-[10px] font-medium transition-all border select-none ${
                    done
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110] hover:text-[#111110] hover:bg-[#f8f8f7]'
                  }`}>
                  {stage.label}
                  {done && doneDate && (
                    <span className="text-[8px] font-normal opacity-60 leading-none">
                      {new Date(doneDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Статус материала */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-1.5">Материал</p>
          <div className="flex items-center gap-2 flex-wrap">
            {(() => {
              const status = (pn.material_status ?? 'not_checked') as MaterialStatus
              // Fallback: неизвестное значение не должно ронять карточку (краш 004-1)
              const meta = MATERIAL_STATUS_META[status] ?? MATERIAL_STATUS_META.not_checked
              return (
                <>
                  <span className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full border whitespace-nowrap ${meta.badge}`}>
                    {meta.label}
                  </span>
                  <select
                    value={status}
                    onChange={e => updateMaterialStatus(order.id, e.target.value as MaterialStatus)}
                    className="text-[11px] border border-[#e4e4e0] rounded-lg px-2 py-1 text-[#111110] outline-none focus:border-[#111110] bg-white cursor-pointer">
                    {(Object.entries(MATERIAL_STATUS_META) as [MaterialStatus, { label: string; badge: string }][]).map(([val, m]) => (
                      <option key={val} value={val}>{m.label}</option>
                    ))}
                  </select>
                </>
              )
            })()}
          </div>
          {pn.material_status_updated_at && (
            <p className="text-[10px] text-[#b0b0aa] mt-1">
              Обновлено: {new Date(pn.material_status_updated_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>

        {/* Быстрые действия */}
        <div className="flex gap-2">
          <a
            href={`/b2b-orders/${order.id}/production-sheet`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] hover:bg-[#f8f8f7] transition-colors"
          >
            🖨 Лист
          </a>
        </div>

        {/* Прогресс по деталям */}
        {(() => {
          const prog = getProductionProgress(order)
          const pctColor = prog.progressPct === 100
            ? 'text-emerald-600'
            : prog.progressPct >= 50
            ? 'text-blue-600'
            : prog.progressPct > 0
            ? 'text-orange-600'
            : 'text-[#9a9a95]'
          return (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95]">
                  Производство
                </p>
                <span className={`text-[11px] font-bold ${pctColor}`}>
                  {!prog.hasAnyMark ? 'не начато' : `${prog.progressPct}%`}
                </span>
              </div>
              {!prog.hasAnyMark ? (
                <p className="text-[11px] text-[#b0b0aa]">Отметок по деталям пока нет</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {prog.stages.map(s => {
                    const pct = s.total > 0 ? s.done / s.total : 0
                    const cls = pct === 1
                      ? 'bg-green-50 text-green-700 border-green-200'
                      : pct >= 0.5
                      ? 'bg-blue-50 text-blue-700 border-blue-200'
                      : pct > 0
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-[#f4f4f0] text-[#9a9a95] border-[#e4e4e0]'
                    return (
                      <span key={s.key} className={`text-[10px] font-medium px-2 py-0.5 rounded-md border whitespace-nowrap ${cls}`}>
                        {s.label} {s.done}/{s.total}
                      </span>
                    )
                  })}
                  {prog.problemCount > 0 && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-md border bg-red-50 text-red-700 border-red-200 whitespace-nowrap">
                      ⚠️ Проблема {prog.problemCount}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })()}

        {/* Даты */}
        <div className="flex gap-4 flex-wrap text-[11px]">
          <div>
            <span className="text-[#9a9a95]">Просчёт: </span>
            <span className="font-medium text-[#111110]">{quoteDate}</span>
          </div>
          {launchedDate && (
            <div>
              <span className="text-[#9a9a95]">Запуск: </span>
              <span className="font-medium text-emerald-700">{launchedDate}</span>
            </div>
          )}
          {deadlineStr && pn.production_days && (
            <div>
              <span className="text-[#9a9a95]">Срок ({pn.production_days} дн.): </span>
              <span className={`font-semibold ${daysLeft !== null && daysLeft < 0 ? 'text-red-600' : 'text-[#111110]'}`}>
                {deadlineStr}
                {daysLeft !== null && !isShipped && (
                  <span className="ml-1 font-normal text-[10px] text-[#9a9a95]">
                    {daysLeft < 0 ? `(просрочен ${Math.abs(daysLeft)} д.)` : daysLeft === 0 ? '(сегодня)' : `(${daysLeft} д.)`}
                  </span>
                )}
              </span>
            </div>
          )}
        </div>

        {/* Контроль срока убран (14.07): мешал — статус срока виден бейджем в шапке */}

        {/* Чертёж заказа (прикрепляется при запуске из просчётов или в цех-Заказах) */}
        {typeof pn.drawing_url === 'string' && pn.drawing_url && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-1.5">Чертёж</p>
            {/* bucket приватный — грузим через прокси с подписанной ссылкой, не напрямую */}
            <a href={`/api/b2b/drawing/${order.id}`} target="_blank" rel="noreferrer" className="block">
              {/\.(png|jpe?g|webp|gif)(\?|$)/i.test(pn.drawing_url)
                ? /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={`/api/b2b/drawing/${order.id}`} alt="Чертёж" className="max-h-48 rounded-lg border border-[#e4e4e0] object-contain bg-white" />
                : <span className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#e4e4e0] bg-white text-[12px] text-[#111110] hover:border-[#111110]">📐 Открыть чертёж (PDF)</span>}
            </a>
          </div>
        )}

        {/* Позиции */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-1.5">Позиции</p>
          <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
            {items.map((item, idx) => {
              const svcs = Array.isArray(item.services) ? item.services as { name: string; cost: number }[] : []
              return (
                <div key={idx} className="px-3 py-1.5 border-b border-[#f8f8f7] last:border-0 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0 min-w-0">
                      <span className="text-[#c4c4be]">#{idx + 1}</span>
                      <span className="font-medium text-[#111110]">{materialLabelShort(item as { materialName?: string; category?: string; thickness?: number })}</span>
                      <span className="text-[#6b6b66]">{String(item.width ?? '')}×{String(item.height ?? '')} мм · {String(item.quantity ?? '')} шт.</span>
                      {!!item.hasTempering && (
                        <span className="text-[9px] font-medium text-amber-700 bg-amber-50 px-1 py-px rounded">Закалка</span>
                      )}
                      {svcs.map((svc, si) => (
                        <span key={si} className="text-[9px] text-blue-700 bg-blue-50 px-1 py-px rounded">
                          {svc.name} +{Number(svc.cost).toLocaleString('ru-RU')} ₽
                        </span>
                      ))}
                    </div>
                    <div className="text-right flex-shrink-0 whitespace-nowrap">
                      <span className="font-mono font-semibold text-[#111110]">{Number(item.saleIncVat ?? 0).toLocaleString('ru-RU')} ₽</span>
                      <span className="text-[9px] text-[#9a9a95] ml-1">{Number(item.totalAreaNet ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 3 })} м²</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ПРОИЗВОДСТВЕННАЯ СВОДКА — свёрнута по умолчанию (решение владельца 14.07) */}
        <details className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden group">
          <summary className="px-3 py-1.5 bg-[#f8f8f7] border-b border-[#e4e4e0] cursor-pointer list-none flex items-center gap-1.5">
            <span className="text-[10px] text-[#9a9a95] group-open:rotate-90 transition-transform">▸</span>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95]">Производственная сводка</span>
          </summary>
          <div className="px-3 py-2 space-y-1.5 text-[11px]">
            <div className="flex justify-between">
              <span className="text-[#9a9a95]">Площадь</span>
              <span className="font-semibold text-[#111110]">{(order.total_area ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 3 })} м²</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#9a9a95]">Вес</span>
              <span className="font-semibold text-[#111110]">{(order.total_weight ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} кг</span>
            </div>
            {summary.rows.length > 0 && summary.totalSheets > 0 && (
              <>
                <div className="flex justify-between">
                  <span className="text-[#9a9a95]">Листы</span>
                  <span className="font-semibold text-[#111110]">{summary.totalSheets} шт</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#9a9a95]">Стоимость листов</span>
                  <span className="font-mono font-semibold text-[#111110]">{fmt(summary.totalSheetCost)}</span>
                </div>
                {summary.totalTemperingCost > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[#9a9a95]">Закалка</span>
                    <span className="font-mono font-semibold text-amber-700">{fmt(summary.totalTemperingCost)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-[#f0f0ec] pt-1.5">
                  <span className="text-[#6b6b66] font-medium">Себестоимость материала</span>
                  <span className="font-mono font-semibold text-[#111110]">{fmt(summary.grandTotal)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between border-t border-[#e4e4e0] pt-1.5">
              <span className="font-semibold text-[#111110]">Итого заказ</span>
              <span className="font-mono font-bold text-[#111110]">{fmt(finalPrice)}</span>
            </div>
          </div>
          {/* Материалы (разбивка) */}
          {summary.rows.length > 0 && summary.totalSheets > 0 && (
            <div className="border-t border-[#f0f0ec] px-3 py-2 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-1">Материалы</p>
              {summary.rows.map(row => (
                <div key={row.matKey} className="flex items-center justify-between text-[11px]">
                  <span className="text-[#111110] font-medium">{row.matLabel}</span>
                  <span className="text-[#6b6b66] font-mono text-[10px]">
                    {row.sheetsNeeded} л. · {row.totalAreaNet.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} м²
                  </span>
                </div>
              ))}
            </div>
          )}
        </details>

        {/* ПРОИЗВОДСТВЕННОЕ СООБЩЕНИЕ */}
        <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
          <button
            className="w-full px-3 py-2 flex items-center justify-between hover:bg-[#fafaf9] transition-colors"
            onClick={() => setMsgOpenId(isMsgOpen ? null : order.id)}>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95]">Производственное сообщение</span>
            <span className={`text-[#c4c4be] text-[10px] transition-transform ${isMsgOpen ? 'rotate-180' : ''}`}>▼</span>
          </button>
          {isMsgOpen && (() => {
            const msg = buildProductionMessage(order)
            return (
              <div className="border-t border-[#f0f0ec] px-3 py-2.5 space-y-2">
                <pre className="text-[12px] font-mono leading-relaxed whitespace-pre-wrap text-[#111110] bg-[#f8f8f7] rounded-lg px-3 py-2.5 border border-[#e8e8e4] select-all">
                  {msg}
                </pre>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(msg)
                      setCopiedMsg(true)
                      setTimeout(() => setCopiedMsg(false), 2000)
                    }}
                    className="flex-1 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] transition-colors">
                    {copiedMsg ? '✓ Скопировано' : '📋 Копировать'}
                  </button>
                  <button
                    onClick={() => {
                      const tg = `https://t.me/share/url?url=${encodeURIComponent('MGlass')}&text=${encodeURIComponent(msg)}`
                      navigator.clipboard?.writeText(msg).catch(() => {})
                      window.open(tg, '_blank')
                    }}
                    title="Открыть Telegram с готовым текстом заказа (текст также скопирован)"
                    className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-sky-200 text-sky-700 hover:bg-sky-50 transition-colors">
                    ✈ TG
                  </button>
                </div>
              </div>
            )
          })()}
        </div>

        {userNotes && (
          <p className="text-[11px] text-[#6b6b66] italic">{userNotes}</p>
        )}

        {Array.isArray(pn.bulk_actions) && pn.bulk_actions.length > 0 && (() => {
          const last = pn.bulk_actions[pn.bulk_actions.length - 1]
          return (
            <p className="text-[10px] text-[#b0b0aa]">
              Массово отгружен: {new Date(last.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })} · {formatMonthKey(last.month_key)} · {last.created_by}
            </p>
          )
        })()}
      </div>
    )
  }

  return (
    <div className="max-w-[1100px] mx-auto px-4 py-5">

      {/* Шапка */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-[18px] font-semibold text-[#111110] tracking-tight">B2B Заказы</h1>
          <p className="text-[12px] text-[#8a8a85] mt-0.5">
            {orders.length} заказов · {totalSum.toLocaleString('ru-RU')} ₽
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-medium" title="Готовность производства: отгружено / в работе">
          <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {shippedCount} отгружено
          </span>
          <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 text-red-600">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            {notShippedCount} в работе
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { const next = !productionDayMode; setProductionDayMode(next); if (!next) setShowOnlyNeedsControl(false) }}
            className={`text-[12px] font-medium px-3 py-1.5 rounded-lg border transition-colors ${
              productionDayMode
                ? 'bg-amber-600 text-white border-amber-600 hover:bg-amber-700'
                : 'border-[#e4e4e0] text-[#6b6b66] hover:border-amber-500 hover:text-amber-700'
            }`}>
            🏭 Производственный день
          </button>
          <button
            disabled={selectedOrderIds.size === 0}
            onClick={() => setShowMaterialReq(true)}
            className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            📦 Материал{selectedOrderIds.size > 0 ? ` (${selectedOrderIds.size})` : ''}
          </button>
          <button
            disabled={selectedOrderIds.size === 0}
            onClick={() => window.open(`/b2b-orders/invoice?ids=${[...selectedOrderIds].join(',')}`, '_blank')}
            className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Один счёт на выделенные заказы; плательщика выберете на странице счёта">
            🧾 Единый счёт{selectedOrderIds.size > 0 ? ` (${selectedOrderIds.size})` : ''}
          </button>
          <Link href="/calculator/b2b"
            className="bg-[#111110] text-white text-[12px] font-medium px-3 py-1.5 rounded-lg hover:bg-[#2a2a28] transition-colors">
            + Новый просчёт
          </Link>
        </div>
      </div>

      {/* Производственное табло */}
      <ProductionBoard
        orders={orders}
        activeFilter={boardFilter}
        onFilterChange={f => setBoardFilter(f)}
      />

      {/* Индикатор активного фильтра табло */}
      {boardFilter !== null && (
        <div className="flex items-center gap-2 mb-2 px-0.5">
          <span className="text-[11px] text-[#6b6b66]">
            Производство:
            <span className="font-semibold text-[#111110] ml-1">{BOARD_FILTER_LABELS[boardFilter]}</span>
          </span>
          <button
            onClick={() => setBoardFilter(null)}
            className="text-[11px] text-[#9a9a95] hover:text-red-600 transition-colors px-1.5 py-0.5 rounded hover:bg-red-50">
            × Сбросить
          </button>
        </div>
      )}

      {/* Панель фильтров */}
      <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3 mb-3 space-y-2.5">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[160px]">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#b4b4ae]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"/>
            </svg>
            <input
              type="text"
              placeholder="Номер заказа или клиент…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-[#e4e4e0] rounded-lg outline-none focus:border-[#111110] text-[#111110] placeholder:text-[#b4b4ae]"
            />
          </div>
          <div className="flex items-center gap-1.5 text-[12px] text-[#8a8a85]">
            <span>с</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] text-[#111110] outline-none focus:border-[#111110]"/>
            <span>по</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] text-[#111110] outline-none focus:border-[#111110]"/>
          </div>
          {isFiltered && (
            <button
              onClick={() => { setSearch(''); setStageFilter('all_active'); setDateFrom(''); setDateTo(''); setDeadlineFilter('all'); setBoardFilter(null) }}
              className="text-[11px] text-[#8a8a85] hover:text-[#111110] px-2 py-1.5 rounded-lg hover:bg-[#f0f0ec] transition-colors whitespace-nowrap">
              Сбросить
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {STAGE_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setStageFilter(f.key)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all border select-none ${
                stageFilter === f.key
                  ? 'bg-[#111110] text-white border-[#111110]'
                  : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110] hover:text-[#111110]'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 items-center border-t border-[#f4f4f0] pt-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[#b0b0aa] mr-1">Срок:</span>
          {DEADLINE_FILTER_OPTIONS.map(f => (
            <button
              key={f.key}
              onClick={() => setDeadlineFilter(f.key)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all border select-none ${
                deadlineFilter === f.key
                  ? 'bg-[#111110] text-white border-[#111110]'
                  : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110] hover:text-[#111110]'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Результат */}
      {productionDayMode ? (() => {
        const groups = productionDayGroups
        const totalCritical = groups.overdue.length + groups.today.length + groups.tomorrow.length + groups.ready.length
        const needsControlCount =
          groups.overdue.filter(requiresDeadlineControl).length +
          groups.today.filter(requiresDeadlineControl).length +
          groups.tomorrow.filter(requiresDeadlineControl).length
        const displayGroups = showOnlyNeedsControl
          ? {
              overdue:  groups.overdue.filter(requiresDeadlineControl),
              today:    groups.today.filter(requiresDeadlineControl),
              tomorrow: groups.tomorrow.filter(requiresDeadlineControl),
              ready:    [] as Order[],
            }
          : groups
        const sections = [
          { emoji: '🔥', label: 'Просрочено',        key: 'overdue',   orders: displayGroups.overdue,   color: 'text-red-600',     hdr: 'bg-red-50/50' },
          { emoji: '🟠', label: 'Срок сегодня',      key: 'today',     orders: displayGroups.today,     color: 'text-amber-700',   hdr: 'bg-amber-50/50' },
          { emoji: '🟡', label: 'Срок завтра',       key: 'tomorrow',  orders: displayGroups.tomorrow,  color: 'text-yellow-700',  hdr: 'bg-yellow-50/50' },
          { emoji: '✅', label: 'Готово / упаковано', key: 'ready',     orders: displayGroups.ready,     color: 'text-emerald-700', hdr: 'bg-emerald-50/50' },
        ] as const
        if (totalCritical === 0) {
          return (
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-12 text-center">
              <p className="text-[15px] font-medium text-emerald-700">✅ На сегодня критичных B2B-заказов нет</p>
            </div>
          )
        }
        if (showOnlyNeedsControl && needsControlCount === 0) {
          return (
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-10 text-center">
              <p className="text-[14px] font-medium text-emerald-700">✅ Все срочные заказы уже взяты в контроль</p>
            </div>
          )
        }
        return (
          <div className="space-y-3">
            {/* Сводка */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-2.5 flex flex-wrap gap-5 text-[12px] items-center">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-[#b0b0aa]">Сегодня</span>
              <span><span className="text-[#9a9a95]">Просрочено:</span><span className="font-bold text-red-600 ml-1">{groups.overdue.length}</span></span>
              <span><span className="text-[#9a9a95]">Сегодня:</span><span className="font-bold text-amber-700 ml-1">{groups.today.length}</span></span>
              <span><span className="text-[#9a9a95]">Завтра:</span><span className="font-bold text-yellow-700 ml-1">{groups.tomorrow.length}</span></span>
              <span><span className="text-[#9a9a95]">Готово:</span><span className="font-bold text-emerald-700 ml-1">{groups.ready.length}</span></span>
              <span>
                <span className="text-[#9a9a95]">Требуют контроля:</span>
                <span className={`font-bold ml-1 ${needsControlCount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{needsControlCount}</span>
              </span>
              <button
                onClick={() => setShowOnlyNeedsControl(v => !v)}
                className={`ml-auto text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-colors ${
                  showOnlyNeedsControl
                    ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                    : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-red-400 hover:text-red-600'
                }`}>
                ⚠️ Требуют контроля
              </button>
            </div>
            {/* Группы */}
            {(() => {
              function renderPdRow(order: Order) {
                const pn = order.parsedNotes
                const isOpen = expanded === order.id
                const finalPrice = getFinalPrice(order)
                const progress = calcProgress(pn.stages ?? {})
                const ds = getDeadlineStatus(order)
                const payStatus = getOrderPayStatus(order)
                const dc = pn.deadline_control
                return (
                  <div key={order.id}>
                    <div
                      className="px-4 py-2.5 flex items-start justify-between gap-3 hover:bg-[#fafaf9] transition-colors cursor-pointer"
                      onClick={() => setExpanded(isOpen ? null : order.id)}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[13px] font-bold font-mono text-[#111110] bg-[#f0f0ec] px-2 py-px rounded flex-shrink-0">
                            {order.custom_number?.trim() || `00${order.id}`}
                          </span>
                          {order.client_order_number && (
                            <span className="text-[10px] font-mono text-[#6b6b66] bg-[#f8f8f5] border border-[#e4e4e0] px-1.5 py-px rounded flex-shrink-0">
                              кл.{order.client_order_number}
                            </span>
                          )}
                          <span className="text-[13px] font-semibold text-[#111110]">{order.client_name}</span>
                          <span className={`text-[10px] font-medium px-1.5 py-px rounded-full ${DEADLINE_BADGE[ds.status]}`}>
                            {ds.label}
                          </span>
                          {(dc?.next_action || dc?.reason) && (
                            <span className="text-[9px] font-medium px-1.5 py-px rounded-full bg-[#f0f0ec] text-[#6b6b66] flex-shrink-0">📝 Контроль</span>
                          )}
                          {(() => { const pb = PAY_BADGE[payStatus]; return pb ? (
                            <span className={`text-[9px] font-medium px-1.5 py-px rounded-full flex-shrink-0 ${pb.cls}`}>{pb.label}</span>
                          ) : null })()}
                          {requiresDeadlineControl(order) && (
                            <>
                              <span className="text-[9px] font-medium px-1.5 py-px rounded-full bg-red-50 text-red-600 border border-red-100 flex-shrink-0">⚠️ Нет контроля</span>
                              <button
                                onClick={e => { e.stopPropagation(); quickPatchDc(order.id, { next_check_date: tomorrowDateStr() }) }}
                                disabled={dcSaving === order.id}
                                className="text-[9px] font-medium px-1.5 py-px rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex-shrink-0 hover:bg-amber-100 transition-colors disabled:opacity-50">
                                {dcSaving === order.id ? '...' : '📅 завтра'}
                              </button>
                            </>
                          )}
                        </div>
                        {dc && (dc.next_action || dc.responsible || dc.next_check_date) && (
                          <div className="mt-1 text-[10px] text-[#6b6b66] flex flex-wrap gap-x-3 gap-y-0.5">
                            {dc.next_action && <span>→ {dc.next_action}</span>}
                            {dc.responsible && <span className="font-medium text-[#111110]">{dc.responsible}</span>}
                            {dc.next_check_date && (
                              <span>📅 {new Date(dc.next_check_date + 'T00:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {!pn.stages?.shipped && progress > 0 && (
                          <span className={`text-[11px] font-semibold tabular-nums ${progress === 100 ? 'text-emerald-600' : 'text-[#9a9a95]'}`}>
                            {progress}%
                          </span>
                        )}
                        <span className="text-[12px] font-semibold font-mono text-[#111110]">{fmt(finalPrice)}</span>
                        <svg className={`w-3 h-3 text-[#c4c4be] flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                    {isOpen && renderOrderBody(order)}
                  </div>
                )
              }
              return sections.map(sec => (
                <div key={sec.key} className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
                  <div className={`px-4 py-2 flex items-center gap-1.5 border-b border-[#f0f0ec] ${sec.hdr}`}>
                    <span className="text-[13px] font-bold text-[#111110]">{sec.emoji} {sec.label} —</span>
                    <span className={`text-[13px] font-bold ${sec.color}`}>{sec.orders.length}</span>
                  </div>
                  {sec.orders.length === 0 ? (
                    <p className="px-4 py-3 text-[12px] text-[#b0b0aa]">Нет заказов</p>
                  ) : sec.key === 'overdue' ? (
                    (() => {
                      const byMonth = new Map<string, Order[]>()
                      for (const o of sec.orders) {
                        const mk = getOrderMonthKey(o)
                        const existing = byMonth.get(mk)
                        if (existing) existing.push(o)
                        else byMonth.set(mk, [o])
                      }
                      const sortedMonths = [...byMonth.keys()].sort((a, b) => b.localeCompare(a))
                      return (
                        <div className="divide-y divide-[#f0f0ec]">
                          {sortedMonths.map(monthKey => {
                            const monthOrders = byMonth.get(monthKey)!
                            const monthLabel = formatMonthKey(monthKey)
                            const isBulkLoading = bulkActionLoading === monthKey
                            return (
                              <div key={monthKey}>
                                <div className="px-4 py-2 bg-red-50/40 flex items-center gap-2">
                                  <span className="text-[11px] font-semibold text-red-700">{monthLabel}</span>
                                  <span className="text-[11px] text-red-400">— {monthOrders.length} зак.</span>
                                  <button
                                    onClick={() => {
                                      if (isBulkLoading) return
                                      const confirmed = window.confirm(
                                        `Вы точно хотите отметить все просроченные заказы за ${monthLabel} как отгруженные?\nБудет изменено: ${monthOrders.length} заказов.\nДействие будет записано в историю notes.bulk_actions.`
                                      )
                                      if (!confirmed) return
                                      bulkMarkMonthAsShipped(monthKey, monthOrders)
                                    }}
                                    disabled={isBulkLoading}
                                    className="ml-auto text-[10px] font-medium px-2.5 py-1 rounded-lg border border-red-200 text-red-700 bg-white hover:bg-red-50 transition-colors disabled:opacity-50">
                                    {isBulkLoading ? 'Обновляем...' : 'Отметить месяц отгруженным'}
                                  </button>
                                </div>
                                <div className="divide-y divide-[#f8f8f7]">
                                  {monthOrders.map(renderPdRow)}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()
                  ) : (
                    <div className="divide-y divide-[#f8f8f7]">
                      {sec.orders.map(renderPdRow)}
                    </div>
                  )}
                </div>
              ))
            })()}
          </div>
        )
      })() : isFiltered ? (
        <div>
          <p className="text-[11px] text-[#8a8a85] mb-2 px-1">
            {filteredOrders.length === 0 ? 'Заказов не найдено' : `Найдено: ${filteredOrders.length} заказов`}
          </p>
          {filteredOrders.length === 0 ? (
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-10 text-center text-[13px] text-[#8a8a85]">
              {boardFilter !== null            ? `Нет заказов в категории "${BOARD_FILTER_LABELS[boardFilter]}"` :
               deadlineFilter === 'overdue'  ? 'Просроченных заказов нет' :
               deadlineFilter === 'today'    ? 'Заказов со сроком сегодня нет' :
               deadlineFilter === 'tomorrow' ? 'Заказов со сроком завтра нет' :
               deadlineFilter === 'normal'   ? 'Заказов в нормальном сроке нет' :
               deadlineFilter === 'ready'    ? 'Готовых заказов нет' :
               deadlineFilter === 'shipped'  ? 'Отгруженных заказов нет' :
               deadlineFilter === 'unknown'  ? 'Заказов без определённого срока нет' :
               'Нет заказов по выбранным фильтрам'}
            </div>
          ) : (
            <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden divide-y divide-[#f8f8f7]">
              {filteredOrders.map(order => {
                const pn = order.parsedNotes
                const isShipped = !!pn.stages?.shipped
                const finalPrice = getFinalPrice(order)
                const progress = calcProgress(pn.stages ?? {})
                const launchedDate = pn.launched_at ? fmtDate(pn.launched_at) : fmtDate(order.created_at)
                const ds = getDeadlineStatus(order)
                const payStatus = getOrderPayStatus(order)
                const isOpen = expanded === order.id

                return (
                  <div key={order.id} className={`border-l-4 ${isShipped ? 'border-l-emerald-500' : 'border-l-red-400'}`}>
                    <div className="px-4 py-2.5 cursor-pointer hover:bg-[#fafaf9] transition-colors"
                      onClick={() => setExpanded(isOpen ? null : order.id)}>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <input
                          type="checkbox"
                          checked={selectedOrderIds.has(order.id)}
                          onChange={() => toggleOrderSelection(order.id)}
                          onClick={e => e.stopPropagation()}
                          className="flex-shrink-0 cursor-pointer accent-[#111110] w-3.5 h-3.5 mt-[3px]"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {isOwner ? (
                              <Link href={`/cfo/order-economics/${order.id}`} onClick={e => e.stopPropagation()}
                                title="Экономика заказа: себестоимость, расход, маржа"
                                className="text-[13px] font-bold text-[#111110] bg-[#f0f0ec] px-2 py-px rounded font-mono flex-shrink-0 hover:bg-blue-50 hover:text-blue-700 transition-colors">
                                {order.custom_number?.trim() || `00${order.id}`} ₽
                              </Link>
                            ) : (
                              <span className="text-[13px] font-bold text-[#111110] bg-[#f0f0ec] px-2 py-px rounded font-mono flex-shrink-0">
                                {order.custom_number?.trim() || `00${order.id}`}
                              </span>
                            )}
                            {order.client_order_number && (
                              <span className="text-[10px] text-[#6b6b66] bg-[#f8f8f5] border border-[#e4e4e0] px-1.5 py-px rounded font-mono flex-shrink-0">
                                кл.{order.client_order_number}
                              </span>
                            )}
                            <span className="text-[13px] font-semibold text-[#111110] truncate">{order.client_name}</span>
                            {ds.status !== 'normal' && ds.status !== 'unknown' && (
                              <span className={`text-[10px] font-medium px-1.5 py-px rounded-full flex-shrink-0 ${DEADLINE_BADGE[ds.status]}`}>
                                {ds.label}
                              </span>
                            )}
                            {(pn.deadline_control?.next_action || pn.deadline_control?.reason) && (
                              <span className="text-[9px] font-medium px-1.5 py-px rounded-full bg-[#f0f0ec] text-[#6b6b66] flex-shrink-0">📝 Контроль</span>
                            )}
                            {(() => { const pb = PAY_BADGE[payStatus]; return pb ? (
                              <span className={`text-[9px] font-medium px-1.5 py-px rounded-full flex-shrink-0 ${pb.cls}`}>{pb.label}</span>
                            ) : null })()}
                          </div>
                          <p className="text-[11px] text-[#9a9a95] mt-0.5">
                            {launchedDate}
                            {' · '}{order.items.length} поз.
                            {(order.total_area ?? 0) > 0 && ` · ${order.total_area.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} м²`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {!isShipped && progress > 0 && (
                          <span className={`text-[11px] font-semibold tabular-nums ${progress === 100 ? 'text-emerald-600' : 'text-[#9a9a95]'}`}>
                            {progress}%
                          </span>
                        )}
                        <span className="text-[13px] font-semibold text-[#111110] font-mono">{fmt(finalPrice)}</span>
                        {canDelete && (
                          <button
                            onClick={e => { e.stopPropagation(); setDeletingId(order.id) }}
                            title="Удалить заказ"
                            className="p-1 rounded text-[#d4d4ce] hover:text-red-500 hover:bg-red-50 transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                        <svg className={`w-3 h-3 text-[#c4c4be] flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {STAGES.map(stage => {
                        const doneDate = pn.stages?.[stage.key]
                        const done = !!doneDate
                        return (
                          <button
                            key={stage.key}
                            onClick={e => { e.stopPropagation(); toggleStage(order.id, stage.key) }}
                            title={done ? `Выполнено: ${doneDate}` : 'Отметить'}
                            className={`flex flex-col items-center px-2 py-0.5 rounded text-[10px] font-medium transition-all border select-none ${
                              done
                                ? 'bg-emerald-600 text-white border-emerald-600'
                                : 'bg-white text-[#9a9a95] border-[#e4e4e0] hover:border-[#111110] hover:text-[#111110]'
                            }`}>
                            {stage.label}
                            {done && doneDate && (
                              <span className="text-[8px] font-normal opacity-60 leading-none">
                                {new Date(doneDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                    </div>
                    {isOpen && renderOrderBody(order)}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        monthGroups.length === 0 ? (
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-10 text-center text-[13px] text-[#8a8a85]">
            Заказов пока нет
          </div>
        ) : (
          <div className="space-y-2">
            {yearGroups.map(yg => {
              const yearOpen = expandedYears.has(yg.year)
              return (
                <div key={yg.year} className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
                  <button
                    className="w-full px-4 py-3 flex items-center justify-between transition-colors text-left bg-[#fafaf9] hover:bg-[#f0f0ec]"
                    onClick={() => toggleYear(yg.year)}>
                    <div className="flex items-center gap-2">
                      <h2 className="text-[15px] font-bold text-[#111110]">{yg.year === 0 ? 'Без даты запуска' : `${yg.year} год`}</h2>
                      <span className="text-[11px] text-[#9a9a95]">{yg.count} заказов · {yg.months.length} мес.</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[13px] font-semibold font-mono text-[#111110]">{yg.total.toLocaleString('ru-RU')} ₽</span>
                      <svg className={`w-4 h-4 transition-transform flex-shrink-0 text-[#c4c4be] ${yearOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                  {yearOpen && (
                    <div className="border-t border-[#f0f0ec] p-2 space-y-2">
                      {yg.months.map(group => {
              const isMonthOpen = expandedMonths.has(group.key)
              return (
                <div key={group.key} className={`bg-white border rounded-xl overflow-hidden ${group.noLaunch ? 'border-amber-300' : 'border-[#e4e4e0]'}`}>
                  <button
                    className={`w-full px-4 py-2.5 flex items-center justify-between transition-colors text-left ${group.noLaunch ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-[#fafaf9]'}`}
                    onClick={() => toggleMonth(group.key)}>
                    <div className="flex items-center gap-2">
                      <h2 className={`text-[13px] font-bold ${group.noLaunch ? 'text-amber-800' : 'text-[#111110]'}`}>{group.label}</h2>
                      <span className={`text-[11px] ${group.noLaunch ? 'text-amber-700' : 'text-[#9a9a95]'}`}>{group.orders.length} заказов</span>
                      {group.noLaunch && (
                        <span className="text-[10px] font-medium text-amber-700">— нужно проставить дату запуска</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-[13px] font-semibold font-mono ${group.noLaunch ? 'text-amber-800' : 'text-[#111110]'}`}>
                        {group.total.toLocaleString('ru-RU')} ₽
                      </span>
                      <svg className={`w-3.5 h-3.5 transition-transform flex-shrink-0 ${group.noLaunch ? 'text-amber-600' : 'text-[#c4c4be]'} ${isMonthOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>

                  {isMonthOpen && (
                    <div className="border-t border-[#f0f0ec] divide-y divide-[#f8f8f7]">
                      {group.orders.map((order, orderIdx) => {
                        const isOpen = expanded === order.id
                        const pn = order.parsedNotes
                        const quoteDate = fmtDate(order.created_at)
                        const launchIso = effectiveLaunchDate(order)
                        const launchedDate = launchIso ? fmtDate(launchIso) : null
                        const createdByName = getCreatedByName(order)
                        const launchedByName = getLaunchedByName(order)
                        const isShipped = !!pn.stages?.shipped
                        const ds = getDeadlineStatus(order)
                        const payStatus = getOrderPayStatus(order)
                        const finalPrice = getFinalPrice(order)
                        const lastDoneIdx = STAGES.map((s, i) => pn.stages?.[s.key] ? i : -1).reduce((max, i) => Math.max(max, i), -1)
                        const progress = calcProgress(pn.stages ?? {})

                        return (
                          <div key={order.id} className={`border-l-4 ${isShipped ? 'border-l-emerald-500' : 'border-l-red-400'}`}>
                            <div
                              className="w-full px-4 py-2 flex items-center justify-between gap-3 hover:bg-[#fafaf9] transition-colors cursor-pointer"
                              onClick={() => setExpanded(isOpen ? null : order.id)}>
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span onClick={e => e.stopPropagation()} className="flex-shrink-0 flex items-center">
                                  <input
                                    type="checkbox"
                                    checked={selectedOrderIds.has(order.id)}
                                    onChange={() => toggleOrderSelection(order.id)}
                                    className="cursor-pointer accent-[#111110] w-3.5 h-3.5"
                                  />
                                </span>
                                <span className="text-[10px] font-bold text-[#d4d4ce] flex-shrink-0 w-4 text-right">{orderIdx + 1}</span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {isOwner ? (
                                      <Link href={`/cfo/order-economics/${order.id}`} onClick={e => e.stopPropagation()}
                                        title="Экономика заказа: себестоимость, расход, маржа"
                                        className="text-[15px] font-bold font-mono text-[#111110] bg-[#f0f0ec] px-2 py-0.5 rounded flex-shrink-0 hover:bg-blue-50 hover:text-blue-700 transition-colors">
                                        {order.custom_number?.trim() || `00${order.id}`} ₽
                                      </Link>
                                    ) : (
                                      <span className="text-[15px] font-bold font-mono text-[#111110] bg-[#f0f0ec] px-2 py-0.5 rounded flex-shrink-0">
                                        {order.custom_number?.trim() || `00${order.id}`}
                                      </span>
                                    )}
                                    {order.client_order_number && (
                                      <span className="text-[10px] font-mono text-[#6b6b66] bg-[#f8f8f5] border border-[#e4e4e0] px-1.5 py-px rounded flex-shrink-0">
                                        кл.{order.client_order_number}
                                      </span>
                                    )}
                                    <p className="text-[14px] font-bold text-[#111110]">{order.client_name}</p>
                                    {ds.status !== 'normal' && ds.status !== 'unknown' && (
                                      <span className={`text-[10px] font-medium px-1.5 py-px rounded-full ${DEADLINE_BADGE[ds.status]}`}>
                                        {ds.label}
                                      </span>
                                    )}
                                    {(pn.deadline_control?.next_action || pn.deadline_control?.reason) && (
                                      <span className="text-[9px] font-medium px-1.5 py-px rounded-full bg-[#f0f0ec] text-[#6b6b66]">📝 Контроль</span>
                                    )}
                                    {(() => { const pb = PAY_BADGE[payStatus]; return pb ? (
                                      <span className={`text-[9px] font-medium px-1.5 py-px rounded-full flex-shrink-0 ${pb.cls}`}>{pb.label}</span>
                                    ) : null })()}
                                    {lastDoneIdx >= 0 && !isShipped && (
                                      <span className="text-[10px] text-[#9a9a95]">· {STAGES[lastDoneIdx].label}</span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-[#9a9a95] flex flex-wrap items-center gap-x-2">
                                    <span>#{order.id}</span>
                                    <span>создан {quoteDate}</span>
                                    {launchedDate
                                      ? <span>· запуск {launchedDate}</span>
                                      : <span className="text-amber-600 font-medium">· запуск: не запущен</span>}
                                    <span>· {(order.items as unknown[]).length} поз.</span>
                                    <span>· Просчитал: <span className="text-[#6b6b66] font-medium">{createdByName ?? '—'}</span></span>
                                    <span>· Запустил: <span className="text-[#6b6b66] font-medium">{launchedByName ?? '—'}</span></span>
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {!isShipped && progress > 0 && (
                                  <span className={`text-[11px] font-semibold tabular-nums ${progress === 100 ? 'text-emerald-600' : 'text-[#9a9a95]'}`}>
                                    {progress}%
                                  </span>
                                )}
                                <div className="text-right">
                                  <p className="text-[13px] font-semibold text-[#111110]">{fmt(finalPrice)}</p>
                                  {(order.discount_percent ?? 0) > 0 && (
                                    <p className="text-[10px] text-emerald-600">−{order.discount_percent}%</p>
                                  )}
                                </div>
                                {canDelete && (
                                  <button
                                    onClick={e => { e.stopPropagation(); setDeletingId(order.id) }}
                                    title="Удалить заказ"
                                    className="p-1 rounded text-[#d4d4ce] hover:text-red-500 hover:bg-red-50 transition-colors">
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                )}
                                <svg className={`w-3 h-3 text-[#c4c4be] flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                                </svg>
                              </div>
                            </div>

                            {isOpen && renderOrderBody(order)}
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
                </div>
              )
            })}
          </div>
        )
      )}

      {/* Material Requirement Modal */}
      {showMaterialReq && (() => {
        const groups    = computeMaterialRequirement(selectedOrderIds, orders, materials, variantsByMaterialId)
        const totalArea = groups.reduce((s, g) => s + g.areaM2, 0)
        const totalWeight = groups.reduce((s, g) => s + g.weightKg, 0)
        const totalCost = groups.reduce((s, g) => s + (g.estimatedCost ?? 0), 0)
        const hasCost   = groups.some(g => g.estimatedCost != null)
        return (
          <div
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setShowMaterialReq(false)}>
            <div
              className="bg-white rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
              onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div className="px-5 py-4 border-b border-[#e4e4e0] flex items-center justify-between flex-shrink-0">
                <div>
                  <h2 className="text-[16px] font-semibold text-[#111110]">Ориентировочная потребность материала</h2>
                  <p className="text-[12px] text-[#9a9a95] mt-0.5">Выбрано заказов: {selectedOrderIds.size}</p>
                </div>
                <button onClick={() => setShowMaterialReq(false)} className="text-[#c4c4be] hover:text-[#111110] text-[20px] leading-none px-1">✕</button>
              </div>

              {groups.length === 0 ? (
                <div className="p-10 text-center text-[13px] text-[#9a9a95]">В выбранных заказах нет позиций</div>
              ) : (
                <>
                  {/* Totals */}
                  <div className="px-5 py-3 bg-[#fafaf9] border-b border-[#e4e4e0] flex flex-wrap gap-6 flex-shrink-0 text-[12px]">
                    <div>
                      <span className="text-[#9a9a95]">Всего м²: </span>
                      <span className="font-semibold">{totalArea.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</span>
                    </div>
                    <div>
                      <span className="text-[#9a9a95]">Всего кг: </span>
                      <span className="font-semibold">{totalWeight.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}</span>
                    </div>
                    {hasCost && (
                      <div>
                        <span className="text-[#9a9a95]">Ориент. стоимость: </span>
                        <span className="font-semibold text-[#111110]">{totalCost.toLocaleString('ru-RU')} ₽</span>
                      </div>
                    )}
                    <div>
                      <span className="text-[#9a9a95]">Групп материалов: </span>
                      <span className="font-semibold">{groups.length}</span>
                    </div>
                  </div>

                  {/* Warning */}
                  <div className="mx-5 mt-3 mb-1 flex-shrink-0 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800 flex items-start gap-2">
                    <span className="flex-shrink-0 mt-0.5">⚠</span>
                    <span>Расчёт ориентировочный: листы считаются по площади с учётом отхода, без точной раскладки деталей на листе. Стоимость считается по целым листам — для маленьких заказов может отображаться минимум 1 лист. Для точного раскроя используйте раздел <b>B2B Раскрой</b>.</span>
                  </div>

                  {/* Table */}
                  <div className="overflow-auto flex-1">
                    <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead className="bg-[#fafaf9] border-b border-[#e4e4e0] sticky top-0 z-10">
                        <tr>
                          <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Материал</th>
                          <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Толщина</th>
                          <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Формат листа</th>
                          <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">м² деталей</th>
                          <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Отход %</th>
                          <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Листов к закупке</th>
                          <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Вес кг</th>
                          <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Стоимость листов</th>
                          <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Заказы</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#f4f4f0]">
                        {groups.map(g => (
                          <tr key={g.materialKey} className={`hover:bg-[#fafaf9] ${g.unmatched ? 'bg-amber-50/30' : ''}`}>
                            <td className="px-3 py-2.5 min-w-[160px]">
                              <p className="font-medium text-[#111110]">{g.materialName}</p>
                              {g.category && <p className="text-[10px] text-[#9a9a95]">{g.category}</p>}
                              {g.unmatched && (
                                <p className="text-[10px] text-amber-700 mt-0.5">⚠ Не найден в справочнике</p>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-[#6b6b66] whitespace-nowrap">{g.thickness} мм</td>
                            <td className="px-3 py-2.5 text-right font-mono text-[11px] text-[#6b6b66] whitespace-nowrap">
                              {g.sheetWidth && g.sheetHeight ? (
                                <span>
                                  {g.sheetWidth}×{g.sheetHeight}
                                  {g.sheetFormatSource === 'material_fallback' && (
                                    <span className="ml-1 text-[9px] text-amber-600 font-normal">базовый</span>
                                  )}
                                </span>
                              ) : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono font-semibold text-[#111110]">
                              {g.areaM2.toLocaleString('ru-RU', { maximumFractionDigits: 3 })}
                            </td>
                            <td className="px-3 py-2.5 text-right text-[#6b6b66]">{g.wastePercent}%</td>
                            <td className="px-3 py-2.5 text-right font-mono font-semibold text-[#111110]">
                              {g.sheetsCount != null ? g.sheetsCount : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-[#6b6b66]">
                              {g.weightKg.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap">
                              {g.estimatedCost != null
                                ? <span className="font-semibold text-[#111110]">{g.estimatedCost.toLocaleString('ru-RU')} ₽</span>
                                : <span className="text-[#c4c4be]">—</span>}
                            </td>
                            <td className="px-3 py-2.5 min-w-[120px]">
                              <div className="flex flex-wrap gap-1">
                                {g.orderNums.map((n, i) => (
                                  <span key={i} className="text-[10px] font-mono bg-[#f0f0ec] px-1.5 py-px rounded whitespace-nowrap">{n}</span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="px-5 py-3 border-t border-[#e4e4e0] flex items-center justify-between flex-shrink-0">
                    <button
                      onClick={() => setShowMaterialReq(false)}
                      className="text-[12px] text-[#9a9a95] hover:text-[#111110] transition-colors px-3 py-1.5">
                      Закрыть
                    </button>
                    <button
                      onClick={() => handleCreatePurchaseOrder(groups)}
                      disabled={creatingPurchaseOrder || groups.length === 0 || selectedOrderIds.size === 0}
                      className="text-[12px] font-medium px-4 py-2 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      {creatingPurchaseOrder ? 'Создаём...' : '📋 Передать в закупку'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )
      })()}

      {/* Toast */}
      {toastMsg && (
        <div className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-lg text-[12px] font-medium text-white transition-all ${toastError ? 'bg-red-600' : 'bg-[#111110]'}`}>
          {toastMsg}
        </div>
      )}

      {/* Диалог архивирования */}
      {deletingId !== null && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h2 className="text-[16px] font-semibold text-[#111110] mb-1">Архивировать заказ?</h2>
            <p className="text-[13px] text-[#6b6b66] mb-5">Заказ будет скрыт из списка. Данные сохранятся в базе.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeletingId(null)}
                className="flex-1 py-2.5 rounded-lg border border-[#e4e4e0] text-[13px] font-medium text-[#6b6b66] hover:bg-[#f8f8f7] transition-colors">
                Отмена
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-lg bg-[#111110] text-white text-[13px] font-medium hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
                {deleting ? 'Архивирование...' : 'Архивировать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
