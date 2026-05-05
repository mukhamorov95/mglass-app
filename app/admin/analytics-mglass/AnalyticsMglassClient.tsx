'use client'

import { useState } from 'react'
import type { CalcRow, UserRow } from './page'

type Props = {
  calcs: CalcRow[]
  users: UserRow[]
}

// Исторические данные из управленческой таблицы (поступления)
const HISTORICAL: Record<string, Record<string, Record<number, number>>> = {
  'Айжан': {
    '2025': { 1:1_977_618, 2:3_178_170, 3:1_590_655, 4:2_926_817, 5:2_014_515, 6:2_438_655, 7:3_241_925, 8:2_314_911, 9:3_602_649, 10:2_604_494, 11:2_800_473, 12:4_713_493 },
    '2026': { 1:1_166_948, 2:1_876_002, 3:1_038_240, 4:1_196_700 },
  },
  'Саша': {
    '2025': { 1:1_908_277, 2:1_892_138, 3:1_825_308, 4:1_545_944, 5:1_487_184, 6:1_067_319, 7:2_129_625, 8:2_387_677, 9:1_966_135, 10:1_556_068, 11:1_586_593, 12:1_872_261 },
    '2026': { 1:648_873,   2:1_013_131, 3:1_695_584, 4:1_771_022 },
  },
  'Яна': {
    '2025': { 1:403_354, 2:545_814, 3:1_608_377, 4:668_168, 5:1_371_730, 6:792_211, 7:1_405_965, 8:1_571_818, 9:2_003_328, 10:2_066_970, 11:1_273_830, 12:1_847_037 },
    '2026': { 1:759_445, 2:272_022, 3:548_997, 4:1_126_160 },
  },
  'Влад': {
    '2025': { 1:225_050, 3:8_000, 5:232_610, 9:510_450, 12:273_268 },
    '2026': { 4:830_950 },
  },
  'Семён': {
    '2025': {},
    '2026': { 4:271_000 },
  },
  'Дима': {
    '2025': {},
    '2026': { 2:111_866, 3:124_953, 4:366_487 },
  },
}

const MONTH_NAMES = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

function fmt(n: number) {
  if (n === 0) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'k'
  return n.toLocaleString('ru-RU')
}

function fmtFull(n: number) {
  return n.toLocaleString('ru-RU') + ' ₽'
}

type StatusFilter = 'approved' | 'all'

function buildMatrix(
  calcs: CalcRow[],
  users: UserRow[],
  year: number,
  statusFilter: StatusFilter,
) {
  const filtered = calcs.filter(c => {
    const y = new Date(c.created_at).getFullYear()
    if (y !== year) return false
    if (statusFilter === 'approved') return c.status === 'approved'
    return c.status !== 'rejected'
  })

  // Determine which months have data
  const months = year === new Date().getFullYear()
    ? Array.from({ length: new Date().getMonth() + 1 }, (_, i) => i)
    : Array.from({ length: 12 }, (_, i) => i)

  // Build userId → revenue per month map
  const userMonthMap: Record<string, Record<number, number>> = {}
  for (const c of filtered) {
    const m = new Date(c.created_at).getMonth()
    if (!userMonthMap[c.created_by]) userMonthMap[c.created_by] = {}
    userMonthMap[c.created_by][m] = (userMonthMap[c.created_by][m] ?? 0) + c.final_price
  }

  // Only include users who have data this year
  const activeUsers = users.filter(u => userMonthMap[u.id])
  // Sort by yearly total descending
  activeUsers.sort((a, b) => {
    const ta = Object.values(userMonthMap[a.id] ?? {}).reduce((s, v) => s + v, 0)
    const tb = Object.values(userMonthMap[b.id] ?? {}).reduce((s, v) => s + v, 0)
    return tb - ta
  })

  // Monthly totals (all users combined)
  const monthTotals: Record<number, number> = {}
  for (const m of months) {
    monthTotals[m] = activeUsers.reduce((s, u) => s + (userMonthMap[u.id]?.[m] ?? 0), 0)
  }

  return { activeUsers, userMonthMap, months, monthTotals }
}

