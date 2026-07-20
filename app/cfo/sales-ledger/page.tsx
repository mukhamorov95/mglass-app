'use client'

// Д3: витрина ведомости продаж с маржой. Источник — view v_crm_sales_margin
// (сумма − партнёрские − себестоимость). Маржу видит только финконтур:
// решение владельца «маржа продаж — пока вижу только я».
// Светофор по правилам проекта: <25% красный, 25–35% амбер, ≥35% зелёный.

import { useEffect, useState, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'

type Row = {
  id: number; sale_date: string; ledger_month: string | null; order_no: string | null; client: string
  amount: number; partner_fee: number | null; manager: string | null
  department: string | null; product_type: string | null
  cost: number | null; margin_rub: number | null; margin_percent: number | null
  needs_review: boolean | null; import_batch: string | null
}

// Витрина по умолчанию показывает продажи M-Glass — это то, что владелец
// ведёт в таблице «Продажи МГласс». Производственные B2B-заказы попадают в
// ведомость автоматически при оплате и живут отдельной вкладкой, чтобы не
// смешивать два контура в одной цифре.
const DEPTS = [
  { key: 'mglass', label: 'M-Glass' },
  { key: 'b2b', label: 'Производство (B2B)' },
  { key: 'all', label: 'Всё вместе' },
] as const
type Dept = typeof DEPTS[number]['key']

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'][m - 1] + ' ' + y
}
const shiftMonth = (ym: string, d: number) => {
  const [y, m] = ym.split('-').map(Number)
  const t = y * 12 + (m - 1) + d
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}
const marginCls = (m: number | null) =>
  m == null ? 'text-[#9a9a95]' : m < 25 ? 'text-red-600' : m < 35 ? 'text-amber-600' : 'text-emerald-700'

// В незакрытом месяце бухгалтерия успевает внести только часть затрат: заказ
// на 400 тыс с себестоимостью 2 тыс даёт «маржу 98%». Такие строки считаем
// недосчитанными — в итоговый процент они не идут, иначе он врёт.
const FULL_COST_MIN_RATIO = 0.3
const costLooksFull = (r: { amount: number; cost: number | null }) =>
  r.cost != null && Number(r.cost) >= Number(r.amount) * FULL_COST_MIN_RATIO

// Сводка «годы × месяцы» — та же таблица, что на вкладке «МГЛАСС» в книге
// владельца. В ячейках тысячи рублей: полные суммы в 12 колонок не помещаются.
type SumRow = { ledger_month: string | null; sale_date: string; amount: number; department: string | null }
const MONTHS_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']
const YEARS = [2024, 2025, 2026]
const TH = (n: number) => Math.round(n / 1000).toLocaleString('ru-RU')
const MLN = (n: number) => (n / 1_000_000).toFixed(1).replace('.', ',') + ' млн'

