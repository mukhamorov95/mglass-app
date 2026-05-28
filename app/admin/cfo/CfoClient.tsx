'use client'

import { useState } from 'react'
import type { MonthRevenue, CfoSettings, PricingRow } from './page'

type Props = {
  months: MonthRevenue[]
  initialSettings: CfoSettings
  pricingRows: PricingRow[]
}

const TAX_SYSTEMS = [
  { value: 'usn_6',  label: 'ИП УСН 6%' },
  { value: 'usn_15', label: 'ИП УСН 15%' },
  { value: 'osno',   label: 'ООО ОСНО' },
]

const MONTH_NAMES = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']

const INSURANCE_MONTHLY = 4125 // ~49,500/year ÷ 12

function fmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + ' млн ₽'
  if (n >= 1_000)     return Math.round(n / 1_000) + ' тыс ₽'
  return n.toLocaleString('ru-RU') + ' ₽'
}

function fmtShort(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return Math.round(n / 1_000) + 'k'
  return String(Math.round(n))
}

// ─── Financial formulas ───────────────────────────────────────────────────────

function calcTB0(fc: number, vcPct: number): number {
  const margin = 1 - vcPct / 100
  if (margin <= 0) return Infinity
  return fc / margin
}

function calcTB1(fc: number, vcPct: number, splitPct: number): number {
  const margin = 1 - vcPct / 100
  if (margin <= 0 || splitPct >= 1) return Infinity
  return fc / (margin * (1 - splitPct))
}

function calcDds(revenue: number, taxSystem: string, vcPct: number, fc: number) {
  const cogs = revenue * (vcPct / 100)

  if (taxSystem === 'usn_6') {
    const rawTax = revenue * 0.06
    const deduction = Math.min(INSURANCE_MONTHLY, rawTax * 0.5)
    const tax = rawTax - deduction
    const net = revenue - cogs - fc - INSURANCE_MONTHLY - tax
    return { cogs, tax, insurance: INSURANCE_MONTHLY, vatNet: 0, net }
  }

  if (taxSystem === 'usn_15') {
    const base = Math.max(revenue - cogs - fc, 0)
    const tax = Math.max(base * 0.15, revenue * 0.01)
    const net = revenue - cogs - fc - INSURANCE_MONTHLY - tax
    return { cogs, tax, insurance: INSURANCE_MONTHLY, vatNet: 0, net }
  }

  // ООО ОСНО
  const vatOut = revenue * (20 / 120)
  const vatIn  = cogs * 0.7 * (20 / 120)
  const vatNet = vatOut - vatIn
  const revExVat  = revenue - vatOut
  const cogsExVat = cogs   - vatIn
  const profitBefore = revExVat - cogsExVat - fc
  const incomeTax    = Math.max(profitBefore * 0.20, 0)
  const net          = (profitBefore - incomeTax) * (1 - 0.13)
  return { cogs, tax: incomeTax, insurance: 0, vatNet, net }
}

// ─── SVG Bar Chart ────────────────────────────────────────────────────────────

