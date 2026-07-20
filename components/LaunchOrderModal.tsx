'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  BOMLine, MarginStatus,
  MARGIN_STATUS_LABELS, MARGIN_STATUS_COLORS,
  computeMarginStatus,
} from '@/lib/types'

export type LaunchOrderPayload = {
  product_type:    string
  product_name:    string
  description?:    string
  dimensions_text?: string
  quantity?:       number
  unit?:           string
  unit_cost_price: number
  unit_sale_price: number
  discount_percent?: number
  line_cost_price: number
  line_sale_price: number
  margin_percent:  number
  input_snapshot:  Record<string, unknown>
  cost_snapshot:   Record<string, unknown>
  materials_bom:   BOMLine[]
  hardware_bom:    BOMLine[]
  services_bom:    BOMLine[]
  calculation_id?: number | null
}

type Props = {
  isOpen:    boolean
  onClose:   () => void
  payload:   LaunchOrderPayload | null
  settings:  { default_margin: number; min_margin: number } | null
}

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

export default function LaunchOrderModal({ isOpen, onClose, payload, settings }: Props) {
  const router = useRouter()
  const nameRef = useRef<HTMLInputElement>(null)

  const [customNumber,  setCustomNumber]  = useState('')
  const [clientName,    setClientName]    = useState('')
  const [clientPhone,   setClientPhone]   = useState('')
  const [address,       setAddress]       = useState('')
  const [amoDealUrl,    setAmoDealUrl]     = useState('')
  const [deadline,      setDeadline]      = useState('')
  const [notes,         setNotes]         = useState('')
  const [submitting,    setSubmitting]    = useState(false)
  const [error,         setError]         = useState('')

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCustomNumber(''); setClientName(''); setClientPhone(''); setAddress('')
      setAmoDealUrl(''); setDeadline(''); setNotes(''); setError('')
      setTimeout(() => nameRef.current?.focus(), 80)
    }
  }, [isOpen])

  if (!isOpen || !payload) return null

  const ms: MarginStatus = computeMarginStatus(
    payload.margin_percent,
    settings ?? { default_margin: 40, min_margin: 25 },
  )
  const colors = MARGIN_STATUS_COLORS[ms]
  const needsApproval = ms === 'red' || ms === 'blocked'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!clientName.trim()) { setError('Укажите имя клиента'); return }
    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/orders', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          custom_number:  customNumber.trim() || null,
          client_name:    clientName.trim(),
          client_phone:   clientPhone.trim() || null,
          object_address: address.trim()     || null,
          amo_deal_url:   amoDealUrl.trim()  || null,
          amo_deal_id:    extractAmoId(amoDealUrl),
          deadline:       deadline || null,
          notes:          notes.trim() || null,
          line:           payload,
          financial_settings: settings,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Ошибка создания заказа'); return }
      router.push(`/orders/${data.id}`)
      onClose()
    } catch {
      setError('Сетевая ошибка')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e4e4e0]">
          <div>
            <p className="text-[15px] font-semibold text-[#111110]">Запустить в работу</p>
            <p className="text-[12px] text-[#9a9a95] mt-0.5">{payload.product_name}</p>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[#f5f5f3] text-[#6b6b66] text-xl leading-none">
            ×
          </button>
        </div>

        {/* Margin summary */}
        <div className={`mx-6 mt-4 rounded-xl border px-4 py-3 ${colors.bg} ${colors.border}`}>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-3 text-[13px]">
                <span className={`font-medium ${colors.text}`}>{MARGIN_STATUS_LABELS[ms]}</span>
                <span className={`font-mono font-bold text-[15px] ${colors.text}`}>
                  {payload.margin_percent.toFixed(1)}%
                </span>
              </div>
              <div className="flex gap-4 text-[11px] text-[#6b6b66]">
                <span>Себестоимость: <b>{fmt(payload.line_cost_price)}</b></span>
                <span>Цена клиенту: <b>{fmt(payload.line_sale_price)}</b></span>
              </div>
            </div>
            <div className={`text-[22px] ${ms === 'green' ? '' : ''}`}>
              {ms === 'green' ? '🟢' : ms === 'yellow' ? '🟡' : ms === 'red' ? '🔴' : '⛔'}
            </div>
          </div>
          {needsApproval && (
            <p className={`mt-2 text-[11px] font-medium ${colors.text}`}>
              ⚠ Маржа ниже минимума — заказ отправится на одобрение администратора
            </p>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-3">

          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1">
              Номер заказа
            </label>
            <input
              type="text"
              value={customNumber}
              onChange={e => setCustomNumber(e.target.value)}
              placeholder="0147-О, МГ-2026-001..."
              className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] font-mono outline-none focus:border-[#111110] transition-colors"
            />
            <p className="text-[10px] text-[#9a9a95] mt-0.5">Свой номер для поиска и распечатки</p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1">
              Клиент <span className="text-red-500">*</span>
            </label>
            <input
              ref={nameRef}
              type="text"
              value={clientName}
              onChange={e => setClientName(e.target.value)}
              placeholder="Иванов Александр"
              className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1">
                Телефон
              </label>
              <input
                type="text"
                value={clientPhone}
                onChange={e => setClientPhone(e.target.value)}
                placeholder="+7 999 123-45-67"
                className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1">
                Дедлайн
              </label>
              <input
                type="date"
                value={deadline}
                onChange={e => setDeadline(e.target.value)}
                className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1">
              Адрес объекта
            </label>
            <input
              type="text"
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="ул. Мира, 15, кв. 24"
              className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] transition-colors"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1">
              Ссылка на сделку AmoCRM
            </label>
            <input
              type="url"
              value={amoDealUrl}
              onChange={e => setAmoDealUrl(e.target.value)}
              placeholder="https://mglass.amocrm.ru/leads/detail/12345"
              className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] transition-colors font-mono text-[12px]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1">
              Комментарий
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Дополнительные детали..."
              className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] transition-colors resize-none"
            />
          </div>

          {error && (
            <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-[#e4e4e0]">
          <button type="button" onClick={onClose}
            className="flex-1 py-2.5 rounded-lg border border-[#e4e4e0] text-[13px] text-[#6b6b66] hover:bg-[#f8f8f7] transition-colors">
            Отмена
          </button>
          <button
            onClick={handleSubmit as unknown as React.MouseEventHandler}
            disabled={submitting}
            className={`flex-1 py-2.5 rounded-lg text-[13px] font-medium text-white transition-colors disabled:opacity-40 ${
              needsApproval
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-[#111110] hover:bg-[#2a2a28]'
            }`}
          >
            {submitting
              ? 'Создание...'
              : needsApproval
                ? 'Отправить на одобрение →'
                : 'Запустить в работу →'}
          </button>
        </div>
      </div>
    </div>
  )
}

function extractAmoId(url: string): string | null {
  if (!url) return null
  const m = url.match(/\/(\d+)\/?$/)
  return m ? m[1] : null
}
