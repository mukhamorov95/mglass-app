'use client'

import { useState, useEffect } from 'react'
import type { MonthRevenue, CfoSettings, PricingRow, MonthActuals } from './page'

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'finmodel' | 'pricing' | 'dds' | 'chart' | 'settings'

type Fund = { id: string; name: string; pct: number; enabled: boolean }

type Props = {
  months: MonthRevenue[]
  initialSettings: CfoSettings
  pricingRows: PricingRow[]
  monthActuals: MonthActuals
  monthLabel: string
}

// ── Revenue directions ────────────────────────────────────────────────────────

const REV_DIRS = [
  { id: 'b2c_mirror',   label: 'Зеркала / перегородки (B2C)', vcPct: 62, cat: 'b2c' },
  { id: 'b2c_shower',   label: 'Душевые кабины (B2C)',        vcPct: 62, cat: 'b2c' },
  { id: 'b2c_loft',     label: 'Лофт-перегородки (B2C)',      vcPct: 62, cat: 'b2c' },
  { id: 'b2c_services', label: 'Монтаж и доставка',           vcPct: 25, cat: 'services' },
  { id: 'b2b_glass',    label: 'B2B Стекло / Металл',         vcPct: 49, cat: 'b2b' },
  { id: 'other',        label: 'Прочие доходы',               vcPct: 40, cat: 'other' },
] as const

const DEFAULT_REV_PLAN: Record<string, number> = {
  b2c_mirror:   1_500_000,
  b2c_shower:   2_000_000,
  b2c_loft:     1_500_000,
  b2c_services: 1_300_000,
  b2b_glass:    2_400_000,
  other:                0,
}

const DEFAULT_FUNDS: Fund[] = [
  { id: 'owner',     name: 'Фонд собственника',  pct: 20, enabled: true },
  { id: 'education', name: 'Фонд обучения',      pct:  5, enabled: true },
  { id: 'reserve',   name: 'Резервный фонд',     pct:  5, enabled: true },
]

const FC_LABELS: Record<string, string> = {
  rent:        'Аренда',
  utilities:   'Коммунальные',
  payroll:     'ФОТ (зарплата)',
  payroll_tax: 'Налоги на ФОТ',
  leasing:     'Лизинг',
  credit:      'Кредиты и проценты',
  marketing:   'Маркетинг и реклама',
  outsource:   'Аутсорс, ПО, банк',
  other:       'Прочее',
}

const TAX_SYSTEMS = [
  { value: 'usn_6',  label: 'ИП УСН 6%' },
  { value: 'usn_15', label: 'ИП УСН 15%' },
  { value: 'osno',   label: 'ООО ОСНО' },
]

const MONTH_NAMES = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']
const INSURANCE_MONTHLY = 4_125

