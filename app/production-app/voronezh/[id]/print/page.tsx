'use client'

// Печатный лист рейса для водителя: по заказчикам — контакты, заказы с составом
// и весом, графа подписи получателя. Открывается из карточки рейса, печать A4.

import { useEffect, useState, use, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { itemsWeight, type WeighableItem } from '@/lib/deliveryWeight'
import { renderDocCanvas } from '@/lib/pdfCapture'

type OrderItem = WeighableItem & { width?: number; height?: number; materialName?: string; category?: string }
type Order = {
  id: number
  custom_number: string | null
  client_id: number | null
  client_name: string | null
  items: OrderItem[] | null
}
type ClientInfo = { id: number; name: string; contact: string | null; phone: string | null; legal_address: string | null }
type Shipment = { id: number; title: string | null; ship_date: string | null; status: string; shipped_at: string | null }

const KG = (n: number) => (Math.round(n * 10) / 10).toLocaleString('ru-RU')
const orderNo = (o: { custom_number: string | null; id: number }) => o.custom_number?.trim() || `00${o.id}`

function itemLine(it: OrderItem): string {
  const size = it.width && it.height ? `${it.width}×${it.height}` : ''
  const mat = it.materialName ?? it.category ?? ''
  const t = it.thickness ? `${it.thickness} мм` : ''
  return [`${it.quantity ?? 1} шт`, size, mat, t].filter(Boolean).join(' · ')
}

const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 12mm; }
  html, body { background: #fff !important; }
  .no-print { display: none !important; }
  /* Лист — во всю печатную область A4. Жёсткие 210мм + поля страницы обрезали левый край. */
  .print-root { padding: 0 !important; background: #fff !important; }
  .sheet { box-shadow: none !important; border: none !important; border-radius: 0 !important;
           padding: 0 !important; margin: 0 !important; max-width: none !important; width: auto !important; }
  /* Заказ переносится ЦЕЛИКОМ: строка никогда не рвётся между страницами */
  tr { break-inside: avoid; page-break-inside: avoid; }
  /* Шапка таблицы повторяется на каждой странице */
  thead { display: table-header-group; }
  /* Заказчик может переноситься между заказами, но его заголовок не остаётся один внизу */
  .client-block { break-inside: auto; }
  .client-head { break-after: avoid; page-break-after: avoid; }
  .signatures { break-inside: avoid; page-break-inside: avoid; }
}
`

export default function TripPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [ship, setShip] = useState<Shipment | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [clients, setClients] = useState<Map<number, ClientInfo>>(new Map())
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pdfBusy, setPdfBusy] = useState(false)
  const docRef = useRef<HTMLDivElement>(null)

  // Скачивание PDF прямо на компьютер — тот же паттерн, что у КП/договора
  // (html2canvas-pro + jsPDF: рендерим готовый лист в картинку → PDF, кириллица ок).
  async function downloadPdf() {
    if (!docRef.current) return
    setPdfBusy(true)
    try {
      const el = docRef.current
      const jspdf = await import('jspdf')
      const scale = 2
      // Фиксированная десктопная ширина листа + windowWidth → PDF одинаков с телефона и ПК.
      const canvas = await renderDocCanvas(el, { scale })
      const pdf = new jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
      const margin = 10
      const pwMm = 210 - margin * 2
      const phMm = 297 - margin * 2
      const pxPerMm = canvas.width / pwMm
      const pageHpx = phMm * pxPerMm

      // Резать можно только по низу неразрывного блока — тогда заказ не разорвётся
      const top = el.getBoundingClientRect().top
      const stops = [...el.querySelectorAll('tr, .client-head, .signatures')]
        .map(b => (b.getBoundingClientRect().bottom - top) * scale)
        .filter(y => y > 0)
        .sort((a, b) => a - b)

      let y = 0, first = true
      while (y < canvas.height - 1) {
        const limit = y + pageHpx
        let cut = stops.filter(s => s > y + 1 && s <= limit).pop() ?? 0
        if (!cut) cut = limit                    // блок выше страницы — режем по границе
        cut = Math.min(cut, canvas.height)
        const h = Math.ceil(cut - y)
        const part = document.createElement('canvas')
        part.width = canvas.width
        part.height = h
        part.getContext('2d')?.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h)
        if (!first) pdf.addPage()
        pdf.addImage(part.toDataURL('image/jpeg', 0.94), 'JPEG', margin, margin, pwMm, h / pxPerMm)
        first = false
        y = cut
      }
      pdf.save(`Рейс-Воронеж-${ship?.ship_date ?? ship?.id ?? ''}.pdf`)
    } catch (e) {
      alert('Не удалось сформировать PDF: ' + (e instanceof Error ? e.message : 'ошибка') + '. Используйте «Печать» → Сохранить как PDF.')
    } finally { setPdfBusy(false) }
  }

  async function load() {
    const sb = createClient()
    const { data: s, error: sErr } = await sb.from('delivery_shipments').select('*').eq('id', Number(id)).single()
    if (sErr || !s) { setErr(sErr?.message ?? 'Рейс не найден'); setLoading(false); return }
    const { data: links } = await sb.from('delivery_shipment_orders').select('order_id').eq('shipment_id', s.id)
    const ids = (links ?? []).map(l => l.order_id)
    let os: Order[] = []
    if (ids.length > 0) {
      const { data } = await sb.from('b2b_orders')
        .select('id, custom_number, client_id, client_name, items')
        .in('id', ids)
      os = (data ?? []) as Order[]
    }
    const clientIds = [...new Set(os.map(o => o.client_id).filter((v): v is number => v != null))]
    const cm = new Map<number, ClientInfo>()
    if (clientIds.length > 0) {
      const { data } = await sb.from('b2b_clients').select('id, name, contact, phone, legal_address').in('id', clientIds)
      for (const c of (data ?? []) as ClientInfo[]) cm.set(c.id, c)
    }
    setShip(s as Shipment)
    setOrders(os)
    setClients(cm)
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Авто-скачивание, если открыто из карточки рейса с ?download=1 (клик → файл).
  useEffect(() => {
    if (loading || !ship) return
    if (new URLSearchParams(window.location.search).get('download') !== '1') return
    const t = setTimeout(() => { void downloadPdf() }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, ship])

  if (loading) return <div className="p-8 text-[#9a9a95]">Загрузка…</div>
  if (err || !ship) return <div className="p-8 text-red-600">{err ?? 'Рейс не найден'}</div>

  const totalWeight = orders.reduce((s, o) => s + itemsWeight(o.items), 0)
  const piecesOf = (items: OrderItem[] | null) => (items ?? []).reduce((s, it) => s + Math.max(1, Number(it.quantity ?? 1)), 0)
  const totalPieces = orders.reduce((s, o) => s + piecesOf(o.items), 0)
  const byClient = new Map<number | string, Order[]>()
  for (const o of orders) {
    const key = o.client_id ?? (o.client_name ?? '—')
    byClient.set(key, [...(byClient.get(key) ?? []), o])
  }

  return (
    <div className="print-root min-h-screen bg-[#f5f5f3] py-3 sm:py-6 overflow-x-auto">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      {/* Тулбар — вне листа, подстраивается под ширину экрана телефона. */}
      <div className="no-print max-w-[210mm] mx-auto mb-3 px-3 flex flex-wrap justify-end gap-2">
        <button onClick={downloadPdf} disabled={pdfBusy} className="px-4 py-2 rounded-md bg-emerald-600 text-white text-[13px] disabled:opacity-50">{pdfBusy ? 'Готовлю PDF…' : '⬇ Скачать PDF'}</button>
        <button onClick={() => window.print()} className="px-4 py-2 rounded-md bg-[#111110] text-white text-[13px]">🖨 Печать</button>
      </div>
      {/* Лист — ФИКСИРОВАННАЯ ширина A4 (не зависит от вьюпорта): выглядит одинаково
          на телефоне и компьютере, и точно так же уходит в PDF. На узком экране
          прокручивается вбок — это WYSIWYG с итоговым файлом. */}
      <div className="sheet w-[210mm] mx-auto bg-white border border-[#e4e4e0] rounded-lg p-8">
        <div ref={docRef} className="bg-white">
        <div className="flex flex-row items-start justify-between gap-2 border-b-2 border-[#111110] pb-3">
          <div>
            <div className="text-[20px] font-semibold text-[#111110]">Лист рейса — {ship.title ?? `№${ship.id}`}</div>
            <div className="text-[13px] text-[#4b4b47] mt-1">
              {ship.ship_date && <>Дата отправки: {new Date(ship.ship_date).toLocaleDateString('ru-RU')} · </>}
              M-Glass, Мытищи → Воронеж
            </div>
          </div>
          <div className="text-right text-[13px] text-[#111110] shrink-0">
            <div className="font-mono font-semibold text-[16px]">{orders.length} зак. · {totalPieces} изд. · {KG(totalWeight)} кг</div>
            <div className="text-[#9a9a95]">{byClient.size} заказчик(ов)</div>
          </div>
        </div>

        {[...byClient.entries()].map(([key, os]) => {
          const info = typeof key === 'number' ? clients.get(key) : null
          const name = info?.name ?? os[0]?.client_name ?? '—'
          const w = os.reduce((s, o) => s + itemsWeight(o.items), 0)
          return (
            <div key={String(key)} className="client-block mt-6">
              <div className="client-head flex flex-row items-baseline justify-between gap-2 bg-[#f5f5f3] border border-[#e4e4e0] rounded-md px-3 py-2">
                <div>
                  <span className="font-semibold text-[15px] text-[#111110]">{name}</span>
                  {(info?.contact || info?.phone) && (
                    <span className="inline ml-3 text-[13px] text-[#4b4b47]">{[info?.contact, info?.phone].filter(Boolean).join(' · ')}</span>
                  )}
                </div>
                <span className="font-mono text-[13px] text-[#111110] shrink-0">{os.length} зак. · {os.reduce((sp, o) => sp + piecesOf(o.items), 0)} изд. · {KG(w)} кг</span>
              </div>
              {info?.legal_address && <div className="text-[12px] text-[#9a9a95] px-3 mt-1">{info.legal_address}</div>}
              <div className="mt-2">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-[#9a9a95] border-b border-[#e4e4e0]">
                    <th className="py-1.5 pr-2 w-24">Заказ</th>
                    <th className="py-1.5 pr-2">Состав</th>
                    <th className="py-1.5 pr-2 w-20 text-right">Вес, кг</th>
                    <th className="py-1.5 pl-4 w-44">Принял (подпись)</th>
                  </tr>
                </thead>
                <tbody>
                  {os.map(o => (
                    <tr key={o.id} className="border-b border-[#f0f0ee] align-top">
                      <td className="py-2 pr-2 font-mono font-medium text-[#111110]">{orderNo(o)}</td>
                      <td className="py-2 pr-2 text-[#4b4b47]">
                        {(Array.isArray(o.items) ? o.items : []).map((it, i) => (
                          <div key={i}>{itemLine(it)}</div>
                        ))}
                      </td>
                      <td className="py-2 pr-2 text-right font-mono">{KG(itemsWeight(o.items))}</td>
                      <td className="py-2 pl-4"><div className="border-b border-[#9a9a95] h-6" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )
        })}

        <div className="signatures mt-10 grid grid-cols-2 gap-8 text-[13px] text-[#4b4b47]">
          <div>
            <div>Водитель: ____________________________</div>
            <div className="mt-6">Подпись: _____________________________</div>
          </div>
          <div>
            <div>Отгрузку проверил: ___________________</div>
            <div className="mt-6">Дата: ________________________________</div>
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}
