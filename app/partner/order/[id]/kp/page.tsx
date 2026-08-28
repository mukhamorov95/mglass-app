'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'

// Печатное КП для клиента. Данные — из /api/partner/order (строго свой заказ,
// только цена клиента, без cost/margin). Кнопка «Печать» → window.print()
// (можно «Сохранить как PDF» в диалоге печати).

type Item = { material: string; thickness: number; width: number; height: number; quantity: number; tempering: boolean; facet: boolean; triplex: boolean; price: number }
type Order = { id: number; number: string; clientName: string; created_at: string; total: number; items: Item[] }

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: 'long', year: 'numeric' })

export default function PartnerKPPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [o, setO] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/partner/order/${id}`).then(r => r.ok ? r.json() : Promise.reject())
      .then((d: Order) => setO(d)).catch(() => setO(null)).finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="min-h-screen bg-white flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка…</div>
  if (!o) return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6 text-center">
      <div>
        <p className="text-[14px] text-[#111110] font-medium">Заказ не найден</p>
        <Link href="/partner" className="text-[12px] text-blue-600 mt-2 inline-block">← Мои заказы</Link>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f0f0ec] print:bg-white">
      <style>{`@media print { .no-print { display: none !important; } @page { margin: 16mm; } }`}</style>

      <div className="no-print sticky top-0 bg-white border-b border-[#e4e4e0] px-4 py-2.5 flex items-center justify-between">
        <Link href={`/partner/order/${o.id}`} className="text-[12px] text-[#9a9a95] hover:text-[#111110]">‹ К заказу</Link>
        <button onClick={() => window.print()} className="text-[12px] px-4 py-1.5 rounded-lg bg-[#1d1d1f] text-white font-semibold hover:bg-black">Печать / Сохранить PDF</button>
      </div>

      <div className="max-w-[780px] mx-auto bg-white my-4 print:my-0 shadow-sm print:shadow-none p-8 print:p-0">
        {/* Шапка */}
        <div className="flex items-start justify-between border-b border-[#e4e4e0] pb-4">
          <div>
            <p className="text-[22px] font-bold tracking-tight text-[#111110]">M-Glass</p>
            <p className="text-[12px] text-[#6b6b66]">Производство изделий из стекла и зеркала</p>
          </div>
          <div className="text-right">
            <p className="text-[15px] font-bold text-[#111110]">Коммерческое предложение</p>
            <p className="text-[12px] text-[#6b6b66]">№ {o.number} · от {fmtDate(o.created_at)}</p>
          </div>
        </div>

        <p className="text-[13px] text-[#111110] mt-4"><span className="text-[#9a9a95]">Для:</span> {o.clientName}</p>

        {/* Позиции */}
        <table className="w-full mt-4 text-[12.5px] border-collapse">
          <thead>
            <tr className="border-b-2 border-[#111110]">
              <th className="text-left font-semibold py-2 w-8">№</th>
              <th className="text-left font-semibold py-2">Наименование</th>
              <th className="text-left font-semibold py-2">Размер, мм</th>
              <th className="text-right font-semibold py-2">Кол-во</th>
              <th className="text-right font-semibold py-2">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {o.items.map((it, i) => (
              <tr key={i} className="border-b border-[#e4e4e0]">
                <td className="py-2 text-[#9a9a95]">{i + 1}</td>
                <td className="py-2">{it.material} {it.thickness}мм{it.tempering ? ', закалка' : ''}{it.facet ? ', фацет' : ''}{it.triplex ? ', триплекс' : ''}</td>
                <td className="py-2 font-mono text-[#6b6b66]">{it.width}×{it.height}</td>
                <td className="py-2 text-right font-mono">{it.quantity}</td>
                <td className="py-2 text-right font-mono">{fmt(it.price)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="py-3 text-right font-bold text-[14px]">Итого, вкл. НДС:</td>
              <td className="py-3 text-right font-bold text-[15px] font-mono">{fmt(o.total)}</td>
            </tr>
          </tfoot>
        </table>

        <p className="text-[11px] text-[#9a9a95] mt-6 border-t border-[#e4e4e0] pt-3">
          Цены указаны с учётом вашей скидки и НДС. Предложение носит информационный характер.
          Для запуска в работу отправьте просчёт из личного кабинета или свяжитесь с вашим менеджером M-Glass.
        </p>
      </div>
    </div>
  )
}
