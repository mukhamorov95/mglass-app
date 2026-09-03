'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { Order, OrderLine, OrderStatus, MarginStatus, PaymentStatus } from '@/lib/types'
import AssignInstallationButton from '@/components/AssignInstallationButton'
import {
  ORDER_STATUS_LABELS, MARGIN_STATUS_LABELS, MARGIN_STATUS_COLORS,
  PAYMENT_STATUS_LABELS, PAYMENT_STATUS_COLORS,
} from '@/lib/types'

type Zone    = { id: string; name: string; price: number; active: boolean }
type Brigade = { id: string; name: string; lead_name: string | null; phone: string | null; active: boolean }

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  mirror:           'Зеркало',
  loft:             'Лофт-перегородка',
  shower_budget:    'Душевая бюджет',
  shower_standard:  'Душевая стандарт',
  b2b:              'B2B стекло',
  service:          'Услуга',
  custom:           'Прочее',
}

const STATUS_STYLE: Record<OrderStatus, string> = {
  draft:            'bg-gray-100 text-gray-600',
  pending_approval: 'bg-red-100 text-red-700',
  approved:         'bg-amber-100 text-amber-700',
  in_work:          'bg-blue-100 text-blue-700',
  completed:        'bg-emerald-100 text-emerald-700',
  cancelled:        'bg-gray-100 text-gray-400',
}

