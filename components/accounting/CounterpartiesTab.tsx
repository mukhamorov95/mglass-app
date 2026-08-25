'use client'

// Б13: взаиморасчёты. По каждому поставщику: сколько выставлено закупками,
// сколько отмечено оплаченным в закупках, сколько реально ушло деньгами и что
// висит в заявках. Расхождение «по закупкам» и «деньгами» не сглаживаем — это
// и есть то, что нужно увидеть.

import { useCallback, useEffect, useState } from 'react'

type Row = {
  name: string; ordered: number; paidPurchase: number; paidCash: number
  openRequests: number; lastOp: string | null; balance: number
}
type Totals = { ordered: number; paidPurchase: number; paidCash: number; debt: number; openRequests: number }

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const DD = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}`

export function CounterpartiesTab({ unit, from }: { unit: 'ip' | 'ooo'; from: string }) {
  const [items, setItems] = useState<Row[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`/api/accounting/counterparties?unit=${unit}&from=${from}`)
    if (r.ok) {
      const j = await r.json()
      setItems(j.items as Row[])
      setTotals(j.totals as Totals)
    }
    setLoading(false)
  }, [unit, from])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  if (loading) return <p className="text-[13px] text-[#9a9a95] py-6 text-center">Загрузка…</p>

  const list = q.trim()
    ? items.filter(i => i.name.toLowerCase().includes(q.trim().toLowerCase()))
    : items

  return (
    <div className="space-y-3">
      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([['Заказано', totals.ordered], ['Оплачено в закупках', totals.paidPurchase],
             ['Ушло деньгами', totals.paidCash], ['Долг поставщикам', totals.debt]] as const).map(([label, v]) => (
            <div key={label} className="bg-white rounded-xl border border-[#e4e4e0] px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-widest text-[#9a9a95]">{label}</p>
              <p className="text-[15px] font-mono font-semibold text-[#111110] mt-0.5">{RUB(v)}</p>
            </div>
          ))}
        </div>
      )}

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск по контрагенту"
        className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] outline-none focus:border-[#111110]" />

      <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-widest text-[#9a9a95]">
              <th className="text-left font-medium px-4 py-2">Контрагент</th>
              <th className="text-right font-medium px-3 py-2">Заказано</th>
              <th className="text-right font-medium px-3 py-2">Оплачено</th>
              <th className="text-right font-medium px-3 py-2">Деньгами</th>
              <th className="text-right font-medium px-3 py-2">Заявки</th>
              <th className="text-right font-medium px-4 py-2">Сальдо</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-[#9a9a95]">Ничего не найдено</td></tr>
            )}
            {list.slice(0, 200).map(r => {
              const mismatch = Math.abs(r.paidPurchase - r.paidCash) > 1 && r.ordered > 0 && r.paidCash > 0
              return (
                <tr key={r.name} className="border-t border-[#f0f0ee]">
                  <td className="px-4 py-2">
                    <span className="text-[#111110]">{r.name}</span>
                    {r.lastOp && <span className="text-[11px] text-[#9a9a95] block">последний платёж {DD(r.lastOp)}</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[#6b6b66]">{r.ordered ? RUB(r.ordered) : '—'}</td>
                  <td className="px-3 py-2 text-right font-mono text-[#6b6b66]">{r.paidPurchase ? RUB(r.paidPurchase) : '—'}</td>
                  <td className={`px-3 py-2 text-right font-mono ${mismatch ? 'text-amber-700' : 'text-[#6b6b66]'}`}
                    title={mismatch ? 'Расходится с отметками в закупках' : undefined}>
                    {r.paidCash ? RUB(r.paidCash) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[#6b6b66]">{r.openRequests ? RUB(r.openRequests) : '—'}</td>
                  <td className={`px-4 py-2 text-right font-mono font-semibold ${
                    r.balance > 1 ? 'text-amber-700' : r.balance < -1 ? 'text-emerald-700' : 'text-[#9a9a95]'}`}>
                    {Math.abs(r.balance) < 1 ? '0' : RUB(r.balance)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-[#9a9a95]">
        Сальдо = заказано минус оплачено по закупкам. Колонка «деньгами» — операции ДДС по этому контрагенту
        с начала года; если она расходится с «оплачено», значение подсвечено — значит, отметки в закупках и
        деньги разошлись.
      </p>
    </div>
  )
}
