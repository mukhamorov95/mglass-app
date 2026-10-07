'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'
import Pagination from '@/components/Pagination'
import { buildInstallationHref } from '@/components/AssignInstallationButton'
import { computeProductionSummary, type MatLight } from '@/lib/productionSummary'
import type { UserPermissions } from '@/lib/permissions'
import { isMGlassClient, isMGlassOnlyUser, MGLASS_SCOPE_ERROR } from '@/lib/b2bScope'
import { orderContribution, applyCatalogWaste, buildWasteNorms, contributionColor, rub, pct } from '@/lib/unitEconomics'
import { hasAutoOverride, finalTotalOf } from '@/lib/b2b/priceOverride'
import type { PriceApproval } from '@/lib/b2b/priceOverride'
import { buildClientTimeline } from '@/lib/b2b/clientTimeline'
import { checkSavedItems } from '@/lib/b2b/bomCheck'
import { DEFAULT_B2B_RATES, marginTone, ratesFromRows, type B2BRates, type RateRow } from '@/lib/b2b/rates'
import { toast } from '@/lib/toast'
import { promptDialog } from '@/lib/dialog'
import { writeFailure } from '@/lib/rlsWrite'
import { saveOrderNotes } from '@/lib/b2b/orderNotesClient'
import type { LaunchResult } from '@/lib/b2b/launchOrder'
import LaunchPanel from '@/components/b2b/LaunchPanel'
import { copyOrShow } from '@/lib/b2b/copyOrShow'
import { matchScore } from '@/lib/search/translitMatch'
import { buildProductionMessage, productionMessageSummary } from '@/lib/b2b/productionMessage'
import { duplicateOrder } from '@/lib/b2b/duplicateOrder'
import RowMenu, { type MenuItem } from '@/components/RowMenu'
import { buildTelegramWorkText } from '@/lib/b2b/telegramWorkText'
import { LEAD_REPLY_TEMPLATES, clientQuoteTextFromOrder, quoteLeadChips, readQuoteLead } from '@/lib/b2b/leadQuote'
import type { InvoiceOrder } from '@/lib/b2b/invoiceMath'
import { SkeletonTable } from '@/components/ui/Skeleton'


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
  // Ручная цена позиции: договорная (manualTotal) или разложенная из корректировки итога.
  manualTotal?: number | null
  manualAuto?: boolean
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

type TabKey = QuoteStatus | 'all' | 'needs_transfer' | 'today' | 'templates' | 'price_approval'

// Запущенные в работу (sent/confirmed) — это уже заказы, они живут в /b2b-orders
// и в просчётах не показываются. Здесь — только активные просчёты.
const ALL_TABS: { key: TabKey; label: string }[] = [
  { key: 'all',              label: 'Активные' },
  { key: 'today',            label: 'Сегодня' },
  { key: 'needs_transfer',   label: 'Требуют переноса' },
  { key: 'quote',            label: 'Черновики' },
  { key: 'agreed',           label: 'Согласовано' },
  { key: 'rejected',         label: 'Отказ' },
  { key: 'templates',        label: 'Шаблоны' },
  { key: 'price_approval',   label: '⚠️ Согласовать цену' },
]

// А11: цена с тонкой маржой ждёт решения владельца (не блокируется).
const approvalOf = (q: { notes: string | null }): PriceApproval | null => {
  const a = parseNotes(q.notes).price_approval
  return a && typeof a === 'object' ? a as PriceApproval : null
}
const needsPriceApproval = (q: { notes: string | null }) => approvalOf(q)?.needed === true

