'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

type DraftItem = {
  line_item:   string
  dimensions?: string
  quantity:    number
  unit_price:  number
  total_price: number
  note?:       string
}

type DraftPayload = {
  proposal_title?:  string
  client_summary?:  string
  items?:           DraftItem[]
  price_summary?: {
    subtotal:          number
    installation?:     number
    delivery?:         number
    discount_percent?: number
    total:             number
    currency:          string
    vat_included?:     string
  }
  terms?: {
    lead_time_days?: [number, number]
    payment_terms:   string
    warranty:        string
    validity_days:   number
  }
  exclusions?:      string[]
  manager_message?: string
  approval_block?:  Record<string, unknown>
  mode?:            string
  generated_at?:    string
}

type ProposalError = { code: string; message: string; field?: string; step?: string }

type ProposalRecord = {
  id:                  number
  created_at:          string
  updated_at:          string
  agent_key:           string
  skill_key:           string | null
  workflow_key:        string | null
  action_type:         string
  status:              string
  client_name:         string | null
  proposal_title:      string | null
  input_snapshot:      Record<string, unknown>
  output_snapshot:     Record<string, unknown>
  draft_payload:       DraftPayload | null
  safety_snapshot:     Record<string, unknown>
  approval_snapshot:   Record<string, unknown> | null
  approval_required:   boolean
  can_send_to_client:  boolean
  can_write_crm:       boolean
  can_create_order:    boolean
  model_call_executed: boolean
  model_name:          string | null
  approved_at:         string | null
  rejected_at:         string | null
  approved_by:         string | null
  rejection_reason:    string | null
  warnings:            string[]
  errors:              ProposalError[]
  created_by:          string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  draft:            { cls: 'bg-gray-100 text-gray-500',      label: 'Черновик' },
  pending_approval: { cls: 'bg-amber-100 text-amber-700',    label: 'На проверке' },
  approved:         { cls: 'bg-emerald-100 text-emerald-700', label: 'Одобрено' },
  rejected:         { cls: 'bg-red-100 text-red-600',        label: 'Отклонено' },
  failed:           { cls: 'bg-red-50 text-red-400',         label: 'Ошибка' },
  archived:         { cls: 'bg-gray-100 text-gray-400',      label: 'Архив' },
}

