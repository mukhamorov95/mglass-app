'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'
import Pagination from '@/components/Pagination'

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
  discount_percent: number
  margin_percent: number
  items: OrderItem[]
  total_area: number
  total_weight: number
  total_sale_inc_vat: number
  total_after_discount: number
  notes: string | null
  created_at: string
}

type QuoteStatus   = 'quote' | 'sent' | 'agreed' | 'rejected' | 'confirmed'
type PaymentStatus = 'unpaid' | 'partial' | 'paid'

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_META: Record<QuoteStatus, { label: string; bg: string; text: string }> = {
  quote:     { label: 'Черновик',         bg: 'bg-[#f0f0ec]',  text: 'text-[#6b6b66]'  },
  sent:      { label: 'Отправлено',        bg: 'bg-blue-50',    text: 'text-blue-700'    },
  agreed:    { label: 'Согласовано',       bg: 'bg-emerald-50', text: 'text-emerald-700' },
  rejected:  { label: 'Отказ',            bg: 'bg-red-50',     text: 'text-red-600'     },
  confirmed: { label: 'Запущено в заказ', bg: 'bg-purple-50',  text: 'text-purple-700'  },
}

const PAYMENT_META: Record<PaymentStatus, { label: string; bg: string; text: string; short: string }> = {
  unpaid:  { label: 'Не оплачен',  bg: 'bg-red-50',     text: 'text-red-600',     short: '🔴' },
  partial: { label: 'Предоплата',  bg: 'bg-amber-50',   text: 'text-amber-700',   short: '🟡' },
  paid:    { label: 'Оплачен',     bg: 'bg-emerald-50', text: 'text-emerald-700', short: '🟢' },
}

