'use client'

import { useEffect, useState, useCallback } from 'react'

// Активность пользователей: во сколько начинают/заканчивают и сколько времени в
// приложении (окно присутствия). Период: сегодня / неделя / месяц / конкретный день.

type Row = { name: string; role: string; days: number; start: string; end: string; avgHours: number; totalHours: number; lastActive: string }
type Period = 'today' | 'week' | 'month' | 'day'

const iso = (d: Date) => d.toISOString().slice(0, 10)
const today = () => iso(new Date())
const ROLE_LABEL: Record<string, string> = {
  admin: 'Админ', ceo: 'CEO', cfo: 'CFO', manager: 'Менеджер', buyer: 'Закупщик',
  production: 'Производство', partner: 'Партнёр', seo: 'SEO', commercial: 'Коммерч.',
}
const fmtLast = (s: string) => s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Сегодня' }, { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' }, { key: 'day', label: 'Конкретный день' },
]

export default function ActivityPage() {
  const [period, setPeriod] = useState<Period>('week')
  const [day, setDay] = useState(today())
  const [data, setData] = useState<{ from: string; to: string; rows: Row[] } | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const now = Date.now()
    const r = period === 'today' ? { from: today(), to: today() }
      : period === 'week' ? { from: iso(new Date(now - 6 * 86400000)), to: today() }
      : period === 'month' ? { from: iso(new Date(now - 29 * 86400000)), to: today() }
      : { from: day, to: day }
    try {
      const res = await fetch(`/api/admin/activity?from=${r.from}&to=${r.to}`)
      setData(await res.json() as { from: string; to: string; rows: Row[] })
    } finally { setLoading(false) }
  }, [period, day])

  useEffect(() => { void load() }, [load])

  const rows = data?.rows ?? []
  const maxTotal = Math.max(1, ...rows.map(r => r.totalHours))
  const singleDay = period === 'today' || period === 'day'

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-4">
          <h1 className="text-[18px] font-semibold text-[#111110]">Активность пользователей</h1>
          <p className="text-[12px] text-[#9a9a95] mt-0.5">Во сколько начинают и заканчивают, сколько времени в приложении. Московское время, точность ~5 минут.</p>
        </div>

        {/* Период */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <div className="flex gap-1 bg-white border border-[#e4e4e0] rounded-lg p-1">
            {PERIODS.map(p => (
              <button key={p.key} onClick={() => setPeriod(p.key)}
                className={`px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors ${period === p.key ? 'bg-[#111110] text-white' : 'text-[#6b6b66] hover:bg-[#f5f5f3]'}`}>
                {p.label}
              </button>
            ))}
          </div>
          {period === 'day' && (
            <input type="date" value={day} max={today()} onChange={e => setDay(e.target.value)}
              className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] bg-white outline-none focus:border-[#111110]" />
          )}
          {data && <span className="text-[12px] text-[#9a9a95] ml-auto">{data.from === data.to ? data.from : `${data.from} — ${data.to}`}</span>}
        </div>

        {/* Таблица */}
        <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
          {loading ? (
            <p className="text-[13px] text-[#9a9a95] text-center py-10">Загрузка…</p>
          ) : rows.length === 0 ? (
            <p className="text-[13px] text-[#9a9a95] text-center py-10">За этот период активности нет.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-[#9a9a95] border-b border-[#e4e4e0]">
                    <th className="text-left font-semibold px-4 py-2.5">Пользователь</th>
                    <th className="text-left font-semibold px-2 py-2.5">Роль</th>
                    {!singleDay && <th className="text-center font-semibold px-2 py-2.5">Дней</th>}
                    <th className="text-center font-semibold px-2 py-2.5">Начинает</th>
                    <th className="text-center font-semibold px-2 py-2.5">Заканчивает</th>
                    <th className="text-right font-semibold px-2 py-2.5">Ч/день</th>
                    {!singleDay && <th className="text-right font-semibold px-4 py-2.5">Всего</th>}
                    <th className="text-right font-semibold px-4 py-2.5">Посл. активность</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-[#f5f5f3] last:border-0 hover:bg-[#fafaf9]">
                      <td className="px-4 py-2.5 font-semibold text-[#111110]">{r.name}</td>
                      <td className="px-2 py-2.5 text-[#6b6b66]">{ROLE_LABEL[r.role] ?? r.role}</td>
                      {!singleDay && <td className="px-2 py-2.5 text-center text-[#6b6b66] tabular-nums">{r.days}</td>}
                      <td className="px-2 py-2.5 text-center font-mono text-[#111110]">{r.start}</td>
                      <td className="px-2 py-2.5 text-center font-mono text-[#111110]">{r.end}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{r.avgHours} ч</td>
                      {!singleDay && (
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-1.5 rounded-full bg-[#111110]" style={{ width: `${Math.round((r.totalHours / maxTotal) * 60)}px` }} />
                            <span className="font-semibold tabular-nums w-14 text-right">{r.totalHours} ч</span>
                          </div>
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-right text-[11px] text-[#9a9a95] whitespace-nowrap">{fmtLast(r.lastActive)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-[11px] text-[#b0b0aa] mt-2">«Ч/день» и «Всего» — окно присутствия (первый заход → последний за день), а не чистое активное время: открытая вкладка тоже считается. Точность ~5 минут.</p>
      </div>
    </div>
  )
}
