'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { Order, OrderStatus, MarginStatus, PaymentStatus } from '@/lib/types'
import { ORDER_STATUS_LABELS, MARGIN_STATUS_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_COLORS } from '@/lib/types'

const STATUS_STYLE: Record<OrderStatus, string> = {
  draft:            'bg-gray-100 text-gray-600',
  pending_approval: 'bg-red-100 text-red-700',
  approved:         'bg-amber-100 text-amber-700',
  in_work:          'bg-blue-100 text-blue-700',
  completed:        'bg-emerald-100 text-emerald-700',
  cancelled:        'bg-gray-100 text-gray-400',
}

const MARGIN_DOT: Record<MarginStatus, string> = {
  green:   'bg-emerald-500',
  yellow:  'bg-amber-400',
  red:     'bg-red-500',
  blocked: 'bg-neutral-800',
}

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

function deadlineBadge(deadline: string | null) {
  if (!deadline) return null
  const days = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000)
  if (days < 0)  return <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">просрочка {Math.abs(days)}д</span>
  if (days === 0) return <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">сегодня</span>
  if (days <= 3)  return <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">{days}д</span>
  return <span className="text-[10px] text-[#9a9a95] bg-[#f5f5f3] px-1.5 py-0.5 rounded">{days}д</span>
}

type Props = {
  orders:   Order[]
  isAdmin:  boolean
  usersMap: Record<string, string>
}

export default function OrdersClient({ orders, isAdmin, usersMap }: Props) {
  const [filterStatus, setFilterStatus] = useState<OrderStatus | 'all'>('all')
  const [search, setSearch] = useState('')

  const filtered = orders.filter(o => {
    if (filterStatus !== 'all' && o.status !== filterStatus) return false
    if (search) {
      const q = search.toLowerCase()
      return o.number.toLowerCase().includes(q) ||
             (o.custom_number ?? '').toLowerCase().includes(q) ||
             o.client_name.toLowerCase().includes(q) ||
             (o.object_address ?? '').toLowerCase().includes(q)
    }
    return true
  })

  const pendingApproval = orders.filter(o => o.status === 'pending_approval')
  const unpaidActive    = orders.filter(o =>
    (!o.payment_status || o.payment_status === 'unpaid') &&
    (o.status === 'in_work' || o.status === 'approved')
  )
  const totalDebt = unpaidActive.reduce((s, o) => s + o.total_sale_price, 0)

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[1100px] mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-[22px] font-bold text-[#111110] tracking-tight">Заказы</h1>
            <p className="text-[13px] text-[#9a9a95] mt-0.5">
              {isAdmin ? 'Все заказы компании' : 'Мои заказы'}
            </p>
          </div>
          <div className="text-[13px] text-[#9a9a95]">{filtered.length} заказов</div>
        </div>

        {/* Unpaid orders alert */}
        {isAdmin && unpaidActive.length > 0 && (
          <div className="mb-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="text-amber-500 text-lg">💰</span>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-amber-800">
                {unpaidActive.length} активных заказов без оплаты — {fmt(totalDebt)}
              </p>
              <p className="text-[11px] text-amber-700 mt-0.5">Активные заказы без предоплаты или оплаты</p>
            </div>
          </div>
        )}

        {/* Pending approval alert */}
        {isAdmin && pendingApproval.length > 0 && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="text-red-500 text-lg">⚠</span>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-red-700">
                {pendingApproval.length} заказ{pendingApproval.length > 1 ? 'а' : ''} ждут одобрения
              </p>
              <div className="flex flex-wrap gap-2 mt-1">
                {pendingApproval.map(o => (
                  <Link key={o.id} href={`/orders/${o.id}`}
                    className="text-[12px] text-red-600 hover:text-red-800 underline">
                    {o.number} — {o.client_name} ({o.margin_percent.toFixed(1)}%)
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4 items-center">
          <input
            type="text" placeholder="Поиск по номеру, клиенту, адресу..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] bg-white w-72"
          />
          <div className="flex gap-1 flex-wrap">
            {(['all', 'pending_approval', 'in_work', 'completed', 'cancelled'] as const).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                  filterStatus === s ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f8f8f7]'
                }`}>
                {s === 'all' ? 'Все' : ORDER_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Orders list */}
        {filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-12 text-center">
            <p className="text-[13px] text-[#9a9a95]">Заказов не найдено</p>
            <p className="text-[12px] text-[#b4b4b0] mt-1">
              Создайте заказ через калькулятор, нажав «Запустить в работу»
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(order => (
              <Link key={order.id} href={`/orders/${order.id}`}
                className="block bg-white rounded-xl border border-[#e4e4e0] px-5 py-4 hover:border-[#c4c4c0] hover:shadow-sm transition-all">
                <div className="flex items-start gap-4">

                  {/* Margin dot */}
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 ${MARGIN_DOT[order.margin_status]}`} />

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      {order.custom_number && (
                        <span className="text-[15px] font-bold text-[#111110] font-mono">{order.custom_number}</span>
                      )}
                      <span className={`text-[12px] font-mono text-[#9a9a95]`}>{order.number}</span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${STATUS_STYLE[order.status]}`}>
                        {ORDER_STATUS_LABELS[order.status]}
                      </span>
                      {order.payment_status && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${PAYMENT_STATUS_COLORS[order.payment_status as PaymentStatus] ?? 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                          {PAYMENT_STATUS_LABELS[order.payment_status as PaymentStatus] ?? order.payment_status}
                          {order.payment_status === 'partial' && order.prepayment_amount
                            ? ` ${fmt(order.prepayment_amount)}`
                            : ''}
                        </span>
                      )}
                      {order.deadline && deadlineBadge(order.deadline)}
                    </div>
                    <p className="text-[14px] text-[#111110] mt-0.5">{order.client_name}</p>
                    {order.object_address && (
                      <p className="text-[12px] text-[#9a9a95] mt-0.5">{order.object_address}</p>
                    )}
                    {isAdmin && order.manager_id && usersMap[order.manager_id] && (
                      <p className="text-[11px] text-[#b4b4b0] mt-0.5">Менеджер: {usersMap[order.manager_id]}</p>
                    )}
                  </div>

                  {/* Financial summary */}
                  <div className="text-right flex-shrink-0">
                    <p className="text-[15px] font-bold text-[#111110] font-mono">{fmt(order.total_sale_price)}</p>
                    <p className="text-[12px] text-[#9a9a95]">
                      Маржа{' '}
                      <span className={`font-semibold ${
                        order.margin_status === 'green'   ? 'text-emerald-600' :
                        order.margin_status === 'yellow'  ? 'text-amber-600'   :
                        order.margin_status === 'red'     ? 'text-red-600'     :
                                                            'text-neutral-800'
                      }`}>
                        {order.margin_percent.toFixed(1)}%
                      </span>
                    </p>
                    <p className="text-[11px] text-[#b4b4b0] mt-0.5">
                      {new Date(order.created_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
