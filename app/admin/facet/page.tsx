'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

type FacetRow = {
  id: number
  type_mm: number
  cost_price: number
  transport_cost: number
  sale_price: number
  active: boolean
}

function fmtRub(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

const FACET_TYPES = [10, 15, 20]

export default function FacetPage() {
  const [rows, setRows]           = useState<FacetRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState<number | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [tableExists, setTableExists] = useState(true)

  // Editing state per row
  const [edits, setEdits] = useState<Record<number, Partial<FacetRow>>>({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const sb = createClient()
    const { data, error: err } = await sb
      .from('facet_prices')
      .select('*')
      .order('type_mm')

    if (err) {
      if (
        err.message.includes('does not exist') ||
        err.message.includes('schema cache') ||
        err.message.includes('Could not find') ||
        err.code === '42P01' ||
        err.code === 'PGRST204'
      ) {
        setTableExists(false)
      } else {
        setError(err.message)
      }
      setLoading(false)
      return
    }

    setRows((data ?? []) as FacetRow[])
    setLoading(false)
  }

  function getVal(row: FacetRow, field: keyof FacetRow): number | boolean {
    const edit = edits[row.id]
    if (edit && field in edit) return edit[field as keyof typeof edit] as number | boolean
    return row[field] as number | boolean
  }

  function setEdit(id: number, field: keyof FacetRow, val: number | boolean) {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], [field]: val } }))
  }

  async function saveRow(row: FacetRow) {
    const edit = edits[row.id]
    if (!edit || Object.keys(edit).length === 0) return
    setSaving(row.id)
    setError(null)
    const sb = createClient()
    const { error: err } = await sb
      .from('facet_prices')
      .update(edit)
      .eq('id', row.id)
    if (err) {
      setError(err.message)
    } else {
      setEdits(prev => { const n = { ...prev }; delete n[row.id]; return n })
      await load()
    }
    setSaving(null)
  }

  if (!tableExists) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-[20px] font-semibold text-[#111110] mb-4">Фацет — прайс</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <p className="text-[13px] font-semibold text-amber-800 mb-2">Таблица facet_prices не создана</p>
          <p className="text-[12px] text-amber-700 mb-3">Выполни SQL-миграцию в Supabase SQL Editor:</p>
          <pre className="text-[11px] bg-white border border-amber-200 rounded-lg p-3 overflow-x-auto text-amber-900 whitespace-pre-wrap">{`CREATE TABLE IF NOT EXISTS facet_prices (
  id             serial PRIMARY KEY,
  type_mm        integer NOT NULL,
  cost_price     numeric(10,2) NOT NULL DEFAULT 0,
  transport_cost numeric(10,2) NOT NULL DEFAULT 0,
  sale_price     numeric(10,2) NOT NULL DEFAULT 0,
  active         boolean NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO facet_prices (type_mm, cost_price, transport_cost, sale_price) VALUES
  (10, 0, 0, 0),
  (15, 0, 0, 0),
  (20, 0, 0, 0);`}</pre>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-[760px] mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">Фацет — прайс</h1>
        <p className="text-[13px] text-[#8a8a85] mt-0.5">Цены на фацетную обработку торца (₽ за погонный метр периметра)</p>
      </div>

      {/* Пояснение */}
      <div className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-xl px-4 py-3 mb-6 text-[12px] text-[#6b6b66] space-y-1">
        <p><span className="font-semibold text-[#111110]">Расчёт фацета</span> = периметр детали (м) × кол-во штук × цена ₽/м.п.</p>
        <p>Себестоимость = себестоимость подрядчика + транспортные расходы. Продажная цена — цена клиенту.</p>
      </div>

      {error && <p className="text-[13px] text-red-600 bg-red-50 px-3 py-2 rounded-lg mb-4">{error}</p>}

      <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-[13px] text-[#8a8a85]">Загрузка...</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-[#8a8a85]">
            Нет записей. Выполни SQL-миграцию выше для создания таблицы и базовых записей.
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-[#fafaf9] border-b border-[#e4e4e0]">
              <tr>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest w-24">Тип</th>
                <th className="text-center px-3 py-3 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">
                  Себест. подрядчика<br/>
                  <span className="text-[9px] normal-case font-normal">₽/м.п.</span>
                </th>
                <th className="text-center px-3 py-3 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">
                  Транспорт<br/>
                  <span className="text-[9px] normal-case font-normal">₽/м.п.</span>
                </th>
                <th className="text-center px-3 py-3 text-[10px] font-semibold text-emerald-700 uppercase tracking-widest">
                  Цена клиенту<br/>
                  <span className="text-[9px] normal-case font-normal">₽/м.п.</span>
                </th>
                <th className="text-center px-3 py-3 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest w-24">Итого себ.</th>
                <th className="w-24 px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f8f8f7]">
              {rows.map(row => {
                const dirty = !!(edits[row.id] && Object.keys(edits[row.id]).length > 0)
                const costTotal = Number(getVal(row, 'cost_price')) + Number(getVal(row, 'transport_cost'))
                return (
                  <tr key={row.id} className={`transition-colors ${dirty ? 'bg-blue-50' : 'hover:bg-[#fafaf9]'}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-purple-50 text-purple-700 text-[13px] font-bold border border-purple-200">
                          {row.type_mm}
                        </span>
                        <span className="text-[12px] text-[#6b6b66]">мм</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="number" min="0" step="0.5"
                        className={`w-24 text-center bg-white border rounded-lg px-2 py-1.5 text-[13px] font-mono outline-none focus:border-[#111110] ${dirty && 'cost_price' in (edits[row.id] ?? {}) ? 'border-blue-400' : 'border-[#e4e4e0]'}`}
                        value={getVal(row, 'cost_price') as number}
                        onChange={e => setEdit(row.id, 'cost_price', Number(e.target.value))}
                      />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="number" min="0" step="0.5"
                        className={`w-24 text-center bg-white border rounded-lg px-2 py-1.5 text-[13px] font-mono outline-none focus:border-[#111110] ${dirty && 'transport_cost' in (edits[row.id] ?? {}) ? 'border-blue-400' : 'border-[#e4e4e0]'}`}
                        value={getVal(row, 'transport_cost') as number}
                        onChange={e => setEdit(row.id, 'transport_cost', Number(e.target.value))}
                      />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="number" min="0" step="0.5"
                        className={`w-24 text-center bg-white border rounded-lg px-2 py-1.5 text-[13px] font-mono outline-none focus:border-[#111110] ${dirty && 'sale_price' in (edits[row.id] ?? {}) ? 'border-emerald-400' : 'border-[#e4e4e0]'}`}
                        value={getVal(row, 'sale_price') as number}
                        onChange={e => setEdit(row.id, 'sale_price', Number(e.target.value))}
                      />
                    </td>
                    <td className="px-3 py-3 text-center text-[12px] font-mono text-[#6b6b66]">
                      {costTotal > 0 ? fmtRub(costTotal) : <span className="text-[#c4c4be]">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {dirty ? (
                        <button
                          onClick={() => saveRow(row)}
                          disabled={saving === row.id}
                          className="px-3 py-1.5 text-[12px] font-semibold bg-[#111110] text-white rounded-lg hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
                          {saving === row.id ? '...' : 'Сохранить'}
                        </button>
                      ) : (
                        <span className="text-[11px] text-[#c4c4be]">Сохранено</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Пример расчёта */}
      {rows.length > 0 && (
        <div className="mt-6 bg-[#f8f8f7] border border-[#e4e4e0] rounded-xl p-4">
          <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-3">Пример расчёта</p>
          <p className="text-[12px] text-[#6b6b66] mb-2">Деталь 600×800 мм, 3 шт. → периметр = 2 × (0.6 + 0.8) = 2.8 м.п. × 3 шт. = 8.4 м.п.</p>
          <div className="space-y-1">
            {rows.map(row => {
              const perimeter = 2 * (0.6 + 0.8)
              const qty = 3
              const totalM = perimeter * qty
              const costTotal = (row.cost_price + row.transport_cost) * totalM
              const saleTotal = row.sale_price * totalM
              return (
                <div key={row.id} className="flex items-center justify-between text-[12px]">
                  <span className="text-[#6b6b66]">Фацет {row.type_mm} мм:</span>
                  <span className="font-mono">
                    <span className="text-[#9a9a95]">себ. {fmtRub(Math.round(costTotal))}</span>
                    <span className="mx-2 text-[#c4c4be]">→</span>
                    <span className="font-semibold text-[#111110]">клиенту {fmtRub(Math.round(saleTotal))}</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
