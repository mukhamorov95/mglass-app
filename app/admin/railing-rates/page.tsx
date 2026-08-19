'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { calcFinancialModel } from '@/lib/pricing/financialModel'
import type { RailingRateRow } from '@/lib/railingRates'

// Справочник ставок лестничного/прямого ограждения. Слева себестоимость (value),
// справа продажная: для kind='cost' считается по финмодели (маржа/налог из
// «Ценообразования»), либо ручной override (sale_override). kind='rule' — только
// правило количества, продажной нет. Правки onBlur → update по key → галочка ✓.

export default function RailingRatesPage() {
  const sb = createClient()
  const [rows, setRows] = useState<RailingRateRow[]>([])
  const [margin, setMargin] = useState(40)
  const [tax, setTax] = useState(12)
  const [loading, setLoading] = useState(true)
  const [savedKey, setSavedKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [{ data: r }, { data: fs }] = await Promise.all([
      sb.from('railing_rates').select('*').order('sort'),
      sb.from('financial_settings').select('*'),
    ])
    setRows((r ?? []) as RailingRateRow[])
    const list = (fs ?? []) as Array<Record<string, unknown>>
    const pick =
      list.find(x => x.product_type === 'railing') ??
      list.find(x => x.tier === 'standard') ??
      list[0]
    if (pick) {
      const m = Number(pick.default_margin)
      const t = Number(pick.tax_percent)
      setMargin(Number.isFinite(m) ? m : 40)
      setTax(Number.isFinite(t) ? t : 12)
    }
    setLoading(false)
  }, [sb])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  function flash(key: string) { setSavedKey(key); setTimeout(() => setSavedKey(null), 1200) }

  async function saveField(key: string, field: keyof RailingRateRow, value: number | string | null) {
    setRows(prev => prev.map(r => r.key === key ? { ...r, [field]: value } as RailingRateRow : r))
    const { error } = await sb.from('railing_rates').update({ [field]: value }).eq('key', key)
    if (!error) flash(key)
  }

  // Продажная цена по kind='cost': override, иначе по финмодели.
  function salePrice(r: RailingRateRow): number | null {
    if (r.sale_override != null) return Number(r.sale_override)
    const fm = calcFinancialModel({ directCost: Number(r.value) || 0, marginPercent: margin, taxPercent: tax })
    return fm ? fm.basePrice : null
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка…</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Ограждение — ставки</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">
          Себестоимость слева. Продажная справа считается автоматически (маржа {margin}% + налог {tax}% из «Ценообразования»), можно переопределить вручную.
        </p>
      </div>

      <div className="px-5 pt-4 max-w-[980px]">
        <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[11px] text-[#9a9a95] border-b border-[#e4e4e0]">
                <th className="text-left font-medium px-4 py-2.5">Параметр</th>
                <th className="text-left font-medium px-2 py-2.5">Ед.</th>
                <th className="text-right font-medium px-2 py-2.5">Себестоимость</th>
                <th className="text-right font-medium px-2 py-2.5">Продажная</th>
                <th className="text-left font-medium px-2 py-2.5">Продавец</th>
                <th className="text-left font-medium px-4 py-2.5">Ссылка</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f5f5f3]">
              {rows.map(r => {
                const isCost = r.kind === 'cost'
                const auto = salePrice(r)
                return (
                  <tr key={r.key} className="align-middle">
                    <td className="px-4 py-2.5 text-[#111110]">
                      {r.label}
                      {savedKey === r.key && <span className="ml-2 text-[11px] text-emerald-600">✓</span>}
                    </td>
                    <td className="px-2 py-2.5 text-[11px] text-[#9a9a95] whitespace-nowrap">{r.unit}</td>
                    <td className="px-2 py-2.5 text-right">
                      <input type="number" value={r.value}
                        onChange={e => setRows(prev => prev.map(x => x.key === r.key ? { ...x, value: Number(e.target.value) } : x))}
                        onBlur={e => saveField(r.key, 'value', Number(e.target.value) || 0)}
                        className="w-24 bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] font-mono text-right outline-none focus:border-[#111110]" />
                    </td>
                    <td className="px-2 py-2.5 text-right whitespace-nowrap">
                      {isCost ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <input type="number"
                            placeholder={auto != null ? String(auto) : ''}
                            value={r.sale_override ?? ''}
                            onChange={e => {
                              const v = e.target.value === '' ? null : Number(e.target.value)
                              setRows(prev => prev.map(x => x.key === r.key ? { ...x, sale_override: v } : x))
                            }}
                            onBlur={e => saveField(r.key, 'sale_override', e.target.value === '' ? null : (Number(e.target.value) || 0))}
                            className={`w-24 border rounded-lg px-2.5 py-1.5 text-[13px] font-mono text-right outline-none focus:border-[#111110] ${r.sale_override != null ? 'bg-amber-50 border-amber-300' : 'bg-white border-[#e4e4e0] placeholder:text-[#9a9a95]'}`} />
                          {r.sale_override != null && (
                            <button title="Сбросить override → по финмодели"
                              onClick={() => saveField(r.key, 'sale_override', null)}
                              className="text-[#9a9a95] hover:text-red-500 text-[13px] leading-none">✕</button>
                          )}
                        </div>
                      ) : (
                        <span className="text-[#9a9a95]">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <input type="text" value={r.vendor ?? ''}
                        onChange={e => setRows(prev => prev.map(x => x.key === r.key ? { ...x, vendor: e.target.value } : x))}
                        onBlur={e => saveField(r.key, 'vendor', e.target.value || null)}
                        className="w-32 bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
                    </td>
                    <td className="px-4 py-2.5">
                      <input type="text" value={r.source_url ?? ''} placeholder="https://…"
                        onChange={e => setRows(prev => prev.map(x => x.key === r.key ? { ...x, source_url: e.target.value } : x))}
                        onBlur={e => saveField(r.key, 'source_url', e.target.value || null)}
                        className="w-44 bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-[#111110] placeholder:text-[#9a9a95]" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-[#9a9a95] mt-3">
          «Продажная» для себестоимостных ставок считается по формуле: себестоимость / (1 − маржа − налог). Введите значение в поле «Продажная», чтобы задать цену вручную (подсветится жёлтым), крестик — вернуть авторасчёт. Правила количества (шт/пог.м, %) — без продажной.
        </p>
      </div>
    </div>
  )
}
