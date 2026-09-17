'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { shiftMonth } from '@/lib/sales/period'
import type { StatRow } from '@/lib/sales/managerStats'

// Третий срез продаж: не сделки (воронка) и не заказы (реестр), а работа
// менеджера за период — разговоры, замеры, оплаты и полученные деньги.
// Источник — управленческая книга владельца, догоняется скриптом в свою таблицу,
// поэтому здесь доступен любой период, а не только открытые месяцы листа.

type PeriodMode = 'month' | 'quarter' | 'year' | 'range'
type Query = { mode: PeriodMode; month: string; from: string; to: string; managers: string[] }
type Data = {
  rows: StatRow[]; totals: StatRow
  period: { mode: PeriodMode; from: string; to: string; label: string }
  month: string; daysWithData: number; updatedAt: string | null; lastDay: string | null
  canAll: boolean
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const num = (n: number) => Math.round(n).toLocaleString('ru-RU')
const conv = (v: number | null) => (v == null ? '—' : `${v}%`)
const day = (d: string | null) => (d ? d.split('-').reverse().join('.') : '—')
const START: Query = { mode: 'month', month: '', from: '', to: '', managers: [] }

export default function ManagerStatsPage() {
  const [d, setD] = useState<Data | null>(null)
  const [q, setQ] = useState<Query>(START)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (next: Query) => {
    setLoading(true)
    setQ(next)
    try {
      const p = new URLSearchParams()
      if (next.mode === 'range') { if (next.from) p.set('from', next.from); if (next.to) p.set('to', next.to) }
      else { p.set('mode', next.mode); if (next.month) p.set('month', next.month) }
      if (next.managers.length) p.set('managers', next.managers.join(','))
      const r = await fetch('/api/manager-stats?' + p.toString())
      const j = await r.json()
      if (r.ok) {
        setD(j)
        setQ(cur => ({ ...cur, month: j.month ?? cur.month, from: j.period?.from ?? cur.from, to: j.period?.to ?? cur.to }))
      }
    } finally { setLoading(false) }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(START) }, [load])

  const modeBtn = (m: PeriodMode) =>
    `px-3 py-1.5 rounded-lg text-[12px] font-medium border ${q.mode === m ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110]'}`
  const tile = 'bg-white border border-[#e4e4e0] rounded-xl px-4 py-3'
  const rows = d?.rows ?? []
  const t = d?.totals
  const gap = rows.some(r => r.moneyGap !== 0)

  return (
    <div className="min-h-screen bg-[#f8f8f7] pb-20">
      <div className="max-w-[1200px] mx-auto px-4 py-5">
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <h1 className="text-[18px] font-semibold text-[#111110]">🏆 Показатели менеджеров</h1>
          <Link href="/crm" className="text-[12px] text-[#0071e3] hover:underline">→ Воронка</Link>
          <Link href="/sales" className="text-[12px] text-[#0071e3] hover:underline">→ Реестр продаж</Link>
        </div>

        {/* Период — тот же, что в реестре продаж: месяц, квартал, год или свои даты. */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <div className="flex items-center gap-1.5">
            <button onClick={() => load({ ...q, mode: q.mode === 'range' ? 'month' : q.mode, month: shiftMonth(q.month || '', -1) })}
              disabled={!q.month} className="w-8 h-8 rounded-lg border border-[#e4e4e0] bg-white text-[#6b6b66] hover:bg-[#f5f5f3] disabled:opacity-40">‹</button>
            <span className="text-[13px] font-semibold text-[#111110] min-w-[190px] text-center">{d?.period.label ?? '…'}</span>
            <button onClick={() => load({ ...q, mode: q.mode === 'range' ? 'month' : q.mode, month: shiftMonth(q.month || '', 1) })}
              disabled={!q.month} className="w-8 h-8 rounded-lg border border-[#e4e4e0] bg-white text-[#6b6b66] hover:bg-[#f5f5f3] disabled:opacity-40">›</button>
          </div>
          <button className={modeBtn('month')} onClick={() => load({ ...q, mode: 'month' })}>Месяц</button>
          <button className={modeBtn('quarter')} onClick={() => load({ ...q, mode: 'quarter' })}>Квартал</button>
          <button className={modeBtn('year')} onClick={() => load({ ...q, mode: 'year' })}>Год</button>
          <div className="flex items-center gap-1.5">
            <input type="date" value={q.from} onChange={e => setQ({ ...q, from: e.target.value })}
              className="border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] bg-white outline-none focus:border-[#111110]" />
            <span className="text-[12px] text-[#9a9a95]">—</span>
            <input type="date" value={q.to} onChange={e => setQ({ ...q, to: e.target.value })}
              className="border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] bg-white outline-none focus:border-[#111110]" />
            <button className={modeBtn('range')} onClick={() => load({ ...q, mode: 'range' })} disabled={!q.from || !q.to}>Период</button>
          </div>
        </div>

        {/* Менеджеры: все, несколько или один */}
        {d?.canAll && rows.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-4">
            <button onClick={() => load({ ...q, managers: [] })}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border ${q.managers.length === 0 ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110]'}`}>
              Все менеджеры
            </button>
            {rows.map(r => (
              <button key={r.manager}
                onClick={() => load({ ...q, managers: q.managers.includes(r.manager) ? q.managers.filter(m => m !== r.manager) : [...q.managers, r.manager] })}
                className={`px-3 py-1.5 rounded-lg text-[12px] border ${q.managers.includes(r.manager) ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110]'}`}>
                {r.manager}
              </button>
            ))}
          </div>
        )}

        {/* Итоги периода */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className={tile}><p className="text-[11px] text-[#9a9a95] uppercase tracking-wide">Разговоры</p><p className="text-[20px] font-bold text-[#111110] mt-0.5">{num(t?.talks ?? 0)}</p></div>
          <div className={tile}>
            <p className="text-[11px] text-[#9a9a95] uppercase tracking-wide">Замеры</p>
            <p className="text-[20px] font-bold text-[#111110] mt-0.5">{num(t?.measure_done ?? 0)}</p>
            <p className="text-[11px] text-[#c4c4be] mt-0.5">проведено из {num(t?.measure_assigned ?? 0)} назначенных</p>
          </div>
          <div className={tile}>
            <p className="text-[11px] text-[#9a9a95] uppercase tracking-wide">Оплат</p>
            <p className="text-[20px] font-bold text-[#111110] mt-0.5">{num(t?.payments ?? 0)}</p>
            <p className="text-[11px] text-[#c4c4be] mt-0.5">средняя предоплата {fmt(t?.avgCheck ?? 0)}</p>
          </div>
          <div className={tile}>
            <p className="text-[11px] text-[#9a9a95] uppercase tracking-wide">Получено денег</p>
            <p className="text-[20px] font-bold text-emerald-700 mt-0.5">{fmt(t?.money_total ?? 0)}</p>
            <p className="text-[11px] text-[#c4c4be] mt-0.5">предоплаты {fmt(t?.prepay ?? 0)} + остатки {fmt(t?.remainder ?? 0)}</p>
          </div>
        </div>

        {/* Таблица по менеджерам */}
        <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-[13px]">
              <thead>
                <tr className="bg-[#f7f7f5] border-b border-[#e4e4e0] text-[#9a9a95] text-[11px] uppercase">
                  <th className="text-left font-medium px-3 py-2">Менеджер</th>
                  <th className="text-right font-medium px-3 py-2">Разговоры</th>
                  <th className="text-right font-medium px-3 py-2">Замер назначен</th>
                  <th className="text-right font-medium px-3 py-2">Замер проведён</th>
                  <th className="text-right font-medium px-3 py-2">Оплат</th>
                  <th className="text-right font-medium px-3 py-2">Предоплаты</th>
                  <th className="text-right font-medium px-3 py-2">Остатки</th>
                  <th className="text-right font-medium px-3 py-2">Всего денег</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={8} className="px-3 py-6 text-center text-[#9a9a95]">Загрузка…</td></tr>}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-[#c4c4be]">
                    За {d?.period.label ?? 'период'} показателей нет. Данные приходят из управленческой книги — обновите импорт.
                  </td></tr>
                )}
                {rows.map(r => (
                  <tr key={r.manager} className="border-b border-[#f0f0ec] last:border-0 hover:bg-[#fafaf9]">
                    <td className="px-3 py-2 font-medium text-[#111110] whitespace-nowrap">{r.manager}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#6b6b66]">{num(r.talks)}</td>
                    {/* Рядом с числом — конверсия из предыдущего шага: столбик без неё
                        не говорит, много это или мало. */}
                    <td className="px-3 py-2 text-right font-mono text-[#6b6b66]">{num(r.measure_assigned)} <span className="text-[11px] text-[#c4c4be]">{conv(r.toMeasure)}</span></td>
                    <td className="px-3 py-2 text-right font-mono text-[#6b6b66]">{num(r.measure_done)} <span className="text-[11px] text-[#c4c4be]">{conv(r.toDone)}</span></td>
                    <td className="px-3 py-2 text-right font-mono text-[#6b6b66]">{num(r.payments)} <span className="text-[11px] text-[#c4c4be]">{conv(r.toPayment)}</span></td>
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{fmt(r.prepay)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{fmt(r.remainder)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-700 whitespace-nowrap">
                      {fmt(r.money_total)}
                      {r.moneyGap !== 0 && <span title={`Предоплаты + остатки = ${fmt(r.moneySum)}`} className="ml-1 text-amber-600">⚠</span>}
                    </td>
                  </tr>
                ))}
                {rows.length > 0 && t && (
                  <tr className="bg-[#fafaf9] border-t border-[#e4e4e0] font-semibold">
                    <td className="px-3 py-2 text-[#111110]">Итого{q.managers.length ? ` (${q.managers.join(', ')})` : ''}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{num(t.talks)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{num(t.measure_assigned)} <span className="text-[11px] text-[#9a9a95]">{conv(t.toMeasure)}</span></td>
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{num(t.measure_done)} <span className="text-[11px] text-[#9a9a95]">{conv(t.toDone)}</span></td>
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{num(t.payments)} <span className="text-[11px] text-[#9a9a95]">{conv(t.toPayment)}</span></td>
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{fmt(t.prepay)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{fmt(t.remainder)}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-700">{fmt(t.money_total)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-[#c4c4be]">
          Источник — управленческая книга владельца, лист «Аналитика дохода»: {d?.daysWithData ?? 0} дней с данными в периоде,
          последний день в базе — {day(d?.lastDay ?? null)}. Проценты рядом с числом — конверсия из предыдущего шага
          (разговор → назначен → проведён → оплата). «Всего денег» книга ведёт отдельной строкой;
          {gap ? ' ⚠ у отмеченных она не сходится с суммой предоплат и остатков.' : ' у всех сходится с суммой предоплат и остатков.'}
        </p>
      </div>
    </div>
  )
}
