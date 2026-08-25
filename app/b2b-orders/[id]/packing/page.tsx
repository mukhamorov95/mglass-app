'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'

// А16: упаковочный лист. Печатается на отгрузке — что едет, кому, куда и сколько мест.
// Цены здесь не нужны: лист видят грузчики и водитель, деньги в счёте.

type Item = {
  materialName?: string; thickness?: number; width?: number; height?: number
  quantity?: number; totalWeight?: number; hasTempering?: boolean; comment?: string
}
type Order = {
  id: number; custom_number: string | null; client_order_number: string | null
  client_name: string; items: Item[]; total_weight: number; total_area: number
  notes: string | null; created_at: string
}

const parseNotes = (n: string | null): Record<string, unknown> => {
  if (!n) return {}
  try { const p = JSON.parse(n); return p && typeof p === 'object' ? p as Record<string, unknown> : {} } catch { return {} }
}

export default function PackingListPage() {
  const params = useParams()
  const id = Number(params.id)
  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    (async () => {
      const sb = createClient()
      const { data, error: err } = await sb.from('b2b_orders')
        .select('id,custom_number,client_order_number,client_name,items,total_weight,total_area,notes,created_at')
        .eq('id', id).maybeSingle()
      if (err || !data) { setError('Заказ не найден'); return }
      setOrder(data as Order)
    })()
  }, [id])

  if (error) return <div className="p-8 text-[13px] text-red-600">{error}</div>
  if (!order) return <div className="p-8 text-[13px] text-[#6b6b66]">Загрузка…</div>

  const n = parseNotes(order.notes)
  const delivery = (n.delivery ?? {}) as { method?: string; address?: string | null; comment?: string | null; date?: string }
  const number = order.custom_number?.trim() || String(order.id).padStart(5, '0')
  const totalPcs = order.items.reduce((s, i) => s + (Number(i.quantity) || 0), 0)

  return (
    <>
      <style>{'@media print{.no-print{display:none}} body{background:#fff}'}</style>
      <div className="no-print max-w-[760px] mx-auto px-4 pt-4 flex items-center gap-2">
        <Link href="/b2b-orders" className="text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:text-[#111110]">‹ К заказам</Link>
        <button onClick={() => window.print()}
          className="ml-auto text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28]">🖨 Печать</button>
      </div>

      <div className="max-w-[760px] mx-auto p-8 text-[#111110]">
        <div className="flex items-start justify-between gap-4 border-b border-[#e4e4e0] pb-3">
          <div>
            <h1 className="text-[20px] font-bold">Упаковочный лист № {number}</h1>
            <p className="text-[13px] text-[#6b6b66] mt-0.5">{order.client_name}</p>
            {order.client_order_number && <p className="text-[12px] text-[#9a9a95]">заказ клиента: {order.client_order_number}</p>}
          </div>
          <div className="text-right text-[12px] text-[#6b6b66]">
            <p>M-GLASS</p>
            <p>{new Date().toLocaleDateString('ru-RU')}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 py-3 text-[12px] border-b border-[#e4e4e0]">
          <div>
            <p className="text-[#9a9a95]">Способ получения</p>
            <p className="font-semibold">
              {delivery.method === 'delivery' ? 'Доставка' : delivery.method === 'pickup' ? 'Самовывоз' : 'не указан'}
            </p>
            {delivery.address && <p className="text-[#4b4b47] mt-0.5">{delivery.address}</p>}
            {delivery.comment && <p className="text-[#9a9a95] mt-0.5">{delivery.comment}</p>}
          </div>
          <div className="text-right">
            <p className="text-[#9a9a95]">Дата отгрузки</p>
            <p className="font-semibold">{delivery.date ? new Date(delivery.date).toLocaleDateString('ru-RU') : '—'}</p>
            <p className="text-[#9a9a95] mt-1.5">Позиций / штук / вес</p>
            <p className="font-semibold">
              {order.items.length} / {totalPcs} / {(order.total_weight ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} кг
            </p>
          </div>
        </div>

        <table className="w-full text-[12px] mt-3">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-[#9a9a95] border-b border-[#e4e4e0]">
              <th className="py-1.5 w-8">№</th>
              <th className="py-1.5">Изделие</th>
              <th className="py-1.5 text-right w-24">Размер, мм</th>
              <th className="py-1.5 text-right w-14">Кол.</th>
              <th className="py-1.5 text-right w-20">Вес, кг</th>
              <th className="py-1.5 text-center w-16">Принял</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((it, i) => (
              <tr key={i} className="border-b border-[#f0f0ec] align-top">
                <td className="py-1.5 text-[#9a9a95]">{i + 1}</td>
                <td className="py-1.5">
                  {it.materialName ?? 'Стекло'}{it.thickness ? `, ${it.thickness} мм` : ''}{it.hasTempering ? ', закалённое' : ''}
                  {it.comment && <span className="block text-[10px] text-[#9a9a95] italic">{it.comment}</span>}
                </td>
                <td className="py-1.5 text-right font-mono">{it.width ?? '—'}×{it.height ?? '—'}</td>
                <td className="py-1.5 text-right font-mono">{it.quantity ?? ''}</td>
                <td className="py-1.5 text-right font-mono text-[#6b6b66]">{Number(it.totalWeight ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}</td>
                <td className="py-1.5 text-center text-[#c4c4be]">☐</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="grid grid-cols-2 gap-8 mt-10 text-[12px]">
          <div>
            <p className="border-b border-[#111110] h-8" />
            <p className="text-[#9a9a95] mt-1">Отпустил (M-Glass), подпись</p>
          </div>
          <div>
            <p className="border-b border-[#111110] h-8" />
            <p className="text-[#9a9a95] mt-1">Принял (клиент), подпись</p>
          </div>
        </div>
        <p className="text-[10px] text-[#9a9a95] mt-6">
          Претензии по бою и комплектности принимаются в момент передачи. Стекло — хрупкий груз.
        </p>
      </div>
    </>
  )
}
