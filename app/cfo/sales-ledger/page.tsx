'use client'

// Д3: витрина ведомости продаж с маржой. Источник — view v_crm_sales_margin
// (сумма − партнёрские − себестоимость). Маржу видит только финконтур:
// решение владельца «маржа продаж — пока вижу только я».
// Светофор по правилам проекта: <25% красный, 25–35% амбер, ≥35% зелёный.

import { useEffect, useState, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'

type Row = {
  id: number; sale_date: string; order_no: string | null; client: string
  amount: number; partner_fee: number | null; manager: string | null
  department: string | null; product_type: string | null
  cost: number | null; margin_rub: number | null; margin_percent: number | null
  needs_review: boolean | null; import_batch: string | null
}

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

export default function SalesLedgerPage() {
  const sb = createClient()
  const [month, setMonth] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [onlyNoCost, setOnlyNoCost] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMonth(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }).slice(0, 7))
  }, [])

  const load = useCallback(async () => {
    if (!month) return
    setLoading(true)
    const { data } = await sb.from('v_crm_sales_margin').select('*')
      .gte('sale_date', `${month}-01`).lt('sale_date', `${shiftMonth(month, 1)}-01`)
      .order('sale_date')
    setRows((data ?? []) as Row[])
    setLoading(false)
  }, [sb, month])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => onlyNoCost ? rows.filter(r => r.cost == null) : rows, [rows, onlyNoCost])
  const totals = useMemo(() => {
    const amount = rows.reduce((s, r) => s + Number(r.amount || 0), 0)
    const withCost = rows.filter(r => r.cost != null)
    const cost = withCost.reduce((s, r) => s + Number(r.cost || 0), 0)
    const partner = rows.reduce((s, r) => s + Number(r.partner_fee || 0), 0)
    const covered = withCost.reduce((s, r) => s + Number(r.amount || 0), 0)
    const marginRub = covered - partner - cost
    return {
      amount, count: rows.length, avg: rows.length ? amount / rows.length : 0,
      noCost: rows.length - withCost.length, covered,
      marginRub, marginPct: covered > 0 ? marginRub / covered * 100 : null,
    }
  }, [rows])

  const byManager = useMemo(() => {
    const m = new Map<string, { amount: number; count: number; cost: number; covered: number; partner: number }>()
    for (const r of rows) {
      const k = r.manager?.trim() || '—'
      const cur = m.get(k) ?? { amount: 0, count: 0, cost: 0, covered: 0, partner: 0 }
      cur.amount += Number(r.amount || 0); cur.count++
      cur.partner += Number(r.partner_fee || 0)
      if (r.cost != null) { cur.cost += Number(r.cost); cur.covered += Number(r.amount || 0) }
      m.set(k, cur)
    }
    return [...m.entries()].sort((a, b) => b[1].amount - a[1].amount)
  }, [rows])

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-16">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4 sticky top-0 z-30">
        <div className="max-w-[1100px] mx-auto">
          <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Ведомость продаж и маржа</h1>
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            ['Продажи', RUB(totals.amount), `${totals.count} шт`],
            ['Средний чек', RUB(totals.avg), ''],
            ['Маржа', totals.marginPct != null ? RUB(totals.marginRub) : '—',
              totals.marginPct != null ? `${totals.marginPct.toFixed(1)}% от ${RUB(totals.covered)}` : 'нет себестоимости'],
            ['Без себестоимости', String(totals.noCost), totals.noCost ? 'маржа занижена' : 'все посчитаны'],
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
                    <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${marginCls(r.margin_percent)}`}>
                      {r.margin_percent != null ? `${r.margin_percent}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-[11px] text-[#9a9a95] mt-3">
          Маржа = сумма − партнёрские − себестоимость. Строки без себестоимости в проценте не участвуют,
          поэтому итоговый процент считается только по закрытой части выручки.
        </p>
      </div>
    </div>
  )
}
