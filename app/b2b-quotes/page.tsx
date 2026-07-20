'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'
import Pagination from '@/components/Pagination'
import { computeProductionSummary, type MatLight } from '@/lib/productionSummary'
import type { UserPermissions } from '@/lib/permissions'
import { isMGlassClient, isMGlassOnlyUser, MGLASS_SCOPE_ERROR } from '@/lib/b2bScope'

const PAGE_SIZE = 50

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderItem = {
  materialName?: string
  category?: string
  thickness?: number
  width?: number
  height?: number
  quantity?: number
  totalAreaNet?: number
  totalAreaBilled?: number
  totalWeight?: number
  pricePerM2?: number
  saleIncVat?: number
  costExVat?: number
  hasTempering?: boolean
  wastePercent?: number
  comment?: string
  services?: { id: number; name: string; cost: number }[]
}

type Attachment = {
  id: string
  order_id: number
  file_name: string
  file_url: string
  file_type: string | null
  file_size: number | null
  created_at: string
}

type Quote = {
  id: number
  client_id: number | null
  client_name: string
  custom_number: string | null
  client_order_number: string | null
  discount_percent: number
  margin_percent: number
  items: OrderItem[]
  total_area: number
  total_weight: number
  total_cost_net: number | null
  total_cost_vat: number | null
  total_sale_inc_vat: number
  total_after_discount: number
  notes: string | null
  created_at: string
  created_by: string | null
  // Column-level authorship — populated after 20260630_b2b_orders_authorship.sql.
  // Optional/nullable so the UI still works against pre-migration data.
  created_by_name?:      string | null
  updated_by_user_id?:   string | null
  updated_by_name?:      string | null
  updated_at?:           string | null
  converted_by_user_id?: string | null
  converted_by_name?:    string | null
  launched_by_user_id?:  string | null
  launched_by_name?:     string | null
  launched_at?:          string | null
}

type QuoteStatus   = 'quote' | 'sent' | 'agreed' | 'rejected' | 'confirmed' | 'pending_approval'
type PaymentStatus = 'unpaid' | 'partial' | 'paid'

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_META: Record<QuoteStatus, { label: string; bg: string; text: string }> = {
  quote:            { label: 'Черновик',         bg: 'bg-[#f0f0ec]',  text: 'text-[#6b6b66]'  },
  sent:             { label: 'В работе',          bg: 'bg-blue-50',    text: 'text-blue-700'    },
  agreed:           { label: 'Согласовано',       bg: 'bg-emerald-50', text: 'text-emerald-700' },
  rejected:         { label: 'Отказ',            bg: 'bg-red-50',     text: 'text-red-600'     },
  confirmed:        { label: 'Запущено в заказ', bg: 'bg-purple-50',  text: 'text-purple-700'  },
  pending_approval: { label: 'На согласовании',  bg: 'bg-amber-50',   text: 'text-amber-700'   },
}

const PAYMENT_META: Record<PaymentStatus, { label: string; bg: string; text: string; short: string }> = {
  unpaid:  { label: 'Не оплачен',  bg: 'bg-red-50',     text: 'text-red-600',     short: '🔴' },
  partial: { label: 'Предоплата',  bg: 'bg-amber-50',   text: 'text-amber-700',   short: '🟡' },
  paid:    { label: 'Оплачен',     bg: 'bg-emerald-50', text: 'text-emerald-700', short: '🟢' },
}

type TabKey = QuoteStatus | 'all' | 'needs_transfer' | 'today'