export default function AnalyticsMglassClient({ calcs, users }: Props) {
  const [year, setYear] = useState<2025 | 2026>(2026)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('approved')

  const { activeUsers, userMonthMap, months, monthTotals } = buildMatrix(calcs, users, year, statusFilter)

  const grandTotal = Object.values(monthTotals).reduce((s, v) => s + v, 0)

  // Итого по историческим данным для карточек
  const historicalSummary = ([2025, 2026] as const).map(y => {
    const yStr = String(y)
    const byManager: Record<string, number> = {}
    let total = 0
    for (const [name, years] of Object.entries(HISTORICAL)) {
      const sum = Object.values(years[yStr] ?? {}).reduce((a, b) => a + b, 0)
      byManager[name] = sum
      total += sum
    }
    return { year: y, total, byManager }
  })

  function userName(u: UserRow) {
    return u.name ?? u.email.split('@')[0]
  }

  function tierColor(revenue: number) {
    if (revenue >= 4_000_000) return 'text-emerald-700 font-bold'
    if (revenue >= 3_000_000) return 'text-amber-700 font-semibold'
    if (revenue >= 2_000_000) return 'text-blue-700 font-semibold'
    if (revenue > 0) return 'text-[#4b4b47]'
    return 'text-[#d4d4d0]'
  }

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[1100px] mx-auto px-4 py-4 space-y-4">

        {/* Шапка */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-sm font-semibold text-[#111110]">Аналитика МГласс</h1>
            <p className="text-[10px] text-[#9a9a95] mt-0.5">Выручка по менеджерам</p>
          </div>
          <div className="flex gap-1.5">
            {/* Статус */}
            <div className="flex gap-1 bg-white border border-[#e4e4e0] rounded-lg p-0.5">
              {(['approved', 'all'] as StatusFilter[]).map(s => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    statusFilter === s ? 'bg-[#111110] text-white' : 'text-[#6b6b66] hover:bg-[#f5f5f3]'
                  }`}>
                  {s === 'approved' ? 'Принятые' : 'Все'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Карточки — итого по годам */}
        <div className="grid grid-cols-2 gap-3">
          {historicalSummary.map(ys => (
            <div key={ys.year}
              className={`bg-white rounded-lg border px-4 py-3 cursor-pointer transition-all ${
                year === ys.year ? 'border-[#111110] shadow-sm' : 'border-[#e4e4e0] hover:border-[#9a9a95]'
              }`}
              onClick={() => setYear(ys.year as 2025 | 2026)}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">
                  {ys.year} год{ys.year === 2026 ? ' (янв–апр)' : ''}
                </p>
                {year === ys.year && <span className="text-[9px] bg-[#111110] text-white px-1.5 py-0.5 rounded">Выбран</span>}
              </div>
              <p className="text-2xl font-bold font-mono text-[#111110]">{fmtFull(ys.total)}</p>
            </div>
          ))}
        </div>

        {/* Таблица по месяцам */}
        <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#e4e4e0] flex items-center justify-between">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">
              {year} — по месяцам
            </p>
            <p className="text-xs font-mono font-semibold text-[#111110]">{fmtFull(grandTotal)}</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-[#fafaf9]">
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wider border-b border-[#e4e4e0] w-28 sticky left-0 bg-[#fafaf9]">
                    Менеджер
                  </th>
                  {months.map(m => (
                    <th key={m} className="px-2 py-2 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wider border-b border-[#e4e4e0] text-right whitespace-nowrap">
                      {MONTH_NAMES[m]}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-[10px] font-semibold text-emerald-700 uppercase tracking-wider border-b border-[#e4e4e0] text-right whitespace-nowrap sticky right-0 bg-[#fafaf9]">
                    Итого
                  </th>
                </tr>
              </thead>
              <tbody>
                {activeUsers.map((u, idx) => {
                  const userTotal = months.reduce((s, m) => s + (userMonthMap[u.id]?.[m] ?? 0), 0)
                  return (
                    <tr key={u.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-[#fafaf9]/50'}>
                      <td className={`px-3 py-2 font-medium text-[#111110] border-b border-[#f5f5f3] sticky left-0 ${idx % 2 === 0 ? 'bg-white' : 'bg-[#fafaf9]/50'}`}>
                        {userName(u)}
                      </td>
                      {months.map(m => {
                        const v = userMonthMap[u.id]?.[m] ?? 0
                        return (
                          <td key={m} className={`px-2 py-2 text-right border-b border-[#f5f5f3] font-mono whitespace-nowrap ${tierColor(v)}`}>
                            {fmt(v)}
                          </td>
                        )
                      })}
                      <td className="px-3 py-2 text-right border-b border-[#f5f5f3] font-mono font-bold text-emerald-700 whitespace-nowrap sticky right-0 bg-white">
                        {fmtFull(userTotal)}
                      </td>
                    </tr>
                  )
                })}

                {/* Строка итого */}
                <tr className="bg-[#fafaf9] border-t border-[#e4e4e0]">
                  <td className="px-3 py-2 font-semibold text-[#4b4b47] sticky left-0 bg-[#fafaf9]">Итого</td>
                  {months.map(m => (
                    <td key={m} className="px-2 py-2 text-right font-mono font-semibold text-[#111110] whitespace-nowrap">
                      {fmt(monthTotals[m] ?? 0)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700 whitespace-nowrap sticky right-0 bg-[#fafaf9]">
                    {fmtFull(grandTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Легенда тиров */}
          <div className="px-4 py-2 border-t border-[#e4e4e0] flex gap-4">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
              <span className="text-[10px] text-[#9a9a95]">4M+ (тир 5%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
              <span className="text-[10px] text-[#9a9a95]">3–4M (тир 4%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
              <span className="text-[10px] text-[#9a9a95]">2–3M (тир 3%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-gray-400 flex-shrink-0" />
              <span className="text-[10px] text-[#9a9a95]">до 2M (тир 2%)</span>
            </div>
          </div>
        </div>

        {activeUsers.length === 0 && (
          <div className="bg-white rounded-lg border border-[#e4e4e0] p-8 text-center">
            <p className="text-xs text-[#9a9a95]">Нет данных за {year} год</p>
            <p className="text-[10px] text-[#c4c4be] mt-1">Расчёты появятся здесь по мере сохранения заказов</p>
          </div>
        )}

        {/* Исторические поступления из управленческой таблицы */}
        <HistoricalTable year={year} />

      </div>
    </div>
  )
}

function HistoricalTable({ year }: { year: 2025 | 2026 }) {
  const yearStr = String(year)
  const managers = Object.keys(HISTORICAL)

  const months = year === 2026
    ? [1, 2, 3, 4]
    : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

  function val(manager: string, month: number) {
    return HISTORICAL[manager]?.[yearStr]?.[month] ?? 0
  }

  function userTotal(manager: string) {
    return months.reduce((s, m) => s + val(manager, m), 0)
  }

  function monthTotal(month: number) {
    return managers.reduce((s, mg) => s + val(mg, month), 0)
  }

  const grandTotal = managers.reduce((s, mg) => s + userTotal(mg), 0)

  // Yearly totals for summary
  const year2025Total = managers.reduce((s, mg) => s + Object.values(HISTORICAL[mg]?.['2025'] ?? {}).reduce((a, b) => a + b, 0), 0)
  const year2026Total = managers.reduce((s, mg) => s + Object.values(HISTORICAL[mg]?.['2026'] ?? {}).reduce((a, b) => a + b, 0), 0)

  function tierColor(revenue: number) {
    if (revenue >= 4_000_000) return 'text-emerald-700 font-bold'
    if (revenue >= 3_000_000) return 'text-amber-700 font-semibold'
    if (revenue >= 2_000_000) return 'text-blue-700 font-semibold'
    if (revenue > 0) return 'text-[#4b4b47]'
    return 'text-[#d4d4d0]'
  }

  function fmt(n: number) {
    if (n === 0) return '—'
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
    if (n >= 1_000) return (n / 1_000).toFixed(0) + 'k'
    return n.toLocaleString('ru-RU')
  }

  function fmtFull(n: number) {
    return n.toLocaleString('ru-RU') + ' ₽'
  }

  return (
    <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#e4e4e0]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">
              Поступления — управленческая таблица
            </p>
            <p className="text-[10px] text-[#c4c4be] mt-0.5">фактические оплаты из CRM</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-mono font-bold text-[#111110]">{fmtFull(grandTotal)}</p>
            <p className="text-[10px] text-[#9a9a95]">{year} год</p>
          </div>
        </div>

        {/* Итого по годам */}
        <div className="flex gap-4 mt-2 pt-2 border-t border-[#f5f5f3]">
          <div>
            <p className="text-[10px] text-[#9a9a95]">2025 всего</p>
            <p className="text-sm font-bold font-mono text-[#111110]">{fmtFull(year2025Total)}</p>
          </div>
          <div>
            <p className="text-[10px] text-[#9a9a95]">2026 янв–апр</p>
            <p className="text-sm font-bold font-mono text-[#111110]">{fmtFull(year2026Total)}</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-[10px] text-[#9a9a95]">2025+2026</p>
            <p className="text-sm font-bold font-mono text-emerald-700">{fmtFull(year2025Total + year2026Total)}</p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse min-w-[600px]">
          <thead>
            <tr className="bg-[#fafaf9]">
              <th className="text-left px-3 py-2 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wider border-b border-[#e4e4e0] sticky left-0 bg-[#fafaf9]">
                Менеджер
              </th>
              {months.map(m => (
                <th key={m} className="px-2 py-2 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wider border-b border-[#e4e4e0] text-right whitespace-nowrap">
                  {MONTH_NAMES[m - 1]}
                </th>
              ))}
              <th className="px-3 py-2 text-[10px] font-semibold text-emerald-700 uppercase tracking-wider border-b border-[#e4e4e0] text-right sticky right-0 bg-[#fafaf9]">
                Итого
              </th>
            </tr>
          </thead>
          <tbody>
            {managers.map((mg, idx) => (
              <tr key={mg} className={idx % 2 === 0 ? 'bg-white' : 'bg-[#fafaf9]/50'}>
                <td className={`px-3 py-2 font-medium text-[#111110] border-b border-[#f5f5f3] sticky left-0 ${idx % 2 === 0 ? 'bg-white' : 'bg-[#fafaf9]/50'}`}>
                  {mg}
                </td>
                {months.map(m => {
                  const v = val(mg, m)
                  return (
                    <td key={m} className={`px-2 py-2 text-right border-b border-[#f5f5f3] font-mono whitespace-nowrap ${tierColor(v)}`}>
                      {fmt(v)}
                    </td>
                  )
                })}
                <td className="px-3 py-2 text-right border-b border-[#f5f5f3] font-mono font-bold text-emerald-700 whitespace-nowrap sticky right-0 bg-white">
                  {fmtFull(userTotal(mg))}
                </td>
              </tr>
            ))}

            {/* Итого по месяцам */}
            <tr className="bg-[#fafaf9] border-t border-[#e4e4e0]">
              <td className="px-3 py-2 font-semibold text-[#4b4b47] sticky left-0 bg-[#fafaf9]">Итого</td>
              {months.map(m => (
                <td key={m} className="px-2 py-2 text-right font-mono font-semibold text-[#111110] whitespace-nowrap">
                  {fmt(monthTotal(m))}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700 whitespace-nowrap sticky right-0 bg-[#fafaf9]">
                {fmtFull(grandTotal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Итого по каждому за оба года */}
      <div className="px-4 py-3 border-t border-[#e4e4e0] bg-[#fafaf9]">
        <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2">Итого за 2025+2026</p>
        <div className="grid grid-cols-4 gap-2">
          {managers.map(mg => {
            const total25 = Object.values(HISTORICAL[mg]?.['2025'] ?? {}).reduce((a, b) => a + b, 0)
            const total26 = Object.values(HISTORICAL[mg]?.['2026'] ?? {}).reduce((a, b) => a + b, 0)
            return (
              <div key={mg} className="bg-white rounded-lg border border-[#e4e4e0] px-3 py-2">
                <p className="text-xs font-semibold text-[#111110]">{mg}</p>
                <p className="text-base font-bold font-mono text-emerald-700 mt-0.5">{fmtFull(total25 + total26)}</p>
                <div className="mt-1 space-y-0.5">
                  <div className="flex justify-between">
                    <span className="text-[10px] text-[#9a9a95]">2025</span>
                    <span className="text-[10px] font-mono text-[#4b4b47]">{fmtFull(total25)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[10px] text-[#9a9a95]">2026</span>
                    <span className="text-[10px] font-mono text-[#4b4b47]">{fmtFull(total26)}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