function statusBadge(status: string) {
  return STATUS_BADGE[status] ?? { cls: 'bg-gray-100 text-gray-400', label: status }
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtPrice(n: number | undefined) {
  if (n == null) return '—'
  return n.toLocaleString('ru-RU') + ' ₽'
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function SectionHead({ title }: { title: string }) {
  return (
    <p className="text-[10px] font-semibold text-[#a8a8a3] uppercase tracking-wide mb-2">{title}</p>
  )
}

function SafetyFlag({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
        value ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'
      }`}>
        {value ? '!' : '✓'}
      </span>
      <span className="text-[11px] text-[#6b6b66]">{label}</span>
      <span className={`text-[10px] font-mono ${value ? 'text-red-500' : 'text-emerald-600'}`}>
        {String(value)}
      </span>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AIProposalDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id     = params?.id as string | undefined

  const [proposal,        setProposal]        = useState<ProposalRecord | null>(null)
  const [loading,         setLoading]         = useState(true)
  const [fetchError,      setFetchError]      = useState<string | null>(null)

  const [approving,       setApproving]       = useState(false)
  const [approveError,    setApproveError]    = useState<string | null>(null)

  const [showRejectForm,  setShowRejectForm]  = useState(false)
  const [rejectReason,    setRejectReason]    = useState('')
  const [rejecting,       setRejecting]       = useState(false)
  const [rejectError,     setRejectError]     = useState<string | null>(null)

  const [copied,          setCopied]          = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setFetchError(null)
    try {
      const res  = await fetch(`/api/ai/proposals/${id}`)
      const data = await res.json() as { ok: boolean; proposal?: ProposalRecord; error?: string }
      if (!res.ok || !data.ok || !data.proposal) {
        setFetchError(data.error ?? 'Запись не найдена')
      } else {
        setProposal(data.proposal)
      }
    } catch {
      setFetchError('Ошибка сети')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleApprove() {
    if (!id || !proposal) return
    setApproving(true)
    setApproveError(null)
    try {
      const res  = await fetch(`/api/ai/proposals/${id}/approve`, { method: 'POST' })
      const data = await res.json() as { ok: boolean; status?: string; error?: string }
      if (!res.ok || !data.ok) {
        setApproveError(data.error ?? 'Не удалось одобрить')
      } else {
        setProposal(p => p ? { ...p, status: 'approved', approved_at: new Date().toISOString() } : p)
      }
    } catch {
      setApproveError('Ошибка сети')
    } finally {
      setApproving(false)
    }
  }

  async function handleReject() {
    if (!id || !proposal) return
    setRejecting(true)
    setRejectError(null)
    try {
      const res  = await fetch(`/api/ai/proposals/${id}/reject`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rejection_reason: rejectReason.trim() || undefined }),
      })
      const data = await res.json() as { ok: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setRejectError(data.error ?? 'Не удалось отклонить')
      } else {
        setProposal(p => p ? {
          ...p,
          status:           'rejected',
          rejected_at:      new Date().toISOString(),
          rejection_reason: rejectReason.trim() || null,
        } : p)
        setShowRejectForm(false)
        setRejectReason('')
      }
    } catch {
      setRejectError('Ошибка сети')
    } finally {
      setRejecting(false)
    }
  }

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(c => c === key ? null : c), 2000)
    } catch {
      // clipboard unavailable
    }
  }

  // ── Render guards ──────────────────────────────────────────────────────────

  if (loading) return (
    <div className="min-h-screen bg-[#f7f7f6] flex items-center justify-center">
      <div className="flex items-center gap-2 text-[#9a9a95] text-xs">
        <div className="w-4 h-4 border-2 border-[#d0d0cc] border-t-[#9a9a95] rounded-full animate-spin" />
        Загрузка черновика...
      </div>
    </div>
  )

  if (fetchError || !proposal) return (
    <div className="min-h-screen bg-[#f7f7f6] flex flex-col items-center justify-center gap-3">
      <p className="text-sm text-red-500">{fetchError ?? 'Не найдено'}</p>
      <button onClick={() => router.push('/admin/ai-proposals')}
        className="text-xs text-[#9a9a95] underline">← Назад к списку</button>
    </div>
  )

  const draft   = proposal.draft_payload
  const badge   = statusBadge(proposal.status)
  const isFinal = ['approved', 'rejected', 'archived'].includes(proposal.status)

  const managerText = draft?.manager_message ?? ''
  const fullDraftText = draft ? [
    draft.proposal_title,
    '',
    draft.client_summary,
    '',
    draft.items?.map(i => `${i.line_item}${i.dimensions ? ` (${i.dimensions})` : ''} × ${i.quantity} = ${fmtPrice(i.total_price)}`).join('\n'),
    '',
    `Итого: ${fmtPrice(draft.price_summary?.total)}`,
    '',
    draft.manager_message,
  ].filter(l => l != null).join('\n') : ''

  return (
    <div className="min-h-screen bg-[#f7f7f6]">
      <div className="max-w-3xl mx-auto px-4 py-4">

        {/* Nav */}
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => router.push('/admin/ai-proposals')}
            className="text-[11px] text-[#9a9a95] hover:text-[#4b4b47] transition-colors flex items-center gap-1">
            ← Черновики КП
          </button>
          <span className="text-[#d0d0cc] text-xs">/</span>
          <span className="text-[11px] text-[#6b6b66]">#{proposal.id}</span>
        </div>

        {/* Title row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-base font-semibold text-[#111110]">
              {proposal.proposal_title ?? `AI КП #${proposal.id}`}
            </h1>
            {proposal.client_name && (
              <p className="text-xs text-[#9a9a95] mt-0.5">Клиент: {proposal.client_name}</p>
            )}
            <p className="text-[10px] text-[#b8b8b4] mt-0.5">
              Создан {fmtDate(proposal.created_at)}
              {proposal.created_by && ` · ${proposal.created_by}`}
            </p>
          </div>
          <span className={`flex-shrink-0 text-[11px] font-semibold px-3 py-1 rounded-full ${badge.cls}`}>
            {badge.label}
          </span>
        </div>

        {/* Safety banner — always visible */}
        <div className="mb-4 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-xs text-amber-800">
            Утверждение здесь <strong>не отправляет</strong> КП клиенту и не пишет в CRM.
            Это только внутреннее подтверждение черновика для последующей ручной отправки менеджером.
          </p>
        </div>

        {/* Safety flags */}
        <div className="mb-4 bg-white rounded-xl border border-[#e8e8e5] px-4 py-3">
          <SectionHead title="Safety-флаги" />
          <div className="grid grid-cols-2 gap-1.5">
            <SafetyFlag label="approval_required"   value={proposal.approval_required} />
            <SafetyFlag label="can_send_to_client"  value={proposal.can_send_to_client} />
            <SafetyFlag label="can_write_crm"       value={proposal.can_write_crm} />
            <SafetyFlag label="can_create_order"    value={proposal.can_create_order} />
            <SafetyFlag label="model_call_executed" value={proposal.model_call_executed} />
          </div>
        </div>

        {/* Actions */}
        {!isFinal && (
          <div className="mb-4 bg-white rounded-xl border border-[#e8e8e5] px-4 py-3">
            <SectionHead title="Действия" />

            <div className="flex items-start gap-2 flex-wrap">
              {/* Approve */}
              <button
                onClick={handleApprove}
                disabled={approving}
                className="h-8 px-4 rounded-lg text-[12px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                {approving
                  ? <><span className="w-3 h-3 border border-emerald-400 border-t-transparent rounded-full animate-spin" />Одобряю...</>
                  : '✓ Одобрить'}
              </button>

              {/* Reject toggle */}
              {!showRejectForm && (
                <button
                  onClick={() => setShowRejectForm(true)}
                  className="h-8 px-4 rounded-lg text-[12px] font-medium bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors">
                  ✕ Отклонить
                </button>
              )}

              {/* Copy manager_message */}
              {managerText && (
                <button
                  onClick={() => copyText(managerText, 'msg')}
                  className="h-8 px-3 rounded-lg text-[11px] border border-[#e8e8e5] text-[#6b6b66] hover:bg-[#f5f5f3] transition-colors">
                  {copied === 'msg' ? '✓ Скопировано' : '📋 Скопировать сообщение'}
                </button>
              )}

              {/* Copy full draft */}
              {fullDraftText && (
                <button
                  onClick={() => copyText(fullDraftText, 'draft')}
                  className="h-8 px-3 rounded-lg text-[11px] border border-[#e8e8e5] text-[#6b6b66] hover:bg-[#f5f5f3] transition-colors">
                  {copied === 'draft' ? '✓ Скопировано' : '📄 Скопировать черновик'}
                </button>
              )}

              {/* Open print / PDF view */}
              <button
                onClick={() => window.open(`/admin/ai-proposals/${id}/print`, '_blank')}
                className="h-8 px-3 rounded-lg text-[11px] border border-[#e8e8e5] text-[#6b6b66] hover:bg-[#f5f5f3] transition-colors">
                🖨 Открыть КП для печати
              </button>
            </div>

            {/* Reject form */}
            {showRejectForm && (
              <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-100">
                <p className="text-[11px] font-medium text-red-700 mb-2">Причина отклонения (необязательно)</p>
                <textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="Укажите причину..."
                  rows={2}
                  className="w-full text-[12px] px-3 py-2 rounded-lg border border-red-200 bg-white resize-none focus:outline-none focus:ring-1 focus:ring-red-300 text-[#111110] placeholder:text-[#b8b8b4]"
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleReject}
                    disabled={rejecting}
                    className="h-7 px-3 rounded-lg text-[11px] font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center gap-1">
                    {rejecting
                      ? <><span className="w-3 h-3 border border-red-300 border-t-transparent rounded-full animate-spin" />Отклоняю...</>
                      : 'Подтвердить'}
                  </button>
                  <button
                    onClick={() => { setShowRejectForm(false); setRejectReason(''); setRejectError(null) }}
                    className="h-7 px-3 rounded-lg text-[11px] border border-[#e8e8e5] text-[#6b6b66] hover:bg-white transition-colors">
                    Отмена
                  </button>
                </div>
                {rejectError && <p className="mt-1.5 text-[11px] text-red-500">{rejectError}</p>}
              </div>
            )}

            {approveError && (
              <p className="mt-2 text-[11px] text-red-500">{approveError}</p>
            )}
          </div>
        )}

        {/* Final state info */}
        {isFinal && (
          <div className={`mb-4 px-4 py-3 rounded-xl border ${
            proposal.status === 'approved'
              ? 'bg-emerald-50 border-emerald-200'
              : 'bg-[#f5f5f3] border-[#e8e8e5]'
          }`}>
            {proposal.status === 'approved' && (
              <div>
                <p className="text-[12px] font-medium text-emerald-800">
                  Одобрено {fmtDate(proposal.approved_at)}
                  {proposal.approved_by && ` · ${proposal.approved_by}`}
                </p>
                <p className="text-[11px] text-emerald-700 mt-0.5">
                  КП клиенту не отправлено — требуется ручная отправка менеджером
                </p>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {managerText && (
                    <button onClick={() => copyText(managerText, 'msg')}
                      className="h-7 px-3 rounded-lg text-[11px] border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-colors">
                      {copied === 'msg' ? '✓ Скопировано' : '📋 Скопировать сообщение'}
                    </button>
                  )}
                  {fullDraftText && (
                    <button onClick={() => copyText(fullDraftText, 'draft')}
                      className="h-7 px-3 rounded-lg text-[11px] border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-colors">
                      {copied === 'draft' ? '✓ Скопировано' : '📄 Скопировать черновик'}
                    </button>
                  )}
                  <button
                    onClick={() => window.open(`/admin/ai-proposals/${id}/print`, '_blank')}
                    className="h-7 px-3 rounded-lg text-[11px] border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-colors">
                    🖨 Открыть КП для печати
                  </button>
                </div>
              </div>
            )}
            {proposal.status === 'rejected' && (
              <div>
                <p className="text-[12px] font-medium text-[#4b4b47]">
                  Отклонено {fmtDate(proposal.rejected_at)}
                </p>
                {proposal.rejection_reason && (
                  <p className="text-[11px] text-[#6b6b66] mt-0.5">{proposal.rejection_reason}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Draft content */}
        {draft ? (
          <div className="mb-4 bg-white rounded-xl border border-[#e8e8e5] px-4 py-3">
            <SectionHead title="Черновик КП" />

            {/* Client summary */}
            {draft.client_summary && (
              <div className="mb-3 px-3 py-2.5 bg-[#f7f7f6] rounded-lg">
                <p className="text-[11px] text-[#9a9a95] mb-0.5">Резюме клиента</p>
                <p className="text-[12px] text-[#111110] leading-relaxed">{draft.client_summary}</p>
              </div>
            )}

            {/* Items */}
            {draft.items && draft.items.length > 0 && (
              <div className="mb-3">
                <p className="text-[11px] text-[#9a9a95] mb-1.5">Позиции</p>
                <div className="border border-[#f0f0ee] rounded-lg overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-[#fafafa] border-b border-[#f0f0ee]">
                        <th className="px-3 py-2 text-left font-medium text-[#9a9a95]">Наименование</th>
                        <th className="px-3 py-2 text-right font-medium text-[#9a9a95] w-12">Кол.</th>
                        <th className="px-3 py-2 text-right font-medium text-[#9a9a95] w-24">Цена</th>
                        <th className="px-3 py-2 text-right font-medium text-[#9a9a95] w-24">Сумма</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f7f7f7]">
                      {draft.items.map((item, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 text-[#111110]">
                            {item.line_item}
                            {item.dimensions && <span className="text-[#9a9a95]"> · {item.dimensions}</span>}
                            {item.note       && <span className="block text-[10px] text-[#b8b8b4]">{item.note}</span>}
                          </td>
                          <td className="px-3 py-2 text-right text-[#6b6b66]">{item.quantity}</td>
                          <td className="px-3 py-2 text-right text-[#6b6b66]">{fmtPrice(item.unit_price)}</td>
                          <td className="px-3 py-2 text-right font-medium text-[#111110]">{fmtPrice(item.total_price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Price summary */}
            {draft.price_summary && (
              <div className="mb-3 px-3 py-2.5 bg-[#f7f7f6] rounded-lg text-[11px]">
                <p className="text-[#9a9a95] mb-1.5">Итог</p>
                {draft.price_summary.subtotal      != null && <div className="flex justify-between text-[#6b6b66]"><span>Стоимость</span><span>{fmtPrice(draft.price_summary.subtotal)}</span></div>}
                {draft.price_summary.installation  != null && <div className="flex justify-between text-[#6b6b66]"><span>Монтаж</span><span>{fmtPrice(draft.price_summary.installation)}</span></div>}
                {draft.price_summary.delivery      != null && <div className="flex justify-between text-[#6b6b66]"><span>Доставка</span><span>{fmtPrice(draft.price_summary.delivery)}</span></div>}
                {draft.price_summary.discount_percent != null && <div className="flex justify-between text-[#6b6b66]"><span>Скидка</span><span>{draft.price_summary.discount_percent}%</span></div>}
                <div className="flex justify-between font-semibold text-[#111110] mt-1 pt-1 border-t border-[#e8e8e5]">
                  <span>Итого</span>
                  <span>{fmtPrice(draft.price_summary.total)}</span>
                </div>
                {draft.price_summary.vat_included && (
                  <p className="text-[10px] text-[#b8b8b4] mt-0.5">{draft.price_summary.vat_included}</p>
                )}
              </div>
            )}

            {/* Terms */}
            {draft.terms && (
              <div className="mb-3 text-[11px]">
                <p className="text-[#9a9a95] mb-1">Условия</p>
                <div className="space-y-0.5 text-[#6b6b66]">
                  {draft.terms.lead_time_days && <p>Срок: {draft.terms.lead_time_days[0]}–{draft.terms.lead_time_days[1]} дн.</p>}
                  <p>Оплата: {draft.terms.payment_terms}</p>
                  <p>Гарантия: {draft.terms.warranty}</p>
                  <p>Действие КП: {draft.terms.validity_days} дн.</p>
                </div>
              </div>
            )}

            {/* Exclusions */}
            {draft.exclusions && draft.exclusions.length > 0 && (
              <div className="mb-3">
                <p className="text-[11px] text-[#9a9a95] mb-1">Не входит в стоимость</p>
                <ul className="space-y-0.5">
                  {draft.exclusions.map((ex, i) => (
                    <li key={i} className="text-[11px] text-[#6b6b66] flex items-start gap-1.5">
                      <span className="text-[#b8b8b4] mt-0.5 flex-shrink-0">—</span>
                      {ex}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Manager message */}
            {draft.manager_message && (
              <div className="px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-medium text-blue-700">Сообщение менеджеру</p>
                  <button onClick={() => copyText(draft.manager_message ?? '', 'msg2')}
                    className="text-[10px] text-blue-500 hover:text-blue-700 transition-colors">
                    {copied === 'msg2' ? '✓ Скопировано' : '📋 Копировать'}
                  </button>
                </div>
                <p className="text-[11px] text-blue-900 leading-relaxed whitespace-pre-wrap">{draft.manager_message}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="mb-4 bg-white rounded-xl border border-[#e8e8e5] px-4 py-6 text-center">
            <p className="text-[12px] text-[#9a9a95]">Черновик КП не был сгенерирован</p>
            <p className="text-[11px] text-[#b8b8b4] mt-0.5">Возможно, произошла ошибка на этапе генерации</p>
          </div>
        )}

        {/* Input snapshot */}
        <div className="mb-4 bg-white rounded-xl border border-[#e8e8e5] px-4 py-3">
          <SectionHead title="Входные данные" />
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            {Object.entries(proposal.input_snapshot)
              .filter(([, v]) => v != null && v !== '')
              .map(([k, v]) => (
                <div key={k} className="flex gap-1.5 items-start">
                  <span className="text-[#b8b8b4] flex-shrink-0 font-mono">{k}:</span>
                  <span className="text-[#4b4b47] break-words">{String(v)}</span>
                </div>
              ))}
          </div>
        </div>

        {/* Warnings */}
        {proposal.warnings.length > 0 && (
          <div className="mb-4 bg-white rounded-xl border border-amber-100 px-4 py-3">
            <SectionHead title={`Предупреждения (${proposal.warnings.length})`} />
            <ul className="space-y-1">
              {proposal.warnings.map((w, i) => (
                <li key={i} className="text-[11px] text-amber-800 flex items-start gap-1.5">
                  <span className="flex-shrink-0 text-amber-500 mt-0.5">⚠</span>{w}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Errors */}
        {proposal.errors.length > 0 && (
          <div className="mb-4 bg-white rounded-xl border border-red-100 px-4 py-3">
            <SectionHead title={`Ошибки (${proposal.errors.length})`} />
            <ul className="space-y-1.5">
              {proposal.errors.map((e, i) => (
                <li key={i} className="text-[11px]">
                  <span className="font-mono text-red-500 text-[10px]">[{e.code}]</span>
                  <span className="text-[#4b4b47] ml-1">{e.message}</span>
                  {e.step  && <span className="text-[#9a9a95] ml-1">· step: {e.step}</span>}
                  {e.field && <span className="text-[#9a9a95] ml-1">· field: {e.field}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Meta */}
        <div className="mb-4 bg-white rounded-xl border border-[#e8e8e5] px-4 py-3">
          <SectionHead title="Мета" />
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <div className="flex gap-1.5"><span className="text-[#b8b8b4] font-mono">agent_key:</span><span className="text-[#4b4b47]">{proposal.agent_key}</span></div>
            <div className="flex gap-1.5"><span className="text-[#b8b8b4] font-mono">skill_key:</span><span className="text-[#4b4b47]">{proposal.skill_key ?? '—'}</span></div>
            <div className="flex gap-1.5"><span className="text-[#b8b8b4] font-mono">action_type:</span><span className="text-[#4b4b47]">{proposal.action_type}</span></div>
            <div className="flex gap-1.5"><span className="text-[#b8b8b4] font-mono">workflow_key:</span><span className="text-[#4b4b47]">{proposal.workflow_key ?? '—'}</span></div>
            {proposal.model_name && <div className="flex gap-1.5"><span className="text-[#b8b8b4] font-mono">model:</span><span className="text-[#4b4b47]">{proposal.model_name}</span></div>}
          </div>
        </div>

      </div>
    </div>
  )
}