const ALL_TABS: { key: QuoteStatus | 'all'; label: string }[] = [
  { key: 'all',      label: 'Все' },
  { key: 'quote',    label: 'Черновики' },
  { key: 'sent',     label: 'Отправлено' },
  { key: 'agreed',   label: 'Согласовано' },
  { key: 'rejected', label: 'Отказ' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseNotes(notes: string | null): Record<string, unknown> {
  if (!notes) return {}
  try { const p = JSON.parse(notes); if (typeof p === 'object' && p !== null) return p } catch {}
  return {}
}

function getStatus(q: Quote): QuoteStatus {
  const s = parseNotes(q.notes)?.status
  if (s === 'confirmed') return 'confirmed'
  if (s === 'agreed')    return 'agreed'
  if (s === 'sent')      return 'sent'
  if (s === 'rejected')  return 'rejected'
  return 'quote'
}

function getPayStatus(q: Quote): PaymentStatus {
  const s = parseNotes(q.notes)?.payment_status as string
  return s === 'partial' || s === 'paid' ? s as PaymentStatus : 'unpaid'
}

function getPayAmount(q: Quote): number {
  return (parseNotes(q.notes)?.prepayment_amount as number) || 0
}

const fmt = (n: number) => (n ?? 0).toLocaleString('ru-RU') + ' ₽'

// ─── Component ────────────────────────────────────────────────────────────────

export default function B2BQuotesPage() {
  const [quotes, setQuotes]           = useState<Quote[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loading, setLoading]         = useState(true)
  const [expanded, setExpanded]       = useState<number | null>(null)
  const [tab, setTab]                 = useState<QuoteStatus | 'all'>('all')
  const [page, setPage]               = useState(1)

  // "Запустить в заказ" modal
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [launchedAt, setLaunchedAt]     = useState(new Date().toISOString().slice(0, 10))
  const [confirming, setConfirming]     = useState(false)

  // Delete modal
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleting, setDeleting]     = useState(false)

  // Toast
  const [toast, setToast] = useState<string | null>(null)
  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // ── Payment status ──────────────────────────────────────────────────────────
  const [payEditId, setPayEditId]   = useState<number | null>(null)
  const [payAmount, setPayAmount]   = useState('')
  const payAmountRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (payEditId !== null) setTimeout(() => payAmountRef.current?.focus(), 50)
  }, [payEditId])

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
    await createClient().from('b2b_orders').update({ notes: newNotes }).eq('id', id)
    setQuotes(prev => prev.map(x => x.id === id ? { ...x, notes: newNotes } : x))
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
    const parsed = parseNotes(q.notes)
    const history = Array.isArray(parsed.status_history) ? [...(parsed.status_history as unknown[])] : []
    history.push({ from: getStatus(q), to: newStatus, date: new Date().toISOString(), comment: null })
    const newNotes = JSON.stringify({ ...parsed, status: newStatus, status_history: history })
    await createClient().from('b2b_orders').update({ notes: newNotes }).eq('id', id)
    setQuotes(prev => prev.map(x => x.id === id ? { ...x, notes: newNotes } : x))
    showToast(`Статус → ${STATUS_META[newStatus as QuoteStatus]?.label ?? newStatus}`)
  }

  async function confirmStatusChange() {
    if (!pendingChange) return
    const q = quotes.find(q => q.id === pendingChange.quoteId)
    if (!q) return
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
    await createClient().from('b2b_orders').update({ notes: newNotes }).eq('id', pendingChange.quoteId)
    setQuotes(prev => prev.map(x => x.id === pendingChange.quoteId ? { ...x, notes: newNotes } : x))
    showToast(`Статус → ${STATUS_META[pendingChange.status as QuoteStatus]?.label ?? pendingChange.status}`)
    setPendingChange(null)
    setPendingComment('')
  }

  // ── Load ───────────────────────────────────────────────────────────────────
  async function loadQuotes() {
    const sb = createClient()
    const [{ data: orders }, { data: attaches }] = await Promise.all([
      sb.from('b2b_orders').select('*').order('created_at', { ascending: false }).limit(2000),
      sb.from('b2b_calculation_attachments').select('*').order('created_at', { ascending: false }).limit(5000),
    ])
    setQuotes((orders ?? []).map(q => ({
      ...q, items: Array.isArray(q.items) ? (q.items as OrderItem[]) : [],
    })))
    setAttachments(attaches ?? [])
    setLoading(false)
  }

  useEffect(() => { loadQuotes() }, [])

  // ── Duplicate / Delete ─────────────────────────────────────────────────────
  async function duplicateQuote(q: Quote) {
    const parsed = parseNotes(q.notes)
    const newNotes = JSON.stringify({ ...parsed, status: 'quote', quote_date: new Date().toISOString(), launched_at: undefined, payment_status: undefined })
    const { data, error } = await createClient().from('b2b_orders').insert({
      client_id: q.client_id, client_name: q.client_name,
      discount_percent: q.discount_percent, margin_percent: q.margin_percent,
      items: q.items, total_area: q.total_area, total_weight: q.total_weight,
      total_cost_net: 0, total_cost_vat: 0,
      total_sale_inc_vat: q.total_sale_inc_vat, total_after_discount: q.total_after_discount,
      notes: newNotes,
    }).select().single()
    if (!error && data) {
      setQuotes(prev => [{ ...data, items: q.items }, ...prev])
      showToast('Расчёт скопирован как черновик')
    }
  }

  async function handleDelete() {
    if (!deletingId) return
    setDeleting(true)
    await createClient().from('b2b_orders').delete().eq('id', deletingId)
    setQuotes(prev => prev.filter(q => q.id !== deletingId))
    setDeletingId(null)
    setDeleting(false)
    showToast('Расчёт удалён')
  }

  async function handleConfirm() {
    if (!confirmingId) return
    setConfirming(true)
    const q = quotes.find(x => x.id === confirmingId)
    const parsed = parseNotes(q?.notes ?? null)
    const history = Array.isArray(parsed.status_history) ? [...(parsed.status_history as unknown[])] : []
    history.push({ from: 'agreed', to: 'confirmed', date: new Date().toISOString(), comment: null })
    const newNotes = JSON.stringify({ ...parsed, status: 'confirmed', launched_at: launchedAt, status_history: history })
    await createClient().from('b2b_orders').update({ notes: newNotes }).eq('id', confirmingId)
    setQuotes(prev => prev.map(x => x.id === confirmingId ? { ...x, notes: newNotes } : x))
    setConfirmingId(null)
    setConfirming(false)
    showToast('Запущено в заказ')
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const visible = useMemo(() => {
    setPage(1)
    if (tab === 'all') return quotes
    return quotes.filter(q => getStatus(q) === tab)
  }, [quotes, tab])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: quotes.length }
    for (const q of quotes) { const s = getStatus(q); c[s] = (c[s] ?? 0) + 1 }
    return c
  }, [quotes])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка...</div>
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
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-[18px] font-semibold text-[#111110] tracking-tight">B2B Расчёты</h1>
          <p className="text-[12px] text-[#8a8a85] mt-0.5">{quotes.length} расчётов всего</p>
        </div>
        <Link href="/calculator/b2b"
          className="bg-[#111110] text-white text-[12px] font-medium px-3 py-1.5 rounded-lg hover:bg-[#2a2a28] transition-colors">
          + Новый расчёт
        </Link>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1 mb-4 flex-wrap">
        {ALL_TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
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
            const isPendingThis = pendingChange?.quoteId === quote.id
            const isPayEditThis = payEditId === quote.id

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
                      <p className="text-[13px] font-semibold text-[#111110] truncate">{quote.client_name}</p>
                      <p className="text-[11px] text-[#9a9a95]">
                        {dateStr}, {timeStr}
                        {' · '}{quote.items.length} поз.
                        {' · '}{(quote.total_area ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} м²
                        {(quote.total_weight ?? 0) > 0 && ` · ${(quote.total_weight ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} кг`}
                        {hasAttach && ' · 📎'}
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

                    {/* Status badge */}
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${sMeta.bg} ${sMeta.text}`}>
                      {sMeta.label}
                    </span>

                    {/* Payment badge — click to toggle edit */}
                    {status !== 'quote' && (
                      <button
                        onClick={() => { setPayEditId(isPayEditThis ? null : quote.id); setPayAmount('') }}
                        title="Статус оплаты"
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors ${pMeta.bg} ${pMeta.text} hover:opacity-80`}>
                        {pMeta.short} {pMeta.label}
                        {payStatus === 'partial' && getPayAmount(quote) > 0 && ` ${getPayAmount(quote).toLocaleString('ru-RU')} ₽`}
                      </button>
                    )}

                    {/* Price */}
                    <div className="text-right min-w-[80px]">
                      <p className="text-[13px] font-semibold text-[#111110]">{fmt(finalPrice)}</p>
                      {(quote.discount_percent ?? 0) > 0 && (
                        <p className="text-[10px] text-emerald-600">−{quote.discount_percent}%</p>
                      )}
                    </div>

                    {/* Status actions */}
                    <div className="flex items-center gap-1">
                      {status === 'quote' && (
                        <button onClick={() => requestStatusChange(quote.id, 'sent')}
                          className="text-[11px] font-medium px-2 py-1 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors whitespace-nowrap">
                          Отправлено
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
                      {status === 'agreed' && (
                        <button
                          onClick={() => { setConfirmingId(quote.id); setLaunchedAt(new Date().toISOString().slice(0, 10)) }}
                          className="text-[11px] font-medium px-2 py-1 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] transition-colors whitespace-nowrap">
                          В заказ →
                        </button>
                      )}
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
                      {/* КП */}
                      <Link href={`/b2b-quotes/${quote.id}/kp`} target="_blank"
                        title="Открыть КП для печати"
                        className="text-[11px] text-[#c4c4be] hover:text-violet-500 px-1.5 py-1 rounded hover:bg-violet-50 transition-colors">
                        КП
                      </Link>
                      {/* В калькулятор */}
                      <Link href={`/calculator/b2b?orderId=${quote.id}`}
                        title="Открыть в калькуляторе"
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
                            const itemAfterDiscount = Math.round((item.saleIncVat ?? 0) * (1 - (quote.discount_percent ?? 0) / 100))
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
                                <td className="px-2 py-1 text-right font-mono font-semibold text-[#111110] whitespace-nowrap">{itemAfterDiscount.toLocaleString('ru-RU')} ₽</td>
                                <td className="px-2 py-1 text-right font-mono text-[#9a9a95] whitespace-nowrap">{Number(item.costExVat ?? 0).toLocaleString('ru-RU')} ₽</td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-[#e4e4e0] bg-[#fafaf9] font-semibold text-[#111110]">
                            <td colSpan={7} className="px-2 py-1.5 text-[10px] text-[#6b6b66]">{quote.items.length} позиций</td>
                            <td className="px-2 py-1.5 text-right font-mono text-[11px]">{(quote.total_area ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 3 })}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-[11px] text-[#6b6b66]">{(quote.total_weight ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}</td>
                            <td />
                            <td className="px-2 py-1.5 text-right font-mono font-bold whitespace-nowrap text-[11px]">{fmt(finalPrice)}</td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>

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
                            <a key={f.id} href={f.file_url} target="_blank" rel="noopener noreferrer"
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

      {/* ── Launch to order modal ───────────────────────────────────────────── */}
      {confirmingId !== null && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h2 className="text-[16px] font-semibold text-[#111110] mb-1">Запустить в заказ</h2>
            <p className="text-[13px] text-[#6b6b66] mb-4">Укажите дату запуска в производство</p>
            <label className="block text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1.5">Дата запуска</label>
            <input type="date"
              className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] mb-4"
              value={launchedAt} onChange={e => setLaunchedAt(e.target.value)} />
            <div className="flex gap-2">
              <button onClick={() => setConfirmingId(null)}
                className="flex-1 py-2.5 rounded-lg border border-[#e4e4e0] text-[13px] font-medium text-[#6b6b66] hover:bg-[#f8f8f7] transition-colors">
                Отмена
              </button>
              <button onClick={handleConfirm} disabled={confirming || !launchedAt}
                className="flex-1 py-2.5 rounded-lg bg-[#111110] text-white text-[13px] font-medium hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
                {confirming ? 'Сохранение...' : 'Запустить →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
