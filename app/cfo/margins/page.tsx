'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'

type Calc = {
  id: number
  created_at: string
  product_type: string | null
  final_price: number | null
  base_price: number | null
  discount: number | null
  margin: number | null
  profit: number | null
  status: string | null
  client_name: string | null
  creator: { name: string } | null
}

const MARGIN_RED   = 25
const MARGIN_AMBER = 35

const PRODUCT_LABEL: Record<string, string> = {
  mirror: 'Зеркало', mirror_light: 'Зеркало ПС',
  loft: 'Лофт', shower: 'Душевая',
  shower_standard: 'Душевая', shower_budget: 'Душевая',
}

function marginBg(m: number) {
  if (m < MARGIN_RED)   return 'bg-red-50 text-red-700'
  if (m < MARGIN_AMBER) return 'bg-amber-50 text-amber-700'
  return 'bg-emerald-50 text-emerald-700'
}

function fmt(n: number) {
  return n.toLocaleString('ru-RU') + ' ₽'
}

const PERIODS = [
  { label: 'Сегодня',  days: 0  },
  { label: 'Неделя',   days: 7  },
  { label: 'Месяц',    days: 30 },
  { label: 'Квартал',  days: 90 },
  { label: 'Всё',      days: -1 },
]

export default function MarginsPage() {
  const [calcs, setCalcs]     = useState<Calc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)
  const [period, setPeriod]   = useState(30)
  const [filter, setFilter]   = useState<'all' | 'low' | 'ok'>('all')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(false)
      try {
      const sb    = createClient()
      let q = sb
        .from('calculations')
        .select('id, created_at, product_type, final_price, base_price, discount, margin, profit, status, client_name, creator:users!created_by(name)')
        .order('created_at', { ascending: false })
        .limit(500)

      if (period >= 0) {
        const from = new Date()
        if (period === 0) from.setHours(0, 0, 0, 0)
        else from.setDate(from.getDate() - period)
        q = q.gte('created_at', from.toISOString())
      }

      const { data } = await q
      setCalcs((data ?? []) as unknown as Calc[])
      } catch (e) {
        console.error(e)
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [period])

  const filtered = calcs
    .filter(c => {
      const m = c.margin ?? 0
      if (filter === 'low') return m < MARGIN_AMBER
      if (filter === 'ok')  return m >= MARGIN_AMBER
      return true
    })
    .sort((a, b) => {
      const am = a.margin ?? 0, bm = b.margin ?? 0
      return sortDir === 'asc' ? am - bm : bm - am
    })

  const avg = filtered.length > 0
    ? filtered.reduce((s, c) => s + (c.margin ?? 0), 0) / filtered.length
    : 0
  const totalRev = filtered.reduce((s, c) => s + (c.final_price ?? 0), 0)
  const belowMin = filtered.filter(c => (c.margin ?? 0) < MARGIN_RED).length

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[1100px] mx-auto px-4 py-4 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-sm font-semibold text-[#111110]">CFO Center — Маржинальность</h1>
            <p className="text-[10px] text-[#9a9a95] mt-0.5">Анализ маржи по расчётам · Единственная точка правды</p>
          </div>
          <Link href="/cfo" className="text-[10px] text-[#9a9a95] hover:text-[#111110]">← Дашборд</Link>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex bg-white border border-[#e4e4e0] rounded-lg p-0.5 gap-0.5">
            {PERIODS.map(p => (
              <button key={p.days}
                onClick={() => setPeriod(p.days)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${period === p.days ? 'bg-[#111110] text-white' : 'text-[#6b6b66] hover:bg-[#f5f5f3]'}`}>
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex bg-white border border-[#e4e4e0] rounded-lg p-0.5 gap-0.5">
            {([['all', 'Все'], ['low', 'Ниже нормы'], ['ok', 'Норма']] as const).map(([v, l]) => (
              <button key={v}
                onClick={() => setFilter(v)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${filter === v ? 'bg-[#111110] text-white' : 'text-[#6b6b66] hover:bg-[#f5f5f3]'}`}>
                {l}
              </button>
            ))}
          </div>

          <button
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            className="px-2.5 py-1.5 bg-white border border-[#e4e4e0] rounded-lg text-[11px] text-[#6b6b66] hover:bg-[#f5f5f3] transition-colors">
            Маржа {sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Расчётов', value: String(filtered.length), hint: 'в периоде' },
            { label: 'Выручка',  value: totalRev >= 1_000_000 ? (totalRev / 1_000_000).toFixed(2) + ' млн ₽' : Math.round(totalRev / 1000) + ' тыс ₽', hint: 'цена клиенту' },
            { label: 'Средняя маржа', value: `${avg.toFixed(1)}%`, hint: belowMin > 0 ? `${belowMin} ниже ${MARGIN_RED}%` : 'в норме' },
            { label: 'Критические', value: String(belowMin), hint: `маржа < ${MARGIN_RED}%` },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-lg border border-[#e4e4e0] px-3 py-3">
              <p className="text-[10px] text-[#9a9a95] font-medium">{c.label}</p>
              <p className="text-lg font-bold font-mono mt-0.5 text-[#111110] leading-tight">{c.value}</p>
              <p className="text-[10px] text-[#c4c4be] mt-0.5">{c.hint}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
          <div className="overflow-x-auto">
            {error ? (
              <div className="flex flex-col items-center justify-center h-32 text-[#9a9a95] text-sm gap-2">
                <span>Не удалось загрузить данные.</span>
                <button onClick={() => location.reload()} className="px-3 py-1.5 bg-[#111110] text-white rounded-lg text-xs">Повторить</button>
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center h-32 text-[#9a9a95] text-sm">Загрузка…</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#111110] text-white">
                    {['#', 'Дата', 'Продукт', 'Менеджер', 'Клиент', 'Цена', 'Прибыль', 'Скидка', 'Маржа', 'Статус'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-medium opacity-80 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => {
                    const m = c.margin ?? 0
                    return (
                      <tr key={c.id} className="border-b border-[#f5f5f3] last:border-0 hover:bg-[#fafaf9]">
                        <td className="px-3 py-2 text-[#9a9a95] font-mono text-[10px]">{c.id}</td>
                        <td className="px-3 py-2 text-[#6b6b66] whitespace-nowrap">
                          {new Date(c.created_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit' })}
                        </td>
                        <td className="px-3 py-2 font-medium">{PRODUCT_LABEL[c.product_type ?? ''] ?? c.product_type ?? '—'}</td>
                        <td className="px-3 py-2 text-[#6b6b66]">{c.creator?.name?.split(' ')[0] ?? '—'}</td>
                        <td className="px-3 py-2 text-[#6b6b66] max-w-[120px] truncate">{c.client_name || '—'}</td>
                        <td className="px-3 py-2 font-mono font-medium whitespace-nowrap">{fmt(c.final_price ?? 0)}</td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap">
                          <span className={(c.profit ?? 0) > 0 ? 'text-emerald-600' : 'text-red-600'}>
                            {fmt(c.profit ?? 0)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[#9a9a95]">{c.discount ?? 0}%</td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${marginBg(m)}`}>
                            {m.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-[10px] font-medium ${
                            c.status === 'approved' ? 'text-emerald-600' :
                            c.status === 'sent'     ? 'text-blue-600'    : 'text-[#9a9a95]'
                          }`}>
                            {c.status === 'approved' ? 'Одобрен' : c.status === 'sent' ? 'Отправлен' : c.status ?? 'Черновик'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={10} className="px-3 py-8 text-center text-[#9a9a95] text-xs">Нет данных за период</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Color legend */}
        <div className="flex items-center gap-4 px-1">
          <span className="text-[10px] text-[#9a9a95]">Цвет маржи:</span>
          {[
            { label: `< ${MARGIN_RED}% — критично`, cls: 'bg-red-50 text-red-700' },
            { label: `${MARGIN_RED}–${MARGIN_AMBER}% — ниже цели`, cls: 'bg-amber-50 text-amber-700' },
            { label: `≥ ${MARGIN_AMBER}% — норма`, cls: 'bg-emerald-50 text-emerald-700' },
          ].map(l => (
            <span key={l.label} className={`text-[10px] font-medium px-2 py-0.5 rounded ${l.cls}`}>{l.label}</span>
          ))}
        </div>

      </div>
    </div>
  )
}
