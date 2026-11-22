'use client'

// Финнеделя чт–ср (ТЗ ФП 22.11, Ф1). Месяц считает операции по их дате:
// периоды = недели по средам, обрезанные месяцем, + «До конца месяца». План
// месяца делится по рабочим дням; недобор завершённого периода — на оставшиеся.
// План и заливка фондов — только деньги клиентов; заём, вклад учредителя и
// возвраты показаны отдельно. Расчёты — lib/finweek.ts (чистые, с тестами).

import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { AccountsRecon } from '@/components/accounting/AccountsRecon'
import { DistributionBlock } from '@/components/accounting/DistributionBlock'
import { monthPeriods, buildPeriodPlans, monthStatus, incomeSplit, defaultSplit, manualFits, toKop, type StoredPeriod } from '@/lib/finweek'

type Fund = { id: number; unit: string; flow: string; fund_class: string; name: string; percent: number | null; sort: number }
type Entry = { entry_date: string; kind: string; fund_id: number; subfund_id: number | null; amount: number }
type Sub = { id: number; fund_id: number; name: string; non_income: boolean }
type PlanMeta = { periods: StoredPeriod[] | null; revenue_target: number | null; note: string | null; approved_at: string | null; approved_by: string | null }
type Snap = { period_end: string; fact_period: number; plan_period: number; lag: number; taken_at: string }
const num = (v: string) => Number(v.replace(/\s/g, '').replace(',', '.'))

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

