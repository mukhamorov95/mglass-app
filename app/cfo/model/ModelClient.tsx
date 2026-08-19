'use client'

import { useState } from 'react'
import {
  computeBe,
  scenarioPresets,
  type IncomeLine,
  type FixedLine,
  type BePnl,
} from '@/lib/cfo/factModel'

type Props = {
  incomes: IncomeLine[]
  fixed: FixedLine[]
  fundsRub: number
  hasData: boolean
  updatedAt: string | null
}

type Tab = 'fact' | 'scen' | 'data'

function fmt(n: number) {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2).replace('.', ',') + ' млн ₽'
  if (Math.abs(n) >= 1_000) return Math.round(n / 1_000).toLocaleString('ru-RU') + ' тыс ₽'
  return Math.round(n).toLocaleString('ru-RU') + ' ₽'
}
function marginColor(pct: number) {
  return pct >= 35 ? '#1f9d57' : pct >= 25 ? '#c98a12' : '#d04a3b'
}

export default function ModelClient({ incomes, fixed, fundsRub, hasData, updatedAt }: Props) {
  const [tab, setTab] = useState<Tab>('fact')
  const [excluded, setExcluded] = useState<string[]>([])

  const input = { incomes, fixed, fundsRub }
  const presets = scenarioPresets(fixed)
  const base = computeBe(input, [])
  const scen = computeBe(input, excluded)

  const toggle = (key: string) =>
    setExcluded((ex) => (ex.includes(key) ? ex.filter((k) => k !== key) : [...ex, key]))

  const tabs: { id: Tab; label: string }[] = [
    { id: 'fact', label: 'Факт' },
    { id: 'scen', label: 'Сценарии' },
    { id: 'data', label: 'Данные' },
  ]

  const dateLabel = updatedAt
    ? new Date(updatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—'

  return (
    <div className="min-h-screen bg-[#f5f5f3] text-[#111110] px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-[1080px]">
        <div className="text-xs text-[#9a9a95] mb-1">CFO / <span className="text-[#4a4a46] font-semibold">Финмодель</span></div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">Финмодель — факт и сценарии</h1>
        <p className="text-sm text-[#4a4a46] max-w-[72ch] mb-3">
          Данные берутся из <b>«Точки безубыточности»</b> — два юнита M-Glass и Производство, их доходы, переменные и постоянные.
          Меняешь там — меняется здесь. Один источник правды.
        </p>
        <span className="inline-block text-[10.5px] font-semibold text-[#0f8b93] bg-[#e6f1f1] rounded-md px-2 py-0.5 mb-4">
          источник: finplan_models · обновлено {dateLabel}
        </span>

        {!hasData ? (
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-6 text-sm text-[#4a4a46]">
            В «Точке безубыточности» пока нет сохранённых данных по юнитам.
            Зайди в <b>CFO → Точка безубыточности</b>, заполни вкладки M-Glass и Производство и сохрани — модель подтянется сюда.
          </div>
        ) : (
          <>
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

            {tab === 'fact' && <FactTab pnl={base} incomes={incomes} />}
            {tab === 'scen' && (
              <ScenTab base={base} scen={scen} fixed={fixed} excluded={excluded} presets={presets} toggle={toggle} setExcluded={setExcluded} />
            )}
            {tab === 'data' && <DataTab />}
          </>
        )}

        <p className="mt-6 text-[11px] text-[#9a9a95] text-center">
          /cfo/model · данные из «Точки безубыточности» (finplan_models) · доход — план, себестоимость и постоянные — реальная структура
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

function Kpi({ label, value, sub, subColor }: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl px-3.5 py-3 shadow-sm">
      <div className="text-[10.5px] uppercase tracking-wide text-[#9a9a95]">{label}</div>
      <div className="font-mono text-[19px] font-semibold mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] mt-0.5" style={{ color: subColor ?? '#9a9a95' }}>{sub}</div>}
    </div>
  )
}

function FactTab({ pnl, incomes }: { pnl: BePnl; incomes: IncomeLine[] }) {
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3.5">
        <Kpi label="Доход / мес (план)" value={fmt(pnl.revenue)} sub={'год ≈ ' + fmt(pnl.revenue * 12)} />
        <Kpi label="Маржинальность" value={pnl.marginPct.toFixed(0) + '%'} sub={fmt(pnl.margin)} subColor={marginColor(pnl.marginPct)} />
        <Kpi label="EBITDA / мес" value={fmt(pnl.ebitda)} sub={pnl.ebitdaPct.toFixed(0) + '% дохода'} subColor={pnl.ebitda >= 0 ? '#1f9d57' : '#d04a3b'} />
        <Kpi label="Безубыточность ТБ-0" value={pnl.tb0 != null ? fmt(pnl.tb0) : '—'} sub="доход, чтобы в ноль" />
      </div>

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
                    <span className="text-[10px] font-semibold text-[#0f8b93] mr-1.5">{inc.unit}</span>
                    {inc.label}
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

        <Card title="Отчёт о прибыли (P&L)" hint="месяц, при плановом доходе">
          <table className="w-full text-[13px] border-collapse">
            <tbody>
              <PnlRow label="Доход (план)" value={pnl.revenue} strong />
              <PnlRow label="− Переменные (VC, налог внутри)" value={-pnl.variableCost} sub />
              <PnlRow label="= Маржинальная прибыль" value={pnl.margin} total />
              <PnlRow label="− Постоянные расходы" value={-pnl.fixedTotal} sub />
              <PnlRow label="= EBITDA (операционный результат)" value={pnl.ebitda} total color={pnl.ebitda >= 0 ? '#1f9d57' : '#d04a3b'} />
              <PnlRow label="− Фонды из маржи" value={-pnl.fundsRub} sub />
              <PnlRow label="= Остаток (перелив)" value={pnl.remainder} total color={pnl.remainder >= 0 ? '#1f9d57' : '#d04a3b'} />
            </tbody>
          </table>
          <p className="text-[11px] text-[#9a9a95] mt-2.5 leading-relaxed">
            Налог не отдельной строкой — он уже внутри переменных (УСН/НДС статьями в «Точке безубыточности»).
            <b> Доход — плановый</b>; себестоимость и постоянные — реальная структура.
            ТБ-1 (с фондами): <b>{pnl.tb1 != null ? fmt(pnl.tb1) : '—'}</b>.
          </p>
        </Card>
      </div>
    </>
  )
}

function PnlRow({ label, value, strong, sub, total, color }: {
  label: string; value: number; strong?: boolean; sub?: boolean; total?: boolean; color?: string
}) {
  return (
    <tr className={total ? 'border-t-2 border-[#d3d3ce]' : 'border-t border-[#e4e4e0]'}>
      <td className={`text-left py-1.5 ${sub ? 'text-[#9a9a95] text-[12px]' : total || strong ? 'text-[#111110] font-semibold' : 'text-[#4a4a46]'}`}>
        {label}
      </td>
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
  const dEbitda = scen.ebitda - base.ebitda
  const activePreset = presets.find((p) => p.excluded.length === excluded.length && p.excluded.every((k) => excluded.includes(k)))

  const units = Array.from(new Set(fixed.map((f) => f.unit)))

  return (
    <>
      <Card title="Постоянные расходы — включить / убрать" hint="пресеты и галочки">
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

      <Card title="Факт vs Сценарий" hint="доход и переменные не меняются">
        <div className="grid grid-cols-2 border border-[#e4e4e0] rounded-xl overflow-hidden">
          <CmpCol label="Факт (все расходы)" pnl={base} shaded />
          <CmpCol label="Сценарий" pnl={scen} />
        </div>
        <p className="text-[11.5px] text-[#9a9a95] mt-3 leading-relaxed">
          <b className="text-[#4a4a46]">Разница по EBITDA:</b>{' '}
          <span className="font-mono font-semibold" style={{ color: dEbitda >= 0 ? '#1f9d57' : '#d04a3b' }}>
            {dEbitda >= 0 ? '+' : ''}{fmt(dEbitda)}/мес
          </span>
          . Убрать кредит и лизинг — это операционная прибыльность без долговой нагрузки: сколько бизнес зарабатывает сам.
          Долг остаётся, но видно здоровье операции. То же самое, что вкладка «Компания 1» на «Точке безубыточности».
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
      {row('Постоянные', fmt(pnl.fixedTotal))}
      {row('EBITDA', fmt(pnl.ebitda), true, pnl.ebitda >= 0 ? '#1f9d57' : '#d04a3b')}
      {row('EBITDA %', pnl.ebitdaPct.toFixed(0) + '%')}
      {row('Безубыточность ТБ-0', pnl.tb0 != null ? fmt(pnl.tb0) : '—')}
    </div>
  )
}

function DataTab() {
  const have = [
    ['Структура себестоимости (VC%)', 'по юнитам M-Glass и Производство, из «Точки безубыточности»', 'finplan_models.data.incomes[].vars'],
    ['Постоянные расходы', 'детально, по статьям и юнитам', 'finplan_models.data.fixed'],
    ['Долговая нагрузка', 'кредит и лизинг отдельными статьями', 'finplan_models (кредит/лизинг)'],
    ['Фонды из маржи', 'инвест, обучение, резерв, бонусы производства', 'finplan_models.data.funds'],
    ['Точки безубыточности', 'та же математика, что здесь', 'lib/breakeven.ts'],
  ]
  const miss = [
    ['Фактическая выручка (не план)', 'доход здесь — плановый; факт оплат считается в другом месте и пока не бьётся', 'payments / crm_sales'],
    ['Разнесение общих постоянных', 'часть общих статей задвоена в обоих юнитах — уточняется владельцем', 'комментарий в breakeven/page.tsx'],
    ['Факт vs план по месяцам', 'сейчас модель на плане; нужен помесячный факт', ''],
  ]
  return (
    <>
      <p className="text-sm text-[#4a4a46] mb-3.5 max-w-[72ch]">
        Модель опирается на «Точку безубыточности» — там твои реальные переменные и постоянные. Что уже есть и что стоит уточнить:
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-3.5 shadow-sm">
          <h3 className="text-[13px] font-semibold text-[#1f9d57] mb-2">✓ Что уже есть (из break-even)</h3>
          <ul className="text-[12.5px]">
            {have.map(([t, d, src], i) => (
              <li key={i} className="py-1.5 border-t border-[#e4e4e0] first:border-t-0 text-[#4a4a46]">
                <span className="text-[#1f9d57] font-bold mr-1.5">✓</span>
                <b className="text-[#111110]">{t}</b>{d ? ` — ${d}` : ''}
                {src && <span className="block text-[10.5px] text-[#9a9a95] font-mono mt-0.5 ml-4">{src}</span>}
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-3.5 shadow-sm">
          <h3 className="text-[13px] font-semibold text-[#c98a12] mb-2">? Чего не хватает</h3>
          <ul className="text-[12.5px]">
            {miss.map(([t, d, src], i) => (
              <li key={i} className="py-1.5 border-t border-[#e4e4e0] first:border-t-0 text-[#4a4a46]">
                <span className="text-[#c98a12] font-bold mr-1.5">?</span>
                <b className="text-[#111110]">{t}</b>{d ? ` — ${d}` : ''}
                {src && <span className="block text-[10.5px] text-[#9a9a95] font-mono mt-0.5 ml-4">{src}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  )
}
