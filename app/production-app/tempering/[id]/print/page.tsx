'use client'

// Лист на закалку: что уехало, с габаритами, толщиной и материалом; внизу итог по материалам — основа ведомости.
// Денег на листе нет: он уходит из цеха на закалочную.

import { use, useEffect, useState } from 'react'
import { loadJson } from '@/lib/toast'
import { batchTotals, materialSummary } from '@/lib/production/tempering'
import { fmtDay, fmtKg, fmtM2, sizeOf, thickOf, type TemperingData } from '../../types'

export default function TemperingPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<TemperingData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadJson<TemperingData>('/api/production/tempering').then(r => {
      if (r.error !== null) setError(r.error)
      else setData(r.data)
    })
  }, [])

  if (error) return <p className="p-6 text-[13px] text-red-700">Не удалось загрузить: {error}. Обновите страницу.</p>
  if (!data) return <p className="p-6 text-[13px] text-[#9a9a95]">Загружаю…</p>
  const b = data.batches.find(x => x.id === Number(id))
  if (!b) return <p className="p-6 text-[13px] text-[#6b6b66]">Такого листа нет.</p>
  const t = batchTotals(b.lines)

  return (
    <div className="min-h-screen bg-white p-6 text-[#111110] print:p-0">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <button onClick={() => window.print()} className="h-10 px-4 rounded-lg bg-[#111110] text-white text-[13px] font-medium">Печать</button>
          <a href={`/production-app/tempering?tab=${b.status === 'draft' ? 'drafts' : 'away'}`} className="h-10 px-3 inline-flex items-center rounded-lg border border-[#e4e4e0] text-[13px] text-[#4b4b47]">К закалке</a>
        </div>
        <div>
          <h1 className="text-[18px] font-semibold">Лист на закалку от {fmtDay(b.batch_date)}</h1>
          {b.status === 'draft' && <p className="text-[13px] text-[#4b4b47]">Черновик, ещё не отправлен</p>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="border-b-2 border-[#111110] text-left">
                <th className="py-1.5 pr-2">Заказ</th><th className="py-1.5 pr-2">Материал</th><th className="py-1.5 pr-2 whitespace-nowrap">Толщина</th>
                <th className="py-1.5 pr-2">Габариты, мм</th><th className="py-1.5 pr-2 text-right">Шт.</th><th className="py-1.5 text-right">м²</th>
              </tr>
            </thead>
            <tbody>
              {b.lines.map(l => (
                <tr key={l.id} className="border-b border-[#e4e4e0] align-top">
                  <td className="py-1.5 pr-2 font-medium whitespace-nowrap">{l.order_no}</td>
                  <td className="py-1.5 pr-2">{l.material}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{thickOf(l.thickness)}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{sizeOf(l)}</td>
                  <td className="py-1.5 pr-2 text-right">{l.qty}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">{l.area_m2.toLocaleString('ru-RU')}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-2 pr-2" colSpan={4}>Итого: заказов {t.orders}, вес {fmtKg(t.weight)}</td>
                <td className="py-2 pr-2 text-right">{t.pieces}</td>
                <td className="py-2 text-right whitespace-nowrap">{t.area.toLocaleString('ru-RU')}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="text-[12px] space-y-1">
          <p className="font-semibold">По материалам</p>
          {materialSummary(b.lines).map(m => (
            <p key={`${m.material}-${m.thickness}`}>{m.material}, {thickOf(m.thickness)}: {m.pieces} шт., {fmtM2(m.area)}</p>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-8 pt-10 text-[12px]">
          <p className="border-t border-[#111110] pt-1">Отгрузил</p>
          <p className="border-t border-[#111110] pt-1">Принял</p>
        </div>
      </div>
    </div>
  )
}
