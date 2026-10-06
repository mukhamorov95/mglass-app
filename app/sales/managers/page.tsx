'use client'

import { Fragment, useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { shiftMonth } from '@/lib/sales/period'
import type { DayLine, StatRow } from '@/lib/sales/managerStats'

// Третий срез продаж: не сделки (воронка) и не заказы (реестр), а работа
// менеджера за период — разговоры, замеры, оплаты и полученные деньги.
// Источник — управленческая книга владельца, догоняется скриптом в свою таблицу,
// поэтому здесь доступен любой период, а не только открытые месяцы листа.

type PeriodMode = 'month' | 'quarter' | 'year' | 'range'
type Query = { mode: PeriodMode; month: string; from: string; to: string; managers: string[] }
type BookNote = {
  month: string; manager: string; metric: string
  book: number | null; days: number; value: number; kind: string; text: string
}
type Data = {
  rows: StatRow[]; totals: StatRow
  period: { mode: PeriodMode; from: string; to: string; label: string }
  month: string; wholeMonths: string[]; partialDays: [string, string][]
  bookNotes: BookNote[]
  updatedAt: string | null; lastDay: string | null
  canAll: boolean
}

const METRIC_LABEL: Record<string, string> = {
  talks: 'разговоры', measure_assigned: 'замер назначен', measure_done: 'замер проведён',
  payments: 'оплат', prepay: 'предоплаты', remainder: 'остатки', money_total: 'всего денег',
}
const MONEY = new Set(['prepay', 'remainder', 'money_total'])
const MONTHS_RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const monthRu = (ym: string) => `${MONTHS_RU[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const num = (n: number) => Math.round(n).toLocaleString('ru-RU')
const conv = (v: number | null) => (v == null ? '—' : `${v}%`)
const TO_MEASURE = 'Назначено замеров на 100 разговоров того же периода'
const NO_SHARE_DONE = 'Без процента от назначенных: проводят и замеры, назначенные в прошлом месяце, — доля выходила за 100 %'
const NO_SHARE_PAID = 'Без процента от замеров: оплаты периода идут и по замерам прошлых месяцев, и по сделкам без замера — доля доходила до 500 %'
const day = (d: string | null) => (d ? d.split('-').reverse().join('.') : '—')
const START: Query = { mode: 'month', month: '', from: '', to: '', managers: [] }
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const dayLabel = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS_GEN[Number(d.slice(5, 7)) - 1]}, ${WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]}`
type DaysState = { lines?: DayLine[]; error?: string }

export default function ManagerStatsPage() {
  const [d, setD] = useState<Data | null>(null)
  const [q, setQ] = useState<Query>(START)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<string | null>(null)
  const [days, setDays] = useState<Record<string, DaysState>>({})

  const load = useCallback(async (next: Query) => {
    setLoading(true)
    setOpen(null)
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

  useEffect(() => { void load(START) }, [load])

  // Раскрытие менеджера: деньги по дням того же периода, что и таблица.
  const daysKey = (manager: string) => `${manager}|${d?.period.from}|${d?.period.to}`
  const toggle = async (manager: string) => {
    if (!d) return
    if (open === manager) { setOpen(null); return }
    setOpen(manager)
    const key = daysKey(manager)
    if (days[key]?.lines) return
    setDays(cur => ({ ...cur, [key]: {} }))
    try {
      const r = await fetch('/api/manager-stats/days?' + new URLSearchParams({ manager, from: d.period.from, to: d.period.to }))
      const j = await r.json()
      setDays(cur => ({ ...cur, [key]: r.ok ? { lines: j.lines } : { error: j.error ?? `ошибка ${r.status}` } }))
    } catch (e) {
      setDays(cur => ({ ...cur, [key]: { error: (e as Error).message } }))
    }
  }

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
          <Link href="/sales" className="text-[12px] text-[#0071e3] hover:underline">→ Продажи M-Glass</Link>
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
            <p className="text-[11px] text-[#c4c4be] mt-0.5">проведено · назначено {num(t?.measure_assigned ?? 0)}</p>
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
                  <th className="text-right font-medium px-3 py-2" title={NO_SHARE_DONE}>Замер проведён</th>
                  <th className="text-right font-medium px-3 py-2" title={NO_SHARE_PAID}>Оплат</th>
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
                  <Fragment key={r.manager}>
                  <tr className={`border-b border-[#f0f0ec] last:border-0 hover:bg-[#fafaf9] ${open === r.manager ? 'bg-[#fafaf9]' : ''}`}>
                    <td className="px-3 py-2 font-medium text-[#111110] whitespace-nowrap">
                      <button onClick={() => toggle(r.manager)} aria-expanded={open === r.manager} title="Деньги по дням"
                        className="inline-flex items-center gap-1 hover:text-[#0071e3]">
                        <span className={`inline-block w-3 text-[#9a9a95] transition-transform ${open === r.manager ? 'rotate-90' : ''}`}>▸</span>
                        {r.manager}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[#6b6b66]">{num(r.talks)}</td>
                    {/* Процент только у назначенных: у проведённых и оплат счётчики месяца
                        из разных когорт, доля выходила за 100 % (см. StatRow.toMeasure). */}
                    <td className="px-3 py-2 text-right font-mono text-[#6b6b66]">{num(r.measure_assigned)} <span className="text-[11px] text-[#c4c4be]" title={TO_MEASURE}>{conv(r.toMeasure)}</span></td>
                    <td className="px-3 py-2 text-right font-mono text-[#6b6b66]">{num(r.measure_done)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#6b6b66]">{num(r.payments)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{fmt(r.prepay)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{fmt(r.remainder)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-700 whitespace-nowrap">
                      {fmt(r.money_total)}
                      {r.moneyGap !== 0 && <span title={`Предоплаты + остатки = ${fmt(r.moneySum)}`} className="ml-1 text-amber-600">⚠</span>}
                    </td>
                  </tr>
                  {open === r.manager && (
                    <tr className="border-b border-[#e4e4e0]">
                      <td colSpan={8} className="px-3 pb-3 pt-1 bg-[#fafaf9]">
                        <DaysPanel state={days[daysKey(r.manager)]} row={r} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
                {rows.length > 0 && t && (
                  <tr className="bg-[#fafaf9] border-t border-[#e4e4e0] font-semibold">
                    <td className="px-3 py-2 text-[#111110]">Итого{q.managers.length ? ` (${q.managers.join(', ')})` : ''}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{num(t.talks)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{num(t.measure_assigned)} <span className="text-[11px] text-[#9a9a95]" title={TO_MEASURE}>{conv(t.toMeasure)}</span></td>
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{num(t.measure_done)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{num(t.payments)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{fmt(t.prepay)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#111110]">{fmt(t.remainder)}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-700">{fmt(t.money_total)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Сверка с книгой: где итог месяца в книге не равен сумме её же дней,
            видно обе цифры и какую показываем. Молча выбирать одну нельзя. */}
        {d && d.bookNotes.length > 0 && (
          <div className="mt-4 bg-white border border-amber-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-amber-100 bg-amber-50/50">
              <p className="text-[13px] font-semibold text-[#111110]">Сверка с книгой · {d.bookNotes.length}</p>
              <p className="text-[11px] text-[#6b6b66] mt-0.5">В этих строках итог месяца в книге не равен сумме её же дней. Показано, что стоит в книге, что дают дни и какая цифра на экране.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[12px]">
                <thead>
                  <tr className="text-[#9a9a95] text-[10px] uppercase border-b border-[#f0f0ec]">
                    <th className="text-left font-medium px-3 py-1.5">Месяц</th>
                    <th className="text-left font-medium px-3 py-1.5">Менеджер</th>
                    <th className="text-left font-medium px-3 py-1.5">Показатель</th>
                    <th className="text-right font-medium px-3 py-1.5">Итог в книге</th>
                    <th className="text-right font-medium px-3 py-1.5">Сумма дней</th>
                    <th className="text-right font-medium px-3 py-1.5">На экране</th>
                    <th className="text-left font-medium px-3 py-1.5">Почему</th>
                  </tr>
                </thead>
                <tbody>
                  {d.bookNotes.map(n => {
                    const v = (x: number | null) => x == null ? 'пусто' : MONEY.has(n.metric) ? fmt(x) : num(x)
                    return (
                      <tr key={`${n.month}-${n.manager}-${n.metric}`} className="border-b border-[#f7f7f5] last:border-0">
                        <td className="px-3 py-1.5 whitespace-nowrap text-[#6b6b66]">{monthRu(n.month)}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap text-[#111110]">{n.manager}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap text-[#6b6b66]">{METRIC_LABEL[n.metric] ?? n.metric}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-[#6b6b66]">{v(n.book)}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-[#6b6b66]">{v(n.days)}</td>
                        <td className="px-3 py-1.5 text-right font-mono font-semibold text-[#111110]">{v(n.value)}</td>
                        <td className="px-3 py-1.5 text-[#6b6b66]">{n.text}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="mt-3 text-[11px] text-[#c4c4be]">
          Источник — управленческая книга владельца, лист «Аналитика дохода». Целые месяцы берутся из итога
          месяца в книге (та колонка, что видна в свёрнутом месяце: август 26 — ADL)
          {d && d.partialDays.length > 0 && <>, края периода ({d.partialDays.map(([a, b]) => `${day(a)}–${day(b)}`).join(', ')}) — по дням</>}.
          Последний день в базе — {day(d?.lastDay ?? null)}. Процент у назначенных замеров — на 100 разговоров
          того же периода. У проведённых и оплат процента нет: в них попадают и замеры прошлых месяцев, а в
          оплаты — и сделки без замера. «Всего денег» книга ведёт отдельной строкой;
          {gap ? ' ⚠ у отмеченных она не сходится с суммой предоплат и остатков.' : ' у всех сходится с суммой предоплат и остатков.'}
        </p>
      </div>
    </div>
  )
}

// Деньги менеджера по дням. Итог списка обязан совпасть со строкой таблицы:
// если не совпал — это показывается, а не прячется.
function DaysPanel({ state, row }: { state: DaysState | undefined; row: StatRow }) {
  if (!state || (!state.lines && !state.error)) return <p className="text-[12px] text-[#9a9a95] py-2">Загрузка дней…</p>
  if (state.error) return <p role="alert" className="text-[12px] text-red-700 py-2">Дни не загрузились: {state.error}</p>
  const lines = state.lines ?? []
  if (!lines.length) return <p className="text-[12px] text-[#9a9a95] py-2">За период оплат и денег по дням нет.</p>
  const sum = (k: 'payments' | 'prepay' | 'remainder' | 'money_total') => lines.reduce((a, l) => a + l[k], 0)
  const off = (['payments', 'prepay', 'remainder', 'money_total'] as const).filter(k => Math.round(sum(k)) !== Math.round(row[k]))
  const manyMonths = new Set(lines.map(l => l.month)).size > 1
  const cell = (v: number, money: boolean) => (v ? (money ? fmt(v) : num(v)) : <span className="text-[#d4d4cf]">—</span>)
  return (
    <div className="bg-white border border-[#e4e4e0] rounded-lg overflow-hidden max-w-[760px]">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[#9a9a95] text-[10px] uppercase border-b border-[#f0f0ec]">
            <th className="text-left font-medium px-3 py-1.5">День</th>
            <th className="text-right font-medium px-3 py-1.5">Оплат</th>
            <th className="text-right font-medium px-3 py-1.5">Предоплата</th>
            <th className="text-right font-medium px-3 py-1.5">Остаток</th>
            <th className="text-right font-medium px-3 py-1.5">Всего денег</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <Fragment key={`${l.month}-${l.date ?? 'nodate'}`}>
              {manyMonths && (i === 0 || lines[i - 1].month !== l.month) && (
                <tr className="bg-[#f7f7f5]"><td colSpan={5} className="px-3 py-1 text-[11px] font-semibold text-[#6b6b66]">{monthRu(l.month)}</td></tr>
              )}
              <tr className="border-b border-[#f7f7f5] last:border-0">
                <td className="px-3 py-1.5 whitespace-nowrap text-[#111110]">
                  {l.date ? dayLabel(l.date) : <span className="text-amber-700">без дня — внесено только в итог месяца</span>}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-[#6b6b66]">{cell(l.payments, false)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-[#111110]">{cell(l.prepay, true)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-[#111110]">{cell(l.remainder, true)}</td>
                <td className="px-3 py-1.5 text-right font-mono font-semibold text-emerald-700">{cell(l.money_total, true)}</td>
              </tr>
            </Fragment>
          ))}
          <tr className="bg-[#fafaf9] border-t border-[#e4e4e0] font-semibold">
            <td className="px-3 py-1.5 text-[#111110]">Итого за период</td>
            <td className="px-3 py-1.5 text-right font-mono">{num(sum('payments'))}</td>
            <td className="px-3 py-1.5 text-right font-mono">{fmt(sum('prepay'))}</td>
            <td className="px-3 py-1.5 text-right font-mono">{fmt(sum('remainder'))}</td>
            <td className="px-3 py-1.5 text-right font-mono text-emerald-700">{fmt(sum('money_total'))}</td>
          </tr>
        </tbody>
      </table>
      {off.length > 0 && (
        <p role="alert" className="px-3 py-1.5 text-[11px] text-amber-700 border-t border-amber-100 bg-amber-50/50">
          Сумма дней не сходится со строкой таблицы: {off.map(k => METRIC_LABEL[k]).join(', ')} — книгу стоит проверить.
        </p>
      )}
    </div>
  )
}
