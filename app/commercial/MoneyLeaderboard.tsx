'use client'

import { useEffect, useState } from 'react'

type Manager = {
  name: string; revenue: number; deals: number; avgCheck: number; avgMargin: number
  b2bRevenue: number; b2cRevenue: number
}
type Data = { month: string; managers: Manager[]; totals: { revenue: number; deals: number; avgCheck: number; avgMargin: number } }

const fmt  = (n: number) => n.toLocaleString('ru-RU') + ' ₽'
const fmtK = (n: number) => n >= 1000 ? (n / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + 'к ₽' : n + ' ₽'

// Пороги маржи из PROJECT_RULES: красный <25%, амбер 25–35%, зелёный ≥35%.
function marginColor(m: number): string {
  if (m <= 0) return 'text-[#c4c4be]'
  if (m < 25) return 'text-red-500'
  if (m < 35) return 'text-amber-500'
  return 'text-emerald-600'
}

const MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь']

export function MoneyLeaderboard() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(false)

  useEffect(() => {
    fetch('/api/commercial/money')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: Data) => setData(d))
      .catch(() => setErr(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="bg-white border border-[#e4e4e0] rounded-xl px-5 py-4 mb-5 text-[12px] text-[#9a9a95]">Загрузка продаж…</div>
  if (err || !data) return null

  const monthLabel = (() => {
    const [y, m] = data.month.split('-')
    return `${MONTHS[Number(m) - 1] ?? ''} ${y}`
  })()

  const max = Math.max(1, ...data.managers.map(m => m.revenue))

  return (
    <div className="mb-6">
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <h2 className="text-[14px] font-semibold text-[#111110]">💰 Продажи и маржа <span className="text-[#9a9a95] font-normal">· {monthLabel}</span></h2>
        <span className="text-[11px] text-[#c4c4be]">B2B заказы + B2C одобренные просчёты</span>
      </div>

      {/* Итоги команды */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Выручка',       value: fmt(data.totals.revenue) },
          { label: 'Сделок',        value: String(data.totals.deals) },
          { label: 'Средний чек',   value: fmt(data.totals.avgCheck) },
          { label: 'Средняя маржа', value: data.totals.avgMargin + '%', color: marginColor(data.totals.avgMargin) },
        ].map(k => (
          <div key={k.label} className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-1">{k.label}</p>
            <p className={`text-[18px] font-bold font-mono leading-none ${k.color ?? 'text-[#111110]'}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Лидерборд */}
      {data.managers.length === 0 ? (
        <div className="bg-white border border-[#e4e4e0] rounded-xl px-5 py-6 text-center text-[12px] text-[#9a9a95]">
          В этом месяце ещё нет подтверждённых продаж.
        </div>
      ) : (
        <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-[#f7f7f5] border-b border-[#e4e4e0] text-[#9a9a95] text-[11px] uppercase tracking-wider">
                  <th className="text-left px-4 py-2.5 font-semibold">Менеджер</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Выручка</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Сделок</th>
                  <th className="text-right px-3 py-2.5 font-semibold">Ср. чек</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Маржа</th>
                </tr>
              </thead>
              <tbody>
                {data.managers.map((m, i) => (
                  <tr key={m.name} className="border-b border-[#f0f0ec] last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`w-5 text-center text-[11px] font-bold ${i === 0 ? 'text-amber-500' : 'text-[#c4c4be]'}`}>{i + 1}</span>
                        <div>
                          <div className="font-semibold text-[#111110]">{m.name}</div>
                          <div className="h-1 mt-1 rounded-full bg-[#f0f0ec] w-[120px] overflow-hidden">
                            <div className="h-full bg-[#111110]" style={{ width: `${Math.round(m.revenue / max * 100)}%` }} />
                          </div>
                          <div className="text-[10px] text-[#c4c4be] mt-0.5">
                            B2B {fmtK(m.b2bRevenue)} · B2C {fmtK(m.b2cRevenue)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-[#111110]">{fmt(m.revenue)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-[#6b6b66]">{m.deals}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-[#6b6b66]">{fmt(m.avgCheck)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono font-semibold ${marginColor(m.avgMargin)}`}>{m.avgMargin > 0 ? m.avgMargin + '%' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
