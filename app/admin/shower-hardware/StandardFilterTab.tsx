'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { CATEGORIES, SHOWER_TYPES, type Color, type Supplier } from './CatalogTab'

type CatItem  = { id: number; name: string; category: string; unit: string; shower_types: string[]; manufacturer: string }
type CatPrice = { id: number; item_id: number; supplier_id: number; color_id: number; website_price: number; discount_percent: number; cost_price: number }

export function StandardFilterTab({ colors, suppliers }: { colors: Color[]; suppliers: Supplier[] }) {
  const db        = useRef(createClient())
  const [items,   setItems]   = useState<CatItem[]>([])
  const [prices,  setPrices]  = useState<CatPrice[]>([])
  const [loading, setLoading] = useState(true)

  const [filterType, setFilterType] = useState('swing')
  const [filterCat,  setFilterCat]  = useState('all')
  const [filterSup,  setFilterSup]  = useState(0)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: its }, { data: prs }] = await Promise.all([
        db.current.from('shower_catalog_items')
          .select('id,name,category,unit,shower_types,manufacturer')
          .eq('active', true).order('category').order('name'),
        db.current.from('shower_catalog_prices').select('*'),
      ])
      setItems((its ?? []) as CatItem[])
      setPrices((prs ?? []) as CatPrice[])
      setLoading(false)
    }
    load()
  }, [])

  const activeColors = colors.filter(c => c.active)

  // Filter items
  const filtered = items.filter(item => {
    const typeOk = item.shower_types.includes(filterType) || item.shower_types.includes('universal')
    if (!typeOk) return false
    if (filterCat !== 'all' && item.category !== filterCat) return false
    if (filterSup) {
      const hasPrices = prices.some(p => p.item_id === item.id && p.supplier_id === filterSup)
      if (!hasPrices) return false
    }
    return true
  })

  // Group by category
  const grouped: Record<string, CatItem[]> = {}
  for (const item of filtered) {
    if (!grouped[item.category]) grouped[item.category] = []
    grouped[item.category].push(item)
  }

  // Which suppliers have any prices for filtered items
  const filteredIds = new Set(filtered.map(i => i.id))
  const relevantPrices = prices.filter(p => filteredIds.has(p.item_id))
  const suppliersWithData = [...new Set(relevantPrices.map(p => p.supplier_id))]

  const displaySuppliers = filterSup
    ? suppliers.filter(s => s.id === filterSup)
    : suppliers.filter(s => suppliersWithData.includes(s.id))

  return (
    <div className="space-y-4">

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-end bg-white border border-[#e4e4e0] rounded-xl p-4">
        <div>
          <p className="text-[11px] font-bold text-[#8a8a85] uppercase tracking-widest mb-1.5">Тип душевой</p>
          <div className="flex gap-1">
            {SHOWER_TYPES.filter(t => t.v !== 'universal').map(t => (
              <button key={t.v} onClick={() => setFilterType(t.v)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                  filterType === t.v ? 'bg-blue-600 text-white' : 'bg-[#f5f5f3] text-[#6b6b66] hover:bg-[#ececea]'
                }`}>{t.l}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[11px] font-bold text-[#8a8a85] uppercase tracking-widest mb-1.5">Категория</p>
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
            className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-[#111110] bg-white capitalize">
            <option value="all">Все категории</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <p className="text-[11px] font-bold text-[#8a8a85] uppercase tracking-widest mb-1.5">Поставщик</p>
          <select value={filterSup} onChange={e => setFilterSup(Number(e.target.value))}
            className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-[#111110] bg-white">
            <option value={0}>Все поставщики</option>
            {suppliersWithData.map(sId => {
              const s = suppliers.find(s => s.id === sId)
              return s ? <option key={s.id} value={s.id}>{s.name}</option> : null
            })}
          </select>
        </div>
        <div className="ml-auto text-[12px] text-[#9a9a95]">
          {filtered.length} позиций
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-[#9a9a95]">Загрузка...</div>
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center text-[#9a9a95] bg-white border border-[#e4e4e0] rounded-xl">
          Нет позиций для выбранных фильтров.<br />
          <span className="text-[12px]">Добавьте позиции в «Справочнике» с нужным типом душевой.</span>
        </div>
      ) : (
        Object.entries(grouped).map(([cat, catItems]) => (
          <div key={cat} className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-[#f8f8f7] border-b border-[#e4e4e0] flex items-center gap-2">
              <span className="text-[12px] font-bold text-[#111110] uppercase tracking-wide">{cat}</span>
              <span className="text-[11px] text-[#9a9a95]">{catItems.length} поз.</span>
            </div>

            <div className="overflow-x-auto">
              {/* One sub-table per supplier (if multiple) */}
              {displaySuppliers.length === 0 ? (
                <div className="px-4 py-4 text-[12px] text-[#b0b0ab] italic">
                  Нет данных — добавьте цены в Справочнике
                </div>
              ) : displaySuppliers.map(sup => {
                const supPricesForCat = relevantPrices.filter(p =>
                  p.supplier_id === sup.id && catItems.some(i => i.id === p.item_id)
                )
                if (supPricesForCat.length === 0 && filterSup === 0) return null

                return (
                  <div key={sup.id}>
                    {displaySuppliers.length > 1 && (
                      <div className="px-4 py-1.5 bg-[#fafaf9] border-b border-[#f0f0ec]">
                        <span className="text-[11px] font-bold text-[#6b6b66]">{sup.name}</span>
                      </div>
                    )}
                    <div style={{ minWidth: 200 + activeColors.length * 88 }}>
                      {/* Color header */}
                      <div className="flex bg-[#f2f2f0] border-b border-[#e8e8e6]">
                        <div className="px-3 py-2 text-[10px] font-bold text-[#9a9a95] uppercase border-r border-[#e8e8e6]" style={{ width: 200 }}>
                          {displaySuppliers.length === 1 ? `${sup.name} — наименование` : 'Наименование'}
                        </div>
                        {activeColors.map(c => (
                          <div key={c.id} className="px-1 py-2 text-[9px] font-bold text-[#9a9a95] uppercase text-center leading-tight border-r border-[#e8e8e6] last:border-0"
                            style={{ width: 88 }}>
                            {c.name}
                          </div>
                        ))}
                      </div>

                      {/* Item rows */}
                      {catItems.map(item => {
                        const itemPrices = relevantPrices.filter(p => p.item_id === item.id && p.supplier_id === sup.id)
                        if (itemPrices.length === 0 && filterSup === 0) return null
                        return (
                          <div key={item.id} className="flex items-center border-b border-[#f0f0ec] last:border-0 hover:bg-[#fafaf9]">
                            <div className="px-3 py-2.5 border-r border-[#f0f0ec]" style={{ width: 200 }}>
                              <p className="text-[13px] font-medium text-[#111110]">{item.name}</p>
                              <p className="text-[10px] text-[#9a9a95]">{item.unit}</p>
                            </div>
                            {activeColors.map(color => {
                              const p = itemPrices.find(p => p.color_id === color.id)
                              return (
                                <div key={color.id} className="px-1 py-2.5 text-center border-r border-[#f0f0ec] last:border-0"
                                  style={{ width: 88 }}>
                                  {p?.cost_price ? (
                                    <div>
                                      <div className="text-[12px] font-mono font-semibold text-[#111110]">
                                        {p.cost_price.toLocaleString('ru-RU')}
                                      </div>
                                      {p.discount_percent > 0 && (
                                        <div className="text-[9px] text-[#9a9a95]">−{p.discount_percent}%</div>
                                      )}
                                    </div>
                                  ) : <span className="text-[#d4d4d0]">—</span>}
                                </div>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
