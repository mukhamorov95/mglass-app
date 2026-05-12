'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase-browser'
import Pagination from '@/components/Pagination'

const PAGE_SIZE = 20

type Item = {
  materialName?: string
  category?: string
  thickness?: number
  width?: number
  height?: number
  quantity?: number
  totalAreaNet?: number
  totalWeight?: number
  hasTempering?: boolean
  comment?: string
}

type Order = {
  id: number
  client_name: string
  total_after_discount: number
  total_sale_inc_vat: number
  discount_percent: number
  items: Item[]
  notes: string | null
  created_at: string
  // derived from notes JSON
  production_status: string | null
  deadline_date: string | null
}

const PROD_STATUSES = [
  { key: 'pending',    label: 'Ожидает',       color: 'bg-[#f0f0ec] text-[#6b6b66]' },
  { key: 'cutting',    label: 'Раскрой',        color: 'bg-blue-50 text-blue-700' },
  { key: 'tempering',  label: 'Закалка',        color: 'bg-orange-50 text-orange-700' },
  { key: 'ready',      label: 'Готово',         color: 'bg-emerald-50 text-emerald-700' },
  { key: 'shipped',    label: 'Отгружено',      color: 'bg-purple-50 text-purple-700' },
] as const

type ProdStatus = typeof PROD_STATUSES[number]['key']

function parseNotes(n: string | null): Record<string, unknown> {
  if (!n) return {}
  try { const p = JSON.parse(n); if (typeof p === 'object') return p } catch {}
  return {}
}

function daysUntil(d: string | null) {
  if (!d) return null
  return Math.ceil((new Date(d).getTime() - new Date().setHours(0,0,0,0)) / 86_400_000)
}

function fmtN(n: number, d = 2) { return n.toLocaleString('ru-RU', { maximumFractionDigits: d }) }

