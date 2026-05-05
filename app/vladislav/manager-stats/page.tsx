'use client'

import { useEffect, useState } from 'react'

type ManagerStat = {
  name: string
  total: number
  byDay: Record<string, number>
  lost: number
  won: number
  active: number
}

type StatsData = {
  managers: Record<string, ManagerStat>
  total: number
  from: number
  to: number
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

function getDaysInRange(from: number, to: number): string[] {
  const days: string[] = []
  const cur = new Date(from * 1000)
  cur.setHours(0, 0, 0, 0)
  const end = new Date(to * 1000)
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

const COLORS: Record<string, string> = {
  'Яна': 'bg-pink-500', 'Алина': 'bg-purple-500', 'Владислав': 'bg-blue-500',
  'Александра': 'bg-emerald-500', 'Семён': 'bg-amber-500', 'Нуржан': 'bg-cyan-500',
  'Артём': 'bg-orange-500', 'Гузель': 'bg-rose-500', 'Любовь': 'bg-violet-500',
}
const DOT_COLOR: Record<string, string> = {
  'Яна': 'bg-pink-400', 'Алина': 'bg-purple-400', 'Владислав': 'bg-blue-400',
  'Александра': 'bg-emerald-400', 'Семён': 'bg-amber-400', 'Нуржан': 'bg-cyan-400',
  'Артём': 'bg-orange-400', 'Гузель': 'bg-rose-400', 'Любовь': 'bg-violet-400',
}

export default function ManagerStatsPage() {
  const [data, setData]       = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod]   = useState<'month' | 'week' | 'today'>('month')

  useEffect(() => { load() }, [period])

  async function load() {
    setLoading(true)
    const now = Math.floor(Date.now() / 1000)
    let from = now
    if (period === 'month') {
      const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0)
      from = Math.floor(d.getTime() / 1000)
    } else if (period === 'week') {
      from = now - 7 * 86400
    } else {
      const d = new Date(); d.setHours(0, 0, 0, 0)
      from = Math.floor(d.getTime() / 1000)
    }
    const res = await fetch(`/api/amo/manager-stats?from=${from}&to=${now}`)
    const json = await res.json()
    setData(json)
    setLoading(false)
  }

  const managers = data ? Object.values(data.managers).sort((a, b) => b.total - a.total) : []
  const days = data ? getDaysInRange(data.from, data.to) : []
  const maxDay = Math.max(1, ...managers.flatMap(m => Object.values(m.byDay)))

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-semibold text-[#1d1d1f]">Аналитика менеджеров</h1>
          <p className="text-[13px] text-[#6e6e73]">Заявки из воронки Продажи</p>
        </div>
        <div className="flex gap-1 bg-[#f2f2f7] p-1 rounded-xl">
          {(['today', 'week', 'month'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                period === p ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#6e6e73] hover:text-[#1d1d1f]'
              }`}>
              {p === 'today' ? 'Сегодня' : p === 'week' ? '7 дней' : 'Месяц'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-center text-[13px] text-[#aeaeb2] py-16">Загружаю данные из AMO...</p>
      ) : !managers.length ? (
        <p className="text-center text-[13px] text-[#aeaeb2] py-16">Нет данных за период</p>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
            {managers.map(m => (
              <div key={m.name} className="bg-white rounded-2xl border border-[#e8e8ed] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${DOT_COLOR[m.name] ?? 'bg-gray-400'}`} />
                  <p className="text-[13px] font-semibold text-[#1d1d1f] truncate">{m.name}</p>
                </div>
                <p className="text-[28px] font-bold text-[#1d1d1f] leading-none mb-1">{m.total}</p>
                <div className="flex gap-2 text-[11px] flex-wrap">
                  <span className="text-emerald-600">✓ {m.won}</span>
                  <span className="text-red-500">✗ {m.lost}</span>
                  <span className="text-[#aeaeb2]">● {m.active}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Daily bar chart */}
          {days.length > 1 && (
            <div className="bg-white rounded-2xl border border-[#e8e8ed] p-5 mb-6 overflow-x-auto">
              <p className="text-[12px] font-semibold text-[#aeaeb2] uppercase tracking-wider mb-4">
                По дням — заявок получено
              </p>
              <div className="min-w-[600px]">
                <div className="flex gap-1 items-end h-32 mb-2">
                  {days.map(day => {
                    const total = managers.reduce((s, m) => s + (m.byDay[day] || 0), 0)
                    const pct = total / maxDay
                    return (
                      <div key={day} className="flex-1 flex flex-col items-center gap-0.5 group">
                        <div className="relative w-full flex flex-col justify-end" style={{ height: '100px' }}>
                          <div className="w-full bg-blue-500 rounded-t-sm transition-all"
                            style={{ height: `${Math.max(2, pct * 100)}px` }} />
                          {total > 0 && (
                            <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-bold text-[#1d1d1f] opacity-0 group-hover:opacity-100 transition-opacity">
                              {total}
                            </div>
                          )}
                        </div>
                        <p className="text-[9px] text-[#aeaeb2] -rotate-45 origin-top-left translate-y-2 whitespace-nowrap">
                          {fmt(day)}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Detailed table */}
          <div className="bg-white rounded-2xl border border-[#e8e8ed] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#f2f2f7]">
              <p className="text-[12px] font-semibold text-[#aeaeb2] uppercase tracking-wider">
                Детализация по менеджерам
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#f2f2f7]">
                    <th className="text-left px-5 py-3 text-[11px] font-semibold text-[#aeaeb2] uppercase tracking-wider">Менеджер</th>
                    <th className="text-center px-3 py-3 text-[11px] font-semibold text-[#aeaeb2] uppercase tracking-wider">Получено</th>
                    <th className="text-center px-3 py-3 text-[11px] font-semibold text-[#aeaeb2] uppercase tracking-wider">В работе</th>
                    <th className="text-center px-3 py-3 text-[11px] font-semibold text-[#aeaeb2] uppercase tracking-wider">Выиграно</th>
                    <th className="text-center px-3 py-3 text-[11px] font-semibold text-[#aeaeb2] uppercase tracking-wider">Слито</th>
                    <th className="text-center px-3 py-3 text-[11px] font-semibold text-[#aeaeb2] uppercase tracking-wider">Конверсия</th>
                  </tr>
                </thead>
                <tbody>
                  {managers.map((m, i) => {
                    const closed = m.won + m.lost
                    const conv = closed > 0 ? Math.round((m.won / closed) * 100) : 0
                    const barWidth = data ? Math.round((m.total / Math.max(1, managers[0].total)) * 100) : 0
                    return (
                      <tr key={m.name} className={i % 2 === 0 ? 'bg-white' : 'bg-[#f9f9fb]'}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${DOT_COLOR[m.name] ?? 'bg-gray-400'}`} />
                            <span className="font-medium text-[#1d1d1f]">{m.name}</span>
                          </div>
                          <div className="mt-1 h-1 bg-[#f2f2f7] rounded-full overflow-hidden w-32">
                            <div className={`h-full rounded-full ${COLORS[m.name] ?? 'bg-blue-500'}`}
                              style={{ width: `${barWidth}%` }} />
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center font-bold text-[#1d1d1f]">{m.total}</td>
                        <td className="px-3 py-3 text-center text-[#6e6e73]">{m.active}</td>
                        <td className="px-3 py-3 text-center text-emerald-600 font-medium">{m.won}</td>
                        <td className="px-3 py-3 text-center text-red-500">{m.lost}</td>
                        <td className="px-3 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            conv >= 50 ? 'bg-emerald-100 text-emerald-700' :
                            conv >= 25 ? 'bg-amber-100 text-amber-700' :
                            'bg-red-100 text-red-600'
                          }`}>
                            {conv}%
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per-manager daily breakdown */}
          {days.length > 1 && (
            <div className="mt-6 bg-white rounded-2xl border border-[#e8e8ed] overflow-hidden">
              <div className="px-5 py-4 border-b border-[#f2f2f7]">
                <p className="text-[12px] font-semibold text-[#aeaeb2] uppercase tracking-wider">
                  Заявки по дням
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="text-[12px] w-full">
                  <thead>
                    <tr className="border-b border-[#f2f2f7]">
                      <th className="text-left px-5 py-2 text-[11px] font-semibold text-[#aeaeb2] sticky left-0 bg-white">Менеджер</th>
                      {days.slice(-14).map(d => (
                        <th key={d} className="text-center px-2 py-2 text-[10px] font-medium text-[#aeaeb2] whitespace-nowrap min-w-[40px]">
                          {fmt(d)}
                        </th>
                      ))}
                      <th className="text-center px-3 py-2 text-[11px] font-semibold text-[#aeaeb2]">Итого</th>
                    </tr>
                  </thead>
                  <tbody>
                    {managers.map((m, i) => (
                      <tr key={m.name} className={i % 2 === 0 ? 'bg-white' : 'bg-[#f9f9fb]'}>
                        <td className="px-5 py-2 font-medium text-[#1d1d1f] sticky left-0 bg-inherit whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <div className={`w-1.5 h-1.5 rounded-full ${DOT_COLOR[m.name] ?? 'bg-gray-400'}`} />
                            {m.name}
                          </div>
                        </td>
                        {days.slice(-14).map(d => {
                          const n = m.byDay[d] || 0
                          return (
                            <td key={d} className="px-2 py-2 text-center">
                              {n > 0 ? (
                                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-[11px] font-bold ${COLORS[m.name] ?? 'bg-blue-500'}`}>
                                  {n}
                                </span>
                              ) : (
                                <span className="text-[#e8e8ed]">—</span>
                              )}
                            </td>
                          )
                        })}
                        <td className="px-3 py-2 text-center font-bold text-[#1d1d1f]">{m.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
