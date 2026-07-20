'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'

type Color    = { id: number; name: string; sort_order: number; active: boolean }
type Supplier = { id: number; name: string; active: boolean }
type HwType   = { id: number; name: string; unit: string; whip_length: number | null; sort_order: number }
type HwRow    = { id: number; model_id: string; hw_type_id: number; supplier_id: number; sort_order: number }
type PriceData = { id?: number; price: number; discount: number | null; final_price: number | null }
type PriceMap  = Record<number, Record<number, PriceData>>  // [rowId][colorId]

const MODELS = ['M1','M2','M3','M4','M5','M6','M7','M8','M9','M10','M11','M12']
const UNITS  = ['шт', 'м.п.', 'хлыст']
const COL_TYPE  = 160
const COL_SUP   = 130
const COL_PRICE = 88

export function BudgetMatrix() {
  const db = useRef(createClient())

  const [colors,    setColors]    = useState<Color[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [hwTypes,   setHwTypes]   = useState<HwType[]>([])

  const [selectedModel, setSelectedModel] = useState('M1')
  const [hwRows,   setHwRows]   = useState<HwRow[]>([])
  const [priceMap, setPriceMap] = useState<PriceMap>({})
  const [loading,  setLoading]  = useState(true)

  // Inline editing
  const [editing,   setEditing]   = useState<{ rowId: number; colorId: number } | null>(null)
  const [editValue, setEditValue] = useState('')
  const editRef = useRef<HTMLInputElement>(null)

  // Add-type panel
  const [showAddType,  setShowAddType]  = useState(false)
  const [newTypeName,  setNewTypeName]  = useState('')
  const [newTypeUnit,  setNewTypeUnit]  = useState('шт')
  const [newTypeWhip,  setNewTypeWhip]  = useState('')

  // Add-supplier dropdown
  const [addSupplierTypeId,    setAddSupplierTypeId]    = useState<number | null>(null)
  const [showNewSupInput,      setShowNewSupInput]      = useState(false)
  const [newSupplierName,      setNewSupplierName]      = useState('')

  // Colors panel
  const [showColors,    setShowColors]    = useState(false)
  const [newColorName,  setNewColorName]  = useState('')

  // ── Load masters ──────────────────────────────────────────────────
  useEffect(() => {
    async function loadMasters() {
      const [{ data: cols }, { data: sups }, { data: types }] = await Promise.all([
        db.current.from('shower_hw_colors').select('*').order('sort_order'),
        db.current.from('shower_hw_suppliers').select('*').eq('active', true).order('name'),
        db.current.from('shower_hw_types').select('*').eq('active', true).order('sort_order').order('name'),
      ])
      setColors((cols ?? []) as Color[])
      setSuppliers((sups ?? []) as Supplier[])
      setHwTypes((types ?? []) as HwType[])
    }
    loadMasters()
  }, [])

  // ── Load model data ───────────────────────────────────────────────
  const loadModelData = useCallback(async (model: string) => {
    setLoading(true)
    const { data: rows } = await db.current
      .from('shower_budget_hw_rows')
      .select('*')
      .eq('model_id', model)
      .order('hw_type_id')
      .order('sort_order')
    const rowsData = (rows ?? []) as HwRow[]
    setHwRows(rowsData)

    if (rowsData.length > 0) {
      const { data: prices } = await db.current
        .from('shower_budget_prices')
        .select('*')
        .in('row_id', rowsData.map(r => r.id))
      const map: PriceMap = {}
      for (const p of (prices ?? [])) {
        if (!map[p.row_id]) map[p.row_id] = {}
        map[p.row_id][p.color_id] = { id: p.id, price: p.price, discount: p.discount, final_price: p.final_price }
      }
      setPriceMap(map)
    } else {
      setPriceMap({})
    }
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadModelData(selectedModel) }, [selectedModel, loadModelData])

  // Focus input when editing starts
  useEffect(() => { if (editing) editRef.current?.focus() }, [editing])

  // Close dropdown on outside click
  useEffect(() => {
    if (addSupplierTypeId === null) return
    function handler(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('[data-supplier-dropdown]')) {
        setAddSupplierTypeId(null)
        setShowNewSupInput(false)
        setNewSupplierName('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [addSupplierTypeId])

  // ── Price cell ────────────────────────────────────────────────────
  function startEdit(rowId: number, colorId: number) {
    const cur = priceMap[rowId]?.[colorId]
    setEditValue(cur?.price ? String(cur.price) : '')
    setEditing({ rowId, colorId })
  }

  async function commitEdit() {
    if (!editing) return
    const { rowId, colorId } = editing
    const price = Number(editValue) || 0
    setEditing(null)

    const existing = priceMap[rowId]?.[colorId]
    setPriceMap(prev => ({
      ...prev,
      [rowId]: { ...(prev[rowId] ?? {}), [colorId]: { ...(existing ?? {}), price } },
    }))

    if (existing?.id) {
      await db.current.from('shower_budget_prices')
        .update({ price, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    } else {
      const { data } = await db.current.from('shower_budget_prices')
        .insert({ row_id: rowId, color_id: colorId, price })
        .select('id').single()
      if (data) {
        setPriceMap(prev => ({
          ...prev,
          [rowId]: { ...(prev[rowId] ?? {}), [colorId]: { id: data.id, price, discount: null, final_price: null } },
        }))
      }
    }
  }

  // ── Add hw_type ───────────────────────────────────────────────────
  async function addHwType() {
    if (!newTypeName.trim()) return
    const sortMax = hwTypes.length > 0 ? Math.max(...hwTypes.map(t => t.sort_order)) + 1 : 0
    const { data } = await db.current.from('shower_hw_types').insert({
      name: newTypeName.trim().toUpperCase(),
      unit: newTypeUnit,
      whip_length: newTypeUnit === 'хлыст' && newTypeWhip ? Number(newTypeWhip) : null,
      sort_order: sortMax,
    }).select('*').single()
    if (data) setHwTypes(prev => [...prev, data as HwType])
    setNewTypeName(''); setNewTypeUnit('шт'); setNewTypeWhip(''); setShowAddType(false)
  }

  // ── Assign supplier to hw_type ────────────────────────────────────
  async function assignSupplier(hwTypeId: number, supplierId: number) {
    const sortMax = hwRows.filter(r => r.hw_type_id === hwTypeId).length
    const { data } = await db.current.from('shower_budget_hw_rows').insert({
      model_id: selectedModel,
      hw_type_id: hwTypeId,
      supplier_id: supplierId,
      sort_order: sortMax,
    }).select('*').single()
    if (data) setHwRows(prev => [...prev, data as HwRow])
    setAddSupplierTypeId(null)
    setShowNewSupInput(false)
    setNewSupplierName('')
  }

  async function addNewSupplier(hwTypeId: number) {
    if (!newSupplierName.trim()) return
    const { data } = await db.current.from('shower_hw_suppliers')
      .insert({ name: newSupplierName.trim().toUpperCase() })
      .select('*').single()
    if (data) {
      setSuppliers(prev => [...prev, data as Supplier])
      await assignSupplier(hwTypeId, (data as Supplier).id)
    }
  }

  // ── Remove supplier row ───────────────────────────────────────────
  async function removeRow(rowId: number) {
    await db.current.from('shower_budget_hw_rows').delete().eq('id', rowId)
    setHwRows(prev => prev.filter(r => r.id !== rowId))
    setPriceMap(prev => { const next = { ...prev }; delete next[rowId]; return next })
  }

  // ── Colors ────────────────────────────────────────────────────────
  async function addColor() {
    if (!newColorName.trim()) return
    const sortMax = colors.length > 0 ? Math.max(...colors.map(c => c.sort_order)) + 1 : 0
    const { data } = await db.current.from('shower_hw_colors')
      .insert({ name: newColorName.trim().toUpperCase(), sort_order: sortMax })
      .select('*').single()
    if (data) setColors(prev => [...prev, data as Color])
    setNewColorName('')
  }

  async function toggleColor(id: number, active: boolean) {
    await db.current.from('shower_hw_colors').update({ active: !active }).eq('id', id)
    setColors(prev => prev.map(c => c.id === id ? { ...c, active: !active } : c))
  }

  // ── Derived ───────────────────────────────────────────────────────
  const activeColors = colors.filter(c => c.active)

  const groupedByType: Record<number, HwRow[]> = {}
  for (const row of hwRows) {
    if (!groupedByType[row.hw_type_id]) groupedByType[row.hw_type_id] = []
    groupedByType[row.hw_type_id].push(row)
  }

  const minWidth = COL_TYPE + COL_SUP + activeColors.length * COL_PRICE

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Model tabs */}
      <div className="flex flex-wrap gap-1">
        {MODELS.map(m => (
          <button key={m} onClick={() => setSelectedModel(m)}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
              selectedModel === m
                ? 'bg-[#111110] text-white'
                : 'bg-white border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f8f8f7]'
            }`}>{m}</button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setShowAddType(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#e4e4e0] rounded-lg text-[13px] text-[#111110] hover:bg-[#f8f8f7]">
          + Тип фурнитуры
        </button>
        <button onClick={() => setShowColors(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#e4e4e0] rounded-lg text-[13px] text-[#6b6b66] hover:bg-[#f8f8f7]">
          Цвета ({activeColors.length})
        </button>
      </div>

      {/* Add-type panel */}
      {showAddType && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1">Наименование</label>
            <input value={newTypeName} onChange={e => setNewTypeName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addHwType(); if (e.key === 'Escape') setShowAddType(false) }}
              placeholder="П-ПРОФИЛЬ, ШТАНГА..."
              className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-blue-400 bg-white" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1">Ед. изм.</label>
            <select value={newTypeUnit} onChange={e => setNewTypeUnit(e.target.value)}
              className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-blue-400 bg-white">
              {UNITS.map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
          {newTypeUnit === 'хлыст' && (
            <div>
              <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1">Длина (мм)</label>
              <input type="number" value={newTypeWhip} onChange={e => setNewTypeWhip(e.target.value)}
                placeholder="3000"
                className="w-24 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-blue-400 bg-white" />
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={addHwType}
              className="bg-[#111110] text-white px-4 py-2 rounded-lg text-[13px] font-medium hover:bg-[#2a2a28]">
              Добавить
            </button>
            <button onClick={() => setShowAddType(false)}
              className="px-3 py-2 rounded-lg text-[13px] text-[#9a9a95] hover:text-[#6b6b66]">
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Colors panel */}
      {showColors && (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
          <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-3">Цвета (колонки таблицы)</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {colors.map(c => (
              <span key={c.id}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] font-medium ${
                  c.active
                    ? 'bg-white border-[#e4e4e0] text-[#111110]'
                    : 'bg-[#f8f8f7] border-[#f0f0ec] text-[#9a9a95] line-through'
                }`}>
                {c.name}
                <button onClick={() => toggleColor(c.id, c.active)}
                  className="text-[10px] text-[#9a9a95] hover:text-[#6b6b66]">
                  {c.active ? '✕' : '+'}
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newColorName} onChange={e => setNewColorName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addColor()}
              placeholder="Новый цвет"
              className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110] uppercase w-48 bg-white" />
            <button onClick={addColor}
              className="bg-[#111110] text-white px-3 py-1.5 rounded-lg text-[13px] hover:bg-[#2a2a28]">
              + Добавить
            </button>
          </div>
        </div>
      )}

      {/* Matrix table */}
      <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-[#9a9a95] text-[13px]">Загрузка...</div>
        ) : (
          <div className="overflow-x-auto">
            <div style={{ minWidth }}>

              {/* Header */}
              <div className="flex border-b-2 border-[#e4e4e0] bg-[#f5f5f3] sticky top-0 z-10">
                <div className="flex-shrink-0 px-3 py-2.5 text-[11px] font-bold text-[#6b6b66] uppercase tracking-widest border-r border-[#e4e4e0]"
                  style={{ width: COL_TYPE }}>
                  Тип / ед. изм.
                </div>
                <div className="flex-shrink-0 px-3 py-2.5 text-[11px] font-bold text-[#6b6b66] uppercase tracking-widest border-r border-[#e4e4e0]"
                  style={{ width: COL_SUP }}>
                  Поставщик
                </div>
                {activeColors.map(c => (
                  <div key={c.id}
                    className="flex-shrink-0 px-1 py-2.5 text-[10px] font-bold text-[#6b6b66] uppercase text-center leading-tight border-r border-[#e4e4e0] last:border-0"
                    style={{ width: COL_PRICE }}>
                    {c.name}
                  </div>
                ))}
              </div>

              {/* Body */}
              {hwTypes.length === 0 ? (
                <div className="p-8 text-center text-[#9a9a95] text-[13px]">
                  Добавьте тип фурнитуры через кнопку выше
                </div>
              ) : (
                hwTypes.map(type => {
                  const typeRows = groupedByType[type.id] ?? []
                  const assignedIds = new Set(typeRows.map(r => r.supplier_id))
                  const available = suppliers.filter(s => !assignedIds.has(s.id))
                  const unitLabel = type.unit === 'хлыст' && type.whip_length
                    ? `хлыст ${(type.whip_length / 1000).toFixed(type.whip_length % 1000 === 0 ? 0 : 1)}м`
                    : type.unit

                  return (
                    <div key={type.id} className="border-b border-[#e4e4e0] last:border-0">

                      {/* Section header */}
                      <div className="flex items-center bg-[#f8f8f7] border-b border-[#ebebea] px-3 py-2 gap-3">
                        <span className="text-[12px] font-bold text-[#111110] uppercase tracking-wide">{type.name}</span>
                        <span className="text-[11px] text-[#9a9a95] bg-[#ededeb] px-1.5 py-0.5 rounded-full">{unitLabel}</span>
                        <div className="ml-auto relative" data-supplier-dropdown>
                          <button
                            onClick={() => {
                              setAddSupplierTypeId(v => v === type.id ? null : type.id)
                              setShowNewSupInput(false)
                              setNewSupplierName('')
                            }}
                            className="text-[12px] font-semibold text-blue-600 hover:text-blue-800 px-2 py-0.5 rounded hover:bg-blue-50">
                            + поставщик
                          </button>

                          {addSupplierTypeId === type.id && (
                            <div className="absolute right-0 top-full mt-1 bg-white border border-[#e4e4e0] rounded-xl shadow-xl z-20 p-1.5 min-w-[180px]">
                              {available.length === 0 && !showNewSupInput && (
                                <p className="px-3 py-1.5 text-[12px] text-[#9a9a95]">Все поставщики добавлены</p>
                              )}
                              {available.map(s => (
                                <button key={s.id} onClick={() => assignSupplier(type.id, s.id)}
                                  className="w-full text-left px-3 py-1.5 text-[13px] text-[#111110] hover:bg-[#f8f8f7] rounded-lg">
                                  {s.name}
                                </button>
                              ))}
                              {!showNewSupInput ? (
                                <button onClick={() => setShowNewSupInput(true)}
                                  className="w-full text-left px-3 py-1.5 text-[12px] text-blue-600 hover:bg-blue-50 rounded-lg border-t border-[#f0f0ec] mt-1">
                                  + Новый поставщик
                                </button>
                              ) : (
                                <div className="mt-1 pt-1 border-t border-[#f0f0ec] px-1">
                                  <input value={newSupplierName} onChange={e => setNewSupplierName(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') addNewSupplier(type.id)
                                      if (e.key === 'Escape') setShowNewSupInput(false)
                                    }}
                                    placeholder="Название поставщика"
                                    autoFocus
                                    className="w-full border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] outline-none focus:border-blue-400" />
                                  <button onClick={() => addNewSupplier(type.id)}
                                    className="mt-1.5 w-full bg-[#111110] text-white px-2 py-1.5 rounded-lg text-[12px] font-medium">
                                    Добавить
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Supplier rows */}
                      {typeRows.length === 0 && (
                        <div className="px-4 py-3 text-[12px] text-[#b0b0ab] italic">
                          Нажмите «+ поставщик» чтобы добавить
                        </div>
                      )}

                      {typeRows.map(row => {
                        const sup = suppliers.find(s => s.id === row.supplier_id)
                        return (
                          <div key={row.id}
                            className="flex items-stretch hover:bg-[#fafaf9] group border-b border-[#f5f5f3] last:border-0">

                            {/* Type column (empty, spacer) */}
                            <div className="flex-shrink-0 border-r border-[#f0f0ec]" style={{ width: COL_TYPE }} />

                            {/* Supplier column */}
                            <div className="flex-shrink-0 px-3 py-2 border-r border-[#f0f0ec] flex items-center justify-between gap-1"
                              style={{ width: COL_SUP }}>
                              <span className="text-[13px] font-medium text-[#111110]">{sup?.name ?? '?'}</span>
                              <button onClick={() => removeRow(row.id)}
                                className="opacity-0 group-hover:opacity-100 text-[10px] text-[#c0c0bb] hover:text-red-400 transition-opacity flex-shrink-0">
                                ✕
                              </button>
                            </div>

                            {/* Price cells */}
                            {activeColors.map(color => {
                              const cell = priceMap[row.id]?.[color.id]
                              const isEditing = editing?.rowId === row.id && editing?.colorId === color.id
                              return (
                                <div key={color.id}
                                  className="flex-shrink-0 border-r border-[#f0f0ec] last:border-0"
                                  style={{ width: COL_PRICE }}>
                                  {isEditing ? (
                                    <input
                                      ref={editRef}
                                      type="number"
                                      value={editValue}
                                      onChange={e => setEditValue(e.target.value)}
                                      onBlur={commitEdit}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') commitEdit()
                                        if (e.key === 'Escape') setEditing(null)
                                      }}
                                      className="w-full h-full px-1 py-2 text-[13px] font-mono text-center outline-none bg-blue-50 border-x border-blue-300 min-h-[36px]"
                                    />
                                  ) : (
                                    <button
                                      onClick={() => startEdit(row.id, color.id)}
                                      className={`w-full min-h-[36px] px-1 py-2 text-[13px] font-mono text-center transition-colors hover:bg-blue-50 ${
                                        cell?.price ? 'text-[#111110]' : 'text-[#d8d8d4] hover:text-[#9a9a95]'
                                      }`}>
                                      {cell?.price ? cell.price.toLocaleString('ru-RU') : '—'}
                                    </button>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
