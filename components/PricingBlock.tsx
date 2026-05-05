'use client'

import { useState } from 'react'
import type { FinancialSettings, PartnerType } from '@/lib/types'
import { computeMarginStatus } from '@/lib/types'

type Props = {
  settings: FinancialSettings
  margin: string
  onMarginChange: (v: string) => void
  discount?: string
  onDiscountChange?: (v: string) => void
  partners?: PartnerType[]
  partnerId?: number | null
  onPartnerChange?: (id: number | null) => void
  actualMargin?: number
}

export default function PricingBlock({
  settings, margin, onMarginChange,
  discount, onDiscountChange,
  partners, partnerId, onPartnerChange,
  actualMargin,
}: Props) {
  const [showBreakdown, setShowBreakdown] = useState(false)

  const expenses   = settings.tax_percent
  const marginNum  = actualMargin ?? (Number(margin) || 0)
  const status     = computeMarginStatus(marginNum, settings)

  const inputBorder = (status === 'red' || status === 'blocked')
    ? 'border-red-400 bg-red-50'
    : 'border-[#e4e4e0]'

  const expenseRows = [
    { label: 'Налог',        v: settings.tax_percent },
    { label: 'Менеджер',     v: settings.manager_percent },
    { label: 'Реализация',   v: settings.realization_percent },
    { label: 'Маркетинг',    v: settings.marketing_percent },
    { label: 'Транспорт',    v: settings.transport_percent },
    { label: 'Операционные', v: settings.operation_percent },
  ].filter(r => r.v > 0)

  return (
    <div className="space-y-2.5">
      {/* Expenses */}
      <div>
        <button
          onClick={() => setShowBreakdown(v => !v)}
          className="flex items-center gap-1 text-[10px] text-[#9a9a95] hover:text-[#6b6b66] transition-colors"
        >
          Расходы {expenses}%
          <svg className={`w-2.5 h-2.5 transition-transform ${showBreakdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showBreakdown && (
          <div className="mt-1.5 pl-2 border-l-2 border-[#f0f0ec] space-y-0.5">
            {expenseRows.map(r => (
              <div key={r.label} className="flex justify-between">
                <span className="text-[10px] text-[#9a9a95]">{r.label}</span>
                <span className="text-[10px] font-mono text-[#6b6b66]">{r.v}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Editable fields */}
      <div className="flex flex-wrap gap-2.5 items-end">
        <div>
          <p className="text-[10px] text-[#9a9a95] mb-1">Маржа (%)</p>
          <input
            type="number" min={settings.yellow_threshold ?? settings.min_margin ?? 0} max="70"
            value={margin} onChange={e => onMarginChange(e.target.value)}
            className={`w-20 border rounded-md px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-400 ${inputBorder}`}
          />
        </div>

        {onDiscountChange !== undefined && (
          <div>
            <p className="text-[10px] text-[#9a9a95] mb-1">Скидка (%)</p>
            <input
              type="number" min="0" max="30"
              value={discount ?? '0'} onChange={e => onDiscountChange(e.target.value)}
              className="w-20 border border-[#e4e4e0] rounded-md px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-400"
            />
          </div>
        )}

        {onPartnerChange && partners && partners.filter(p => p.percent > 0).length > 0 && (
          <div>
            <p className="text-[10px] text-[#9a9a95] mb-1">Партнёрка</p>
            <div className="flex gap-1 flex-wrap">
              {partners.filter(p => p.percent > 0).map(p => (
                <button key={p.id}
                  onClick={() => onPartnerChange(partnerId === p.id ? null : p.id)}
                  className={`px-2 py-1 rounded-md text-xs font-medium border transition-colors ${
                    partnerId === p.id
                      ? 'bg-purple-600 text-white border-purple-600'
                      : 'bg-white text-[#4b4b47] border-[#e4e4e0] hover:bg-[#fafaf9]'
                  }`}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Status hint */}
      {status !== 'green' && (
        <p className={`text-[10px] font-medium ${
          status === 'blocked' ? 'text-red-700' :
          status === 'red'     ? 'text-red-600' : 'text-amber-600'
        }`}>
          {status === 'blocked' && `Маржа ниже минимума — требуется одобрение`}
          {status === 'red'     && `Маржа ниже минимума (${settings.yellow_threshold ?? settings.min_margin ?? 25}%)`}
          {status === 'yellow'  && `Ниже целевой (${settings.green_threshold ?? settings.default_margin ?? 35}%)`}
        </p>
      )}
    </div>
  )
}