// А3: шаблон — обычный просчёт с notes.is_template. Отдельной таблицы не заводим:
// шаблон должен считаться тем же движком и открываться тем же калькулятором.
const isTemplate = (q: { notes: string | null }) => parseNotes(q.notes).is_template === true

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

  // «Запустить в работу» — общая панель components/b2b/LaunchPanel (та же в карточке сделки)
  const [workDateId, setWorkDateId]   = useState<number | null>(null)
  const [queueCount, setQueueCount] = useState<number | null>(null)  // А6: заказов в работе
  // А13: свободный остаток стекла по названию материала (м²). Склад читаем через
  // /api/inventory/items — напрямую к таблицам браузер не ходит (там RLS deny-by-default).
  const [stock, setStock] = useState<Map<string, number>>(new Map())
  const [stockErr, setStockErr] = useState(false)  // «—» в колонке без этого читалось бы как «на складе нет»

  // Delete modal
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleting, setDeleting]     = useState(false)

  // Уведомления — общий <Toaster />: успех гаснет сам, ошибка висит до закрытия.
  const showToast = (msg: string) => toast.success(msg)
  const showError = (title: string, detail?: string) => toast.error(title, detail ? { detail } : undefined)

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
      await promptDialog({
        title: 'Скопируйте текст для Telegram',
        text: 'Буфер обмена недоступен — текст выделен, скопируйте его (⌘C / Ctrl+C).',
        defaultValue: text, multiline: true, confirmLabel: 'Готово',
      })
    }
  }

  // Ответ клиенту в чат (Авито и др.) по сохранённому просчёту — суммы строк как в счёте.
  async function copyClientText(q: Quote) {
    const notes = parseNotes(q.notes)
    const text = clientQuoteTextFromOrder(q as unknown as InvoiceOrder, notes)
    const label = readQuoteLead(notes).source === 'avito' ? 'Текст для Авито' : 'Текст клиенту'
    try {
      await navigator.clipboard.writeText(text)
      showToast(`${label} скопирован`)
    } catch {
      await promptDialog({
        title: `Скопируйте: ${label.toLowerCase()}`,
        text: 'Буфер обмена недоступен — текст выделен, скопируйте его (⌘C / Ctrl+C).',
        defaultValue: text, multiline: true, confirmLabel: 'Готово',
      })
    }
  }

  async function copyReplyTemplate(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      showToast(`«${label.replace('📋 ', '')}» скопировано`)
    } catch {
      await promptDialog({
        title: `Скопируйте: ${label.replace('📋 ', '').toLowerCase()}`,
        text: 'Буфер обмена недоступен — текст выделен, скопируйте его (⌘C / Ctrl+C).',
        defaultValue: text, multiline: true, confirmLabel: 'Готово',
      })
    }
  }

  // ── Payment status ──────────────────────────────────────────────────────────
  const [payEditId, setPayEditId]   = useState<number | null>(null)
  const [payAmount, setPayAmount]   = useState('')
  const payAmountRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (payEditId !== null) setTimeout(() => payAmountRef.current?.focus(), 50)
  }, [payEditId])

  // ── Правка цены: итог ⇄ скидка (одна панель, два способа думать) ───────────
  // Источник правды — целевой ИТОГ. Скидка выводится из него и раскладывается по
  // позициям на сервере (/api/b2b-quotes/[id]/adjust-total), чтобы КП, счёт и
  // производство видели ту же цену построчно.
  const [discountEditId, setDiscountEditId] = useState<number | null>(null)
  const [discountInput, setDiscountInput]   = useState('')
  const [totalInput, setTotalInput]         = useState('')
  const [priceSaving, setPriceSaving]       = useState(false)
  // Второй клик по кнопке при тонкой марже: не запрещаем цену, но заставляем осознать доход.
  const [priceConfirmId, setPriceConfirmId] = useState<number | null>(null)
  // Пороги маржи — справочник b2b_rates, тот же, по которому сервер ставит согласование.
  const [marginRates, setMarginRates] = useState<Pick<B2BRates, 'marginTarget' | 'marginMin'>>(DEFAULT_B2B_RATES)
  useEffect(() => {
    createClient().from('b2b_rates').select('key, value').in('key', ['margin_target', 'margin_min'])
      .then(({ data, error }) => { if (!error && data) setMarginRates(ratesFromRows(data as RateRow[]).rates) })
  }, [])
  const totalInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (discountEditId !== null) setTimeout(() => { totalInputRef.current?.focus(); totalInputRef.current?.select() }, 50)
  }, [discountEditId])

  function openPriceEditor(q: Quote) {
    setPriceConfirmId(null)
    if (discountEditId === q.id) { setDiscountEditId(null); return }
    setDiscountEditId(q.id)
    setTotalInput(String(finalTotalOf(q)))
    setDiscountInput(String(q.discount_percent ?? 0))
  }

  // Инпуты связаны: правишь сумму — пересчитывается %, правишь % — сумма.
  function onTotalTyped(v: string, base: number) {
    setPriceConfirmId(null)
    setTotalInput(v)
    const t = Number(v.replace(/[^\d.]/g, ''))
    setDiscountInput(base > 0 && Number.isFinite(t) ? String(Math.round((1 - t / base) * 1000) / 1000) : '0')
  }
  function onDiscountTyped(v: string, base: number) {
    setPriceConfirmId(null)
    setDiscountInput(v)
    const d = Number(v.replace(/[^\d.-]/g, ''))
    setTotalInput(Number.isFinite(d) ? String(Math.round(base * (1 - d / 100))) : String(base))
  }

  // Оплата пишется только через /api/b2b-orders/[id]/payment — там же
  // наполняются денежное ядро и ведомость продаж (Д2).
  async function savePayStatus(id: number, status: PaymentStatus, amount?: number) {
    const q = quotes.find(q => q.id === id)
    if (!q) return
    const r = await fetch(`/api/b2b-orders/${id}/payment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, amount }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { showError('Оплата не отмечена', d.error ?? `Сервер ответил ${r.status}`); return }
    const newNotes = JSON.stringify(d.notes ?? {})
    const meta = buildUpdateMeta()
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
      showError(MGLASS_SCOPE_ERROR)
      return
    }
    // Возврат в черновик снимает признак запуска (колонку и notes), чтобы просчёт снова
    // грузился в этот список (мы грузим только launched_at IS NULL). Патч собирает сервер
    // из свежих notes — копия вкладки не затирает ответ клиента, согласование, ссылку.
    const r = await saveOrderNotes(id, { action: 'status', to: newStatus, revertToDraft: newStatus === 'quote' })
    if (r.error !== null) { showError('Статус не изменён', r.error); return }
    const saved = r.data
    setQuotes(prev => prev.map(x => x.id === id ? { ...x, ...(saved.columns as Partial<Quote>), notes: saved.notes } : x))
    showToast(`Статус → ${STATUS_META[newStatus as QuoteStatus]?.label ?? newStatus}`)
  }

  async function confirmStatusChange() {
    if (!pendingChange) return
    const q = quotes.find(q => q.id === pendingChange.quoteId)
    if (!q) return
    if (mglassOnly && !isMGlassClient({ id: q.client_id ?? undefined, name: q.client_name })) {
      showError(MGLASS_SCOPE_ERROR)
      setPendingChange(null)
      setPendingComment('')
      return
    }
    const r = await saveOrderNotes(pendingChange.quoteId, { action: 'status', to: pendingChange.status, comment: pendingComment || null })
    if (r.error !== null) { showError('Статус не изменён', `${r.error}. Комментарий остался в окне — нажмите ещё раз`); return }
    const saved = r.data
    setQuotes(prev => prev.map(x => x.id === pendingChange.quoteId ? { ...x, ...(saved.columns as Partial<Quote>), notes: saved.notes } : x))
    showToast(`Статус → ${STATUS_META[pendingChange.status as QuoteStatus]?.label ?? pendingChange.status}`)
    setPendingChange(null)
    setPendingComment('')
  }

  function openLaunch(q: Quote) {
    if (mglassOnly && !isMGlassClient({ id: q.client_id ?? undefined, name: q.client_name })) {
      showError(MGLASS_SCOPE_ERROR)
      return
    }
    setWorkDateId(q.id)
  }

  // После запуска — следующий шаг сразу в тосте: производственное сообщение в чат цеха
  // (тот же сборщик, что кнопка 📋 в /b2b-orders), из строки с номером, который дал запуск.
  function onLaunched(id: number, { saved, tasksOk }: LaunchResult) {
    const q = quotes.find(x => x.id === id)
    setQuotes(prev => prev.map(x => x.id === id ? { ...x, ...(saved.columns as Partial<Quote>), notes: saved.notes } : x))
    setWorkDateId(null)
    if (!q) { showToast('Запущено в работу'); return }
    const msgOrder = { ...q, ...(saved.columns as Partial<Quote>) }
    toast.success('Запущено в работу', {
      detail: tasksOk ? 'Задачи цеху созданы. Отправьте производственное сообщение в рабочий чат.' : 'Задачи цеху не создались — повторите из сообщения об ошибке.',
      action: {
        label: '📋 Произв. сообщение',
        onClick: () => {
          void copyOrShow(buildProductionMessage(msgOrder), {
            ok: 'Производственное сообщение скопировано', title: 'Скопируйте производственное сообщение',
            detail: productionMessageSummary(msgOrder),
          })
        },
      },
      durationMs: 15000,
    })
  }

  // ── Load ───────────────────────────────────────────────────────────────────
  async function loadQuotes() {
    setLoading(true)
    setLoadError(null)
    const sb = createClient()
    try {
      const { data: { user } } = await sb.auth.getUser()
      if (!user) { return }

      const { data: profile, error: profileErr } = await sb
        .from('users')
        .select('role, name, see_all_orders, permissions')
        .eq('id', user.id)
        .single()
      // Нет строки (PGRST116) — как раньше, без профиля; сбой запроса — не показываем
      // урезанный список как полный.
      if (profileErr && profileErr.code !== 'PGRST116') throw new Error(`профиль: ${profileErr.message}`)

      setUserRole(profile?.role ?? null)
      setCurrentUserId(user.id)
      setCurrentUserName((profile?.name as string) || user.email || null)
      const isOwner = profile?.role === 'admin' || profile?.role === 'ceo'
      const perms = (profile?.permissions ?? null) as UserPermissions | null
      // Owners are never scope-restricted.
      setMglassOnly(!isOwner && isMGlassOnlyUser(perms))
      const canSeeAll = profile?.role === 'admin' || profile?.role === 'buyer' || profile?.see_all_orders === true

      // А13: остатки склада — справочно, ошибка загрузки не ломает список просчётов.
      fetch('/api/inventory/items?contour=all')
        // 403 — склад закрыт роли: колонка пустая по праву, а не из-за сбоя.
        .then(r => r.ok ? r.json() : r.status === 403 ? { items: [] } : null)
        .then((j: { items?: { name: string; qty: number; qty_reserved: number; unit: string }[] } | null) => {
          if (!j?.items) { setStockErr(true); return }
          const m = new Map<string, number>()
          for (const it of j.items) {
            if (it.unit !== 'м2') continue
            const free = Number(it.qty ?? 0) - Number(it.qty_reserved ?? 0)
            const key = it.name.trim().toLowerCase()
            m.set(key, (m.get(key) ?? 0) + free)
          }
          setStock(m)
          setStockErr(false)
        })
        .catch(() => setStockErr(true))

      // А6: очередь производства — сколько заказов уже запущено и ещё не отгружено.
      // Нужна как честный контекст при выборе срока сдачи (мощность цеха в системе
      // не описана, поэтому ничего не выдумываем — показываем факт очереди).
      sb.from('b2b_orders')
        .select('id', { count: 'exact', head: true })
        .is('archived_at', null)
        .not('launched_at', 'is', null)
        .not('notes', 'ilike', '%shipped_date%')
        .then(({ count }) => setQueueCount(count ?? null))

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
        const { data: myClients, error: clientsErr } = await sb
          .from('b2b_clients')
          .select('id')
          .eq('manager_id', user.id)
        if (clientsErr) throw new Error(`клиенты: ${clientsErr.message}`)
        const myClientIds = (myClients ?? []).map((c: { id: number }) => c.id)
        if (myClientIds.length > 0) {
          ordersQuery = ordersQuery.or(`created_by.eq.${user.id},client_id.in.(${myClientIds.join(',')})`)
        } else {
          ordersQuery = ordersQuery.eq('created_by', user.id)
        }
      }

      const [{ data: orders, error: ordersErr }, { data: attaches, error: attachErr }, { data: mats, error: matsErr }] = await Promise.all([
        ordersQuery,
        sb.from('b2b_calculation_attachments').select('*').order('created_at', { ascending: false }).limit(5000),
        sb.from('b2b_materials').select('name,thickness,sheet_width,sheet_height,cost_price,waste_percent').eq('active', true),
      ])
      // Пустой список при сбое читался бы как «просчётов нет» — показываем ошибку с «Повторить».
      if (ordersErr) throw new Error(ordersErr.message)
      if (attachErr || matsErr) {
        showError('Часть данных не загрузилась', `${[attachErr && `вложения: ${attachErr.message}`, matsErr && `материалы: ${matsErr.message}`].filter(Boolean).join('; ')}. Себестоимость и сводка по материалам могут быть неполными — обновите страницу`)
      }
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
    // Автор дубля — текущий пользователь (не исходный менеджер). Копия/«из шаблона» —
    // обычный черновик: следы жизни исходного заказа не переносим (lib/b2b/duplicateOrder).
    const { data, error } = await duplicateOrder(createClient(), q, { managerName: currentUserName ?? null })
    if (error || !data) { showError('Копия не создана', error ?? undefined); return }
    setQuotes(prev => [{ ...(data as unknown as Quote), items: q.items }, ...prev])
    showToast(isTemplate(q) ? 'Просчёт создан из шаблона' : 'Расчёт скопирован как черновик')
  }

  // А2: ссылка на КП для клиента — выдаём и сразу кладём в буфер обмена.
  const [sharing, setSharing] = useState<number | null>(null)
  async function shareQuote(q: Quote) {
    setSharing(q.id)
    try {
      const r = await fetch(`/api/b2b-quotes/${q.id}/share`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { showError('Ссылка на КП не создана', j.error || `Сервер ответил ${r.status}`); return }
      const parsed = parseNotes(q.notes)
      if (!parsed.public_token) {
        const newNotes = JSON.stringify({ ...parsed, public_token: j.token })
        setQuotes(prev => prev.map(x => x.id === q.id ? { ...x, notes: newNotes } : x))
      }
      try {
        await navigator.clipboard.writeText(j.url)
        showToast('Ссылка на КП скопирована — можно отправлять клиенту')
      } catch {
        await promptDialog({
          title: 'Ссылка на КП для клиента',
          text: 'Буфер обмена недоступен — ссылка выделена, скопируйте её (⌘C / Ctrl+C).',
          defaultValue: j.url, confirmLabel: 'Готово',
        })
      }
    } finally { setSharing(null) }
  }

  // А11: решение владельца по цене с тонкой маржой. Цену не трогаем — решение
  // снимает пометку и остаётся в истории просчёта.
  const [approving, setApproving] = useState<number | null>(null)
  async function resolvePriceApproval(id: number, resolution: 'approved' | 'rejected') {
    setApproving(id)
    try {
      const r = await fetch(`/api/b2b-quotes/${id}/price-approval`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { showError('Решение по цене не сохранено', j.error || `Сервер ответил ${r.status}`); return }
      setQuotes(prev => prev.map(x => x.id === id
        ? { ...x, notes: JSON.stringify({ ...parseNotes(x.notes), price_approval: j.approval }) }
        : x))
      showToast(resolution === 'approved' ? 'Цена согласована' : 'Цена отклонена — менеджер пересоберёт')
    } finally { setApproving(null) }
  }

  // А3: пометить/снять шаблон. Шаблон не мешается в активных вкладках и служит
  // заготовкой для повторяющихся заказов клиента.
  async function toggleTemplate(q: Quote) {
    const next = !isTemplate(q)
    const r = await saveOrderNotes(q.id, { action: 'template', value: next })
    if (r.error !== null) { showError(next ? 'Не добавлено в шаблоны' : 'Не убрано из шаблонов', r.error); return }
    const saved = r.data
    setQuotes(prev => prev.map(x => x.id === q.id ? { ...x, ...(saved.columns as Partial<Quote>), notes: saved.notes } : x))
    showToast(next ? 'Добавлено в шаблоны' : 'Убрано из шаблонов')
  }

  async function handleDelete() {
    if (!deletingId) return
    setDeleting(true)
    const archiveRes = await createClient()
      .from('b2b_orders')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', deletingId)
      .select('id')
    const archiveFail = writeFailure(archiveRes)
    if (archiveFail) { setDeleting(false); showError('Просчёт не архивирован', archiveFail); return }
    setQuotes(prev => prev.filter(q => q.id !== deletingId))
    setDeletingId(null)
    setDeleting(false)
    showToast('Просчёт архивирован')
  }

  // Ручная корректировка итога: сумму раскидывает сервер (общий алгоритм +
  // история в notes.total_history), фронт только показывает результат.
  async function savePriceOverride(id: number) {
    const target = Math.round(Number(totalInput.replace(/[^\d.]/g, '')) || 0)
    if (target <= 0) { toast.info('Укажите итоговую сумму'); return }
    setPriceSaving(true)
    try {
      const res  = await fetch(`/api/b2b-quotes/${id}/adjust-total`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newTotal: target }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { showError('Сумма не сохранена', `${json.error || `Сервер ответил ${res.status}`}. Сумма осталась в поле — нажмите ещё раз`); return }
      applyPriceResult(id, json)
      setDiscountEditId(null)
      setPriceConfirmId(null)
      const marginPart = json.marginPercent != null ? ` · маржа ${json.marginPercent}%` : ''
      showToast(json.discountPercent > 0
        ? `Итог ${fmt(json.newTotal)} · скидка ${json.discountPercent}% разложена по позициям${marginPart}`
        : `Итог ${fmt(json.newTotal)} разложен по позициям${marginPart}`)
    } finally { setPriceSaving(false) }
  }

  async function resetPriceOverride(id: number) {
    setPriceSaving(true)
    try {
      const res  = await fetch(`/api/b2b-quotes/${id}/adjust-total`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { showError('Прайс не возвращён', json.error || `Сервер ответил ${res.status}`); return }
      applyPriceResult(id, json)
      setDiscountEditId(null)
      showToast('Цены возвращены к прайсу')
    } finally { setPriceSaving(false) }
  }

  function applyPriceResult(id: number, json: { newTotal: number; discountPercent: number; marginPercent?: number; items?: OrderItem[]; notes?: string }) {
    setQuotes(prev => prev.map(x => x.id === id ? {
      ...x,
      items:                (json.items as OrderItem[]) ?? x.items,
      discount_percent:     json.discountPercent,
      total_after_discount: json.newTotal,
      margin_percent:       json.marginPercent ?? x.margin_percent,
      notes:                json.notes ?? x.notes,
    } : x))
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
    if (tab === 'price_approval') list = quotes.filter(needsPriceApproval)
    else if (tab === 'templates') list = quotes.filter(isTemplate)
    else if (tab === 'all') list = quotes.filter(q => notLaunched(q) && !isTemplate(q))
    else if (tab === 'today') list = quotes.filter(q => notLaunched(q) && !isTemplate(q) && isToday(q.created_at))
    else if (tab === 'needs_transfer') list = quotes.filter(q => looksLikeOrder(q) && !isTemplate(q))
    else list = quotes.filter(q => !isTemplate(q) && getStatus(q) === tab)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(x =>
        x.client_name.toLowerCase().includes(q) ||
        (x.custom_number ?? '').toLowerCase().includes(q) ||
        (x.client_order_number ?? '').toLowerCase().includes(q) ||
        String(x.id).includes(q) ||
        // Клиент и контакт из чата — в обоих алфавитах (О8): «шо» → Shower Glass.
        (/\p{L}/u.test(q) && matchScore(q, [x.client_name, readQuoteLead(parseNotes(x.notes)).contact]) > 0)
      )
    }
    return list
  }, [quotes, tab, search])

  // «Остаётся с заказа» по просчётам — тем же расчётом, что на экране экономики заказа
  // (lib/unitEconomics): выручка − переменные − НДС к уплате. Одна цифра на всю систему.
  const isOwner = userRole === 'admin' || userRole === 'ceo'
  const contributionByQuote = useMemo(() => {
    const m = new Map<number, { amount: number; pct: number }>()
    // Расход материала — по нормативу справочника (решение владельца 16.09: раскрой
    // расход не считает), так же как на экране экономики заказа
    const norms = buildWasteNorms(materials as unknown as Record<string, unknown>[])
    for (const q of visible) {
      const c = orderContribution(q.total_after_discount || q.total_sale_inc_vat || 0, applyCatalogWaste(q.items as unknown as Record<string, unknown>[], norms))
      if (c.revenue > 0) m.set(q.id, { amount: c.contribution, pct: c.contributionPct })
    }
    return m
  }, [visible, materials])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, today: 0, needs_transfer: 0, templates: 0, price_approval: 0 }
    for (const q of quotes) {
      if (isTemplate(q)) { c.templates++; continue }
      const s = getStatus(q); c[s] = (c[s] ?? 0) + 1
      if (notLaunched(q)) { c.all++; if (isToday(q.created_at)) c.today++ }
      if (looksLikeOrder(q)) c.needs_transfer++
      if (needsPriceApproval(q)) c.price_approval++
    }
    return c
  }, [quotes])

  if (loading) return (
    <SkeletonTable rows={10} />
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

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
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
            className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-[#111110] bg-white flex-1 sm:flex-none sm:w-52 min-w-0"
          />
          <Link href="/calculator/b2b"
            className="bg-[#111110] text-white text-[12px] font-medium px-3 py-1.5 rounded-lg hover:bg-[#2a2a28] transition-colors whitespace-nowrap">
            + Новый расчёт
          </Link>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1 mb-4 flex-wrap">
        {/* А11: вкладка согласования цены появляется, только когда есть что решать */}
        {ALL_TABS.filter(t => t.key !== 'price_approval' || (counts.price_approval ?? 0) > 0).map(t => (
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
            const dateStr   = quoteDate.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' })
            const timeStr   = quoteDate.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })
            const finalPrice = finalTotalOf(quote)
            const userNotes  = typeof parsed.user_notes === 'string' ? parsed.user_notes : null
            const statusComment = typeof parsed.status_comment === 'string' ? parsed.status_comment : null
            const hasAttach  = attachments.some(a => a.order_id === quote.id)
            const isPendingThis      = pendingChange?.quoteId === quote.id
            const isPayEditThis      = payEditId === quote.id
            const isWorkDateThis     = workDateId === quote.id
            const isDiscountEditThis = discountEditId === quote.id
            const workStartedAt      = parsed.work_started_at ? String(parsed.work_started_at) : null
            const isPartnerFrom = (quote as { source?: string }).source === 'partner'
            const isPartnerReq  = isPartnerFrom && (parsed.status === 'pending_approval' || !!parsed.submitted_by_partner_at)
            const aiReview = (parsed.ai_review && typeof parsed.ai_review === 'object')
              ? parsed.ai_review as { issues?: { severity?: string; text?: string }[]; summary?: string }
              : null

            // Превью корректировки — считается один раз на строку, арифметика дешёвая.
            // Источник — введённый ИТОГ; скидка/маржа выводятся из него.
            const discBase      = quote.total_sale_inc_vat
            const discNewTotal  = Math.max(0, Math.round(Number(totalInput.replace(/[^\d.]/g, '')) || 0))
            const discNewPct    = discBase > 0 ? Math.round((1 - discNewTotal / discBase) * 1000) / 10 : 0
            const discCost      = quote.total_cost_net ?? 0
            const discRevExVat  = discNewTotal * 100 / (100 + 22)
            const discProfit    = discRevExVat - discCost
            const discMargin    = discRevExVat > 0 ? (discProfit / discRevExVat * 100) : 0
            const isOverridden  = hasAutoOverride(quote.items) || !!parsed.price_override
            const approval      = approvalOf(quote)
            // А2/А5: состояние клиентской ссылки — отправлена, открыта, отвечено
            const shareToken   = typeof parsed.public_token === 'string' ? parsed.public_token : null
            const shareOpened  = typeof parsed.public_opened_at === 'string' ? parsed.public_opened_at : null
            const clientAnswer = (parsed.client_response && typeof parsed.client_response === 'object')
              ? parsed.client_response as { action?: string; comment?: string | null; at?: string }
              : null
            const overrideMeta  = (parsed.price_override && typeof parsed.price_override === 'object')
              ? parsed.price_override as { base?: number; target?: number; discount_percent?: number; at?: string; by_name?: string | null }
              : null

            return (
              <div key={quote.id} className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">

                {/* ── Row header ─────────────────────────────────────────── */}
                {/* На телефоне строка складывается в две: сверху описание, снизу
                    цена и кнопки. Иначе неразрывный правый блок сжимает текст
                    до одного слова в строку. */}
                <div className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">

                  {/* Expand toggle + info */}
                  <button
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    onClick={() => setExpanded(isOpen ? null : quote.id)}>
                    <span className="text-[11px] font-bold text-[#c4c4be] flex-shrink-0">#{quote.id}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isPartnerReq && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">🤝 Заявка партнёра · проверить</span>
                        )}
                        {isPartnerFrom && !isPartnerReq && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#f0f0ec] text-[#6b6b66]">🤝 от партнёра</span>
                        )}
                        {quote.custom_number && (
                          <span className="text-[13px] font-bold font-mono text-[#111110]">{quote.custom_number}</span>
                        )}
                        {quote.client_order_number && (
                          <span className="text-[11px] font-mono text-[#6b6b66] bg-[#f0f0ec] px-1.5 py-0.5 rounded">
                            кл. {quote.client_order_number}
                          </span>
                        )}
                        <p className="text-[13px] font-semibold text-[#111110] truncate">{quote.client_name}</p>
                        {quoteLeadChips(readQuoteLead(parsed), quote.client_id != null).map(chip => (
                          <span key={chip} className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${chip === 'без заказчика' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-[#f0f0ec] text-[#6b6b66]'}`}>{chip}</span>
                        ))}
                        {isOverridden && (
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap"
                            title={overrideMeta
                              ? `Итог задан вручную: ${fmt(overrideMeta.base ?? quote.total_sale_inc_vat)} → ${fmt(overrideMeta.target ?? finalPrice)}`
                                + `${overrideMeta.discount_percent ? ` (скидка ${overrideMeta.discount_percent}%)` : ''}`
                                + `${overrideMeta.by_name ? ` · ${overrideMeta.by_name}` : ''}`
                                + `${overrideMeta.at ? ` · ${new Date(String(overrideMeta.at)).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}` : ''}`
                              : 'Цены позиций заданы вручную'}>
                            ✏️ ручная корректировка
                          </span>
                        )}
                        {approval && (
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${
                              approval.needed ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : approval.resolution === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-red-50 text-red-600 border-red-200'}`}
                            title={approval.needed
                              ? `Маржа ${approval.margin}% при цене ${fmt(approval.total)} — ждёт решения владельца`
                              : `${approval.resolution === 'approved' ? 'Согласовал' : 'Отклонил'}: ${approval.resolved_by_name ?? '—'}`}>
                            {approval.needed ? `⚠️ цена на согласовании · ${approval.margin}%`
                              : approval.resolution === 'approved' ? '✓ цена согласована'
                              : '✕ цена отклонена'}
                          </span>
                        )}
                        {shareToken && (
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${
                              clientAnswer?.action === 'approve' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : clientAnswer?.action === 'question' ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : shareOpened ? 'bg-[#f0f0ec] text-[#6b6b66] border-[#e4e4e0]'
                              : 'bg-white text-[#9a9a95] border-[#e4e4e0]'}`}
                            title={clientAnswer?.comment
                              ? `Клиент: ${clientAnswer.comment}`
                              : shareOpened ? `Клиент открыл ${new Date(shareOpened).toLocaleString('ru-RU')}` : 'Ссылка выдана'}>
                            {clientAnswer?.action === 'approve' ? '🔗 клиент согласовал'
                              : clientAnswer?.action === 'question' ? '🔗 вопрос от клиента'
                              : shareOpened ? '🔗 клиент открыл' : '🔗 ссылка выдана'}
                          </span>
                        )}
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

                  <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap sm:flex-shrink-0">

                    {/* Сколько остаётся с заказа — до запуска в работу. Себестоимость внутренняя: только владельцу. */}
                    {isOwner && contributionByQuote.has(quote.id) && (() => {
                      const { amount, pct: pctValue } = contributionByQuote.get(quote.id)!
                      const tone = contributionColor(pctValue)
                      const cls = tone === 'red' ? 'bg-red-50 text-red-600' : tone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                      return (
                        <Link href={`/cfo/order-economics/${quote.id}`}
                          title={`Остаётся с заказа ${rub(amount)} ₽ — выручка минус материал, закалка, доставка, упаковка и НДС. Клик — как посчитано.`}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cls} hover:ring-1 hover:ring-current`}>
                          остаётся {pct(pctValue)}%
                        </Link>
                      )
                    })()}
                    {/* Низкая маржа по системе — только не-владельцам (у владельца выше честная) */}
                    {!isOwner && (quote.margin_percent ?? 0) > 0 && quote.margin_percent < 15 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600" title="Маржа ниже 15%">
                        ⚠️ {quote.margin_percent}%
                      </span>
                    )}

                    {/* Спецификация не сходится со справочником: позиция без себестоимости */}
                    {(() => {
                      const bom = checkSavedItems(quote.items)
                      if (bom.length === 0) return null
                      return (
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 whitespace-nowrap"
                          title={bom.map(i => i.detail).join('\n')}>
                          ⚠️ нет в справочнике: {bom.length}
                        </span>
                      )
                    })()}

                    {/* "На согласовании" — только этот статус показываем плашкой, он требует action */}
                    {status === 'pending_approval' && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${sMeta.bg} ${sMeta.text}`}>
                        {sMeta.label}
                      </span>
                    )}

                    {/* Цена — кликабельная: правится прямо в списке */}
                    <div className="text-right min-w-[80px]">
                      <button
                        onClick={() => openPriceEditor(quote)}
                        title="Изменить итоговую сумму — скидка разложится по всем позициям"
                        className={`text-[13px] font-semibold text-[#111110] hover:text-emerald-700 hover:underline decoration-dotted underline-offset-2 transition-colors ${isDiscountEditThis ? 'text-emerald-700 underline' : ''}`}>
                        {fmt(finalPrice)}
                      </button>
                      <button
                        onClick={() => openPriceEditor(quote)}
                        className="block ml-auto text-[10px] leading-tight text-emerald-600 hover:text-emerald-800 hover:underline">
                        {(quote.discount_percent ?? 0) > 0 ? `−${quote.discount_percent}% · изм.` : '✏️ изм. цену'}
                      </button>
                    </div>

                    {/* Status actions */}
                    <div className="flex items-center gap-1">
                      {isOwner && approval?.needed && (<>
                        <button onClick={() => resolvePriceApproval(quote.id, 'approved')} disabled={approving === quote.id}
                          title={`Маржа ${approval.margin}% — согласовать цену`}
                          className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 transition-colors whitespace-nowrap">
                          Цена ок
                        </button>
                        <button onClick={() => resolvePriceApproval(quote.id, 'rejected')} disabled={approving === quote.id}
                          className="text-[11px] font-medium px-2 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40 transition-colors whitespace-nowrap">
                          Отклонить
                        </button>
                      </>)}
                      {/* Согласование отключено: quote и agreed сразу запускаются в работу */}
                      {(status === 'quote' || status === 'agreed') && quote.client_id == null && (
                        <Link href={`/calculator/b2b?orderId=${quote.id}`}
                          title="Без заказчика в работу нельзя: выберите или создайте клиента и нажмите «Обновить просчёт»"
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] transition-colors whitespace-nowrap">
                          ＋ Заказчик →
                        </Link>
                      )}
                      {(status === 'quote' || status === 'agreed') && quote.client_id != null && (
                        <button
                          onClick={() => openLaunch(quote)}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] transition-colors whitespace-nowrap">
                          Запустить в работу →
                        </button>
                      )}
                      {status === 'sent' && (
                        <button onClick={() => requestStatusChange(quote.id, 'agreed')}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors whitespace-nowrap">
                          Согласовано
                        </button>
                      )}
                      {status === 'rejected' && (
                        <button onClick={() => requestStatusChange(quote.id, 'quote')}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f4] transition-colors whitespace-nowrap">
                          ↩ Вернуть в черновик
                        </button>
                      )}

                      {/* Остальное — в «⋯»: действия названы словами, опасное отдельно (У5) */}
                      <RowMenu items={[
                        { kind: 'link', label: '🗂 Карточка заказа', href: `/b2b-deal/${quote.id}` },
                        { kind: 'divider' },
                        { kind: 'link', label: '📄 КП — печать', href: `/b2b-quotes/${quote.id}/kp`, newTab: true },
                        { kind: 'link', label: '🧾 Счёт-спецификация', href: `/b2b-quotes/${quote.id}/invoice`, newTab: true },
                        { kind: 'link', label: '⬇ Скачать КП в PDF', href: `/api/quotes/${quote.id}/pdf`, newTab: true, external: true },
                        { label: sharing === quote.id ? '🔗 Готовлю ссылку…' : '🔗 Ссылка клиенту', onClick: () => shareQuote(quote), disabled: sharing === quote.id },
                        { label: copiedId === quote.id ? '✓ Текст скопирован' : '✈️ Текст для Telegram', onClick: () => copyTelegramText(quote) },
                        { label: readQuoteLead(parsed).source === 'avito' ? '📋 Текст для Авито' : '📋 Текст клиенту', onClick: () => { void copyClientText(quote) } },
                        // Ответы вдогонку — для входящих (Авито и др.) и просчётов без заказчика.
                        ...(!quote.client_id || readQuoteLead(parsed).source
                          ? LEAD_REPLY_TEMPLATES.map(t => ({ label: t.label, onClick: () => { void copyReplyTemplate(t.label, t.text) } }))
                          : []),
                        { kind: 'divider' },
                        { kind: 'link', label: '🧮 Открыть в калькуляторе', href: `/calculator/b2b?orderId=${quote.id}` },
                        { label: isTemplate(quote) ? '＋ Создать из шаблона' : '⧉ Дублировать', onClick: () => duplicateQuote(quote) },
                        { label: isTemplate(quote) ? '★ Убрать из шаблонов' : '☆ Сохранить как шаблон', onClick: () => toggleTemplate(quote) },
                        { kind: 'link', label: '🔧 Назначить монтаж', href: buildInstallationHref({ orderNo: quote.custom_number, clientName: quote.client_name, orderTotal: finalPrice }) },
                        ...(status === 'sent' ? [{ label: '✕ Отметить отказ', onClick: () => requestStatusChange(quote.id, 'rejected') }] : []),
                        ...(status === 'rejected' || status === 'sent' ? [{ label: '↩ Вернуть в черновик', onClick: () => requestStatusChange(quote.id, 'quote') }] : []),
                        { kind: 'divider' },
                        { label: '🗑 Удалить просчёт', onClick: () => setDeletingId(quote.id), danger: true },
                      ] as MenuItem[]} />
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

                {/* ── Правка цены: итог ⇄ скидка ─────────────────────────── */}
                {isDiscountEditThis && (
                  <div className="px-4 py-3 border-t border-[#f0f0ec] bg-[#fafaf9] space-y-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95]">
                      Итоговая сумма клиенту · {quote.items.length} поз.
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-[#6b6b66]">
                        Прайс: <span className="font-mono">{fmt(discBase)}</span>
                      </span>
                      <span className="text-[#c4c4be] select-none">→</span>
                      <span className="text-[11px] text-[#6b6b66]">Итог:</span>
                      <input
                        ref={totalInputRef}
                        type="text" inputMode="numeric"
                        className="w-32 bg-white border border-[#e4e4e0] rounded-lg px-2 py-1 text-[13px] font-mono text-right outline-none focus:border-[#111110] transition-colors"
                        value={totalInput}
                        onChange={e => onTotalTyped(e.target.value, discBase)}
                        onKeyDown={e => e.key === 'Enter' && savePriceOverride(quote.id)}
                      />
                      <span className="text-[12px] text-[#6b6b66]">₽</span>
                      <span className="text-[#c4c4be] select-none">или скидка</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number" step="0.5"
                          className="w-16 bg-white border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] font-mono text-center outline-none focus:border-[#111110] transition-colors"
                          value={discountInput}
                          onChange={e => onDiscountTyped(e.target.value, discBase)}
                          onKeyDown={e => e.key === 'Enter' && savePriceOverride(quote.id)}
                        />
                        <span className="text-[12px] text-[#6b6b66]">%</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-[#9a9a95]">
                      Сумма разложится по всем позициям пропорционально прайсу — КП, счёт и производство увидят те же цены.
                    </p>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-[11px] bg-white border border-[#f0f0ec] rounded-lg px-3 py-2 w-fit min-w-[240px]">
                      <span className="text-[#9a9a95]">Было к оплате</span>
                      <span className="font-mono text-right text-[#6b6b66]">{finalPrice.toLocaleString('ru-RU')} ₽</span>
                      <span className="text-[#9a9a95]">Станет к оплате</span>
                      <span className={`font-mono text-right font-semibold ${discNewTotal < finalPrice ? 'text-emerald-600' : discNewTotal > finalPrice ? 'text-amber-600' : 'text-[#111110]'}`}>
                        {discNewTotal.toLocaleString('ru-RU')} ₽
                      </span>
                      <span className="text-[#9a9a95]">{discNewPct >= 0 ? 'Скидка от прайса' : 'Надбавка к прайсу'}</span>
                      <span className="font-mono text-right text-[#6b6b66]">{Math.abs(discNewPct).toFixed(1)}%</span>
                      <span className="text-[#9a9a95]">Себестоимость</span>
                      <span className="font-mono text-right text-[#6b6b66]">{discCost.toLocaleString('ru-RU')} ₽</span>
                      <span className="text-[#9a9a95]">Заработок с заказа</span>
                      <span className={`font-mono text-right font-semibold ${discProfit < 0 ? 'text-red-600' : 'text-[#111110]'}`}>
                        {Math.round(discProfit).toLocaleString('ru-RU')} ₽
                      </span>
                      <span className="text-[#9a9a95]">Маржа</span>
                      <span className={`font-mono text-right font-semibold ${{ green: 'text-emerald-600', amber: 'text-amber-600', red: 'text-red-500' }[marginTone(discMargin, marginRates)]}`}>
                        {discMargin.toFixed(1)}%
                      </span>
                    </div>
                    {/* Цену не запрещаем — но менеджер обязан увидеть, сколько он на ней зарабатывает */}
                    {discNewTotal > 0 && (
                      discProfit <= 0 ? (
                        <p className="text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                          🚨 Осторожно: при цене {fmt(discNewTotal)} заказ уходит в убыток — минус {fmt(Math.abs(Math.round(discProfit)))}.
                          Это ниже себестоимости {fmt(discCost)}.
                        </p>
                      ) : discMargin < marginRates.marginMin ? (
                        <p className="text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                          ⚠️ Осторожно: при цене {fmt(discNewTotal)} заработок с заказа — {fmt(Math.round(discProfit))} ({discMargin.toFixed(1)}%).
                          Это ниже нормы {marginRates.marginMin}% — цена уйдёт на согласование владельцу.
                        </p>
                      ) : discMargin < marginRates.marginTarget ? (
                        <p className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          При цене {fmt(discNewTotal)} заработок с заказа — {fmt(Math.round(discProfit))} ({discMargin.toFixed(1)}%). Маржа тонковата.
                        </p>
                      ) : (
                        <p className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                          При цене {fmt(discNewTotal)} заработок с заказа — {fmt(Math.round(discProfit))} ({discMargin.toFixed(1)}%).
                        </p>
                      )
                    )}
                    <div className="flex items-center gap-2">
                      {(() => {
                        // Тонкая маржа не блокирует цену — но требует второго, осознанного клика.
                        const risky   = discNewTotal > 0 && (discProfit <= 0 || discMargin < marginRates.marginMin)
                        const armed   = priceConfirmId === quote.id
                        const confirm = risky && !armed
                        return (
                          <button
                            onClick={() => confirm ? setPriceConfirmId(quote.id) : savePriceOverride(quote.id)}
                            disabled={priceSaving || discNewTotal <= 0}
                            className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-40 transition-colors whitespace-nowrap ${
                              risky ? 'bg-red-600 hover:bg-red-700' : 'bg-[#111110] hover:bg-[#2a2a28]'}`}>
                            {priceSaving ? 'Сохраняю…'
                              : confirm ? `Зафиксировать ${fmt(discNewTotal)}?`
                              : armed   ? `Да, ${fmt(discNewTotal)} — я понимаю`
                              : 'Зафиксировать цену'}
                          </button>
                        )
                      })()}
                      {isOverridden && (
                        <button
                          onClick={() => resetPriceOverride(quote.id)}
                          disabled={priceSaving}
                          className="text-[11px] font-medium px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-white disabled:opacity-40 transition-colors whitespace-nowrap">
                          Вернуть прайс
                        </button>
                      )}
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
                  <LaunchPanel orderId={quote.id} initialNumber={quote.custom_number}
                    productionDays={Number(parseNotes(quote.notes).production_days) || null}
                    queueCount={queueCount}
                    onLaunched={res => onLaunched(quote.id, res)}
                    onCancel={() => setWorkDateId(null)} />
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

                    {/* AI-проверка логики просчёта партнёра */}
                    {aiReview && (aiReview.summary || (aiReview.issues?.length ?? 0) > 0) && (
                      <div className="px-4 py-2.5 border-b border-[#f0f0ec] bg-indigo-50/40">
                        <p className="text-[11px] font-semibold text-indigo-800 mb-1">🤖 AI-проверка логики просчёта партнёра</p>
                        {aiReview.summary && <p className="text-[11px] text-[#4b4b47] mb-1">{aiReview.summary}</p>}
                        {(aiReview.issues ?? []).map((iss, i) => (
                          <p key={i} className={`text-[11px] flex items-start gap-1.5 ${iss.severity === 'warn' ? 'text-amber-800' : 'text-[#6b6b66]'}`}>
                            <span className="flex-shrink-0">{iss.severity === 'warn' ? '⚠' : 'ℹ'}</span><span>{iss.text}</span>
                          </p>
                        ))}
                      </div>
                    )}

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
                            <th className="px-2 py-1.5 text-right w-16" title={stockErr ? 'Остатки склада не загрузились — «—» не значит, что стекла нет' : 'Свободный остаток на складе'}>
                              Склад{stockErr && <span className="block text-[9px] font-normal normal-case tracking-normal text-[#9a9a95]">остатки не загрузились</span>}
                            </th>
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
                                {(() => {
                                  const free = stock.get(String(item.materialName ?? '').trim().toLowerCase())
                                  const need = Number(item.totalAreaNet ?? 0)
                                  if (free == null) return <td className="px-2 py-1 text-right text-[#c4c4be]">—</td>
                                  const enough = free >= need
                                  return (
                                    <td className={`px-2 py-1 text-right font-mono whitespace-nowrap ${enough ? 'text-emerald-600' : 'text-red-600 font-semibold'}`}
                                      title={enough ? 'Хватает на эту позицию' : `Не хватает ${(need - free).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} м²`}>
                                      {free.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}
                                    </td>
                                  )
                                })()}
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
                            <td />
                            <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap text-[11px] text-[#6b6b66]">{fmt(quote.total_sale_inc_vat)}</td>
                            <td />
                          </tr>
                          {(quote.discount_percent ?? 0) > 0 && (
                            <tr className="bg-[#fafaf9]">
                              <td colSpan={11} className="px-2 py-0.5 text-right text-[11px] text-emerald-600">
                                Скидка {quote.discount_percent}%
                              </td>
                              <td className="px-2 py-0.5 text-right font-mono text-[11px] text-emerald-600 whitespace-nowrap">
                                −{fmt(quote.total_sale_inc_vat - finalPrice)}
                              </td>
                              <td />
                            </tr>
                          )}
                          {/* Итог берётся из сохранённого поля заказа. Если позиции правили
                              после сохранения, сумма колонки разойдётся — показываем это,
                              а не прячем (аудит итогов, A10). */}
                          {(() => {
                            const disc = Number(quote.discount_percent) || 0
                            const itemsSum = (quote.items ?? []).reduce((s, it) => {
                              if (it.manualTotal != null) return s + Number(it.manualTotal)
                              return s + Math.round(Number(it.saleIncVat ?? 0) * (1 - disc / 100))
                            }, 0)
                            const drift = Math.round(itemsSum) - Math.round(finalPrice)
                            return (
                              <>
                                <tr className="bg-[#fafaf9] border-t border-[#e4e4e0] font-semibold">
                                  <td colSpan={11} className="px-2 py-1.5 text-right text-[11px] text-[#111110]">Итого к оплате</td>
                                  <td className="px-2 py-1.5 text-right font-mono font-bold whitespace-nowrap text-[11px] text-[#111110]">{fmt(finalPrice)}</td>
                                  <td />
                                </tr>
                                {Math.abs(drift) > 1 && (
                                  <tr>
                                    <td colSpan={13} className="px-2 py-1 text-right text-[10px] text-amber-700">
                                      Сумма позиций {fmt(itemsSum)} — расходится с сохранённым итогом на {fmt(Math.abs(drift))}: позиции правили после сохранения просчёта
                                    </td>
                                  </tr>
                                )}
                              </>
                            )
                          })()}
                        </tfoot>
                      </table>
                    </div>

                    {/* А20: что видел и делал клиент */}
                    {(() => {
                      const events = buildClientTimeline(parsed)
                      if (events.length === 0) return null
                      return (
                        <div className="mb-3">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-1">Клиент</p>
                          <div className="flex flex-wrap gap-1.5">
                            {events.map((e, i) => (
                              <span key={i} title={e.at ? new Date(e.at).toLocaleString('ru-RU') : undefined}
                                className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${
                                  e.tone === 'good' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : e.tone === 'warn' ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : 'bg-white text-[#6b6b66] border-[#e4e4e0]'}`}>
                                {e.icon} {e.text}
                              </span>
                            ))}
                          </div>
                        </div>
                      )
                    })()}

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
                          {new Date(workStartedAt).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' })}
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