const PRODUCT_LABELS: Record<string, string> = {
  mirror:          'Зеркало без подсветки',
  mirror_light:    'Зеркало с подсветкой',
  loft:            'Лофт-перегородка',
  shower_budget:   'Душевая (бюджет)',
  shower_standard: 'Душевая (стандарт)',
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(n: number) {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + ' млн ₽'
  if (Math.abs(n) >= 1_000)     return Math.round(n / 1_000) + ' тыс ₽'
  return n.toLocaleString('ru-RU') + ' ₽'
}
function fmtK(n: number) {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (Math.abs(n) >= 1_000)     return Math.round(n / 1_000) + 'k'
  return String(Math.round(n))
}
function num(n: number) { return n.toLocaleString('ru-RU') }
function pctStr(a: number, b: number) {
  if (!b) return '—'
  return (a / b * 100).toFixed(0) + '%'
}

// ── Financial formulas ────────────────────────────────────────────────────────

function calcTB0(fc: number, vcPct: number) {
  const m = 1 - vcPct / 100; return m <= 0 ? Infinity : fc / m
}
function calcTB1(fc: number, vcPct: number, fundsPct: number) {
  const m = 1 - vcPct / 100; const s = 1 - fundsPct / 100
  return m <= 0 || s <= 0 ? Infinity : fc / (m * s)
}
function calcDds(revenue: number, taxSystem: string, vcPct: number, fc: number) {
  const cogs = revenue * (vcPct / 100)
  if (taxSystem === 'usn_6') {
    const rawTax  = revenue * 0.06
    const deduct  = Math.min(INSURANCE_MONTHLY, rawTax * 0.5)
    const tax     = rawTax - deduct
    return { cogs, tax, insurance: INSURANCE_MONTHLY, vatNet: 0, net: revenue - cogs - fc - INSURANCE_MONTHLY - tax }
  }
  if (taxSystem === 'usn_15') {
    const base = Math.max(revenue - cogs - fc, 0)
    const tax  = Math.max(base * 0.15, revenue * 0.01)
    return { cogs, tax, insurance: INSURANCE_MONTHLY, vatNet: 0, net: revenue - cogs - fc - INSURANCE_MONTHLY - tax }
  }
  const vatOut = revenue * (20 / 120); const vatIn = cogs * 0.7 * (20 / 120)
  const vatNet = vatOut - vatIn
  const pBefore = (revenue - vatOut) - (cogs - vatIn) - fc
  const inTax   = Math.max(pBefore * 0.2, 0)
  return { cogs, tax: inTax, insurance: 0, vatNet, net: (pBefore - inTax) * (1 - 0.13) }
}

// ── AI CFO insights ───────────────────────────────────────────────────────────

type Insight = { level: 'ok' | 'warn' | 'crit'; text: string }

function buildInsights(p: {
  planRev: number; actualRev: number; ebitda: number; netProfit: number
  tb0: number; tb1: number; fc: number; payroll: number; marketing: number
  vcActualPct: number
}): Insight[] {
  const out: Insight[] = []
  const { planRev, actualRev, ebitda, netProfit, tb0, tb1, fc, payroll, marketing, vcActualPct } = p
  const revExec  = planRev > 0 ? (actualRev / planRev * 100) : 0
  const fcPct    = actualRev > 0 ? fc / actualRev * 100 : 0
  const payPct   = actualRev > 0 ? payroll / actualRev * 100 : 0
  const mktPct   = actualRev > 0 ? marketing / actualRev * 100 : 0

  if (ebitda < 0)
    out.push({ level: 'crit', text: `Операционный убыток ${fmt(Math.abs(ebitda))} — выручка ниже ТБ0` })
  else if (actualRev < tb1 && actualRev >= tb0)
    out.push({ level: 'warn', text: `Выше ТБ0, но до ТБ1 не хватает ${fmt(tb1 - actualRev)}` })
  else if (actualRev >= tb1 && actualRev > 0)
    out.push({ level: 'ok', text: `Выручка выше ТБ1 — бизнес генерирует прибыль сверх фондов` })

  if (revExec > 0 && revExec < 60)
    out.push({ level: 'crit', text: `Выполнение плана ${revExec.toFixed(0)}% — высокий риск кассового разрыва` })
  else if (revExec >= 60 && revExec < 85)
    out.push({ level: 'warn', text: `Выполнение плана ${revExec.toFixed(0)}% — нужно ускорить продажи` })
  else if (revExec >= 85 && revExec > 0)
    out.push({ level: 'ok', text: `Выполнение плана ${revExec.toFixed(0)}% — хороший темп` })

  if (payPct > 30)
    out.push({ level: 'warn', text: `ФОТ ${payPct.toFixed(0)}% от выручки — выше нормы (≤25% для производства)` })
  if (fcPct > 40)
    out.push({ level: 'warn', text: `Постоянные расходы ${fcPct.toFixed(0)}% от выручки — высокая нагрузка` })
  if (mktPct > 8 && actualRev > 0)
    out.push({ level: 'warn', text: `Маркетинг ${mktPct.toFixed(0)}% от выручки — проверь эффективность каналов` })
  if (vcActualPct > 75 && actualRev > 0)
    out.push({ level: 'warn', text: `Переменные расходы ${vcActualPct.toFixed(0)}% от выручки — низкая маржинальность` })
  if (netProfit > 0 && netProfit < planRev * 0.03)
    out.push({ level: 'warn', text: `Чистая прибыль ${(netProfit / planRev * 100).toFixed(1)}% от планов — узкая итоговая маржа` })
  if (out.length === 0)
    out.push({ level: 'ok', text: 'Нет данных за текущий месяц — финмодель в режиме планирования' })

  return out
}

// ── SVG Revenue Chart ─────────────────────────────────────────────────────────

function RevenueChart({ months, tb0, tb1 }: { months: MonthRevenue[]; tb0: number; tb1: number }) {
  const W = 640; const H = 160
  const pL = 52; const pR = 8; const pT = 12; const pB = 24
  const cW = W - pL - pR; const cH = H - pT - pB
  const maxV = Math.max(...months.map(m => m.revenue), isFinite(tb1) ? tb1 * 1.05 : 0, 1)
  const sc   = (v: number) => cH - (v / maxV) * cH
  const bW   = Math.floor(cW / months.length) - 2
  const bG   = Math.floor((cW - bW * months.length) / (months.length + 1))
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block">
      {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
        const v = maxV * f
        return (
          <g key={i}>
            <line x1={pL} y1={pT + sc(v)} x2={pL + cW} y2={pT + sc(v)} stroke="#e4e4e0" strokeWidth="1" />
            <text x={pL - 4} y={pT + sc(v) + 4} textAnchor="end" fontSize="9" fill="#9a9a95">{fmtK(v)}</text>
          </g>
        )
      })}
      {months.map((m, i) => {
        const x = pL + bG + i * (bW + bG)
        const bH = Math.max((m.revenue / maxV) * cH, 1)
        return (
          <g key={m.month}>
            <rect x={x} y={pT + cH - bH} width={bW} height={bH} rx="2"
              fill={i === months.length - 1 ? '#111110' : '#d4d4d0'} />
            <text x={x + bW / 2} y={H - 4} textAnchor="middle" fontSize="8" fill="#9a9a95">
              {MONTH_NAMES[parseInt(m.month.split('-')[1]) - 1]}
            </text>
          </g>
        )
      })}
      {isFinite(tb0) && tb0 < maxV * 1.1 && (
        <g>
          <line x1={pL} y1={pT + sc(tb0)} x2={pL + cW} y2={pT + sc(tb0)}
            stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 3" />
          <text x={pL + cW - 2} y={pT + sc(tb0) - 3} textAnchor="end" fontSize="8" fill="#f59e0b">ТБ0</text>
        </g>
      )}
      {isFinite(tb1) && tb1 < maxV * 1.1 && (
        <g>
          <line x1={pL} y1={pT + sc(tb1)} x2={pL + cW} y2={pT + sc(tb1)}
            stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 3" />
          <text x={pL + cW - 2} y={pT + sc(tb1) - 3} textAnchor="end" fontSize="8" fill="#ef4444">ТБ1</text>
        </g>
      )}
    </svg>
  )
}

// ── Pricing model block ───────────────────────────────────────────────────────

