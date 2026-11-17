'use client'

// «Срочно отгрузить» для Шовер Гласс (владелец 17.11.2026): только номера заказов — наш и их — и изделия, которые отгружаем.
// Без этапов цеха, веса и денег: документ уходит клиенту.

import { useEffect, useRef, useState } from 'react'
import SheetActions from '@/components/SheetActions'
import { loadJson } from '@/lib/toast'
import { urgentLinesOf, urgentQueue } from '@/lib/production/urgentShip'
import { fmtDay, type ShipmentsData } from '../../types'

export default function UrgentClientPage() {
  const [data, setData] = useState<ShipmentsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sheet = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadJson<ShipmentsData>('/api/production/client-shipments').then(r => {
      if (r.error !== null) setError(r.error)
      else setData(r.data)
    })
  }, [])

  if (error) return <p className="p-6 text-[13px] text-red-700">Не удалось загрузить: {error}. Обновите страницу.</p>
  if (!data) return <p className="p-6 text-[13px] text-[#9a9a95]">Загружаю…</p>

  const queue = urgentQueue(data.orders.filter(o => !o.hidden && o.urgent_rank !== null && o.stage !== 'shipped'))
  const rows = queue.map(o => ({ o, lines: urgentLinesOf(o.lines, o.urgent_lines) })).filter(r => r.lines.length > 0)
  const pieces = rows.reduce((n, r) => n + r.lines.reduce((m, x) => m + x.qty, 0), 0)

  return (
    <div className="min-h-screen bg-white p-4 sm:p-6 text-[#111110] print:p-0">
      <div className="max-w-[210mm] mx-auto space-y-4 print:max-w-none">
        <SheetActions sheet={sheet} fileName={`Срочная отгрузка ${data.title} ${fmtDay(data.today)}.pdf`} backHref="/production-app/shower-glass?tab=urgent" backLabel="К срочным" />
        <div className="overflow-x-auto print:overflow-visible">
          <div ref={sheet} className="w-[190mm] mx-auto bg-white space-y-4 print:w-auto">
            <div>
              <h1 className="text-[18px] font-semibold">Срочная отгрузка — {data.title}</h1>
              <p className="text-[13px] text-[#4b4b47]">от {fmtDay(data.today)} · заказов {rows.length} · изделий {pieces} шт.</p>
            </div>
            {rows.length === 0 && <p className="text-[13px] text-[#6b6b66]">Срочных заказов нет.</p>}
            {rows.length > 0 && (
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className="border-b-2 border-[#111110] text-left">
                    <th className="py-1.5 pr-2 whitespace-nowrap">№</th>
                    <th className="py-1.5 pr-2 whitespace-nowrap">Наш заказ</th>
                    <th className="py-1.5 pr-2 whitespace-nowrap">№ {data.title}</th>
                    <th className="py-1.5 pr-2">Изделие</th>
                    <th className="py-1.5 pr-2 whitespace-nowrap">Размер, мм</th>
                    <th className="py-1.5 text-right whitespace-nowrap">Шт.</th>
                  </tr>
                </thead>
                {rows.map(({ o, lines }, i) => (
                  <tbody key={o.id} className="border-t-2 border-[#111110]">
                    {lines.map(({ line: l, qty }, j) => (
                      <tr key={l.key} className="border-b border-[#e4e4e0] align-top">
                        <td className="py-1.5 pr-2 font-semibold">{j === 0 ? i + 1 : ''}</td>
                        <td className="py-1.5 pr-2 font-semibold whitespace-nowrap">{j === 0 ? o.no : ''}</td>
                        <td className="py-1.5 pr-2 font-semibold whitespace-nowrap">{j === 0 ? (o.client_no ?? <span className="font-normal text-[#9a9a95]">—</span>) : ''}</td>
                        <td className="py-1.5 pr-2">{l.label}</td>
                        <td className="py-1.5 pr-2 whitespace-nowrap">{l.size || '—'}</td>
                        <td className="py-1.5 text-right whitespace-nowrap">{qty}</td>
                      </tr>
                    ))}
                  </tbody>
                ))}
                <tbody>
                  <tr className="font-semibold border-t-2 border-[#111110]">
                    <td className="py-2 pr-2" colSpan={5}>Итого: заказов {rows.length}</td>
                    <td className="py-2 text-right whitespace-nowrap">{pieces}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