// Запущенные в работу (sent/confirmed) — это уже заказы, они живут в /b2b-orders
// и в просчётах не показываются. Здесь — только активные просчёты.
const ALL_TABS: { key: TabKey; label: string }[] = [
  { key: 'all',              label: 'Активные' },
  { key: 'today',            label: 'Сегодня' },
  { key: 'needs_transfer',   label: 'Требуют переноса' },
  { key: 'quote',            label: 'Черновики' },
  { key: 'agreed',           label: 'Согласовано' },
  { key: 'rejected',         label: 'Отказ' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseNotes(notes: string | null): Record<string, unknown> {
  if (!notes) return {}
  try { const p = JSON.parse(notes); if (typeof p === 'object' && p !== null) return p } catch {}
  return {}
}

function getStatus(q: Quote): QuoteStatus {
  const s = parseNotes(q.notes)?.status
  if (s === 'confirmed')        return 'confirmed'
  if (s === 'agreed')           return 'agreed'
  if (s === 'sent')             return 'sent'
  if (s === 'rejected')         return 'rejected'
  // Согласование отключено: любой «на согласовании» трактуем как обычный просчёт,
  // готовый к запуску в работу (кнопка «Запустить в работу»).
  if (s === 'pending_approval') return 'quote'
  return 'quote'
}

function getPayStatus(q: Quote): PaymentStatus {
  const s = parseNotes(q.notes)?.payment_status as string
  return s === 'partial' || s === 'paid' ? s as PaymentStatus : 'unpaid'
}

function getPayAmount(q: Quote): number {
  return (parseNotes(q.notes)?.prepayment_amount as number) || 0
}

// Heuristic: quote-status record that already looks like a real order — it should
// probably be moved into B2B-orders. Used by "Требуют переноса" filter and badge.
function looksLikeOrder(q: Quote): boolean {
  if (getStatus(q) !== 'quote') return false
  if (q.custom_number && q.custom_number.trim()) return true
  // client_order_number — это номер заказа КЛИЕНТА (референс), его вписывают и на
  // свежий просчёт; сам по себе он не значит, что просчёт уже стал заказом.
  const n = parseNotes(q.notes)
  if (n.launched_at) return true
  if (n.payment_status === 'partial' || n.payment_status === 'paid') return true
  if (((n.prepayment_amount as number | undefined) ?? 0) > 0) return true
  return false
}

const fmt = (n: number) => (n ?? 0).toLocaleString('ru-RU') + ' ₽'

// Запущен в работу → ушёл в заказы, в просчётах не показываем.
function notLaunched(q: Quote): boolean {
  const s = getStatus(q)
  return s !== 'sent' && s !== 'confirmed'
}

function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false
  const d = new Date(iso), now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

// ─── Telegram helpers ─────────────────────────────────────────────────────────

function formatTelegramRub(value: number): string {
  // Dot as thousands separator, no ₽ symbol — matches Telegram work text convention.
  return Math.round(value).toLocaleString('ru-RU').replace(/\s/g, '.') + ' руб'
}

function formatTelegramClientName(name: string): string {
  if (!name?.trim()) return 'Без клиента'
  const n = name.trim()
  if (/^m[\s-]?glass$/i.test(n) || /^мгласс$/i.test(n)) return 'МГЛАСС'
  return n
}

function normalizeGlassGrade(materialName: string): string {
  if (/м1|m1/i.test(materialName)) return 'м1'
  if (/прозрачн/i.test(materialName)) return 'м1'
  return materialName.trim().toLowerCase()
}

function normalizeMirrorType(materialName: string): string {
  const n = materialName.trim().toLowerCase()
  if (/серебр|silver|сильвер/.test(n)) return 'сильвер'
  if (/осветл/.test(n)) return 'осветленное'
  if (/crystal|кристал|vision|вижн/.test(n)) return 'кристал вижн'
  // Strip leading "зеркало " prefix — we already add "Зеркало" in the label
  return n.replace(/^зеркало\s+/i, '').trim() || n
}

type TgGroup = { label: string; qty: number }

function buildTelegramPositionLines(quote: Quote): string[] {
  if (quote.items.length === 0) return ['Расчёт B2B - см. PDF']

  const groups = new Map<string, TgGroup>()

  for (const item of quote.items) {
    const qty       = item.quantity ?? 1
    const matName   = (item.materialName || '').trim()
    const isGlass   = item.category !== 'зеркало'
    const thickness = item.thickness ?? 0
    const thStr     = thickness > 0 ? `${thickness}мм` : ''

    let key: string
    let label: string

    if (isGlass) {
      const grade      = normalizeGlassGrade(matName)
      const tempSuffix = (item.hasTempering ?? false) ? ' закаленное' : ''
      key   = `glass|${matName}|${thickness}|${item.hasTempering ?? false}`
      label = `Стекло ${thStr} ${grade}${tempSuffix}`.replace(/\s{2,}/g, ' ').trim()
    } else {
      // Mirror: derive shape from dimensions — equal width/height → round, otherwise rectangular
      const mirrorType = normalizeMirrorType(matName)
      const w     = item.width  ?? 0
      const h     = item.height ?? 0
      const shape = w > 0 && h > 0 && w === h ? 'круглое' : 'прямоугольное'
      key   = `mirror|${matName}|${thickness}|${shape}`
      label = `Зеркало ${thStr} ${mirrorType} ${shape}`.replace(/\s{2,}/g, ' ').trim()
    }

    const g = groups.get(key)
    if (g) { g.qty += qty } else { groups.set(key, { label, qty }) }
  }

  return Array.from(groups.values()).map(g => `${g.label} - ${g.qty} шт`)
}

function buildTelegramWorkText(quote: Quote): string {
  const quoteNumber = quote.custom_number?.trim() || `00${quote.id}`
  const clientName  = formatTelegramClientName(quote.client_name ?? '')
  const finalPrice  = (quote.discount_percent ?? 0) > 0 ? quote.total_after_discount : quote.total_sale_inc_vat
  const lines       = [quoteNumber, clientName, ...buildTelegramPositionLines(quote)]
  lines.push('', `🥝${formatTelegramRub(finalPrice)}`)
  return lines.join('\n')
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function B2BQuotesPage() {
  const [quotes, setQuotes]           = useState<Quote[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [materials, setMaterials]     = useState<MatLight[]>([])
  const [loading, setLoading]         = useState(true)
  const [loadError, setLoadError]     = useState<string | null>(null)
  const [expanded, setExpanded]       = useState<number | null>(null)
  const [tab, setTab]                 = useState<TabKey>('all')
  const [page, setPage]               = useState(1)
  const [userRole, setUserRole]       = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [currentUserName, setCurrentUserName] = useState<string | null>(null)
  const [mglassOnly, setMglassOnly]   = useState(false)

  // «Запустить в работу» — единый запуск просчёта в производство (дата + № заказа)
  const [workDateId, setWorkDateId]   = useState<number | null>(null)
  const [workDate, setWorkDate]       = useState(new Date().toISOString().slice(0, 10))
  const [workNumber, setWorkNumber]   = useState('')
  const [workDeadline, setWorkDeadline] = useState('')  // срок сдачи (notes.deadline_date)
  const [workDrawing, setWorkDrawing] = useState<File | null>(null)  // чертёж для цеха (notes.drawing_url)
  const workDateRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (workDateId !== null) setTimeout(() => workDateRef.current?.focus(), 50)
  }, [workDateId])

  // Delete modal
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleting, setDeleting]     = useState(false)

  // Toast
  const [toast, setToast] = useState<string | null>(null)
  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // Telegram copy — clipboard only, no network request
  // Future: replace copy-only flow with Telegram Bot API send after explicit confirmation.
  const [copiedId, setCopiedId] = useState<number | null>(null)
  async function copyTelegramText(q: Quote) {
    const text = buildTelegramWorkText(q)
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(q.id)
      setTimeout(() => setCopiedId(null), 2000)
      showToast('Текст для Telegram скопирован')
    } catch {
      window.prompt('Скопируйте текст для Telegram:', text)
    }
  }

  // ── Payment status ──────────────────────────────────────────────────────────
  const [payEditId, setPayEditId]   = useState<number | null>(null)
  const [payAmount, setPayAmount]   = useState('')
  const payAmountRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (payEditId !== null) setTimeout(() => payAmountRef.current?.focus(), 50)
  }, [payEditId])

  // ── Discount edit ──────────────────────────────────────────────────────────
  const [discountEditId, setDiscountEditId] = useState<number | null>(null)
  const [discountInput, setDiscountInput]   = useState('')
  const discountInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (discountEditId !== null) setTimeout(() => discountInputRef.current?.focus(), 50)
  }, [discountEditId])

  async function savePayStatus(id: number, status: PaymentStatus, amount?: number) {
    const q = quotes.find(q => q.id === id)
    if (!q) return
    const parsed = parseNotes(q.notes)
    const newNotes = JSON.stringify({
      ...parsed,
      payment_status: status,
      ...(status === 'partial' && amount ? { prepayment_amount: amount } : {}),
      ...(status !== 'partial' ? { prepayment_amount: undefined } : {}),
      ...(status === 'paid' ? { paid_at: new Date().toISOString() } : {}),
    })
    const meta = buildUpdateMeta()
    await createClient().from('b2b_orders').update({ notes: newNotes, ...meta }).eq('id', id)
    setQuotes(prev => prev.map(x => x.id === id ? { ...x, notes: newNotes, ...meta } : x))
    setPayEditId(null)
    setPayAmount('')
    showToast(`Оплата: ${PAYMENT_META[status].label}`)
  }

  // ── Status change with comment ──────────────────────────────────────────────
  const [pendingChange, setPendingChange]   = useState<{ quoteId: number; status: string } | null>(null)
  const [pendingComment, setPendingComment] = useState('')
  const commentInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (pendingChange !== null) setTimeout(() => commentInputRef.current?.focus(), 50)
  }, [pendingChange])

  // Transitions that need a comment step
  const COMMENT_REQUIRED: QuoteStatus[] = ['agreed', 'rejected']

  function requestStatusChange(quoteId: number, newStatus: string) {
    if (COMMENT_REQUIRED.includes(newStatus as QuoteStatus)) {
      setPendingChange({ quoteId, status: newStatus })
      setPendingComment('')
    } else {
      void setStatusDirect(quoteId, newStatus)
    }
  }

  async function setStatusDirect(id: number, newStatus: string) {
    const q = quotes.find(q => q.id === id)
    if (!q) return
    // Scope guard for mglass_only — they cannot touch other clients' quotes.
    if (mglassOnly && !isMGlassClient({ id: q.client_id ?? undefined, name: q.client_name })) {
      showToast(MGLASS_SCOPE_ERROR)
      return
    }
    const parsed = parseNotes(q.notes)
    const history = Array.isArray(parsed.status_history) ? [...(parsed.status_history as unknown[])] : []
    history.push({ from: getStatus(q), to: newStatus, date: new Date().toISOString(), comment: null })
    // Возврат в черновик снимает признак запуска (колонку и notes), чтобы просчёт снова
    // грузился в этот список (мы грузим только launched_at IS NULL).
    const revertToDraft = newStatus === 'quote'
    const newNotes = JSON.stringify({ ...parsed, status: newStatus, status_history: history, ...(revertToDraft ? { launched_at: undefined } : {}) })
    const meta = buildUpdateMeta()
    const patch = { notes: newNotes, ...meta, ...(revertToDraft ? { launched_at: null } : {}) }
    await createClient().from('b2b_orders').update(patch).eq('id', id)
    setQuotes(prev => prev.map(x => x.id === id ? { ...x, notes: newNotes, ...meta, ...(revertToDraft ? { launched_at: null } : {}) } : x))
    showToast(`Статус → ${STATUS_META[newStatus as QuoteStatus]?.label ?? newStatus}`)
  }

  async function confirmStatusChange() {
    if (!pendingChange) return
    const q = quotes.find(q => q.id === pendingChange.quoteId)
    if (!q) return
    if (mglassOnly && !isMGlassClient({ id: q.client_id ?? undefined, name: q.client_name })) {
      showToast(MGLASS_SCOPE_ERROR)
      setPendingChange(null)
      setPendingComment('')
      return
    }
    const parsed = parseNotes(q.notes)
    const history = Array.isArray(parsed.status_history) ? [...(parsed.status_history as unknown[])] : []
    history.push({
      from: getStatus(q),
      to: pendingChange.status,
      date: new Date().toISOString(),
      comment: pendingComment || null,
    })
    const newNotes = JSON.stringify({
      ...parsed,
      status: pendingChange.status,
      status_comment: pendingComment || null,
      status_history: history,
    })
    const meta = buildUpdateMeta()
    await createClient().from('b2b_orders').update({ notes: newNotes, ...meta }).eq('id', pendingChange.quoteId)
    setQuotes(prev => prev.map(x => x.id === pendingChange.quoteId ? { ...x, notes: newNotes, ...meta } : x))
    showToast(`Статус → ${STATUS_META[pendingChange.status as QuoteStatus]?.label ?? pendingChange.status}`)
    setPendingChange(null)
    setPendingComment('')
  }

  async function confirmWorkDate() {
    if (!workDateId) return
    const q = quotes.find(x => x.id === workDateId)
    if (!q) return
    if (mglassOnly && !isMGlassClient({ id: q.client_id ?? undefined, name: q.client_name })) {
      showToast(MGLASS_SCOPE_ERROR)
      setWorkDateId(null)
      return
    }
    const parsed = parseNotes(q.notes)
    const history = Array.isArray(parsed.status_history) ? [...(parsed.status_history as unknown[])] : []
    history.push({ from: getStatus(q), to: 'sent', date: new Date().toISOString(), comment: null })
    // Чертёж для цеха: тот же bucket/путь, что «Прикрепить чертёж» в заказах —
    // мастер увидит его в «Моих задачах» и в карточке заказа
    let drawingUrl: string | null = null
    if (workDrawing) {
      const sbUp = createClient()
      const ext = (workDrawing.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `order-drawings/${workDateId}.${ext}`
      const { error: upErr } = await sbUp.storage.from('b2b-attachments').upload(path, workDrawing, { upsert: true })
      if (upErr) { showToast('Чертёж не загрузился: ' + upErr.message); return }
      // bucket приватный, publicUrl не работает — храним путь, показ идёт через /api/b2b/drawing
      drawingUrl = path
    }
    // «В работу» с датой = запуск в производство: выбранная дата это и есть дата запуска.
    // Пишем launched_at (колонку и notes), иначе заказ висит «без даты запуска» в /b2b-orders,
    // который группирует по launched_at, а не по work_started_at.
    const newNotes = JSON.stringify({
      ...parsed,
      status: 'sent',
      work_started_at: workDate,
      launched_at: workDate,
      ...(workDeadline ? { deadline_date: workDeadline } : {}),
      ...(drawingUrl ? { drawing_url: drawingUrl } : {}),
      status_history: history,
    })
    const meta = buildUpdateMeta()
    const num = workNumber.trim()
    const updateRow = {
      notes: newNotes,
      ...meta,
      launched_at:          workDate,
      launched_by_user_id:  currentUserId,
      launched_by_name:     currentUserName,
      converted_by_user_id: currentUserId,
      converted_by_name:    currentUserName,
      ...(num ? { custom_number: num } : {}),
    }
    const { error } = await createClient().from('b2b_orders').update(updateRow).eq('id', workDateId)
    if (error) { showToast('Ошибка: ' + error.message); return }
    // Чертёж дописываем ВТОРЫМ свежим read-merge-write: параллельные RMW notes
    // (этапы/материал в /b2b-orders) могут затереть общий update (случай #4960)
    if (drawingUrl) {
      const sb2 = createClient()
      const { data: freshRow } = await sb2.from('b2b_orders').select('notes').eq('id', workDateId).single()
      const freshNotes = parseNotes((freshRow as { notes: string | null } | null)?.notes ?? null)
      await sb2.from('b2b_orders').update({ notes: JSON.stringify({ ...freshNotes, drawing_url: drawingUrl }) }).eq('id', workDateId)
    }
    // Генерация задач в цех (best-effort).
    fetch(`/api/b2b-orders/${workDateId}/launch-production`, { method: 'POST' }).catch(() => {})
    setQuotes(prev => prev.map(x => x.id === workDateId ? {
      ...x,
      notes: newNotes,
      launched_at:          workDate,
      launched_by_user_id:  currentUserId,
      launched_by_name:     currentUserName,
      converted_by_user_id: currentUserId,
      converted_by_name:    currentUserName,
      ...(num ? { custom_number: num } : {}),
      ...meta,
    } : x))
    showToast('Запущено в работу')
    setWorkDateId(null)
    setWorkDrawing(null)
  }

  // ── Load ───────────────────────────────────────────────────────────────────
  async function loadQuotes() {
    setLoading(true)
    setLoadError(null)
    const sb = createClient()
    try {
      const { data: { user } } = await sb.auth.getUser()
      if (!user) { return }

      const { data: profile } = await sb
        .from('users')
        .select('role, name, see_all_orders, permissions')
        .eq('id', user.id)
        .single()

      setUserRole(profile?.role ?? null)
      setCurrentUserId(user.id)
      setCurrentUserName((profile?.name as string) || user.email || null)
      const isOwner = profile?.role === 'admin' || profile?.role === 'ceo'
      const perms = (profile?.permissions ?? null) as UserPermissions | null
      // Owners are never scope-restricted.
      setMglassOnly(!isOwner && isMGlassOnlyUser(perms))
      const canSeeAll = profile?.role === 'admin' || profile?.role === 'buyer' || profile?.see_all_orders === true

      // Запущенные в производство (launched_at выставлен) живут в /b2b-orders и в этом
      // списке не показываются ни в одной вкладке — не грузим их вовсе. Это режет выборку
      // с тысяч строк до десятков и убирает долгую загрузку. Возврат в черновик обнуляет
      // launched_at (см. setStatusDirect), поэтому восстановленные просчёты снова попадают сюда.
      let ordersQuery = sb
        .from('b2b_orders')
        .select('*')
        .is('archived_at', null)
        .is('launched_at', null)
        .order('created_at', { ascending: false })
        .limit(2000)

      if (!canSeeAll) {
        // Show quotes created by this manager OR for clients assigned to this manager
        const { data: myClients } = await sb
          .from('b2b_clients')
          .select('id')
          .eq('manager_id', user.id)
        const myClientIds = (myClients ?? []).map((c: { id: number }) => c.id)
        if (myClientIds.length > 0) {
          ordersQuery = ordersQuery.or(`created_by.eq.${user.id},client_id.in.(${myClientIds.join(',')})`)
        } else {
          ordersQuery = ordersQuery.eq('created_by', user.id)
        }
      }

      const [{ data: orders }, { data: attaches }, { data: mats }] = await Promise.all([
        ordersQuery,
        sb.from('b2b_calculation_attachments').select('*').order('created_at', { ascending: false }).limit(5000),
        sb.from('b2b_materials').select('name,thickness,sheet_width,sheet_height,cost_price,waste_percent').eq('active', true),
      ])
      setQuotes((orders ?? []).map(q => ({
        ...q, items: Array.isArray(q.items) ? (q.items as OrderItem[]) : [],
      })))
      setAttachments(attaches ?? [])
      setMaterials((mats ?? []) as MatLight[])
    } catch (err) {
      console.error('[b2b-quotes] load error:', err)
      setLoadError(err instanceof Error ? err.message : 'Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadQuotes().catch(() => setLoading(false)) }, [])

  // ── Duplicate / Delete ─────────────────────────────────────────────────────
  async function duplicateQuote(q: Quote) {
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    const parsed = parseNotes(q.notes)
    // Автор дубля — текущий пользователь (не исходный менеджер): чистим manager_name в notes.
    const newNotes = JSON.stringify({ ...parsed, status: 'quote', quote_date: new Date().toISOString(), launched_at: undefined, payment_status: undefined, manager_name: currentUserName ?? undefined })
    const { data, error } = await sb.from('b2b_orders').insert({
      client_id: q.client_id, client_name: q.client_name,
      discount_percent: q.discount_percent, margin_percent: q.margin_percent,
      items: q.items, total_area: q.total_area, total_weight: q.total_weight,
      total_cost_net: q.total_cost_net ?? 0, total_cost_vat: q.total_cost_vat ?? 0,
      total_sale_inc_vat: q.total_sale_inc_vat, total_after_discount: q.total_after_discount,
      notes: newNotes,
      created_by: user?.id ?? null,
      created_by_name: currentUserName ?? null,
    }).select().single()
    if (!error && data) {
      setQuotes(prev => [{ ...data, items: q.items }, ...prev])
      showToast('Расчёт скопирован как черновик')
    }
  }

  async function handleDelete() {
    if (!deletingId) return
    setDeleting(true)
    await createClient()
      .from('b2b_orders')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', deletingId)
    setQuotes(prev => prev.filter(q => q.id !== deletingId))
    setDeletingId(null)
    setDeleting(false)
    showToast('Просчёт архивирован')
  }

  async function saveDiscount(id: number) {
    const q = quotes.find(x => x.id === id)
    if (!q) return
    const newDiscount = Math.min(50, Math.max(0, Number(discountInput) || 0))
    const baseTotal   = q.total_sale_inc_vat
    const newTotal    = Math.round(baseTotal * (1 - newDiscount / 100))
    const parsed      = parseNotes(q.notes)
    const history     = Array.isArray(parsed.discount_history) ? [...(parsed.discount_history as unknown[])] : []
    history.push({
      old_discount: q.discount_percent,
      new_discount: newDiscount,
      old_total:    q.total_after_discount ?? q.total_sale_inc_vat,
      new_total:    newTotal,
      changed_at:   new Date().toISOString(),
      changed_by:   currentUserId ?? undefined,
    })
    const newNotes = JSON.stringify({ ...parsed, discount_history: history })
    const { error } = await createClient().from('b2b_orders').update({
      discount_percent:     newDiscount,
      total_after_discount: newTotal,
      notes:                newNotes,
      ...buildUpdateMeta(),   // фиксируем, кто и когда менял скидку (как в остальных мутациях)
    }).eq('id', id)
    if (error) { showToast('Ошибка сохранения скидки'); return }
    setQuotes(prev => prev.map(x => x.id === id ? {
      ...x,
      discount_percent:     newDiscount,
      total_after_discount: newTotal,
      notes:                newNotes,
    } : x))
    setDiscountEditId(null)
    showToast(`Скидка обновлена: ${newDiscount}%`)
  }

  // Shared "who changed this, when" payload — column-level authorship.
  function buildUpdateMeta() {
    return {
      updated_by_user_id: currentUserId,
      updated_by_name:    currentUserName,
      updated_at:         new Date().toISOString(),
    }
  }


  // ── Derived ────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')

  const visible = useMemo(() => {
    let list: Quote[]
    if (tab === 'all') list = quotes.filter(notLaunched)
    else if (tab === 'today') list = quotes.filter(q => notLaunched(q) && isToday(q.created_at))
    else if (tab === 'needs_transfer') list = quotes.filter(looksLikeOrder)
    else list = quotes.filter(q => getStatus(q) === tab)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(x =>
        x.client_name.toLowerCase().includes(q) ||
        (x.custom_number ?? '').toLowerCase().includes(q) ||
        (x.client_order_number ?? '').toLowerCase().includes(q) ||
        String(x.id).includes(q)
      )
    }
    return list
  }, [quotes, tab, search])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, today: 0, needs_transfer: 0 }
    for (const q of quotes) {
      const s = getStatus(q); c[s] = (c[s] ?? 0) + 1
      if (notLaunched(q)) { c.all++; if (isToday(q.created_at)) c.today++ }
      if (looksLikeOrder(q)) c.needs_transfer++
    }
    return c
  }, [quotes])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка...</div>
  )

  if (loadError) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center px-4">
      <p className="text-[13px] text-red-600">Не удалось загрузить данные</p>
      <p className="text-[11px] text-[#9a9a95]">{loadError}</p>
      <button onClick={loadQuotes} className="px-4 py-2 bg-[#111110] text-white text-[13px] rounded-lg hover:bg-[#2a2a28]">
        Повторить
      </button>
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-[1200px] mx-auto px-4 py-5">

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-[#111110] text-white text-[12px] px-4 py-2.5 rounded-xl shadow-lg animate-in fade-in">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-[18px] font-semibold text-[#111110] tracking-tight">B2B Расчёты</h1>
          <p className="text-[12px] text-[#8a8a85] mt-0.5">{counts.all} активных · {counts.today} сегодня</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Поиск: номер, клиент..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-[#111110] bg-white w-52"
          />
          <Link href="/calculator/b2b"
            className="bg-[#111110] text-white text-[12px] font-medium px-3 py-1.5 rounded-lg hover:bg-[#2a2a28] transition-colors whitespace-nowrap">
            + Новый расчёт
          </Link>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1 mb-4 flex-wrap">
        {ALL_TABS.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setPage(1) }}
            className={`text-[12px] font-medium px-3 py-1.5 rounded-lg transition-colors ${tab === t.key ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f4]'}`}>
            {t.label}
            {(counts[t.key] ?? 0) > 0 && (
              <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-white/20 text-white' : 'bg-[#f0f0ec] text-[#8a8a85]'}`}>
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-10 text-center">
          <p className="text-[13px] text-[#6b6b66]">Нет расчётов</p>
          <p className="text-[11px] text-[#9a9a95] mt-0.5">Сохранённые из калькулятора расчёты появятся здесь</p>
        </div>
      ) : (
        <>
          <Pagination
            page={page} total={visible.length} pageSize={PAGE_SIZE}
            onPageChange={setPage} className="mb-3"
          />
        <div className="space-y-1.5">
          {visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(quote => {
            const isOpen    = expanded === quote.id
            const status    = getStatus(quote)
            const sMeta     = STATUS_META[status]
            const payStatus = getPayStatus(quote)
            const pMeta     = PAYMENT_META[payStatus]
            const parsed    = parseNotes(quote.notes)
            const quoteDate = parsed.quote_date
              ? new Date(String(parsed.quote_date))
              : new Date(quote.created_at)
            const dateStr   = quoteDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
            const timeStr   = quoteDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
            const finalPrice = (quote.discount_percent ?? 0) > 0 ? quote.total_after_discount : quote.total_sale_inc_vat
            const userNotes  = typeof parsed.user_notes === 'string' ? parsed.user_notes : null
            const statusComment = typeof parsed.status_comment === 'string' ? parsed.status_comment : null
            const hasAttach  = attachments.some(a => a.order_id === quote.id)
            const isPendingThis      = pendingChange?.quoteId === quote.id
            const isPayEditThis      = payEditId === quote.id
            const isWorkDateThis     = workDateId === quote.id
            const isDiscountEditThis = discountEditId === quote.id
            const workStartedAt      = parsed.work_started_at ? String(parsed.work_started_at) : null

            // Discount preview — computed once per row, cheap arithmetic
            const discBase      = quote.total_sale_inc_vat
            const discNewPct    = Math.min(50, Math.max(0, Number(discountInput) || 0))
            const discNewTotal  = Math.round(discBase * (1 - discNewPct / 100))
            const discCost      = quote.total_cost_net ?? 0
            const discProfit    = discNewTotal - discCost
            const discMargin    = discNewTotal > 0 ? (discProfit / discNewTotal * 100) : 0

            return (
              <div key={quote.id} className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">

                {/* ── Row header ─────────────────────────────────────────── */}
                <div className="px-4 py-2.5 flex items-center gap-3">

                  {/* Expand toggle + info */}
                  <button
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    onClick={() => setExpanded(isOpen ? null : quote.id)}>
                    <span className="text-[11px] font-bold text-[#c4c4be] flex-shrink-0">#{quote.id}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {quote.custom_number && (
                          <span className="text-[13px] font-bold font-mono text-[#111110]">{quote.custom_number}</span>
                        )}
                        {quote.client_order_number && (
                          <span className="text-[11px] font-mono text-[#6b6b66] bg-[#f0f0ec] px-1.5 py-0.5 rounded">
                            кл. {quote.client_order_number}
                          </span>
                        )}
                        <p className="text-[13px] font-semibold text-[#111110] truncate">{quote.client_name}</p>
                        {looksLikeOrder(quote) && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200" title="У просчёта есть признаки заказа — перенесите в B2B-заказы">
                            Похоже, это уже заказ
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#9a9a95]">
                        {dateStr}, {timeStr}
                        {' · '}{quote.items.length} поз.
                        {' · '}{(quote.total_area ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} м²
                        {(quote.total_weight ?? 0) > 0 && ` · ${(quote.total_weight ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} кг`}
                        {hasAttach && ' · 📎'}
                        {(quote.created_by_name || (parsed.manager_name as string | undefined)) && (
                          <> {' · '}Просчитал: <span className="text-[#6b6b66] font-medium">{quote.created_by_name || (parsed.manager_name as string)}</span></>
                        )}
                      </p>
                    </div>
                  </button>

                  <div className="flex items-center gap-2 flex-shrink-0">

                    {/* Низкая маржа */}
                    {(quote.margin_percent ?? 0) > 0 && quote.margin_percent < 15 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600" title="Маржа ниже 15%">
                        ⚠️ {quote.margin_percent}%
                      </span>
                    )}

                    {/* "На согласовании" — только этот статус показываем плашкой, он требует action */}
                    {status === 'pending_approval' && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${sMeta.bg} ${sMeta.text}`}>
                        {sMeta.label}
                      </span>
                    )}

                    {/* Price */}
                    <div className="text-right min-w-[80px]">
                      <p className="text-[13px] font-semibold text-[#111110]">{fmt(finalPrice)}</p>
                      <button
                        onClick={() => {
                          setDiscountEditId(isDiscountEditThis ? null : quote.id)
                          setDiscountInput(String(quote.discount_percent ?? 0))
                        }}
                        className="text-[10px] leading-tight text-emerald-600 hover:text-emerald-800 hover:underline">
                        {(quote.discount_percent ?? 0) > 0 ? `−${quote.discount_percent}% · изм.` : '% скидка'}
                      </button>
                    </div>

                    {/* Status actions */}
                    <div className="flex items-center gap-1">
                      {/* Согласование отключено: quote и agreed сразу запускаются в работу */}
                      {(status === 'quote' || status === 'agreed') && (
                        <button
                          onClick={() => { setWorkDateId(quote.id); setWorkDate(new Date().toISOString().slice(0, 10)); setWorkNumber(quote.custom_number ?? ''); const dl = new Date(); dl.setDate(dl.getDate() + 14); setWorkDeadline(dl.toISOString().slice(0, 10)) }}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] transition-colors whitespace-nowrap">
                          Запустить в работу →
                        </button>
                      )}
                      {status === 'sent' && (<>
                        <button onClick={() => requestStatusChange(quote.id, 'agreed')}
                          className="text-[11px] font-medium px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors whitespace-nowrap">
                          Согласовано
                        </button>
                        <button onClick={() => requestStatusChange(quote.id, 'rejected')}
                          className="text-[11px] font-medium px-2 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors whitespace-nowrap">
                          Отказ
                        </button>
                      </>)}
                      {(status === 'rejected' || status === 'sent') && (
                        <button onClick={() => requestStatusChange(quote.id, 'quote')}
                          className="text-[11px] px-2 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f4] transition-colors whitespace-nowrap">
                          ↩ Черновик
                        </button>
                      )}

                      {/* PDF */}
                      <a href={`/api/quotes/${quote.id}/pdf`} target="_blank" download
                        title="Скачать КП в PDF"
                        className="text-[11px] font-medium px-2 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f4] hover:text-[#111110] transition-colors whitespace-nowrap">
                        📄 PDF
                      </a>
                      {/* ТГ — copy Telegram work text to clipboard */}
                      <button
                        onClick={() => copyTelegramText(quote)}
                        title="Скопировать текст для Telegram"
                        className="text-[11px] font-medium px-2 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f4] hover:text-[#111110] transition-colors whitespace-nowrap">
                        {copiedId === quote.id ? '✓' : 'ТГ'}
                      </button>
                      {/* КП */}
                      <Link href={`/b2b-quotes/${quote.id}/kp`} target="_blank"
                        title="Открыть КП для печати"
                        className="text-[11px] text-[#c4c4be] hover:text-violet-500 px-1.5 py-1 rounded hover:bg-violet-50 transition-colors">
                        КП
                      </Link>
                      {/* Счёт-спецификация (КП + счёт с реквизитами и QR) */}
                      <Link href={`/b2b-quotes/${quote.id}/invoice`} target="_blank"
                        title="Счёт-спецификация (счёт с реквизитами и QR)"
                        className="text-[11px] text-[#c4c4be] hover:text-emerald-600 px-1.5 py-1 rounded hover:bg-emerald-50 transition-colors">
                        Счёт
                      </Link>
                      {/* Редактировать в калькуляторе (та же запись; для копии — кнопка ⧉ рядом) */}
                      <Link href={`/calculator/b2b?orderId=${quote.id}`}
                        title="Редактировать в калькуляторе"
                        className="text-[11px] text-[#c4c4be] hover:text-purple-500 px-1.5 py-1 rounded hover:bg-purple-50 transition-colors">
                        🧮
                      </Link>
                      {/* Duplicate */}
                      <button onClick={() => duplicateQuote(quote)} title="Дублировать расчёт"
                        className="text-[11px] text-[#c4c4be] hover:text-blue-500 px-1.5 py-1 rounded hover:bg-blue-50 transition-colors">
                        ⧉
                      </button>
                      {/* Delete */}
                      <button onClick={() => setDeletingId(quote.id)} title="Удалить"
                        className="text-[#c4c4be] hover:text-red-500 p-1 rounded hover:bg-red-50 transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── Payment edit panel ─────────────────────────────────── */}
                {isPayEditThis && (
                  <div className="px-4 py-3 border-t border-[#f0f0ec] bg-[#fafaf9] flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-semibold text-[#6b6b66] uppercase tracking-widest">Оплата:</span>
                    {(['unpaid', 'partial', 'paid'] as PaymentStatus[]).map(ps => (
                      <button key={ps}
                        onClick={() => ps === 'partial' ? null : savePayStatus(quote.id, ps)}
                        className={`text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors border ${payStatus === ps ? `${PAYMENT_META[ps].bg} ${PAYMENT_META[ps].text} border-transparent font-semibold` : 'border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f4]'}`}>
                        {PAYMENT_META[ps].short} {PAYMENT_META[ps].label}
                      </button>
                    ))}
                    {/* Partial amount inline */}
                    <div className="flex items-center gap-1.5 ml-1">
                      <input ref={payAmountRef} type="number" min="0"
                        className="w-28 bg-white border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] font-mono outline-none focus:border-amber-400"
                        value={payAmount}
                        onChange={e => setPayAmount(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && Number(payAmount) > 0 && savePayStatus(quote.id, 'partial', Number(payAmount))}
                        placeholder="Сумма ₽" />
                      <button
                        disabled={!payAmount || Number(payAmount) <= 0}
                        onClick={() => savePayStatus(quote.id, 'partial', Number(payAmount))}
                        className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 disabled:opacity-40 transition-colors whitespace-nowrap">
                        🟡 Предоплата
                      </button>
                    </div>
                    <button onClick={() => { setPayEditId(null); setPayAmount('') }}
                      className="ml-auto text-[#9a9a95] hover:text-[#111110] text-sm transition-colors">✕</button>
                  </div>
                )}

                {/* ── Discount edit panel ────────────────────────────────── */}
                {isDiscountEditThis && (
                  <div className="px-4 py-3 border-t border-[#f0f0ec] bg-[#fafaf9] space-y-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95]">Скидка по просчёту</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-[#6b6b66]">
                        Текущая: <span className="font-semibold">{quote.discount_percent ?? 0}%</span>
                      </span>
                      <span className="text-[#c4c4be] select-none">→</span>
                      <span className="text-[11px] text-[#6b6b66]">Новая:</span>
                      <div className="flex items-center gap-1">
                        <input
                          ref={discountInputRef}
                          type="number" min="0" max="50" step="1"
                          className="w-16 bg-white border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] font-mono text-center outline-none focus:border-[#111110] transition-colors"
                          value={discountInput}
                          onChange={e => setDiscountInput(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && saveDiscount(quote.id)}
                        />
                        <span className="text-[12px] text-[#6b6b66]">%</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-[11px] bg-white border border-[#f0f0ec] rounded-lg px-3 py-2 w-fit min-w-[220px]">
                      <span className="text-[#9a9a95]">Было к оплате</span>
                      <span className="font-mono text-right text-[#6b6b66]">{finalPrice.toLocaleString('ru-RU')} ₽</span>
                      <span className="text-[#9a9a95]">Станет к оплате</span>
                      <span className={`font-mono text-right font-semibold ${discNewTotal < finalPrice ? 'text-emerald-600' : 'text-[#111110]'}`}>
                        {discNewTotal.toLocaleString('ru-RU')} ₽
                      </span>
                      <span className="text-[#9a9a95]">Себестоимость</span>
                      <span className="font-mono text-right text-[#6b6b66]">{discCost.toLocaleString('ru-RU')} ₽</span>
                      <span className="text-[#9a9a95]">Прибыль</span>
                      <span className={`font-mono text-right font-semibold ${discProfit < 0 ? 'text-red-600' : 'text-[#111110]'}`}>
                        {discProfit.toLocaleString('ru-RU')} ₽
                      </span>
                      <span className="text-[#9a9a95]">Маржа</span>
                      <span className={`font-mono text-right font-semibold ${discMargin < 20 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {discMargin.toFixed(1)}%
                      </span>
                    </div>
                    {discMargin < 20 && discNewTotal > 0 && (
                      <p className="text-[11px] text-amber-600 font-medium">⚠️ Внимание: маржа ниже 20%</p>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => saveDiscount(quote.id)}
                        disabled={discNewPct < 0 || discNewPct > 50}
                        className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40 transition-colors whitespace-nowrap">
                        Сохранить
                      </button>
                      <button
                        onClick={() => setDiscountEditId(null)}
                        className="text-[#9a9a95] hover:text-[#111110] transition-colors text-sm px-1">
                        Отмена
                      </button>
                    </div>
                  </div>
                )}

                {/* ── В работу: выбор даты запуска ──────────────────────── */}
                {isWorkDateThis && (
                  <div className="px-4 py-3 border-t border-[#f0f0ec] bg-blue-50/50 flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-blue-700 flex-shrink-0">Дата запуска:</span>
                      <input ref={workDateRef} type="date"
                        className="bg-white border border-[#d0e0ff] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-blue-400 font-mono"
                        value={workDate}
                        onChange={e => setWorkDate(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && confirmWorkDate()}
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-blue-700 flex-shrink-0">Срок сдачи:</span>
                      <input type="date"
                        title="Когда отдать клиенту — используется в Сводке производства"
                        className="bg-white border border-[#d0e0ff] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-blue-400 font-mono"
                        value={workDeadline}
                        onChange={e => setWorkDeadline(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && confirmWorkDate()}
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-blue-700 flex-shrink-0">№ заказа:</span>
                      <input type="text" placeholder="напр. 1453-1"
                        className="w-28 bg-white border border-[#d0e0ff] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-blue-400 font-mono"
                        value={workNumber}
                        onChange={e => setWorkNumber(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && confirmWorkDate()}
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-blue-700 flex-shrink-0">Чертёж:</span>
                      <label className="cursor-pointer bg-white border border-[#d0e0ff] rounded-lg px-3 py-1.5 text-[12px] text-[#111110] hover:border-blue-400 max-w-[180px] truncate">
                        {workDrawing ? `📐 ${workDrawing.name}` : '📐 Прикрепить (PDF/фото)'}
                        <input type="file" accept="application/pdf,image/*" className="hidden"
                          onChange={e => setWorkDrawing(e.target.files?.[0] ?? null)} />
                      </label>
                      {workDrawing && (
                        <button onClick={() => setWorkDrawing(null)} className="text-[#9a9a95] hover:text-red-600 text-sm px-0.5" title="Убрать файл">✕</button>
                      )}
                    </div>
                    <p className="text-[11px] text-blue-600/70 flex-shrink-0">
                      Заказ уйдёт в производство, задачи появятся в цеху
                    </p>
                    <div className="flex items-center gap-2 ml-auto">
                      <button onClick={confirmWorkDate} disabled={!workDate}
                        className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40 transition-colors whitespace-nowrap">
                        Запустить →
                      </button>
                      <button onClick={() => setWorkDateId(null)}
                        className="text-[#9a9a95] hover:text-[#111110] transition-colors px-1 text-sm">✕</button>
                    </div>
                  </div>
                )}

                {/* ── Status change comment panel ────────────────────────── */}
                {isPendingThis && (
                  <div className={`px-4 py-3 border-t border-[#f0f0ec] flex items-center gap-2 ${pendingChange.status === 'rejected' ? 'bg-red-50/40' : 'bg-emerald-50/40'}`}>
                    <span className={`text-[11px] font-semibold flex-shrink-0 ${pendingChange.status === 'rejected' ? 'text-red-600' : 'text-emerald-700'}`}>
                      {STATUS_META[pendingChange.status as QuoteStatus]?.label}:
                    </span>
                    <input ref={commentInputRef} type="text"
                      className="flex-1 min-w-0 bg-white border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-[#111110] transition-all"
                      value={pendingComment}
                      onChange={e => setPendingComment(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && confirmStatusChange()}
                      placeholder={pendingChange.status === 'rejected' ? 'Причина отказа (рекомендуется)...' : 'Комментарий (опционально)...'} />
                    <button onClick={confirmStatusChange}
                      className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${pendingChange.status === 'rejected' ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
                      Подтвердить →
                    </button>
                    <button onClick={() => { setPendingChange(null); setPendingComment('') }}
                      className="text-[#9a9a95] hover:text-[#111110] transition-colors px-1 text-sm">✕</button>
                  </div>
                )}

                {/* ── Expanded: items table ──────────────────────────────── */}
                {isOpen && (
                  <div className="border-t border-[#f0f0ec]">

                    {/* Status comment (last) */}
                    {statusComment && (
                      <div className={`px-4 py-2 text-[11px] flex items-center gap-2 border-b border-[#f0f0ec] ${status === 'rejected' ? 'bg-red-50/40 text-red-700' : 'bg-emerald-50/40 text-emerald-700'}`}>
                        <span className="font-semibold">{sMeta.label}:</span>
                        <span>{statusComment}</span>
                      </div>
                    )}

                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="border-b border-[#f0f0ec] bg-[#fafaf9] text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest whitespace-nowrap">
                            <th className="px-2 py-1.5 text-center w-7">#</th>
                            <th className="px-2 py-1.5 text-left min-w-[130px]">Материал</th>
                            <th className="px-2 py-1.5 text-left min-w-[70px]">Тип</th>
                            <th className="px-2 py-1.5 text-right w-12">Толщ.</th>
                            <th className="px-2 py-1.5 text-right w-14">Ш, мм</th>
                            <th className="px-2 py-1.5 text-right w-14">В, мм</th>
                            <th className="px-2 py-1.5 text-right w-10">Кол.</th>
                            <th className="px-2 py-1.5 text-right w-14">Кв.м</th>
                            <th className="px-2 py-1.5 text-right w-14">Вес, кг</th>
                            <th className="px-2 py-1.5 text-right w-18">Цена/м²</th>
                            <th className="px-2 py-1.5 text-right w-20 text-[#111110]">Итого</th>
                            <th className="px-2 py-1.5 text-right w-20 text-[#9a9a95]">Себест.</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#f8f8f7]">
                          {quote.items.map((item, idx) => {
                            const itemFull = item.saleIncVat ?? 0
                            return (
                              <tr key={idx} className="hover:bg-[#fafaf9]">
                                <td className="px-2 py-1 text-center text-[10px] font-bold text-[#c4c4be]">{idx + 1}</td>
                                <td className="px-2 py-1">
                                  <div className="font-medium text-[#111110]">{String(item.materialName ?? '')}</div>
                                  {(item.hasTempering || (item.services?.length ?? 0) > 0) && (
                                    <div className="flex gap-0.5 flex-wrap mt-0.5">
                                      {item.hasTempering && <span className="text-[8px] font-medium px-1 py-px rounded bg-orange-50 text-orange-600">закалка</span>}
                                      {item.services?.map(s => (
                                        <span key={s.id} className="text-[8px] font-medium px-1 py-px rounded bg-blue-50 text-blue-600">{s.name}</span>
                                      ))}
                                    </div>
                                  )}
                                  {item.comment && (
                                    <p className="text-[10px] text-[#9a9a95] italic mt-0.5">{item.comment}</p>
                                  )}
                                </td>
                                <td className="px-2 py-1 text-[#6b6b66] whitespace-nowrap">{String(item.category ?? '')}</td>
                                <td className="px-2 py-1 text-right font-mono text-[#111110]">{item.thickness ?? ''}</td>
                                <td className="px-2 py-1 text-right font-mono text-[#111110]">{item.width ?? ''}</td>
                                <td className="px-2 py-1 text-right font-mono text-[#111110]">{item.height ?? ''}</td>
                                <td className="px-2 py-1 text-right font-mono text-[#111110]">{item.quantity ?? ''}</td>
                                <td className="px-2 py-1 text-right font-mono text-[#111110]">{Number(item.totalAreaNet ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 3 })}</td>
                                <td className="px-2 py-1 text-right font-mono text-[#6b6b66]">{Number(item.totalWeight ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}</td>
                                <td className="px-2 py-1 text-right font-mono text-[#111110]">{Number(item.pricePerM2 ?? 0).toLocaleString('ru-RU')}</td>
                                <td className="px-2 py-1 text-right font-mono font-semibold text-[#111110] whitespace-nowrap">{itemFull.toLocaleString('ru-RU')} ₽</td>
                                <td className="px-2 py-1 text-right font-mono text-[#9a9a95] whitespace-nowrap">{Number(item.costExVat ?? 0).toLocaleString('ru-RU')} ₽</td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-[#e4e4e0] bg-[#fafaf9] text-[#111110]">
                            <td colSpan={7} className="px-2 py-1.5 text-[10px] text-[#6b6b66]">{quote.items.length} позиций</td>
                            <td className="px-2 py-1.5 text-right font-mono text-[11px]">{(quote.total_area ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 3 })}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-[11px] text-[#6b6b66]">{(quote.total_weight ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}</td>
                            <td />
                            <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap text-[11px] text-[#6b6b66]">{fmt(quote.total_sale_inc_vat)}</td>
                            <td />
                          </tr>
                          {(quote.discount_percent ?? 0) > 0 && (
                            <tr className="bg-[#fafaf9]">
                              <td colSpan={10} className="px-2 py-0.5 text-right text-[11px] text-emerald-600">
                                Скидка {quote.discount_percent}%
                              </td>
                              <td className="px-2 py-0.5 text-right font-mono text-[11px] text-emerald-600 whitespace-nowrap">
                                −{fmt(quote.total_sale_inc_vat - finalPrice)}
                              </td>
                              <td />
                            </tr>
                          )}
                          <tr className="bg-[#fafaf9] border-t border-[#e4e4e0] font-semibold">
                            <td colSpan={10} className="px-2 py-1.5 text-right text-[11px] text-[#111110]">Итого к оплате</td>
                            <td className="px-2 py-1.5 text-right font-mono font-bold whitespace-nowrap text-[11px] text-[#111110]">{fmt(finalPrice)}</td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* ПРЕДВАРИТЕЛЬНАЯ ЗАКУПКА */}
                    {(() => {
                      const summary = computeProductionSummary(
                        quote.items.map(item => ({
                          materialName: item.materialName,
                          thickness: item.thickness,
                          totalAreaNet: item.totalAreaNet,
                          totalAreaBilled: item.totalAreaBilled,
                          hasTempering: item.hasTempering,
                          wastePercent: item.wastePercent,
                        })),
                        materials,
                      )
                      if (!summary.totalSheets) return null
                      const fmtRub = (n: number) => n.toLocaleString('ru-RU') + ' ₽'
                      return (
                        <div className="border-t border-[#f0f0ec]">
                          <div className="px-4 py-2 bg-[#fafaf9]">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-2">Предварительная закупка</p>
                            <div className="space-y-1">
                              {summary.rows.map(row => (
                                <div key={row.matKey} className="flex items-center justify-between text-[11px]">
                                  <div>
                                    <span className="font-medium text-[#111110]">{row.matLabel}</span>
                                    <span className="text-[#9a9a95] ml-2">≈ {row.sheetsNeeded} л.</span>
                                    {row.temperingCost > 0 && (
                                      <span className="text-amber-600 ml-1.5 text-[10px]">+ закалка {fmtRub(row.temperingCost)}</span>
                                    )}
                                  </div>
                                  <span className="font-mono text-[#6b6b66]">{fmtRub(row.sheetCost)}</span>
                                </div>
                              ))}
                              <div className="flex justify-between text-[11px] pt-1 border-t border-[#e4e4e0] mt-1">
                                <span className="text-[#6b6b66]">Итого материал</span>
                                <span className="font-mono font-semibold text-[#111110]">{fmtRub(summary.grandTotal)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })()}

                    {/* Work start date */}
                    {workStartedAt && (
                      <div className="px-4 py-2 border-t border-[#f0f0ec] flex items-center gap-2 text-[11px] text-blue-700 bg-blue-50/30">
                        <span className="font-semibold">В работе с:</span>
                        <span className="font-mono">
                          {new Date(workStartedAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </span>
                      </div>
                    )}

                    {/* Payment status in expanded view */}
                    <div className="px-4 py-2.5 border-t border-[#f0f0ec] flex items-center gap-3">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95]">Оплата</span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${pMeta.bg} ${pMeta.text}`}>
                        {pMeta.short} {pMeta.label}
                        {payStatus === 'partial' && getPayAmount(quote) > 0 && ` — ${getPayAmount(quote).toLocaleString('ru-RU')} ₽`}
                      </span>
                      <button
                        onClick={() => { setPayEditId(isPayEditThis ? null : quote.id); setPayAmount('') }}
                        className="text-[11px] text-[#9a9a95] hover:text-[#111110] transition-colors underline underline-offset-2">
                        изменить
                      </button>
                    </div>

                    {/* Notes / comment */}
                    {userNotes && (
                      <p className="px-4 py-2 text-[11px] text-[#6b6b66] italic border-t border-[#f0f0ec]">{userNotes}</p>
                    )}

                    {/* Attachments */}
                    {(() => {
                      const files = attachments.filter(a => a.order_id === quote.id)
                      if (files.length === 0) return null
                      return (
                        <div className="px-4 py-2.5 border-t border-[#f0f0ec] flex flex-wrap gap-2">
                          {files.map(f => (
                            <a key={f.id} href={`/api/b2b/attachments/${f.id}`} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1.5 px-2.5 py-1.5 border border-[#e4e4e0] rounded-lg text-[11px] text-[#111110] hover:bg-[#fafaf9] hover:border-[#c4c4be] transition-colors">
                              <span className="text-[13px]">
                                {/\.pdf$/i.test(f.file_name) ? '📄' :
                                 /\.(jpe?g|png|heic|heif)$/i.test(f.file_name) ? '🖼️' :
                                 /\.docx?$/i.test(f.file_name) ? '📝' :
                                 /\.xlsx?$/i.test(f.file_name) ? '📊' : '📎'}
                              </span>
                              <span className="max-w-[140px] truncate font-medium">{f.file_name}</span>
                              {f.file_size && (
                                <span className="text-[#9a9a95] flex-shrink-0 font-mono">
                                  {f.file_size < 1024 * 1024
                                    ? `${(f.file_size / 1024).toFixed(0)} КБ`
                                    : `${(f.file_size / (1024 * 1024)).toFixed(1)} МБ`}
                                </span>
                              )}
                            </a>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            )
          })}
        </div>
          <Pagination
            page={page} total={visible.length} pageSize={PAGE_SIZE}
            onPageChange={setPage} className="mt-4"
          />
        </>
      )}

      {/* ── Delete modal ────────────────────────────────────────────────────── */}
      {deletingId !== null && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h2 className="text-[16px] font-semibold text-[#111110] mb-1">Удалить расчёт?</h2>
            <p className="text-[13px] text-[#6b6b66] mb-5">Это действие нельзя отменить.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeletingId(null)}
                className="flex-1 py-2.5 rounded-lg border border-[#e4e4e0] text-[13px] font-medium text-[#6b6b66] hover:bg-[#f8f8f7] transition-colors">
                Отмена
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex-1 py-2.5 rounded-lg bg-red-600 text-white text-[13px] font-medium hover:bg-red-700 disabled:opacity-40 transition-colors">
                {deleting ? 'Удаление...' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
