'use client'

import { useEffect, useState } from 'react'

// Кабинет партнёра — «Мои заказы» (read-only). Партнёр видит свои заказы во всех
// состояниях: просчёт → отправлен в работу → в работе → отгружен. Никаких
// себестоимости/маржи — только его цена, прогресс и (если было) причина пересчёта.

type Lane = 'quote' | 'submitted' | 'in_work' | 'shipped'
type Order = {
  id: number
  number: string
  clientOrderNumber: string | null
  created_at: string
  amount: number
  lane: Lane
  progressPct: number
  stage: string
  shipped: boolean
  ready: boolean
  deadline: string
  recalcNote: string | null
}
type Resp = { linked: boolean; client: { name: string } | null; orders: Order[] }

const fmtMoney = (n: number) => n > 0 ? Math.round(n).toLocaleString('ru-RU') + ' ₽' : '—'
const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })

const LANES: { key: Lane; label: string }[] = [
  { key: 'quote',     label: 'Просчёты' },
  { key: 'submitted', label: 'Отправлены в работу' },
  { key: 'in_work',   label: 'В работе' },
  { key: 'shipped',   label: 'Отгружены' },
]

function stageColor(o: Order) {
  if (o.lane === 'shipped')   return 'bg-[#f0f0ec] text-[#6b6b66] border-[#e4e4e0]'
  if (o.lane === 'quote')     return 'bg-[#f5f5f3] text-[#6b6b66] border-[#e4e4e0]'
  if (o.lane === 'submitted') return 'bg-amber-50 text-amber-700 border-amber-200'
  if (o.ready)                return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  return 'bg-blue-50 text-blue-700 border-blue-200'
}

export default function PartnerPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/partner/orders')
      .then(r => r.json())
      .then((d: Resp) => setData(d))
      .catch(() => setData({ linked: false, client: null, orders: [] }))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка…</div>

  const orders = data?.orders ?? []
  const byLane = (l: Lane) => orders.filter(o => o.lane === l)

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-3 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Мои заказы</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">
          {data?.client?.name ? `${data.client.name} · ` : ''}M-Glass · производство по чертежам
        </p>
      </div>

      <div className="px-4 pt-4 space-y-2 max-w-[760px] mx-auto">
        {!data?.linked && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center">
            <p className="text-[14px] text-[#111110] font-medium">Аккаунт ещё не привязан к вашей компании</p>
            <p className="text-[13px] text-[#9a9a95] mt-1">Обратитесь к вашему менеджеру M-Glass, чтобы открыть доступ к заказам.</p>
          </div>
        )}

        {data?.linked && orders.length === 0 && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center">
            <p className="text-[14px] text-[#9a9a95]">Пока нет заказов</p>
          </div>
        )}

        {LANES.map(lane => {
          const list = byLane(lane.key)
          if (list.length === 0) return null
          return (
            <div key={lane.key}>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] pt-3">{lane.label} · {list.length}</p>
              {list.map(o => <OrderCard key={o.id} o={o} />)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function OrderCard({ o }: { o: Order }) {
  return (
    <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3 mt-2">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-[#111110] truncate">
            {o.number}
            {o.clientOrderNumber && <span className="text-[#9a9a95] font-normal"> · ваш № {o.clientOrderNumber}</span>}
          </p>
          <p className="text-[12px] text-[#9a9a95]">от {fmtDate(o.created_at)} · {fmtMoney(o.amount)}</p>
        </div>
        <span className={`text-[10px] font-medium px-2 py-1 rounded-full border whitespace-nowrap flex-shrink-0 ${stageColor(o)}`}>
          {o.stage}
        </span>
      </div>
      {(o.lane === 'in_work' || o.lane === 'shipped') && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-[#f0f0ec] rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${o.ready ? 'bg-emerald-500' : o.lane === 'shipped' ? 'bg-[#c4c4be]' : 'bg-blue-500'}`} style={{ width: `${o.lane === 'shipped' ? 100 : o.progressPct}%` }} />
          </div>
          {o.lane === 'in_work' && <span className="text-[11px] text-[#9a9a95] whitespace-nowrap">{o.progressPct}%</span>}
          {o.lane === 'in_work' && <span className="text-[11px] text-[#9a9a95] whitespace-nowrap">· срок {fmtDate(o.deadline)}</span>}
        </div>
      )}
      {o.recalcNote && (
        <div className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          ✎ Пересчитано менеджером: {o.recalcNote}
        </div>
      )}
    </div>
  )
}