export function FinweekTab({ unit, funds, isFin, myName, showBreakevenLink }: {
  unit: 'ip' | 'ooo'; funds: Fund[]; isFin: boolean; myName: string; showBreakevenLink: boolean
}) {
  const canApprove = showBreakevenLink // cfo, admin, ceo
  const sb = createClient()
  const [month, setMonth] = useState('')
  const [today, setToday] = useState('')
  const [plan, setPlan] = useState<number | null>(null)
  const [planDraft, setPlanDraft] = useState('')
  const [editPlan, setEditPlan] = useState(false)
  const [tbTargets, setTbTargets] = useState<{ unit: string; label: string; tb0: number | null; tb1: number | null; tbTarget: number | null }[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [subs, setSubs] = useState<Sub[]>([])
  const [meta, setMeta] = useState<PlanMeta | null>(null)
  const [snaps, setSnaps] = useState<Snap[]>([])
  const [split, setSplit] = useState<string[] | null>(null)
  const [revDraft, setRevDraft] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
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
    const [p, e, s, sn] = await Promise.all([
      sb.from('cashflow_month_plans').select('plan_amount,periods,revenue_target,note,approved_at,approved_by').eq('unit', unit).eq('month', month).maybeSingle(),
      sb.from('cashflow_entries').select('entry_date,kind,fund_id,subfund_id,amount')
        .eq('unit', unit).gte('entry_date', from).lte('entry_date', to).range(0, 9999),
      incomeFundIds.length
        ? sb.from('cashflow_subfunds').select('id,fund_id,name,non_income').in('fund_id', incomeFundIds).eq('active', true).order('sort')
        : Promise.resolve({ data: [] }),
      sb.from('cashflow_period_snapshots').select('period_end,fact_period,plan_period,lag,taken_at').eq('unit', unit).eq('month', month),
    ])
    setPlan(p.data ? Number((p.data as { plan_amount: number }).plan_amount) : null)
    setMeta(p.data ? (p.data as unknown as PlanMeta) : null)
    setSnaps((sn.data ?? []) as Snap[])
    setSplit(null)
    setEntries((e.data ?? []) as Entry[])
    setSubs((s.data ?? []) as Sub[])
  }, [sb, unit, month, periods, incomeFundIds])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  const unitFunds = useMemo(() => funds.filter(f => f.unit === unit), [funds, unit])
  const nonIncome = useMemo(() => new Set(subs.filter(s => s.non_income).map(s => s.id)), [subs])
  const byPeriod = useMemo(() => periods.map(p => incomeSplit(entries, p.start, p.end, nonIncome)), [periods, entries, nonIncome])
  const rows = useMemo(() =>
    today ? buildPeriodPlans(plan ?? 0, periods, byPeriod.map(x => x.client), today, meta?.periods) : [],
  [plan, periods, byPeriod, today, meta])
  const manualOk = plan != null && manualFits(plan, periods, meta?.periods)
  const approved = !!meta?.approved_at && manualOk
  const snapByEnd = useMemo(() => new Map(snaps.map(x => [x.period_end, x])), [snaps])
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

  async function toggleNonIncome(sub: Sub) {
    const { data, error } = await sb.from('cashflow_subfunds').update({ non_income: !sub.non_income }).eq('id', sub.id).select('id')
    if (error || !data?.length) { flash('Не сохранилось' + (error ? ': ' + error.message : ' — нет прав')); return }
    flash(!sub.non_income ? `«${sub.name}» — не от клиентов ✓` : `«${sub.name}» — деньги клиентов ✓`)
    await load()
  }

  async function savePlan() {
    const amount = Number(planDraft.replace(/\s/g, '').replace(',', '.'))
    if (!(amount >= 0)) { flash('Введи сумму плана'); return }
    const rev = revDraft.trim() ? num(revDraft) : null
    if (rev != null && !(rev >= 0)) { flash('Цель по выручке — число'); return }
    const changed = plan == null || toKop(amount) !== toKop(plan)
    const { data, error } = await sb.from('cashflow_month_plans').upsert(
      {
        unit, month, plan_amount: amount, revenue_target: rev, note: noteDraft.trim() || null,
        ...(changed ? { periods: null, approved_at: null, approved_by: null } : {}),
        updated_by: myName, updated_at: new Date().toISOString(),
      },
      { onConflict: 'unit,month' },
    ).select('id')
    if (error || !data?.length) { flash('Не сохранилось' + (error ? ': ' + error.message : ' — нет прав')); return }
    setEditPlan(false)
    flash(changed && meta?.approved_at ? 'План изменён — разбивку нужно утвердить заново' : 'План месяца сохранён ✓')
    await load()
  }

  const draft = split ?? (meta?.periods && manualFits(plan ?? 0, periods, meta.periods)
    ? meta.periods.map(m => String(m.amount))
    : defaultSplit(plan ?? 0, periods).map(String))
  const draftKop = draft.reduce((s, v) => s + toKop(num(v) || 0), 0)
  const draftDiff = plan != null ? (draftKop - toKop(plan)) / 100 : 0
  const draftValid = draft.every(v => num(v) >= 0)

  async function saveSplit(approve: boolean) {
    if (plan == null) return
    if (!draftValid) { flash('Суммы периодов — неотрицательные числа'); return }
    if (approve && draftDiff !== 0) { flash('Разбивка не сходится с месяцем'); return }
    const stored: StoredPeriod[] = periods.map((p, i) => ({ start: p.start, end: p.end, amount: toKop(num(draft[i])) / 100 }))
    const { data, error } = await sb.from('cashflow_month_plans').update({
      periods: stored,
      approved_at: approve ? new Date().toISOString() : null,
      approved_by: approve ? myName : null,
      updated_by: myName, updated_at: new Date().toISOString(),
    }).eq('unit', unit).eq('month', month).select('id')
    if (error || !data?.length) { flash('Не сохранилось' + (error ? ': ' + error.message : ' — нет прав')); return }
    flash(approve ? 'План утверждён ✓' : 'Разбивка сохранена черновиком ✓')
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
              <div>
                <p className="text-[22px] font-bold text-[#111110]">
                  {plan != null ? RUB(plan) : <span className="text-[#9a9a95] text-[15px] font-normal">не задан</span>}
                </p>
                {plan != null && (approved
                  ? <p className="text-[11px] text-emerald-700">утверждён {meta?.approved_at && new Date(meta.approved_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}{meta?.approved_by && ` · ${meta.approved_by}`}</p>
                  : <p className="text-[11px] text-amber-700">не утверждён — разбивка ниже</p>)}
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 mt-1">
                  <input value={planDraft} onChange={e => setPlanDraft(e.target.value)} inputMode="decimal" placeholder="10 000 000" autoFocus
                    className="w-[160px] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[16px] font-mono outline-none focus:border-[#111110]" />
                  <button onClick={savePlan} className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[13px] font-semibold">Сохранить</button>
                  <button onClick={() => setEditPlan(false)} className="px-2 py-1.5 text-[13px] text-[#9a9a95]">отмена</button>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <label className="text-[11px] text-[#9a9a95]">Цель по выручке</label>
                  <input value={revDraft} onChange={e => setRevDraft(e.target.value)} inputMode="decimal" placeholder="из ТБ"
                    className="w-[140px] border border-[#e4e4e0] rounded-lg px-2 py-1 text-[13px] font-mono outline-none focus:border-[#111110]" />
                </div>
                <input value={noteDraft} onChange={e => setNoteDraft(e.target.value)} placeholder="Почему план денег отличается от выручки (авансы, долги клиентов…)"
                  className="w-full mt-2 border border-[#e4e4e0] rounded-lg px-2 py-1 text-[13px] outline-none focus:border-[#111110]" />
                {tbTargets.length > 0 && (
                  <div className="mt-2">
                    <p className="text-[11px] text-[#9a9a95] mb-1">Цель по выручке из финмодели (ТБ):</p>
                    <div className="flex flex-wrap gap-1.5">
                      {tbTargets.flatMap(t => ([
                        t.tb1 != null && { key: `${t.unit}-tb1`, label: `${t.label} · с фондами`, val: t.tb1 },
                        t.tbTarget != null && { key: `${t.unit}-tbt`, label: `${t.label} · с доходом собственника`, val: t.tbTarget },
                      ].filter(Boolean) as { key: string; label: string; val: number }[])).map(o => (
                        <button key={o.key} onClick={() => { setRevDraft(String(Math.round(o.val))); if (!planDraft.trim()) setPlanDraft(String(Math.round(o.val))) }}
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
              setPlanDraft(plan != null ? String(plan) : ''); setEditPlan(true)
              setRevDraft(meta?.revenue_target != null ? String(meta.revenue_target) : ''); setNoteDraft(meta?.note ?? '')
              if (showBreakevenLink && tbTargets.length === 0) {
                fetch('/api/cfo/breakeven-targets').then(r => r.ok ? r.json() : { targets: [] })
                  .then(d => setTbTargets(d.targets ?? [])).catch(() => {})
              }
            }}
              className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] text-[#6b6b66]">✎ план</button>
          )}
        </div>
        {!editPlan && plan != null && meta?.revenue_target != null && (
          <p className="text-[12px] text-[#4b4b47] mt-2">
            Цель по выручке {RUB(meta.revenue_target)} · план денег {RUB(plan)} · разница {plan - meta.revenue_target >= 0 ? '+' : '−'}{RUB(Math.abs(plan - meta.revenue_target))}
            {meta.note ? <> — {meta.note}</> : Math.round(plan) !== Math.round(meta.revenue_target) && <span className="text-amber-700"> — без пояснения</span>}
          </p>
        )}
        <p className="text-[11px] text-[#9a9a95] mt-2">
          Источник плана — точка безубыточности перед началом месяца{showBreakevenLink && <> (<a href="/cfo/breakeven" className="text-blue-600">открыть ТБ ↗</a>)</>}.
          Пока разбивка не утверждена, план делится по рабочим дням; недобор завершённого периода — на оставшиеся, исходный план виден рядом.
          Месяц считает деньги по дате поступления, неделя совещания — все семь дней чт–ср.
        </p>
      </div>

      {today && <AccountsRecon unit={unit} isFin={isFin} myName={myName} today={today} />}

      {plan != null && isFin && (
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
            <p className="text-[14px] font-semibold text-[#111110]">Разбивка плана по периодам</p>
            <button onClick={() => setSplit(defaultSplit(plan, periods).map(String))} className="text-[12px] text-blue-600">по рабочим дням</button>
          </div>
          {periods.map((p, i) => (
            <div key={p.start} className="flex items-center justify-between gap-2 py-1 text-[13px]">
              <span className="text-[#4b4b47] whitespace-nowrap">{p.tail ? 'До конца месяца' : `${DD(p.start)} — ср ${DD(p.end)}`}</span>
              <input value={draft[i]} inputMode="decimal"
                onChange={e => { const next = [...draft]; next[i] = e.target.value; setSplit(next) }}
                className="w-[140px] text-right border border-[#e4e4e0] rounded-lg px-2 py-1 font-mono text-[13px] outline-none focus:border-[#111110]" />
            </div>
          ))}
          <p className={`text-[12px] mt-2 ${draftDiff === 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            {draftDiff === 0 ? 'Сходится с месяцем до копейки' : `Не сходится: ${draftDiff > 0 ? 'больше' : 'меньше'} месяца на ${Math.abs(draftDiff).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`}
          </p>
          <div className="flex gap-2 mt-2 flex-wrap">
            <button onClick={() => saveSplit(false)} className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] text-[#4b4b47]">Сохранить черновик</button>
            {canApprove && (
              <button onClick={() => saveSplit(true)} disabled={draftDiff !== 0 || !draftValid}
                className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[12px] font-semibold disabled:opacity-40">Утвердить</button>
            )}
          </div>
          {approved && <p className="text-[11px] text-[#9a9a95] mt-2">Новое сохранение снимает утверждение — план придётся утвердить заново.</p>}
        </div>
      )}

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
              <span className="font-mono text-right text-[#111110]">
                {w.fact > 0 || w.completed || w.current ? RUB(w.fact) : '—'}
                {(() => {
                  const sn = snapByEnd.get(w.period.end)
                  if (!sn) return null
                  const late = toKop(w.fact) - toKop(Number(sn.fact_period))
                  return <span className="block text-[10px] text-[#9a9a95]">{late === 0 ? 'снимок ✓' : `на среду ${RUB(Number(sn.fact_period))}, позже ${late > 0 ? '+' : '−'}${RUB(Math.abs(late) / 100)}`}</span>
                })()}
              </span>
              <span className={`font-mono text-right ${dev == null ? 'text-[#9a9a95]' : dev < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                {dev == null ? '—' : (dev >= 0 ? '+' : '−') + RUB(Math.abs(dev)).replace(' ₽', '') }
              </span>
            </button>
          )
        })}
      </div>

      {selRow && selWeekIncome && selWeekIncome.nonIncome > 0 && (
        <p className="text-[12px] text-[#6b6b66] px-1">За неделю до ср {DD(selRow.period.week.end)} ещё {RUB(selWeekIncome.nonIncome)} не от клиентов (заём, свои, возвраты) — в распределение не идут.</p>
      )}
      {selRow && today && (
        <DistributionBlock unit={unit} month={month} weekEnd={selRow.period.week.end} today={today} funds={unitFunds}
          entries={entries} nonIncome={nonIncome} monthPlan={plan} canApprove={canApprove} myName={myName} />
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
