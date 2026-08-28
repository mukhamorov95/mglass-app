'use client'

import { useEffect, useState, useRef, use } from 'react'
import JsBarcode from 'jsbarcode'
import { createClient } from '@/lib/supabase-browser'
import { getApplicableStages, STAGE_LABELS, type DetailStageKey } from '@/lib/productionStages'
import { materialLabel } from '@/lib/materialLabel'
import { formatLabelCode } from '@/lib/production/labelCode'

// Печать наклеек на термопринтер: маршрутный лист заказа + наклейка на каждую
// деталь (штрихкод Code128, читается камерой и любым BT-сканером). Наклейки клеятся
// на бумажный чертёж; в печь не идут — на стекле остаётся маркер.
// При quantity>1 печатаем по наклейке на каждый физический лист, и номер листа идёт
// В ШТРИХКОД (П9): раньше человек видел на наклейке «3/5», а сканер у всех пяти читал
// один и тот же код. Формат и разбор — lib/production/labelCode.ts.

type OrderItem = {
  materialName?: string; category?: string; thickness?: number
  width?: number; height?: number; quantity?: number
  hasTempering?: boolean; hasFacet?: boolean; hasHoles?: boolean
  shape?: 'rect' | 'curved'; hasTriplex?: boolean; comment?: string
}
type Order = {
  id: number; custom_number: string | null; client_name: string
  client_order_number: string | null; items: OrderItem[]; deadline: string | null
}

function parseDeadline(notes: unknown): string | null {
  try {
    const n = typeof notes === 'string' ? JSON.parse(notes) : notes
    const d = (n as { deadline_date?: string } | null)?.deadline_date
    return d || null
  } catch { return null }
}

const PRINT_CSS = `
@media print {
  @page { size: 58mm auto; margin: 2mm; }
  body { background: #fff; }
  .no-print { display: none !important; }
  .label { page-break-after: always; box-shadow: none !important; border: none !important; width: 54mm !important; }
}
`

function Barcode({ value, height = 34 }: { value: string; height?: number }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (ref.current) {
      try { JsBarcode(ref.current, value, { format: 'CODE128', width: 1.4, height, displayValue: true, fontSize: 11, margin: 0, textMargin: 1 }) } catch { /* ignore */ }
    }
  }, [value, height])
  return <svg ref={ref} className="w-full" />
}

const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: '2-digit' }) : null

export default function LabelsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const sb = createClient()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    sb.from('b2b_orders').select('id,custom_number,client_name,client_order_number,items,notes').eq('id', Number(id)).single()
      .then(({ data, error }) => {
        if (error || !data) { setError('Заказ не найден'); setLoading(false); return }
        setOrder({
          id: data.id, custom_number: data.custom_number, client_name: data.client_name,
          client_order_number: data.client_order_number,
          items: Array.isArray(data.items) ? data.items as OrderItem[] : [],
          deadline: parseDeadline(data.notes),
        })
        setLoading(false)
      })
  }, [id, sb])

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка…</div>
  if (error || !order) return <div className="min-h-screen flex items-center justify-center text-[13px] text-red-600">{error}</div>

  const orderLabel = order.custom_number?.trim() || `00${order.id}`
  const deadline = fmtDate(order.deadline)
  const totalQty = order.items.reduce((s, i) => s + (i.quantity ?? 1), 0)

  // Разворачиваем позиции в физические листы (quantity копий), сохраняя item_index.
  const labels: { item: OrderItem; itemIndex: number; piece: number; qty: number }[] = []
  order.items.forEach((item, itemIndex) => {
    const qty = Math.max(1, item.quantity ?? 1)
    for (let p = 1; p <= qty; p++) labels.push({ item, itemIndex, piece: p, qty })
  })

  const routeOf = (item: OrderItem) => getApplicableStages(item).map(s => STAGE_LABELS[s.key as DetailStageKey]).join(' · ')

  return (
    <div className="min-h-screen bg-[#f5f5f3]">
      <style>{PRINT_CSS}</style>

      <div className="no-print sticky top-0 bg-white border-b border-[#e4e4e0] px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-[15px] font-bold text-[#111110]">Наклейки · {orderLabel}</p>
          <p className="text-[12px] text-[#9a9a95]">{order.client_name} · {order.items.length} поз. · {totalQty} шт. · маршрутный лист + {labels.length} наклеек</p>
        </div>
        <div className="flex items-center gap-2">
          <a href={`/production-app/orders/${order.id}`} className="text-[13px] text-[#6b6b66] px-3 py-2">← Заказ</a>
          <button onClick={() => window.print()} className="px-4 py-2 bg-[#111110] text-white text-[13px] font-semibold rounded-lg hover:bg-[#2a2a28]">🖨 Печать</button>
        </div>
      </div>

      <div className="p-4 flex flex-wrap gap-3">
        {/* Маршрутный лист заказа */}
        <div className="label bg-white border border-[#e4e4e0] rounded-lg p-3 w-[240px]">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95]">Маршрутный лист</p>
          <p className="text-[22px] font-extrabold text-[#111110] leading-tight">{orderLabel}</p>
          <p className="text-[12px] text-[#111110] font-medium">{order.client_name}</p>
          {order.client_order_number && <p className="text-[11px] text-[#6b6b66]">№ клиента: {order.client_order_number}</p>}
          <p className="text-[11px] text-[#6b6b66]">{order.items.length} поз. · {totalQty} шт.{deadline ? ` · срок ${deadline}` : ''}</p>
          <div className="mt-2"><Barcode value={formatLabelCode(order.id)} height={40} /></div>
          <p className="text-[9px] text-[#9a9a95] mt-1">Едет с тележкой. В печь не кладётся.</p>
        </div>

        {/* Наклейки деталей */}
        {labels.map(({ item, itemIndex, piece, qty }, i) => {
          const dims = item.width && item.height ? `${item.width}×${item.height}` : '—'
          const glass = materialLabel(item)
          const flags = [
            item.hasHoles !== false ? 'сверл.' : '',
            item.shape === 'curved' ? 'кривол.' : '',
            item.hasFacet ? 'фацет' : '',
            item.hasTriplex ? 'триплекс' : '',
            item.hasTempering ? 'закалка' : '',
          ].filter(Boolean).join(' · ')
          return (
            <div key={i} className="label bg-white border border-[#e4e4e0] rounded-lg p-3 w-[240px]">
              <div className="flex items-baseline justify-between">
                <p className="text-[18px] font-extrabold text-[#111110] leading-none">{orderLabel}</p>
                <p className="text-[12px] font-bold text-[#111110]">Поз.{itemIndex + 1}{qty > 1 ? ` · ${piece}/${qty}` : ''}</p>
              </div>
              <p className="text-[11px] text-[#6b6b66] truncate">{order.client_name}{deadline ? ` · ${deadline}` : ''}</p>
              <p className="text-[15px] font-bold text-[#111110] mt-1">{dims}<span className="text-[12px] font-normal text-[#6b6b66]"> мм</span></p>
              <p className="text-[11px] text-[#111110]">{glass || '—'}</p>
              {flags && <p className="text-[10px] text-[#6b6b66] mt-0.5">{flags}</p>}
              <p className="text-[9px] text-[#9a9a95] mt-1 leading-tight">Маршрут: {routeOf(item)}</p>
              {item.hasTempering && (
                <p className="text-[10px] font-bold text-[#111110] mt-1 leading-tight">⚠ Снять перед закалкой · вернуть после</p>
              )}
              <div className="mt-1.5"><Barcode value={formatLabelCode(order.id, itemIndex, qty > 1 ? piece : null)} /></div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
