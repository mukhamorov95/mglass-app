'use client'

import { useState } from 'react'
import type { Order, OrderLine } from '@/lib/types'

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  mirror:          'Зеркало с подсветкой',
  loft:            'Лофт-перегородка',
  shower_budget:   'Душевая бюджет',
  shower_standard: 'Душевая стандарт',
  b2b:             'B2B стекло',
  service:         'Услуга',
  custom:          'Прочее',
}

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

type Props = { order: Order; lines: OrderLine[]; isAdmin: boolean }

export default function PrintClient({ order, lines, isAdmin }: Props) {
  const [mode, setMode] = useState<'client' | 'production'>('client')

  return (
    <>
      {/* Toolbar — hidden on print */}
      <div className="print:hidden fixed top-0 left-0 right-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3 z-10">
        <a href={`/orders/${order.id}`} className="text-sm text-gray-500 hover:text-gray-800">← Назад к заказу</a>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 ml-4">
          <button onClick={() => setMode('client')}
            className={`px-3 py-1 rounded text-xs font-medium transition-all ${mode === 'client' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
            Для клиента
          </button>
          {isAdmin && (
            <button onClick={() => setMode('production')}
              className={`px-3 py-1 rounded text-xs font-medium transition-all ${mode === 'production' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              Для производства
            </button>
          )}
        </div>
        <button onClick={() => window.print()}
          className="ml-auto px-4 py-1.5 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700">
          Печать
        </button>
      </div>

      {/* Print content */}
      <div className="print:pt-0 pt-16 min-h-screen bg-white">
        <div className="max-w-[720px] mx-auto px-8 py-8 print:px-6 print:py-4">

          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 bg-gray-900 rounded-md flex items-center justify-center">
                  <span className="text-white text-[11px] font-bold">MG</span>
                </div>
                <span className="text-lg font-bold text-gray-900">MGlass</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {new Date(order.created_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400 uppercase tracking-widest mb-0.5">Заказ</p>
              <p className="text-xl font-bold font-mono text-gray-900">{order.number}</p>
              {order.status === 'in_work' && (
                <span className="text-[11px] text-blue-600 font-medium">В работе</span>
              )}
            </div>
          </div>

          {/* Client info */}
          <div className="border-t border-b border-gray-200 py-4 mb-6">
            <p className="text-lg font-semibold text-gray-900 mb-1">{order.client_name}</p>
            <div className="flex flex-wrap gap-4 text-sm text-gray-500">
              {order.client_phone   && <span>{order.client_phone}</span>}
              {order.object_address && <span>{order.object_address}</span>}
              {order.amo_deal_id    && <span>Сделка {order.amo_deal_id}</span>}
            </div>
          </div>

          {/* Lines */}
          <div className="mb-6">
            {lines.map((line, idx) => (
              <div key={line.id} className={`py-3 ${idx < lines.length - 1 ? 'border-b border-gray-100' : ''}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] text-gray-400 font-semibold uppercase">{idx + 1}.</span>
                      <span className="text-[11px] text-gray-400 uppercase tracking-wide">
                        {PRODUCT_TYPE_LABELS[line.product_type] ?? line.product_type}
                      </span>
                      {line.dimensions_text && (
                        <span className="text-[11px] text-gray-400 font-mono">{line.dimensions_text}</span>
                      )}
                    </div>
                    <p className="text-[14px] font-medium text-gray-900">{line.product_name}</p>
                    {line.description && (
                      <p className="text-[12px] text-gray-500 mt-0.5">{line.description}</p>
                    )}

                    {/* Production BOM */}
                    {mode === 'production' && (
                      <div className="mt-2 space-y-1">
                        {line.materials_bom && line.materials_bom.length > 0 && (
                          <div>
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Материалы</p>
                            {line.materials_bom.map((item, i) => (
                              <div key={i} className="flex justify-between text-[11px]">
                                <span className="text-gray-600">{item.name}</span>
                                <span className="text-gray-400">{item.qty} {item.unit}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {line.hardware_bom && line.hardware_bom.length > 0 && (
                          <div>
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Фурнитура</p>
                            {line.hardware_bom.map((item, i) => (
                              <div key={i} className="flex justify-between text-[11px]">
                                <span className="text-gray-600">{item.name}</span>
                                <span className="text-gray-400">{item.qty} {item.unit}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    {mode === 'client' && (
                      <p className="text-[14px] font-bold font-mono text-gray-900">{fmt(line.line_sale_price)}</p>
                    )}
                    {mode === 'production' && (
                      <>
                        <p className="text-[11px] text-gray-400">Себест.: {fmt(line.line_cost_price)}</p>
                        <p className="text-[13px] font-bold font-mono text-gray-900">{fmt(line.line_sale_price)}</p>
                        <p className="text-[10px] text-gray-400">Маржа {line.margin_percent.toFixed(1)}%</p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="border-t border-gray-200 pt-4">
            {mode === 'production' && (
              <div className="flex justify-between text-sm text-gray-500 mb-1">
                <span>Себестоимость</span>
                <span className="font-mono">{fmt(order.total_cost_price)}</span>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-base font-semibold text-gray-900">Итого</span>
              <span className="text-xl font-bold font-mono text-gray-900">{fmt(order.total_sale_price)}</span>
            </div>
          </div>

          {/* Deadline */}
          {order.deadline && (
            <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between text-sm">
              <span className="text-gray-500">Срок выполнения</span>
              <span className="font-medium text-gray-900">
                {new Date(order.deadline).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
            </div>
          )}

          {/* Notes */}
          {order.notes && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-[11px] text-gray-400 uppercase tracking-widest mb-1">Комментарий</p>
              <p className="text-sm text-gray-600">{order.notes}</p>
            </div>
          )}

          {/* Footer */}
          <div className="mt-10 pt-4 border-t border-gray-100 text-[10px] text-gray-300 text-center">
            MGlass · {order.number} · {new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}
          </div>
        </div>
      </div>

      <style>{`@media print { .print\\:hidden { display: none !important; } .print\\:pt-0 { padding-top: 0 !important; } .print\\:px-6 { padding-left: 1.5rem !important; padding-right: 1.5rem !important; } .print\\:py-4 { padding-top: 1rem !important; padding-bottom: 1rem !important; } }`}</style>
    </>
  )
}
