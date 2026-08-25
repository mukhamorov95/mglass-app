'use client'

// Б11: зарплата по людям за месяц. Начислено — из payroll_accruals, выплачено —
// из операций ДДС по подфонду человека, долг — разница. НДФЛ и взносы стоят
// отдельной строкой: это долг государству, а не человеку.

import { useCallback, useEffect, useState } from 'react'

type Item = { id: number; kind: string; amount: number; note: string | null }
type Person = {
  subfund_id: number; fund_id: number; name: string; fund: string
  accrued: number; withheld: number; paid: number; debt: number; items: Item[]
}

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const KINDS = ['оклад', 'сделка', 'премия', 'аванс', 'НДФЛ', 'взносы', 'прочее'] as const

export function PayrollTab({ unit, month, onChanged }: {
  unit: 'ip' | 'ooo'; month: string; onChanged: () => void
}) {
  const [people, setPeople] = useState<Person[]>([])
  const [unassigned, setUnassigned] = useState(0)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [form, setForm] = useState<{ kind: string; amount: string; note: string }>({ kind: 'оклад', amount: '', note: '' })

  const load = useCallback(async () => {
    if (!month) return
    setLoading(true)
    const r = await fetch(`/api/accounting/payroll?unit=${unit}&month=${month}`)
    if (r.ok) {
      const j = await r.json()
      setPeople(j.people as Person[])
      setUnassigned(Number(j.unassigned ?? 0))
    }
    setLoading(false)
  }, [unit, month])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function send(p: Person, action: 'accrue' | 'pay', amount: number, kind?: string) {
    if (!(amount > 0)) { setErr('Сумма должна быть больше нуля'); return }
    setBusy(true); setErr(null)
    const r = await fetch('/api/accounting/payroll', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action, unit, month, fund_id: p.fund_id, subfund_id: p.subfund_id,
        person_name: p.name, amount, kind, note: form.note || null,
      }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) setErr(j.error ?? 'Не получилось')
    else { setForm({ kind: 'оклад', amount: '', note: '' }); await load(); onChanged() }
    setBusy(false)
  }

  async function removeItem(id: number) {
    setBusy(true)
    await fetch(`/api/accounting/payroll?id=${id}`, { method: 'DELETE' })
    await load()
    setBusy(false)
  }

  if (loading) return <p className="text-[13px] text-[#9a9a95] py-6 text-center">Загрузка…</p>

  const totals = people.reduce((t, p) => ({
    accrued: t.accrued + p.accrued, paid: t.paid + p.paid,
    debt: t.debt + Math.max(0, p.debt), withheld: t.withheld + p.withheld,
  }), { accrued: 0, paid: 0, debt: 0, withheld: 0 })

  return (
    <div className="space-y-3">
      {err && <div className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-[13px]">{err}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {([['Начислено', totals.accrued], ['Выплачено', totals.paid], ['Долг людям', totals.debt], ['НДФЛ и взносы', totals.withheld]] as const).map(([label, v]) => (
          <div key={label} className="bg-white rounded-xl border border-[#e4e4e0] px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-widest text-[#9a9a95]">{label}</p>
            <p className="text-[15px] font-mono font-semibold text-[#111110] mt-0.5">{RUB(v)}</p>
          </div>
        ))}
      </div>

      {unassigned > 0 && (
        <div className="px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[13px] text-amber-900">
          Выплачено без указания человека: <span className="font-mono font-semibold">{RUB(unassigned)}</span> — эти операции стоят на фонде без подфонда.
        </div>
      )}

      <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
        {people.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-[#9a9a95]">
          В зарплатных фондах нет подфондов-людей
        </p>}
        {people.map(p => {
          const isOpen = open === p.subfund_id
          return (
            <div key={p.subfund_id} className="border-t border-[#f0f0ee] first:border-t-0">
              <button onClick={() => setOpen(isOpen ? null : p.subfund_id)}
                className="w-full px-4 py-2.5 flex items-center justify-between text-left">
                <span className="min-w-0">
                  <span className="text-[14px] text-[#111110]">{isOpen ? '▾' : '▸'} {p.name}</span>
                  <span className="text-[12px] text-[#9a9a95] block">{p.fund}</span>
                </span>
                <span className="text-right flex-shrink-0 ml-3">
                  <span className="text-[13px] font-mono text-[#6b6b66]">
                    {RUB(p.accrued)} / {RUB(p.paid)}
                  </span>
                  <span className={`block text-[13px] font-mono font-semibold ${
                    p.debt > 0.5 ? 'text-amber-700' : p.debt < -0.5 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {p.debt > 0.5 ? `должны ${RUB(p.debt)}` : p.debt < -0.5 ? `переплата ${RUB(-p.debt)}` : 'закрыто'}
                  </span>
                </span>
              </button>

              {isOpen && (
                <div className="px-4 pb-3 bg-[#fafaf8]">
                  {p.items.map(i => (
                    <div key={i.id} className="flex items-center justify-between py-1 text-[13px]">
                      <span className="text-[#6b6b66]">{i.kind}{i.note ? ` · ${i.note}` : ''}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-[#111110]">{RUB(i.amount)}</span>
                        <button onClick={() => removeItem(i.id)} disabled={busy}
                          className="text-[12px] text-[#c9c9c4] hover:text-red-600">×</button>
                      </span>
                    </div>
                  ))}

                  <div className="flex flex-wrap items-end gap-2 mt-2">
                    <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}
                      className="border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] bg-white">
                      {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <input value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                      inputMode="decimal" placeholder="сумма"
                      className="w-28 border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] font-mono" />
                    <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                      placeholder="комментарий"
                      className="flex-1 min-w-[120px] border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px]" />
                    <button onClick={() => send(p, 'accrue', Number(form.amount.replace(',', '.')), form.kind)} disabled={busy}
                      className="px-3 py-1.5 rounded-lg border border-[#111110] text-[13px] font-medium disabled:opacity-50">
                      Начислить
                    </button>
                    <button onClick={() => send(p, 'pay', Number(form.amount.replace(',', '.')) || p.debt)} disabled={busy}
                      className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[13px] font-semibold disabled:opacity-50">
                      Выплатить{!form.amount && p.debt > 0.5 ? ` ${RUB(p.debt)}` : ''}
                    </button>
                  </div>
                  <p className="text-[11px] text-[#9a9a95] mt-1.5">
                    Выплата создаёт операцию ДДС по этому подфонду. Пустая сумма — выплачиваем весь долг.
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
