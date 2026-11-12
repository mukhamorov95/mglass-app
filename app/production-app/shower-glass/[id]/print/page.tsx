'use client'

// Лист отгрузки Шовер Гласс: что уехало, по заказам, с весом и графами подписи.

import { use, useEffect, useRef, useState } from 'react'
import SheetActions from '@/components/SheetActions'
import { loadJson } from '@/lib/toast'
import { orderInShipment, orderInShipmentText, shipmentTotals } from '@/lib/production/clientShipments'
import { fmtDay, fmtKg, fmtRub, type ShipmentsData } from '../../types'

export default function ShipmentPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
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
  const s = data.shipments.find(x => x.id === Number(id))
  if (!s) return <p className="p-6 text-[13px] text-[#6b6b66]">Такой отгрузки нет.</p>

  const t = shipmentTotals(s.lines)
  const money = data.canMoney
  const orderIds = [...new Set(s.lines.map(l => l.order_id))]
  return (
    <div className="min-h-screen bg-white p-4 sm:p-6 text-[#111110] print:p-0">
      <div className="max-w-[210mm] mx-auto space-y-4 print:max-w-none">
        <SheetActions sheet={sheet} fileName={`Лист отгрузки ${data.title} ${fmtDay(s.ship_date)}, №${s.id}.pdf`} backHref="/production-app/shower-glass?tab=shipments" backLabel="К отгрузкам" />
        {/* Ширина листа не зависит от экрана: с телефона файл выходит таким же, как с компьютера. */}
        <div className="overflow-x-auto print:overflow-visible">
        <div ref={sheet} className="w-[190mm] mx-auto bg-white space-y-4 print:w-auto">
        <div>
          <h1 className="text-[18px] font-semibold">Лист отгрузки от {fmtDay(s.ship_date)}</h1>
          <p className="text-[13px] text-[#4b4b47]">Получатель: {data.title}{s.status === 'draft' ? ' · черновик, ещё не отправлена' : ''}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="border-b-2 border-[#111110] text-left">
                <th className="py-1.5 pr-2">Заказ</th><th className="py-1.5 pr-2 whitespace-nowrap">№ Шовер Гласс</th><th className="py-1.5 pr-2">Изделие</th>
                <th className="py-1.5 pr-2 text-right whitespace-nowrap">Шт.</th><th className="py-1.5 pr-2 text-right">Вес</th>
                {money && <th className="py-1.5 text-right">Сумма</th>}
              </tr>
            </thead>
            <tbody>
              {s.lines.map(l => (
                <tr key={`${l.order_id}-${l.key}`} className="border-b border-[#e4e4e0] align-top">
                  <td className="py-1.5 pr-2 font-medium whitespace-nowrap">{l.order_no}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{l.client_no ?? <span className="text-[#9a9a95]">—</span>}</td>
                  <td className="py-1.5 pr-2">{l.label}{l.size ? `, ${l.size} мм` : ''}{l.own_cost && <span className="text-[#6b6b66]"> (переделка за счёт M GLASS)</span>}</td>
                  <td className="py-1.5 pr-2 text-right whitespace-nowrap">{l.qty} из {l.lineQty}</td>
                  <td className="py-1.5 pr-2 text-right whitespace-nowrap">{fmtKg(l.weight)}</td>
                  {money && <td className="py-1.5 text-right whitespace-nowrap">{l.own_cost ? <span className="text-[#9a9a95]">({fmtRub(l.amount)})</span> : fmtRub(l.amount)}</td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-2 pr-2" colSpan={3}>Итого: заказов {t.orders}</td>
                <td className="py-2 pr-2 text-right whitespace-nowrap">{t.pieces}</td>
                <td className="py-2 pr-2 text-right whitespace-nowrap">{fmtKg(t.weight)}</td>
                {money && <td className="py-2 text-right whitespace-nowrap">{fmtRub(t.amount)}</td>}
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="text-[12px] space-y-1">
          <p className="font-semibold">По заказам</p>
          {orderIds.map(id => {
            const order = data.orders.find(o => o.id === id)
            const here = s.lines.filter(l => l.order_id === id)
            const v = order ? orderInShipment(order.lines, key => here.filter(l => l.key === key).reduce((n, l) => n + l.qty, 0), s.status === 'shipped') : null
            const text = v ? orderInShipmentText(v, s.status === 'shipped', !!order?.rest_off) : null
            const parts = text ? [text.here, text.earlier, text.after].filter(Boolean).map(x => String(x).charAt(0).toLowerCase() + String(x).slice(1)) : []
            return (
              <p key={id} className="pdf-keep">
                <span className="font-medium">{here[0].order_no}</span>{here[0].client_no ? ` (№ Шовер Гласс ${here[0].client_no})` : ''}
                {parts.length ? `: ${parts.join(', ')}` : ''}
              </p>
            )
          })}
        </div>
        <div className="pdf-keep grid grid-cols-2 gap-8 pt-10 text-[12px]">
          <p className="border-t border-[#111110] pt-1">Отгрузил</p>
          <p className="border-t border-[#111110] pt-1">Принял</p>
        </div>
        </div>
        </div>
      </div>
    </div>
  )
}
