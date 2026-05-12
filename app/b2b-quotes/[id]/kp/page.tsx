'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'

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
  hasTempering?: boolean
  comment?: string
  services?: { id: number; name: string; cost: number }[]
}

type Order = {
  id: number
  client_id: number | null
  client_name: string
  discount_percent: number
  items: OrderItem[]
  total_area: number
  total_weight: number
  total_sale_inc_vat: number
  total_after_discount: number
  notes: string | null
  created_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseNotes(notes: string | null): Record<string, unknown> {
  if (!notes) return {}
  try { const p = JSON.parse(notes); if (typeof p === 'object' && p !== null) return p } catch {}
  return {}
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtN(n: number, dec = 3): string {
  return (n ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: dec })
}

function fmt(n: number): string {
  return Math.round(n ?? 0).toLocaleString('ru-RU') + ' ₽'
}

function kpNumber(id: number, dateStr: string): string {
  const d = new Date(dateStr)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `КП-${y}${m}-${String(id).padStart(4, '0')}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function KPPrintPage() {
  const params = useParams()
  const id = Number(params.id)

  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    createClient()
      .from('b2b_orders')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) { setError('Расчёт не найден'); setLoading(false); return }
        const raw = data as Record<string, unknown>
        const items: OrderItem[] = Array.isArray(raw.items) ? (raw.items as OrderItem[]) : []
        setOrder({
          id: raw.id as number,
          client_id: raw.client_id as number | null,
          client_name: (raw.client_name as string) || 'Клиент',
          discount_percent: (raw.discount_percent as number) || 0,
          items,
          total_area: (raw.total_area as number) || 0,
          total_weight: (raw.total_weight as number) || 0,
          total_sale_inc_vat: (raw.total_sale_inc_vat as number) || 0,
          total_after_discount: (raw.total_after_discount as number) || 0,
          notes: (raw.notes as string) || null,
          created_at: raw.created_at as string,
        })
        setLoading(false)
      })
  }, [id])

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen text-[#6b6b66] text-sm">
      Загрузка...
    </div>
  )

  if (error || !order) return (
    <div className="flex items-center justify-center min-h-screen text-red-500 text-sm">
      {error ?? 'Ошибка загрузки'}
    </div>
  )

  const notes       = parseNotes(order.notes)
  const userNotes   = (notes.user_notes as string) || ''
  const quoteDate   = order.created_at
  const validUntil  = addDays(quoteDate, 7)
  const kpNum       = kpNumber(order.id, quoteDate)
  const discount    = order.discount_percent || 0
  const totalFinal  = order.total_after_discount || order.total_sale_inc_vat
  const totalBase   = order.total_sale_inc_vat
  const totalArea   = order.total_area
  const totalWeight = order.total_weight

  const items = order.items

  return (
    <>
      {/* Print + screen layout styles */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #kp-document, #kp-document * { visibility: visible !important; }
          #kp-document { position: fixed; top: 0; left: 0; width: 100%; }
          #kp-print-btn { display: none !important; }
          @page { margin: 15mm; size: A4; }
        }
        body { background: #f5f5f0; }
      `}</style>

      {/* Print button — screen only */}
      <div id="kp-print-btn" className="fixed top-4 right-4 z-50 print:hidden">
        <button
          onClick={() => window.print()}
          className="bg-[#1a1a18] text-white text-sm px-4 py-2 rounded-lg shadow-lg hover:bg-[#2a2a26] transition-colors"
        >
          Печать / PDF
        </button>
      </div>

      {/* KP Document */}
      <div id="kp-document" className="max-w-[794px] mx-auto my-8 bg-white shadow-xl print:shadow-none print:my-0 text-[#1a1a18]">

        {/* Header */}
        <div className="px-10 pt-10 pb-6 border-b border-[#e8e8e4]">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[22px] font-bold tracking-tight text-[#1a1a18]">
                MGlass
              </div>
              <div className="text-[11px] text-[#6b6b66] mt-0.5">
                Производство и монтаж стеклянных конструкций
              </div>
            </div>
            <div className="text-right">
              <div className="text-[13px] font-semibold text-[#1a1a18]">{kpNum}</div>
              <div className="text-[11px] text-[#6b6b66] mt-0.5">от {fmtDate(quoteDate)}</div>
              <div className="text-[11px] text-[#6b6b66]">действует до {validUntil}</div>
            </div>
          </div>

          <div className="mt-5 flex items-end justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#9b9b96] mb-1">Коммерческое предложение для</div>
              <div className="text-[15px] font-semibold">{order.client_name}</div>
            </div>
          </div>
        </div>

        {/* Items table */}
        <div className="px-10 py-6">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="border-b-2 border-[#1a1a18]">
                <th className="text-left py-2 pr-2 font-semibold text-[10px] uppercase tracking-wide text-[#6b6b66] w-6">№</th>
                <th className="text-left py-2 pr-2 font-semibold text-[10px] uppercase tracking-wide text-[#6b6b66]">Материал</th>
                <th className="text-center py-2 px-2 font-semibold text-[10px] uppercase tracking-wide text-[#6b6b66] w-10">Толщ.</th>
                <th className="text-center py-2 px-2 font-semibold text-[10px] uppercase tracking-wide text-[#6b6b66] w-28">Размер (мм)</th>
                <th className="text-center py-2 px-2 font-semibold text-[10px] uppercase tracking-wide text-[#6b6b66] w-12">Кол-во</th>
                <th className="text-center py-2 px-2 font-semibold text-[10px] uppercase tracking-wide text-[#6b6b66] w-16">Площадь м²</th>
                <th className="text-right py-2 pl-2 font-semibold text-[10px] uppercase tracking-wide text-[#6b6b66] w-20">Стоимость</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const itemTotal = item.saleIncVat ?? 0
                const svcTotal  = (item.services ?? []).reduce((s, sv) => s + (sv.cost ?? 0), 0)
                const baseTotal = itemTotal - svcTotal
                return (
                  <>
                    <tr key={`item-${idx}`} className="border-b border-[#f0f0ec]">
                      <td className="py-2.5 pr-2 text-[#9b9b96]">{idx + 1}</td>
                      <td className="py-2.5 pr-2">
                        <span className="font-medium">{item.materialName ?? '—'}</span>
                        {item.hasTempering && (
                          <span className="ml-1.5 text-[10px] text-[#6b6b66] bg-[#f0f0ec] px-1 rounded">закалка</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-center text-[#6b6b66]">{item.thickness ?? '—'} мм</td>
                      <td className="py-2.5 px-2 text-center font-mono text-[11px]">
                        {item.width ?? 0} × {item.height ?? 0}
                      </td>
                      <td className="py-2.5 px-2 text-center">{item.quantity ?? 0} шт</td>
                      <td className="py-2.5 px-2 text-center font-mono text-[11px]">
                        {fmtN(item.totalAreaNet ?? 0)}
                      </td>
                      <td className="py-2.5 pl-2 text-right font-mono font-semibold">
                        {fmt(baseTotal)}
                      </td>
                    </tr>
                    {/* Services sub-rows */}
                    {(item.services ?? []).map((svc, si) => (
                      <tr key={`svc-${idx}-${si}`} className="border-b border-[#f8f8f5]">
                        <td />
                        <td className="pb-1.5 pl-3 text-[11px] text-[#6b6b66]" colSpan={5}>
                          ↳ {svc.name}
                        </td>
                        <td className="pb-1.5 pl-2 text-right font-mono text-[11px] text-[#6b6b66]">
                          {fmt(svc.cost ?? 0)}
                        </td>
                      </tr>
                    ))}
                    {/* Comment */}
                    {item.comment && (
                      <tr key={`cmt-${idx}`} className="border-b border-[#f8f8f5]">
                        <td />
                        <td className="pb-2 pl-3 text-[10px] italic text-[#9b9b96]" colSpan={6}>
                          {item.comment}
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="px-10 pb-6">
          <div className="ml-auto w-64 space-y-1.5">
            {discount > 0 && (
              <div className="flex justify-between text-[12px] text-[#6b6b66]">
                <span>Итого без скидки</span>
                <span className="font-mono line-through">{fmt(totalBase)}</span>
              </div>
            )}
            {discount > 0 && (
              <div className="flex justify-between text-[12px] text-emerald-700">
                <span>Скидка {discount}%</span>
                <span className="font-mono">−{fmt(totalBase - totalFinal)}</span>
              </div>
            )}
            <div className="flex justify-between items-center border-t-2 border-[#1a1a18] pt-2 mt-1">
              <span className="text-[13px] font-bold">Итого к оплате</span>
              <span className="text-[15px] font-bold font-mono">{fmt(totalFinal)}</span>
            </div>
            <div className="flex justify-between text-[10px] text-[#9b9b96] pt-0.5">
              <span>В том числе НДС 22%</span>
              <span className="font-mono">{fmt(Math.round(totalFinal * 22 / 122))}</span>
            </div>
          </div>

          <div className="mt-5 flex gap-8 text-[11px] text-[#6b6b66] border-t border-[#f0f0ec] pt-4">
            <div>
              <span className="text-[10px] uppercase tracking-wide text-[#9b9b96] block mb-0.5">Площадь</span>
              <span className="font-mono">{fmtN(totalArea)} м²</span>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wide text-[#9b9b96] block mb-0.5">Вес</span>
              <span className="font-mono">{fmtN(totalWeight, 1)} кг</span>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wide text-[#9b9b96] block mb-0.5">Позиций</span>
              <span className="font-mono">{items.length}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {userNotes && (
          <div className="px-10 pb-6">
            <div className="bg-[#f8f8f5] rounded-lg px-4 py-3 text-[11px] text-[#6b6b66]">
              <span className="font-semibold text-[#1a1a18] block mb-1">Примечание</span>
              {userNotes}
            </div>
          </div>
        )}

        {/* Terms */}
        <div className="px-10 pb-6">
          <div className="text-[10px] text-[#9b9b96] space-y-1 border-t border-[#f0f0ec] pt-4">
            <p>Цены указаны с учётом НДС 22%. Данное предложение действительно в течение 7 дней.</p>
            <p>Стоимость доставки и монтажа уточняется отдельно. Оплата: 50% предоплата, 50% по факту готовности.</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-10 py-5 bg-[#f8f8f5] border-t border-[#e8e8e4] flex items-center justify-between">
          <div>
            <div className="text-[12px] font-semibold text-[#1a1a18]">MGlass</div>
            <div className="text-[10px] text-[#6b6b66] mt-0.5">Производство стеклянных конструкций</div>
          </div>
          <div className="text-right text-[10px] text-[#6b6b66] space-y-0.5">
            <div>mglass.ru</div>
            <div>+7 (495) 000-00-00</div>
            <div>info@mglass.ru</div>
          </div>
        </div>

      </div>
    </>
  )
}