export default function SalesLedgerPage() {
  const sb = createClient()
  const [month, setMonth] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [onlyNoCost, setOnlyNoCost] = useState(false)
  const [dept, setDept] = useState<Dept>('mglass')
  const [summary, setSummary] = useState<SumRow[]>([])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMonth(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }).slice(0, 7))
  }, [])

  // Месяц берём по учётному полю книги (ledger_month): продажу могли записать
  // на вкладку следующего месяца, и владелец считает её там же. У строк,
  // созданных системой, этого поля нет — для них месяц по дате продажи.
  const load = useCallback(async () => {
    if (!month) return
    setLoading(true)
    const [book, auto] = await Promise.all([
      sb.from('v_crm_sales_margin').select('*').eq('ledger_month', month),
      sb.from('v_crm_sales_margin').select('*').is('ledger_month', null)
        .gte('sale_date', `${month}-01`).lt('sale_date', `${shiftMonth(month, 1)}-01`),
    ])
    const all = [...((book.data ?? []) as Row[]), ...((auto.data ?? []) as Row[])]
    all.sort((a, b) => a.sale_date.localeCompare(b.sale_date))
    setRows(all)
    setLoading(false)
  }, [sb, month])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  // Сводка за все годы грузится один раз: месяц её не меняет.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const acc: SumRow[] = []
      for (let from = 0; ; from += 1000) {
        const { data } = await sb.from('v_crm_sales_margin')
          .select('ledger_month, sale_date, amount, department')
          .gte('sale_date', '2024-01-01').range(from, from + 999)
        const page = (data ?? []) as SumRow[]
        acc.push(...page)
        if (page.length < 1000) break
      }
      if (alive) setSummary(acc)
    })()
    return () => { alive = false }
  }, [sb])

  const inDept = useCallback((r: Row) =>
    dept === 'all' ? true : dept === 'b2b' ? r.department === 'b2b' : r.department !== 'b2b', [dept])
  const shown = useMemo(() => {
    const base = rows.filter(inDept)
    return onlyNoCost ? base.filter(r => r.cost == null) : base
  }, [rows, onlyNoCost, inDept])
  const totals = useMemo(() => {
    const scoped = rows.filter(inDept)
    const amount = scoped.reduce((s, r) => s + Number(r.amount || 0), 0)
    const full = scoped.filter(costLooksFull)
    const cost = full.reduce((s, r) => s + Number(r.cost || 0), 0)
    const partner = full.reduce((s, r) => s + Number(r.partner_fee || 0), 0)
    const covered = full.reduce((s, r) => s + Number(r.amount || 0), 0)
    const marginRub = covered - partner - cost
    return {
      amount, count: scoped.length, avg: scoped.length ? amount / scoped.length : 0,
      noCost: scoped.filter(r => r.cost == null).length,
      partial: scoped.filter(r => r.cost != null && !costLooksFull(r)).length,
      covered, marginRub, marginPct: covered > 0 ? marginRub / covered * 100 : null,
    }
  }, [rows, inDept])

  // Матрица год × месяц + итоги года. Месяц строки — по книге (ledger_month),
  // у автосозданных строк его нет, для них берём месяц даты продажи.
  const grid = useMemo(() => {
    const cell = new Map<string, number>()
    for (const r of summary) {
      if (dept === 'b2b' ? r.department !== 'b2b' : dept === 'mglass' ? r.department === 'b2b' : false) continue
      const m = r.ledger_month ?? r.sale_date.slice(0, 7)
      cell.set(m, (cell.get(m) ?? 0) + Number(r.amount || 0))
    }
    const years = YEARS.map(y => {
      const months = Array.from({ length: 12 }, (_, i) => cell.get(`${y}-${String(i + 1).padStart(2, '0')}`) ?? 0)
      return { year: y, months, total: months.reduce((s, v) => s + v, 0) }
    })
    const max = Math.max(1, ...years.flatMap(y => y.months))
    // Сравниваем годы по одинаковому числу месяцев, иначе неполный год «падает».
    const done2026 = years[2].months.filter(v => v > 0).length
    const partial = (y: typeof years[number]) => y.months.slice(0, done2026).reduce((s, v) => s + v, 0)
    return { years, max, done2026, cmp2025: partial(years[1]), cmp2026: partial(years[2]) }
  }, [summary, dept])

  const byManager = useMemo(() => {
    const m = new Map<string, { amount: number; count: number; cost: number; covered: number; partner: number }>()
    for (const r of rows.filter(inDept)) {
      const k = r.manager?.trim() || '—'
      const cur = m.get(k) ?? { amount: 0, count: 0, cost: 0, covered: 0, partner: 0 }
      cur.amount += Number(r.amount || 0); cur.count++
      if (costLooksFull(r)) {
        cur.cost += Number(r.cost)
        cur.covered += Number(r.amount || 0)
        cur.partner += Number(r.partner_fee || 0)
      }
      m.set(k, cur)
    }
    return [...m.entries()].sort((a, b) => b[1].amount - a[1].amount)
  }, [rows, inDept])

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-16">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4 sticky top-0 z-30">
        <div className="max-w-[1100px] mx-auto">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Ведомость продаж и маржа</h1>
            <div className="flex bg-[#f0f0ec] rounded-[10px] p-[3px]">
              {DEPTS.map(d => (
                <button key={d.key} onClick={() => setDept(d.key)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium ${dept === d.key ? 'bg-white shadow-sm text-[#111110]' : 'text-[#6b6b66]'}`}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button onClick={() => setMonth(shiftMonth(month, -1))} className="px-2.5 py-1 rounded-md border border-[#e4e4e0] text-[13px]">←</button>
            <span className="text-[14px] font-semibold capitalize min-w-[130px] text-center">{month && monthLabel(month)}</span>
            <button onClick={() => setMonth(shiftMonth(month, 1))} className="px-2.5 py-1 rounded-md border border-[#e4e4e0] text-[13px]">→</button>
            {totals.noCost > 0 && (
              <button onClick={() => setOnlyNoCost(v => !v)}
                className={`ml-3 px-3 py-1 rounded-lg text-[12px] border ${onlyNoCost ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#6b6b66]'}`}>
                без себестоимости: {totals.noCost}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-[1100px] mx-auto px-5 pt-4">
        <div className="bg-white rounded-xl border border-[#e4e4e0] mb-4 overflow-hidden">
          <div className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-2 flex-wrap">
            <p className="text-[13px] font-semibold text-[#111110]">Продажи по годам, тыс ₽</p>
            {grid.cmp2025 > 0 && grid.done2026 > 0 && (
              <p className="text-[12px] text-[#6b6b66]">
                {grid.done2026} мес. 2026 против тех же месяцев 2025: {MLN(grid.cmp2026)} против {MLN(grid.cmp2025)}
                <span className={`ml-2 font-semibold ${grid.cmp2026 >= grid.cmp2025 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {grid.cmp2026 >= grid.cmp2025 ? '+' : '−'}{Math.abs(Math.round((grid.cmp2026 / grid.cmp2025 - 1) * 100))}%
                </span>
              </p>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[760px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-[#9a9a95] border-b border-[#f0f0ee]">
                  <th className="text-left font-normal px-3 py-1.5">Год</th>
                  {MONTHS_SHORT.map(m => <th key={m} className="text-right font-normal px-1.5 py-1.5">{m}</th>)}
                  <th className="text-right font-normal px-3 py-1.5">Итог</th>
                </tr>
              </thead>
              <tbody>
                {grid.years.map(y => (
                  <tr key={y.year} className="border-b border-[#f7f7f5] last:border-b-0">
                    <td className="px-3 py-1.5 font-semibold text-[#111110]">{y.year}</td>
                    {y.months.map((v, i) => {
                      const ym = `${y.year}-${String(i + 1).padStart(2, '0')}`
                      const isCur = ym === month
                      return (
                        <td key={i} className="px-0.5 py-1">
                          {v > 0 ? (
                            <button onClick={() => setMonth(ym)}
                              title={`${monthLabel(ym)} — ${RUB(v)}`}
                              className={`w-full px-1.5 py-1 rounded-md font-mono text-right tabular-nums ${
                                isCur ? 'bg-[#111110] text-white font-semibold' : 'text-[#111110] hover:bg-[#f5f5f3]'}`}>
                              {TH(v)}
                            </button>
                          ) : <span className="block text-center text-[#d8d8d3]">—</span>}
                        </td>
                      )
                    })}
                    <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">{y.total > 0 ? TH(y.total) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[11px] text-[#9a9a95] border-t border-[#f0f0ee]">
            Клик по месяцу открывает его ниже. Данные — из таблицы «Продажи МГласс» с июля 2024;
            более ранние месяцы в системе не ведутся.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            ['Продажи', RUB(totals.amount), `${totals.count} шт`],
            ['Средний чек', RUB(totals.avg), ''],
            ['Маржа', totals.marginPct != null ? RUB(totals.marginRub) : '—',
              totals.marginPct != null ? `${totals.marginPct.toFixed(1)}% от ${RUB(totals.covered)}` : 'себестоимость не внесена'],
            ['Себестоимости нет', `${totals.noCost}${totals.partial ? ` + ${totals.partial}` : ''}`,
              totals.partial ? `${totals.partial} внесены частично — в процент не идут` : totals.noCost ? 'эти сделки в проценте не учтены' : 'все посчитаны'],
          ].map(([label, value, hint]) => (
            <div key={label} className="bg-white rounded-xl border border-[#e4e4e0] p-3">
              <p className="text-[11px] uppercase tracking-widest text-[#9a9a95]">{label}</p>
              <p className="text-[18px] font-bold text-[#111110]">{value}</p>
              {hint && <p className="text-[11px] text-[#9a9a95]">{hint}</p>}
            </div>
          ))}
        </div>

        {byManager.length > 1 && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] mb-4 overflow-hidden">
            <p className="px-4 pt-3 pb-2 text-[13px] font-semibold">По менеджерам</p>
            {byManager.map(([name, v]) => {
              const pct = v.covered > 0 ? (v.covered - v.partner - v.cost) / v.covered * 100 : null
              return (
                <div key={name} className="flex items-center justify-between px-4 py-2 border-t border-[#f0f0ee] text-[13px]">
                  <span className="text-[#111110]">{name} <span className="text-[#9a9a95]">· {v.count}</span></span>
                  <span className="font-mono">
                    {RUB(v.amount)}
                    <span className={`ml-3 ${marginCls(pct)}`}>{pct != null ? `${pct.toFixed(1)}%` : '—'}</span>
                  </span>
                </div>
              )
            })}
          </div>
        )}

        <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-x-auto">
          {loading && <p className="p-6 text-center text-[13px] text-[#9a9a95]">Загрузка…</p>}
          {!loading && shown.length === 0 && <p className="p-6 text-center text-[13px] text-[#9a9a95]">Продаж за месяц нет</p>}
          {!loading && shown.length > 0 && (
            <table className="w-full text-[13px] min-w-[820px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-widest text-[#9a9a95] border-b border-[#f0f0ee]">
                  <th className="text-left font-normal px-3 py-2">Дата</th>
                  <th className="text-left font-normal px-3 py-2">Заказ</th>
                  <th className="text-left font-normal px-3 py-2">Клиент</th>
                  <th className="text-left font-normal px-3 py-2">Менеджер</th>
                  <th className="text-right font-normal px-3 py-2">Сумма</th>
                  <th className="text-right font-normal px-3 py-2">Себестоимость</th>
                  <th className="text-right font-normal px-3 py-2">Маржа</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id} className="border-b border-[#f7f7f5] last:border-b-0">
                    <td className="px-3 py-2 text-[#9a9a95] whitespace-nowrap">{r.sale_date.slice(8, 10)}.{r.sale_date.slice(5, 7)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.order_no ?? '—'}
                      {r.needs_review && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">дозаполнить</span>}
                    </td>
                    <td className="px-3 py-2 max-w-[220px] truncate">{r.client}</td>
                    <td className="px-3 py-2 text-[#6b6b66] whitespace-nowrap">{r.manager ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{RUB(Number(r.amount))}</td>
                    <td className="px-3 py-2 text-right font-mono text-[#6b6b66] whitespace-nowrap">{r.cost != null ? RUB(Number(r.cost)) : '—'}</td>
                    <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${costLooksFull(r) ? marginCls(r.margin_percent) : 'text-[#9a9a95]'}`}>
                      {r.margin_percent == null ? '—'
                        : costLooksFull(r) ? `${r.margin_percent}%`
                        : <span title="Себестоимость внесена не полностью — в итог не идёт">{r.margin_percent}%&nbsp;?</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-[11px] text-[#9a9a95] mt-3">
          Маржа = сумма − партнёрские − себестоимость. Источник продаж — таблица «Продажи МГласс»,
          месяц берётся по её вкладке. Строки без себестоимости и с явно неполной себестоимостью
          (помечены «?») в итоговый процент не идут — он считается только по сделкам с полными затратами.
        </p>
      </div>
    </div>
  )
}
