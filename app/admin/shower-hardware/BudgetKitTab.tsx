'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import type { Color, Supplier } from './CatalogTab'

type CatItem = { id: number; name: string; category: string; unit: string; shower_types: string[] }
type CatalogPrice = { item_id: number; supplier_id: number; color_id: number; cost_price: number }
type KitRow = { id: number; model_id: string; item_id: number; supplier_id: number | null; sort_order: number }

const MODELS = ['M1','M2','M3','M4','M5','M6','M7','M8','M9','M10','M11','M12']

export function BudgetKitTab({ colors, suppliers }: { colors: Color[]; suppliers: Supplier[] }) {
  const db         = useRef(createClient())
  const [model,    setModel]    = useState('M1')
  const [allItems, setAllItems] = useState<CatItem[]>([])
  const [kitRows,  setKitRows]  = useState<KitRow[]>([])
  const [prices,   setPrices]   = useState<CatalogPrice[]>([])
  const [loading,  setLoading]  = useState(true)
  const [showAdd,  setShowAdd]  = useState(false)
  const [search,   setSearch]   = useState('')

  useEffect(() => {
    db.current.from('shower_catalog_items').select('id,name,category,unit,shower_types')
      .eq('active', true).order('category').order('name')
      .then(({ data }) => setAllItems((data ?? []) as CatItem[]))
  }, [])

  const loadKit = useCallback(async (m: string) => {
    setLoading(true)
    const { data: rows } = await db.current.from('shower_budget_kit_rows')
      .select('*').eq('model_id', m).order('sort_order')
    const rowsData = (rows ?? []) as KitRow[]
    setKitRows(rowsData)

    if (rowsData.length > 0) {
      const itemIds = rowsData.map(r => r.item_id)
      const { data: p } = await db.current.from('shower_catalog_prices')
        .select('item_id,supplier_id,color_id,cost_price').in('item_id', itemIds)
      setPrices((p ?? []) as CatalogPrice[])
    } else {
      setPrices([])
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadKit(model) }, [model, loadKit])

  async function addItem(itemId: number) {
    if (kitRows.find(r => r.item_id === itemId)) return
    const { data } = await db.current.from('shower_budget_kit_rows')
      .insert({ model_id: model, item_id: itemId, supplier_id: null, sort_order: kitRows.length })
      .select('*').single()
    if (data) setKitRows(prev => [...prev, data as KitRow])
    setShowAdd(false); setSearch('')
  }

  async function removeRow(id: number) {
    await db.current.from('shower_budget_kit_rows').delete().eq('id', id)
    setKitRows(prev => prev.filter(r => r.id !== id))
  }

  async function setSupplier(rowId: number, supplierId: number | null) {
    await db.current.from('shower_budget_kit_rows').update({ supplier_id: supplierId }).eq('id', rowId)
    setKitRows(prev => prev.map(r => r.id === rowId ? { ...r, supplier_id: supplierId } : r))
  }

  const activeColors = colors.filter(c => c.active)
  const addable = allItems
    .filter(i => !kitRows.find(r => r.item_id === i.id))
    .filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()))

  // status counters
  const filled  = kitRows.filter(r => r.supplier_id && prices.some(p => p.item_id === r.item_id && p.supplier_id === r.supplier_id)).length
  const total   = kitRows.length

  return (
    <div className="space-y-4">

      {/* Model tabs */}
      <div className="flex flex-wrap gap-1">
        {MODELS.map(m => (
          <button key={m} onClick={() => setModel(m)}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
              model === m ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f8f8f7]'
            }`}>{m}</button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <button onClick={() => setShowAdd(v => !v)}
          className="px-3 py-1.5 bg-white border border-[#e4e4e0] rounded-lg text-[13px] text-[#111110] hover:bg-[#f8f8f7]">
          + Добавить позицию из справочника
        </button>
        {total > 0 && (
          <span className="text-[12px] text-[#9a9a95]">
            Заполнено: <span className={`font-semibold ${filled === total ? 'text-emerald-600' : 'text-amber-600'}`}>{filled}/{total}</span>
          </span>
        )}
      </div>

      {/* Add item panel */}
      {showAdd && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-[12px] font-semibold text-blue-700 mb-2">Выберите позицию из справочника для модели {model}</p>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по названию..."
            className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-blue-400 bg-white mb-2" />
          <div className="max-h-48 overflow-y-auto space-y-0.5 bg-white rounded-lg border border-[#e4e4e0]">
            {addable.map(item => (
              <button key={item.id} onClick={() => addItem(item.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-[#111110] hover:bg-[#f8f8f7] text-left border-b border-[#f0f0ec] last:border-0">
                <span className="font-medium">{item.name}</span>
                <span className="text-[10px] bg-[#f0f0ec] text-[#6b6b66] px-1.5 py-0.5 rounded">{item.category}</span>
                <span className="text-[11px] text-[#9a9a95]">{item.unit}</span>
              </button>
            ))}
            {addable.length === 0 && (
              <p className="px-3 py-3 text-[12px] text-[#9a9a95]">
                {allItems.length === 0 ? 'Справочник пустой — сначала добавьте позиции' : 'Все позиции уже добавлены'}
              </p>
            )}
          </div>
          <button onClick={() => setShowAdd(false)} className="mt-2 text-[12px] text-[#9a9a95] hover:text-[#6b6b66]">Отмена</button>
        </div>
      )}

      {/* Kit table */}
      <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-[#9a9a95] text-[13px]">Загрузка...</div>
        ) : kitRows.length === 0 ? (
          <div className="p-8 text-center text-[#9a9a95] text-[13px]">
            Комплект {model} пустой — добавьте позиции из справочника
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div style={{ minWidth: 310 + activeColors.length * 88 }}>

              {/* Header */}
              <div className="flex bg-[#f5f5f3] border-b-2 border-[#e4e4e0]">
                <div className="px-3 py-2.5 text-[10px] font-bold text-[#6b6b66] uppercase tracking-wide border-r border-[#e4e4e0]" style={{ width: 190 }}>
                  Позиция
                </div>
                <div className="px-3 py-2.5 text-[10px] font-bold text-[#6b6b66] uppercase tracking-wide border-r border-[#e4e4e0]" style={{ width: 120 }}>
                  Поставщик
                </div>
                {activeColors.map(c => (
                  <div key={c.id} className="px-1 py-2.5 text-[9px] font-bold text-[#6b6b66] uppercase text-center leading-tight border-r border-[#e4e4e0] last:border-0"
                    style={{ width: 88 }}>
                    {c.name}
                  </div>
                ))}
                <div style={{ width: 36 }} />
              </div>

              {/* Rows */}
              {kitRows.map(row => {
                const item = allItems.find(i => i.id === row.item_id)
                if (!item) return null

                const suppliersWithPrices = [...new Set(
                  prices.filter(p => p.item_id === row.item_id).map(p => p.supplier_id)
                )]
                const hasData = row.supplier_id !== null && suppliersWithPrices.includes(row.supplier_id)
                const noPrice = row.supplier_id !== null && !suppliersWithPrices.includes(row.supplier_id)

                return (
                  <div key={row.id} className="flex items-center border-b border-[#f0f0ec] last:border-0 hover:bg-[#fafaf9] group">

                    {/* Item name */}
                    <div className="px-3 py-2.5 border-r border-[#f0f0ec]" style={{ width: 190 }}>
                      <div className="flex items-center gap-1.5">
                        {hasData  && <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" title="Данные заполнены" />}
                        {noPrice  && <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" title="Нет цен для поставщика" />}
                        {row.supplier_id === null && <span className="w-2 h-2 rounded-full bg-[#d4d4d0] flex-shrink-0" title="Поставщик не выбран" />}
                        <div>
                          <p className="text-[13px] font-medium text-[#111110] leading-tight">{item.name}</p>
                          <p className="text-[10px] text-[#9a9a95]">{item.unit}</p>
                        </div>
                      </div>
                    </div>

                    {/* Supplier select */}
                    <div className="px-2 py-2.5 border-r border-[#f0f0ec]" style={{ width: 120 }}>
                      <select
                        value={row.supplier_id ?? ''}
                        onChange={e => setSupplier(row.id, e.target.value ? Number(e.target.value) : null)}
                        className="w-full border border-[#e4e4e0] rounded px-2 py-1 text-[11px] outline-none focus:border-blue-400 bg-white">
                        <option value="">— выбрать —</option>
                        {suppliersWithPrices.length > 0 && (
                          <optgroup label="Есть цены">
                            {suppliersWithPrices.map(sId => {
                              const s = suppliers.find(s => s.id === sId)
                              return s ? <option key={s.id} value={s.id}>{s.name}</option> : null
                            })}
                          </optgroup>
                        )}
                        {suppliers.filter(s => !suppliersWithPrices.includes(s.id)).length > 0 && (
                          <optgroup label="Нет цен">
                            {suppliers.filter(s => !suppliersWithPrices.includes(s.id)).map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>

                    {/* Price cells from catalog */}
                    {activeColors.map(color => {
                      const p = prices.find(p =>
                        p.item_id === row.item_id &&
                        p.supplier_id === row.supplier_id &&
                        p.color_id === color.id
                      )
                      return (
                        <div key={color.id} className="px-1 py-2.5 text-center border-r border-[#f0f0ec] last:border-0"
                          style={{ width: 88 }}>
                          {p?.cost_price ? (
                            <span className="text-[12px] font-mono font-semibold text-[#111110]">
                              {p.cost_price.toLocaleString('ru-RU')}
                            </span>
                          ) : (
                            <span className="text-[12px] text-[#d4d4d0]">—</span>
                          )}
                        </div>
                      )
                    })}

                    {/* Remove */}
                    <div className="px-1 py-2.5 text-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ width: 36 }}>
                      <button onClick={() => removeRow(row.id)} className="text-[11px] text-[#c0c0bb] hover:text-red-500">✕</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      {kitRows.length > 0 && (
        <div className="flex items-center gap-5 text-[11px] text-[#9a9a95] flex-wrap">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"/>Данные заполнены</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"/>Нет цен для поставщика (добавьте в Справочнике)</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#d4d4d0] inline-block"/>Поставщик не выбран</span>
        </div>
      )}
    </div>
  )
}
