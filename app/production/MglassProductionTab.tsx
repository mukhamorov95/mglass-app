'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import type { BOMLine } from '@/lib/types'

const STAGES = [
  { key: 'material_ordered', label: 'Материал' },
  { key: 'cut',              label: 'Нарезан'  },
  { key: 'edge_processed',   label: 'Кромка'   },
  { key: 'drilled',          label: 'Сверловка'},
  { key: 'tempering',        label: 'Закалка'  },
  { key: 'hardware_ready',   label: 'Фурнитура'},
  { key: 'packaged',         label: 'Упакован' },
  { key: 'installed',        label: 'Установлен'},
] as const

type StageKey = typeof STAGES[number]['key']

type OrderLine = {
  id: string
  position_num: number
  product_name: string
  product_type: string
  dimensions_text: string | null
  quantity: number
  unit: string
  materials_bom: BOMLine[] | null
  hardware_bom:  BOMLine[] | null
  services_bom:  BOMLine[] | null
  input_snapshot: Record<string, unknown> | null
}

type ProductionOrder = {
  id: string
  number: string
  client_name: string
  client_phone: string | null
  object_address: string | null
  launched_at: string | null
  deadline: string | null
  total_sale_price: number
  production_stages: Record<StageKey, string | null>
  order_lines: OrderLine[]
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

function DeadlineBadge({ deadline }: { deadline: string | null }) {
  const [now, setNow] = useState(0)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now())
  }, [])
  if (!deadline || !now) return null
  const days = Math.ceil((new Date(deadline).getTime() - now) / 86_400_000)
  if (days < 0)  return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600">просрочка {Math.abs(days)} дн.</span>
  if (days <= 3) return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">{days} дн. до дедлайна</span>
  return null
}

export default function MglassProductionTab() {
  const [orders, setOrders] = useState<ProductionOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedBom, setExpandedBom] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/orders/production')
      .then(r => r.json())
      .then(data => { setOrders(data); setLoading(false) })
  }, [])

  async function toggleStage(orderId: string, stage: StageKey) {
    const order = orders.find(o => o.id === orderId)
    if (!order) return
    const currentDone = !!order.production_stages?.[stage]

    setOrders(prev => prev.map(o =>
      o.id !== orderId ? o : {
        ...o,
        production_stages: {
          ...o.production_stages,
          [stage]: currentDone ? null : new Date().toISOString().slice(0, 10),
        },
      }
    ))

    await fetch(`/api/orders/${orderId}/production-stages`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage, done: !currentDone }),
    })
  }

  function toggleBom(lineId: string) {
    setExpandedBom(prev => {
      const next = new Set(prev)
      next.has(lineId) ? next.delete(lineId) : next.add(lineId)
      return next
    })
  }

  const filtered = useMemo(() =>
    orders.filter(o => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return o.number.toLowerCase().includes(q) || o.client_name.toLowerCase().includes(q)
    }),
  [orders, search])

  if (loading) return (
    <div className="py-12 text-center text-[13px] text-[#8a8a85]">Загрузка...</div>
  )

  return (
    <div className="space-y-3">

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#b4b4ae]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"/>
        </svg>
        <input
          type="text"
          placeholder="Номер заказа или клиент…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 text-[13px] bg-white border border-[#e4e4e0] rounded-xl outline-none focus:border-[#111110]"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-10 text-center text-[13px] text-[#8a8a85]">
          {orders.length === 0 ? 'Нет заказов в работе' : 'Нет совпадений'}
        </div>
      ) : (
        filtered.map(order => {
          const stages = order.production_stages ?? {} as Record<StageKey, string | null>
          const doneCount = STAGES.filter(s => !!stages[s.key]).length
          const progress  = Math.round(doneCount / STAGES.length * 100)
          const isComplete = doneCount === STAGES.length

          return (
            <div key={order.id} className={`bg-white border rounded-xl overflow-hidden transition-colors ${
              isComplete ? 'border-emerald-200' : 'border-[#e4e4e0]'
            }`}>

              {/* Header */}
              <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-[#f0f0ec]">
                <div className="flex items-center gap-2.5 min-w-0 flex-1 flex-wrap">
                  <Link href={`/orders/${order.id}`}
                    className="text-[12px] font-bold font-mono text-[#111110] bg-[#f0f0ec] px-2 py-0.5 rounded hover:bg-[#e8e8e4] flex-shrink-0">
                    {order.number}
                  </Link>
                  <span className="text-[13px] font-semibold text-[#111110]">{order.client_name}</span>
                  {order.launched_at && (
                    <span className="text-[11px] text-[#9a9a95]">запущен {fmtDate(order.launched_at)}</span>
                  )}
                  {order.object_address && (
                    <span className="text-[11px] text-[#b4b4b0] truncate max-w-[200px]">{order.object_address}</span>
                  )}
                  <DeadlineBadge deadline={order.deadline} />
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-[12px] font-bold tabular-nums ${isComplete ? 'text-emerald-600' : 'text-[#9a9a95]'}`}>
                    {doneCount}/{STAGES.length}
                  </span>
                  <div className="w-20 h-1.5 bg-[#f0f0ec] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isComplete ? 'bg-emerald-500' : 'bg-[#111110]'}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Order lines */}
              {order.order_lines.length > 0 && (
                <div className="px-4 py-2.5 border-b border-[#f5f5f3] space-y-1.5">
                  {order.order_lines.map(line => {
                    const allBom = [
                      ...(line.materials_bom ?? []),
                      ...(line.hardware_bom  ?? []),
                    ]
                    const hasBom = allBom.length > 0
                    const expanded = expandedBom.has(line.id)
                    return (
                      <div key={line.id}>
                        <div className="flex items-center gap-2 text-[12px]">
                          <span className="text-[#9a9a95] w-4 text-right flex-shrink-0">{line.position_num}.</span>
                          <span className="text-[#111110] font-medium">{line.product_name}</span>
                          {line.dimensions_text && (
                            <span className="text-[#b4b4b0] font-mono">{line.dimensions_text}</span>
                          )}
                          {hasBom && (
                            <button onClick={() => toggleBom(line.id)}
                              className="text-[#9a9a95] hover:text-blue-600 text-[11px] ml-auto flex-shrink-0">
                              {expanded ? '▲ состав' : `▼ ${allBom.length} позиций`}
                            </button>
                          )}
                        </div>
                        {expanded && hasBom && (
                          <div className="mt-1.5 ml-6 bg-[#fafaf9] rounded-lg p-2.5 space-y-0.5">
                            {allBom.map((item, i) => (
                              <div key={i} className="flex items-center justify-between text-[11px]">
                                <span className="text-[#4b4b47] truncate flex-1">{item.name}</span>
                                <span className="text-[#9a9a95] ml-3 flex-shrink-0">{item.qty} {item.unit}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Stage checkboxes */}
              <div className="px-4 py-3 flex flex-wrap gap-1.5">
                {STAGES.map(stage => {
                  const doneDate = stages[stage.key]
                  const done = !!doneDate
                  return (
                    <button
                      key={stage.key}
                      onClick={() => toggleStage(order.id, stage.key)}
                      title={done ? `Выполнено: ${doneDate}` : 'Нажать чтобы отметить'}
                      className={`flex flex-col items-center px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all select-none active:scale-95 ${
                        done
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white text-[#9a9a95] border-[#e4e4e0] hover:border-[#111110] hover:text-[#111110]'
                      }`}>
                      {stage.label}
                      {done && doneDate && (
                        <span className="text-[8px] font-normal opacity-70 leading-none mt-0.5">
                          {new Date(doneDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

            </div>
          )
        })
      )}
    </div>
  )
}
