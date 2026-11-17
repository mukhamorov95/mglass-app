'use client'

// Ведомость «Срочно отгрузить» для цеха: заказы в порядке срочности, по каждому изделию — что ещё не сделано.
// Денег на листе нет: он уходит в цех.

import { useEffect, useRef, useState } from 'react'
import SheetActions from '@/components/SheetActions'
import { loadJson } from '@/lib/toast'
import { daysWord } from '@/lib/b2b/inWorkOrders'
import { urgentLinesOf, urgentQueue } from '@/lib/production/urgentShip'
import { fmtDay, fmtKg, type ShipmentsData } from '../../types'

export default function UrgentPrintPage() {
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
  const weight = rows.reduce((n, r) => n + r.lines.reduce((m, x) => m + x.line.weight * x.qty / x.line.qty, 0), 0)

  return (
    <div className="min-h-screen bg-white p-4 sm:p-6 text-[#111110] print:p-0">
      <div className="max-w-[210mm] mx-auto space-y-4 print:max-w-none">
        <SheetActions sheet={sheet} fileName={`Срочно отгрузить ${data.title} ${fmtDay(data.today)}.pdf`} backHref="/production-app/shower-glass?tab=urgent" backLabel="К срочным" />
        <div className="overflow-x-auto print:overflow-visible">
          <div ref={sheet} className="w-[190mm] mx-auto bg-white space-y-4 print:w-auto">
            <div>
              <h1 className="text-[18px] font-semibold">Срочно отгрузить — {data.title}</h1>
              <p className="text-[13px] text-[#4b4b47]">Ведомость от {fmtDay(data.today)} · заказов {rows.length} · изделий {pieces} шт. · {fmtKg(weight)} · сверху самое срочное</p>
            </div>
            {rows.length === 0 && <p className="text-[13px] text-[#6b6b66]">Срочных заказов нет.</p>}
            {rows.length > 0 && (
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className="border-b-2 border-[#111110] text-left">
                    <th className="py-1.5 pr-2">Изделие</th>
                    <th className="py-1.5 pr-2 whitespace-nowrap">Размер, мм</th>
                    <th className="py-1.5 pr-2 text-right whitespace-nowrap">Шт.</th>
                    <th className="py-1.5 pr-2">Не сделано</th>
                    <th className="py-1.5 text-center whitespace-nowrap">Готово</th>
                  </tr>
                </thead>
                {rows.map(({ o, lines }, i) => (
                  <tbody key={o.id}>
                    <tr className="bg-[#f0f0ec] border-t-2 border-[#111110]">
                      <td colSpan={5} className="py-1.5 px-1.5">
                        <span className="text-[14px] font-bold">{i + 1}. Заказ {o.no}</span>
                        {o.client_no && <span className="font-semibold"> · № Шовер Гласс {o.client_no}</span>}
                        <span className="text-[#4b4b47]"> · запуск {fmtDay(o.launch_day)}{o.deadline_day ? ` · срок ${fmtDay(o.deadline_day)}` : ''}</span>
                        {o.overdue_days > 0 && <span className="font-semibold text-red-700"> · просрочен на {o.overdue_days} {daysWord(o.overdue_days)}</span>}
                        <span className="text-[#4b4b47]"> · упаковано позиций {o.packed_lines} из {o.lines.length}</span>
                      </td>
                    </tr>
                    {lines.map(({ line: l, qty }) => (
                      <tr key={l.key} className="border-b border-[#e4e4e0] align-top">
                        <td className="py-1.5 pr-2 pl-1.5">{l.label}</td>
                        <td className="py-1.5 pr-2 whitespace-nowrap">{l.size || '—'}</td>
                        <td className="py-1.5 pr-2 text-right whitespace-nowrap">{qty < l.qty ? `${qty} из ${l.qty}` : l.qty}</td>
                        <td className="py-1.5 pr-2">
                          {l.left == null ? (l.packed ? 'Упаковано' : <span className="text-[#6b6b66]">цех не отмечал</span>)
                            : l.left.length ? <span className="font-semibold">{l.left.join(' → ')}</span> : 'Всё сделано, к отгрузке'}
                        </td>
                        <td className="py-1.5 text-center"><span className="inline-block w-4 h-4 border border-[#111110]" /></td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            )}
            <div className="pdf-keep grid grid-cols-2 gap-8 pt-10 text-[12px]">
              <p className="border-t border-[#111110] pt-1">Выдал</p>
              <p className="border-t border-[#111110] pt-1">Принял в работу</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
