'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import {
  analyzeBreakeven, combineUnits, withoutDebt, kindOf, allocationCheck, companyLevelCosts,
  BREAKEVEN_LABELS, BREAKEVEN_HINTS, DISTRIBUTION_NOTE, FIXED_KIND_LABELS,
  type BreakevenModel, type FixedRow, type FixedKind, type SharedCost,
} from '@/lib/breakeven'

// Финансовое планирование (модель Хаббарда) — точки безубыточности.
// Редактируются ДВА юнита: «Производство» и «M-Glass» (каждый хранится в finplan_models).
// Вкладка «Компания (всё)» — автоматическая сумма юнитов: доходы и переменные зеркалятся
// из юнитов, маржа складывается, одноимённые фонды и постоянные суммируются.
// Операционная ТБ, целевая выручка с фондами и с доходом собственника — lib/breakeven.ts.
// Остаток сверх всего = Фонд перелива, из него % на бонусы производства.

type VarRow  = { name: string; pct: number }
type Income  = { name: string; plan: number; vars: VarRow[] }
type Funds   = { invest: number; training: number; reserve: number; prodBonus: number }
type Model   = BreakevenModel & { incomes: Income[]; funds: Funds; fixed: FixedRow[] }

type EditUnit = 'mglass' | 'production'
type Unit = 'total' | 'total1' | EditUnit
const UNITS: { key: Unit; label: string }[] = [
  { key: 'total',      label: 'Компания 0' },
  { key: 'total1',     label: 'Компания 1 · без кредитов и лизинга' },
  { key: 'mglass',     label: 'M-Glass' },
  { key: 'production', label: 'Производство' },
]
const FUND_KEYS: [keyof Funds, string][] = [
  ['invest', 'Фонд возврата инвестиций'],
  ['training', 'Фонд обучения'],
  ['reserve', 'Резервный фонд'],
  ['prodBonus', 'Фонд бонусов производства 🏭'],
]

