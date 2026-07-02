'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import type { Color, Supplier } from './CatalogTab'

type CatItem = { id: number; name: string; category: string; unit: string; shower_types: string[] }
type CatalogPrice = { item_id: number; supplier_id: number; color_id: number; cost_price: number }
type KitRow = { id: number; model_id: string; item_id: number; supplier_id: number | null; sort_order: number; qty: number }
type ManualPrice = { id?: number; model_id: string; color_id: number; price: number }

const MODELS = ['M1','M2','M3','M4','M5','M6','M7','M8','M9','M10','M11','M12']

export function BudgetKitTab({ colors, suppliers }: { colors: Color[]; suppliers: Supplier[] }) {
  const db         = useRef(createClient())
  const [model,    setModel]    = useState('M1')
  const [allItems, setAllItems] = useState<CatItem[]>([])
  const [kitRows,  setKitRows]  = useState<KitRow[]>([])
  const [prices,   setPrices]   = useState<CatalogPrice[]>([])
  const [manual,   setManual]   = useState<ManualPrice[]>([])
  const [manDraft, setManDraft] = useState<Record<number, string>>({})
  const [loading,  setLoading]  = useState(true)
  const [showAdd,  setShowAdd]  = useState(false)
  const [search,   setSearch]   = useState('')
  const [savingMan, setSavingMan] = useState(false)
  const [savedMan,  setSavedMan]  = useState(false)
  const [saveErr,   setSaveErr]   = useState('')

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

    const [pricesResult, manualResult] = await Promise.all([
      rowsData.length > 0
        ? db.current.from('shower_catalog_prices')
            .select('item_id,supplier_id,color_id,cost_price')
            .in('item_id', rowsData.map(r => r.item_id))
        : Promise.resolve({ data: [] }),
      db.current.from('shower_budget_manual_prices')
        .select('*').eq('model_id', m),
    ])

    setPrices((pricesResult.data ?? []) as CatalogPrice[])
    const manData = (manualResult.data ?? []) as ManualPrice[]
    setManual(manData)
    const draft: Record<number, string> = {}
    for (const mp of manData) draft[mp.color_id] = mp.price > 0 ? String(mp.price) : ''
    setManDraft(draft)
    setLoading(false)
  }, [])

  useEffect(() => { loadKit(model) }, [model, loadKit])

  async function addItem(itemId: number) {
    if (kitRows.find(r => r.item_id === itemId)) return
    const { data } = await db.current.from('shower_budget_kit_rows')
      .insert({ model_id: model, item_id: itemId, supplier_id: null, sort_order: kitRows.length, qty: 1 })
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

  async function setQty(rowId: number, qty: number) {
    const q = Math.max(1, qty || 1)
    await db.current.from('shower_budget_kit_rows').update({ qty: q }).eq('id', rowId)
    setKitRows(prev => prev.map(r => r.id === rowId ? { ...r, qty: q } : r))
  }

  async function saveManualPrices() {
    setSavingMan(true)
    setSaveErr('')
    const activeColors = colors.filter(c => c.active)
    const errors: string[] = []
    await Promise.all(activeColors.map(async c => {
      const val = Number(manDraft[c.id]) || 0
      const existing = manual.find(m => m.color_id === c.id)
      if (existing?.id) {
        const { error } = await db.current.from('shower_budget_manual_prices')
          .update({ price: val, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
        if (error) errors.push(`update ${c.id}: ${error.message}`)
      } else if (val > 0) {
        const { error } = await db.current.from('shower_budget_manual_prices')
          .insert({ model_id: model, color_id: c.id, price: val })
        if (error) errors.push(`insert ${c.id}: ${error.message}`)
      }
    }))
    setSavingMan(false)
    if (errors.length > 0) {
      setSaveErr(errors.join(' | '))
    } else {
      setSavedMan(true)
      setTimeout(() => setSavedMan(false), 2000)
      await loadKit(model)
    }
  }

  const activeColors = colors.filter(c => c.active)
  const addable = allItems
    .filter(i => !kitRows.find(r => r.item_id === i.id))
    .filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()))

  const filled = kitRows.filter(r => r.supplier_id && prices.some(p => p.item_id === r.item_id && p.supplier_id === r.supplier_id)).length
  const total  = kitRows.length

  // Calculated totals per color (sum of qty × price)
  const calcTotals: Record<number, number> = {}
  for (const color of activeColors) {
    let sum = 0
    for (const row of kitRows) {
      const p = prices.find(p =>
        p.item_id === row.item_id &&
        p.supplier_id === row.supplier_id &&
        p.color_id === color.id
      )
      if (p?.cost_price) sum += p.cost_price * (row.qty || 1)
    }
    calcTotals[color.id] = sum
  }

  // Effective totals: manual if set, else calculated
  const effectiveTotals: Record<number, { price: number; isManual: boolean }> = {}
  for (const color of activeColors) {
    const man = manual.find(m => m.color_id === color.id)
    const hasManual = man && man.price > 0
    effectiveTotals[color.id] = {
      price: hasManual ? man!.price : calcTotals[color.id],
      isManual: !!hasManual,
    }
  }

  const hasAnyCalc = activeColors.some(c => calcTotals[c.id] > 0)
  const hasAnyManual = activeColors.some(c => (manual.find(m => m.color_id === c.id)?.price ?? 0) > 0)

  return (
    <div className="space-y-4">

      {/* Model tabs */}
      <div className="flex flex-wrap gap-1">
        {MODELS.map(m => (
          <button key={m} onClick={() => setModel(m)}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
              model === m ? 'bg-ink text-white' : 'bg-surface border border-line text-ink-soft hover:bg-canvas'
            }`}>{m}</button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <button onClick={() => setShowAdd(v => !v)}
          className="px-3 py-1.5 bg-surface border border-line rounded-lg text-[13px] text-ink hover:bg-canvas">
          + Добавить позицию из справочника
        </button>
        {total > 0 && (
          <span className="text-[12px] text-muted">
            Заполнено: <span className={`font-semibold ${filled === total ? 'text-emerald-600' : 'text-amber-600'}`}>{filled}/{total}</span>
          </span>
        )}
      </div>

      {/* Add item panel */}
      {showAdd && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-[12px] font-semibold text-blue-700 mb-2">Выберите позицию для модели {model}</p>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по названию..."
            className="w-full border border-line rounded-lg px-3 py-2 text-[13px] outline-none focus:border-blue-400 bg-surface mb-2" />
          <div className="max-h-48 overflow-y-auto space-y-0.5 bg-surface rounded-lg border border-line">
            {addable.map(item => (
              <button key={item.id} onClick={() => addItem(item.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-ink hover:bg-canvas text-left border-b border-line-soft last:border-0">
                <span className="font-medium">{item.name}</span>
                <span className="text-[10px] bg-line-soft text-ink-soft px-1.5 py-0.5 rounded">{item.category}</span>
                <span className="text-[11px] text-muted">{item.unit}</span>
              </button>
            ))}
            {addable.length === 0 && (
              <p className="px-3 py-3 text-[12px] text-muted">
                {allItems.length === 0 ? 'Справочник пустой — сначала добавьте позиции' : 'Все позиции уже добавлены'}
              </p>
            )}
          </div>
          <button onClick={() => setShowAdd(false)} className="mt-2 text-[12px] text-muted hover:text-ink-soft">Отмена</button>
        </div>
      )}

      {/* Kit table */}
      <div className="bg-surface border border-line rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-muted text-[13px]">Загрузка...</div>
        ) : kitRows.length === 0 && !hasAnyManual ? (
          <div className="p-8 text-center text-muted text-[13px]">
            Комплект {model} пустой — добавьте позиции из справочника или укажите стоимость вручную ниже
          </div>
        ) : kitRows.length > 0 ? (
          <div className="overflow-x-auto">
            <div style={{ minWidth: 340 + activeColors.length * 88 }}>

              {/* Header */}
              <div className="flex bg-canvas border-b-2 border-line">
                <div className="px-3 py-2.5 text-[10px] font-semibold text-ink-soft uppercase tracking-wide border-r border-line" style={{ width: 190 }}>
                  Позиция
                </div>
                <div className="px-3 py-2.5 text-[10px] font-semibold text-ink-soft uppercase tracking-wide border-r border-line" style={{ width: 120 }}>
                  Поставщик
                </div>
                <div className="px-2 py-2.5 text-[10px] font-semibold text-ink-soft uppercase tracking-wide text-center border-r border-line" style={{ width: 52 }}>
                  Кол.
                </div>
                {activeColors.map(c => (
                  <div key={c.id} className="px-1 py-2.5 text-[9px] font-semibold text-ink-soft uppercase text-center leading-tight border-r border-line last:border-0"
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
                  <div key={row.id} className="flex items-center border-b border-line-soft last:border-0 hover:bg-subtle group">

                    {/* Item name */}
                    <div className="px-3 py-2.5 border-r border-line-soft" style={{ width: 190 }}>
                      <div className="flex items-center gap-1.5">
                        {hasData  && <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />}
                        {noPrice  && <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />}
                        {row.supplier_id === null && <span className="w-2 h-2 rounded-full bg-[#d4d4d0] flex-shrink-0" />}
                        <div>
                          <p className="text-[13px] font-medium text-ink leading-tight">{item.name}</p>
                          <p className="text-[10px] text-muted">{item.unit}</p>
                        </div>
                      </div>
                    </div>

                    {/* Supplier select */}
                    <div className="px-2 py-2.5 border-r border-line-soft" style={{ width: 120 }}>
                      <select
                        value={row.supplier_id ?? ''}
                        onChange={e => setSupplier(row.id, e.target.value ? Number(e.target.value) : null)}
                        className="w-full border border-line rounded px-2 py-1 text-[11px] outline-none focus:border-blue-400 bg-surface">
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

                    {/* Qty */}
                    <div className="px-1 py-2.5 text-center border-r border-line-soft" style={{ width: 52 }}>
                      <input
                        type="number" min="1"
                        value={row.qty || 1}
                        onChange={e => setQty(row.id, Number(e.target.value))}
                        className="w-10 border border-line rounded px-1 py-0.5 text-[12px] text-center outline-none focus:border-blue-400 bg-surface tabular-nums"
                      />
                    </div>

                    {/* Price cells */}
                    {activeColors.map(color => {
                      const p = prices.find(p =>
                        p.item_id === row.item_id &&
                        p.supplier_id === row.supplier_id &&
                        p.color_id === color.id
                      )
                      const lineTotal = p?.cost_price ? p.cost_price * (row.qty || 1) : null
                      return (
                        <div key={color.id} className="px-1 py-2.5 text-center border-r border-line-soft last:border-0"
                          style={{ width: 88 }}>
                          {p?.cost_price ? (
                            <div>
                              <div className="text-[11px] text-muted tabular-nums">{p.cost_price.toLocaleString('ru-RU')}</div>
                              {(row.qty || 1) > 1 && (
                                <div className="text-[12px] font-mono font-semibold text-ink tabular-nums">
                                  {lineTotal!.toLocaleString('ru-RU')}
                                </div>
                              )}
                            </div>
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

              {/* ИТОГО row */}
              {hasAnyCalc && (
                <div className="flex items-center bg-canvas border-t-2 border-line">
                  <div className="px-3 py-2.5 text-[12px] font-semibold text-ink border-r border-line" style={{ width: 190 }}>
                    ИТОГО (позиции)
                  </div>
                  <div className="border-r border-line" style={{ width: 120 }} />
                  <div className="border-r border-line" style={{ width: 52 }} />
                  {activeColors.map(c => (
                    <div key={c.id} className="px-1 py-2.5 text-center border-r border-line last:border-0" style={{ width: 88 }}>
                      {calcTotals[c.id] > 0 ? (
                        <span className="text-[13px] font-mono font-semibold text-emerald-700 tabular-nums">
                          {calcTotals[c.id].toLocaleString('ru-RU')}
                        </span>
                      ) : (
                        <span className="text-[12px] text-[#d4d4d0]">—</span>
                      )}
                    </div>
                  ))}
                  <div style={{ width: 36 }} />
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Manual price section */}
      <div className="bg-surface border border-line rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[13px] font-semibold text-ink">Стоимость комплекта — ручной ввод</p>
            <p className="text-[11px] text-muted mt-0.5">
              {hasAnyCalc
                ? 'Если заполнено — перекрывает расчёт из позиций. Оставьте 0 чтобы использовать автоподсчёт.'
                : 'Укажите стоимость комплекта вручную пока позиции не заполнены.'}
            </p>
          </div>
        </div>

        {activeColors.length === 0 ? (
          <p className="text-[12px] text-muted">Нет активных цветов</p>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(activeColors.length, 4)}, minmax(0,1fr))` }}>
            {activeColors.map(c => (
              <div key={c.id}>
                <p className="text-[10px] text-muted mb-1 font-semibold uppercase tracking-wide">{c.name}</p>
                <input
                  type="number" min="0" placeholder="0"
                  value={manDraft[c.id] ?? ''}
                  onChange={e => setManDraft(d => ({ ...d, [c.id]: e.target.value }))}
                  className="w-full border border-line rounded-lg px-3 py-2 text-[13px] font-mono outline-none focus:border-[#0071e3] tabular-nums"
                />
                {hasAnyCalc && calcTotals[c.id] > 0 && (
                  <p className="text-[10px] text-muted mt-0.5 tabular-nums">
                    Расчёт: {calcTotals[c.id].toLocaleString('ru-RU')} ₽
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {saveErr && (
          <div className="mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[12px] text-red-700 font-mono">
            {saveErr}
          </div>
        )}
        <div className="mt-4 flex items-center gap-4">
          <button onClick={saveManualPrices} disabled={savingMan}
            className="px-4 py-2 bg-ink text-white text-[13px] font-medium rounded-lg disabled:opacity-40 hover:bg-[#2a2a28]">
            {savedMan ? 'Сохранено' : savingMan ? 'Сохраняю...' : 'Сохранить цены'}
          </button>
          {activeColors.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {activeColors.map(c => {
                const eff = effectiveTotals[c.id]
                if (!eff || eff.price === 0) return null
                return (
                  <span key={c.id} className={`text-[12px] tabular-nums ${eff.isManual ? 'text-[#0071e3]' : 'text-emerald-700'}`}>
                    {c.name}: {eff.price.toLocaleString('ru-RU')} ₽
                    <span className="text-[10px] ml-1 opacity-70">{eff.isManual ? '(вручную)' : '(авто)'}</span>
                  </span>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      {kitRows.length > 0 && (
        <div className="flex items-center gap-5 text-[11px] text-muted flex-wrap">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"/>Данные заполнены</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"/>Нет цен для поставщика</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#d4d4d0] inline-block"/>Поставщик не выбран</span>
        </div>
      )}
    </div>
  )
}
