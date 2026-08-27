'use client'

import { useState } from 'react'
import {
  computeBe,
  scenarioPresets,
  type IncomeLine,
  type FixedLine,
  type BePnl,
} from '@/lib/cfo/factModel'
import type { SourceDiag, Verdict } from '@/lib/cfo/sourceDiagnostics'

type FactInfo = { revenue: number; captured: boolean }

type Props = {
  incomes: IncomeLine[]
  fixed: FixedLine[]
  fundsRubByUnit: Record<string, number>
  factByUnit: Record<string, FactInfo>
  diagnostics: SourceDiag[]
  daysElapsed: number
  monthLabel: string
  hasData: boolean
  updatedAt: string | null
}

type Tab = 'fact' | 'scen' | 'src' | 'help'

function fmt(n: number) {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2).replace('.', ',') + ' млн ₽'
  if (Math.abs(n) >= 1_000) return Math.round(n / 1_000).toLocaleString('ru-RU') + ' тыс ₽'
  return Math.round(n).toLocaleString('ru-RU') + ' ₽'
}
function posColor(n: number) { return n >= 0 ? '#1f9d57' : '#d04a3b' }
function marginColor(pct: number) { return pct >= 35 ? '#1f9d57' : pct >= 25 ? '#c98a12' : '#d04a3b' }

