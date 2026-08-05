'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'

type Item = { material: string; thickness: number; width: number; height: number; quantity: number; tempering: boolean; facet: boolean; triplex: boolean; price: number }
type TL = { label: string; state: 'done' | 'now' | 'wait'; date: string | null }
type Order = {
  id: number; number: string; clientOrderNumber: string | null; created_at: string
  lane: string; ready: boolean; progressPct: number; deadline: string | null
  total: number; items: Item[]; timeline: TL[]; drawingUrl: string | null; recalcNote: string | null
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'

const LANE_LABEL: Record<string, string> = { quote: 'Просчёт', submitted: 'Отправлен в работу', in_work: 'В работе', shipped: 'Отгружен' }

export default function PartnerOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [o, setO] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    fetch(`/api/partner/order/${id}`).then(r => r.ok ? r.json() : Promise.reject())
      .then((d: Order) => setO(d)).catch(() => setNotFound(true)).finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка…</div>
  if (notFound || !o) return (
    <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center p-6">
      <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center max-w-sm">
        <p className="text-[14px] text-[#111110] font-medium">Заказ не найден</p>
        <Link href="/partner" className="text-[12px] text-blue-600 mt-3 inline-block">← Мои заказы</Link>
      </div>
    </div>
  )

  const statusColor = o.ready ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : o.lane === 'shipped' ? 'bg-[#f0f0ec] text-[#6b6b66] border-[#e4e4e0]'
    : o.lane === 'in_work' ? 'bg-blue-50 text-blue-700 border-blue-200'
    : 'bg-[#f5f5f3] text-[#6b6b66] border-[#e4e4e0]'
  const statusText = o.ready ? 'Готов к выдаче' : LANE_LABEL[o.lane] ?? 'В работе'

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-3 lg:pt-6">
        <Link href="/partner" className="text-[12px] text-[#9a9a95] hover:text-[#111110]">‹ Все заказы</Link>
        <div className="flex items-start justify-between gap-3 mt-1.5">
          <div className="min-w-0">
            <h1 className="text-[19px] font-bold text-[#111110] tracking-tight truncate">
              {o.number}{o.clientOrderNumber && <span className="text-[#9a9a95] font-normal"> · ваш № {o.clientOrderNumber}</span>}
            </h1>
            <p className="text-[12.5px] text-[#9a9a95] mt-0.5">Создан {fmtDate(o.created_at)}{o.deadline ? ` · срок ${fmtDate(o.deadline)}` : ''}</p>
          </div>
          <span className={`text-[11.5px] font-medium px-2.5 py-1 rounded-full border whitespace-nowrap flex-shrink-0 ${statusColor}`}>{statusText}</span>
        </div>
      </div>

      <div className="max-w-[760px] mx-auto px-4 pt-4 space-y-3">
        {o.recalcNote && (
          <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">✎ Пересчитано менеджером: {o.recalcNote}</div>
        )}

        {/* Позиции */}
        <div className="bg-white rounded-xl border border-[#e4e4e0]">
          <div className="px-4 py-3 border-b border-[#e4e4e0] flex items-center justify-between">
            <h3 className="text-[13px] font-bold text-[#111110]">Позиции</h3>
            <span className="text-[12px] text-[#9a9a95]">{o.items.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[11px] uppercase text-[#9a9a95]">
                  <th className="text-left font-medium px-4 py-2">Деталь</th>
                  <th className="text-left font-medium px-2 py-2">Размер</th>
                  <th className="text-right font-medium px-2 py-2">Кол-во</th>
                  <th className="text-right font-medium px-4 py-2">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {o.items.map((it, i) => (
                  <tr key={i} className="border-t border-[#f0f0ec]">
                    <td className="px-4 py-2 text-[#111110]">{it.material} {it.thickness}мм{it.tempering ? ', закалка' : ''}{it.facet ? ', фацет' : ''}{it.triplex ? ', триплекс' : ''}</td>
                    <td className="px-2 py-2 font-mono text-[#6b6b66]">{it.width}×{it.height}</td>
                    <td className="px-2 py-2 text-right font-mono">{it.quantity}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmt(it.price)}</td>
                  </tr>
                ))}
                <tr className="border-t border-[#e4e4e0] bg-[#f7f7f5]">
                  <td className="px-4 py-2.5 font-bold" colSpan={3}>Итого ваша цена</td>
                  <td className="px-4 py-2.5 text-right font-bold font-mono">{fmt(o.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Чертёж */}
        {o.drawingUrl && (
          <a href={o.drawingUrl} target="_blank" rel="noreferrer"
            className="flex items-center gap-3 bg-white rounded-xl border border-[#e4e4e0] px-4 py-3 hover:border-[#111110] transition-colors">
            <span className="text-[20px]">▤</span>
            <div><p className="text-[13px] font-semibold text-[#111110]">Чертёж заказа</p><p className="text-[11.5px] text-[#9a9a95]">нажмите, чтобы открыть PDF</p></div>
          </a>
        )}

        {/* Ход производства */}
        {(o.lane === 'in_work' || o.lane === 'shipped') && (
          <div className="bg-white rounded-xl border border-[#e4e4e0]">
            <div className="px-4 py-3 border-b border-[#e4e4e0] flex items-center justify-between">
              <h3 className="text-[13px] font-bold text-[#111110]">Ход производства</h3>
              <span className="text-[12px] text-[#9a9a95]">{o.progressPct}% готово</span>
            </div>
            <div className="px-4 py-2">
              {o.timeline.map((t, i) => (
                <div key={i} className="flex items-start gap-3 py-2">
                  <span className={`w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0 ${t.state === 'done' ? 'bg-emerald-500' : t.state === 'now' ? 'bg-blue-500 ring-4 ring-blue-100' : 'bg-[#e4e4e0]'}`} />
                  <div>
                    <p className={`text-[13px] ${t.state === 'wait' ? 'text-[#9a9a95] font-medium' : 'font-semibold text-[#111110]'}`}>{t.label}</p>
                    {t.date && <p className="text-[11px] text-[#9a9a95]">{fmtDate(t.date)}</p>}
                    {t.state === 'now' && <p className="text-[11px] text-blue-600">сейчас</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Link href={`/partner/order/${o.id}/kp`} className="flex-1 text-center py-2.5 rounded-lg border border-[#111110] text-[#111110] text-[13px] font-semibold hover:bg-[#f0f0ec]">Скачать КП</Link>
          <Link href="/partner/new" className="flex-1 text-center py-2.5 rounded-lg bg-[#1d1d1f] text-white text-[13px] font-semibold hover:bg-black">Повторить заказ</Link>
        </div>
      </div>
    </div>
  )
}