function RevenueChart({
  months,
  tb0,
  tb1,
}: {
  months: MonthRevenue[]
  tb0: number
  tb1: number
}) {
  const W = 640
  const H = 160
  const padL = 48
  const padR = 8
  const padT = 12
  const padB = 24

  const chartW = W - padL - padR
  const chartH = H - padT - padB

  const maxVal = Math.max(...months.map(m => m.revenue), tb1 * 1.05, 1)
  const scale  = (v: number) => chartH - (v / maxVal) * chartH

  const barW   = Math.floor(chartW / months.length) - 2
  const barGap = Math.floor((chartW - barW * months.length) / (months.length + 1))

  const yLines = [0, 0.25, 0.5, 0.75, 1].map(f => maxVal * f)

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block">
      {/* Y-axis grid */}
      {yLines.map((v, i) => (
        <g key={i}>
          <line
            x1={padL} y1={padT + scale(v)}
            x2={padL + chartW} y2={padT + scale(v)}
            stroke="#e4e4e0" strokeWidth="1"
          />
          <text
            x={padL - 4} y={padT + scale(v) + 4}
            textAnchor="end" fontSize="9" fill="#9a9a95"
          >
            {fmtShort(v)}
          </text>
        </g>
      ))}

      {/* Bars */}
      {months.map((m, i) => {
        const x = padL + barGap + i * (barW + barGap)
        const barH = Math.max((m.revenue / maxVal) * chartH, 1)
        const y = padT + chartH - barH
        const label = MONTH_NAMES[parseInt(m.month.split('-')[1]) - 1]
        const isCurrentMonth = i === months.length - 1

        return (
          <g key={m.month}>
            <rect
              x={x} y={y} width={barW} height={barH}
              rx="2"
              fill={isCurrentMonth ? '#111110' : '#d4d4d0'}
            />
            <text
              x={x + barW / 2} y={H - 4}
              textAnchor="middle" fontSize="8" fill="#9a9a95"
            >
              {label}
            </text>
          </g>
        )
      })}

      {/* TB0 line */}
      {tb0 < maxVal * 1.1 && (
        <g>
          <line
            x1={padL} y1={padT + scale(tb0)}
            x2={padL + chartW} y2={padT + scale(tb0)}
            stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 3"
          />
          <text x={padL + chartW - 2} y={padT + scale(tb0) - 3} textAnchor="end" fontSize="8" fill="#f59e0b">
            ТБ0
          </text>
        </g>
      )}

      {/* TB1 line */}
      {tb1 < maxVal * 1.1 && (
        <g>
          <line
            x1={padL} y1={padT + scale(tb1)}
            x2={padL + chartW} y2={padT + scale(tb1)}
            stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 3"
          />
          <text x={padL + chartW - 2} y={padT + scale(tb1) - 3} textAnchor="end" fontSize="8" fill="#ef4444">
            ТБ1
          </text>
        </g>
      )}
    </svg>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

const PRODUCT_LABELS: Record<string, string> = {
  mirror:           'Зеркало без подсветки',
  mirror_light:     'Зеркало с подсветкой',
  loft:             'Лофт-перегородка',
  shower_budget:    'Душевая (бюджет)',
  shower_standard:  'Душевая (стандарт)',
}

function PricingModelBlock({ rows }: { rows: PricingRow[] }) {
  const [sampleCost, setSampleCost] = useState(2000)
  const [activeIdx, setActiveIdx] = useState(0)

  const row = rows[activeIdx]
  if (!row) return null

  const margin  = row.default_margin
  const tax     = row.tax_percent
  const denom   = 1 - margin / 100 - tax / 100
  const price   = denom > 0 ? Math.round(sampleCost / denom) : 0
  const taxAmt  = Math.round(price * tax   / 100)
  const mrgAmt  = Math.round(price * margin / 100)
  const costPct = Math.round(100 - margin - tax)

  return (
    <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#e4e4e0]">
        <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Модель ценообразования</p>
        <p className="text-[10px] text-[#c4c4be] mt-0.5">
          Цена клиенту = Себестоимость ÷ (1 − Маржа% − Налог%)
        </p>
      </div>

      {/* Product tabs */}
      <div className="flex border-b border-[#e4e4e0] overflow-x-auto">
        {rows.map((r, i) => (
          <button
            key={r.id}
            onClick={() => setActiveIdx(i)}
            className={`px-3 py-2 text-[10px] font-medium whitespace-nowrap border-r border-[#e4e4e0] transition-colors ${
              i === activeIdx
                ? 'bg-[#111110] text-white'
                : 'text-[#6b6b66] hover:bg-[#f5f5f3]'
            }`}
          >
            {PRODUCT_LABELS[r.product_type] ?? r.product_type}
          </button>
        ))}
      </div>

      <div className="p-4 grid grid-cols-[1fr_280px] gap-6">
        {/* Left: visual decomposition */}
        <div className="space-y-4">
          {/* Formula params */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Маржа',  value: `${margin}%`,          color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
              { label: 'Налог',  value: `${tax}%`,             color: 'bg-slate-50 text-slate-600 border-slate-200' },
              { label: 'Множитель к себест.', value: `×${(1/denom).toFixed(2)}`, color: 'bg-[#f5f5f3] text-[#111110] border-[#e4e4e0]' },
            ].map(item => (
              <div key={item.label} className={`rounded-lg border px-3 py-2.5 ${item.color}`}>
                <p className="text-[10px] opacity-70">{item.label}</p>
                <p className="text-lg font-bold font-mono mt-0.5">{item.value}</p>
              </div>
            ))}
          </div>

          {/* Stacked bar */}
          <div>
            <p className="text-[10px] text-[#9a9a95] mb-1.5">Структура цены клиенту (1 заказ)</p>
            <div className="flex h-8 rounded-lg overflow-hidden text-white text-[10px] font-bold">
              <div
                className="flex items-center justify-center bg-[#2563eb] transition-all"
                style={{ width: `${costPct}%` }}
                title="Себестоимость"
              >
                {costPct >= 15 && `${costPct}%`}
              </div>
              <div
                className="flex items-center justify-center bg-emerald-500 transition-all"
                style={{ width: `${margin}%` }}
                title="Маржа"
              >
                {margin >= 10 && `${margin}%`}
              </div>
              <div
                className="flex items-center justify-center bg-slate-400 transition-all"
                style={{ width: `${tax}%` }}
                title="Налог"
              >
                {tax >= 8 && `${tax}%`}
              </div>
            </div>
            <div className="flex gap-4 mt-1.5">
              {[
                { label: 'Себестоимость', color: 'bg-[#2563eb]' },
                { label: 'Маржа (прибыль)', color: 'bg-emerald-500' },
                { label: `Налог УСН ${tax}%`, color: 'bg-slate-400' },
              ].map(item => (
                <span key={item.label} className="flex items-center gap-1 text-[10px] text-[#6b6b66]">
                  <span className={`inline-block w-2 h-2 rounded-sm ${item.color}`} />
                  {item.label}
                </span>
              ))}
            </div>
          </div>

          {/* Min margin & discount info */}
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div className="bg-[#fafaf9] rounded-lg border border-[#e4e4e0] px-3 py-2">
              <p className="text-[10px] text-[#9a9a95]">Минимальная маржа</p>
              <p className="font-bold text-red-600 font-mono">{row.min_margin}%</p>
              <p className="text-[10px] text-[#c4c4be] mt-0.5">ниже — продаём в убыток</p>
            </div>
            <div className="bg-[#fafaf9] rounded-lg border border-[#e4e4e0] px-3 py-2">
              <p className="text-[10px] text-[#9a9a95]">Макс. скидка менеджера</p>
              <p className="font-bold text-amber-600 font-mono">{row.max_discount_percent}%</p>
              <p className="text-[10px] text-[#c4c4be] mt-0.5">при скидке {row.max_discount_percent}% маржа ≈ {Math.max(0, Math.round(margin - row.max_discount_percent * (1/denom)))}%</p>
            </div>
          </div>
        </div>

        {/* Right: interactive calculator */}
        <div className="bg-[#fafaf9] rounded-xl border border-[#e4e4e0] p-4 space-y-4">
          <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Калькулятор</p>

          <div>
            <label className="text-[10px] text-[#9a9a95] block mb-1">Себестоимость изделия, ₽</label>
            <input
              type="number"
              value={sampleCost}
              onChange={e => setSampleCost(Math.max(0, Number(e.target.value)))}
              className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-sm font-mono font-bold focus:outline-none focus:border-[#111110] bg-white"
            />
          </div>

          <div className="space-y-2 text-xs">
            {[
              { label: 'Себестоимость',      value: sampleCost,             color: 'text-[#2563eb]' },
              { label: `Маржа ${margin}%`,   value: mrgAmt,                 color: 'text-emerald-600' },
              { label: `Налог ${tax}%`,      value: taxAmt,                 color: 'text-[#6b6b66]' },
            ].map(row => (
              <div key={row.label} className="flex justify-between">
                <span className="text-[#9a9a95]">{row.label}</span>
                <span className={`font-mono font-medium ${row.color}`}>
                  {row.value.toLocaleString('ru-RU')} ₽
                </span>
              </div>
            ))}
            <div className="flex justify-between pt-2 border-t border-[#e4e4e0]">
              <span className="font-semibold text-[#111110]">Цена клиенту</span>
              <span className="font-bold font-mono text-[#111110] text-sm">
                {price.toLocaleString('ru-RU')} ₽
              </span>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-[#e4e4e0] px-3 py-2 text-[10px] text-[#6b6b66]">
            <p className="font-mono text-[#111110] mb-1">
              {sampleCost.toLocaleString('ru-RU')} ÷ {denom.toFixed(2)} = {price.toLocaleString('ru-RU')} ₽
            </p>
            <p>знаменатель: 1 − {margin/100} − {tax/100} = {denom.toFixed(2)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function CfoClient({ months, initialSettings, pricingRows }: Props) {
  const [s, setS] = useState<CfoSettings>(initialSettings)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const fc = s.fixed_costs.rent + s.fixed_costs.utilities + s.fixed_costs.payroll +
             s.fixed_costs.payroll_tax + s.fixed_costs.leasing + s.fixed_costs.credit +
             s.fixed_costs.marketing + s.fixed_costs.outsource + s.fixed_costs.other
  const splitPct = (s.profit_split.owner_pct + s.profit_split.education_pct + s.profit_split.reserve_pct) / 100

  const tb0 = calcTB0(fc, s.avg_variable_pct)
  const tb1 = calcTB1(fc, s.avg_variable_pct, splitPct)

  // Last 3 months avg for forecast (exclude current if no data)
  const completed = months.slice(0, -1).filter(m => m.revenue > 0)
  const last3 = completed.slice(-3)
  const forecastRevenue = last3.length > 0
    ? Math.round(last3.reduce((sum, m) => sum + m.revenue, 0) / last3.length)
    : s.monthly_revenue_target

  const currentMonthRevenue = months[months.length - 1]?.revenue ?? 0

  // Scenarios
  const scenarios = [
    { label: 'Пессимизм', rev: Math.round(forecastRevenue * 0.7), color: 'text-red-600' },
    { label: 'База',      rev: forecastRevenue,                    color: 'text-amber-600' },
    { label: 'Оптимизм',  rev: Math.round(forecastRevenue * 1.3),  color: 'text-emerald-600' },
  ]

  // DDS for forecast revenue
  const dds = calcDds(forecastRevenue, s.tax_system, s.avg_variable_pct, fc)

  async function handleSave() {
    setSaving(true)
    try {
      await fetch('/api/cfo-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      })
      setSavedAt(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  function numField(
    label: string,
    value: number,
    onChange: (v: number) => void,
    suffix = '₽',
  ) {
    return (
      <div>
        <p className="text-[10px] text-[#9a9a95] mb-0.5">{label}</p>
        {editing ? (
          <input
            type="number"
            value={value}
            onChange={e => onChange(Number(e.target.value))}
            className="w-full border border-[#e4e4e0] rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-[#111110]"
          />
        ) : (
          <p className="text-xs font-mono font-semibold text-[#111110]">{value.toLocaleString('ru-RU')} {suffix}</p>
        )}
      </div>
    )
  }

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[900px] mx-auto px-4 py-4 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-sm font-semibold text-[#111110]">Финансовая модель</h1>
            <p className="text-[10px] text-[#9a9a95] mt-0.5">Точки безубыточности · ДДС · Сценарный анализ</p>
          </div>
          <div className="flex items-center gap-2">
            {savedAt && <span className="text-[10px] text-[#9a9a95]">Сохранено в {savedAt}</span>}
            {editing ? (
              <>
                <button
                  onClick={() => { setS(initialSettings); setEditing(false) }}
                  className="px-3 py-1.5 text-xs border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-white transition-colors"
                >
                  Отмена
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs bg-[#111110] text-white rounded-lg font-medium disabled:opacity-50 transition-opacity"
                >
                  {saving ? 'Сохраняю…' : 'Сохранить'}
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1.5 text-xs border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-white transition-colors"
              >
                Изменить
              </button>
            )}
          </div>
        </div>

        {/* Key metrics */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'ТБ0 (ноль)',       value: tb0,                color: 'text-amber-600',   hint: 'работаем в ноль' },
            { label: 'ТБ1 (с фондами)',  value: tb1,                color: 'text-red-600',     hint: 'вывод прибыли' },
            { label: 'Тек. месяц',       value: currentMonthRevenue, color: 'text-[#111110]',  hint: 'факт (одобрено)' },
            { label: 'Прогноз (ср. 3м)', value: forecastRevenue,    color: 'text-emerald-700', hint: 'тренд' },
          ].map(m => (
            <div key={m.label} className="bg-white rounded-lg border border-[#e4e4e0] px-3 py-3">
              <p className="text-[10px] text-[#9a9a95] font-medium">{m.label}</p>
              <p className={`text-lg font-bold font-mono mt-0.5 ${m.color} leading-tight`}>
                {isFinite(m.value) ? fmtShort(m.value) : '∞'}
              </p>
              <p className="text-[10px] text-[#c4c4be] mt-0.5">{m.hint}</p>
            </div>
          ))}
        </div>

        {/* Pricing model */}
        {pricingRows.length > 0 && <PricingModelBlock rows={pricingRows} />}

        {/* Settings + Chart */}
        <div className="grid grid-cols-[280px_1fr] gap-3">

          {/* Settings panel */}
          <div className="bg-white rounded-lg border border-[#e4e4e0] p-4 space-y-4">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Параметры</p>

            {/* Tax system */}
            <div>
              <p className="text-[10px] text-[#9a9a95] mb-1">Система налогооблож.</p>
              {editing ? (
                <select
                  value={s.tax_system}
                  onChange={e => setS(p => ({ ...p, tax_system: e.target.value }))}
                  className="w-full border border-[#e4e4e0] rounded px-2 py-1 text-xs focus:outline-none focus:border-[#111110]"
                >
                  {TAX_SYSTEMS.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              ) : (
                <p className="text-xs font-semibold text-[#111110]">
                  {TAX_SYSTEMS.find(t => t.value === s.tax_system)?.label}
                </p>
              )}
            </div>

            {/* Fixed costs */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wider">Постоянные расходы</p>
              {numField('Аренда',            s.fixed_costs.rent,        v => setS(p => ({ ...p, fixed_costs: { ...p.fixed_costs, rent: v } })))}
              {numField('Коммунальные',      s.fixed_costs.utilities,   v => setS(p => ({ ...p, fixed_costs: { ...p.fixed_costs, utilities: v } })))}
              {numField('ФОТ (зарплата)',    s.fixed_costs.payroll,     v => setS(p => ({ ...p, fixed_costs: { ...p.fixed_costs, payroll: v } })))}
              {numField('Налоги на ФОТ',     s.fixed_costs.payroll_tax, v => setS(p => ({ ...p, fixed_costs: { ...p.fixed_costs, payroll_tax: v } })))}
              {numField('Лизинг',            s.fixed_costs.leasing,     v => setS(p => ({ ...p, fixed_costs: { ...p.fixed_costs, leasing: v } })))}
              {numField('Кредиты',           s.fixed_costs.credit,      v => setS(p => ({ ...p, fixed_costs: { ...p.fixed_costs, credit: v } })))}
              {numField('Маркетинг+реклама', s.fixed_costs.marketing,   v => setS(p => ({ ...p, fixed_costs: { ...p.fixed_costs, marketing: v } })))}
              {numField('Аутсорс, ПО, банк', s.fixed_costs.outsource,  v => setS(p => ({ ...p, fixed_costs: { ...p.fixed_costs, outsource: v } })))}
              {numField('Прочее',            s.fixed_costs.other,       v => setS(p => ({ ...p, fixed_costs: { ...p.fixed_costs, other: v } })))}
              <div className="flex justify-between pt-1 border-t border-[#f5f5f3]">
                <span className="text-[10px] text-[#9a9a95]">Итого FC</span>
                <span className="text-xs font-bold font-mono text-[#111110]">{fc.toLocaleString('ru-RU')} ₽</span>
              </div>
            </div>

            {/* Variable costs + split */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wider">Переменные / Раздел</p>
              {numField('Переменные расх. %', s.avg_variable_pct, v => setS(p => ({ ...p, avg_variable_pct: v })), '%')}
              {numField('Собственник %', s.profit_split.owner_pct, v => setS(p => ({ ...p, profit_split: { ...p.profit_split, owner_pct: v } })), '%')}
              {numField('Обучение %', s.profit_split.education_pct, v => setS(p => ({ ...p, profit_split: { ...p.profit_split, education_pct: v } })), '%')}
              {numField('Резерв %', s.profit_split.reserve_pct, v => setS(p => ({ ...p, profit_split: { ...p.profit_split, reserve_pct: v } })), '%')}
              <div className="flex justify-between pt-1 border-t border-[#f5f5f3]">
                <span className="text-[10px] text-[#9a9a95]">Итого split</span>
                <span className="text-xs font-bold font-mono text-[#111110]">{(splitPct * 100).toFixed(0)}%</span>
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="bg-white rounded-lg border border-[#e4e4e0] p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Выручка — последние 12 мес.</p>
              <div className="flex gap-3">
                <span className="flex items-center gap-1 text-[10px] text-amber-600">
                  <span className="inline-block w-4 border-t-2 border-dashed border-amber-500" />ТБ0
                </span>
                <span className="flex items-center gap-1 text-[10px] text-red-600">
                  <span className="inline-block w-4 border-t-2 border-dashed border-red-500" />ТБ1
                </span>
              </div>
            </div>
            <RevenueChart months={months} tb0={tb0} tb1={tb1} />

            {/* Mini status bar */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#f5f5f3]">
              {[
                {
                  label: 'Покрыт ТБ0',
                  ok: currentMonthRevenue >= tb0,
                  detail: currentMonthRevenue >= tb0
                    ? `+${fmt(currentMonthRevenue - tb0)}`
                    : `-${fmt(tb0 - currentMonthRevenue)}`,
                },
                {
                  label: 'Покрыт ТБ1',
                  ok: currentMonthRevenue >= tb1,
                  detail: currentMonthRevenue >= tb1
                    ? `+${fmt(currentMonthRevenue - tb1)}`
                    : `-${fmt(tb1 - currentMonthRevenue)}`,
                },
                {
                  label: 'vs Прогноз',
                  ok: currentMonthRevenue >= forecastRevenue * 0.9,
                  detail: forecastRevenue > 0
                    ? `${Math.round((currentMonthRevenue / forecastRevenue) * 100)}%`
                    : '—',
                },
              ].map(item => (
                <div key={item.label} className={`rounded-lg px-3 py-2 ${item.ok ? 'bg-emerald-50' : 'bg-red-50'}`}>
                  <p className={`text-[10px] font-medium ${item.ok ? 'text-emerald-700' : 'text-red-700'}`}>{item.label}</p>
                  <p className={`text-xs font-bold font-mono mt-0.5 ${item.ok ? 'text-emerald-700' : 'text-red-700'}`}>{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Scenarios */}
        <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#e4e4e0]">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Сценарный анализ</p>
            <p className="text-[10px] text-[#c4c4be] mt-0.5">база — ср. выручка за 3 мес., пессимизм ×0.7, оптимизм ×1.3</p>
          </div>
          <div className="grid grid-cols-3 divide-x divide-[#e4e4e0]">
            {scenarios.map(sc => {
              const d = calcDds(sc.rev, s.tax_system, s.avg_variable_pct, fc)
              const taxLabel = TAX_SYSTEMS.find(t => t.value === s.tax_system)?.label ?? ''
              return (
                <div key={sc.label} className="px-4 py-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className={`text-xs font-bold ${sc.color}`}>{sc.label}</p>
                    {sc.rev >= tb1
                      ? <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">ТБ1 ✓</span>
                      : sc.rev >= tb0
                      ? <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">ТБ0 ✓</span>
                      : <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded">ниже ТБ0</span>
                    }
                  </div>
                  {[
                    { label: 'Выручка',     value: sc.rev,  bold: true },
                    { label: 'Себест. (VC)', value: d.cogs,  bold: false },
                    { label: 'Пост. (FC)',   value: fc,       bold: false },
                    { label: `Налог (${taxLabel})`, value: d.tax, bold: false },
                    ...(d.vatNet > 0 ? [{ label: 'НДС к уплате', value: d.vatNet, bold: false }] : []),
                    ...(d.insurance > 0 ? [{ label: 'Страх. взносы', value: d.insurance, bold: false }] : []),
                    { label: 'Чистая прибыль', value: d.net, bold: true },
                  ].map(row => (
                    <div key={row.label} className="flex justify-between">
                      <span className="text-[10px] text-[#9a9a95]">{row.label}</span>
                      <span className={`text-[11px] font-mono ${
                        row.bold
                          ? row.value > 0 ? 'font-bold text-emerald-700' : 'font-bold text-red-600'
                          : 'text-[#4b4b47]'
                      }`}>
                        {fmt(row.value)}
                      </span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>

        {/* DDS */}
        <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#e4e4e0] flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">
                ДДС — прогноз текущего месяца
              </p>
              <p className="text-[10px] text-[#c4c4be] mt-0.5">
                {TAX_SYSTEMS.find(t => t.value === s.tax_system)?.label} · выручка = ср. за 3 мес.
              </p>
            </div>
            <p className={`text-sm font-bold font-mono ${dds.net > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
              {fmt(dds.net)}
            </p>
          </div>
          <div className="px-4 py-3">
            <table className="w-full text-xs">
              <tbody>
                {[
                  { label: '(+) Выручка',          value: forecastRevenue, sign: 1 },
                  { label: '(−) Себестоимость (VC)', value: dds.cogs,       sign: -1 },
                  { label: '(−) Постоянные (FC)',    value: fc,              sign: -1 },
                  ...(dds.insurance > 0 ? [{ label: '(−) Страх. взносы', value: dds.insurance, sign: -1 }] : []),
                  ...(dds.vatNet > 0    ? [{ label: '(−) НДС к уплате',  value: dds.vatNet,    sign: -1 }] : []),
                  { label: '(−) Налог',              value: dds.tax,         sign: -1 },
                ].map(row => (
                  <tr key={row.label} className="border-b border-[#f5f5f3] last:border-0">
                    <td className="py-1.5 text-[#6b6b66]">{row.label}</td>
                    <td className={`py-1.5 text-right font-mono font-medium ${row.sign > 0 ? 'text-[#111110]' : 'text-[#4b4b47]'}`}>
                      {row.sign > 0 ? '' : '−'}{fmt(row.value)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-[#fafaf9]">
                  <td className="py-2 font-semibold text-[#111110]">= Чистая прибыль</td>
                  <td className={`py-2 text-right font-bold font-mono text-sm ${dds.net > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {fmt(dds.net)}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Profit split breakdown */}
            {dds.net > 0 && (
              <div className="mt-3 pt-3 border-t border-[#e4e4e0]">
                <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2">Раздел прибыли</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: `Собственник (${s.profit_split.owner_pct}%)`,     pct: s.profit_split.owner_pct },
                    { label: `Обучение (${s.profit_split.education_pct}%)`,    pct: s.profit_split.education_pct },
                    { label: `Резерв (${s.profit_split.reserve_pct}%)`,        pct: s.profit_split.reserve_pct },
                  ].map(item => {
                    const amount = Math.round(dds.net * (item.pct / 100))
                    return (
                      <div key={item.label} className="bg-[#fafaf9] rounded-lg px-3 py-2 border border-[#e4e4e0]">
                        <p className="text-[10px] text-[#9a9a95]">{item.label}</p>
                        <p className="text-sm font-bold font-mono text-emerald-700 mt-0.5">{fmt(amount)}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* SQL hint when cfo_settings not created */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider mb-1">
            Требуется SQL миграция
          </p>
          <p className="text-[10px] text-amber-600 mb-2">
            Для сохранения настроек выполни в Supabase Dashboard → SQL Editor:
          </p>
          <pre className="text-[10px] font-mono text-amber-800 bg-amber-100 rounded p-2 overflow-x-auto whitespace-pre-wrap">{`CREATE TABLE IF NOT EXISTS cfo_settings (
  id                     serial PRIMARY KEY,
  entity_type            text NOT NULL DEFAULT 'ip',
  tax_system             text NOT NULL DEFAULT 'usn_6',
  fixed_costs            jsonb NOT NULL DEFAULT '{"rent":475000,"utilities":20000,"payroll":800000,"payroll_tax":181000,"leasing":505200,"credit":344980,"marketing":290000,"outsource":190000,"other":62710}',
  profit_split           jsonb NOT NULL DEFAULT '{"owner_pct":20,"education_pct":5,"reserve_pct":5}',
  avg_variable_pct       numeric NOT NULL DEFAULT 62,
  monthly_revenue_target numeric NOT NULL DEFAULT 8700000,
  updated_at             timestamptz DEFAULT now()
);
INSERT INTO cfo_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`}</pre>
        </div>

      </div>
    </div>
  )
}