export default function ModelClient({ incomes, fixed, fundsRubByUnit, factByUnit, diagnostics, daysElapsed, monthLabel, hasData, updatedAt }: Props) {
  const [tab, setTab] = useState<Tab>('fact')
  const [excluded, setExcluded] = useState<string[]>([])
  const [unit, setUnit] = useState<string>('all') // 'all' | название юнита

  const units = Array.from(new Set(incomes.map((i) => i.unit)))
  const selIncomes = unit === 'all' ? incomes : incomes.filter((i) => i.unit === unit)
  const selFixed = unit === 'all' ? fixed : fixed.filter((f) => f.unit === unit)
  const fundsRub = unit === 'all'
    ? Object.values(fundsRubByUnit).reduce((s, v) => s + v, 0)
    : (fundsRubByUnit[unit] ?? 0)

  const input = { incomes: selIncomes, fixed: selFixed, fundsRub }
  const presets = scenarioPresets(selFixed)
  const base = computeBe(input, [])
  const scen = computeBe(input, excluded)

  const toggle = (key: string) =>
    setExcluded((ex) => (ex.includes(key) ? ex.filter((k) => k !== key) : [...ex, key]))

  const tabs: { id: Tab; label: string }[] = [
    { id: 'fact', label: 'Факт' },
    { id: 'scen', label: 'Сценарии' },
    { id: 'src', label: 'Источники' },
    { id: 'help', label: 'Что это значит' },
  ]
  const unitBtns = [{ key: 'all', label: 'Компания (оба)' }, ...units.map((u) => ({ key: u, label: u }))]
  const dateLabel = updatedAt
    ? new Date(updatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—'

  return (
    <div className="min-h-screen bg-[#f5f5f3] text-[#111110] px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-[1080px]">
        <div className="text-xs text-[#9a9a95] mb-1">CFO / <span className="text-[#4a4a46] font-semibold">Финмодель</span></div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">Финмодель — факт и сценарии</h1>
        <p className="text-sm text-[#4a4a46] max-w-[74ch] mb-3">
          Считает прибыль по данным из <b>«Точки безубыточности»</b> (юниты M-Glass и Производство): доход → минус переменные →
          маржа → минус постоянные → прибыль. Правишь там — меняется здесь. Не понимаешь термин — вкладка <b>«Что это значит»</b>.
        </p>
        <span className="inline-block text-[10.5px] font-semibold text-[#0f8b93] bg-[#e6f1f1] rounded-md px-2 py-0.5 mb-4">
          источник: «Точка безубыточности» · обновлено {dateLabel}
        </span>

        {!hasData ? (
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-6 text-sm text-[#4a4a46]">
            В «Точке безубыточности» пока нет сохранённых данных. Зайди в <b>CFO → Точка безубыточности</b>,
            заполни вкладки M-Glass и Производство, сохрани — модель подтянется сюда.
          </div>
        ) : (
          <>
            {/* Переключатель юнита */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              {unitBtns.map((b) => (
                <button
                  key={b.key}
                  onClick={() => setUnit(b.key)}
                  className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border ${
                    unit === b.key ? 'bg-[#111110] border-[#111110] text-white' : 'bg-white border-[#e4e4e0] text-[#6b6b66]'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>

            <div className="flex gap-1 border-b border-[#e4e4e0] mb-5">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`text-[13px] font-semibold px-3.5 py-2 -mb-px border-b-2 ${
                    tab === t.id ? 'text-[#0f8b93] border-[#0f8b93]' : 'text-[#9a9a95] border-transparent'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'fact' && <FactTab pnl={base} incomes={selIncomes} fixed={selFixed} factByUnit={factByUnit} daysElapsed={daysElapsed} monthLabel={monthLabel} />}
            {tab === 'scen' && (
              <ScenTab base={base} scen={scen} fixed={selFixed} excluded={excluded} presets={presets} toggle={toggle} setExcluded={setExcluded} />
            )}
            {tab === 'src' && <SourcesTab diagnostics={diagnostics} factByUnit={factByUnit} monthLabel={monthLabel} daysElapsed={daysElapsed} />}
            {tab === 'help' && <HelpTab />}
          </>
        )}

        <p className="mt-6 text-[11px] text-[#9a9a95] text-center">
          /cfo/model · данные из «Точки безубыточности» · доход — план, себестоимость и постоянные — реальная структура
        </p>
      </div>
    </div>
  )
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden shadow-sm mb-3.5">
      <div className="flex justify-between items-baseline gap-2 px-4 py-2.5 border-b border-[#e4e4e0] bg-[#fafaf9]">
        <h2 className="text-[13px] font-semibold m-0">{title}</h2>
        {hint && <span className="text-[11px] text-[#9a9a95]">{hint}</span>}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  )
}

function Kpi({ label, value, valueColor, note }: { label: string; value: string; valueColor?: string; note: string }) {
  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl px-3.5 py-3 shadow-sm">
      <div className="text-[10.5px] uppercase tracking-wide text-[#9a9a95]">{label}</div>
      <div className="font-mono text-[19px] font-semibold mt-1 tabular-nums" style={valueColor ? { color: valueColor } : undefined}>{value}</div>
      <div className="text-[10.5px] mt-1 text-[#9a9a95] leading-tight">{note}</div>
    </div>
  )
}

function FactTab({ pnl, incomes, fixed, factByUnit, daysElapsed, monthLabel }: {
  pnl: BePnl; incomes: IncomeLine[]; fixed: FixedLine[]
  factByUnit: Record<string, { revenue: number; captured: boolean }>; daysElapsed: number; monthLabel: string
}) {
  const units = Array.from(new Set(fixed.map((f) => f.unit)))
  // План по юнитам (из incomes) и реальный факт с начала месяца (factByUnit)
  const planByUnit: Record<string, number> = {}
  incomes.forEach((i) => { planByUnit[i.unit] = (planByUnit[i.unit] ?? 0) + i.plan })
  const factUnits = Array.from(new Set([...Object.keys(planByUnit), ...units]))
  const factTotal = factUnits.reduce((s, u) => s + (factByUnit[u]?.captured ? factByUnit[u].revenue : 0), 0)
  const planTotal = factUnits.reduce((s, u) => s + (planByUnit[u] ?? 0), 0)
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3.5">
        <Kpi label="Доход / мес" value={fmt(pnl.revenue)} note={`плановая выручка · год ≈ ${fmt(pnl.revenue * 12)}`} />
        <Kpi label="Маржинальность" value={pnl.marginPct.toFixed(0) + '%'} valueColor={marginColor(pnl.marginPct)} note="сколько % дохода остаётся после переменных" />
        <Kpi label="EBITDA / мес" value={fmt(pnl.ebitda)} valueColor={posColor(pnl.ebitda)} note="прибыль от операций ДО кредита и лизинга" />
        <Kpi label="Прибыль после долга" value={fmt(pnl.operating)} valueColor={posColor(pnl.operating)} note="EBITDA минус кредит и лизинг" />
      </div>

      <Card title="План vs Факт — реальные продажи" hint={`${monthLabel} · за ${daysElapsed} дн.`}>
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-[#9a9a95]">
              <th className="text-left font-semibold py-1.5">Юнит</th>
              <th className="text-right font-semibold py-1.5">План / мес</th>
              <th className="text-right font-semibold py-1.5">Факт (с нач. месяца)</th>
              <th className="text-right font-semibold py-1.5">Выполнение</th>
            </tr>
          </thead>
          <tbody>
            {factUnits.map((u) => {
              const plan = planByUnit[u] ?? 0
              const f = factByUnit[u]
              const captured = f?.captured
              const pct = plan > 0 && captured ? Math.round((f.revenue / plan) * 100) : null
              return (
                <tr key={u} className="border-t border-[#e4e4e0]">
                  <td className="text-left text-[#4a4a46] py-1.5 font-semibold">{u}</td>
                  <td className="text-right font-mono tabular-nums py-1.5">{fmt(plan)}</td>
                  <td className="text-right font-mono tabular-nums py-1.5">
                    {captured ? fmt(f.revenue) : <span className="text-[#c98a12] text-[11px]">не собирается</span>}
                  </td>
                  <td className="text-right font-mono tabular-nums py-1.5" style={pct != null ? { color: marginColor(pct) } : { color: '#9a9a95' }}>
                    {pct != null ? pct + '%' : '—'}
                  </td>
                </tr>
              )
            })}
            <tr className="border-t-2 border-[#d3d3ce] font-semibold">
              <td className="text-left py-1.5">Итого (где есть факт)</td>
              <td className="text-right font-mono tabular-nums py-1.5">{fmt(planTotal)}</td>
              <td className="text-right font-mono tabular-nums py-1.5">{fmt(factTotal)}</td>
              <td className="text-right font-mono tabular-nums py-1.5">{planTotal > 0 ? Math.round((factTotal / planTotal) * 100) + '%' : '—'}</td>
            </tr>
          </tbody>
        </table>
        <p className="text-[11px] text-[#9a9a95] mt-2.5 leading-relaxed">
          <b className="text-[#4a4a46]">Производство</b> — запущенные заказы B2B за месяц (100% предоплата → запуск = оплата = реальный оборот).{' '}
          <b className="text-[#4a4a46]">M-Glass (розница)</b> пока <b>не собирается</b> в базе надёжно — розничные продажи не заносятся, поэтому факт по ней не показать.
          Факт — с 1-го числа по сегодня (неполный месяц), план — на весь месяц; проценты сравнивай с поправкой на дни.
        </p>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 items-start">
        <Card title="Доходы → маржинальная прибыль" hint="по юнитам, ₽/мес">
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-[#9a9a95]">
                <th className="text-left font-semibold py-1.5">Юнит / доход</th>
                <th className="text-right font-semibold py-1.5">Доход</th>
                <th className="text-right font-semibold py-1.5">VC%</th>
                <th className="text-right font-semibold py-1.5">Маржа</th>
              </tr>
            </thead>
            <tbody>
              {incomes.map((inc) => (
                <tr key={inc.id} className="border-t border-[#e4e4e0]">
                  <td className="text-left text-[#4a4a46] py-1.5">
                    <span className="text-[10px] font-semibold text-[#0f8b93] mr-1.5">{inc.unit}</span>{inc.label}
                  </td>
                  <td className="text-right font-mono tabular-nums py-1.5">{fmt(inc.plan)}</td>
                  <td className="text-right font-mono tabular-nums text-[#9a9a95] py-1.5">{inc.vcPct}%</td>
                  <td className="text-right font-mono tabular-nums py-1.5">{fmt(inc.plan * (1 - inc.vcPct / 100))}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-[#d3d3ce] font-semibold">
                <td className="text-left py-1.5">Итого</td>
                <td className="text-right font-mono tabular-nums py-1.5">{fmt(pnl.revenue)}</td>
                <td className="text-right font-mono tabular-nums py-1.5">{(100 - pnl.marginPct).toFixed(0)}%</td>
                <td className="text-right font-mono tabular-nums py-1.5">{fmt(pnl.margin)}</td>
              </tr>
            </tbody>
          </table>
        </Card>

        <Card title="Как считается прибыль (P&L)" hint="месяц, при плановом доходе">
          <table className="w-full text-[13px] border-collapse">
            <tbody>
              <PnlRow label="Доход (план)" value={pnl.revenue} strong />
              <PnlRow label="− Переменные (VC, налог внутри)" value={-pnl.variableCost} sub />
              <PnlRow label="= Маржинальная прибыль" value={pnl.margin} total />
              <PnlRow label="− Постоянные без долга" value={-pnl.fixedNoDebt} sub />
              <PnlRow label="= EBITDA (до долга)" value={pnl.ebitda} total color={posColor(pnl.ebitda)} />
              <PnlRow label="− Кредит и лизинг" value={-pnl.debtTotal} sub />
              <PnlRow label="= Прибыль после долга" value={pnl.operating} total color={posColor(pnl.operating)} />
              <PnlRow label="− Фонды из маржи" value={-pnl.fundsRub} sub />
              <PnlRow label="= Остаток (свободные деньги)" value={pnl.remainder} total color={posColor(pnl.remainder)} />
            </tbody>
          </table>
          <p className="text-[11px] text-[#9a9a95] mt-2.5 leading-relaxed">
            Каждую строку объясняет вкладка <b>«Что это значит»</b>. Безубыточность: ТБ-0 <b>{pnl.tb0 != null ? fmt(pnl.tb0) : '—'}</b> (в ноль), ТБ-1 <b>{pnl.tb1 != null ? fmt(pnl.tb1) : '—'}</b> (с фондами).
          </p>
        </Card>
      </div>

      <Card title="Постоянные расходы — детально" hint="проверяемо, по юнитам">
        {units.map((u) => {
          const rows = fixed.filter((f) => f.unit === u)
          const sum = rows.reduce((s, f) => s + f.amount, 0)
          return (
            <div key={u} className="mb-3 last:mb-0">
              <div className="flex justify-between text-[11px] font-semibold text-[#6b6b66] uppercase tracking-wide mb-1 pb-1 border-b border-[#e4e4e0]">
                <span>{u}</span><span className="font-mono">{fmt(sum)}</span>
              </div>
              {rows.map((f) => (
                <div key={f.key} className="flex justify-between text-[12.5px] py-0.5 text-[#4a4a46]">
                  <span>{f.label}{f.isDebt && <span className="ml-1.5 text-[9px] font-semibold text-[#8a5cd0] border border-[#8a5cd066] rounded px-1 py-px">долг</span>}</span>
                  <span className="font-mono tabular-nums">{fmt(f.amount)}</span>
                </div>
              ))}
            </div>
          )
        })}
        <div className="flex justify-between text-[13px] font-bold border-t-2 border-[#d3d3ce] pt-2 mt-1">
          <span>Итого постоянных</span><span className="font-mono">{fmt(pnl.fixedTotal)}</span>
        </div>
      </Card>
    </>
  )
}

function PnlRow({ label, value, strong, sub, total, color }: {
  label: string; value: number; strong?: boolean; sub?: boolean; total?: boolean; color?: string
}) {
  return (
    <tr className={total ? 'border-t-2 border-[#d3d3ce]' : 'border-t border-[#e4e4e0]'}>
      <td className={`text-left py-1.5 ${sub ? 'text-[#9a9a95] text-[12px]' : total || strong ? 'text-[#111110] font-semibold' : 'text-[#4a4a46]'}`}>{label}</td>
      <td className="text-right font-mono tabular-nums py-1.5 whitespace-nowrap" style={color ? { color } : undefined}>
        {value < 0 ? '−' + fmt(Math.abs(value)) : fmt(value)}
      </td>
    </tr>
  )
}

function ScenTab({ base, scen, fixed, excluded, presets, toggle, setExcluded }: {
  base: BePnl; scen: BePnl; fixed: FixedLine[]; excluded: string[]
  presets: { id: string; label: string; excluded: string[] }[]
  toggle: (key: string) => void; setExcluded: (ex: string[]) => void
}) {
  const dOperating = scen.operating - base.operating
  const activePreset = presets.find((p) => p.excluded.length === excluded.length && p.excluded.every((k) => excluded.includes(k)))
  const units = Array.from(new Set(fixed.map((f) => f.unit)))
  return (
    <>
      <Card title="Что будет, если убрать расходы" hint="доход и переменные не меняются">
        <p className="text-[12px] text-[#6b6b66] mb-2.5">Сними галочку — расход исключается, прибыль пересчитывается. Готовый сценарий одной кнопкой:</p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => setExcluded(p.excluded)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border ${
                activePreset?.id === p.id ? 'bg-[#0f8b93] border-[#0f8b93] text-white' : 'bg-white border-[#d3d3ce] text-[#4a4a46]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {units.map((u) => (
          <div key={u} className="mb-3">
            <div className="text-[11px] font-semibold text-[#6b6b66] uppercase tracking-wide mb-1">{u}</div>
            {fixed.filter((f) => f.unit === u).map((f) => {
              const off = excluded.includes(f.key)
              return (
                <label key={f.key} className="flex items-center gap-2.5 py-1 border-t border-[#e4e4e0] first:border-t-0 text-[13px] cursor-pointer">
                  <input type="checkbox" checked={!off} onChange={() => toggle(f.key)} className="w-[16px] h-[16px] accent-[#0f8b93]" />
                  <span className={`flex-1 ${off ? 'text-[#9a9a95] line-through' : 'text-[#4a4a46]'}`}>
                    {f.label}
                    {f.isDebt && <span className="ml-1.5 text-[9px] font-semibold text-[#8a5cd0] border border-[#8a5cd066] rounded px-1 py-px">долг</span>}
                  </span>
                  <span className={`font-mono tabular-nums ${off ? 'text-[#9a9a95] line-through' : 'text-[#111110]'}`}>{fmt(f.amount)}</span>
                </label>
              )
            })}
          </div>
        ))}
      </Card>

      <Card title="Факт vs Сценарий" hint="сравнение">
        <div className="grid grid-cols-2 border border-[#e4e4e0] rounded-xl overflow-hidden">
          <CmpCol label="Факт (все расходы)" pnl={base} shaded />
          <CmpCol label="Сценарий" pnl={scen} />
        </div>
        <p className="text-[11.5px] text-[#9a9a95] mt-3 leading-relaxed">
          <b className="text-[#4a4a46]">Разница по прибыли после долга:</b>{' '}
          <span className="font-mono font-semibold" style={{ color: posColor(dOperating) }}>{dOperating >= 0 ? '+' : ''}{fmt(dOperating)}/мес</span>.
          Убрать кредит и лизинг — это взгляд на прибыльность без долговой нагрузки: сколько бизнес зарабатывает сам.
          То же, что вкладка «Компания 1» на «Точке безубыточности».
        </p>
      </Card>
    </>
  )
}

function CmpCol({ label, pnl, shaded }: { label: string; pnl: BePnl; shaded?: boolean }) {
  const row = (l: string, v: string, big?: boolean, color?: string) => (
    <div className={`flex justify-between text-[13px] py-1 ${big ? 'font-semibold border-t border-[#e4e4e0] mt-1 pt-2' : 'text-[#4a4a46]'}`}>
      <span>{l}</span>
      <span className="font-mono tabular-nums" style={color ? { color } : { color: '#111110' }}>{v}</span>
    </div>
  )
  return (
    <div className={`px-4 py-3 ${shaded ? 'bg-[#fafaf9] border-r border-[#e4e4e0]' : ''}`}>
      <div className="text-[10.5px] uppercase tracking-wide text-[#9a9a95] mb-2">{label}</div>
      {row('Маржинальная прибыль', fmt(pnl.margin))}
      {row('Постоянные без долга', fmt(pnl.fixedNoDebt))}
      {row('EBITDA', fmt(pnl.ebitda), true, posColor(pnl.ebitda))}
      {row('Кредит и лизинг', fmt(pnl.debtTotal))}
      {row('Прибыль после долга', fmt(pnl.operating), true, posColor(pnl.operating))}
      {row('Безубыточность ТБ-0', pnl.tb0 != null ? fmt(pnl.tb0) : '—')}
    </div>
  )
}

function verdictStyle(v: Verdict): { icon: string; label: string; color: string; bg: string } {
  if (v === 'trust') return { icon: '✅', label: 'доверять', color: '#1f9d57', bg: 'color-mix(in srgb, #1f9d57 12%, transparent)' }
  if (v === 'partial') return { icon: '⚠️', label: 'частично', color: '#c98a12', bg: 'color-mix(in srgb, #c98a12 14%, transparent)' }
  return { icon: '⛔', label: 'не доверять', color: '#d04a3b', bg: 'color-mix(in srgb, #d04a3b 12%, transparent)' }
}

function SourcesTab({ diagnostics, factByUnit, monthLabel, daysElapsed }: {
  diagnostics: SourceDiag[]
  factByUnit: Record<string, { revenue: number; captured: boolean }>
  monthLabel: string
  daysElapsed: number
}) {
  const units = Array.from(new Set(diagnostics.map((d) => d.unit)))
  if (!diagnostics.length) {
    return <div className="bg-white border border-[#e4e4e0] rounded-xl p-6 text-sm text-[#4a4a46]">Источники недоступны — не удалось прочитать данные.</div>
  }
  return (
    <>
      <p className="text-sm text-[#4a4a46] mb-3.5 max-w-[74ch]">
        Откуда берётся факт и чему можно верить — {monthLabel} (за {daysElapsed} дн.). Факт показываем <b>только из доверенного источника</b>;
        если источник ненадёжен — честно «данных нет», а не молчаливый ноль или битая цифра из импорта.
      </p>

      {units.map((u) => {
        const rows = diagnostics.filter((d) => d.unit === u)
        const f = factByUnit[u]
        return (
          <Card key={u} title={u} hint={f?.captured ? 'настоящий факт есть' : 'доверенного источника нет'}>
            <div className="mb-3 flex items-baseline justify-between gap-3 pb-2 border-b border-[#e4e4e0]">
              <span className="text-[12px] text-[#6b6b66]">Факт месяца (из доверенного источника)</span>
              <span className="font-mono tabular-nums font-semibold text-[15px]" style={{ color: f?.captured ? '#1f9d57' : '#c98a12' }}>
                {f?.captured ? fmt(f.revenue) : 'данных нет'}
              </span>
            </div>
            {rows.map((d) => {
              const vs = verdictStyle(d.verdict)
              return (
                <div key={d.source} className="py-2.5 border-t border-[#e4e4e0] first:border-t-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-[#111110]">
                      {d.source}{d.usedForFact && <span className="ml-1.5 text-[9px] font-semibold text-[#0f8b93] border border-[#0f8b93]/40 rounded px-1 py-px">используется</span>}
                    </span>
                    <span className="text-[11px] font-semibold rounded px-1.5 py-0.5" style={{ color: vs.color, background: vs.bg }}>
                      {vs.icon} {vs.label}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#9a9a95] font-mono mt-0.5">{d.table}</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-[#4a4a46] mt-1.5">
                    <span>записей: <b className="font-mono">{d.records}</b></span>
                    {d.sumRub != null && <span>сумма: <b className="font-mono">{fmt(d.sumRub)}</b></span>}
                    {d.periodFrom && <span>период: <b className="font-mono">{d.periodFrom} — {d.periodTo}</b></span>}
                  </div>
                  {d.issue && <div className="text-[12px] text-[#c98a12] mt-1">⚠ {d.issue}</div>}
                  <div className="text-[11.5px] text-[#9a9a95] mt-1 leading-snug">{d.reason}</div>
                </div>
              )
            })}
          </Card>
        )
      })}

      <p className="text-[11.5px] text-[#9a9a95] mt-1 leading-relaxed">
        Как только розница пойдёт в доверенный источник (payments с привязкой к счёту) — факт по M-Glass включится здесь автоматически, экран менять не придётся.
      </p>
    </>
  )
}

function HelpTab() {
  const terms: [string, string][] = [
    ['Доход (выручка)', 'Все деньги, которые приходят от продаж за месяц. Здесь — плановый (сколько планируем), не факт оплат.'],
    ['Переменные затраты (VC)', 'Расходы, которые растут вместе с продажами: материалы (стекло, фурнитура), сдельная зарплата, налог с продаж. Считаются в % от дохода. Больше продал — больше этих затрат.'],
    ['Маржинальная прибыль', 'Доход минус переменные. То, что остаётся с каждой продажи на покрытие постоянных расходов и прибыль. Маржинальность % = какая доля дохода это.'],
    ['Постоянные расходы (FC)', 'Расходы, которые есть каждый месяц независимо от продаж: аренда, оклады, ПО, бухгалтерия. Продал ты много или мало — они те же.'],
    ['EBITDA', 'Прибыль от операций ДО обслуживания долга (кредита и лизинга) и до инвестиций. По-простому: сколько бизнес зарабатывает на своей работе, если не считать выплаты по займам. Хороший показатель здоровья операции — потому что не зависит от того, как ты финансируешь бизнес.'],
    ['Кредит и лизинг (долг)', 'Ежемесячные платежи по займам и лизингу оборудования. Это финансовая нагрузка, а не операционная — поэтому её выносим отдельной строкой после EBITDA.'],
    ['Прибыль после долга', 'EBITDA минус кредит и лизинг. Реальная прибыль от операций с учётом выплат по займам.'],
    ['Фонды из маржи', 'Часть прибыли, которую откладываешь на цели: возврат инвестиций, обучение, резерв, бонусы. Задаются % от маржи в «Точке безубыточности».'],
    ['Остаток', 'Что остаётся после всех расходов, долга и отчислений в фонды — свободные деньги. Плюс — бизнес в прибыли, минус — не хватает.'],
    ['ТБ-0 (точка безубыточности)', 'Какой доход в месяц нужен, чтобы выйти «в ноль» — покрыть все переменные и постоянные, без прибыли. Ниже неё — работаешь в убыток.'],
    ['ТБ-1', 'То же, но с учётом отчислений в фонды — доход, чтобы и в ноль выйти, и фонды отложить.'],
  ]
  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 shadow-sm">
      <p className="text-sm text-[#4a4a46] mb-3">Финансовые термины простыми словами — как читать эту страницу.</p>
      <div className="divide-y divide-[#e4e4e0]">
        {terms.map(([t, d]) => (
          <div key={t} className="py-2.5">
            <div className="text-[13px] font-semibold text-[#111110]">{t}</div>
            <div className="text-[12.5px] text-[#4a4a46] mt-0.5 leading-relaxed">{d}</div>
          </div>
        ))}
      </div>
      <p className="text-[11.5px] text-[#9a9a95] mt-3 leading-relaxed">
        Порядок расчёта: <b>Доход − Переменные = Маржа</b>; <b>Маржа − Постоянные без долга = EBITDA</b>;
        <b> EBITDA − Долг = Прибыль после долга</b>; <b>− Фонды = Остаток</b>.
      </p>
    </div>
  )
}
