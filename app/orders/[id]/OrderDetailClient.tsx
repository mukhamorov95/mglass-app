'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Order, OrderLine, OrderStatus, MarginStatus } from '@/lib/types'
import {
  ORDER_STATUS_LABELS, MARGIN_STATUS_LABELS, MARGIN_STATUS_COLORS,
} from '@/lib/types'

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

  const daysInWork = order.launched_at
    ? Math.ceil((Date.now() - new Date(order.launched_at).getTime()) / 86_400_000)
    : null

  const daysToDeadline = order.deadline
    ? Math.ceil((new Date(order.deadline).getTime() - Date.now()) / 86_400_000)
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
          <Link href={`/orders/${order.id}/print`} target="_blank"
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-[#f8f8f7] hover:text-[#111110] transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/>
            </svg>
            Печать
          </Link>
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
                <div className="flex items-center gap-3 flex-wrap mb-1">
                  <h1 className="text-[20px] font-bold text-[#111110] font-mono">{order.number}</h1>
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
                <p className="text-[#111110]">{new Date(order.created_at).toLocaleDateString('ru-RU')}</p>
              </div>
              {order.launched_at && (
                <div>
                  <p className="text-[#9a9a95] uppercase tracking-widest text-[10px] font-bold mb-0.5">Запущен</p>
                  <p className="text-[#111110]">{new Date(order.launched_at).toLocaleDateString('ru-RU')}</p>
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
                    {new Date(order.deadline).toLocaleDateString('ru-RU')}
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
                Одобрено {new Date(order.approved_at).toLocaleDateString('ru-RU')}
              </p>
              {order.approval_notes && (
                <p className="text-[12px] text-[#6b6b66] mt-0.5">{order.approval_notes}</p>
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
