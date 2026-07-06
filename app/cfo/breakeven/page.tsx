'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'

// Финансовое планирование (модель Хаббарда) — точки безубыточности.
// Редактируются ДВА юнита: «Производство» и «M-Glass» (каждый хранится в finplan_models).
// Вкладка «Компания (всё)» — автоматическая сумма юнитов: доходы и переменные зеркалятся
// из юнитов, маржа складывается, одноимённые фонды и постоянные суммируются.
// ТБ-0 — выручка «в ноль» без фондов; ТБ-1 — с фондами; ТБ-цель — с доходом собственника.
// Остаток сверх всего = Фонд перелива, из него % на бонусы производства.

type VarRow  = { name: string; pct: number }
type Income  = { name: string; plan: number; vars: VarRow[] }
type FixedRow = { name: string; amount: number }
type Funds   = { invest: number; training: number; reserve: number; prodBonus: number }
type Model   = {
  incomes: Income[]
  funds: Funds
  ownerPct: number        // дивиденды собственника, % от маржи (для ТБ-цель)
  ownerRub: number        // или фикс ₽/мес (суммируются)
  overflowBonusPct: number // % фонда перелива → бонусы производства
  fixed: FixedRow[]
}

type EditUnit = 'mglass' | 'production'
type Unit = 'total' | EditUnit
const UNITS: { key: Unit; label: string }[] = [
  { key: 'total',      label: 'Компания (всё)' },
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
const marginOf = (m: Model) => m.incomes.reduce((s, i) => {
  const varPct = i.vars.reduce((x, v) => x + (v.pct || 0), 0) / 100
  return s + (i.plan || 0) * (1 - varPct)
}, 0)
const fixedOf = (m: Model) => m.fixed.reduce((s, f) => s + (f.amount || 0), 0)
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

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await sb.auth.getUser()
    if (user) {
      const { data: p } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
      setMeName(p?.name ?? user.email ?? '')
    }
    const { data } = await sb.from('finplan_models').select('unit,data').in('unit', ['mglass', 'production'])
    if (data?.length) {
      setModels(prev => {
        const next = { ...prev }
        for (const row of data) {
          const u = row.unit as EditUnit
          if (row.data && Object.keys(row.data).length) next[u] = row.data as Model
        }
        return next
      })
    }
    setLoading(false)
  }, [sb])

  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  // «Компания» = сумма юнитов: доходы/переменные зеркалятся, фонды и постоянные суммируются.
  // Фонды выражаем эффективным % от общей маржи, чтобы ₽-суммы точно равнялись Σ юнитов.
  const totalModel = useMemo<Model>(() => {
    const p = models.production, g = models.mglass
    const mP = marginOf(p), mG = marginOf(g), mSum = mP + mG
    const eff = (k: keyof Funds) => mSum > 0 ? (mP * (p.funds[k] || 0) + mG * (g.funds[k] || 0)) / mSum : 0
    return {
      incomes: [...structuredClone(p.incomes), ...structuredClone(g.incomes)],
      funds: { invest: eff('invest'), training: eff('training'), reserve: eff('reserve'), prodBonus: eff('prodBonus') },
      ownerPct: 0,
      ownerRub: Math.round((p.ownerRub || 0) + (p.ownerPct || 0) / 100 * mP + (g.ownerRub || 0) + (g.ownerPct || 0) / 100 * mG),
      overflowBonusPct: 0,
      fixed: [...structuredClone(p.fixed), ...structuredClone(g.fixed)],
    }
  }, [models])

  const ro = unit === 'total' // read-only: сводка, правки — в юнитах
  const m = ro ? totalModel : models[unit]
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

  // ── Расчёт ──────────────────────────────────────────────────────────────────
  const calc = useMemo(() => {
    const revenue = m.incomes.reduce((s, i) => s + (i.plan || 0), 0)
    const perIncome = m.incomes.map(inc => {
      const varPct = inc.vars.reduce((s, v) => s + (v.pct || 0), 0) / 100
      const varRub = (inc.plan || 0) * varPct
      return { varPct, varRub, margin: (inc.plan || 0) - varRub, marginPct: 1 - varPct }
    })
    const margin = perIncome.reduce((s, x) => s + x.margin, 0)
    const weightedMarginPct = revenue > 0 ? margin / revenue : 0
    const fundsPct = (m.funds.invest + m.funds.training + m.funds.reserve + m.funds.prodBonus) / 100
    const fundsRub = margin * fundsPct
    const distributable = margin - fundsRub
    const fixed = m.fixed.reduce((s, f) => s + (f.amount || 0), 0)
    const remainder = distributable - fixed              // фонд перелива, если > 0
    const overflow = Math.max(0, remainder)
    const overflowBonus = overflow * (m.overflowBonusPct || 0) / 100

    // ТБ: Выручка × маржа% × (1 − доли от маржи) = Постоянные (+ доход собственника ₽)
    const be = (fPct: number, oPct: number, oRub: number) => {
      const denom = weightedMarginPct * (1 - fPct - oPct / 100)
      return denom > 0 ? (fixed + oRub) / denom : null
    }
    const tb0 = be(0, 0, 0)
    const tb1 = be(fundsPct, 0, 0)
    const tbTarget = be(fundsPct, m.ownerPct || 0, m.ownerRub || 0)

    return {
      revenue, perIncome, margin, weightedMarginPct, fundsPct, fundsRub,
      distributable, fixed, remainder, overflow, overflowBonus, tb0, tb1, tbTarget,
      fundRub: (p: number) => margin * p / 100,
    }
  }, [m])

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка…</div>

  // Постоянные на «Компании» рендерим группами по юнитам (границы — по длинам списков)
  const fixedGroups = ro ? [
    { title: 'Производство', rows: models.production.fixed, sum: fixedOf(models.production) },
    { title: 'M-Glass', rows: models.mglass.fixed, sum: fixedOf(models.mglass) },
  ] : null

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Финмодель · Точка безубыточности</h1>
            <p className="text-[12px] text-[#9a9a95] mt-0.5">Доходы → переменные (% от дохода) → маржа → фонды от маржи → постоянные. Синие поля — редактируемые.</p>
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
          {ro && <span className="text-[11px] text-[#9a9a95] ml-1">Σ автоматическая сумма вкладок M-Glass и Производство — правки вносите там</span>}
        </div>
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
              <span className="font-mono text-[15px] font-bold text-emerald-700">{fmt(calc.margin)} · {(calc.weightedMarginPct * 100).toFixed(1)}%</span>
            </div>
          )}

          {/* Фонды от маржи */}
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95] mb-2">
              Фонды от маржи, %{ro && <span className="normal-case tracking-normal text-[#c4c4be]"> · одноимённые фонды юнитов суммируются, % — от общей маржи</span>}
            </p>
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
                <span className="font-mono">{(calc.fundsPct * 100).toFixed(1)}% · {fmt(calc.fundsRub)}</span></div>
              <div className="flex justify-between font-semibold"><span>Сумма на распределение</span>
                <span className="font-mono">{fmt(calc.distributable)}</span></div>
            </div>
          </div>

          {/* Постоянные */}
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95] mb-2">
              Постоянные расходы, ₽/мес{ro && <span className="normal-case tracking-normal text-[#c4c4be]"> · производство + M-Glass</span>}
            </p>
            {fixedGroups ? fixedGroups.map(gr => (
              <div key={gr.title} className="mb-3">
                <p className="text-[11px] font-semibold text-[#6b6b66] mb-1">{gr.title}</p>
                {gr.rows.map((f, fi) => (
                  <div key={fi} className="flex items-center gap-2 mb-1">
                    <input value={f.name} disabled className={inputCls + ' flex-1'} />
                    <input type="number" value={f.amount || ''} disabled className={inputBlue + ' w-32 shrink-0 text-right'} />
                  </div>
                ))}
                <div className="flex justify-between text-[12px] text-[#6b6b66] pt-1">
                  <span>Итого {gr.title}</span><span className="font-mono">{fmt(gr.sum)}</span>
                </div>
              </div>
            )) : m.fixed.map((f, fi) => (
              <div key={fi} className="flex items-center gap-2 mb-1">
                <input value={f.name} onChange={e => patch(x => { x.fixed[fi].name = e.target.value; return x })}
                  className={inputCls + ' flex-1'} />
                <input type="number" value={f.amount || ''} onChange={e => patch(x => { x.fixed[fi].amount = Number(e.target.value) || 0; return x })}
                  className={inputBlue + ' w-32 shrink-0 text-right'} />
                <button onClick={() => patch(x => { x.fixed.splice(fi, 1); return x })}
                  className="text-[#c4c4be] hover:text-red-500 text-[12px]">×</button>
              </div>
            ))}
            {!ro && <button onClick={() => patch(x => { x.fixed.push({ name: '', amount: 0 }); return x })}
              className="text-[11px] text-[#9a9a95] hover:text-[#111110] mt-1">+ строка</button>}
            <div className="flex justify-between text-[13px] font-bold border-t border-[#f0f0ec] pt-2 mt-2">
              <span>Итого постоянных</span><span className="font-mono">{fmt(calc.fixed)}</span>
            </div>
          </div>

          {/* Цель собственника */}
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95] mb-2">Доход собственника (для ТБ-цель)</p>
            {ro ? (
              <p className="text-[12px] text-[#6b6b66]">Σ по юнитам: <span className="font-mono font-semibold text-[#111110]">{fmt(m.ownerRub)}</span> /мес — задаётся во вкладках M-Glass и Производство.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-[12px] text-[#6b6b66]">% от маржи
                    <input type="number" step="0.5" value={m.ownerPct || ''} onChange={e => patch(x => { x.ownerPct = Number(e.target.value) || 0; return x })}
                      className={inputBlue + ' w-full mt-1 text-right'} /></label>
                  <label className="text-[12px] text-[#6b6b66]">или фикс, ₽/мес
                    <input type="number" value={m.ownerRub || ''} onChange={e => patch(x => { x.ownerRub = Number(e.target.value) || 0; return x })}
                      className={inputBlue + ' w-full mt-1 text-right'} /></label>
                </div>
                <label className="block text-[12px] text-[#6b6b66] mt-3">Из фонда перелива → бонусы производства, %
                  <input type="number" step="1" value={m.overflowBonusPct || ''} onChange={e => patch(x => { x.overflowBonusPct = Number(e.target.value) || 0; return x })}
                    className={inputBlue + ' mt-1 text-right w-32'} /></label>
              </>
            )}
          </div>
        </div>

        {/* ПРАВАЯ КОЛОНКА — итоги */}
        <div className="space-y-3 xl:sticky xl:top-4 self-start">
          <div className="bg-[#111110] text-white rounded-xl p-4 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a8a85]">Итоги при плановой выручке {fmt(calc.revenue)}</p>
            <div className="flex justify-between text-[13px]"><span className="text-[#c4c4be]">Маржа</span>
              <span className="font-mono">{fmt(calc.margin)} · {(calc.weightedMarginPct * 100).toFixed(1)}%</span></div>
            <div className="flex justify-between text-[13px]"><span className="text-[#c4c4be]">Фонды из маржи</span>
              <span className="font-mono">−{fmt(calc.fundsRub)}</span></div>
            <div className="flex justify-between text-[13px]"><span className="text-[#c4c4be]">Постоянные</span>
              <span className="font-mono">−{fmt(calc.fixed)}</span></div>
            <div className={`flex justify-between text-[15px] font-bold border-t border-white/15 pt-2 ${calc.remainder >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              <span>Остаток</span><span className="font-mono">{calc.remainder >= 0 ? '+' : ''}{fmt(calc.remainder)}</span>
            </div>
          </div>

          {([
            ['ТБ-0 · в ноль без фондов', calc.tb0, 'Чистые расходы: переменные + постоянные, фонды не откладываются'],
            ['ТБ-1 · с фондами', calc.tb1, 'С отчислениями в фонды (возврат инвестиций, обучение, резерв, бонусы)'],
            ['ТБ-цель · с доходом собственника', calc.tbTarget, 'Фонды + дивиденды собственника'],
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
                    план {Math.round(calc.revenue / val * 100)}% от ТБ{calc.revenue >= val ? ' — выше точки ✓' : ` — не хватает ${fmt(val - calc.revenue)}`}
                  </p>
                </div>
              )}
              <p className="text-[10px] text-[#c4c4be] mt-1.5">{hint}</p>
            </div>
          ))}

          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-700">Фонд перелива</p>
            <p className="text-[18px] font-bold font-mono text-emerald-800 mt-1">{fmt(calc.overflow)}</p>
            <p className="text-[11px] text-emerald-700 mt-0.5">Всё распределено (фонды, постоянные{(m.ownerPct || m.ownerRub) ? ', собственник' : ''}) — это излишек при плановой выручке.</p>
            {!ro && m.overflowBonusPct > 0 && (
              <p className="text-[12px] font-semibold text-emerald-800 mt-1.5">→ бонусы производства из перелива ({m.overflowBonusPct}%): {fmt(calc.overflowBonus)}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
