'use client'

import { useEffect, useState } from 'react'

// Кабинет партнёра — «Мои заказы» (read-only). Партнёр видит статус своих
// заказов: на каком этапе, готовность, ориентировочный срок. Никаких
// себестоимости/маржи — только его цена и прогресс.

type Order = {
  id: number
  number: string
  clientOrderNumber: string | null
  created_at: string
  amount: number
  progressPct: number
  stage: string
  shipped: boolean
  ready: boolean
  deadline: string
}
type Resp = { linked: boolean; client: { name: string } | null; orders: Order[] }

const fmtMoney = (n: number) => n > 0 ? Math.round(n).toLocaleString('ru-RU') + ' ₽' : '—'
const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })

function stageColor(o: Order) {
  if (o.shipped) return 'bg-[#f0f0ec] text-[#6b6b66] border-[#e4e4e0]'
  if (o.ready)   return 'bg-emerald-50 text-emerald-700 border-emerald-200'
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

  const active = (data?.orders ?? []).filter(o => !o.shipped)
  const shipped = (data?.orders ?? []).filter(o => o.shipped)

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

        {data?.linked && active.length === 0 && shipped.length === 0 && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center">
            <p className="text-[14px] text-[#9a9a95]">Пока нет заказов</p>
          </div>
        )}

        {active.length > 0 && (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] pt-1">В работе · {active.length}</p>
            {active.map(o => <OrderCard key={o.id} o={o} />)}
          </>
        )}

        {shipped.length > 0 && (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] pt-3">Отгружены · {shipped.length}</p>
            {shipped.map(o => <OrderCard key={o.id} o={o} />)}
          </>
        )}
      </div>
    </div>
  )
}

function OrderCard({ o }: { o: Order }) {
  return (
    <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
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
      {!o.shipped && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-[#f0f0ec] rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${o.ready ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${o.progressPct}%` }} />
          </div>
          <span className="text-[11px] text-[#9a9a95] whitespace-nowrap">{o.progressPct}%</span>
          <span className="text-[11px] text-[#9a9a95] whitespace-nowrap">· срок {fmtDate(o.deadline)}</span>
        </div>
      )}
    </div>
  )
}