export default function B2BProductionPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<ProdStatus | 'all'>('all')
  const [updating, setUpdating] = useState<number | null>(null)
  const [printId, setPrintId] = useState<number | null>(null)
  const [page, setPage] = useState(1)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const sb = createClient()
    const { data } = await sb
      .from('b2b_orders')
      .select('id,client_name,total_after_discount,total_sale_inc_vat,discount_percent,items,notes,created_at')
      .order('created_at', { ascending: false })
      .limit(1000)
    const filtered = (data ?? [])
      .filter((o: { notes: string | null }) => {
        const s = parseNotes(o.notes).status
        return s === 'confirmed' || s === 'agreed'
      })
      .map((o: Record<string, unknown>) => ({
        ...o,
        production_status: (parseNotes(o.notes as string | null).production_status as string | null) ?? null,
        deadline_date:     (parseNotes(o.notes as string | null).deadline_date as string | null) ?? null,
      }))
    setOrders(filtered as Order[])
    setLoading(false)
  }

  async function setStatus(id: number, status: ProdStatus) {
    setUpdating(id)
    const sb = createClient()
    const order = orders.find(o => o.id === id)
    if (order) {
      const parsed = parseNotes(order.notes)
      const newNotes = JSON.stringify({ ...parsed, production_status: status })
      await sb.from('b2b_orders').update({ notes: newNotes }).eq('id', id)
      setOrders(prev => prev.map(o => o.id === id ? { ...o, production_status: status, notes: newNotes } : o))
    }
    setUpdating(null)
  }

  async function setDeadline(id: number, date: string) {
    const sb = createClient()
    const order = orders.find(o => o.id === id)
    if (order) {
      const parsed = parseNotes(order.notes)
      const newNotes = JSON.stringify({ ...parsed, deadline_date: date || null })
      await sb.from('b2b_orders').update({ notes: newNotes }).eq('id', id)
      setOrders(prev => prev.map(o => o.id === id ? { ...o, deadline_date: date || null, notes: newNotes } : o))
    }
  }

  const visible = useMemo(() => {
    setPage(1)
    if (filter === 'all') return orders.filter(o => o.production_status !== 'shipped')
    return orders.filter(o => (o.production_status ?? 'pending') === filter)
  }, [orders, filter])

  const printOrder = orders.find(o => o.id === printId)

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка...</div>
  )

  return (
    <div className="min-h-screen bg-[#f8f8f7]">
      <div className="max-w-[1100px] mx-auto px-4 py-5">

        <div className="flex items-center justify-between mb-5">
          <h1 className="text-[16px] font-semibold text-[#111110] tracking-tight">B2B Производство</h1>
          <div className="text-[12px] text-[#8a8a85]">{visible.length} заказов</div>
        </div>


        {/* Фильтр по статусу */}
        <div className="flex gap-1.5 flex-wrap mb-4">
          <button onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${filter === 'all' ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f8f8f7]'}`}>
            Все активные
          </button>
          {PROD_STATUSES.map(s => (
            <button key={s.key} onClick={() => setFilter(s.key)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${filter === s.key ? 'bg-[#111110] text-white' : `bg-white border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f8f8f7]`}`}>
              {s.label}
              <span className="ml-1.5 text-[10px] opacity-70">
                {orders.filter(o => (o.production_status ?? 'pending') === s.key).length}
              </span>
            </button>
          ))}
        </div>

        {/* Список заказов */}
        {visible.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-[#c4c4be]">Нет заказов в этом статусе</div>
        ) : (
          <>
            <Pagination
              page={page} total={visible.length} pageSize={PAGE_SIZE}
              onPageChange={setPage} className="mb-3"
            />
          <div className="space-y-3">
            {visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(o => {
              const status = (o.production_status ?? 'pending') as ProdStatus
              const sm = PROD_STATUSES.find(s => s.key === status) ?? PROD_STATUSES[0]
              const dl = daysUntil(o.deadline_date)
              const items: Item[] = Array.isArray(o.items) ? o.items : []
              const totalArea = items.reduce((s, i) => s + (i.totalAreaNet ?? 0), 0)
              const totalWeight = items.reduce((s, i) => s + (i.totalWeight ?? 0), 0)

              return (
                <div key={o.id} className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">

                  {/* Шапка заказа */}
                  <div className="px-5 py-3 border-b border-[#f0f0ec] flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${sm.color}`}>{sm.label}</span>
                      <span className="text-[14px] font-semibold text-[#111110]">{o.client_name}</span>
                      <span className="text-[12px] text-[#9a9a95]">
                        {new Date(o.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Дедлайн */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-[#9a9a95]">Дедлайн:</span>
                        <input type="date"
                          className="bg-[#f8f8f7] border border-[#e4e4e0] rounded px-2 py-0.5 text-[11px] text-[#111110] outline-none focus:border-[#111110]"
                          value={o.deadline_date ?? ''}
                          onChange={e => setDeadline(o.id, e.target.value)}
                        />
                        {dl !== null && (
                          <span className={`text-[11px] font-semibold ${dl < 0 ? 'text-red-600' : dl <= 2 ? 'text-orange-500' : 'text-[#9a9a95]'}`}>
                            {dl < 0 ? `просрочено ${-dl}д` : dl === 0 ? 'сегодня' : `${dl}д`}
                          </span>
                        )}
                      </div>
                      {/* Кнопка печати */}
                      <button onClick={() => { setPrintId(o.id); setTimeout(() => window.print(), 100) }}
                        className="text-[11px] text-[#6b6b66] border border-[#e4e4e0] px-2.5 py-1 rounded-lg hover:bg-[#f8f8f7] transition-colors">
                        🖨 Лист
                      </button>
                    </div>
                  </div>

                  {/* Позиции */}
                  {items.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="bg-[#fafaf9] text-[10px] text-[#9a9a95] uppercase tracking-widest">
                            <th className="px-4 py-2 text-left">#</th>
                            <th className="px-4 py-2 text-left">Материал</th>
                            <th className="px-4 py-2 text-right">Толщ.</th>
                            <th className="px-4 py-2 text-right">Ш мм</th>
                            <th className="px-4 py-2 text-right">В мм</th>
                            <th className="px-4 py-2 text-right">Кол.</th>
                            <th className="px-4 py-2 text-right">м²</th>
                            <th className="px-4 py-2 text-right">Вес</th>
                            <th className="px-4 py-2 text-center">Закалка</th>
                            <th className="px-4 py-2 text-left">Примечание</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#f8f8f7]">
                          {items.map((item, idx) => (
                            <tr key={idx} className="hover:bg-[#fafaf9]">
                              <td className="px-4 py-2 text-[#c4c4be] font-bold">{idx + 1}</td>
                              <td className="px-4 py-2 font-medium text-[#111110]">
                                {item.materialName ?? '—'}
                                <span className="ml-1 text-[10px] text-[#9a9a95]">{item.category}</span>
                              </td>
                              <td className="px-4 py-2 text-right font-mono">{item.thickness ?? '—'}</td>
                              <td className="px-4 py-2 text-right font-mono font-semibold">{item.width ?? '—'}</td>
                              <td className="px-4 py-2 text-right font-mono font-semibold">{item.height ?? '—'}</td>
                              <td className="px-4 py-2 text-right font-mono">{item.quantity ?? 1}</td>
                              <td className="px-4 py-2 text-right font-mono">{fmtN(item.totalAreaNet ?? 0)}</td>
                              <td className="px-4 py-2 text-right font-mono text-[#6b6b66]">{fmtN(item.totalWeight ?? 0, 1)}</td>
                              <td className="px-4 py-2 text-center">
                                {item.hasTempering
                                  ? <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">Да</span>
                                  : <span className="text-[10px] text-[#c4c4be]">—</span>}
                              </td>
                              <td className="px-4 py-2 text-[#9a9a95] max-w-[120px] truncate">{item.comment ?? ''}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-[#e4e4e0] bg-[#fafaf9] font-semibold">
                            <td colSpan={6} className="px-4 py-2 text-[11px] text-[#9a9a95]">Итого {items.length} позиций</td>
                            <td className="px-4 py-2 text-right font-mono text-[#111110]">{fmtN(totalArea)} м²</td>
                            <td className="px-4 py-2 text-right font-mono text-[#6b6b66]">{fmtN(totalWeight, 1)} кг</td>
                            <td colSpan={2}></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}

                  {/* Смена статуса */}
                  <div className="px-5 py-3 border-t border-[#f8f8f7] flex gap-1.5 flex-wrap">
                    {PROD_STATUSES.map(s => (
                      <button key={s.key}
                        disabled={updating === o.id || status === s.key}
                        onClick={() => setStatus(o.id, s.key)}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors ${
                          status === s.key
                            ? s.color + ' cursor-default'
                            : 'bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4]'
                        }`}>
                        {status === s.key ? '✓ ' : ''}{s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
            <Pagination
              page={page} total={visible.length} pageSize={PAGE_SIZE}
              onPageChange={setPage} className="mt-4"
            />
          </>
        )}
      </div>

      {/* Печатная форма */}
      {printOrder && (
        <div className="hidden print:block p-8 text-black">
          <div className="mb-6">
            <h1 className="text-xl font-bold">Производственный лист</h1>
            <p className="text-sm mt-1">Клиент: <strong>{printOrder.client_name}</strong></p>
            <p className="text-sm">Дата: {new Date(printOrder.created_at).toLocaleDateString('ru-RU')}</p>
            {printOrder.deadline_date && (
              <p className="text-sm">Дедлайн: <strong>{new Date(printOrder.deadline_date).toLocaleDateString('ru-RU')}</strong></p>
            )}
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-black">
                <th className="py-1 text-left">#</th>
                <th className="py-1 text-left">Материал</th>
                <th className="py-1 text-right">Толщ.</th>
                <th className="py-1 text-right">Ш, мм</th>
                <th className="py-1 text-right">В, мм</th>
                <th className="py-1 text-right">Кол.</th>
                <th className="py-1 text-right">м²</th>
                <th className="py-1 text-right">Вес</th>
                <th className="py-1 text-center">Закалка</th>
                <th className="py-1 text-left">Примечание</th>
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(printOrder.items) ? printOrder.items : []).map((item: Item, idx: number) => (
                <tr key={idx} className="border-b border-gray-200">
                  <td className="py-1">{idx + 1}</td>
                  <td className="py-1 font-medium">{item.materialName} {item.thickness}мм</td>
                  <td className="py-1 text-right">{item.thickness}</td>
                  <td className="py-1 text-right font-bold">{item.width}</td>
                  <td className="py-1 text-right font-bold">{item.height}</td>
                  <td className="py-1 text-right">{item.quantity}</td>
                  <td className="py-1 text-right">{(item.totalAreaNet ?? 0).toFixed(3)}</td>
                  <td className="py-1 text-right">{(item.totalWeight ?? 0).toFixed(1)}</td>
                  <td className="py-1 text-center">{item.hasTempering ? 'ДА' : '—'}</td>
                  <td className="py-1">{item.comment ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 text-sm">
            <p>Принял: _________________ Подпись: _________________</p>
          </div>
        </div>
      )}
    </div>
  )
}
