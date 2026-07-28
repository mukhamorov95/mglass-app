'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import AssignInstallationButton from '@/components/AssignInstallationButton'

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
  custom_number: string | null
  client_order_number: string | null
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


// ─── Component ────────────────────────────────────────────────────────────────

export default function KPPrintPage() {
  const params = useParams()
  const id = Number(params.id)

  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [payTerms, setPayTerms] = useState<'50_50' | '100'>('50_50')
  // Как показывать цену клиенту: 'consolidated' — только итог одной суммой (по
  // умолчанию, чтобы не светить построчные цены услуг и не плодить вопросы);
  // 'detailed' — построчная разбивка (для B2B-листов, где так принято).
  const [priceMode, setPriceMode] = useState<'consolidated' | 'detailed'>('consolidated')
  const docRef = useRef<HTMLDivElement>(null)

  async function downloadPdf() {
    if (!docRef.current) return
    try {
      // html2canvas-pro: классический html2canvas не понимает oklch-цвета Tailwind v4.
      const [h2c, jspdf] = await Promise.all([import('html2canvas-pro'), import('jspdf')])
      const canvas = await h2c.default(docRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
      const pdf = new jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
      const pw = 210, ph = 297
      const imgH = pw * canvas.height / canvas.width
      const img = canvas.toDataURL('image/jpeg', 0.94)
      let pos = 0, left = imgH
      pdf.addImage(img, 'JPEG', 0, pos, pw, imgH)
      left -= ph
      while (left > 0) { pos -= ph; pdf.addPage(); pdf.addImage(img, 'JPEG', 0, pos, pw, imgH); left -= ph }
      pdf.save(`КП-${order?.custom_number?.trim() || String(order?.id ?? '').padStart(5, '0')}.pdf`)
    } catch (e) {
      alert('Не удалось сформировать PDF: ' + (e instanceof Error ? e.message : 'ошибка') + '. Используйте «Печать» → Сохранить как PDF.')
    }
  }

  // Условия оплаты в подписи КП: 50/50 или 100% предоплата. Хранится в notes просчёта.
  async function savePayTerms(v: '50_50' | '100') {
    setPayTerms(v)
    try {
      const n = parseNotes(order?.notes ?? null)
      const newNotes = JSON.stringify({ ...n, kp_payment_terms: v })
      await createClient().from('b2b_orders').update({ notes: newNotes }).eq('id', id)
      setOrder(o => o ? { ...o, notes: newNotes } : o)
    } catch { /* не блокируем просмотр */ }
  }

  async function savePriceMode(v: 'consolidated' | 'detailed') {
    setPriceMode(v)
    try {
      const n = parseNotes(order?.notes ?? null)
      const newNotes = JSON.stringify({ ...n, kp_price_mode: v })
      await createClient().from('b2b_orders').update({ notes: newNotes }).eq('id', id)
      setOrder(o => o ? { ...o, notes: newNotes } : o)
    } catch { /* не блокируем просмотр */ }
  }

  useEffect(() => {
    if (!id) return
    // Через серверный API с проверкой доступа (не прямой запрос к b2b_orders анон-ключом).
    fetch(`/api/quotes/${id}/kp-data`)
      .then(async r => {
        if (!r.ok) { setError(r.status === 403 ? 'Нет доступа к этому расчёту' : 'Расчёт не найден'); setLoading(false); return }
        const { order: data } = await r.json()
        if (!data) { setError('Расчёт не найден'); setLoading(false); return }
        const raw = data as Record<string, unknown>
        const items: OrderItem[] = Array.isArray(raw.items) ? (raw.items as OrderItem[]) : []
        setOrder({
          id: raw.id as number,
          client_id: raw.client_id as number | null,
          client_name: (raw.client_name as string) || 'Клиент',
          custom_number: (raw.custom_number as string) || null,
          client_order_number: (raw.client_order_number as string) || null,
          discount_percent: (raw.discount_percent as number) || 0,
          items,
          total_area: (raw.total_area as number) || 0,
          total_weight: (raw.total_weight as number) || 0,
          total_sale_inc_vat: (raw.total_sale_inc_vat as number) || 0,
          total_after_discount: (raw.total_after_discount as number) || 0,
          notes: (raw.notes as string) || null,
          created_at: raw.created_at as string,
        })
        const n0 = parseNotes((raw.notes as string) || null)
        setPayTerms(n0.kp_payment_terms === '100' ? '100' : '50_50')
        setPriceMode(n0.kp_price_mode === 'detailed' ? 'detailed' : 'consolidated')
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
  const quoteDate   = (notes.quote_date as string) || order.created_at
  const validUntil  = addDays(quoteDate, 14)
  const kpDisplay   = order.custom_number?.trim() || String(order.id).padStart(5, '0')
  const discount    = order.discount_percent || 0
  const totalFinal  = order.total_after_discount || order.total_sale_inc_vat
  const totalBase   = order.total_sale_inc_vat
  const totalArea   = order.total_area
  const totalWeight = order.total_weight

  const items = order.items
  const showPrices = priceMode === 'detailed'

  return (
    <>
      {/* Cyrillic font — must load before print */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=PT+Sans:ital,wght@0,400;0,700;1,400&display=swap&subset=cyrillic');
        #kp-document, #kp-document * {
          font-family: 'PT Sans', Arial, sans-serif !important;
        }
        @media print {
          body * { visibility: hidden !important; }
          #kp-document, #kp-document * { visibility: visible !important; }
          #kp-document { position: fixed; top: 0; left: 0; width: 100%; }
          #kp-print-btn { display: none !important; }
          @page { margin: 15mm; size: A4; }
        }
        body { background: #f5f5f0; }
      `}</style>

      {/* Toolbar — screen only */}
      <div id="kp-print-btn" className="fixed top-4 right-4 z-50 print:hidden flex gap-2">
        <select value={priceMode} onChange={e => savePriceMode(e.target.value as 'consolidated' | 'detailed')}
          className="bg-white text-[#1a1a18] border border-[#e0e0da] text-sm px-3 py-2 rounded-lg shadow-lg cursor-pointer">
          <option value="consolidated">Цена одной суммой</option>
          <option value="detailed">Цены по позициям</option>
        </select>
        <select value={payTerms} onChange={e => savePayTerms(e.target.value as '50_50' | '100')}
          className="bg-white text-[#1a1a18] border border-[#e0e0da] text-sm px-3 py-2 rounded-lg shadow-lg cursor-pointer">
          <option value="50_50">Оплата 50/50</option>
          <option value="100">Оплата 100%</option>
        </select>
        <button
          onClick={downloadPdf}
          className="bg-[#1a1a18] text-white text-sm px-4 py-2 rounded-lg shadow-lg hover:bg-[#2a2a26] transition-colors"
        >
          ⬇ Скачать PDF
        </button>
        <button
          onClick={() => document.fonts.ready.then(() => window.print())}
          className="bg-white text-[#1a1a18] border border-[#e0e0da] text-sm px-4 py-2 rounded-lg shadow-lg hover:bg-[#f5f5f0] transition-colors"
        >
          🖨 Печать
        </button>
        <AssignInstallationButton
          orderNo={kpDisplay}
          clientName={order.client_name}
          orderTotal={totalFinal}
          className="bg-white text-[#1a1a18] border border-[#e0e0da] text-sm px-4 py-2 rounded-lg shadow-lg hover:bg-[#f5f5f0] transition-colors"
        />
      </div>

      {/* KP Document */}
      <div ref={docRef} id="kp-document" className="max-w-[794px] mx-auto my-8 bg-white shadow-xl print:shadow-none print:my-0 text-[#1a1a18] overflow-hidden">

        {/* Accent bar */}
        <div className="h-1.5 bg-gradient-to-r from-[#1a1a18] via-[#1a1a18] to-emerald-500" />

        {/* Header */}
        <div className="px-10 pt-9 pb-6 border-b border-[#e8e8e4]">
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
              <div className="text-[10px] uppercase tracking-wide text-[#9b9b96] mb-0.5">КП №</div>
              <div className="text-[20px] font-bold text-[#1a1a18] font-mono">{kpDisplay}</div>
              {order.client_order_number && (
                <div className="text-[11px] text-[#6b6b66] font-mono mt-0.5">№ клиента: {order.client_order_number}</div>
              )}
              <div className="text-[11px] text-[#6b6b66] mt-1.5">от {fmtDate(quoteDate)}</div>
              <div className="text-[11px] text-[#6b6b66]">действует до {validUntil}</div>
            </div>
          </div>

          <div className="mt-5 flex items-end justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#9b9b96] mb-1">Коммерческое предложение для</div>
              <div className="text-[15px] font-semibold">{order.client_name}</div>
            </div>
            {discount > 0 && (
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wide text-[#9b9b96] mb-0.5">Персональная скидка</div>
                <div className="text-[15px] font-bold text-emerald-600">{discount}%</div>
              </div>
            )}
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
                {showPrices && (
                  <th className="text-right py-2 pl-2 font-semibold text-[10px] uppercase tracking-wide text-[#6b6b66] w-20">Стоимость</th>
                )}
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
                      {showPrices && (
                        <td className="py-2.5 pl-2 text-right font-mono font-semibold">
                          {fmt(baseTotal)}
                        </td>
                      )}
                    </tr>
                    {/* Services sub-rows */}
                    {(item.services ?? []).map((svc, si) => (
                      <tr key={`svc-${idx}-${si}`} className="border-b border-[#f8f8f5]">
                        <td />
                        <td className="pb-1.5 pl-3 text-[11px] text-[#6b6b66]" colSpan={5}>
                          ↳ {svc.name}
                        </td>
                        {showPrices && (
                          <td className="pb-1.5 pl-2 text-right font-mono text-[11px] text-[#6b6b66]">
                            {fmt(svc.cost ?? 0)}
                          </td>
                        )}
                      </tr>
                    ))}
                    {/* Comment */}
                    {item.comment && (
                      <tr key={`cmt-${idx}`} className="border-b border-[#f8f8f5]">
                        <td />
                        <td className="pb-2 pl-3 text-[10px] italic text-[#9b9b96]" colSpan={showPrices ? 6 : 5}>
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
            <div className="flex justify-between items-center bg-[#1a1a18] text-white rounded-lg px-3 py-2.5 mt-2">
              <span className="text-[12px] font-semibold uppercase tracking-wide">Итого к оплате</span>
              <span className="text-[17px] font-bold font-mono">{fmt(totalFinal)}</span>
            </div>
            <div className="flex justify-between text-[10px] text-[#9b9b96] pt-1 px-1">
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
            <p>Стоимость доставки и монтажа уточняется отдельно. {payTerms === '100' ? 'Оплата: 100% предоплата.' : 'Оплата: 50% предоплата, 50% по факту готовности.'}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-10 py-5 bg-[#f8f8f5] border-t border-[#e8e8e4] flex items-center justify-between">
          <div>
            <div className="text-[12px] font-semibold text-[#1a1a18]">MGlass · Производство и монтаж стеклянных конструкций</div>
            <div className="text-[10px] text-[#6b6b66] mt-0.5">Спасибо, что выбираете нас — сделаем качественно и в срок.</div>
          </div>
          <div className="text-right text-[10px] text-[#6b6b66] space-y-0.5">
            <div>mglass.pro</div>
            <div>+7 (925) 933 50 33</div>
            <div>mglass.ceo@gmail.com</div>
          </div>
        </div>

      </div>
    </>
  )
}
