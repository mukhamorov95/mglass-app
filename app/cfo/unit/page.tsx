'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'

type ServiceLine = { name: string; total: number }

type Calc = {
  id: number
  created_at: string
  product_type: string | null
  final_price: number | null
  base_price: number | null
  discount: number | null
  margin: number | null
  profit: number | null
  status: string | null
  client_name: string | null
  cost_breakdown: { lines: { name: string; qty: number; unit: string; price: number; total: number }[]; totalCost: number } | null
  financial_breakdown: { serviceLines: ServiceLine[]; servicesTotal: number; discountAmount?: number } | null
  creator: { name: string } | null
}

const PRODUCT_LABEL: Record<string, string> = {
  mirror: 'Зеркало', mirror_light: 'Зеркало с подсветкой',
  loft: 'Лофт', shower: 'Душевая', shower_standard: 'Душевая', shower_budget: 'Душевая',
}

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

function Bar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-[#6b6b66]">{label}</span>
        <span className="font-mono font-medium">{fmt(value)} <span className="text-[#9a9a95] font-normal">({pct}%)</span></span>
      </div>
      <div className="h-2 bg-[#f0f0ec] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function UnitEconomicsPage() {
  const [calcs, setCalcs]       = useState<Calc[]>([])
  const [selected, setSelected] = useState<Calc | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const { data } = await createClient()
          .from('calculations')
          .select('id, created_at, product_type, final_price, base_price, discount, margin, profit, status, client_name, cost_breakdown, financial_breakdown, creator:users!created_by(name)')
          .order('created_at', { ascending: false })
          .limit(100)
        const list = (data ?? []) as unknown as Calc[]
        setCalcs(list)
        if (list.length > 0) setSelected(list[0])
      } catch (e) {
        console.error(e)
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const c = selected

  // Derived financials
  const costLines   = c?.cost_breakdown?.lines ?? []
  const totalCost   = c?.cost_breakdown?.totalCost ?? 0
  const svcLines    = c?.financial_breakdown?.serviceLines ?? []
  const svcTotal    = c?.financial_breakdown?.servicesTotal ?? 0
  const discAmt     = c?.financial_breakdown?.discountAmount ?? 0
  const grandTotal  = (c?.final_price ?? 0) + svcTotal
  const taxPct      = 12
  const taxAmt      = Math.round((c?.final_price ?? 0) * taxPct / 100)
  const netProfit   = c?.profit ?? 0

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[1100px] mx-auto px-4 py-4 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-sm font-semibold text-[#111110]">CFO Center — Unit-экономика</h1>
            <p className="text-[10px] text-[#9a9a95] mt-0.5">Разбивка по каждому расчёту: себестоимость → прибыль</p>
          </div>
          <Link href="/cfo" className="text-[10px] text-[#9a9a95] hover:text-[#111110]">← Дашборд</Link>
        </div>

        <div className="grid grid-cols-[280px_1fr] gap-4">
          {/* List */}
          <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
            <div className="px-3 py-2.5 border-b border-[#e4e4e0]">
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Расчёты</p>
            </div>
            <div className="overflow-y-auto max-h-[calc(100vh-160px)]">
              {error ? (
                <div className="p-4 text-center text-xs text-[#9a9a95]">
                  Не удалось загрузить.{' '}
                  <button onClick={() => location.reload()} className="underline">Повторить</button>
                </div>
              ) : loading ? (
                <div className="p-4 text-center text-xs text-[#9a9a95]">Загрузка…</div>
              ) : calcs.map(calc => {
                const m = calc.margin ?? 0
                const isActive = selected?.id === calc.id
                return (
                  <button key={calc.id} onClick={() => setSelected(calc)}
                    className={`w-full text-left px-3 py-2.5 border-b border-[#f5f5f3] last:border-0 transition-colors ${isActive ? 'bg-[#111110] text-white' : 'hover:bg-[#fafaf9]'}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-mono ${isActive ? 'text-white/60' : 'text-[#9a9a95]'}`}>#{calc.id}</span>
                      <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${
                        isActive ? 'bg-white/20 text-white' :
                        m < 25 ? 'bg-red-50 text-red-700' :
                        m < 35 ? 'bg-amber-50 text-amber-700' :
                        'bg-emerald-50 text-emerald-700'
                      }`}>
                        {m.toFixed(1)}%
                      </span>
                    </div>
                    <div className={`text-xs font-medium mt-0.5 ${isActive ? 'text-white' : 'text-[#111110]'}`}>
                      {PRODUCT_LABEL[calc.product_type ?? ''] ?? calc.product_type}
                    </div>
                    <div className={`text-[10px] mt-0.5 ${isActive ? 'text-white/70' : 'text-[#9a9a95]'}`}>
                      {calc.client_name || '—'} · {(calc.final_price ?? 0).toLocaleString('ru-RU')} ₽
                    </div>
                    <div className={`text-[10px] ${isActive ? 'text-white/50' : 'text-[#c4c4be]'}`}>
                      {new Date(calc.created_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Detail */}
          {c ? (
            <div className="space-y-3">
              {/* Summary cards */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Цена клиенту',  value: fmt(c.final_price ?? 0),  color: 'text-[#111110]' },
                  { label: 'Себестоимость', value: fmt(totalCost),            color: 'text-[#2563eb]' },
                  { label: 'Чистая прибыль', value: fmt(netProfit),           color: netProfit > 0 ? 'text-emerald-700' : 'text-red-600' },
                  { label: 'Маржа',          value: `${(c.margin ?? 0).toFixed(1)}%`, color: (c.margin ?? 0) >= 35 ? 'text-emerald-700' : (c.margin ?? 0) >= 25 ? 'text-amber-600' : 'text-red-600' },
                ].map(card => (
                  <div key={card.label} className="bg-white rounded-lg border border-[#e4e4e0] px-3 py-3">
                    <p className="text-[10px] text-[#9a9a95]">{card.label}</p>
                    <p className={`text-base font-bold font-mono mt-0.5 ${card.color}`}>{card.value}</p>
                  </div>
                ))}
              </div>

              {/* Visual bars */}
              <div className="bg-white rounded-lg border border-[#e4e4e0] p-4 space-y-3">
                <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Структура цены (без услуг)</p>
                <Bar label="Себестоимость" value={totalCost}          total={c.final_price ?? 1} color="bg-blue-400" />
                <Bar label="Прибыль"       value={netProfit}          total={c.final_price ?? 1} color="bg-emerald-400" />
                <Bar label={`Налог ${taxPct}%`} value={taxAmt}       total={c.final_price ?? 1} color="bg-slate-300" />
                {discAmt > 0 && <Bar label="Скидка"  value={discAmt} total={c.final_price ?? 1} color="bg-amber-300" />}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Cost breakdown */}
                <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
                  <div className="px-3 py-2.5 border-b border-[#e4e4e0] flex justify-between">
                    <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Себестоимость</p>
                    <p className="text-[10px] font-bold font-mono text-[#111110]">{fmt(totalCost)}</p>
                  </div>
                  <table className="w-full text-xs">
                    <tbody>
                      {costLines.map((l, i) => (
                        <tr key={i} className="border-b border-[#f5f5f3] last:border-0">
                          <td className="px-3 py-1.5 text-[#6b6b66]">{l.name}</td>
                          <td className="px-3 py-1.5 text-[#9a9a95] text-right">{l.qty} {l.unit}</td>
                          <td className="px-3 py-1.5 font-mono text-right font-medium">{l.total.toLocaleString('ru-RU')} ₽</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Services + P&L */}
                <div className="space-y-3">
                  {svcLines.length > 0 && (
                    <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
                      <div className="px-3 py-2.5 border-b border-[#e4e4e0] flex justify-between">
                        <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Услуги</p>
                        <p className="text-[10px] font-bold font-mono text-[#111110]">{fmt(svcTotal)}</p>
                      </div>
                      <table className="w-full text-xs">
                        <tbody>
                          {svcLines.map((s, i) => (
                            <tr key={i} className="border-b border-[#f5f5f3] last:border-0">
                              <td className="px-3 py-1.5 text-[#6b6b66]">{s.name}</td>
                              <td className="px-3 py-1.5 font-mono text-right font-medium">{s.total.toLocaleString('ru-RU')} ₽</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* P&L summary */}
                  <div className="bg-white rounded-lg border border-[#e4e4e0] p-4">
                    <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-3">P&L этого расчёта</p>
                    <div className="space-y-1.5 text-xs">
                      {[
                        { label: '(+) Цена клиенту',        value: c.final_price ?? 0,    plus: true },
                        { label: '(−) Себестоимость',        value: -totalCost,             plus: false },
                        { label: `(−) Налог ${taxPct}%`,     value: -taxAmt,                plus: false },
                        { label: '= Чистая прибыль',         value: netProfit,              bold: true },
                      ].map(row => (
                        <div key={row.label} className={`flex justify-between ${row.bold ? 'border-t border-[#e4e4e0] pt-1.5 font-semibold' : ''}`}>
                          <span className="text-[#6b6b66]">{row.label}</span>
                          <span className={`font-mono ${row.bold ? (row.value > 0 ? 'text-emerald-700 font-bold' : 'text-red-600 font-bold') : row.value >= 0 ? 'text-[#111110]' : 'text-[#4b4b47]'}`}>
                            {row.value >= 0 ? '' : ''}{fmt(Math.abs(row.value))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center bg-white rounded-lg border border-[#e4e4e0] text-[#9a9a95] text-sm">
              Выбери расчёт
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
