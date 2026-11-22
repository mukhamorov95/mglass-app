'use client'

// ФП Ф5: распределение денег завершившейся недели по фондам по методике (ТЗ §7) —
// таблица до утверждения и утверждение одним результатом. Расчёт —
// lib/finplan/distribute.ts через lib/finplan/availability.ts (тот же, что у Комитета).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { computeDistribution, distFunds, type FundRow, type NeedSource } from '@/lib/finplan/availability'
import { reservesByFund, type ReqLike, type PayLike } from '@/lib/finplan/requests'
import type { IncomeEntry } from '@/lib/finweek'

type Entry = IncomeEntry & { fund_id: number }
type Approved = { week_end: string; income: number; result: { rows: { fund_id: number; allocated: number }[] }; approved_by: string | null; approved_at: string }

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const DD = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`
const SRC: Record<NeedSource, string> = { subfund_plans: 'план подфондов', month_plan: '% от плана месяца', week_income: '% от денег недели' }

export function DistributionBlock({ unit, month, weekEnd, today, funds, entries, nonIncome, monthPlan, canApprove, myName }: {
  unit: 'ip' | 'ooo'; month: string; weekEnd: string; today: string; funds: FundRow[]; entries: Entry[]
  nonIncome: ReadonlySet<number>; monthPlan: number | null; canApprove: boolean; myName: string
}) {
  const sb = createClient()
  const [subPlan, setSubPlan] = useState<Map<number, number>>(new Map())
  const [reqs, setReqs] = useState<ReqLike[]>([])
  const [pays, setPays] = useState<PayLike[]>([])
  const [finalWeeks, setFinalWeeks] = useState<Set<string>>(new Set())
  const [approved, setApproved] = useState<Approved | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const fundIds = funds.map(f => f.id)
    const [subs, plans, q, d, a] = await Promise.all([
      fundIds.length ? sb.from('cashflow_subfunds').select('id,fund_id').in('fund_id', fundIds) : Promise.resolve({ data: [] }),
      sb.from('cashflow_subfund_plans').select('subfund_id,plan_monthly'),
      sb.from('payment_requests').select('id,fund_id,amount,approved_amount,status,week_end,closed_at,decision').eq('unit', unit).neq('status', 'cancelled').range(0, 9999),
      sb.from('fp_directives').select('week_end').eq('unit', unit).eq('status', 'final'),
      sb.from('fp_distributions').select('week_end,income,result,approved_by,approved_at').eq('unit', unit).eq('week_end', weekEnd).maybeSingle(),
    ])
    const fundOf = new Map(((subs.data ?? []) as { id: number; fund_id: number }[]).map(x => [x.id, x.fund_id]))
    const m = new Map<number, number>()
    for (const p of (plans.data ?? []) as { subfund_id: number; plan_monthly: number }[]) {
      const fid = fundOf.get(p.subfund_id)
      if (fid != null) m.set(fid, (m.get(fid) ?? 0) + Number(p.plan_monthly))
    }
    setSubPlan(m)
    const list = (q.data ?? []) as ReqLike[]
    setReqs(list)
    const ids = list.map(x => x.id)
    const p = ids.length ? await sb.from('payment_request_payments').select('request_id,amount').in('request_id', ids) : { data: [] }
    setPays(((p.data ?? []) as PayLike[]).map(x => ({ ...x, amount: Number(x.amount) })))
    setFinalWeeks(new Set(((d.data ?? []) as { week_end: string }[]).map(x => x.week_end)))
    setApproved((a.data as Approved | null) ?? null)
  }, [sb, unit, funds, weekEnd])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  const dist = useMemo(() => computeDistribution(month, funds, entries, nonIncome, today, subPlan, monthPlan), [month, funds, entries, nonIncome, today, subPlan, monthPlan])
  const sources = useMemo(() => new Map(distFunds(funds, subPlan, monthPlan).map(f => [f.id, f.source])), [funds, subPlan, monthPlan])
  const idx = dist.findIndex(w => w.week_end === weekEnd)
  const week = idx >= 0 ? dist[idx] : null
  const done = today > weekEnd
  const reserves = useMemo(() => reservesByFund(reqs, pays, finalWeeks), [reqs, pays, finalWeeks])

  const before = useMemo(() => {
    const m = new Map<number, number>()
    if (idx < 0) return m
    for (const w of dist.slice(0, idx)) for (const x of w.rows) m.set(x.fund_id, (m.get(x.fund_id) ?? 0) + Math.round(x.allocated * 100))
    const startOfWeek = new Date(Date.parse(weekEnd + 'T00:00:00Z') - 6 * 86_400_000).toISOString().slice(0, 10)
    for (const e of entries) if (e.kind === 'out' && e.entry_date.startsWith(month) && e.entry_date < startOfWeek) m.set(e.fund_id, (m.get(e.fund_id) ?? 0) - Math.round(Number(e.amount) * 100))
    return new Map([...m].map(([k, v]) => [k, v / 100]))
  }, [dist, idx, entries, month, weekEnd])

  async function approve() {
    if (!week) return
    const { data, error } = await sb.from('fp_distributions').upsert(
      { unit, week_end: weekEnd, income: week.income, result: { rows: week.rows, overflow: week.overflow, pointer: week.pointer }, approved_by: myName },
      { onConflict: 'unit,week_end', ignoreDuplicates: true },
    ).select('id')
    if (error) { setMsg('Не утверждено: ' + error.message); return }
    setMsg(data?.length ? 'Распределение утверждено ✓' : 'Уже было утверждено — результат прежний')
    await load()
  }

  if (idx < 0) {
    return (
      <div className="bg-white rounded-xl border border-[#e4e4e0] p-4 text-[13px] text-[#9a9a95]">
        Эта неделя кончается в следующем месяце — её деньги распределяются там.
      </div>
    )
  }

  const approvedBy = new Map((approved?.result.rows ?? []).map(x => [x.fund_id, Number(x.allocated)]))
  const changed = approved && week && week.rows.some(x => Math.round((approvedBy.get(x.fund_id) ?? 0) * 100) !== Math.round(x.allocated * 100))

  return (
    <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
        <p className="text-[14px] font-semibold text-[#111110]">Распределение по фондам · неделя до ср {DD(weekEnd)}</p>
        <p className="text-[12px] text-[#9a9a95]">{done ? `от клиентов за неделю ${RUB(week!.income)}` : 'неделя ещё идёт — распределяется после среды'}</p>
      </div>
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-[12px] min-w-[640px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[#9a9a95] text-right">
              <th className="text-left font-normal py-1">Фонд</th>
              <th className="font-normal">Остаток до ФП</th>
              <th className="font-normal">План пополнения</th>
              <th className="font-normal">Распределено</th>
              <th className="font-normal">Недозап. / опереж.</th>
              <th className="font-normal">Резервы</th>
              <th className="font-normal">Свободно после ФП</th>
            </tr>
          </thead>
          <tbody>
            {week!.rows.map(x => {
              const b = before.get(x.fund_id) ?? 0
              const res = reserves.get(x.fund_id) ?? 0
              const after = b + x.allocated - res
              const src = sources.get(x.fund_id)
              return (
                <tr key={x.fund_id} className="border-t border-[#f0f0ee] text-right font-mono">
                  <td className="text-left font-sans py-1.5 text-[#111110]">
                    {x.name}
                    <span className="block text-[10px] text-[#9a9a95]">
                      {x.fund_class === 'variable' ? 'переменный' : x.fund_class === 'fund' ? 'из маржи' : `постоянный · ${src ? SRC[src] : ''}`}
                      {x.badPercent && <span className="text-red-600"> · % в модели меньше нуля — считаю 0</span>}
                    </span>
                  </td>
                  <td>{RUB(b)}</td>
                  <td>{RUB(x.plan)}{x.covered > 0 && <span className="block text-[10px] text-[#9a9a95]">закрыто раньше {RUB(x.covered)}</span>}</td>
                  <td className="text-[#111110] font-semibold">{RUB(x.allocated)}</td>
                  <td className={x.short > 0 ? 'text-red-600' : x.advance > 0 ? 'text-emerald-700' : 'text-[#9a9a95]'}>
                    {x.short > 0 ? `−${RUB(x.short)}` : x.advance > 0 ? `+${RUB(x.advance)}` : '—'}
                  </td>
                  <td>{res ? RUB(res) : '—'}</td>
                  <td className={after < 0 ? 'text-red-600 font-semibold' : 'text-emerald-700 font-semibold'}>{RUB(after)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {week!.pointer && <p className="text-[11px] text-[#6b6b66] mt-2">Избыток ушёл вперёд — распределение дошло до недели ср {DD(week!.pointer.week_end)}, фонд «{funds.find(f => f.id === week!.pointer!.fund_id)?.name}».</p>}
      {week!.overflow > 0 && <p className="text-[11px] text-[#6b6b66]">План месяца по постоянным закрыт — {RUB(week!.overflow)} в последний фонд модели.</p>}
      <div className="flex items-center gap-3 mt-3 flex-wrap">
        {approved
          ? <p className="text-[12px] text-emerald-700">Утверждено {approved.approved_by ?? ''} · {new Date(approved.approved_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
              {changed && <span className="text-amber-700"> · с тех пор операции изменились: сейчас расчёт другой, утверждённый результат сохранён</span>}</p>
          : canApprove && done && <button onClick={approve} className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[12px] font-semibold">Утвердить распределение</button>}
        {msg && <span className="text-[12px] text-[#4b4b47]">{msg}</span>}
      </div>
      <p className="text-[11px] text-[#9a9a95] mt-2">
        По методике: переменные и фонды из маржи — % от денег клиентов недели; постоянные — недельная потребность по очереди,
        недостача делится на оставшиеся недели месяца, избыток идёт вперёд по очереди, после плана месяца — в последний фонд.
      </p>
    </div>
  )
}