// ── Сиды из файла владельца «Мгласс_производство_оклады_лизинг_кредит_финал» ──
const GLASS_VARS: VarRow[] = [
  { name: 'Закуп сырья стекла + расходные материалы', pct: 31.33 },
  { name: 'Сдельная ЗП мастеров цеха', pct: 8.55 },
  { name: 'Сдельная ЗП менеджера ОП', pct: 1.0 },
  { name: 'Транспортные расходы (сырьё и изделия)', pct: 1.3 },
  { name: 'Налоги НДС, н/прибыль', pct: 5.55 },
  { name: 'ГСМ', pct: 1.48 },
]
const PRODUCT_VARS: VarRow[] = [
  { name: 'Закуп фурнитуры и расходников (силикон, клей…)', pct: 18 },
  { name: 'Закуп сырья стекла', pct: 15 },
  { name: 'Субподрядчики (партнёрские + покраска)', pct: 4 },
  { name: 'Сдельная ЗП: монтажники, конструктора, замерщики', pct: 18 },
  { name: 'Сдельная ЗП менеджеров ОП', pct: 2.5 },
  { name: 'Транспортные расходы (сырьё и изделия)', pct: 1.5 },
  { name: 'ГСМ', pct: 1.48 },
  { name: 'Сдельная ЗП отдела реализации', pct: 2.5 },
  { name: 'УСН', pct: 5 },
]
// Постоянные: оклады разнесены 390к MGlass + 1 030к цех = 1 420к; лизинг 400 000 —
// у производства; кредит 290 000 — у MGlass; аренда 750 000 = 250к MGlass + 500к цех.
// Общие статьи пока в обоих юнитах полными суммами (как в файле) — уточняются владельцем.
const FIXED_REST: FixedRow[] = [
  { name: 'Налоги с ЗП (НДФЛ, страховые)', amount: 200000 },
  { name: 'Страховки КАСКО, ОСАГО', amount: 25000 },
  { name: 'Связь, интернет', amount: 7000 },
  { name: 'ПО (CRM, ЭЦП и т.д.)', amount: 25000 },
  { name: 'Обслуживание авто', amount: 15000 },
  { name: 'Обслуживание оборудования', amount: 15000 },
  { name: 'Госпошлины, штрафы', amount: 7000 },
  { name: 'Инструмент, инвентарь', amount: 5000 },
  { name: 'Канц- и хозтовары', amount: 5000 },
  { name: 'Банковская комиссия', amount: 35000 },
  { name: 'Реклама, маркетинг', amount: 100000 },
  { name: 'Рекламные подрядчики', amount: 20000 },
  { name: 'Аутсорс бухгалтерия', amount: 150000 },
  { name: 'Взносы ИП', amount: 6710 },
  { name: 'Уборка помещений', amount: 4000 },
  { name: 'Вывоз мусора', amount: 10000 },
]
const buildFixed = (head: FixedRow[]): FixedRow[] => [...head, ...FIXED_REST.map(f => ({ ...f }))]
const DEFAULTS: Record<EditUnit, Model> = {
  mglass: {
    incomes: [{ name: 'M-Glass (B2C) — изделия с монтажом', plan: 6300000, vars: PRODUCT_VARS }],
    funds: { invest: 0, training: 0, reserve: 0, prodBonus: 0 },
    ownerPct: 0, ownerRub: 0, overflowBonusPct: 0,
    fixed: buildFixed([                                   // Σ 1 579 710
      { name: 'Аренда помещения (доля от 750 000)', amount: 250000 },
      { name: 'Коммунальные расходы', amount: 20000 },
      { name: 'ЗП оклады M-Glass (офис, продажи, замерщик)', amount: 390000 },
      { name: 'Кредит и проценты (кредит MGlass)', amount: 290000 },
    ]),
  },
  production: {
    incomes: [{ name: 'Производство (B2B) — продажа стекла', plan: 2400000, vars: GLASS_VARS }],
    funds: { invest: 0, training: 0, reserve: 0, prodBonus: 0 },
    ownerPct: 0, ownerRub: 0, overflowBonusPct: 0,
    fixed: buildFixed([                                   // Σ 2 579 710
      { name: 'Аренда помещения (доля от 750 000)', amount: 500000 },
      { name: 'Коммунальные расходы', amount: 20000 },
      { name: 'ЗП оклады производства (остаток ФОТ: 1 420к − 390к)', amount: 1030000 },
      { name: 'Лизинг (относится к производству)', amount: 400000 },
    ]),
  },
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
// без w-full: числовое поле с width:100% рядом с flex-1 отжимало поле названия в ноль
const inputCls = 'bg-white border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] font-mono text-[#111110] outline-none focus:border-[#111110] min-w-0 disabled:bg-[#fafaf8] disabled:border-[#eeeeea]'
const inputBlue = inputCls.replace('text-[#111110]', 'text-blue-700 font-semibold')

export default function BreakevenPage() {
  const sb = createClient()
  const [unit, setUnit] = useState<Unit>('total')
  const [models, setModels] = useState<Record<EditUnit, Model>>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)
  const [meName, setMeName] = useState('')
  // Настройки фонда перелива компании — хранятся в строке unit='total'
  const [ovCfg, setOvCfg] = useState({ bonusPct: 20, debtBalance: 0 })
  const [ovSaving, setOvSaving] = useState(false)
  const [ovSaved, setOvSaved] = useState(false)
  // Суммы общих статей по компании (строка total, поле shared) и черновик ввода
  const [shared, setShared] = useState<SharedCost[]>([])
  const [sharedDraft, setSharedDraft] = useState<Record<string, string>>({})
  const [shSaving, setShSaving] = useState(false)
  const [shSaved, setShSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await sb.auth.getUser()
    if (user) {
      const { data: p } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
      setMeName(p?.name ?? user.email ?? '')
    }
    const { data } = await sb.from('finplan_models').select('unit,data')
    if (data?.length) {
      setModels(prev => {
        const next = { ...prev }
        for (const row of data) {
          if (row.unit === 'total') {
            if (row.data?.overflowBonusPct != null || row.data?.debtBalance != null) {
              setOvCfg({ bonusPct: Number(row.data.overflowBonusPct) || 0, debtBalance: Number(row.data.debtBalance) || 0 })
            }
            if (Array.isArray(row.data?.shared)) setShared(row.data.shared as SharedCost[])
            continue
          }
          const u = row.unit as EditUnit
          if (row.data && Object.keys(row.data).length) next[u] = row.data as Model
        }
        return next
      })
    }
    setLoading(false)
  }, [sb])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  // Сверка общих расходов: сколько распределено по юнитам против суммы по компании
  const allocRows = useMemo(() => allocationCheck([
    { title: 'Производство', fixed: models.production.fixed },
    { title: 'M-Glass', fixed: models.mglass.fixed },
  ], shared), [models, shared])
  const companyExtra = useMemo(() => companyLevelCosts(allocRows), [allocRows])
  const allocIssues = allocRows.filter(r => r.status !== 'ok').length

  // «Компания» = сумма юнитов + нераспределённые остатки общих статей (только сохранённые суммы);
  // «Компания 1» — она же без кредитов и лизинга
  const totalModel = useMemo(() => {
    const t = combineUnits([models.production, models.mglass]) as Model
    return { ...t, fixed: [...t.fixed, ...companyExtra] }
  }, [models, companyExtra])
  const total1Model = useMemo(() => withoutDebt(totalModel) as Model, [totalModel])

  const ro = unit === 'total' || unit === 'total1' // read-only: сводки, правки — в юнитах
  const m = unit === 'total' ? totalModel : unit === 'total1' ? total1Model : models[unit]
  const patch = (fn: (m: Model) => Model) => {
    if (ro) return
    setModels(prev => ({ ...prev, [unit]: fn(structuredClone(prev[unit])) }))
  }

  async function save() {
    if (ro) return
    setSaving(true)
    try {
      await sb.from('finplan_models').upsert({ unit, data: models[unit], updated_by: meName || null, updated_at: new Date().toISOString() })
      setSavedOk(true); setTimeout(() => setSavedOk(false), 2000)
    } finally { setSaving(false) }
  }

  async function saveOverflow() {
    setOvSaving(true)
    try {
      // Строка total хранит и кассу (cashBalance) — сливаем, а не перезаписываем
      const { data: cur } = await sb.from('finplan_models').select('data').eq('unit', 'total').maybeSingle()
      await sb.from('finplan_models').upsert({
        unit: 'total',
        data: { ...(cur?.data ?? {}), overflowBonusPct: ovCfg.bonusPct, debtBalance: ovCfg.debtBalance },
        updated_by: meName || null, updated_at: new Date().toISOString(),
      })
      setOvSaved(true); setTimeout(() => setOvSaved(false), 2000)
    } finally { setOvSaving(false) }
  }

  async function saveShared() {
    setShSaving(true)
    try {
      const next: SharedCost[] = allocRows
        .map(r => {
          const raw = sharedDraft[r.key] ?? (r.totalSuggested || r.total == null ? '' : String(r.total))
          return { name: r.name, total: Number(raw) }
        })
        .filter(x => Number.isFinite(x.total) && x.total > 0)
      const { data: cur } = await sb.from('finplan_models').select('data').eq('unit', 'total').maybeSingle()
      await sb.from('finplan_models').upsert({
        unit: 'total', data: { ...(cur?.data ?? {}), shared: next },
        updated_by: meName || null, updated_at: new Date().toISOString(),
      })
      setShared(next); setSharedDraft({})
      setShSaved(true); setTimeout(() => setShSaved(false), 2000)
    } finally { setShSaving(false) }
  }

  // Плановые ежемесячные платежи по обязательствам юнитов
  const debtMonthly = [...models.production.fixed, ...models.mglass.fixed]
    .filter(f => kindOf(f).kind === 'obligation').reduce((s, f) => s + (f.amount || 0), 0)

  // ── Расчёт ──────────────────────────────────────────────────────────────────
  const calc = useMemo(() => {
    const a = analyzeBreakeven(m)
    return { ...a, fundRub: (pct: number) => a.margin * pct / 100 }
  }, [m])

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка…</div>

  // Строки постоянных с индексом в модели юнита (для правки) или с юнитом-источником (сводки).
  // На «Компании 1» обязательств нет — withoutDebt уже убрал их из модели.
  type Line = { f: FixedRow; fi: number; unitTitle?: string }
  const lines: Line[] = ro
    ? ([['Производство', models.production], ['M-Glass', models.mglass]] as [string, Model][])
        .flatMap(([title, um]) => (unit === 'total1' ? withoutDebt(um) : um).fixed.map(f => ({ f, fi: -1, unitTitle: title })))
        .concat(companyExtra.map(f => ({ f, fi: -1, unitTitle: 'Компания' })))
    : m.fixed.map((f, fi) => ({ f, fi }))
  const opexLines = lines.filter(l => kindOf(l.f).kind !== 'obligation')
  const debtLines = lines.filter(l => kindOf(l.f).kind === 'obligation')
  const suggestedCount = ro ? 0 : m.fixed.filter(f => !f.kind).length
  const setKind = (fi: number, kind: FixedKind) => patch(x => { x.fixed[fi].kind = kind; return x })

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Финмодель · Точка безубыточности</h1>
            <p className="text-[12px] text-[#9a9a95] mt-0.5">Доходы → переменные → маржа → расходы P&amp;L → денежные обязательства → распределение прибыли. Синие поля — редактируемые.</p>
          </div>
          {!ro && (
            <button onClick={save} disabled={saving}
              className="bg-[#111110] text-white text-[13px] font-semibold px-4 py-2 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40">
              {saving ? '…' : savedOk ? '✓ Сохранено' : '💾 Сохранить'}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          {UNITS.map(u => (
            <button key={u.key} onClick={() => setUnit(u.key)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${unit === u.key ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4]'}`}>
              {u.label}
            </button>
          ))}
          {ro && <span className="text-[11px] text-[#9a9a95] ml-1">Σ автоматическая сумма вкладок M-Glass и Производство{unit === 'total1' ? ' БЕЗ кредитов и лизинга' : ''} — правки вносите там</span>}
        </div>
        {unit === 'total' && allocIssues > 0 && (
          <p className="mt-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 inline-block">
            Общие расходы не сходятся с распределением по юнитам: {allocIssues} стат. — см. «Распределение общих расходов» ниже.
          </p>
        )}
      </div>

      <div className="px-5 pt-4 grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4 max-w-[1280px]">
        {/* ЛЕВАЯ КОЛОНКА — модель */}
        <div className="space-y-4">
          {/* Доходы */}
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95] mb-2">
              План по доходам, ₽/мес{ro && <span className="normal-case tracking-normal text-[#c4c4be]"> · из вкладок юнитов</span>}
            </p>
            {m.incomes.map((inc, ii) => (
              <div key={ii} className="flex items-center gap-2 mb-1.5">
                <input value={inc.name} placeholder="Название дохода" disabled={ro}
                  onChange={e => patch(x => { x.incomes[ii].name = e.target.value; return x })}
                  className={inputCls + ' flex-1'} />
                <input type="number" value={inc.plan || ''} disabled={ro}
                  onChange={e => patch(x => { x.incomes[ii].plan = Number(e.target.value) || 0; return x })}
                  className={inputBlue + ' w-36 shrink-0 text-right'} />
              </div>
            ))}
            <div className="flex justify-between text-[13px] font-bold border-t border-[#f0f0ec] pt-2 mt-2">
              <span>ИТОГО планируемые доходы</span><span className="font-mono">{fmt(calc.revenue)}</span>
            </div>
          </div>

          {/* Переменные по каждому виду дохода */}
          {m.incomes.map((inc, ii) => (
            <div key={ii} className="bg-white rounded-xl border border-[#e4e4e0] p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95] mb-2">
                Переменные расходы — {inc.name} <span className="normal-case text-[#c4c4be]">(% от этого дохода)</span>
              </p>
              {inc.vars.map((v, vi) => (
                <div key={vi} className="flex items-center gap-2 mb-1">
                  <input value={v.name} disabled={ro}
                    onChange={e => patch(x => { x.incomes[ii].vars[vi].name = e.target.value; return x })}
                    className={inputCls + ' flex-1'} />
                  <div className="flex items-center gap-1 w-24 shrink-0">
                    <input type="number" step="0.01" value={v.pct || ''} disabled={ro}
                      onChange={e => patch(x => { x.incomes[ii].vars[vi].pct = Number(e.target.value) || 0; return x })}
                      className={inputBlue + ' w-full text-right'} />
                    <span className="text-[11px] text-[#9a9a95]">%</span>
                  </div>
                  <span className="w-24 text-right font-mono text-[11px] text-[#6b6b66]">{fmt((inc.plan || 0) * (v.pct || 0) / 100)}</span>
                  {!ro && <button onClick={() => patch(x => { x.incomes[ii].vars.splice(vi, 1); return x })}
                    className="text-[#c4c4be] hover:text-red-500 text-[12px]">×</button>}
                </div>
              ))}
              {!ro && <button onClick={() => patch(x => { x.incomes[ii].vars.push({ name: '', pct: 0 }); return x })}
                className="text-[11px] text-[#9a9a95] hover:text-[#111110] mt-1">+ строка</button>}
              <div className="border-t border-[#f0f0ec] pt-2 mt-2 space-y-1 text-[12px]">
                <div className="flex justify-between"><span className="text-[#6b6b66]">Итого переменные</span>
                  <span className="font-mono">{(calc.perIncome[ii].varPct * 100).toFixed(2)}% · {fmt(calc.perIncome[ii].varRub)}</span></div>
                <div className="flex justify-between font-semibold"><span>Маржинальная прибыль</span>
                  <span className="font-mono text-emerald-700">{(calc.perIncome[ii].marginPct * 100).toFixed(2)}% · {fmt(calc.perIncome[ii].margin)}</span></div>
              </div>
            </div>
          ))}

          {/* Общая маржа (на сводке — сумма юнитов) */}
          {ro && (
            <div className="bg-white rounded-xl border border-[#e4e4e0] p-4 flex justify-between items-center">
              <span className="text-[13px] font-bold">МАРЖИНАЛЬНАЯ ПРИБЫЛЬ — производство + M-Glass</span>
              <span className="font-mono text-[15px] font-bold text-emerald-700">{fmt(calc.margin)} · {(calc.marginPct * 100).toFixed(1)}%</span>
            </div>
          )}

          {/* 1. Операционные расходы P&L */}
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <div className="flex items-baseline justify-between gap-2 mb-2 flex-wrap">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95]">
                Операционные расходы P&amp;L, ₽/мес{ro && <span className="normal-case tracking-normal text-[#c4c4be]"> · производство + M-Glass</span>}
              </p>
              {suggestedCount > 0 && (
                <button onClick={() => patch(x => { x.fixed.forEach(f => { if (!f.kind) f.kind = kindOf(f).kind }); return x })}
                  className="text-[11px] text-amber-700 border border-amber-300 rounded-md px-2 py-0.5 hover:bg-amber-50">
                  Принять предложенные типы ({suggestedCount}) — затем «Сохранить»
                </button>
              )}
            </div>
            <p className="text-[11px] text-[#9a9a95] mb-2">Входят в операционную точку безубыточности. Тип статьи с пунктирной рамкой предложен по названию и не сохранён.</p>
            {opexLines.map((l, i) => (
              <div key={`${l.unitTitle ?? ''}${l.fi}-${i}`} className="flex items-center gap-2 mb-1">
                {l.unitTitle && <span className="w-20 shrink-0 text-[10px] text-[#9a9a95] truncate">{l.unitTitle}</span>}
                <input value={l.f.name} disabled={ro} onChange={e => patch(x => { x.fixed[l.fi].name = e.target.value; return x })}
                  className={inputCls + ' flex-1'} />
                <KindSelect f={l.f} disabled={ro} onChange={k => setKind(l.fi, k)} />
                <input type="number" value={l.f.amount || ''} disabled={ro} onChange={e => patch(x => { x.fixed[l.fi].amount = Number(e.target.value) || 0; return x })}
                  className={inputBlue + ' w-28 shrink-0 text-right'} />
                {!ro && <button onClick={() => patch(x => { x.fixed.splice(l.fi, 1); return x })}
                  className="text-[#c4c4be] hover:text-red-500 text-[12px]">×</button>}
              </div>
            ))}
            {!ro && <button onClick={() => patch(x => { x.fixed.push({ name: '', amount: 0, kind: 'fixed' }); return x })}
              className="text-[11px] text-[#9a9a95] hover:text-[#111110] mt-1">+ строка</button>}
            <div className="border-t border-[#f0f0ec] pt-2 mt-2 space-y-1 text-[12px]">
              <div className="flex justify-between"><span className="text-[#6b6b66]">Постоянные без обязательств</span>
                <span className="font-mono">{fmt(calc.split.opex)}</span></div>
              {calc.split.interest > 0 && (
                <div className="flex justify-between"><span className="text-[#6b6b66]">+ проценты по обязательствам{calc.split.unsplit.length > 0 ? ' (вместе с телом — не разделены)' : ''}</span>
                  <span className="font-mono">{fmt(calc.split.interest)}</span></div>
              )}
              {calc.split.amortization > 0 && (
                <div className="flex justify-between"><span className="text-[#6b6b66]">+ амортизация лизинга (без движения денег)</span>
                  <span className="font-mono">{fmt(calc.split.amortization)}</span></div>
              )}
              <div className="flex justify-between text-[13px] font-bold"><span>Итого расходы P&amp;L</span>
                <span className="font-mono">{fmt(calc.split.pnl)}</span></div>
            </div>
          </div>

          {/* Распределение общих расходов (ТЗ 1.5) */}
          {unit === 'total' && allocRows.length > 0 && (
            <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
              <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95]">Распределение общих расходов, ₽/мес</p>
                <button onClick={saveShared} disabled={shSaving}
                  className="text-[11px] font-semibold border border-[#e4e4e0] rounded-lg px-2 py-1 hover:bg-[#f5f5f3] disabled:opacity-40">
                  {shSaving ? '…' : shSaved ? '✓ Сохранено' : '💾 Сохранить суммы по компании'}
                </button>
              </div>
              <p className="text-[11px] text-[#9a9a95] mb-2">
                Общий расход = на M-Glass + на Производство + на уровне компании. Сумма серым — взята из названия статьи и не сохранена.
                Нераспределённый остаток попадает в «Компанию» только после сохранения.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px] whitespace-nowrap">
                  <thead>
                    <tr className="text-[10px] text-[#9a9a95] border-b border-[#f0f0ec]">
                      <th className="text-left font-medium py-1 pr-2">Статья</th>
                      <th className="text-right font-medium py-1 px-2">Производство</th>
                      <th className="text-right font-medium py-1 px-2">M-Glass</th>
                      <th className="text-right font-medium py-1 px-2">Всего по компании</th>
                      <th className="text-right font-medium py-1 px-2">На уровне компании</th>
                      <th className="text-left font-medium py-1 pl-2">Сверка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocRows.map(r => (
                      <tr key={r.key} className="border-b border-[#f5f5f3] last:border-0">
                        <td className="py-1 pr-2 text-[#111110] max-w-[220px] truncate">{r.name}</td>
                        <td className="py-1 px-2 text-right font-mono text-[#6b6b66]">{r.byUnit['Производство'] != null ? fmt(r.byUnit['Производство']) : '—'}</td>
                        <td className="py-1 px-2 text-right font-mono text-[#6b6b66]">{r.byUnit['M-Glass'] != null ? fmt(r.byUnit['M-Glass']) : '—'}</td>
                        <td className="py-1 px-2 text-right">
                          <input type="number" inputMode="numeric"
                            value={sharedDraft[r.key] ?? (r.totalSuggested || r.total == null ? '' : String(r.total))}
                            placeholder={r.totalSuggested && r.total != null ? String(r.total) : '—'}
                            onChange={e => setSharedDraft(d => ({ ...d, [r.key]: e.target.value }))}
                            className={inputBlue + ' w-28 text-right placeholder:text-[#b8b8b2]'} />
                        </td>
                        <td className="py-1 px-2 text-right font-mono">{r.total != null ? fmt(Math.max(0, r.total - r.allocated)) : '—'}</td>
                        <td className={`py-1 pl-2 ${r.status === 'over' ? 'text-red-600' : r.status === 'ok' ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {r.status === 'ok' ? 'сходится'
                            : r.status === 'over' ? `распределено на ${fmt(r.allocated - (r.total ?? 0))} больше`
                            : r.status === 'company' ? `не распределено ${fmt((r.total ?? 0) - r.allocated)}${r.totalSuggested ? ' (по названию)' : ''}`
                            : 'в двух юнитах — общая статья или две разные?'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 2. Денежные обязательства */}
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95] mb-1">Денежные обязательства, ₽/мес</p>
            <p className="text-[11px] text-[#9a9a95] mb-2">
              Платёж по кредиту или лизингу = проценты + тело. Проценты — финансовый расход P&amp;L, тело — возврат долга: в операционную точку не входит, но деньги на него нужны.
            </p>
            {unit === 'total1' ? (
              <p className="text-[12px] text-[#9a9a95]">На этой вкладке кредиты и лизинг исключены.</p>
            ) : debtLines.length === 0 ? (
              <p className="text-[12px] text-[#9a9a95]">Обязательств нет.</p>
            ) : debtLines.map((l, i) => {
              const split = l.f.body != null || l.f.amortization != null
              const body = Math.min(Math.max(l.f.body || 0, 0), l.f.amount || 0)
              return (
                <div key={`${l.unitTitle ?? ''}${l.fi}-${i}`} className="mb-2 pb-2 border-b border-[#f5f5f3] last:border-0">
                  <div className="flex items-center gap-2">
                    {l.unitTitle && <span className="w-20 shrink-0 text-[10px] text-[#9a9a95] truncate">{l.unitTitle}</span>}
                    <input value={l.f.name} disabled={ro} onChange={e => patch(x => { x.fixed[l.fi].name = e.target.value; return x })}
                      className={inputCls + ' flex-1'} />
                    <KindSelect f={l.f} disabled={ro} onChange={k => setKind(l.fi, k)} />
                    <input type="number" value={l.f.amount || ''} disabled={ro} title="Платёж в месяц"
                      onChange={e => patch(x => { x.fixed[l.fi].amount = Number(e.target.value) || 0; return x })}
                      className={inputBlue + ' w-28 shrink-0 text-right'} />
                    {!ro && <button onClick={() => patch(x => { x.fixed.splice(l.fi, 1); return x })}
                      className="text-[#c4c4be] hover:text-red-500 text-[12px]">×</button>}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap text-[11px] text-[#6b6b66]">
                    <label className="flex items-center gap-1">тело
                      <input type="number" value={l.f.body ?? ''} disabled={ro} placeholder="—"
                        onChange={e => patch(x => { x.fixed[l.fi].body = e.target.value === '' ? undefined : Number(e.target.value) || 0; return x })}
                        className={inputBlue + ' w-24 text-right'} /></label>
                    <label className="flex items-center gap-1">амортизация
                      <input type="number" value={l.f.amortization ?? ''} disabled={ro} placeholder="—"
                        onChange={e => patch(x => { x.fixed[l.fi].amortization = e.target.value === '' ? undefined : Number(e.target.value) || 0; return x })}
                        className={inputBlue + ' w-24 text-right'} /></label>
                    <span>проценты = платёж − тело: <span className="font-mono text-[#111110]">{fmt((l.f.amount || 0) - body)}</span></span>
                  </div>
                  {!split && (
                    <p className="text-[11px] text-amber-700 mt-1">
                      Тело и проценты не разделены — вся сумма стоит в расходах P&amp;L, операционная точка завышена на тело долга.
                    </p>
                  )}
                </div>
              )
            })}
            {!ro && <button onClick={() => patch(x => { x.fixed.push({ name: '', amount: 0, kind: 'obligation' }); return x })}
              className="text-[11px] text-[#9a9a95] hover:text-[#111110] mt-1">+ обязательство</button>}
            {unit !== 'total1' && debtLines.length > 0 && (
              <div className="border-t border-[#f0f0ec] pt-2 mt-2 space-y-1 text-[12px]">
                <div className="flex justify-between"><span className="text-[#6b6b66]">Платежи всего</span>
                  <span className="font-mono">{fmt(calc.split.interest + calc.split.body)}</span></div>
                <div className="flex justify-between font-semibold"><span>из них тело долга</span>
                  <span className="font-mono">{fmt(calc.split.body)}</span></div>
              </div>
            )}
          </div>

          {/* 3. Распределение прибыли и фонды */}
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95] mb-1">
              Распределение прибыли и фонды{ro && <span className="normal-case tracking-normal text-[#c4c4be]"> · одноимённые фонды юнитов суммируются, % — от общей маржи</span>}
            </p>
            <p className="text-[11px] text-[#9a9a95] mb-2">{DISTRIBUTION_NOTE}</p>
            {FUND_KEYS.map(([k, label]) => (
              <div key={k} className="flex items-center gap-2 mb-1">
                <span className="flex-1 text-[12px] text-[#111110]">{label}</span>
                <div className="flex items-center gap-1 w-24 shrink-0">
                  <input type="number" step="0.1" value={ro ? (m.funds[k] ? Number(m.funds[k].toFixed(2)) : '') : (m.funds[k] || '')} disabled={ro}
                    onChange={e => patch(x => { x.funds[k] = Number(e.target.value) || 0; return x })}
                    className={inputBlue + ' w-full text-right'} />
                  <span className="text-[11px] text-[#9a9a95]">%</span>
                </div>
                <span className="w-24 text-right font-mono text-[11px] text-[#6b6b66]">{fmt(calc.fundRub(m.funds[k]))}</span>
              </div>
            ))}
            <div className="border-t border-[#f0f0ec] pt-2 mt-2 space-y-1 text-[12px]">
              <div className="flex justify-between"><span className="text-[#6b6b66]">Итого фонды из маржи</span>
                <span className="font-mono">{(calc.fundsShare * 100).toFixed(1)}% · {fmt(calc.fundsRub)}</span></div>
            </div>

            <p className="text-[11px] font-semibold text-[#6b6b66] mt-3 mb-1">Доход собственника</p>
            {ro ? (
              <p className="text-[12px] text-[#6b6b66]">Σ по юнитам при плановой выручке: <span className="font-mono font-semibold text-[#111110]">{fmt(calc.ownerRub)}</span> /мес — задаётся во вкладках M-Glass и Производство.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-[12px] text-[#6b6b66]">% от маржи
                    <input type="number" step="0.5" value={m.ownerPct || ''} onChange={e => patch(x => { x.ownerPct = Number(e.target.value) || 0; return x })}
                      className={inputBlue + ' w-full mt-1 text-right'} /></label>
                  <label className="text-[12px] text-[#6b6b66]">+ фикс, ₽/мес
                    <input type="number" value={m.ownerRub || ''} onChange={e => patch(x => { x.ownerRub = Number(e.target.value) || 0; return x })}
                      className={inputBlue + ' w-full mt-1 text-right'} /></label>
                </div>
                <p className="text-[11px] text-[#9a9a95] mt-2">Процент и фикс складываются.</p>
              </>
            )}
          </div>
        </div>

        {/* ПРАВАЯ КОЛОНКА — итоги */}
        <div className="space-y-3 xl:sticky xl:top-4 self-start">
          <div className="bg-[#111110] text-white rounded-xl p-4 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a8a85]">Итоги при плановой выручке {fmt(calc.revenue)}</p>
            <div className="flex justify-between text-[13px]"><span className="text-[#c4c4be]">Маржа</span>
              <span className="font-mono">{fmt(calc.margin)} · {(calc.marginPct * 100).toFixed(1)}%</span></div>
            <div className="flex justify-between text-[13px]"><span className="text-[#c4c4be]">Постоянные без обязательств</span>
              <span className="font-mono">−{fmt(calc.split.opex)}</span></div>
            {calc.split.interest + calc.split.body > 0 && (calc.split.unsplit.length > 0 ? (
              <div className="flex justify-between text-[13px]"><span className="text-[#c4c4be]">Платежи по долгу (не разделены)</span>
                <span className="font-mono">−{fmt(calc.split.interest + calc.split.body)}</span></div>
            ) : (
              <>
                <div className="flex justify-between text-[13px]"><span className="text-[#c4c4be]">Проценты по долгу</span>
                  <span className="font-mono">−{fmt(calc.split.interest)}</span></div>
                <div className="flex justify-between text-[13px]"><span className="text-[#c4c4be]">Тело долга</span>
                  <span className="font-mono">−{fmt(calc.split.body)}</span></div>
              </>
            ))}
            <div className="flex justify-between text-[13px]"><span className="text-[#c4c4be]">Фонды из маржи</span>
              <span className="font-mono">−{fmt(calc.fundsRub)}</span></div>
            {calc.ownerRub > 0 && (
              <div className="flex justify-between text-[13px]"><span className="text-[#c4c4be]">Доход собственника</span>
                <span className="font-mono">−{fmt(calc.ownerRub)}</span></div>
            )}
            <div className={`flex justify-between text-[15px] font-bold border-t border-white/15 pt-2 ${calc.remainder >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              <span>Остаток</span><span className="font-mono">{calc.remainder >= 0 ? '+' : ''}{fmt(calc.remainder)}</span>
            </div>
          </div>

          {([
            [BREAKEVEN_LABELS.tb0, calc.tb0, BREAKEVEN_HINTS.tb0],
            [BREAKEVEN_LABELS.tb1, calc.tb1, BREAKEVEN_HINTS.tb1],
            [BREAKEVEN_LABELS.tbTarget, calc.tbTarget, BREAKEVEN_HINTS.tbTarget],
          ] as [string, number | null, string][]).map(([title, val, hint]) => (
            <div key={title} className="bg-white rounded-xl border border-[#e4e4e0] p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95]">{title}</p>
              <p className="text-[22px] font-bold font-mono text-[#111110] mt-1">{val != null ? fmt(val) : '—'}<span className="text-[12px] text-[#9a9a95] font-sans"> /мес</span></p>
              {val != null && calc.revenue > 0 && (
                <div className="mt-2">
                  <div className="h-1.5 bg-[#f0f0ec] rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${calc.revenue >= val ? 'bg-emerald-500' : 'bg-amber-400'}`}
                      style={{ width: `${Math.min(100, calc.revenue / val * 100)}%` }} />
                  </div>
                  <p className="text-[11px] text-[#9a9a95] mt-1">
                    план {Math.round(calc.revenue / val * 100)}% от этой выручки{calc.revenue >= val ? ' — выше точки ✓' : ` — не хватает ${fmt(val - calc.revenue)}`}
                  </p>
                </div>
              )}
              <p className="text-[10px] text-[#c4c4be] mt-1.5">{hint}</p>
              {title === BREAKEVEN_LABELS.tb0 && calc.split.unsplit.length > 0 && (
                <p className="text-[11px] text-amber-700 mt-1.5">
                  Завышена: в ней тело долга — не разделены {calc.split.unsplit.join(', ')}.
                </p>
              )}
              {title === BREAKEVEN_LABELS.tb0 && calc.split.unsplit.length === 0 && calc.split.body > 0 && calc.tbCash != null && (
                <p className="text-[11px] text-[#6b6b66] mt-1.5">С платежами по телу долга: <span className="font-mono">{fmt(calc.tbCash)}</span></p>
              )}
            </div>
          ))}
          <p className="text-[11px] text-[#9a9a95] px-1 leading-relaxed">{DISTRIBUTION_NOTE}</p>

          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-700">Фонд перелива</p>
            <p className="text-[18px] font-bold font-mono text-emerald-800 mt-1">{fmt(calc.overflow)}</p>
            <p className="text-[11px] text-emerald-700 mt-0.5">
              {calc.remainder >= 0
                ? `Всё распределено (фонды, постоянные${(m.ownerPct || m.ownerRub) ? ', собственник' : ''}) — это излишек при плановой выручке.`
                : 'План ниже точки — перелива нет, бонусы из него не начисляются.'}
            </p>
            {(
              <div className="mt-2 pt-2 border-t border-emerald-200 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] text-emerald-800 flex-1">→ бонусы производства</span>
                  <div className="flex items-center gap-1 w-20 shrink-0">
                    <input type="number" step="1" value={ovCfg.bonusPct || ''}
                      onChange={e => setOvCfg(c => ({ ...c, bonusPct: Number(e.target.value) || 0 }))}
                      className={inputBlue + ' w-full text-right'} />
                    <span className="text-[11px] text-emerald-700">%</span>
                  </div>
                  <span className="font-mono text-[12px] font-semibold text-emerald-800 w-24 text-right">{fmt(calc.overflow * ovCfg.bonusPct / 100)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-emerald-800">{unit === 'total1' ? `→ свободный остаток (${100 - ovCfg.bonusPct}%)` : `→ досрочное погашение обязательств (${100 - ovCfg.bonusPct}%)`}</span>
                  <span className="font-mono text-[12px] font-semibold text-emerald-800">{fmt(calc.overflow * (100 - ovCfg.bonusPct) / 100)}</span>
                </div>
                {!ro && <p className="text-[10px] text-emerald-600">% единый для компании и юнитов — здесь применён к переливу этого юнита.</p>}
                {unit === 'total' && (
                  <>
                    <label className="flex items-center justify-between gap-2 text-[12px] text-emerald-800">Тело долга (кредиты+лизинг), ₽
                      <input type="number" value={ovCfg.debtBalance || ''}
                        onChange={e => setOvCfg(c => ({ ...c, debtBalance: Number(e.target.value) || 0 }))}
                        className={inputBlue + ' w-32 shrink-0 text-right'} />
                    </label>
                    {ovCfg.debtBalance > 0 && calc.overflow * (100 - ovCfg.bonusPct) / 100 > 0 && (
                      <p className="text-[11px] text-emerald-700">
                        Переливом гасится ~{Math.ceil(ovCfg.debtBalance / (calc.overflow * (100 - ovCfg.bonusPct) / 100))} мес — это СВЕРХ плановых платежей {fmt(debtMonthly)}/мес.
                      </p>
                    )}
                  </>
                )}
                <button onClick={saveOverflow} disabled={ovSaving}
                  className="text-[11px] font-semibold text-emerald-800 border border-emerald-300 rounded-lg px-2 py-1 hover:bg-emerald-100 disabled:opacity-40">
                  {ovSaving ? '…' : ovSaved ? '✓ Сохранено' : '💾 Сохранить настройки перелива'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function KindSelect({ f, disabled, onChange }: { f: FixedRow; disabled: boolean; onChange: (k: FixedKind) => void }) {
  const { kind, suggested } = kindOf(f)
  return (
    <select value={kind} disabled={disabled} onChange={e => onChange(e.target.value as FixedKind)}
      title={suggested ? 'Предложено по названию — не сохранено' : undefined}
      className={`w-44 shrink-0 text-[11px] rounded-lg px-1.5 py-1 border outline-none disabled:opacity-80 ${suggested ? 'border-dashed border-amber-300 text-amber-800 bg-amber-50/60' : 'border-[#e4e4e0] text-[#4b4b47] bg-white'}`}>
      {(Object.keys(FIXED_KIND_LABELS) as FixedKind[]).map(k => (
        <option key={k} value={k}>{FIXED_KIND_LABELS[k]}</option>
      ))}
    </select>
  )
}
