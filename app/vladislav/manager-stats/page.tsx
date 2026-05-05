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

type SourceStat = { total: number; won: number; lost: number; active: number }

type StatsData = {
  managers: Record<string, ManagerStat>
  sources:  Record<string, SourceStat>
  total: number
  from: number
  to: number
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

function toDateInput(ts: number) {
  return new Date(ts * 1000).toISOString().slice(0, 10)
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

type Preset = 'today' | 'week' | 'month' | 'year' | 'custom'

function getPresetRange(preset: Preset): { from: number; to: number } {
  const now = Math.floor(Date.now() / 1000)
  const d = new Date()
  if (preset === 'today') {
    d.setHours(0, 0, 0, 0)
    return { from: Math.floor(d.getTime() / 1000), to: now }
  }
  if (preset === 'week') return { from: now - 7 * 86400, to: now }
  if (preset === 'month') {
    d.setDate(1); d.setHours(0, 0, 0, 0)
    return { from: Math.floor(d.getTime() / 1000), to: now }
  }
  if (preset === 'year') {
    d.setMonth(0, 1); d.setHours(0, 0, 0, 0)
    return { from: Math.floor(d.getTime() / 1000), to: now }
  }
  return { from: now - 30 * 86400, to: now }
}

export default function ManagerStatsPage() {
  const [data, setData]         = useState<StatsData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [preset, setPreset]     = useState<Preset>('year')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo]     = useState(new Date().toISOString().slice(0, 10))

  useEffect(() => {
    if (preset !== 'custom') load(getPresetRange(preset))
  }, [preset])

  async function load({ from, to }: { from: number; to: number }) {
    setLoading(true)
    const res = await fetch(`/api/amo/manager-stats?from=${from}&to=${to}`)
    const json = await res.json()
    setData(json)
    setLoading(false)
  }

  function applyCustom() {
    if (!customFrom || !customTo) return
    const from = Math.floor(new Date(customFrom).getTime() / 1000)
    const to   = Math.floor(new Date(customTo + 'T23:59:59').getTime() / 1000)
    load({ from, to })
  }

  const managers = data ? Object.values(data.managers).sort((a, b) => b.total - a.total) : []
  const days = data ? getDaysInRange(data.from, data.to) : []
  const maxDay = Math.max(1, ...managers.flatMap(m => Object.values(m.byDay)))

  const PRESETS: { key: Preset; label: string }[] = [
    { key: 'today', label: 'Сегодня' },
    { key: 'week',  label: '7 дней' },
    { key: 'month', label: 'Месяц' },
    { key: 'year',  label: 'С начала года' },
    { key: 'custom', label: 'Период' },
  ]

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-[22px] font-semibold text-[#1d1d1f]">Аналитика менеджеров</h1>
          <p className="text-[13px] text-[#6e6e73]">
            {data ? `${data.total} заявок · ${toDateInput(data.from)} — ${toDateInput(data.to)}` : 'Воронка Продажи · AMO CRM'}
          </p>
        </div>

        {/* Period selector */}
        <div className="flex flex-col gap-2">
          <div className="flex gap-1 bg-[#f2f2f7] p-1 rounded-xl">
            {PRESETS.map(p => (
              <button key={p.key} onClick={() => setPreset(p.key)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all whitespace-nowrap ${
                  preset === p.key ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#6e6e73] hover:text-[#1d1d1f]'
                }`}>
                {p.label}
              </button>
            ))}
          </div>

          {preset === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                className="bg-white border border-[#e8e8ed] rounded-xl px-3 py-1.5 text-[12px] text-[#1d1d1f] outline-none focus:border-[#0071e3]" />
              <span className="text-[12px] text-[#6e6e73]">—</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                className="bg-white border border-[#e8e8ed] rounded-xl px-3 py-1.5 text-[12px] text-[#1d1d1f] outline-none focus:border-[#0071e3]" />
              <button onClick={applyCustom}
                className="px-4 py-1.5 rounded-xl bg-[#0071e3] text-white text-[12px] font-semibold hover:bg-[#0077ed] transition-colors">
                Показать
              </button>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-8 h-8 border-2 border-[#0071e3] border-t-transparent rounded-full animate-spin" />
          <p className="text-[13px] text-[#aeaeb2]">Загружаю данные из AMO...</p>
        </div>
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
                По дням
              </p>
              <div style={{ minWidth: `${Math.max(600, days.length * 20)}px` }}>
                <div className="flex gap-0.5 items-end h-28 mb-3">
                  {days.map(day => {
                    const total = managers.reduce((s, m) => s + (m.byDay[day] || 0), 0)
                    const pct = total / maxDay
                    return (
                      <div key={day} className="flex-1 flex flex-col items-center gap-0.5 group min-w-[8px]">
                        <div className="relative w-full flex flex-col justify-end" style={{ height: '96px' }}>
                          {total > 0 && (
                            <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-bold text-[#1d1d1f] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap bg-white px-1 rounded shadow-sm z-10">
                              {fmt(day)}: {total}
                            </div>
                          )}
                          <div className="w-full bg-blue-500 rounded-t-sm transition-all"
                            style={{ height: `${Math.max(2, pct * 96)}px` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
                {/* Month labels for year view */}
                {days.length > 30 && (
                  <div className="flex gap-0.5">
                    {days.map((day, i) => {
                      const isFirst = i === 0 || day.slice(8, 10) === '01'
                      return (
                        <div key={day} className="flex-1 min-w-[8px]">
                          {isFirst && (
                            <p className="text-[9px] text-[#aeaeb2] whitespace-nowrap">
                              {new Date(day).toLocaleDateString('ru-RU', { month: 'short' })}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Detailed table */}
          <div className="bg-white rounded-2xl border border-[#e8e8ed] overflow-hidden mb-6">
            <div className="px-5 py-4 border-b border-[#f2f2f7]">
              <p className="text-[12px] font-semibold text-[#aeaeb2] uppercase tracking-wider">
                Сводная таблица
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#f2f2f7]">
                    <th className="text-left px-5 py-3 text-[11px] font-semibold text-[#aeaeb2] uppercase tracking-wider">Менеджер</th>
                    <th className="text-center px-3 py-3 text-[11px] font-semibold text-[#aeaeb2] uppercase">Получено</th>
                    <th className="text-center px-3 py-3 text-[11px] font-semibold text-[#aeaeb2] uppercase">В работе</th>
                    <th className="text-center px-3 py-3 text-[11px] font-semibold text-[#aeaeb2] uppercase">Выиграно</th>
                    <th className="text-center px-3 py-3 text-[11px] font-semibold text-[#aeaeb2] uppercase">Слито</th>
                    <th className="text-center px-3 py-3 text-[11px] font-semibold text-[#aeaeb2] uppercase">Конверсия</th>
                  </tr>
                </thead>
                <tbody>
                  {managers.map((m, i) => {
                    const closed = m.won + m.lost
                    const conv = closed > 0 ? Math.round((m.won / closed) * 100) : 0
                    const barWidth = Math.round((m.total / Math.max(1, managers[0].total)) * 100)
                    return (
                      <tr key={m.name} className={i % 2 === 0 ? 'bg-white' : 'bg-[#f9f9fb]'}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${DOT_COLOR[m.name] ?? 'bg-gray-400'}`} />
                            <span className="font-medium text-[#1d1d1f]">{m.name}</span>
                          </div>
                          <div className="mt-1.5 h-1 bg-[#f2f2f7] rounded-full overflow-hidden w-36">
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

          {/* Sources breakdown */}
          {data?.sources && Object.keys(data.sources).length > 0 && (() => {
            const sources = Object.entries(data.sources)
              .map(([name, s]) => ({ name, ...s }))
              .sort((a, b) => b.total - a.total)
            const maxTotal = sources[0]?.total ?? 1
            return (
              <div className="bg-white rounded-2xl border border-[#e8e8ed] overflow-hidden mb-6">
                <div className="px-5 py-4 border-b border-[#f2f2f7]">
                  <p className="text-[12px] font-semibold text-[#aeaeb2] uppercase tracking-wider">
                    По источникам
                  </p>
                </div>
                <div className="divide-y divide-[#f2f2f7]">
                  {sources.map(s => {
                    const closed = s.won + s.lost
                    const conv = closed > 0 ? Math.round((s.won / closed) * 100) : null
                    const pct = Math.round((s.total / maxTotal) * 100)
                    return (
                      <div key={s.name} className="px-5 py-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[13px] font-medium text-[#1d1d1f]">{s.name}</span>
                          <div className="flex items-center gap-3 text-[12px]">
                            <span className="font-bold text-[#1d1d1f]">{s.total}</span>
                            <span className="text-emerald-600">✓ {s.won}</span>
                            <span className="text-red-500">✗ {s.lost}</span>
                            <span className="text-[#aeaeb2]">● {s.active}</span>
                            {conv !== null && (
                              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                conv >= 50 ? 'bg-emerald-100 text-emerald-700' :
                                conv >= 25 ? 'bg-amber-100 text-amber-700' :
                                'bg-red-100 text-red-600'
                              }`}>{conv}%</span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-0.5 h-1.5 rounded-full overflow-hidden bg-[#f2f2f7]">
                          <div className="bg-emerald-400 h-full" style={{ width: `${s.total > 0 ? (s.won / s.total) * pct : 0}%` }} />
                          <div className="bg-[#aeaeb2] h-full" style={{ width: `${s.total > 0 ? (s.active / s.total) * pct : 0}%` }} />
                          <div className="bg-red-400 h-full" style={{ width: `${s.total > 0 ? (s.lost / s.total) * pct : 0}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Per-manager daily grid — last 14 days max for readability, or monthly for year */}
          {days.length > 1 && (
            <div className="bg-white rounded-2xl border border-[#e8e8ed] overflow-hidden">
              <div className="px-5 py-4 border-b border-[#f2f2f7]">
                <p className="text-[12px] font-semibold text-[#aeaeb2] uppercase tracking-wider">
                  {days.length > 60 ? 'По месяцам' : 'По дням'}
                </p>
              </div>
              <div className="overflow-x-auto">
                {days.length > 60 ? (
                  // Monthly aggregation for long periods
                  (() => {
                    const months: string[] = []
                    const seen = new Set<string>()
                    for (const d of days) {
                      const m = d.slice(0, 7)
                      if (!seen.has(m)) { seen.add(m); months.push(m) }
                    }
                    return (
                      <table className="text-[12px] w-full">
                        <thead>
                          <tr className="border-b border-[#f2f2f7]">
                            <th className="text-left px-5 py-2 text-[11px] font-semibold text-[#aeaeb2] sticky left-0 bg-white">Менеджер</th>
                            {months.map(m => (
                              <th key={m} className="text-center px-3 py-2 text-[10px] font-medium text-[#aeaeb2] whitespace-nowrap min-w-[56px]">
                                {new Date(m + '-01').toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' })}
                              </th>
                            ))}
                            <th className="text-center px-3 py-2 text-[11px] font-semibold text-[#aeaeb2]">Итого</th>
                          </tr>
                        </thead>
                        <tbody>
                          {managers.map((mgr, i) => (
                            <tr key={mgr.name} className={i % 2 === 0 ? 'bg-white' : 'bg-[#f9f9fb]'}>
                              <td className="px-5 py-2 font-medium text-[#1d1d1f] sticky left-0 bg-inherit whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                  <div className={`w-1.5 h-1.5 rounded-full ${DOT_COLOR[mgr.name] ?? 'bg-gray-400'}`} />
                                  {mgr.name}
                                </div>
                              </td>
                              {months.map(mon => {
                                const n = days
                                  .filter(d => d.startsWith(mon))
                                  .reduce((s, d) => s + (mgr.byDay[d] || 0), 0)
                                return (
                                  <td key={mon} className="px-3 py-2 text-center">
                                    {n > 0 ? (
                                      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-white text-[11px] font-bold ${COLORS[mgr.name] ?? 'bg-blue-500'}`}>
                                        {n}
                                      </span>
                                    ) : <span className="text-[#e8e8ed]">—</span>}
                                  </td>
                                )
                              })}
                              <td className="px-3 py-2 text-center font-bold text-[#1d1d1f]">{mgr.total}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  })()
                ) : (
                  // Daily grid for short periods
                  <table className="text-[12px] w-full">
                    <thead>
                      <tr className="border-b border-[#f2f2f7]">
                        <th className="text-left px-5 py-2 text-[11px] font-semibold text-[#aeaeb2] sticky left-0 bg-white">Менеджер</th>
                        {days.map(d => (
                          <th key={d} className="text-center px-1.5 py-2 text-[10px] font-medium text-[#aeaeb2] whitespace-nowrap min-w-[36px]">
                            {fmt(d)}
                          </th>
                        ))}
                        <th className="text-center px-3 py-2 text-[11px] font-semibold text-[#aeaeb2]">Итого</th>
                      </tr>
                    </thead>
                    <tbody>
                      {managers.map((mgr, i) => (
                        <tr key={mgr.name} className={i % 2 === 0 ? 'bg-white' : 'bg-[#f9f9fb]'}>
                          <td className="px-5 py-2 font-medium text-[#1d1d1f] sticky left-0 bg-inherit whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <div className={`w-1.5 h-1.5 rounded-full ${DOT_COLOR[mgr.name] ?? 'bg-gray-400'}`} />
                              {mgr.name}
                            </div>
                          </td>
                          {days.map(d => {
                            const n = mgr.byDay[d] || 0
                            return (
                              <td key={d} className="px-1.5 py-2 text-center">
                                {n > 0 ? (
                                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-[11px] font-bold ${COLORS[mgr.name] ?? 'bg-blue-500'}`}>
                                    {n}
                                  </span>
                                ) : <span className="text-[#e8e8ed]">—</span>}
                              </td>
                            )
                          })}
                          <td className="px-3 py-2 text-center font-bold text-[#1d1d1f]">{mgr.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
