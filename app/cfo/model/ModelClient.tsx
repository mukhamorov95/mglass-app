'use client'

import { useState } from 'react'
import {
  computePnl,
  scenarioPresets,
  type RevenueLine,
  type FixedCostLine,
  type TaxSystem,
  type ProfitSplit,
  type Pnl,
} from '@/lib/cfo/factModel'

type Props = {
  revenueLines: RevenueLine[]
  fixedCosts: FixedCostLine[]
  taxSystem: TaxSystem
  profitSplit: ProfitSplit
  insuranceMonthly: number
  monthLabel: string
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

export default function ModelClient({
  revenueLines, fixedCosts, taxSystem, profitSplit, insuranceMonthly, monthLabel,
}: Props) {
  const [tab, setTab] = useState<Tab>('fact')
  const [excluded, setExcluded] = useState<string[]>([])

  const input = { revenueLines, fixedCosts, taxSystem, profitSplit, insuranceMonthly }
  const presets = scenarioPresets(fixedCosts)
  const base = computePnl(input, [])
  const scen = computePnl(input, excluded)

  const toggle = (key: string) =>
    setExcluded((ex) => (ex.includes(key) ? ex.filter((k) => k !== key) : [...ex, key]))
  const applyPreset = (ex: string[]) => setExcluded(ex)

  const tabs: { id: Tab; label: string }[] = [
    { id: 'fact', label: 'Факт' },
    { id: 'scen', label: 'Сценарии' },
    { id: 'data', label: 'Данные' },
  ]

  return (
    <div className="min-h-screen bg-[#f5f5f3] text-[#111110] px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-[1080px]">
        <div className="text-xs text-[#9a9a95] mb-1">CFO / <span className="text-[#4a4a46] font-semibold">Финмодель</span></div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">Финмодель — факт и сценарии</h1>
        <p className="text-sm text-[#4a4a46] max-w-[70ch] mb-3">
          Честный факт из наших данных за {monthLabel}, и что будет, если убрать лизинг и кредит при той же выручке.
        </p>
        <span className="inline-block text-[10.5px] font-semibold text-[#0f8b93] bg-[#e6f1f1] rounded-md px-2 py-0.5 mb-4">
          выручка — из данных где есть, иначе план · постоянные — из cfo_settings
        </span>

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

        {tab === 'fact' && <FactTab pnl={base} revenueLines={revenueLines} />}
        {tab === 'scen' && (
          <ScenTab
            base={base} scen={scen} fixedCosts={fixedCosts}
            excluded={excluded} presets={presets} toggle={toggle} applyPreset={applyPreset}
          />
        )}
        {tab === 'data' && <DataTab />}

        <p className="mt-6 text-[11px] text-[#9a9a95] text-center">
          /cfo/model · логика из /admin/cfo · планы роста — отдельной вкладкой после закрепления факта
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

function FactTab({ pnl, revenueLines }: { pnl: Pnl; revenueLines: RevenueLine[] }) {
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3.5">
        <Kpi label="Оборот / мес" value={fmt(pnl.revenue)} sub={'год ≈ ' + fmt(pnl.revenue * 12)} />
        <Kpi label="Маржинальность" value={pnl.contributionPct.toFixed(0) + '%'} sub={fmt(pnl.contribution)} subColor={marginColor(pnl.contributionPct)} />
        <Kpi label="EBITDA / мес" value={fmt(pnl.ebitda)} sub={pnl.ebitdaPct.toFixed(0) + '% оборота'} subColor={marginColor(pnl.ebitdaPct)} />
        <Kpi label="Безубыточность" value={pnl.tb0 != null ? fmt(pnl.tb0) : '—'} sub="оборот, чтобы в ноль" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 items-start">
        <Card title="Выручка → маржинальная прибыль" hint="в месяц">
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-[#9a9a95]">
                <th className="text-left font-semibold py-1.5">Направление</th>
                <th className="text-right font-semibold py-1.5">Выручка</th>
                <th className="text-right font-semibold py-1.5">VC%</th>
                <th className="text-right font-semibold py-1.5">Маржин.</th>
              </tr>
            </thead>
            <tbody>
              {revenueLines.map((r) => (
                <tr key={r.id} className="border-t border-[#e4e4e0]">
                  <td className="text-left text-[#4a4a46] py-1.5">
                    {r.label}
                    <span className={`ml-1.5 text-[9px] font-semibold px-1 py-px rounded ${r.isActual ? 'text-[#1f9d57] bg-[#1f9d5722]' : 'text-[#9a9a95] border border-[#d3d3ce]'}`}>
                      {r.isActual ? 'факт' : 'план'}
                    </span>
                  </td>
                  <td className="text-right font-mono tabular-nums py-1.5">{fmt(r.revenue)}</td>
                  <td className="text-right font-mono tabular-nums text-[#9a9a95] py-1.5">{r.vcPct}%</td>
                  <td className="text-right font-mono tabular-nums py-1.5">{fmt(r.revenue * (1 - r.vcPct / 100))}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-[#d3d3ce] font-semibold">
                <td className="text-left py-1.5">Итого</td>
                <td className="text-right font-mono tabular-nums py-1.5">{fmt(pnl.revenue)}</td>
                <td className="text-right font-mono tabular-nums py-1.5">{pnl.weightedVcPct.toFixed(0)}%</td>
                <td className="text-right font-mono tabular-nums py-1.5">{fmt(pnl.contribution)}</td>
              </tr>
            </tbody>
          </table>
        </Card>

        <Card title="Отчёт о прибыли (P&L)" hint="месяц">
          <table className="w-full text-[13px] border-collapse">
            <tbody>
              <PnlRow label="Оборот" value={pnl.revenue} strong />
              <PnlRow label="− Переменные затраты" value={-(pnl.variableCost)} sub />
              <PnlRow label="= Маржинальная прибыль" value={pnl.contribution} total />
              <PnlRow label="− Постоянные расходы" value={-pnl.fixedTotal} sub tag="дефолт" />
              <PnlRow label="= EBITDA" value={pnl.ebitda} total color={pnl.ebitda >= 0 ? '#1f9d57' : '#d04a3b'} />
              <PnlRow label="− Налог + страховые" value={-(pnl.tax + pnl.insurance)} sub tag="?" />
              <PnlRow label="= Чистая прибыль" value={pnl.netProfit} total />
              <PnlRow label="Владельцу (20%)" value={pnl.fundsOwner} indent color="#0f8b93" />
              <PnlRow label="Обучение (5%) + резерв (5%)" value={pnl.fundsEducation + pnl.fundsReserve} indent />
              <PnlRow label="Остаётся в бизнесе" value={pnl.retained} indent />
            </tbody>
          </table>
          <p className="text-[11px] text-[#9a9a95] mt-2.5 leading-relaxed">
            <span className="text-[#1f9d57] font-semibold">факт</span> — из реальных данных ·{' '}
            <span className="text-[#9a9a95] font-semibold">дефолт / ?</span> — из настроек или под вопросом (вкладка «Данные»).
            Годовой оборот ≈ <b>{fmt(pnl.revenue * 12)}</b>.
          </p>
        </Card>
      </div>
    </>
  )
}

function PnlRow({ label, value, strong, sub, total, indent, color, tag }: {
  label: string; value: number; strong?: boolean; sub?: boolean; total?: boolean; indent?: boolean; color?: string; tag?: string
}) {
  return (
    <tr className={total ? 'border-t-2 border-[#d3d3ce]' : 'border-t border-[#e4e4e0]'}>
      <td className={`text-left py-1.5 ${sub ? 'text-[#9a9a95] text-[12px]' : total || strong ? 'text-[#111110] font-semibold' : 'text-[#4a4a46]'} ${indent ? 'pl-3' : ''}`}>
        {label}
        {tag && <span className="ml-1.5 text-[9px] font-semibold px-1 py-px rounded text-[#9a9a95] border border-[#d3d3ce]">{tag}</span>}
      </td>
      <td className="text-right font-mono tabular-nums py-1.5 whitespace-nowrap" style={color ? { color } : undefined}>
        {value < 0 ? '−' + fmt(Math.abs(value)) : fmt(value)}
      </td>
    </tr>
  )
}

function ScenTab({ base, scen, fixedCosts, excluded, presets, toggle, applyPreset }: {
  base: Pnl; scen: Pnl; fixedCosts: FixedCostLine[]; excluded: string[]
  presets: { id: string; label: string; excluded: string[] }[]
  toggle: (key: string) => void; applyPreset: (ex: string[]) => void
}) {
  const dEbitda = scen.ebitda - base.ebitda
  const dOwner = scen.fundsOwner - base.fundsOwner
  const activePreset = presets.find((p) => p.excluded.length === excluded.length && p.excluded.every((k) => excluded.includes(k)))

  return (
    <>
      <Card title="Постоянные расходы — включить / убрать" hint="пресеты и галочки">
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p.excluded)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border ${
                activePreset?.id === p.id ? 'bg-[#0f8b93] border-[#0f8b93] text-white' : 'bg-white border-[#d3d3ce] text-[#4a4a46]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div>
          {fixedCosts.map((f) => {
            const off = excluded.includes(f.key)
            return (
              <label key={f.key} className="flex items-center gap-2.5 py-1.5 border-t border-[#e4e4e0] first:border-t-0 text-[13px] cursor-pointer">
                <input type="checkbox" checked={!off} onChange={() => toggle(f.key)} className="w-[17px] h-[17px] accent-[#0f8b93]" />
                <span className={`flex-1 ${off ? 'text-[#9a9a95] line-through' : 'text-[#4a4a46]'}`}>
                  {f.label}
                  {f.isFinancing && <span className="ml-1.5 text-[9px] font-semibold text-[#8a5cd0] border border-[#8a5cd066] rounded px-1 py-px">долг</span>}
                </span>
                <span className={`font-mono tabular-nums ${off ? 'text-[#9a9a95] line-through' : 'text-[#111110]'}`}>{fmt(f.amount)}</span>
              </label>
            )
          })}
        </div>
      </Card>

      <Card title="Факт vs Сценарий" hint="та же выручка, те же переменные">
        <div className="grid grid-cols-2 border border-[#e4e4e0] rounded-xl overflow-hidden">
          <CmpCol label="Факт (все расходы)" pnl={base} shaded />
          <CmpCol label="Сценарий" pnl={scen} />
        </div>
        <p className="text-[11.5px] text-[#9a9a95] mt-3 leading-relaxed">
          <b className="text-[#4a4a46]">Разница по EBITDA:</b>{' '}
          <span className="font-mono font-semibold" style={{ color: dEbitda >= 0 ? '#1f9d57' : '#d04a3b' }}>
            {dEbitda >= 0 ? '+' : ''}{fmt(dEbitda)}/мес
          </span>{' · владельцу '}
          <span className="font-mono font-semibold" style={{ color: dOwner >= 0 ? '#1f9d57' : '#d04a3b' }}>
            {dOwner >= 0 ? '+' : ''}{fmt(dOwner)}/мес
          </span>
          . Убрать лизинг/кредит — это взгляд на <b className="text-[#4a4a46]">операционную прибыльность без долговой нагрузки</b>:
          показывает, сколько бизнес зарабатывает сам. Долг никуда не девается, но так видно здоровье операции.
        </p>
      </Card>
    </>
  )
}

function CmpCol({ label, pnl, shaded }: { label: string; pnl: Pnl; shaded?: boolean }) {
  const row = (l: string, v: string, big?: boolean, color?: string) => (
    <div className={`flex justify-between text-[13px] py-1 ${big ? 'font-semibold border-t border-[#e4e4e0] mt-1 pt-2' : 'text-[#4a4a46]'}`}>
      <span>{l}</span>
      <span className="font-mono tabular-nums" style={color ? { color } : { color: '#111110' }}>{v}</span>
    </div>
  )
  return (
    <div className={`px-4 py-3 ${shaded ? 'bg-[#fafaf9] border-r border-[#e4e4e0]' : ''}`}>
      <div className="text-[10.5px] uppercase tracking-wide text-[#9a9a95] mb-2">{label}</div>
      {row('Маржинальная прибыль', fmt(pnl.contribution))}
      {row('Постоянные', fmt(pnl.fixedTotal))}
      {row('EBITDA', fmt(pnl.ebitda), true, pnl.ebitda >= 0 ? '#1f9d57' : '#d04a3b')}
      {row('EBITDA %', pnl.ebitdaPct.toFixed(0) + '%')}
      {row('Владельцу', fmt(pnl.fundsOwner), true, '#0f8b93')}
      {row('Безубыточность', pnl.tb0 != null ? fmt(pnl.tb0) : '—')}
    </div>
  )
}

function DataTab() {
  const have = [
    ['Выручка розница', 'одобренные расчёты и заказы', 'calculations.final_price, orders.total_sale_price'],
    ['Выручка B2B', 'обороты по заказам', 'b2b_orders.total_after_discount'],
    ['Реальные оплаты', 'платежи и книга продаж с маржой', 'payments, crm_sales, v_crm_sales_margin'],
    ['Себестоимость заказов', 'материалы, закалка', 'cost_breakdown, orders.total_cost_price'],
    ['Разбивка по направлениям', '', 'PRODUCT_TO_DIR'],
    ['Точка безубыточности', '', 'finplan_models, lib/breakeven.ts'],
  ]
  const miss = [
    ['Постоянные расходы по факту, помесячно', 'сейчас дефолты в cfo_settings, а не реальные платежи аренды/лизинга/кредита', 'нужна таблица cfo_actual_costs'],
    ['VC% из реальной себестоимости', '62/49/25 захардкожены, а не выведены из cost data', ''],
    ['Один источник правды по выручке', 'два параллельных: calculations и crm_sales/payments', ''],
    ['Налоговая нагрузка', 'УСН 6% vs 12% в формуле цены — уточнить', ''],
    ['График лизинга и кредита', 'остаток, даты закрытия — для сценария «когда уйдёт долг»', ''],
    ['Маркетинг по направлениям / CAC', 'нет привязки затрат к каналам', ''],
  ]
  return (
    <>
      <p className="text-sm text-[#4a4a46] mb-3.5 max-w-[70ch]">
        Прежде чем строить планы — честно: что уже есть в данных, а чего не хватает, чтобы факт был точным, а не на дефолтах.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-3.5 shadow-sm">
          <h3 className="text-[13px] font-semibold text-[#1f9d57] mb-2">✓ Что уже есть</h3>
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
      <div className="bg-white border border-[#e4e4e0] rounded-xl p-3.5 shadow-sm mt-3.5 text-[13px] text-[#4a4a46] leading-relaxed">
        <b className="text-[#111110]">Следующий шаг к точному факту:</b> таблица <span className="font-mono text-[12px] bg-[#fafaf9] border border-[#e4e4e0] rounded px-1">cfo_actual_costs</span> (месяц × статья × сумма) — чтобы постоянные и VC% приходили из реального учёта, а не из дефолтов. Тогда вкладка «Факт» станет полностью на реальных данных.
      </div>
    </>
  )
}
