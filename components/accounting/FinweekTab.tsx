'use client'

// Б3: финнеделя чт–ср. Месячный план (из точки безубыточности) делится на
// недели; недобор завершённой недели добавляется к оставшимся, перевыполнение
// вычитается. Поступления выбранной недели наполняют фонды waterfall сверху
// вниз по процентам финмодели. Расчёты — в lib/finweek.ts (чистые, с тестами).

import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { finWeeksOfMonth, buildWeekPlans, waterfall, inWeek } from '@/lib/finweek'

type Fund = { id: number; unit: string; flow: string; fund_class: string; name: string; percent: number | null; sort: number }
type Entry = { entry_date: string; kind: string; fund_id: number; amount: number }

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
  const [entries, setEntries] = useState<Entry[]>([])
  const [selIdx, setSelIdx] = useState<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2800) }

  useEffect(() => {
    const now = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToday(now)
    setMonth(now.slice(0, 7))
  }, [])

  const weeks = useMemo(() => (month ? finWeeksOfMonth(month) : []), [month])

  const load = useCallback(async () => {
    if (!weeks.length) return
    const [p, e] = await Promise.all([
      sb.from('cashflow_month_plans').select('plan_amount').eq('unit', unit).eq('month', month).maybeSingle(),
      sb.from('cashflow_entries').select('entry_date,kind,fund_id,amount')
        .eq('unit', unit).gte('entry_date', weeks[0].start).lte('entry_date', weeks[weeks.length - 1].end),
    ])
    setPlan(p.data ? Number((p.data as { plan_amount: number }).plan_amount) : null)
    setEntries((e.data ?? []) as Entry[])
  }, [sb, unit, month, weeks])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  const unitFunds = useMemo(() => funds.filter(f => f.unit === unit), [funds, unit])
  const factByWeek = useMemo(() =>
    weeks.map(w => entries.reduce((s, e) => s + (e.kind === 'in' && inWeek(e.entry_date, w) ? Number(e.amount) : 0), 0)),
  [weeks, entries])
  const weekPlans = useMemo(() =>
    today ? buildWeekPlans(plan ?? 0, weeks, factByWeek, today) : [],
  [plan, weeks, factByWeek, today])

  const defaultIdx = useMemo(() => {
    const cur = weeks.findIndex(w => inWeek(today, w))
    if (cur >= 0) return cur
    const done = weeks.filter(w => w.end < today).length
    return done > 0 ? done - 1 : 0
  }, [weeks, today])
  const sel = selIdx ?? defaultIdx
  const selWeek = weekPlans[sel]
  const wf = useMemo(() => selWeek ? waterfall(selWeek.fact, unitFunds) : null, [selWeek, unitFunds])

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

  const monthFact = factByWeek.reduce((s, v) => s + v, 0)

  return (
    <div className="space-y-3">
      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl shadow-lg text-[13px] font-semibold bg-[#111110] text-white">{toast}</div>}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => { setMonth(shiftMonth(month, -1)); setSelIdx(null) }} className="px-2.5 py-1 rounded-md border border-[#e4e4e0] text-[13px]">←</button>
          <span className="text-[14px] font-semibold text-[#111110] capitalize min-w-[120px] text-center">{month && monthLabel(month)}</span>
          <button onClick={() => { setMonth(shiftMonth(month, 1)); setSelIdx(null) }} className="px-2.5 py-1 rounded-md border border-[#e4e4e0] text-[13px]">→</button>
        </div>
        <span className="text-[12px] text-[#9a9a95]">{weeks.length} фин. недель (чт–ср)</span>
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
              <div className="flex items-center gap-2 mt-1">
                <input value={planDraft} onChange={e => setPlanDraft(e.target.value)} inputMode="decimal" placeholder="10 000 000" autoFocus
                  className="w-[160px] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[16px] font-mono outline-none focus:border-[#111110]" />
                <button onClick={savePlan} className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[13px] font-semibold">Сохранить</button>
                <button onClick={() => setEditPlan(false)} className="px-2 py-1.5 text-[13px] text-[#9a9a95]">отмена</button>
              </div>
            )}
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-widest text-[#9a9a95]">Факт месяца</p>
            <p className="text-[22px] font-bold text-emerald-700">{RUB(monthFact)}</p>
          </div>
          {isFin && !editPlan && (
            <button onClick={() => { setPlanDraft(plan != null ? String(Math.round(plan)) : ''); setEditPlan(true) }}
              className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] text-[#6b6b66]">✎ план</button>
          )}
        </div>
        <p className="text-[11px] text-[#9a9a95] mt-2">
          Источник плана — точка безубыточности перед началом месяца{showBreakevenLink && <> (<a href="/cfo/breakeven" className="text-blue-600">открыть ТБ ↗</a>)</>}.
          Недобор недели добавляется к плану оставшихся недель, перевыполнение — вычитается.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 sm:gap-x-4 px-4 py-2 text-[11px] uppercase tracking-widest text-[#9a9a95] border-b border-[#f0f0ee]">
          <span>Неделя</span><span className="text-right">План</span><span className="text-right">Факт</span><span className="text-right">Откл.</span>
        </div>
        {weekPlans.map((w, i) => {
          const dev = w.completed || w.current ? w.deviation : null
          return (
            <button key={w.week.start} onClick={() => setSelIdx(i)}
              className={`w-full grid grid-cols-[1fr_auto_auto_auto] gap-x-2 sm:gap-x-4 px-4 py-2.5 text-[13px] border-b border-[#f0f0ee] last:border-b-0 text-left ${i === sel ? 'bg-[#f5f5f3]' : ''}`}>
              <span className="text-[#111110] whitespace-nowrap">
                чт {DD(w.week.start)} — ср {DD(w.week.end)}
                {w.current && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-semibold align-middle">текущая</span>}
                {w.completed && <span className="ml-2 text-[10px] text-[#9a9a95] align-middle">завершена</span>}
              </span>
              <span className="font-mono text-right text-[#111110]">
                {RUB(w.plan)}
                {Math.round(w.plan) !== Math.round(w.base) && <span className="block text-[10px] text-[#9a9a95]">база {RUB(w.base)}</span>}
              </span>
              <span className="font-mono text-right text-[#111110]">{w.fact > 0 || w.completed || w.current ? RUB(w.fact) : '—'}</span>
              <span className={`font-mono text-right ${dev == null ? 'text-[#9a9a95]' : dev < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                {dev == null ? '—' : (dev >= 0 ? '+' : '−') + RUB(Math.abs(dev)).replace(' ₽', '') }
              </span>
            </button>
          )
        })}
      </div>

      {selWeek && wf && (
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-[14px] font-semibold text-[#111110]">Наполнение фондов · чт {DD(selWeek.week.start)} — ср {DD(selWeek.week.end)}</p>
            <p className="text-[12px] text-[#9a9a95]">поступило {RUB(selWeek.fact)}</p>
          </div>
          {selWeek.fact <= 0 && <p className="text-[13px] text-[#9a9a95]">Поступлений за неделю пока нет — фонды не наполнялись.</p>}
          {selWeek.fact > 0 && (['variable', 'fixed', 'fund'] as const).map(cls => {
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
          {selWeek.fact > 0 && (
            <div className="flex justify-between pt-2 mt-2 border-t border-[#f0f0ee] text-[13px]">
              <span className="font-semibold text-blue-700">Перелив (остаток после всех процентов)</span>
              <span className="font-mono font-semibold text-blue-700">{RUB(wf.overflow)}</span>
            </div>
          )}
          <p className="text-[11px] text-[#9a9a95] mt-3">Waterfall сверху вниз: переменные → постоянные → фонды. При нехватке поступлений нижние фонды не наполняются.</p>
        </div>
      )}
    </div>
  )
}