function MarginBadge({ status, percent }: { status: MarginStatus; percent: number }) {
  const c = MARGIN_STATUS_COLORS[status]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-semibold border ${c.bg} ${c.text} ${c.border}`}>
      {percent.toFixed(1)}% — {MARGIN_STATUS_LABELS[status]}
    </span>
  )
}

const PROD_STAGES = [
  { key: 'invoice_sent',     label: 'Счёт выставлен' },
  { key: 'invoice_paid',     label: 'Счёт оплачен' },
  { key: 'material_ordered', label: 'Материал заказан' },
  { key: 'cut',              label: 'Нарезка' },
  { key: 'edge_processed',   label: 'Кромка обработана' },
  { key: 'drilled',          label: 'Сверловка' },
  { key: 'tempering',        label: 'Закалка' },
  { key: 'packaged',         label: 'Упакован' },
  { key: 'shipped',          label: 'Отгружен' },
] as const

type Props = {
  order:       Order
  lines:       OrderLine[]
  isAdmin:     boolean
  managerName: string | null
}

export default function OrderDetailClient({ order, lines, isAdmin, managerName }: Props) {
  const router = useRouter()
  const [approving, setApproving] = useState(false)
  const [approvalNotes, setApprovalNotes] = useState('')
  const [showApproveForm, setShowApproveForm] = useState(false)
  const [error, setError] = useState('')

  const [customNumber, setCustomNumber]     = useState(order.custom_number ?? '')
  const [editingCustomNum, setEditingCustomNum] = useState(false)
  const [savingCustomNum, setSavingCustomNum]   = useState(false)

  async function saveCustomNumber() {
    setSavingCustomNum(true)
    await fetch(`/api/orders/${order.id}/custom-number`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_number: customNumber }),
    })
    setSavingCustomNum(false)
    setEditingCustomNum(false)
    router.refresh()
  }

  const [deliveryAddr, setDeliveryAddr] = useState(order.delivery_address ?? '')
  const [savingAddr, setSavingAddr] = useState(false)

  const [paymentStatus, setPaymentStatus]   = useState<PaymentStatus>(order.payment_status ?? 'unpaid')
  const [prepayAmount, setPrepayAmount]     = useState(order.prepayment_amount?.toString() ?? '')
  const [prepayDate, setPrepayDate]         = useState(order.prepayment_date ?? '')
  const [paymentNotes, setPaymentNotes]     = useState(order.payment_notes ?? '')
  const [savingPayment, setSavingPayment]   = useState(false)
  const [payWarning, setPayWarning]         = useState<string | null>(null)

  const [zones, setZones]           = useState<Zone[]>([])
  const [brigades, setBrigades]     = useState<Brigade[]>([])
  const [zoneId, setZoneId]         = useState<string>(order.delivery_zone_id ?? '')
  const [deliveryCost, setDeliveryCost] = useState(order.delivery_cost ?? 0)
  const [brigadeId, setBrigadeId]   = useState<string>(order.brigade_id ?? '')
  const [savingBrigade, setSavingBrigade] = useState(false)

  const [photoUploading, setPhotoUploading] = useState(false)
  const [photos, setPhotos] = useState<string[]>(order.completion_photos ?? [])
  const [prodStages, setProdStages] = useState<Record<string, string | null>>(
    (order as unknown as { production_stages?: Record<string, string | null> }).production_stages ?? {}
  )
  const [togglingStage, setTogglingStage] = useState<string | null>(null)
  const [rating, setRating]               = useState(0)
  const [ratingComment, setRatingComment] = useState('')
  const [ratingSaved, setRatingSaved]     = useState(false)
  const [savingRating, setSavingRating]   = useState(false)
  const [nowTs, setNowTs]                 = useState(0)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNowTs(Date.now())
    fetch('/api/admin/delivery-zones').then(r => r.json()).then(setZones)
    fetch('/api/admin/brigades').then(r => r.json()).then(setBrigades)
  }, [])

  const daysInWork = order.launched_at && nowTs
    ? Math.ceil((nowTs - new Date(order.launched_at).getTime()) / 86_400_000)
    : null

  const daysToDeadline = order.deadline && nowTs
    ? Math.ceil((new Date(order.deadline).getTime() - nowTs) / 86_400_000)
    : null

  async function handleApprove() {
    setApproving(true)
    setError('')
    const res = await fetch(`/api/orders/${order.id}/approve`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ approval_notes: approvalNotes }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setApproving(false); return }
    router.refresh()
  }

  async function saveDeliveryAddr() {
    setSavingAddr(true)
    await fetch(`/api/orders/${order.id}/delivery`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        delivery_address: deliveryAddr,
        delivery_zone_id: zoneId || null,
        delivery_cost:    deliveryCost,
      }),
    })
    setSavingAddr(false)
    router.refresh()
  }

  async function saveBrigade(newBrigadeId: string) {
    setSavingBrigade(true)
    await fetch(`/api/orders/${order.id}/brigade`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ brigade_id: newBrigadeId || null }),
    })
    setSavingBrigade(false)
    router.refresh()
  }

  async function savePayment() {
    setSavingPayment(true)
    const r = await fetch(`/api/orders/${order.id}/payment`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        payment_status:    paymentStatus,
        prepayment_amount: prepayAmount ? parseFloat(prepayAmount) : 0,
        prepayment_date:   prepayDate || null,
        payment_notes:     paymentNotes,
      }),
    })
    // Если деньги не дошли до учёта — говорим прямо, а не молча «сохранено»:
    // иначе продажа не появится в Отделе продаж, и никто об этом не узнает.
    const d = await r.json().catch(() => null)
    setPayWarning(Array.isArray(d?.warnings) && d.warnings.length ? String(d.warnings[0]) : null)
    setSavingPayment(false)
    router.refresh()
  }

  async function uploadPhoto(file: File) {
    setPhotoUploading(true)
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`/api/orders/${order.id}/photos`, { method: 'POST', body: form })
    const data = await res.json()
    if (data.url) setPhotos(prev => [...prev, data.url])
    setPhotoUploading(false)
  }

  async function toggleStage(stageKey: string) {
    setTogglingStage(stageKey)
    const isDone = !!prodStages[stageKey]
    const res = await fetch(`/api/orders/${order.id}/production-stages`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: stageKey, done: !isDone }),
    })
    if (res.ok) {
      setProdStages(prev => {
        const next = { ...prev }
        if (isDone) delete next[stageKey]
        else next[stageKey] = new Date().toISOString().slice(0, 10)
        return next
      })
    }
    setTogglingStage(null)
  }

  async function saveRating() {
    if (!rating) return
    setSavingRating(true)
    await fetch(`/api/orders/${order.id}/rating`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ rating, comment: ratingComment }),
    })
    setSavingRating(false)
    setRatingSaved(true)
  }

  async function handleStatusChange(newStatus: OrderStatus) {
    const res = await fetch(`/api/orders/${order.id}/status`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status: newStatus }),
    })
    if (res.ok) router.refresh()
  }

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[900px] mx-auto px-4 py-6">

        {/* Back + breadcrumb */}
        <div className="flex items-center justify-between gap-2 text-[13px] mb-5">
          <div className="flex items-center gap-2">
            <Link href="/orders" className="text-[#9a9a95] hover:text-[#6b6b66]">← Заказы</Link>
            <span className="text-[#d4d4d0]">/</span>
            <span className="font-mono font-bold text-[#111110]">{order.number}</span>
          </div>
          <div className="flex gap-2">
            <Link href={`/orders/${order.id}/print`} target="_blank"
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-[#f8f8f7] hover:text-[#111110] transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/>
              </svg>
              КП
            </Link>
            {order.status === 'completed' && (
              <Link href={`/orders/${order.id}/act`} target="_blank"
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-[#f8f8f7] hover:text-[#111110] transition-colors">
                Акт
              </Link>
            )}
            <Link href={`/orders/${order.id}/spec`} target="_blank"
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-[#f8f8f7] hover:text-[#111110] transition-colors">
              Спецификация
            </Link>
          </div>
        </div>

        {/* Pending approval banner */}
        {order.status === 'pending_approval' && isAdmin && (
          <div className="mb-5 bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-[14px] font-semibold text-red-700 mb-2">
              ⚠ Заказ ожидает вашего одобрения — маржа {order.margin_percent.toFixed(1)}% ниже минимума
            </p>
            {!showApproveForm ? (
              <button onClick={() => setShowApproveForm(true)}
                className="px-4 py-2 bg-red-600 text-white text-[13px] font-medium rounded-lg hover:bg-red-700">
                Одобрить заказ
              </button>
            ) : (
              <div className="space-y-2">
                <textarea
                  rows={2} value={approvalNotes} onChange={e => setApprovalNotes(e.target.value)}
                  placeholder="Комментарий к одобрению (необязательно)"
                  className="w-full border border-red-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-red-400 bg-white resize-none"
                />
                {error && <p className="text-[12px] text-red-600">{error}</p>}
                <div className="flex gap-2">
                  <button onClick={() => setShowApproveForm(false)}
                    className="px-4 py-2 text-[13px] border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-[#f8f8f7]">
                    Отмена
                  </button>
                  <button onClick={handleApprove} disabled={approving}
                    className="px-4 py-2 bg-red-600 text-white text-[13px] font-medium rounded-lg hover:bg-red-700 disabled:opacity-40">
                    {approving ? 'Одобряю...' : 'Подтвердить одобрение →'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="space-y-4">

          {/* Main card */}
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                {/* Custom order number — prominent */}
                <div className="mb-2">
                  {editingCustomNum ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        type="text"
                        value={customNumber}
                        onChange={e => setCustomNumber(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveCustomNumber(); if (e.key === 'Escape') setEditingCustomNum(false) }}
                        placeholder="0147-О"
                        className="text-[26px] font-bold font-mono border-b-2 border-[#0071e3] outline-none bg-transparent w-48 text-[#111110]"
                      />
                      <button onClick={saveCustomNumber} disabled={savingCustomNum}
                        className="text-[12px] px-3 py-1 bg-[#111110] text-white rounded-lg hover:bg-[#2a2a28] disabled:opacity-40">
                        {savingCustomNum ? '...' : 'OK'}
                      </button>
                      <button onClick={() => { setEditingCustomNum(false); setCustomNumber(order.custom_number ?? '') }}
                        className="text-[12px] px-2 py-1 border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-[#f5f5f3]">
                        ✕
                      </button>
                    </div>
                  ) : customNumber ? (
                    <button onClick={() => setEditingCustomNum(true)} title="Изменить номер заказа"
                      className="group flex items-center gap-2">
                      <span className="text-[28px] font-bold font-mono text-[#111110] group-hover:text-[#0071e3] transition-colors">
                        {customNumber}
                      </span>
                      <span className="text-[11px] text-[#c4c4be] group-hover:text-[#6b6b66] transition-colors">✎</span>
                    </button>
                  ) : (
                    <button onClick={() => setEditingCustomNum(true)}
                      className="text-[13px] text-[#c4c4be] hover:text-[#6b6b66] font-medium transition-colors border border-dashed border-[#e4e4e0] hover:border-[#9a9a95] rounded-lg px-3 py-1.5">
                      + Добавить номер заказа
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-wrap mb-1">
                  <span className="text-[13px] font-mono text-[#9a9a95]">{order.number}</span>
                  <span className={`text-[12px] font-semibold px-2.5 py-1 rounded-lg ${STATUS_STYLE[order.status]}`}>
                    {ORDER_STATUS_LABELS[order.status]}
                  </span>
                </div>
                <p className="text-[17px] font-semibold text-[#111110]">{order.client_name}</p>
                {order.client_phone && (
                  <p className="text-[14px] text-[#6b6b66] mt-0.5">{order.client_phone}</p>
                )}
                {order.object_address && (
                  <p className="text-[13px] text-[#9a9a95] mt-0.5">{order.object_address}</p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-[22px] font-bold text-[#111110] font-mono">{fmt(order.total_sale_price)}</p>
                <MarginBadge status={order.margin_status} percent={order.margin_percent} />
              </div>
            </div>

            {/* Meta row */}
            <div className="mt-4 pt-4 border-t border-[#f0f0ec] grid grid-cols-2 md:grid-cols-4 gap-4 text-[12px]">
              <div>
                <p className="text-[#9a9a95] uppercase tracking-widest text-[10px] font-bold mb-0.5">Создан</p>
                <p className="text-[#111110]">{new Date(order.created_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}</p>
              </div>
              {order.launched_at && (
                <div>
                  <p className="text-[#9a9a95] uppercase tracking-widest text-[10px] font-bold mb-0.5">Запущен</p>
                  <p className="text-[#111110]">{new Date(order.launched_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}</p>
                  {daysInWork && <p className="text-[#9a9a95]">{daysInWork} дн. в работе</p>}
                </div>
              )}
              {order.deadline && (
                <div>
                  <p className="text-[#9a9a95] uppercase tracking-widest text-[10px] font-bold mb-0.5">Дедлайн</p>
                  <p className={`font-medium ${
                    daysToDeadline === null ? '' :
                    daysToDeadline < 0  ? 'text-red-600' :
                    daysToDeadline <= 3 ? 'text-amber-600' : 'text-[#111110]'
                  }`}>
                    {new Date(order.deadline).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}
                    {daysToDeadline !== null && (
                      <span className="ml-1.5 text-[11px]">
                        {daysToDeadline < 0 ? `(просрочка ${Math.abs(daysToDeadline)} дн.)` :
                         daysToDeadline === 0 ? '(сегодня)' :
                         `(${daysToDeadline} дн.)`}
                      </span>
                    )}
                  </p>
                </div>
              )}
              {isAdmin && managerName && (
                <div>
                  <p className="text-[#9a9a95] uppercase tracking-widest text-[10px] font-bold mb-0.5">Менеджер</p>
                  <p className="text-[#111110]">{managerName}</p>
                </div>
              )}
            </div>

            {/* AMO link */}
            {order.amo_deal_url && (
              <div className="mt-3 pt-3 border-t border-[#f0f0ec]">
                <a href={order.amo_deal_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[13px] text-blue-600 hover:text-blue-800">
                  Открыть сделку в AmoCRM ↗
                </a>
              </div>
            )}
          </div>

          {/* Order lines */}
          <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
            <div className="px-5 py-3 border-b border-[#e4e4e0] bg-[#f8f8f7]">
              <p className="text-[12px] font-bold text-[#111110] uppercase tracking-widest">Позиции заказа</p>
            </div>
            {lines.length === 0 ? (
              <div className="px-5 py-6 text-[13px] text-[#9a9a95]">Позиции не найдены</div>
            ) : (
              <div className="divide-y divide-[#f0f0ec]">
                {lines.map(line => (
                  <div key={line.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-bold text-[#9a9a95] bg-[#f5f5f3] px-2 py-0.5 rounded uppercase tracking-wide">
                            {PRODUCT_TYPE_LABELS[line.product_type] ?? line.product_type}
                          </span>
                          {line.dimensions_text && (
                            <span className="text-[11px] text-[#b4b4b0] font-mono">{line.dimensions_text}</span>
                          )}
                        </div>
                        <p className="text-[14px] font-medium text-[#111110] mt-1">{line.product_name}</p>
                        {line.description && (
                          <p className="text-[12px] text-[#9a9a95] mt-0.5">{line.description}</p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[15px] font-bold font-mono text-[#111110]">{fmt(line.line_sale_price)}</p>
                        <MarginBadge status={line.margin_status} percent={line.margin_percent} />
                        <p className="text-[11px] text-[#b4b4b0] mt-1">Себест.: {fmt(line.line_cost_price)}</p>
                      </div>
                    </div>

                    {/* BOM preview */}
                    {(line.materials_bom?.length || line.hardware_bom?.length || line.services_bom?.length) ? (
                      <details className="mt-3">
                        <summary className="text-[11px] text-[#9a9a95] cursor-pointer hover:text-[#6b6b66] select-none">
                          Состав ({(line.materials_bom?.length ?? 0) + (line.hardware_bom?.length ?? 0) + (line.services_bom?.length ?? 0)} позиций) →
                        </summary>
                        <div className="mt-2 bg-[#fafaf9] rounded-lg p-3 space-y-3">
                          {line.materials_bom && line.materials_bom.length > 0 && (
                            <BOMSection title="Материалы" items={line.materials_bom} />
                          )}
                          {line.hardware_bom && line.hardware_bom.length > 0 && (
                            <BOMSection title="Фурнитура" items={line.hardware_bom} />
                          )}
                          {line.services_bom && line.services_bom.length > 0 && (
                            <BOMSection title="Услуги" items={line.services_bom} />
                          )}
                        </div>
                      </details>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            {/* Totals */}
            <div className="px-5 py-4 bg-[#f8f8f7] border-t border-[#e4e4e0]">
              <div className="flex justify-between items-center">
                <div className="space-y-1 text-[13px]">
                  <div className="flex gap-6">
                    <span className="text-[#6b6b66]">Себестоимость: <b className="text-[#111110] font-mono">{fmt(order.total_cost_price)}</b></span>
                    <span className="text-[#6b6b66]">Валовая прибыль: <b className="text-emerald-700 font-mono">{fmt(order.gross_profit)}</b></span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-[#9a9a95] uppercase tracking-widest">Итого</p>
                  <p className="text-[20px] font-bold font-mono text-[#111110]">{fmt(order.total_sale_price)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Production checklist */}
          {(order.status === 'in_work' || order.status === 'completed') && (
            <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
              <div className="px-5 py-3 bg-[#f8f8f7] border-b border-[#e4e4e0] flex items-center justify-between">
                <p className="text-[12px] font-bold text-[#9a9a95] uppercase tracking-wider">Производственное задание</p>
                <span className="text-[11px] text-[#9a9a95]">
                  {Object.keys(prodStages).length}/{PROD_STAGES.length} этапов
                </span>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {PROD_STAGES.map(s => {
                    const done = !!prodStages[s.key]
                    const date = prodStages[s.key]
                    return (
                      <button
                        key={s.key}
                        onClick={() => toggleStage(s.key)}
                        disabled={togglingStage === s.key}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                          done
                            ? 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-white border-[#e4e4e0] hover:border-[#c4c4c0] hover:bg-[#fafaf9]'
                        } ${togglingStage === s.key ? 'opacity-50' : ''}`}
                      >
                        <div className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center ${done ? 'bg-emerald-500' : 'border-2 border-[#d4d4d0]'}`}>
                          {done && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className={`text-[12px] font-medium leading-tight ${done ? 'text-emerald-800' : 'text-[#4b4b47]'}`}>
                            {s.label}
                          </p>
                          {date && (
                            <p className="text-[10px] text-emerald-600 mt-0.5">{date}</p>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
                <div className="mt-3">
                  <div className="h-1.5 bg-[#f0f0ec] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{ width: `${Math.round(Object.keys(prodStages).length / PROD_STAGES.length * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Delivery zone + address */}
          <div className="bg-white rounded-xl border border-[#e4e4e0] px-5 py-4 space-y-3">
            <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-widest">Доставка</p>

            {/* Zone selector */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-[#9a9a95] mb-1">Зона доставки</p>
                <select
                  value={zoneId}
                  onChange={e => {
                    const z = zones.find(z => z.id === e.target.value)
                    setZoneId(e.target.value)
                    if (z) setDeliveryCost(z.price)
                  }}
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0071e3] bg-white"
                >
                  <option value="">— не выбрана —</option>
                  {zones.filter(z => z.active).map(z => (
                    <option key={z.id} value={z.id}>
                      {z.name} {z.price > 0 ? `(${z.price.toLocaleString('ru-RU')} ₽)` : '(бесплатно)'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-[10px] text-[#9a9a95] mb-1">Стоимость доставки, ₽</p>
                <input
                  type="number"
                  min={0}
                  value={deliveryCost}
                  onChange={e => setDeliveryCost(Number(e.target.value))}
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0071e3]"
                />
              </div>
            </div>

            {/* Address */}
            <div>
              <p className="text-[10px] text-[#9a9a95] mb-1">Адрес доставки</p>
              <input
                type="text"
                value={deliveryAddr}
                onChange={e => setDeliveryAddr(e.target.value)}
                placeholder="Введите адрес доставки..."
                className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0071e3] bg-white"
              />
            </div>

            <button
              onClick={saveDeliveryAddr}
              disabled={savingAddr}
              className="px-4 py-2 bg-[#111110] text-white text-[13px] rounded-lg disabled:opacity-40 hover:bg-[#2a2a28] transition-colors"
            >
              {savingAddr ? 'Сохраняю...' : 'Сохранить доставку'}
            </button>
          </div>

          {/* Brigade assignment */}
          <div className="bg-white rounded-xl border border-[#e4e4e0] px-5 py-4 space-y-2">
            <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-widest">Бригада / монтажник</p>
            <div className="flex gap-2">
              <select
                value={brigadeId}
                onChange={async e => {
                  setBrigadeId(e.target.value)
                  await saveBrigade(e.target.value)
                }}
                disabled={savingBrigade}
                className="flex-1 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0071e3] bg-white disabled:opacity-50"
              >
                <option value="">— не назначена —</option>
                {brigades.filter(b => b.active).map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name}{b.lead_name ? ` · ${b.lead_name}` : ''}{b.phone ? ` · ${b.phone}` : ''}
                  </option>
                ))}
              </select>
              {savingBrigade && <span className="text-[12px] text-[#9a9a95] self-center">Сохраняю...</span>}
            </div>
            <AssignInstallationButton
              orderNo={customNumber || order.number}
              clientName={order.client_name}
              phone={order.client_phone}
              address={order.object_address || deliveryAddr}
              orderTotal={order.total_sale_price}
              className="w-full justify-center inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#111110] text-white text-[13px] font-semibold hover:bg-[#2a2a28] transition-colors"
              label="🔧 Назначить монтаж (в календарь)"
            />
          </div>

          {/* Payment tracking */}
          <div className="bg-white rounded-xl border border-[#e4e4e0] px-5 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-widest">Оплата</p>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${PAYMENT_STATUS_COLORS[paymentStatus]}`}>
                {PAYMENT_STATUS_LABELS[paymentStatus]}
              </span>
            </div>

            {/* Status buttons */}
            <div className="flex gap-2">
              {(['unpaid', 'partial', 'paid'] as PaymentStatus[]).map(s => (
                <button
                  key={s}
                  onClick={() => setPaymentStatus(s)}
                  className={`flex-1 py-2 text-[12px] font-medium rounded-lg border transition-colors ${
                    paymentStatus === s
                      ? PAYMENT_STATUS_COLORS[s] + ' font-semibold'
                      : 'bg-white border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f8f8f7]'
                  }`}
                >
                  {PAYMENT_STATUS_LABELS[s]}
                </button>
              ))}
            </div>

            {/* Prepayment fields — only when partial */}
            {paymentStatus === 'partial' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] text-[#9a9a95] mb-1">Сумма предоплаты, ₽</p>
                  <input
                    type="number"
                    min={0}
                    value={prepayAmount}
                    onChange={e => setPrepayAmount(e.target.value)}
                    placeholder="0"
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0071e3]"
                  />
                </div>
                <div>
                  <p className="text-[10px] text-[#9a9a95] mb-1">Дата предоплаты</p>
                  <input
                    type="date"
                    value={prepayDate}
                    onChange={e => setPrepayDate(e.target.value)}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0071e3]"
                  />
                </div>
              </div>
            )}

            <div>
              <p className="text-[10px] text-[#9a9a95] mb-1">Заметка об оплате</p>
              <input
                type="text"
                value={paymentNotes}
                onChange={e => setPaymentNotes(e.target.value)}
                placeholder="Например: оплата наличными, ждём перевода..."
                className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0071e3]"
              />
            </div>

            <button
              onClick={savePayment}
              disabled={savingPayment}
              className="w-full py-2 bg-[#111110] text-white text-[13px] font-medium rounded-lg disabled:opacity-40 hover:bg-[#2a2a28] transition-colors"
            >
              {savingPayment ? 'Сохраняю...' : 'Сохранить оплату'}
            </button>
            {payWarning && (
              <p className="text-[12px] text-amber-700">
                ⚠️ Статус сохранён, но деньги не попали в учёт — продажа не появится в Отделе продаж. {payWarning}
              </p>
            )}
          </div>

          {/* Completion photos */}
          {(order.status === 'in_work' || order.status === 'completed') && (
            <div className="bg-white rounded-xl border border-[#e4e4e0] px-5 py-4">
              <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-widest mb-3">Фото готового изделия</p>
              <div className="flex flex-wrap gap-3">
                {photos.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                    <img src={url} alt={`Фото ${i + 1}`} className="w-24 h-24 object-cover rounded-lg border border-[#e4e4e0] hover:opacity-80 transition-opacity" />
                  </a>
                ))}
                <label className={`w-24 h-24 flex flex-col items-center justify-center border-2 border-dashed border-[#e4e4e0] rounded-lg cursor-pointer hover:border-[#c4c4c0] transition-colors ${photoUploading ? 'opacity-40 pointer-events-none' : ''}`}>
                  <svg className="w-6 h-6 text-[#b4b4b0] mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                  </svg>
                  <span className="text-[10px] text-[#b4b4b0]">{photoUploading ? 'Загрузка...' : 'Добавить'}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && uploadPhoto(e.target.files[0])} />
                </label>
              </div>
            </div>
          )}

          {/* Notes */}
          {order.notes && (
            <div className="bg-white rounded-xl border border-[#e4e4e0] px-5 py-4">
              <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-widest mb-1">Комментарий</p>
              <p className="text-[13px] text-[#4b4b47]">{order.notes}</p>
            </div>
          )}

          {/* Approval history */}
          {order.approved_at && (
            <div className="bg-white rounded-xl border border-[#e4e4e0] px-5 py-4">
              <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-widest mb-1">Одобрение</p>
              <p className="text-[13px] text-emerald-700">
                Одобрено {new Date(order.approved_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}
              </p>
              {order.approval_notes && (
                <p className="text-[12px] text-[#6b6b66] mt-0.5">{order.approval_notes}</p>
              )}
            </div>
          )}

          {/* Installer rating */}
          {order.status === 'completed' && (
            <div className="bg-white rounded-xl border border-[#e4e4e0] px-5 py-4">
              <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-widest mb-3">Оценка монтажа</p>
              {ratingSaved ? (
                <p className="text-[13px] text-emerald-700 font-medium">✓ Спасибо за оценку!</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map(n => (
                      <button key={n} onClick={() => setRating(n)}
                        className={`text-[22px] transition-transform hover:scale-110 ${n <= rating ? 'opacity-100' : 'opacity-30'}`}>
                        ★
                      </button>
                    ))}
                  </div>
                  {rating > 0 && (
                    <>
                      <input
                        type="text"
                        value={ratingComment}
                        onChange={e => setRatingComment(e.target.value)}
                        placeholder="Комментарий (необязательно)"
                        className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0071e3]"
                      />
                      <button onClick={saveRating} disabled={savingRating}
                        className="px-4 py-2 bg-[#111110] text-white text-[13px] rounded-lg disabled:opacity-40 hover:bg-[#2a2a28]">
                        {savingRating ? 'Сохраняю...' : 'Сохранить оценку'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Admin status actions */}
          {isAdmin && order.status === 'in_work' && (
            <div className="flex gap-2">
              <button onClick={() => handleStatusChange('completed')}
                className="px-4 py-2.5 bg-emerald-600 text-white text-[13px] font-medium rounded-lg hover:bg-emerald-700">
                Завершить заказ ✓
              </button>
              <button onClick={() => handleStatusChange('cancelled')}
                className="px-4 py-2.5 border border-[#e4e4e0] text-[13px] text-[#9a9a95] rounded-lg hover:bg-[#f8f8f7] hover:text-red-500">
                Отменить
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function BOMSection({ title, items }: { title: string; items: { name: string; qty: number; unit: string; unit_cost: number; total: number }[] }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-[#9a9a95] uppercase tracking-widest mb-1.5">{title}</p>
      <div className="space-y-0.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between text-[12px]">
            <span className="text-[#4b4b47]">{item.name}</span>
            <div className="flex items-center gap-3 text-[#9a9a95]">
              <span>{item.qty} {item.unit}</span>
              <span className="font-mono text-[#111110]">{item.total.toLocaleString('ru-RU')} ₽</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