function PricingModelBlock({ rows }: { rows: PricingRow[] }) {
  const [cost, setCost]     = useState(2000)
  const [activeIdx, setIdx] = useState(0)
  const row = rows[activeIdx]
  if (!row) return null
  const margin = row.default_margin; const tax = row.tax_percent
  const denom  = 1 - margin / 100 - tax / 100
  const price  = denom > 0 ? Math.round(cost / denom) : 0
  const taxAmt = Math.round(price * tax / 100)
  const mrgAmt = Math.round(price * margin / 100)
  const cstPct = Math.round(100 - margin - tax)

  return (
    <div className="bg-surface rounded-lg border border-line overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line">
        <p className="text-[11px] font-semibold text-muted uppercase tracking-widest">Модель ценообразования</p>
        <p className="text-[11px] text-faint mt-0.5">Цена = Себестоимость ÷ (1 − Маржа% − Налог%)</p>
      </div>
      <div className="flex border-b border-line overflow-x-auto">
        {rows.map((r, i) => (
          <button key={r.id} onClick={() => setIdx(i)}
            className={`px-3 py-2 text-[11px] font-medium whitespace-nowrap border-r border-line transition-colors
              ${i === activeIdx ? 'bg-ink text-white' : 'text-ink-soft hover:bg-canvas'}`}>
            {PRODUCT_LABELS[r.product_type] ?? r.product_type}
          </button>
        ))}
      </div>
      <div className="p-4 grid grid-cols-[1fr_260px] gap-6">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Маржа',    value: `${margin}%`,              cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
              { label: 'Налог',    value: `${tax}%`,                 cls: 'bg-slate-50 text-slate-600 border-slate-200' },
              { label: 'Множитель',value: `×${(1/denom).toFixed(2)}`, cls: 'bg-canvas text-ink border-line' },
            ].map(item => (
              <div key={item.label} className={`rounded-lg border px-3 py-2.5 ${item.cls}`}>
                <p className="text-[11px] opacity-70">{item.label}</p>
                <p className="text-lg font-semibold font-mono mt-0.5">{item.value}</p>
              </div>
            ))}
          </div>
          <div>
            <p className="text-[11px] text-muted mb-1.5">Структура цены клиенту</p>
            <div className="flex h-8 rounded-lg overflow-hidden text-white text-[11px] font-semibold">
              <div className="flex items-center justify-center bg-[#2563eb]" style={{ width: `${cstPct}%` }}>
                {cstPct >= 15 && `${cstPct}%`}
              </div>
              <div className="flex items-center justify-center bg-emerald-500" style={{ width: `${margin}%` }}>
                {margin >= 10 && `${margin}%`}
              </div>
              <div className="flex items-center justify-center bg-slate-400" style={{ width: `${tax}%` }}>
                {tax >= 8 && `${tax}%`}
              </div>
            </div>
            <div className="flex gap-4 mt-1.5">
              {[['bg-[#2563eb]','Себестоимость'],['bg-emerald-500','Маржа'],['bg-slate-400',`Налог ${tax}%`]].map(([c,l]) => (
                <span key={l} className="flex items-center gap-1 text-[11px] text-ink-soft">
                  <span className={`inline-block w-2 h-2 rounded-sm ${c}`} />{l}
                </span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-subtle rounded-lg border border-line px-3 py-2">
              <p className="text-[11px] text-muted">Минимальная маржа</p>
              <p className="font-semibold text-red-600 font-mono">{row.min_margin}%</p>
            </div>
            <div className="bg-subtle rounded-lg border border-line px-3 py-2">
              <p className="text-[11px] text-muted">Макс. скидка</p>
              <p className="font-semibold text-amber-600 font-mono">{row.max_discount_percent}%</p>
            </div>
          </div>
        </div>
        <div className="bg-subtle rounded-xl border border-line p-4 space-y-4">
          <p className="text-[11px] font-semibold text-muted uppercase tracking-widest">Калькулятор</p>
          <div>
            <label className="text-[11px] text-muted block mb-1">Себестоимость, ₽</label>
            <input type="number" value={cost} onChange={e => setCost(Math.max(0, Number(e.target.value)))}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm font-mono font-semibold focus:outline-none focus:border-ink bg-surface" />
          </div>
          <div className="space-y-2 text-xs">
            {[
              { label: 'Себестоимость', value: cost,    cls: 'text-[#2563eb]' },
              { label: `Маржа ${margin}%`, value: mrgAmt, cls: 'text-emerald-600' },
              { label: `Налог ${tax}%`,  value: taxAmt, cls: 'text-ink-soft' },
            ].map(r => (
              <div key={r.label} className="flex justify-between">
                <span className="text-muted">{r.label}</span>
                <span className={`font-mono font-medium ${r.cls}`}>{r.value.toLocaleString('ru-RU')} ₽</span>
              </div>
            ))}
            <div className="flex justify-between pt-2 border-t border-line">
              <span className="font-semibold text-ink">Цена клиенту</span>
              <span className="font-semibold font-mono text-ink text-sm">{price.toLocaleString('ru-RU')} ₽</span>
            </div>
          </div>
          <div className="bg-surface rounded-lg border border-line px-3 py-2 text-[11px] text-ink-soft">
            <p className="font-mono text-ink mb-0.5">{cost.toLocaleString('ru-RU')} ÷ {denom.toFixed(2)} = {price.toLocaleString('ru-RU')} ₽</p>
            <p>1 − {margin/100} − {tax/100} = {denom.toFixed(2)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── P&L Table helpers ─────────────────────────────────────────────────────────

function SectionHead({ label, planLabel = 'ПЛАН', factLabel = 'ФАКТ' }: { label: string; planLabel?: string; factLabel?: string }) {
  return (
    <div className="flex items-center bg-ink text-white px-3 py-2 mt-2 first:mt-0">
      <div className="flex-1 text-[11px] font-semibold uppercase tracking-widest">{label}</div>
      <div className="w-[130px] text-right text-[11px] text-white/50 font-medium">{planLabel}</div>
      <div className="w-[130px] text-right text-[11px] text-white/50 font-medium">{factLabel}</div>
      <div className="w-[110px] text-right text-[11px] text-white/50 font-medium">ОТКЛ.</div>
      <div className="w-[56px] text-right text-[11px] text-white/50 font-medium">ВЫПОЛ.</div>
    </div>
  )
}

function DataRow({
  label, indent, plan, actual, editKey, editMode, onEdit, negative, bold, muted, dimActual,
}: {
  label: string; indent?: boolean; plan?: number; actual?: number
  editKey?: string; editMode?: boolean; onEdit?: (k: string, v: number) => void
  negative?: boolean; bold?: boolean; muted?: boolean; dimActual?: boolean
}) {
  const delta = plan !== undefined && actual !== undefined ? actual - plan : undefined
  const exec  = plan && plan !== 0 && actual !== undefined ? Math.round(actual / plan * 100) : undefined

  const rowCls = bold
    ? 'bg-line-soft border-t border-line font-semibold'
    : 'hover:bg-subtle border-b border-canvas'

  const labelCls = indent ? 'pl-5 text-ink-soft' : ''
  const textSz = 'text-[12px]'

  return (
    <div className={`flex items-center px-3 py-[7px] ${rowCls} ${muted ? 'opacity-60' : ''}`}>
      <div className={`flex-1 truncate ${textSz} ${labelCls}`}>{label}</div>

      {/* Plan */}
      <div className="w-[130px] text-right">
        {plan !== undefined && (
          editMode && editKey && !bold ? (
            <input
              type="number"
              value={plan}
              onChange={e => onEdit?.(editKey, Number(e.target.value))}
              className="w-full text-right border border-faint rounded px-1.5 py-0.5 text-[11px] font-mono focus:outline-none focus:border-ink bg-surface"
            />
          ) : (
            <span className={`font-mono ${textSz} ${negative ? 'text-red-600' : 'text-ink-soft'}`}>
              {negative ? '−' : ''}{num(Math.abs(plan))}
            </span>
          )
        )}
      </div>

      {/* Actual */}
      <div className="w-[130px] text-right">
        {actual !== undefined && (
          <span className={`font-mono ${textSz} font-medium ${dimActual ? 'text-faint' : actual < 0 ? 'text-red-600' : 'text-ink'}`}>
            {actual !== 0 || !dimActual ? (actual < 0 ? '−' : '') + num(Math.abs(actual)) : '—'}
          </span>
        )}
      </div>

      {/* Delta */}
      <div className="w-[110px] text-right">
        {delta !== undefined && (
          <span className={`font-mono ${textSz} ${delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {delta >= 0 ? '+' : '−'}{num(Math.abs(delta))}
          </span>
        )}
      </div>

      {/* Exec % */}
      <div className="w-[56px] text-right">
        {exec !== undefined && (
          <span className={`font-mono text-[11px] ${exec >= 90 ? 'text-emerald-600' : exec >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
            {exec}%
          </span>
        )}
      </div>
    </div>
  )
}

function TotalRow({ label, plan, actual, highlight }: {
  label: string; plan: number; actual: number; highlight?: 'red' | 'green' | 'amber'
}) {
  const delta = actual - plan
  const hlCls = highlight === 'green' ? 'bg-emerald-50' : highlight === 'red' ? 'bg-red-50' : highlight === 'amber' ? 'bg-amber-50' : 'bg-line-soft'
  const valCls = actual < 0 ? 'text-red-700' : actual > 0 ? 'text-emerald-700' : 'text-ink'
  return (
    <div className={`flex items-center px-3 py-2 ${hlCls} border-t-2 border-line`}>
      <div className="flex-1 text-[12px] font-semibold">{label}</div>
      <div className="w-[130px] text-right font-mono font-semibold text-[12px] text-ink-soft">{num(plan)}</div>
      <div className={`w-[130px] text-right font-mono font-semibold text-[13px] ${valCls}`}>{num(actual)}</div>
      <div className={`w-[110px] text-right font-mono text-[12px] ${delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
        {delta >= 0 ? '+' : '−'}{num(Math.abs(delta))}
      </div>
      <div className="w-[56px] text-right font-mono text-[11px] text-muted">
        {plan ? Math.round(actual / plan * 100) + '%' : '—'}
      </div>
    </div>
  )
}

function MetricRow({ label, plan, actual }: { label: string; plan: string; actual: string }) {
  return (
    <div className="flex items-center px-3 py-[6px] bg-subtle border-b border-line-soft">
      <div className="flex-1 text-[11px] text-muted">{label}</div>
      <div className="w-[130px] text-right font-mono text-[11px] text-ink-soft">{plan}</div>
      <div className="w-[130px] text-right font-mono text-[11px] font-medium text-ink">{actual}</div>
      <div className="w-[110px]" />
      <div className="w-[56px]" />
    </div>
  )
}

// ── TB progress widget ────────────────────────────────────────────────────────

function TBWidget({ label, target, actual, color }: {
  label: string; target: number; actual: number; color: 'amber' | 'red'
}) {
  const pct = isFinite(target) && target > 0 ? Math.min(100, Math.round(actual / target * 100)) : 0
  const clr = color === 'amber' ? 'bg-amber-400' : 'bg-red-400'
  const textClr = color === 'amber' ? 'text-amber-700' : 'text-red-700'
  const reached = actual >= target
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className={`text-[11px] font-semibold ${textClr}`}>{label}</span>
        <span className={`text-[11px] font-mono ${reached ? 'text-emerald-600' : textClr}`}>
          {isFinite(target) ? fmt(target) : '∞'}
        </span>
      </div>
      <div className="h-2 bg-line-soft rounded-full overflow-hidden">
        <div className={`h-full ${reached ? 'bg-emerald-400' : clr} rounded-full transition-all`}
          style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between">
        <span className="text-[11px] text-muted">Факт: {fmt(actual)}</span>
        <span className={`text-[11px] font-medium ${reached ? 'text-emerald-600' : textClr}`}>
          {reached ? '✓ Достигнут' : `-${fmt(target - actual)}`}
        </span>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CfoClient({ months, initialSettings, pricingRows, monthActuals, monthLabel }: Props) {
  const [tab, setTab]               = useState<Tab>('finmodel')
  const [s, setS]                   = useState<CfoSettings>(initialSettings)
  const [editSettings, setEditSett] = useState(false)
  const [editPlan, setEditPlan]     = useState(false)
  const [saving, setSaving]         = useState(false)
  const [savedAt, setSavedAt]       = useState<string | null>(null)
  const [revPlan, setRevPlan]       = useState<Record<string, number>>(DEFAULT_REV_PLAN)
  const [funds, setFunds]           = useState<Fund[]>(DEFAULT_FUNDS)
  const [newFundName, setNewFundName] = useState('')

  useEffect(() => {
    try {
      const rp = localStorage.getItem('mglass_rev_plan')
      if (rp) setRevPlan({ ...DEFAULT_REV_PLAN, ...JSON.parse(rp) })
      const fn = localStorage.getItem('mglass_funds')
      if (fn) setFunds(JSON.parse(fn))
    } catch {}
  }, [])

  // ── Computed values ──────────────────────────────────────────────────────────

  const fc = (Object.values(s.fixed_costs) as number[]).reduce((a, b) => a + b, 0)

  const totalPlanRev    = Object.values(revPlan).reduce((a, b) => a + b, 0)
  const totalActualRev  = Object.values(monthActuals).reduce((a, d) => a + d.revenue, 0)
  const totalActualCost = Object.values(monthActuals).reduce((a, d) => a + d.cost, 0)

  const totalPlanVC = REV_DIRS.reduce((s, d) => s + (revPlan[d.id] ?? 0) * d.vcPct / 100, 0)
  const totalActualVC = totalActualCost

  const planMargProfit   = totalPlanRev  - totalPlanVC
  const actualMargProfit = totalActualRev - totalActualVC
  const planMargPct      = totalPlanRev  > 0 ? planMargProfit   / totalPlanRev  * 100 : 0
  const actualMargPct    = totalActualRev > 0 ? actualMargProfit / totalActualRev * 100 : 0

  const planEBITDA   = planMargProfit   - fc
  const actualEBITDA = actualMargProfit - fc

  const enabledFunds = funds.filter(f => f.enabled)
  const fundsPct     = enabledFunds.reduce((s, f) => s + f.pct, 0)

  const planFundsTotal   = Math.max(0, planEBITDA)   * fundsPct / 100
  const actualFundsTotal = Math.max(0, actualEBITDA) * fundsPct / 100

  const planNet   = planEBITDA   - planFundsTotal
  const actualNet = actualEBITDA - actualFundsTotal

  const tb0 = calcTB0(fc, s.avg_variable_pct)
  const tb1 = calcTB1(fc, s.avg_variable_pct, fundsPct)

  const vcActualPct = totalActualRev > 0 ? totalActualVC / totalActualRev * 100 : 0

  // Forecast from last 3 approved months
  const completed = months.slice(0, -1).filter(m => m.revenue > 0)
  const last3     = completed.slice(-3)
  const forecastRev = last3.length > 0
    ? Math.round(last3.reduce((s, m) => s + m.revenue, 0) / last3.length)
    : s.monthly_revenue_target

  // ── Save handlers ────────────────────────────────────────────────────────────

  async function saveSettings() {
    setSaving(true)
    try {
      await fetch('/api/cfo-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      })
      setSavedAt(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))
      setEditSett(false)
    } finally { setSaving(false) }
  }

  function savePlan() {
    localStorage.setItem('mglass_rev_plan', JSON.stringify(revPlan))
    localStorage.setItem('mglass_funds', JSON.stringify(funds))
    setSavedAt(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))
    setEditPlan(false)
  }

  function updateRevPlan(key: string, val: number) {
    setRevPlan(p => ({ ...p, [key]: val }))
  }

  function addFund() {
    if (!newFundName.trim()) return
    setFunds(p => [...p, { id: Date.now().toString(), name: newFundName.trim(), pct: 5, enabled: true }])
    setNewFundName('')
  }

  // ── Scenarios & DDS (for ДДС tab) ───────────────────────────────────────────

  const splitPct = (s.profit_split.owner_pct + s.profit_split.education_pct + s.profit_split.reserve_pct) / 100
  const tb0_old  = calcTB0(fc, s.avg_variable_pct)
  const tb1_old  = calcTB1(fc, s.avg_variable_pct, splitPct * 100)
  const currentMonthRev = months[months.length - 1]?.revenue ?? 0
  const dds = calcDds(forecastRev, s.tax_system, s.avg_variable_pct, fc)
  const scenarios = [
    { label: 'Пессимизм', rev: Math.round(forecastRev * 0.7), color: 'text-red-600' },
    { label: 'База',      rev: forecastRev,                    color: 'text-amber-600' },
    { label: 'Оптимизм',  rev: Math.round(forecastRev * 1.3), color: 'text-emerald-600' },
  ]

  // ── AI insights ──────────────────────────────────────────────────────────────

  const insights = buildInsights({
    planRev: totalPlanRev, actualRev: totalActualRev,
    ebitda: actualEBITDA, netProfit: actualNet,
    tb0, tb1, fc,
    payroll: s.fixed_costs.payroll + s.fixed_costs.payroll_tax,
    marketing: s.fixed_costs.marketing,
    vcActualPct,
  })

  // ── Tab navigation ───────────────────────────────────────────────────────────

  const TABS: { id: Tab; label: string }[] = [
    { id: 'finmodel', label: 'Финмодель' },
    { id: 'pricing',  label: 'Ценообразование' },
    { id: 'dds',      label: 'ДДС / Сценарии' },
    { id: 'chart',    label: 'График' },
    { id: 'settings', label: 'Настройки' },
  ]

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="bg-canvas min-h-screen">
      <div className="max-w-[1200px] mx-auto px-4 py-4 space-y-3">

        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-sm font-semibold text-ink">CFO Center — Финансовая модель</h1>
            <p className="text-[11px] text-muted mt-0.5">{monthLabel} · Единственный источник финансовой правды</p>
          </div>
          {savedAt && <span className="text-[11px] text-emerald-600">Сохранено в {savedAt}</span>}
        </div>

        {/* Tab bar */}
        <div className="flex bg-surface border border-line rounded-lg p-0.5 gap-0.5 w-fit">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                tab === t.id ? 'bg-ink text-white' : 'text-ink-soft hover:bg-canvas'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ════════════════════════════════════
            TAB: ФИНМОДЕЛЬ — вертикальный P&L
            ════════════════════════════════════ */}
        {tab === 'finmodel' && (
          <div className="grid grid-cols-[1fr_300px] gap-4">

            {/* Left: P&L statement */}
            <div className="bg-surface rounded-lg border border-line overflow-hidden">

              {/* Table header controls */}
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-line bg-subtle">
                <p className="text-[11px] font-semibold text-muted uppercase tracking-widest">
                  P&L — {monthLabel}
                </p>
                <div className="flex gap-2">
                  {editPlan ? (
                    <>
                      <button onClick={() => { setRevPlan(DEFAULT_REV_PLAN); setFunds(DEFAULT_FUNDS); setEditPlan(false) }}
                        className="px-2.5 py-1 text-[11px] border border-line rounded text-ink-soft hover:bg-surface">
                        Сброс
                      </button>
                      <button onClick={savePlan}
                        className="px-2.5 py-1 text-[11px] bg-ink text-white rounded font-medium">
                        Сохранить план
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setEditPlan(true)}
                      className="px-2.5 py-1 text-[11px] border border-line rounded text-ink-soft hover:bg-surface transition-colors">
                      Редактировать план
                    </button>
                  )}
                </div>
              </div>

              {/* ═══ ДОХОДЫ ═══════════════════════════════════════ */}
              <SectionHead label="ДОХОДЫ" />
              {REV_DIRS.map(dir => (
                <DataRow key={dir.id}
                  label={dir.label}
                  indent
                  plan={revPlan[dir.id] ?? 0}
                  actual={monthActuals[dir.id as keyof MonthActuals]?.revenue ?? 0}
                  editKey={dir.id}
                  editMode={editPlan}
                  onEdit={updateRevPlan}
                  dimActual={(monthActuals[dir.id as keyof MonthActuals]?.revenue ?? 0) === 0}
                />
              ))}
              <TotalRow label="ИТОГО ДОХОДОВ" plan={totalPlanRev} actual={totalActualRev} />

              {/* ═══ ПЕРЕМЕННЫЕ РАСХОДЫ ═══════════════════════════ */}
              <SectionHead label="ПЕРЕМЕННЫЕ РАСХОДЫ (VC)" />
              {REV_DIRS.filter(d => d.cat !== 'other').map(dir => {
                const planVC   = (revPlan[dir.id] ?? 0) * dir.vcPct / 100
                const actualVC = dir.id === 'b2c_mirror' || dir.id === 'b2c_shower' || dir.id === 'b2c_loft'
                  ? (monthActuals[dir.id as keyof MonthActuals]?.cost ?? 0)
                  : (monthActuals[dir.id as keyof MonthActuals]?.revenue ?? 0) * dir.vcPct / 100
                return (
                  <DataRow key={dir.id}
                    label={`${dir.label} (${dir.vcPct}% VC)`}
                    indent
                    plan={Math.round(planVC)}
                    actual={Math.round(actualVC)}
                    negative
                    dimActual={actualVC === 0}
                  />
                )
              })}
              <TotalRow label="ИТОГО ПЕРЕМЕННЫЕ" plan={Math.round(totalPlanVC)} actual={Math.round(totalActualVC)} />

              {/* ═══ МАРЖИНАЛЬНАЯ ПРИБЫЛЬ ════════════════════════ */}
              <SectionHead label="МАРЖИНАЛЬНАЯ ПРИБЫЛЬ" />
              <TotalRow label="Валовая прибыль" plan={Math.round(planMargProfit)} actual={Math.round(actualMargProfit)}
                highlight={actualMargProfit > 0 ? 'green' : 'red'} />
              <MetricRow label="Маржинальность %"
                plan={`${planMargPct.toFixed(1)}%`}
                actual={totalActualRev > 0 ? `${actualMargPct.toFixed(1)}%` : '—'} />

              {/* ═══ ПОСТОЯННЫЕ РАСХОДЫ ══════════════════════════ */}
              <SectionHead label="ПОСТОЯННЫЕ РАСХОДЫ (FC)" />
              {(Object.keys(s.fixed_costs) as (keyof typeof s.fixed_costs)[]).map(key => (
                <DataRow key={key}
                  label={FC_LABELS[key] ?? key}
                  indent
                  plan={s.fixed_costs[key]}
                  actual={s.fixed_costs[key]}
                  negative
                />
              ))}
              <TotalRow label="ИТОГО ПОСТОЯННЫЕ" plan={fc} actual={fc} />

              {/* ═══ EBITDA ══════════════════════════════════════ */}
              <SectionHead label="ОПЕРАЦИОННАЯ ПРИБЫЛЬ (EBITDA)" />
              <TotalRow label="EBITDA" plan={Math.round(planEBITDA)} actual={Math.round(actualEBITDA)}
                highlight={actualEBITDA > 0 ? 'green' : actualEBITDA < 0 ? 'red' : undefined} />
              <MetricRow label="EBITDA margin %"
                plan={totalPlanRev > 0 ? `${(planEBITDA / totalPlanRev * 100).toFixed(1)}%` : '—'}
                actual={totalActualRev > 0 ? `${(actualEBITDA / totalActualRev * 100).toFixed(1)}%` : '—'} />

              {/* ═══ ФОНДЫ ═══════════════════════════════════════ */}
              <SectionHead label={`ФОНДЫ ИЗ ПРИБЫЛИ (${fundsPct}%)`} />
              {funds.map((fund, fi) => (
                <div key={fund.id} className="flex items-center px-3 py-[7px] border-b border-canvas hover:bg-subtle">
                  <div className="flex-1 flex items-center gap-2">
                    {editPlan && (
                      <input type="checkbox" checked={fund.enabled}
                        onChange={e => setFunds(p => p.map((f, i) => i === fi ? { ...f, enabled: e.target.checked } : f))}
                        className="w-3 h-3" />
                    )}
                    <span className={`text-[12px] pl-5 ${!fund.enabled ? 'text-faint line-through' : 'text-ink-soft'}`}>
                      {editPlan ? (
                        <input value={fund.name}
                          onChange={e => setFunds(p => p.map((f, i) => i === fi ? { ...f, name: e.target.value } : f))}
                          className="border border-line rounded px-1 text-[11px] focus:outline-none w-40" />
                      ) : fund.name}
                    </span>
                  </div>
                  <div className="w-[130px] text-right font-mono text-[11px] text-muted">
                    {editPlan ? (
                      <div className="flex items-center justify-end gap-1">
                        <input type="number" value={fund.pct}
                          onChange={e => setFunds(p => p.map((f, i) => i === fi ? { ...f, pct: Number(e.target.value) } : f))}
                          className="w-12 text-right border border-line rounded px-1 text-[11px] font-mono focus:outline-none" />
                        <span className="text-[11px]">%</span>
                      </div>
                    ) : `${fund.pct}%`}
                  </div>
                  <div className="w-[130px] text-right font-mono text-[12px] font-medium text-ink-soft">
                    {num(Math.round(Math.max(0, planEBITDA) * fund.pct / 100))}
                  </div>
                  <div className="w-[110px] text-right font-mono text-[12px] text-ink">
                    {num(Math.round(Math.max(0, actualEBITDA) * fund.pct / 100))}
                  </div>
                  <div className="w-[56px]" />
                </div>
              ))}
              {editPlan && (
                <div className="flex items-center gap-2 px-3 py-2 border-b border-canvas">
                  <span className="pl-5 text-[12px] text-muted">+ Новый фонд:</span>
                  <input value={newFundName} onChange={e => setNewFundName(e.target.value)}
                    placeholder="Название фонда"
                    className="flex-1 border border-line rounded px-2 py-1 text-[11px] focus:outline-none focus:border-ink" />
                  <button onClick={addFund}
                    className="px-2 py-1 bg-ink text-white text-[11px] rounded font-medium">
                    Добавить
                  </button>
                </div>
              )}
              <TotalRow label="ИТОГО ФОНДЫ" plan={Math.round(planFundsTotal)} actual={Math.round(actualFundsTotal)} />

              {/* ═══ ЧИСТАЯ ПРИБЫЛЬ ══════════════════════════════ */}
              <SectionHead label="ЧИСТАЯ ПРИБЫЛЬ" />
              <TotalRow label="Чистая прибыль" plan={Math.round(planNet)} actual={Math.round(actualNet)}
                highlight={actualNet > 0 ? 'green' : actualNet < 0 ? 'red' : undefined} />
              {totalPlanRev > 0 && (
                <MetricRow
                  label="Рентабельность %"
                  plan={`${(planNet / totalPlanRev * 100).toFixed(1)}%`}
                  actual={totalActualRev > 0 ? `${(actualNet / totalActualRev * 100).toFixed(1)}%` : '—'}
                />
              )}
            </div>

            {/* Right: TB + AI CFO */}
            <div className="space-y-3">

              {/* TB0 / TB1 */}
              <div className="bg-surface rounded-lg border border-line p-4 space-y-4">
                <p className="text-[11px] font-semibold text-muted uppercase tracking-widest">
                  Точки безубыточности
                </p>
                <TBWidget label="ТБ0 — работаем в ноль" target={tb0} actual={totalActualRev} color="amber" />
                <TBWidget label="ТБ1 — с выводом прибыли" target={tb1} actual={totalActualRev} color="red" />
                <div className="pt-2 border-t border-line-soft space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted">VC% (план)</span>
                    <span className="font-mono font-medium">{s.avg_variable_pct}%</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted">Фонды%</span>
                    <span className="font-mono font-medium">{fundsPct}%</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted">FC (план)</span>
                    <span className="font-mono font-medium">{fmt(fc)}</span>
                  </div>
                </div>
              </div>

              {/* AI CFO */}
              <div className="bg-surface rounded-lg border border-line p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold text-muted uppercase tracking-widest">AI CFO Анализ</p>
                  <span className="text-[11px] bg-line-soft text-muted px-1.5 py-0.5 rounded font-medium">AUTO</span>
                </div>
                <div className="space-y-2">
                  {insights.map((ins, i) => (
                    <div key={i} className={`flex items-start gap-2 text-[11px] p-2 rounded-lg ${
                      ins.level === 'crit' ? 'bg-red-50 text-red-700' :
                      ins.level === 'warn' ? 'bg-amber-50 text-amber-700' :
                      'bg-emerald-50 text-emerald-700'
                    }`}>
                      <span className="flex-shrink-0 text-[12px]">
                        {ins.level === 'crit' ? '🔴' : ins.level === 'warn' ? '🟡' : '🟢'}
                      </span>
                      <span>{ins.text}</span>
                    </div>
                  ))}
                </div>
                <div className="pt-2 border-t border-line-soft">
                  <p className="text-[11px] text-faint">Анализ обновляется при изменении данных финмодели</p>
                </div>
              </div>

              {/* Quick plan summary */}
              <div className="bg-surface rounded-lg border border-line p-4 space-y-2">
                <p className="text-[11px] font-semibold text-muted uppercase tracking-widest">Сводка плана</p>
                {[
                  { label: 'Плановая выручка',     value: fmt(totalPlanRev) },
                  { label: 'Плановая маржа%',      value: `${planMargPct.toFixed(1)}%` },
                  { label: 'Плановый EBITDA',      value: fmt(planEBITDA) },
                  { label: 'Плановая ч.прибыль',   value: fmt(planNet) },
                  { label: 'Прогноз (ср.3м)',      value: fmt(forecastRev) },
                ].map(row => (
                  <div key={row.label} className="flex justify-between text-[11px]">
                    <span className="text-muted">{row.label}</span>
                    <span className="font-mono font-medium text-ink">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════
            TAB: ЦЕНООБРАЗОВАНИЕ
            ════════════════════════════════════ */}
        {tab === 'pricing' && pricingRows.length > 0 && (
          <PricingModelBlock rows={pricingRows} />
        )}

        {/* ════════════════════════════════════
            TAB: ДДС / СЦЕНАРИИ
            ════════════════════════════════════ */}
        {tab === 'dds' && (
          <div className="space-y-4">
            {/* Scenarios */}
            <div className="bg-surface rounded-lg border border-line overflow-hidden">
              <div className="px-4 py-2.5 border-b border-line">
                <p className="text-[11px] font-semibold text-muted uppercase tracking-widest">Сценарный анализ</p>
                <p className="text-[11px] text-faint mt-0.5">
                  база — ср. выручка за 3 мес. · VC {s.avg_variable_pct}% · FC {fmt(fc)}
                </p>
              </div>
              <div className="grid grid-cols-3 divide-x divide-line">
                {scenarios.map(sc => {
                  const d = calcDds(sc.rev, s.tax_system, s.avg_variable_pct, fc)
                  const taxLabel = TAX_SYSTEMS.find(t => t.value === s.tax_system)?.label ?? ''
                  return (
                    <div key={sc.label} className="px-4 py-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className={`text-xs font-semibold ${sc.color}`}>{sc.label}</p>
                        {sc.rev >= tb1_old
                          ? <span className="text-[11px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">ТБ1 ✓</span>
                          : sc.rev >= tb0_old
                          ? <span className="text-[11px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">ТБ0 ✓</span>
                          : <span className="text-[11px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded">ниже ТБ0</span>
                        }
                      </div>
                      {[
                        { label: 'Выручка',      value: sc.rev,   bold: true },
                        { label: 'VC',           value: d.cogs,   bold: false },
                        { label: 'FC',           value: fc,       bold: false },
                        { label: `Налог (${taxLabel})`, value: d.tax, bold: false },
                        ...(d.vatNet > 0    ? [{ label: 'НДС', value: d.vatNet, bold: false }] : []),
                        ...(d.insurance > 0 ? [{ label: 'Страх.', value: d.insurance, bold: false }] : []),
                        { label: 'Чистая прибыль', value: d.net, bold: true },
                      ].map(row => (
                        <div key={row.label} className="flex justify-between text-xs">
                          <span className="text-muted">{row.label}</span>
                          <span className={`font-mono ${row.bold
                            ? row.value > 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-red-600'
                            : 'text-ink-soft'}`}>
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
            <div className="bg-surface rounded-lg border border-line overflow-hidden">
              <div className="px-4 py-2.5 border-b border-line flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-semibold text-muted uppercase tracking-widest">ДДС — прогноз</p>
                  <p className="text-[11px] text-faint mt-0.5">
                    {TAX_SYSTEMS.find(t => t.value === s.tax_system)?.label} · прогноз = ср. за 3 мес.
                  </p>
                </div>
                <p className={`text-sm font-semibold font-mono ${dds.net > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {fmt(dds.net)}
                </p>
              </div>
              <div className="px-4 py-3">
                <table className="w-full text-xs">
                  <tbody>
                    {[
                      { label: '(+) Выручка',        value: forecastRev,   sign: 1 },
                      { label: '(−) Переменные (VC)', value: dds.cogs,     sign: -1 },
                      { label: '(−) Постоянные (FC)', value: fc,           sign: -1 },
                      ...(dds.insurance > 0 ? [{ label: '(−) Страх. взносы', value: dds.insurance, sign: -1 }] : []),
                      ...(dds.vatNet > 0    ? [{ label: '(−) НДС к уплате',  value: dds.vatNet,    sign: -1 }] : []),
                      { label: '(−) Налог',           value: dds.tax,      sign: -1 },
                    ].map(row => (
                      <tr key={row.label} className="border-b border-canvas last:border-0">
                        <td className="py-1.5 text-ink-soft">{row.label}</td>
                        <td className={`py-1.5 text-right font-mono font-medium ${row.sign > 0 ? 'text-ink' : 'text-ink-soft'}`}>
                          {row.sign > 0 ? '' : '−'}{fmt(row.value)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-subtle">
                      <td className="py-2 font-semibold text-ink">= Чистая прибыль</td>
                      <td className={`py-2 text-right font-semibold font-mono text-sm ${dds.net > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                        {fmt(dds.net)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                {dds.net > 0 && (
                  <div className="mt-3 pt-3 border-t border-line">
                    <p className="text-[11px] font-semibold text-muted uppercase tracking-widest mb-2">Раздел прибыли</p>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: `Собственник (${s.profit_split.owner_pct}%)`,   pct: s.profit_split.owner_pct },
                        { label: `Обучение (${s.profit_split.education_pct}%)`,  pct: s.profit_split.education_pct },
                        { label: `Резерв (${s.profit_split.reserve_pct}%)`,      pct: s.profit_split.reserve_pct },
                      ].map(item => (
                        <div key={item.label} className="bg-subtle rounded-lg px-3 py-2 border border-line">
                          <p className="text-[11px] text-muted">{item.label}</p>
                          <p className="text-sm font-semibold font-mono text-emerald-700 mt-0.5">
                            {fmt(Math.round(dds.net * (item.pct / 100)))}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════
            TAB: ГРАФИК
            ════════════════════════════════════ */}
        {tab === 'chart' && (
          <div className="bg-surface rounded-lg border border-line p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-muted uppercase tracking-widest">Выручка — последние 12 мес.</p>
              <div className="flex gap-3">
                <span className="flex items-center gap-1 text-[11px] text-amber-600">
                  <span className="inline-block w-4 border-t-2 border-dashed border-amber-500" />ТБ0
                </span>
                <span className="flex items-center gap-1 text-[11px] text-red-600">
                  <span className="inline-block w-4 border-t-2 border-dashed border-red-500" />ТБ1
                </span>
              </div>
            </div>
            <RevenueChart months={months} tb0={tb0} tb1={tb1} />
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-canvas">
              {[
                { label: 'Покрыт ТБ0', ok: currentMonthRev >= tb0,
                  detail: currentMonthRev >= tb0 ? `+${fmt(currentMonthRev-tb0)}` : `-${fmt(tb0-currentMonthRev)}` },
                { label: 'Покрыт ТБ1', ok: currentMonthRev >= tb1,
                  detail: currentMonthRev >= tb1 ? `+${fmt(currentMonthRev-tb1)}` : `-${fmt(tb1-currentMonthRev)}` },
                { label: 'vs Прогноз', ok: currentMonthRev >= forecastRev * 0.9,
                  detail: forecastRev > 0 ? `${Math.round(currentMonthRev/forecastRev*100)}%` : '—' },
              ].map(item => (
                <div key={item.label} className={`rounded-lg px-3 py-2 ${item.ok ? 'bg-emerald-50' : 'bg-red-50'}`}>
                  <p className={`text-[11px] font-medium ${item.ok ? 'text-emerald-700' : 'text-red-700'}`}>{item.label}</p>
                  <p className={`text-xs font-semibold font-mono mt-0.5 ${item.ok ? 'text-emerald-700' : 'text-red-700'}`}>{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════
            TAB: НАСТРОЙКИ FC
            ════════════════════════════════════ */}
        {tab === 'settings' && (
          <div className="grid grid-cols-[340px_1fr] gap-4">
            <div className="bg-surface rounded-lg border border-line p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-muted uppercase tracking-widest">Параметры FC / VC</p>
                {editSettings ? (
                  <div className="flex gap-1.5">
                    <button onClick={() => { setS(initialSettings); setEditSett(false) }}
                      className="px-2 py-1 text-[11px] border border-line rounded text-ink-soft hover:bg-canvas">
                      Отмена
                    </button>
                    <button onClick={saveSettings} disabled={saving}
                      className="px-2 py-1 text-[11px] bg-ink text-white rounded font-medium disabled:opacity-50">
                      {saving ? '…' : 'Сохранить'}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setEditSett(true)}
                    className="px-2 py-1 text-[11px] border border-line rounded text-ink-soft hover:bg-canvas">
                    Изменить
                  </button>
                )}
              </div>

              {/* Tax system */}
              <div>
                <p className="text-[11px] text-muted mb-1">Система налогообложения</p>
                {editSettings ? (
                  <select value={s.tax_system} onChange={e => setS(p => ({ ...p, tax_system: e.target.value }))}
                    className="w-full border border-line rounded px-2 py-1 text-xs focus:outline-none focus:border-ink">
                    {TAX_SYSTEMS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                ) : (
                  <p className="text-xs font-semibold text-ink">{TAX_SYSTEMS.find(t => t.value === s.tax_system)?.label}</p>
                )}
              </div>

              {/* Variable costs % */}
              <div>
                <p className="text-[11px] text-muted mb-1">Переменные расходы (средний %)</p>
                {editSettings ? (
                  <input type="number" value={s.avg_variable_pct}
                    onChange={e => setS(p => ({ ...p, avg_variable_pct: Number(e.target.value) }))}
                    className="w-full border border-line rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-ink" />
                ) : (
                  <p className="text-xs font-mono font-semibold text-ink">{s.avg_variable_pct}%</p>
                )}
              </div>

              {/* Fixed costs */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">Постоянные расходы</p>
                {(Object.keys(s.fixed_costs) as (keyof typeof s.fixed_costs)[]).map(key => (
                  <div key={key}>
                    <p className="text-[11px] text-muted mb-0.5">{FC_LABELS[key] ?? key}</p>
                    {editSettings ? (
                      <input type="number" value={s.fixed_costs[key]}
                        onChange={e => setS(p => ({ ...p, fixed_costs: { ...p.fixed_costs, [key]: Number(e.target.value) } }))}
                        className="w-full border border-line rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-ink" />
                    ) : (
                      <p className="text-xs font-mono font-semibold text-ink">{s.fixed_costs[key].toLocaleString('ru-RU')} ₽</p>
                    )}
                  </div>
                ))}
                <div className="flex justify-between pt-1 border-t border-canvas">
                  <span className="text-[11px] text-muted">Итого FC</span>
                  <span className="text-xs font-semibold font-mono text-ink">{fc.toLocaleString('ru-RU')} ₽</span>
                </div>
              </div>

              {/* Profit split */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">Раздел прибыли (ДДС)</p>
                {(['owner_pct','education_pct','reserve_pct'] as const).map(key => {
                  const label = key === 'owner_pct' ? 'Собственник %' : key === 'education_pct' ? 'Обучение %' : 'Резерв %'
                  return (
                    <div key={key}>
                      <p className="text-[11px] text-muted mb-0.5">{label}</p>
                      {editSettings ? (
                        <input type="number" value={s.profit_split[key]}
                          onChange={e => setS(p => ({ ...p, profit_split: { ...p.profit_split, [key]: Number(e.target.value) } }))}
                          className="w-full border border-line rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-ink" />
                      ) : (
                        <p className="text-xs font-mono font-semibold text-ink">{s.profit_split[key]}%</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Settings info */}
            <div className="space-y-3">
              <div className="bg-surface rounded-lg border border-line p-4">
                <p className="text-[11px] font-semibold text-muted uppercase tracking-widest mb-3">Структура расходов</p>
                {(Object.keys(s.fixed_costs) as (keyof typeof s.fixed_costs)[]).map(key => {
                  const pct = fc > 0 ? Math.round(s.fixed_costs[key] / fc * 100) : 0
                  return (
                    <div key={key} className="mb-2">
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span className="text-ink-soft">{FC_LABELS[key]}</span>
                        <span className="font-mono text-ink">{num(s.fixed_costs[key])} ₽ · {pct}%</span>
                      </div>
                      <div className="h-1.5 bg-line-soft rounded-full overflow-hidden">
                        <div className="h-full bg-ink rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
                <div className="flex justify-between text-[11px] pt-2 border-t border-line font-semibold">
                  <span>Итого FC</span>
                  <span className="font-mono">{num(fc)} ₽</span>
                </div>
              </div>

              {/* SQL migration hint */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider mb-1">SQL — создание таблицы</p>
                <pre className="text-[11px] font-mono text-amber-800 bg-amber-100 rounded p-2 overflow-x-auto whitespace-pre-wrap">{`CREATE TABLE IF NOT EXISTS cfo_settings (
  id                     serial PRIMARY KEY,
  entity_type            text DEFAULT 'ip',
  tax_system             text DEFAULT 'usn_6',
  fixed_costs            jsonb DEFAULT '{"rent":475000,"utilities":20000,"payroll":800000,"payroll_tax":181000,"leasing":505200,"credit":344980,"marketing":290000,"outsource":190000,"other":62710}',
  profit_split           jsonb DEFAULT '{"owner_pct":20,"education_pct":5,"reserve_pct":5}',
  avg_variable_pct       numeric DEFAULT 62,
  monthly_revenue_target numeric DEFAULT 8700000,
  updated_at             timestamptz DEFAULT now()
);
INSERT INTO cfo_settings (id) VALUES (1) ON CONFLICT DO NOTHING;`}</pre>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
