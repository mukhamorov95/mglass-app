'use client'

// Финнеделя чт–ср (ТЗ ФП 22.11, Ф1). Месяц считает операции по их дате:
// периоды = недели по средам, обрезанные месяцем, + «До конца месяца». План
// месяца делится по рабочим дням; недобор завершённого периода — на оставшиеся.
// План и заливка фондов — только деньги клиентов; заём, вклад учредителя и
// возвраты показаны отдельно. Расчёты — lib/finweek.ts (чистые, с тестами).

import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { monthPeriods, buildPeriodPlans, monthStatus, incomeSplit, waterfall } from '@/lib/finweek'

type Fund = { id: number; unit: string; flow: string; fund_class: string; name: string; percent: number | null; sort: number }
type Entry = { entry_date: string; kind: string; fund_id: number; subfund_id: number | null; amount: number }
type Sub = { id: number; fund_id: number; name: string; non_income: boolean }

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const DD = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'][m - 1] + ' ' + y
}
const shiftMonth = (ym: string, d: number) => {
  const [y, m] = ym.split('-').map(Number)
  const t = y * 12 + (m - 1) + d
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}
const CLASS_LABEL: Record<string, string> = { variable: 'Переменные', fixed: 'Постоянные', fund: 'Фонды' }

export function FinweekTab({ unit, funds, isFin, myName, showBreakevenLink }: {
  unit: 'ip' | 'ooo'; funds: Fund[]; isFin: boolean; myName: string; showBreakevenLink: boolean
}) {
  const sb = createClient()
  const [month, setMonth] = useState('')
  const [today, setToday] = useState('')
  const [plan, setPlan] = useState<number | null>(null)
  const [planDraft, setPlanDraft] = useState('')
  const [editPlan, setEditPlan] = useState(false)
  const [tbTargets, setTbTargets] = useState<{ unit: string; label: string; tb0: number | null; tb1: number | null; tbTarget: number | null }[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [subs, setSubs] = useState<Sub[]>([])
  const [selIdx, setSelIdx] = useState<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2800) }

  useEffect(() => {
    const now = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToday(now)
    setMonth(now.slice(0, 7))
  }, [])

  const periods = useMemo(() => (month ? monthPeriods(month) : []), [month])
  const incomeFundIds = useMemo(() => funds.filter(f => f.unit === unit && f.flow === 'in').map(f => f.id), [funds, unit])

  const load = useCallback(async () => {
    if (!periods.length) return
    const from = periods[0].week.start
    const to = periods[periods.length - 1].week.end
    const [p, e, s] = await Promise.all([
      sb.from('cashflow_month_plans').select('plan_amount').eq('unit', unit).eq('month', month).maybeSingle(),
      sb.from('cashflow_entries').select('entry_date,kind,fund_id,subfund_id,amount')
        .eq('unit', unit).gte('entry_date', from).lte('entry_date', to).range(0, 9999),
      incomeFundIds.length
        ? sb.from('cashflow_subfunds').select('id,fund_id,name,non_income').in('fund_id', incomeFundIds).eq('active', true).order('sort')
        : Promise.resolve({ data: [] }),
    ])
    setPlan(p.data ? Number((p.data as { plan_amount: number }).plan_amount) : null)
    setEntries((e.data ?? []) as Entry[])
    setSubs((s.data ?? []) as Sub[])
  }, [sb, unit, month, periods, incomeFundIds])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  const unitFunds = useMemo(() => funds.filter(f => f.unit === unit), [funds, unit])
  const nonIncome = useMemo(() => new Set(subs.filter(s => s.non_income).map(s => s.id)), [subs])
  const byPeriod = useMemo(() => periods.map(p => incomeSplit(entries, p.start, p.end, nonIncome)), [periods, entries, nonIncome])
  const rows = useMemo(() =>
    today ? buildPeriodPlans(plan ?? 0, periods, byPeriod.map(x => x.client), today) : [],
  [plan, periods, byPeriod, today])
  const status = useMemo(() => monthStatus(rows, plan ?? 0), [rows, plan])

  const defaultIdx = useMemo(() => {
    const cur = rows.findIndex(r => r.current)
    if (cur >= 0) return cur
    const done = rows.filter(r => r.completed).length
    return done > 0 ? done - 1 : 0
  }, [rows])
  const sel = selIdx ?? defaultIdx
  const selRow = rows[sel]
  const selWeekIncome = useMemo(() => selRow ? incomeSplit(entries, selRow.period.week.start, selRow.period.week.end, nonIncome) : null, [selRow, entries, nonIncome])
  const wf = useMemo(() => selWeekIncome ? waterfall(selWeekIncome.client, unitFunds) : null, [selWeekIncome, unitFunds])

  async function toggleNonIncome(sub: Sub) {
    const { data, error } = await sb.from('cashflow_subfunds').update({ non_income: !sub.non_income }).eq('id', sub.id).select('id')
    if (error || !data?.length) { flash('Не сохранилось' + (error ? ': ' + error.message : ' — нет прав')); return }
    flash(!sub.non_income ? `«${sub.name}» — не от клиентов ✓` : `«${sub.name}» — деньги клиентов ✓`)
    await load()
  }

  async function savePlan() {
    const amount = Number(planDraft.replace(/\s/g, '').replace(',', '.'))
    if (!(amount >= 0)) { flash('Введи сумму плана'); return }
    const { error } = await sb.from('cashflow_month_plans').upsert(
      { unit, month, plan_amount: amount, updated_by: myName, updated_at: new Date().toISOString() },
      { onConflict: 'unit,month' },
    )
    if (error) { flash('Не сохранилось: ' + error.message); return }
    setEditPlan(false)
    flash('План месяца сохранён ✓')
    await load()
  }

  const monthFact = byPeriod.reduce((s, v) => s + v.client, 0)
  const monthOther = byPeriod.reduce((s, v) => s + v.nonIncome, 0)

  return (
    <div className="space-y-3">
      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl shadow-lg text-[13px] font-semibold bg-[#111110] text-white">{toast}</div>}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => { setMonth(shiftMonth(month, -1)); setSelIdx(null) }} className="px-2.5 py-1 rounded-md border border-[#e4e4e0] text-[13px]">←</button>
          <span className="text-[14px] font-semibold text-[#111110] capitalize min-w-[120px] text-center">{month && monthLabel(month)}</span>
          <button onClick={() => { setMonth(shiftMonth(month, 1)); setSelIdx(null) }} className="px-2.5 py-1 rounded-md border border-[#e4e4e0] text-[13px]">→</button>
        </div>
        <span className="text-[12px] text-[#9a9a95]">{rows.filter(r => !r.period.tail).length} сред в месяце</span>
      </div>

      <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-[#9a9a95]">План месяца · поступления</p>
            {!editPlan ? (
              <p className="text-[22px] font-bold text-[#111110]">
                {plan != null ? RUB(plan) : <span className="text-[#9a9a95] text-[15px] font-normal">не задан</span>}
              </p>
            ) : (
              <div>
                <div className="flex items-center gap-2 mt-1">
                  <input value={planDraft} onChange={e => setPlanDraft(e.target.value)} inputMode="decimal" placeholder="10 000 000" autoFocus
                    className="w-[160px] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[16px] font-mono outline-none focus:border-[#111110]" />
                  <button onClick={savePlan} className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[13px] font-semibold">Сохранить</button>
                  <button onClick={() => setEditPlan(false)} className="px-2 py-1.5 text-[13px] text-[#9a9a95]">отмена</button>
                </div>
                {tbTargets.length > 0 && (
                  <div className="mt-2">
                    <p className="text-[11px] text-[#9a9a95] mb-1">Подставить целевую выручку из финмодели:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {tbTargets.flatMap(t => ([
                        t.tb1 != null && { key: `${t.unit}-tb1`, label: `${t.label} · с фондами`, val: t.tb1 },
                        t.tbTarget != null && { key: `${t.unit}-tbt`, label: `${t.label} · с доходом собственника`, val: t.tbTarget },
                      ].filter(Boolean) as { key: string; label: string; val: number }[])).map(o => (
                        <button key={o.key} onClick={() => setPlanDraft(String(Math.round(o.val)))}
                          className="text-[11px] px-2 py-1 rounded-md border border-[#e4e4e0] text-[#4b4b47] hover:border-[#111110] hover:text-[#111110]">
                          {o.label}: {RUB(o.val)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-widest text-[#9a9a95]">Пришло от клиентов</p>
            <p className="text-[22px] font-bold text-emerald-700">{RUB(monthFact)}</p>
            {monthOther > 0 && <p className="text-[11px] text-[#6b6b66]">ещё {RUB(monthOther)} не от клиентов — в план не входит</p>}
          </div>
          {isFin && !editPlan && (
            <button onClick={() => {
              setPlanDraft(plan != null ? String(Math.round(plan)) : ''); setEditPlan(true)
              if (showBreakevenLink && tbTargets.length === 0) {
                fetch('/api/cfo/breakeven-targets').then(r => r.ok ? r.json() : { targets: [] })
                  .then(d => setTbTargets(d.targets ?? [])).catch(() => {})
              }
            }}
              className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] text-[#6b6b66]">✎ план</button>
          )}
        </div>
        <p className="text-[11px] text-[#9a9a95] mt-2">
          Источник плана — точка безубыточности перед началом месяца{showBreakevenLink && <> (<a href="/cfo/breakeven" className="text-blue-600">открыть ТБ ↗</a>)</>}.
          План делится по рабочим дням периодов; недобор завершённого периода — на оставшиеся, исходный план виден рядом.
          Месяц считает деньги по дате поступления, неделя совещания — все семь дней чт–ср.
        </p>
      </div>

      {plan != null && status.asOf && (
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <p className="text-[14px] font-semibold text-[#111110] mb-2">На конец среды {DD(status.asOf)}</p>
          {[
            ['По плану должно было поступить с начала месяца', RUB(status.cumBase), 'text-[#111110]'],
            ['Пришло от клиентов', RUB(status.cumFact), 'text-[#111110]'],
            [status.lag >= 0 ? 'Отставание' : 'Опережение', RUB(Math.abs(status.lag)), status.lag > 0 ? 'text-red-600' : 'text-emerald-700'],
            ['Осталось получить до конца месяца', RUB(status.remaining), 'text-[#111110]'],
          ].map(([k, v, c]) => (
            <div key={k} className="flex justify-between gap-3 text-[13px] py-1 border-b border-[#f0f0ee] last:border-b-0">
              <span className="text-[#4b4b47]">{k}</span><span className={`font-mono font-semibold ${c}`}>{v}</span>
            </div>
          ))}
          {status.nextTargets.length > 0 && (
            <p className="text-[12px] text-[#6b6b66] mt-2">Новая цель оставшихся периодов: {status.nextTargets.map(t => RUB(t)).join(' · ')}</p>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 sm:gap-x-4 px-4 py-2 text-[11px] uppercase tracking-widest text-[#9a9a95] border-b border-[#f0f0ee]">
          <span>Период</span><span className="text-right">План</span><span className="text-right">Факт</span><span className="text-right">Откл.</span>
        </div>
        {rows.map((w, i) => {
          const dev = plan != null && (w.completed || w.current) ? w.deviation : null
          return (
            <button key={w.period.start} onClick={() => setSelIdx(i)}
              className={`w-full grid grid-cols-[1fr_auto_auto_auto] gap-x-2 sm:gap-x-4 px-4 py-2.5 text-[13px] border-b border-[#f0f0ee] last:border-b-0 text-left ${i === sel ? 'bg-[#f5f5f3]' : ''}`}>
              <span className="text-[#111110] whitespace-nowrap">
                {w.period.tail ? <>До конца месяца · {DD(w.period.start)}{w.period.end !== w.period.start && <>—{DD(w.period.end)}</>}</>
                  : <>{DD(w.period.start)} — ср {DD(w.period.end)}</>}
                {w.current && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-semibold align-middle">текущая</span>}
                {w.completed && <span className="ml-2 text-[10px] text-[#9a9a95] align-middle">завершена</span>}
              </span>
              <span className="font-mono text-right text-[#111110]">
                {plan == null ? '—' : RUB(w.plan)}
                {plan != null && Math.round(w.plan) !== Math.round(w.base) && <span className="block text-[10px] text-[#9a9a95]">исходно {RUB(w.base)}</span>}
              </span>
              <span className="font-mono text-right text-[#111110]">{w.fact > 0 || w.completed || w.current ? RUB(w.fact) : '—'}</span>
              <span className={`font-mono text-right ${dev == null ? 'text-[#9a9a95]' : dev < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                {dev == null ? '—' : (dev >= 0 ? '+' : '−') + RUB(Math.abs(dev)).replace(' ₽', '') }
              </span>
            </button>
          )
        })}
      </div>

      {selRow && wf && selWeekIncome && (
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-[14px] font-semibold text-[#111110]">Наполнение фондов · неделя чт {DD(selRow.period.week.start)} — ср {DD(selRow.period.week.end)}</p>
            <p className="text-[12px] text-[#9a9a95]">от клиентов {RUB(selWeekIncome.client)}</p>
          </div>
          {selWeekIncome.nonIncome > 0 && <p className="text-[12px] text-[#6b6b66] mb-2">Ещё {RUB(selWeekIncome.nonIncome)} не от клиентов (заём, свои, возвраты) — в заливку не идут.</p>}
          {selWeekIncome.client <= 0 && <p className="text-[13px] text-[#9a9a95]">Денег от клиентов за неделю пока нет — фонды не наполнялись.</p>}
          {selWeekIncome.client > 0 && (['variable', 'fixed', 'fund'] as const).map(cls => {
            const rows = wf.fills.filter(f => f.fund_class === cls)
            if (!rows.length) return null
            return (
              <div key={cls} className="mb-3 last:mb-0">
                <p className="text-[11px] uppercase tracking-widest text-[#9a9a95] mb-1">{CLASS_LABEL[cls]}</p>
                {rows.map(f => {
                  const pct = f.target > 0 ? f.allocated / f.target : 0
                  const bar = pct >= 0.999 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-400' : 'bg-red-400'
                  return (
                    <div key={f.id} className="mb-1.5">
                      <div className="flex justify-between text-[12px]">
                        <span className="text-[#4b4b47]">{f.name} <span className="text-[#9a9a95]">{f.percent}%</span></span>
                        <span className="font-mono text-[#4b4b47]">{RUB(f.allocated)}{pct < 0.999 && <span className="text-[#9a9a95]"> / {RUB(f.target)}</span>}</span>
                      </div>
                      <div className="h-[6px] rounded bg-[#f0f0ec] overflow-hidden">
                        <div className={`h-full rounded ${bar}`} style={{ width: `${Math.min(100, Math.round(pct * 100))}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
          {selWeekIncome.client > 0 && (
            <div className="flex justify-between pt-2 mt-2 border-t border-[#f0f0ee] text-[13px]">
              <span className="font-semibold text-blue-700">Перелив (остаток после всех процентов)</span>
              <span className="font-mono font-semibold text-blue-700">{RUB(wf.overflow)}</span>
            </div>
          )}
          <p className="text-[11px] text-[#9a9a95] mt-3">Waterfall сверху вниз: переменные → постоянные → фонды. При нехватке поступлений нижние фонды не наполняются.</p>
        </div>
      )}

      {subs.length > 0 && (
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <p className="text-[14px] font-semibold text-[#111110]">Что считать деньгами клиентов</p>
          <p className="text-[11px] text-[#9a9a95] mb-2">Отмеченное — не от клиентов: растит остаток на счетах, но не входит в план и в заливку фондов.</p>
          <div className="flex flex-wrap gap-1.5">
            {subs.map(s => (
              <button key={s.id} disabled={!isFin} onClick={() => toggleNonIncome(s)}
                className={`text-[12px] px-2 py-1 rounded-md border ${s.non_income ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-[#e4e4e0] text-[#4b4b47]'} ${isFin ? 'hover:border-[#111110]' : 'cursor-default'}`}>
                {s.non_income ? 'не от клиентов · ' : ''}{s.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
