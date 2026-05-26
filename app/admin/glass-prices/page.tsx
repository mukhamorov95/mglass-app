'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'

const GLASS_MM  = [4, 5, 6, 8, 10] as const
const MIRROR_MM = [4, 6] as const

type Category  = 'glass' | 'mirror'
type PriceType = 'cost' | 'sale'
type TabKey    = 'cost_glass' | 'sale_glass' | 'cost_mirror' | 'sale_mirror' | 'formula'
type EditKey   = string

const PRICE_TABS: Exclude<TabKey, 'formula'>[] = ['cost_glass', 'sale_glass', 'cost_mirror', 'sale_mirror']

const TAB_LABEL: Record<Exclude<TabKey, 'formula'>, string> = {
  cost_glass:  'Себестоимость Стекло',
  sale_glass:  'Продажная Стекло',
  cost_mirror: 'Себестоимость Зеркало',
  sale_mirror: 'Продажная Зеркало',
}

function isPriceTab(t: TabKey): t is Exclude<TabKey, 'formula'> { return t !== 'formula' }
function priceTypeOf(t: Exclude<TabKey, 'formula'>): PriceType { return t.startsWith('cost') ? 'cost' : 'sale' }
function categoryOf(t: Exclude<TabKey, 'formula'>): Category   { return t.endsWith('glass') ? 'glass' : 'mirror' }

interface FormulaParam {
  id: number
  section: 'glass' | 'mirror' | 'b2b'
  param_key: string
  param_name: string
  value: number
  unit: string
  description: string | null
  sort_order: number
}

interface GlassRow {
  id: string; name: string; sort_order: number
  price_type: PriceType; category: Category; waste_pct: number | null
  t4: number | null; t5: number | null; t6: number | null
  t8: number | null; t10: number | null; t12: number | null
  supplier_id: string | null; supplier_material_name: string | null
}

type RowSupplier = { supplier_id: string | null; supplier_material_name: string | null }

interface MarginInfo {
  effectiveCost: number
  vatOnCost: number
  netCost: number
  temperingIncVat: number
  vatOnTemp: number
  netTemp: number
  totalNetCost: number
  totalNetWithTemp: number
  opexAmount: number
  profit: number
  margin: number
  profitWithTemp: number
  marginWithTemp: number
  recPrice: number
  recPriceWithTemp: number
  wastePct: number
  purchaseVatPct: number
  opexPct: number
  baseMarginPct: number
  recMargin: number
  minMargin: number
}

// A staged (unsaved) change
interface DirtyEntry {
  name: string        // original name
  field: string       // 't4' | 'waste_pct' | '__name__' etc.
  priceType: PriceType
  category: Category
  numVal: number | null   // numeric fields
  strVal?: string          // for __name__ rename
}

function fmt(v: number | null | undefined) {
  if (v == null) return ''
  return v.toLocaleString('ru-RU')
}

function makeKey(name: string, field: string, tab: TabKey): EditKey {
  return `${name}::${field}::${tab}`
}
function dirtyKey(name: string, field: string, pt: PriceType, cat: Category) {
  return `${name}::${field}::${pt}::${cat}`
}

export default function GlassPricesPage() {
  const [rows, setRows]         = useState<GlassRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState<TabKey>('cost_glass')
  const [isOwner, setIsOwner]   = useState(false)
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([])
  const [rowSupplier, setRowSupplier] = useState<Record<string, RowSupplier>>({})

  // Formula tab
  const [formula, setFormula]         = useState<FormulaParam[]>([])
  const [formulaLoading, setFormulaLoading] = useState(false)
  const [formulaLoaded, setFormulaLoaded]   = useState(false)
  const [formulaEditId, setFormulaEditId]   = useState<number | null>(null)
  const [formulaEditVal, setFormulaEditVal] = useState('')
  const [formulaSaving, setFormulaSaving]   = useState(false)
  // Live example inputs (glass section)
  const [exCost, setExCost]           = useState('3000')
  const [exTempering, setExTempering] = useState('1500')
  const [exPrice, setExPrice]         = useState('10000')
  const [toast, setToast]       = useState<string | null>(null)
  const [newName, setNewName]   = useState('')
  const [addingRow, setAddingRow] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [clearing, setClearing]   = useState(false)
  const [savingAll, setSavingAll] = useState(false)
  const [syncingB2B, setSyncingB2B] = useState(false)
  const autoFilledRef = useRef<Set<string>>(new Set())
  const [undoRows, setUndoRows]   = useState<GlassRow[] | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [popover, setPopover] = useState<{
    name: string; mm: number; salePrice: number; info: MarginInfo
  } | null>(null)

  // Staged (unsaved) changes — key → entry
  const [dirty, setDirty] = useState<Record<string, DirtyEntry>>({})

  // Inline edit state
  const [editKey, setEditKey] = useState<EditKey | null>(null)
  const [editVal, setEditVal] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/glass-prices')
    if (res.ok) {
      const data: GlassRow[] = await res.json()
      setRows(data)
      const sup: Record<string, RowSupplier> = {}
      for (const r of data) {
        if (r.price_type === 'cost') {
          sup[r.name] = { supplier_id: r.supplier_id ?? null, supplier_material_name: r.supplier_material_name ?? null }
        }
      }
      setRowSupplier(sup)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    createClient().auth.getUser().then(({ data: { user } }) => {
      if (user?.email === 'admin@mglass.ru') setIsOwner(true)
    })
  }, [])

  useEffect(() => {
    fetch('/api/admin/suppliers')
      .then(r => r.ok ? r.json() : [])
      .then((data: { id: string; name: string; status: string }[]) =>
        setSuppliers(data.filter(s => s.status !== 'inactive').map(s => ({ id: s.id, name: s.name })))
      )
  }, [])

  async function saveRowSupplierImmediate(name: string, supplierId: string | null, supplierMatName: string | null) {
    await fetch('/api/admin/glass-prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        price_type: 'cost',
        category: curCat,
        supplier_id: supplierId,
        supplier_material_name: supplierMatName || null,
      }),
    })
  }

  useEffect(() => {
    if (editKey) setTimeout(() => inputRef.current?.focus(), 20)
  }, [editKey])

  useEffect(() => {
    if ((tab === 'formula' || tab === 'sale_glass' || tab === 'sale_mirror') && !formulaLoaded) {
      setFormulaLoading(true)
      fetch('/api/admin/pricing-formula')
        .then(r => r.ok ? r.json() : [])
        .then((data: FormulaParam[]) => { setFormula(data); setFormulaLoaded(true); setFormulaLoading(false) })
    }
  }, [tab, formulaLoaded])

  // Auto-fill: when formula loads AND we're on a sale tab, stage formula prices for empty cells
  useEffect(() => {
    const isSaleTab = tab === 'sale_glass' || tab === 'sale_mirror'
    const cat: Category = (tab === 'sale_mirror' || tab === 'cost_mirror') ? 'mirror' : 'glass'
    if (!formulaLoaded || loading || !isSaleTab) return
    const key = `sale_${cat}`
    if (autoFilledRef.current.has(key)) return
    autoFilledRef.current.add(key)
    fillByFormula()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formulaLoaded, loading, tab])

  async function saveFormulaParam(id: number, raw: string) {
    const val = parseFloat(raw)
    if (isNaN(val)) { setFormulaEditId(null); return }
    setFormulaSaving(true)
    await fetch('/api/admin/pricing-formula', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, value: val }),
    })
    setFormula(prev => prev.map(p => p.id === id ? { ...p, value: val } : p))
    setFormulaEditId(null)
    setFormulaSaving(false)
    showToast('✅ Сохранено')
  }

  // Derived (only valid for price tabs, not formula)
  const priceTab = isPriceTab(tab) ? tab : 'cost_glass' as const
  const curPT  = priceTypeOf(priceTab)
  const curCat = categoryOf(priceTab)
  const isCostTab = curPT === 'cost'
  const thicknesses = curCat === 'mirror' ? MIRROR_MM : GLASS_MM
  const hasDirty = Object.keys(dirty).length > 0

  const rowCat = (r: GlassRow) => r.category ?? 'glass'

  const allNames = Array.from(
    new Set(rows.filter(r => rowCat(r) === curCat).map(r => r.name))
  ).sort((a, b) => {
    const sa = rows.find(r => r.name === a && rowCat(r) === curCat)?.sort_order ?? 0
    const sb = rows.find(r => r.name === b && rowCat(r) === curCat)?.sort_order ?? 0
    return sa !== sb ? sa - sb : a.localeCompare(b, 'ru')
  })

  const costRow = (name: string) =>
    rows.find(r => r.name === name && r.price_type === 'cost' && rowCat(r) === curCat)
  const tabRow = (name: string) =>
    rows.find(r => r.name === name && r.price_type === curPT && rowCat(r) === curCat)

  // Get display value for a cell: use dirty value if staged, else DB value
  function getDisplayVal(name: string, field: string, dbVal: number | null): number | null {
    const pt: PriceType = field === 'waste_pct' ? 'cost' : curPT
    const dk = dirtyKey(name, field, pt, curCat)
    return dk in dirty ? dirty[dk].numVal : dbVal
  }

  function isCellDirty(name: string, field: string): boolean {
    const pt: PriceType = field === 'waste_pct' ? 'cost' : curPT
    return dirtyKey(name, field, pt, curCat) in dirty
  }

  function getNameDisplay(origName: string): string {
    const dk = dirtyKey(origName, '__name__', 'cost', curCat)
    return dk in dirty ? (dirty[dk].strVal ?? origName) : origName
  }

  // Stage a numeric cell change (no API call)
  function stageValue(name: string, field: string, numVal: number | null) {
    const pt: PriceType = field === 'waste_pct' ? 'cost' : curPT
    const dk = dirtyKey(name, field, pt, curCat)
    setDirty(prev => ({ ...prev, [dk]: { name, field, priceType: pt, category: curCat, numVal } }))
  }

  // Stage a name rename (no API call)
  function stageName(origName: string, newNameVal: string) {
    const dk = dirtyKey(origName, '__name__', 'cost', curCat)
    setDirty(prev => ({ ...prev, [dk]: { name: origName, field: '__name__', priceType: 'cost', category: curCat, numVal: null, strVal: newNameVal } }))
  }

  function startEdit(name: string, field: string, currentVal: number | null) {
    setEditKey(makeKey(name, field, tab))
    setEditVal(currentVal != null ? String(currentVal) : '')
  }

  function commitEdit(name: string, field: string) {
    const raw = editVal.trim()
    setEditKey(null)

    if (field === '__name__') {
      const newNameVal = raw
      if (!newNameVal || newNameVal === name) return
      stageName(name, newNameVal)
      return
    }

    const numVal = raw === '' ? null : parseInt(raw.replace(/\D/g, ''), 10)
    if (raw !== '' && isNaN(numVal as number)) return

    stageValue(name, field, numVal)
  }

  function handleKeyDown(e: React.KeyboardEvent, name: string, field: string) {
    if (e.key === 'Enter')  commitEdit(name, field)
    if (e.key === 'Escape') setEditKey(null)
  }

  // Send all staged changes to API
  async function saveAll() {
    if (!hasDirty) return
    setSavingAll(true)

    const entries = Object.values(dirty)

    // 1. Apply renames first, build oldName→newName map
    const nameMap: Record<string, string> = {}
    await Promise.all(
      entries.filter(e => e.field === '__name__').map(e => {
        nameMap[e.name] = e.strVal!
        return fetch('/api/admin/glass-prices', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldName: e.name, newName: e.strVal, category: e.category }),
        })
      })
    )

    // 2. Group value changes by (resolvedName, priceType, category)
    type Group = Record<string, unknown> & { name: string; price_type: PriceType; category: Category }
    const groups: Record<string, Group> = {}
    for (const e of entries.filter(e => e.field !== '__name__')) {
      const resolvedName = nameMap[e.name] ?? e.name
      const gk = `${resolvedName}::${e.priceType}::${e.category}`
      if (!groups[gk]) groups[gk] = { name: resolvedName, price_type: e.priceType, category: e.category }
      groups[gk][e.field] = e.numVal
    }

    await Promise.all(
      Object.values(groups).map(g =>
        fetch('/api/admin/glass-prices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(g),
        })
      )
    )

    setDirty({})
    setSavingAll(false)
    showToast('✅ Изменения сохранены')
    load()
  }

  function discardAll() { setDirty({}) }

  async function addGlass() {
    const name = newName.trim()
    if (!name) return
    setAddingRow(true)
    await Promise.all([
      fetch('/api/admin/glass-prices', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, price_type: 'cost', category: curCat, sort_order: allNames.length }) }),
      fetch('/api/admin/glass-prices', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, price_type: 'sale', category: curCat, sort_order: allNames.length }) }),
    ])
    setNewName(''); setAddingRow(false)
    showToast(`✅ Добавлено: ${name}`)
    load()
  }

  async function deleteGlass(name: string) {
    if (!confirm(`Удалить «${name}» из обеих таблиц?`)) return
    // Remove any staged changes for this name too
    setDirty(prev => {
      const next = { ...prev }
      Object.keys(next).forEach(k => { if (k.startsWith(`${name}::`)) delete next[k] })
      return next
    })
    await fetch('/api/admin/glass-prices', { method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, category: curCat }) })
    showToast(`🗑 Удалено: ${name}`)
    load()
  }

  async function clearPrices() {
    if (!confirm(`Очистить все цены во вкладке «${TAB_LABEL[priceTab]}»?\nЗаписи останутся, обнулятся только числа.`)) return
    const snapshot = rows.filter(r => r.price_type === curPT && rowCat(r) === curCat)
    setClearing(true)
    const res = await fetch('/api/admin/glass-prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear_tab', price_type: curPT, category: curCat }),
    })
    setClearing(false)
    if (!res.ok) { showToast('Ошибка при очистке'); return }
    setUndoRows(snapshot)
    if (undoTimer.current) clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(() => setUndoRows(null), 6000)
    load()
  }

  async function undoClear() {
    if (!undoRows) return
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndoRows(null)
    await Promise.all(undoRows.map(row =>
      fetch('/api/admin/glass-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: row.name, price_type: row.price_type, category: row.category,
          t4: row.t4, t5: row.t5, t6: row.t6, t8: row.t8, t10: row.t10, t12: row.t12, waste_pct: row.waste_pct }),
      })
    ))
    showToast('Восстановлено')
    load()
  }

  async function syncToB2B() {
    if (!confirm('Синхронизировать цены в B2B калькулятор?\nНовые материалы будут добавлены, существующие — обновлены.')) return
    setSyncingB2B(true)
    const res = await fetch('/api/admin/sync-b2b-materials', { method: 'POST' })
    const data = await res.json()
    setSyncingB2B(false)
    if (!res.ok) { showToast(`Ошибка: ${data.error}`); return }
    showToast(`✅ B2B обновлён: +${data.inserted} новых, ${data.updated} обновлено`)
  }

  async function migrateFromMaterials() {
    if (!confirm('Перенести продажные цены из «Материалы → Стекло»?\nСуществующие значения будут перезаписаны.')) return
    setMigrating(true)
    const res = await fetch('/api/admin/migrate-glass-prices', { method: 'POST' })
    const data = await res.json()
    setMigrating(false)
    if (!res.ok) { showToast(`Ошибка: ${data.error}`); return }
    showToast(`✅ Перенесено: ${data.transferred} из ${data.total} позиций`)
    load()
  }

  // Render a price/waste cell
  function renderCell(
    name: string,
    field: string,
    dbVal: number | null,
    opts: { amber?: boolean; readOnly?: boolean } = {}
  ) {
    const displayVal = getDisplayVal(name, field, dbVal)
    const isDirty    = isCellDirty(name, field)
    const isEditing  = editKey === makeKey(name, field, tab)

    if (opts.readOnly) {
      return (
        <span className={`inline-block min-w-[44px] px-2 py-1 rounded font-mono text-center
          ${displayVal != null ? 'text-[#b45309] font-semibold' : 'text-[#d0d0cc]'}`}>
          {displayVal != null ? `${displayVal}%` : '—'}
        </span>
      )
    }

    if (isEditing) {
      return (
        <input
          ref={inputRef}
          value={editVal}
          onChange={e => setEditVal(e.target.value)}
          onBlur={() => commitEdit(name, field)}
          onKeyDown={e => handleKeyDown(e, name, field)}
          onClick={e => e.stopPropagation()}
          className={`w-[72px] text-center text-[13px] rounded-md px-2 py-1 outline-none border-2 font-mono
            ${opts.amber ? 'border-[#f59e0b]' : 'border-[#0071e3]'}`}
          placeholder="0"
        />
      )
    }

    return (
      <span
        className={`inline-block px-2 py-1.5 rounded cursor-text text-center font-mono transition-colors
          ${isDirty
            ? 'border border-[#fbbf24] bg-[#fffbeb]'
            : 'border border-transparent hover:border-[#d0d0cc] hover:bg-[#f8f8f7]'}
          ${opts.amber
            ? `min-w-[52px] font-semibold ${displayVal != null ? 'text-[#b45309]' : 'text-[#e8c88a]'}`
            : `min-w-[64px] ${displayVal != null ? 'text-[#111110]' : 'text-[#c8c8c4]'}`}`}
        title="Нажми чтобы изменить"
      >
        {displayVal != null ? (opts.amber ? `${displayVal}%` : fmt(displayVal)) : '—'}
      </span>
    )
  }

  function getMarginColor(margin: number, rec: number, min: number): string {
    return margin >= rec ? '#059669' : margin >= min ? '#d97706' : '#dc2626'
  }

  function getMarginInfo(name: string, mm: number, salePrice: number): MarginInfo | null {
    if (!formulaLoaded || salePrice <= 0) return null
    const section = curCat === 'mirror' ? 'mirror' : 'glass'
    function fp(key: string) {
      return formula.find(p => p.section === section && p.param_key === key)?.value ?? 0
    }
    const cRow = rows.find(r => r.name === name && r.price_type === 'cost' && rowCat(r) === curCat)
    if (!cRow) return null
    const costPrice = (cRow[`t${mm}` as keyof GlassRow] as number | null) ?? 0
    if (costPrice <= 0) return null
    const wastePct = cRow.waste_pct ?? 0
    const purchaseVat = fp('purchase_vat')
    const opexPct = fp('opex')
    const baseMarginPct = fp('base_margin')
    const recMargin = fp('recommended_margin')
    const minMargin = fp('min_margin')
    const effectiveCost = costPrice * (1 + wastePct / 100)
    const vatOnCost = effectiveCost * purchaseVat / (100 + purchaseVat)
    const netCost = effectiveCost - vatOnCost
    let temperingIncVat = 0, vatOnTemp = 0, netTemp = 0
    if (curCat === 'glass') {
      const temperingVat = fp('tempering_vat')
      const tempCostPerM2 = formula.find(p => p.section === 'glass' && p.param_key === `tempering_t${mm}`)?.value ?? 0
      if (tempCostPerM2 > 0) {
        temperingIncVat = tempCostPerM2 * (1 + wastePct / 100)
        vatOnTemp = temperingIncVat * temperingVat / (100 + temperingVat)
        netTemp = temperingIncVat - vatOnTemp
      }
    }
    const totalNetCost = netCost
    const totalNetWithTemp = netCost + netTemp
    const opexAmount = Math.round(salePrice * opexPct / 100)
    const profit = salePrice - totalNetCost - opexAmount
    const margin = salePrice > 0 ? (profit / salePrice) * 100 : 0
    const profitWithTemp = salePrice - totalNetWithTemp - opexAmount
    const marginWithTemp = salePrice > 0 ? (profitWithTemp / salePrice) * 100 : 0
    const denom = (100 - opexPct - baseMarginPct) / 100
    const recPrice = denom > 0 ? Math.round(totalNetCost / denom) : 0
    const recPriceWithTemp = denom > 0 ? Math.round(totalNetWithTemp / denom) : 0
    return {
      effectiveCost: Math.round(effectiveCost),
      vatOnCost: Math.round(vatOnCost),
      netCost: Math.round(netCost),
      temperingIncVat: Math.round(temperingIncVat),
      vatOnTemp: Math.round(vatOnTemp),
      netTemp: Math.round(netTemp),
      totalNetCost: Math.round(totalNetCost),
      totalNetWithTemp: Math.round(totalNetWithTemp),
      opexAmount,
      profit: Math.round(profit),
      margin,
      profitWithTemp: Math.round(profitWithTemp),
      marginWithTemp,
      recPrice,
      recPriceWithTemp,
      wastePct,
      purchaseVatPct: purchaseVat,
      opexPct,
      baseMarginPct,
      recMargin,
      minMargin,
    }
  }

  function fillAllByFormula(cat: Category) {
    const section = cat === 'mirror' ? 'mirror' : 'glass'
    function fp(key: string) {
      return formula.find(p => p.section === section && p.param_key === key)?.value ?? 0
    }
    const opexPct = fp('opex')
    const baseMarginPct = fp('base_margin')
    const purchaseVat = fp('purchase_vat')
    const temperingVat = fp('tempering_vat')
    const denom = (100 - opexPct - baseMarginPct) / 100
    if (denom <= 0) return
    const thicks = cat === 'mirror' ? MIRROR_MM : GLASS_MM
    const names = Array.from(new Set(rows.filter(r => rowCat(r) === cat).map(r => r.name)))
    const newDirty: Record<string, DirtyEntry> = {}
    let count = 0
    for (const name of names) {
      for (const t of thicks) {
        const cR = rows.find(r => r.name === name && r.price_type === 'cost' && rowCat(r) === cat)
        if (!cR) continue
        const costPrice = (cR[`t${t}` as keyof GlassRow] as number | null) ?? 0
        if (costPrice <= 0) continue
        const wastePct = cR.waste_pct ?? 0
        const effCost = costPrice * (1 + wastePct / 100)
        const vatOnCost = effCost * purchaseVat / (100 + purchaseVat)
        let netCost = effCost - vatOnCost
        if (cat === 'glass') {
          const tempCost = fp(`tempering_t${t}`)
          if (tempCost > 0) {
            const tempIncVat = tempCost * (1 + wastePct / 100)
            netCost += tempIncVat - tempIncVat * temperingVat / (100 + temperingVat)
          }
        }
        const recPrice = Math.round(netCost / denom)
        if (recPrice > 0) {
          newDirty[dirtyKey(name, `t${t}`, 'sale', cat)] = { name, field: `t${t}`, priceType: 'sale', category: cat, numVal: recPrice }
          count++
        }
      }
    }
    if (count > 0) {
      setDirty(prev => ({ ...prev, ...newDirty }))
      showToast(`Пересчитано ${count} ячеек`)
      setTab(cat === 'mirror' ? 'sale_mirror' : 'sale_glass')
    } else {
      showToast('Нет данных для расчёта')
    }
  }

  function fillByFormula() {
    const section = curCat === 'mirror' ? 'mirror' : 'glass'
    function fp(key: string) {
      return formula.find(p => p.section === section && p.param_key === key)?.value ?? 0
    }
    const opexPct = fp('opex')
    const baseMarginPct = fp('base_margin')
    const purchaseVat = fp('purchase_vat')
    const temperingVat = fp('tempering_vat')
    const denom = (100 - opexPct - baseMarginPct) / 100
    if (denom <= 0) return
    let count = 0
    for (const name of allNames) {
      for (const t of thicknesses) {
        const field = `t${t}`
        const saleR = rows.find(r => r.name === name && r.price_type === 'sale' && rowCat(r) === curCat)
        const saleVal = (saleR?.[field as keyof GlassRow] as number | null) ?? null
        const dk = dirtyKey(name, field, 'sale', curCat)
        if ((saleVal == null || saleVal === 0) && !(dk in dirty)) {
          const cR = rows.find(r => r.name === name && r.price_type === 'cost' && rowCat(r) === curCat)
          if (!cR) continue
          const costPrice = (cR[field as keyof GlassRow] as number | null) ?? 0
          if (costPrice <= 0) continue
          const wastePct = cR.waste_pct ?? 0
          const effCost = costPrice * (1 + wastePct / 100)
          const vatOnCost = effCost * purchaseVat / (100 + purchaseVat)
          let netCost = effCost - vatOnCost
          // Include tempering for glass (same calc as getMarginInfo)
          if (curCat === 'glass') {
            const tempCost = fp(`tempering_t${t}`)
            if (tempCost > 0) {
              const tempIncVat = tempCost * (1 + wastePct / 100)
              const vatOnTemp = tempIncVat * temperingVat / (100 + temperingVat)
              netCost += tempIncVat - vatOnTemp
            }
          }
          const recPrice = Math.round(netCost / denom)
          if (recPrice > 0) { stageValue(name, field, recPrice); count++ }
        }
      }
    }
    if (count > 0) showToast(`Заполнено ${count} ячеек по формуле`)
    else showToast('Все ячейки уже заполнены')
  }

  function tabBtn(key: TabKey, variant: 'dark' | 'blue' | 'purple' = 'dark') {
    const active = tab === key
    const base = 'text-[13px] font-medium px-3.5 py-1.5 rounded-lg transition-colors'
    if (active) {
      if (variant === 'blue')   return `${base} bg-[#0071e3] text-white`
      if (variant === 'purple') return `${base} bg-[#7c3aed] text-white`
      return `${base} bg-[#111110] text-white`
    }
    return `${base} bg-white border border-[#e4e4e0] text-[#111110] hover:bg-[#f5f5f4]`
  }

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8 pb-24">
      {toast && (
        <div className="fixed top-4 right-4 bg-[#111110] text-white text-[13px] px-4 py-2.5 rounded-xl shadow-lg z-50">{toast}</div>
      )}
      {undoRows && (
        <div className="fixed top-4 right-4 flex items-center gap-3 bg-[#1c1c1e] text-white text-[13px] px-4 py-2.5 rounded-xl shadow-lg z-50">
          <span>Цены очищены</span>
          <button onClick={undoClear} className="font-semibold text-[#0a84ff] hover:text-[#409cff] transition-colors">Отменить</button>
        </div>
      )}
      {popover && (
        <MarginPopover
          info={popover.info}
          name={popover.name}
          mm={popover.mm}
          salePrice={popover.salePrice}
          cat={curCat}
          onClose={() => setPopover(null)}
        />
      )}

      <div className="mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">Справочник цен на стекло и зеркало</h1>
            <p className="text-[13px] text-[#8a8a85] mt-0.5">
              Кликни по ячейке → введи значение → Enter. Нажми <span className="font-medium text-[#111110]">«Сохранить изменения»</span> чтобы записать в базу.
              <span className="ml-1 text-[#b45309]">Расход %</span> — базовый коэффициент потерь при раскрое.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={syncToB2B} disabled={syncingB2B}
              className="text-[12px] font-medium px-3.5 py-2 rounded-lg bg-orange-50 border border-orange-200 text-orange-700 hover:bg-orange-100 disabled:opacity-50 transition-colors whitespace-nowrap">
              {syncingB2B ? 'Синхронизация...' : '⟳ Синхр. в B2B'}
            </button>
            <a href="/admin/waste-modifiers"
              className="text-[12px] font-medium px-3.5 py-2 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f4] transition-colors whitespace-nowrap">
              Модификаторы расхода →
            </a>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 mb-5 flex-wrap">
        <button onClick={() => setTab('cost_glass')}  className={tabBtn('cost_glass')}>Себестоимость Стекло</button>
        {isOwner && <button onClick={() => setTab('sale_glass')}  className={tabBtn('sale_glass',  'blue')}>Продажная Стекло 🔒</button>}
        <div className="w-px h-5 bg-[#d8d8d4] mx-1" />
        <button onClick={() => setTab('cost_mirror')} className={tabBtn('cost_mirror')}>Себестоимость Зеркало</button>
        {isOwner && <button onClick={() => setTab('sale_mirror')} className={tabBtn('sale_mirror', 'blue')}>Продажная Зеркало 🔒</button>}
        {isOwner && (
          <>
            <div className="w-px h-5 bg-[#d8d8d4] mx-1" />
            <button onClick={() => setTab('formula')} className={tabBtn('formula', 'purple')}>Формула просчёта 🔒</button>
          </>
        )}
      </div>

      {/* ── Formula tab ── */}
      {tab === 'formula' && (
        formulaLoading
          ? <div className="text-[13px] text-[#8a8a85] py-12 text-center">Загрузка...</div>
          : <>
              <FormulaTab
                formula={formula}
                editId={formulaEditId}
                editVal={formulaEditVal}
                saving={formulaSaving}
                exCost={exCost} setExCost={setExCost}
                exTempering={exTempering} setExTempering={setExTempering}
                exPrice={exPrice} setExPrice={setExPrice}
                onStartEdit={(id, cur) => { setFormulaEditId(id); setFormulaEditVal(String(cur)) }}
                onCancelEdit={() => setFormulaEditId(null)}
                onSave={saveFormulaParam}
                onEditValChange={setFormulaEditVal}
              />
              {/* Apply formula to all sale prices */}
              <div className="mt-6 bg-white border border-[#e4e4e0] rounded-xl p-5">
                <h2 className="text-[14px] font-semibold text-[#111110] mb-1">Применить формулу ко всем ценам</h2>
                <p className="text-[13px] text-[#8a8a85] mb-4">
                  Пересчитает и перезапишет все продажные цены на основе текущих параметров.
                  Нажми «Сохранить изменения» после проверки.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => fillAllByFormula('glass')}
                    className="text-[13px] font-semibold px-5 py-2.5 rounded-lg bg-[#0071e3] text-white hover:bg-[#0062c4] transition-colors"
                  >
                    Пересчитать все цены — Стекло
                  </button>
                  <button
                    onClick={() => fillAllByFormula('mirror')}
                    className="text-[13px] font-semibold px-5 py-2.5 rounded-lg bg-[#7c3aed] text-white hover:bg-[#6d28d9] transition-colors"
                  >
                    Пересчитать все цены — Зеркало
                  </button>
                </div>
              </div>
            </>
      )}

      {/* ── Price matrix tabs ── */}
      {tab !== 'formula' && loading ? (
        <div className="text-[13px] text-[#8a8a85] py-12 text-center">Загрузка...</div>
      ) : tab !== 'formula' && (
        <>
          {/* Banner: empty sale cells that have cost data */}
          {curPT === 'sale' && (() => {
            const emptyCount = allNames.reduce((n, name) => n + thicknesses.filter(t => {
              const sR = rows.find(r => r.name === name && r.price_type === 'sale' && rowCat(r) === curCat)
              const cR = rows.find(r => r.name === name && r.price_type === 'cost' && rowCat(r) === curCat)
              const dk = dirtyKey(name, `t${t}`, 'sale', curCat)
              const dbSale = (sR?.[`t${t}` as keyof GlassRow] as number | null) ?? null
              const dbCost = (cR?.[`t${t}` as keyof GlassRow] as number | null) ?? null
              return (dbSale == null || dbSale === 0) && !(dk in dirty) && dbCost != null && dbCost > 0
            }).length, 0)
            if (emptyCount === 0) return null
            return (
              <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-3">
                <span className="text-[13px] text-amber-800">
                  <span className="font-semibold">{emptyCount}</span> ячеек без продажной цены — есть себестоимость
                  {!formulaLoaded && <span className="ml-1 text-[#8a8a85]">(формула загружается...)</span>}
                </span>
                <button
                  onClick={fillByFormula}
                  disabled={!formulaLoaded}
                  className="text-[13px] font-semibold px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 transition-colors flex-shrink-0"
                >
                  Заполнить по формуле
                </button>
              </div>
            )
          })()}

          <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden mb-4">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-[#f8f8f7] border-b border-[#e4e4e0]">
                  <th className="w-8" />
                  <th className="px-4 py-3 text-left font-semibold text-[#8a8a85] text-[11px] uppercase tracking-wider w-[240px]">Наименование</th>
                  <th className="px-3 py-3 text-center font-semibold text-[#f59e0b] text-[11px] uppercase tracking-wider w-[90px]">Расход %</th>
                  {thicknesses.map(t => (
                    <th key={t} className="px-3 py-3 text-center font-semibold text-[#8a8a85] text-[11px] uppercase tracking-wider">{t} мм</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0ee]">
                {allNames.length === 0 && (
                  <tr>
                    <td colSpan={thicknesses.length + 3} className="px-4 py-8 text-center text-[#8a8a85]">
                      Нет данных. Добавьте позицию ниже.
                    </td>
                  </tr>
                )}
                {allNames.map(origName => {
                  const row        = tabRow(origName)
                  const cRow       = costRow(origName)
                  const waste      = cRow?.waste_pct ?? null
                  const dispName   = getNameDisplay(origName)
                  const nameDirty  = dirtyKey(origName, '__name__', 'cost', curCat) in dirty
                  const nameEditing = editKey === makeKey(origName, '__name__', tab)

                  return (
                    <tr key={origName} className="hover:bg-[#fafaf9] group">

                      {/* Delete */}
                      <td className="pl-3 text-center">
                        <button onClick={() => deleteGlass(origName)}
                          className="w-6 h-6 rounded flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors mx-auto"
                          title="Удалить">×</button>
                      </td>

                      {/* Наименование */}
                      <td className="px-4 py-2"
                        onClick={() => {
                          setEditKey(makeKey(origName, '__name__', tab))
                          setEditVal(getNameDisplay(origName))
                        }}>
                        {nameEditing
                          ? <input
                              ref={inputRef}
                              value={editVal}
                              onChange={e => setEditVal(e.target.value)}
                              onBlur={() => commitEdit(origName, '__name__')}
                              onKeyDown={e => handleKeyDown(e, origName, '__name__')}
                              onClick={e => e.stopPropagation()}
                              className="w-full min-w-[160px] text-[13px] font-medium rounded-md px-2 py-0.5 outline-none border-2 border-[#0071e3]"
                            />
                          : <span className={`cursor-text font-medium transition-colors
                              hover:text-[#0071e3]
                              ${nameDirty ? 'text-[#b45309] underline decoration-dotted' : 'text-[#111110]'}`}>
                              {dispName}
                            </span>}
                        {isCostTab && (
                          <div className="flex items-center gap-1.5 mt-1.5" onClick={e => e.stopPropagation()}>
                            <select
                              className="text-[11px] border border-[#e4e4e0] rounded px-1.5 py-0.5 text-[#6b6b66] bg-white outline-none focus:border-[#0071e3] max-w-[130px]"
                              value={rowSupplier[origName]?.supplier_id ?? ''}
                              onChange={e => {
                                const val = e.target.value || null
                                const current = rowSupplier[origName] ?? { supplier_id: null, supplier_material_name: null }
                                setRowSupplier(prev => ({ ...prev, [origName]: { ...current, supplier_id: val } }))
                                saveRowSupplierImmediate(origName, val, current.supplier_material_name)
                              }}>
                              <option value="">— поставщик —</option>
                              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                            <input
                              className="text-[11px] border border-[#e4e4e0] rounded px-1.5 py-0.5 text-[#6b6b66] outline-none focus:border-[#0071e3] w-[100px]"
                              placeholder="наим. у пост."
                              value={rowSupplier[origName]?.supplier_material_name ?? ''}
                              onChange={e => setRowSupplier(prev => ({
                                ...prev,
                                [origName]: { ...(prev[origName] ?? { supplier_id: null, supplier_material_name: null }), supplier_material_name: e.target.value || null }
                              }))}
                              onBlur={e => saveRowSupplierImmediate(
                                origName,
                                rowSupplier[origName]?.supplier_id ?? null,
                                e.target.value || null
                              )}
                            />
                          </div>
                        )}
                      </td>

                      {/* Расход % */}
                      <td className="px-2 py-2 text-center"
                        onClick={() => isCostTab && startEdit(origName, 'waste_pct', getDisplayVal(origName, 'waste_pct', waste))}>
                        {isCostTab
                          ? renderCell(origName, 'waste_pct', waste, { amber: true })
                          : renderCell(origName, 'waste_pct', waste, { readOnly: true })}
                      </td>

                      {/* Price cells */}
                      {thicknesses.map(t => {
                        const field = `t${t}`
                        const dbVal = (row?.[`t${t}` as keyof GlassRow] as number | null) ?? null
                        const displayVal = getDisplayVal(origName, field, dbVal)
                        const mInfo = curPT === 'sale' && formulaLoaded && displayVal != null && displayVal > 0
                          ? getMarginInfo(origName, t, displayVal)
                          : null
                        const realMargin = mInfo
                          ? (curCat === 'glass' && mInfo.temperingIncVat > 0 ? mInfo.marginWithTemp : mInfo.margin)
                          : 0
                        return (
                          <td key={t} className="px-2 py-2 text-center"
                            onClick={() => startEdit(origName, field, getDisplayVal(origName, field, dbVal))}>
                            {renderCell(origName, field, dbVal)}
                            {mInfo && (
                              <button
                                onClick={e => { e.stopPropagation(); setPopover({ name: origName, mm: t, salePrice: displayVal as number, info: mInfo }) }}
                                className="block mx-auto mt-0.5 text-[10px] font-mono font-semibold rounded px-1 py-0.5 hover:opacity-70 transition-opacity leading-none"
                                style={{ color: getMarginColor(realMargin, mInfo.recMargin, mInfo.minMargin) }}
                                title="Детальный расчёт маржи">
                                {realMargin.toFixed(1)}%
                              </button>
                            )}
                          </td>
                        )
                      })}

                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Add row */}
          <div className="flex items-center gap-2 mb-5">
            <input value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addGlass()}
              placeholder={`Название ${curCat === 'mirror' ? 'зеркала' : 'стекла'}...`}
              className="text-[13px] border border-[#e4e4e0] rounded-lg px-3 py-2 outline-none focus:border-[#0071e3] w-[300px]" />
            <button onClick={addGlass} disabled={addingRow || !newName.trim()}
              className="text-[13px] font-medium px-4 py-2 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
              {addingRow ? 'Добавляю...' : '+ Добавить'}
            </button>
          </div>

          {/* Clear + migrate */}
          <div className="pt-4 border-t border-[#f0f0ee] flex flex-wrap items-center gap-3">
            <button onClick={clearPrices} disabled={clearing || allNames.length === 0}
              className="text-[13px] font-medium px-4 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors">
              {clearing ? 'Очищаю...' : `Очистить цены — ${TAB_LABEL[priceTab]}`}
            </button>
            <span className="text-[12px] text-[#8a8a85]">Обнулит числа. Отмена в течение 6 сек.</span>

            {priceTab === 'sale_glass' && isOwner && (
              <>
                <div className="w-px h-5 bg-[#e4e4e0]" />
                <button onClick={migrateFromMaterials} disabled={migrating}
                  className="text-[13px] font-medium px-4 py-2 rounded-lg bg-[#0071e3] text-white hover:bg-[#0062c4] disabled:opacity-40 transition-colors">
                  {migrating ? 'Переношу...' : 'Перенести из Материалов'}
                </button>
              </>
            )}

            {curPT === 'sale' && formulaLoaded && (
              <>
                <div className="w-px h-5 bg-[#e4e4e0]" />
                <button onClick={fillByFormula}
                  className="text-[13px] font-medium px-4 py-2 rounded-lg bg-[#059669] text-white hover:bg-[#047857] transition-colors">
                  Заполнить по формуле
                </button>
                <span className="text-[11px] text-[#8a8a85]">Только пустые ячейки</span>
              </>
            )}
            {curPT === 'sale' && (
              <span className="text-[12px] text-[#0071e3] ml-auto">🔒 Продажные цены видны только владельцу.</span>
            )}
          </div>
        </>
      )}

      {/* ── Sticky save bar ── */}
      {hasDirty && tab !== 'formula' && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[#e4e4e0] shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
          <div className="max-w-[1200px] mx-auto px-6 py-3 flex items-center justify-between gap-4">
            <span className="text-[13px] text-[#8a8a85]">
              {Object.keys(dirty).length === 1 ? '1 изменение' : `${Object.keys(dirty).length} изменения`} не сохранено
            </span>
            <div className="flex items-center gap-2">
              <button onClick={discardAll}
                className="text-[13px] font-medium px-4 py-2 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f4] transition-colors">
                Отменить
              </button>
              <button onClick={saveAll} disabled={savingAll}
                className="text-[13px] font-medium px-5 py-2 rounded-lg bg-[#0071e3] text-white hover:bg-[#0062c4] disabled:opacity-60 transition-colors">
                {savingAll ? 'Сохраняю...' : 'Сохранить изменения'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── FormulaTab ──────────────────────────────────────────────────────────────

const SECTION_META: Record<string, { title: string; color: string; bg: string; border: string }> = {
  glass:  { title: 'Стекло',   color: 'text-[#0071e3]', bg: 'bg-blue-50',   border: 'border-blue-200' },
  mirror: { title: 'Зеркала',  color: 'text-[#7c3aed]', bg: 'bg-purple-50', border: 'border-purple-200' },
  b2b:    { title: 'B2B',      color: 'text-[#059669]', bg: 'bg-emerald-50',border: 'border-emerald-200' },
}

function FormulaTab({
  formula, editId, editVal, saving,
  exCost, setExCost, exTempering, setExTempering, exPrice, setExPrice,
  onStartEdit, onCancelEdit, onSave, onEditValChange,
}: {
  formula: FormulaParam[]
  editId: number | null; editVal: string; saving: boolean
  exCost: string; setExCost: (v: string) => void
  exTempering: string; setExTempering: (v: string) => void
  exPrice: string; setExPrice: (v: string) => void
  onStartEdit: (id: number, cur: number) => void
  onCancelEdit: () => void
  onSave: (id: number, val: string) => void
  onEditValChange: (v: string) => void
}) {
  const sections = ['glass', 'mirror', 'b2b'] as const

  function gp(section: string, key: string) {
    return formula.find(p => p.section === section && p.param_key === key)?.value ?? 0
  }

  // Live example calculation (glass section)
  const purchaseVat = gp('glass', 'purchase_vat')
  const temperingVat = gp('glass', 'tempering_vat')
  const opex = gp('glass', 'opex')
  const baseMargin = gp('glass', 'base_margin')
  const minMargin = gp('glass', 'min_margin')
  const recMargin = gp('glass', 'recommended_margin')

  const cost = parseFloat(exCost) || 0
  const tempering = parseFloat(exTempering) || 0
  const price = parseFloat(exPrice) || 0

  const vatOnCost = Math.round(cost * purchaseVat / (100 + purchaseVat))
  const vatOnTemp = Math.round(tempering * temperingVat / (100 + temperingVat))
  const netCost = cost - vatOnCost
  const netTemp = tempering - vatOnTemp
  const totalNetCost = netCost + netTemp
  const opexAmount = Math.round(price * opex / 100)
  const profit = price - totalNetCost - opexAmount
  const margin = price > 0 ? (profit / price) * 100 : 0
  const marginColor = margin >= recMargin ? '#059669' : margin >= minMargin ? '#d97706' : '#dc2626'

  // Auto-price calculation: what price should give base_margin
  const autoPrice = totalNetCost > 0 && (100 - opex - baseMargin) > 0
    ? Math.round(totalNetCost / ((100 - opex - baseMargin) / 100))
    : 0

  return (
    <div className="space-y-6">
      {/* Header notice */}
      <div className="bg-[#f5f0ff] border border-[#c4b5fd] rounded-xl px-5 py-3.5 text-[13px] text-[#5b21b6]">
        <strong>Формула просчёта</strong> — единый финансовый центр MGlass.
        Все калькуляторы используют эти параметры.
        Изменяйте здесь — значения применятся везде.
      </div>

      {/* Parameter sections */}
      {sections.map(section => {
        const rows = formula.filter(p => p.section === section)
        const meta = SECTION_META[section]
        return (
          <div key={section} className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
            <div className={`px-5 py-3 border-b border-[#e4e4e0] ${meta.bg}`}>
              <h2 className={`text-[14px] font-semibold ${meta.color}`}>{meta.title}</h2>
            </div>
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-[#f0f0ee]">
                {rows.map(p => (
                  <tr key={p.id} className="hover:bg-[#fafaf9] group">
                    <td className="px-5 py-3 w-[260px]">
                      <div className="font-medium text-[#111110]">{p.param_name}</div>
                      {p.description && (
                        <div className="text-[11px] text-[#8a8a85] mt-0.5 max-w-[400px] leading-relaxed">{p.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center w-[120px]">
                      {editId === p.id ? (
                        <div className="flex items-center gap-1 justify-center">
                          <input
                            autoFocus
                            value={editVal}
                            onChange={e => onEditValChange(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') onSave(p.id, editVal)
                              if (e.key === 'Escape') onCancelEdit()
                            }}
                            onClick={e => e.stopPropagation()}
                            className="w-20 text-center text-[13px] border-2 border-[#7c3aed] rounded-md px-2 py-1 outline-none font-mono"
                          />
                          <span className="text-[12px] text-[#8a8a85]">{p.unit}</span>
                          <button onClick={() => onSave(p.id, editVal)} disabled={saving}
                            className="ml-1 text-[12px] px-2 py-1 rounded bg-[#7c3aed] text-white hover:bg-[#6d28d9] disabled:opacity-50">✓</button>
                          <button onClick={onCancelEdit}
                            className="text-[12px] px-1.5 py-1 rounded border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f4]">✕</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => onStartEdit(p.id, p.value)}
                          className="font-mono font-semibold text-[15px] text-[#111110] hover:text-[#7c3aed] transition-colors group-hover:underline decoration-dotted cursor-text"
                          title="Нажми чтобы изменить">
                          {p.value % 1 === 0 ? p.value.toFixed(0) : p.value.toFixed(1)}{p.unit === '%' ? '%' : ` ${p.unit}`}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 w-10 opacity-0 group-hover:opacity-100 text-[#c8c8c4] text-[11px] text-center">✎</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}

      {/* Live calculation example */}
      <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[#e4e4e0] bg-[#f8f8f7] flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-[#111110]">Живой пример: Стекло</h2>
          <span className="text-[11px] text-[#8a8a85]">Меняй входные данные — расчёт обновится автоматически</span>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-3 gap-4 mb-5">
            {[
              { label: 'Себестоимость стекла', val: exCost, set: setExCost, hint: '₽, с НДС поставщика' },
              { label: 'Закалка', val: exTempering, set: setExTempering, hint: '₽, с НДС' },
              { label: 'Продажная цена', val: exPrice, set: setExPrice, hint: '₽, клиенту' },
            ].map(({ label, val, set, hint }) => (
              <div key={label}>
                <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-1">{label}</label>
                <input type="number" value={val} onChange={e => set(e.target.value)}
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] font-mono outline-none focus:border-[#7c3aed]" />
                <p className="text-[11px] text-[#b0b0aa] mt-0.5">{hint}</p>
              </div>
            ))}
          </div>

          {/* Breakdown */}
          <div className="bg-[#fafaf9] rounded-xl border border-[#e4e4e0] overflow-hidden">
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-[#f0f0ee]">
                <CalcRow label="Себестоимость стекла (с НДС)" value={cost} />
                <CalcRow label={`НДС закупки (${purchaseVat}%)`} value={-vatOnCost} sub />
                <CalcRow label="Стекло без НДС" value={netCost} bold />
                <CalcRow label="Закалка (с НДС)" value={tempering} />
                <CalcRow label={`НДС закалки (${temperingVat}%)`} value={-vatOnTemp} sub />
                <CalcRow label="Закалка без НДС" value={netTemp} bold />
                <CalcRow label="Итого чистая себестоимость" value={totalNetCost} bold separator />
                <CalcRow label={`Операционные расходы (${opex}%)`} value={-opexAmount} sub />
                <CalcRow label="Продажная цена" value={price} />
              </tbody>
            </table>
            {/* Result */}
            <div className="px-5 py-3.5 bg-white border-t-2 border-[#e4e4e0] flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-0.5">Чистая прибыль</div>
                <div className="text-[20px] font-semibold font-mono" style={{ color: marginColor }}>
                  {profit.toLocaleString('ru-RU')} ₽
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-0.5">Маржа</div>
                <div className="text-[28px] font-bold font-mono" style={{ color: marginColor }}>
                  {margin.toFixed(1)}%
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: marginColor }}>
                  {margin >= recMargin ? '✓ Хорошая маржа' : margin >= minMargin ? '⚠ Допустимо' : '✕ Ниже минимума'}
                </div>
              </div>
            </div>
          </div>

          {/* Auto-price hint */}
          {autoPrice > 0 && (
            <div className="mt-3 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg text-[13px] text-[#1d4ed8]">
              Для достижения <strong>базовой маржи {baseMargin}%</strong> при этой себестоимости:
              рекомендуемая продажная цена = <strong className="font-mono">{autoPrice.toLocaleString('ru-RU')} ₽</strong>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CalcRow({ label, value, sub, bold, separator }: {
  label: string; value: number; sub?: boolean; bold?: boolean; separator?: boolean
}) {
  const isNeg = value < 0
  return (
    <tr className={separator ? 'border-t-2 border-[#e4e4e0]' : ''}>
      <td className={`px-5 py-2.5 ${sub ? 'pl-8 text-[#8a8a85]' : bold ? 'font-semibold text-[#111110]' : 'text-[#4b4b47]'}`}>
        {label}
      </td>
      <td className={`px-5 py-2.5 text-right font-mono ${isNeg ? 'text-red-500' : bold ? 'text-[#111110] font-semibold' : 'text-[#4b4b47]'}`}>
        {isNeg ? `−${Math.abs(value).toLocaleString('ru-RU')}` : value.toLocaleString('ru-RU')} ₽
      </td>
    </tr>
  )
}

// ─── MarginPopover ────────────────────────────────────────────────────────────

function MarginPopover({ info, name, mm, salePrice, cat, onClose }: {
  info: MarginInfo; name: string; mm: number; salePrice: number; cat: Category; onClose: () => void
}) {
  const mc = (m: number) => m >= info.recMargin ? '#059669' : m >= info.minMargin ? '#d97706' : '#dc2626'
  const hasTemp = cat === 'glass' && info.temperingIncVat > 0
  const primaryMargin = hasTemp ? info.marginWithTemp : info.margin
  const primaryProfit = hasTemp ? info.profitWithTemp : info.profit
  const recPrice = hasTemp ? info.recPriceWithTemp : info.recPrice

  function Row({ label, value, neg, sub }: { label: string; value: string; neg?: boolean; sub?: boolean }) {
    return (
      <div className={`flex justify-between items-center py-1 ${sub ? 'pl-3' : ''}`}>
        <span className={`text-[12px] ${sub ? 'text-[#8a8a85]' : 'text-[#4b4b47]'}`}>{label}</span>
        <span className={`font-mono text-[12px] ${neg ? 'text-red-500' : 'text-[#4b4b47]'}`}>{value}</span>
      </div>
    )
  }

  return (
    <div className="fixed z-50 inset-0 bg-black/25 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl border border-[#e4e4e0] w-[360px]"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-4 py-3 bg-[#f8f8f7] border-b border-[#e4e4e0] flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold text-[#111110]">{name} — {mm}мм</div>
            <div className="text-[11px] text-[#8a8a85] mt-0.5">Расход {info.wastePct}% · на 1 м² изделия</div>
          </div>
          <button onClick={onClose} className="text-[#8a8a85] hover:text-[#111110] text-xl leading-none ml-3">×</button>
        </div>

        {/* Sale price */}
        <div className="px-4 py-2.5 border-b border-[#e4e4e0] flex justify-between items-center">
          <span className="text-[12px] text-[#8a8a85] uppercase tracking-wider font-semibold text-[11px]">Продажная цена</span>
          <span className="font-mono font-semibold text-[#111110]">{salePrice.toLocaleString('ru-RU')} ₽</span>
        </div>

        {/* Cost breakdown */}
        <div className="px-4 py-3 border-b border-[#e4e4e0] space-y-0.5">
          <div className="text-[10px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-2">Затраты</div>
          <Row label={`Стекло (с НДС, расход +${info.wastePct}%)`} value={`${info.effectiveCost.toLocaleString('ru-RU')} ₽`} />
          {hasTemp && <Row label={`Закалка ${mm}мм (с НДС, расход +${info.wastePct}%)`} value={`${info.temperingIncVat.toLocaleString('ru-RU')} ₽`} />}
          <Row label={`НДС стекла к зачёту (${info.purchaseVatPct}%)`} value={`−${info.vatOnCost.toLocaleString('ru-RU')} ₽`} neg sub />
          {hasTemp && <Row label="НДС закалки к зачёту" value={`−${info.vatOnTemp.toLocaleString('ru-RU')} ₽`} neg sub />}
          <Row label={`Опекс (${info.opexPct}%)`} value={`−${info.opexAmount.toLocaleString('ru-RU')} ₽`} neg sub />
        </div>

        {/* Results */}
        <div className="px-4 py-3 border-b border-[#e4e4e0]">
          {/* Primary margin (with tempering for glass) */}
          <div className="flex justify-between items-center">
            <span className="text-[13px] font-semibold text-[#111110]">
              {hasTemp ? 'Маржа С ЗАКАЛКОЙ' : 'Маржа'}
            </span>
            <span className="font-mono text-[22px] font-bold leading-none" style={{ color: mc(primaryMargin) }}>
              {primaryMargin.toFixed(1)}%
            </span>
          </div>
          {/* Secondary: without tempering */}
          {hasTemp && (
            <div className="flex justify-between items-center mt-1">
              <span className="text-[12px] text-[#8a8a85]">Маржа без закалки</span>
              <span className="font-mono text-[13px] text-[#8a8a85]">{info.margin.toFixed(1)}%</span>
            </div>
          )}
          <div className="flex justify-between items-center mt-2 pt-2 border-t border-[#f0f0ee]">
            <span className="text-[12px] text-[#4b4b47]">Чистая прибыль</span>
            <span className="font-mono text-[13px] font-semibold" style={{ color: mc(primaryMargin) }}>
              {primaryProfit.toLocaleString('ru-RU')} ₽
            </span>
          </div>
        </div>

        {/* Recommended price */}
        {recPrice > 0 && (
          <div className="px-4 py-2.5 bg-blue-50 text-[11px] text-[#1d4ed8]">
            Рекомендуемая цена (маржа {info.baseMarginPct}%):
            <strong className="font-mono ml-1">{recPrice.toLocaleString('ru-RU')} ₽</strong>
          </div>
        )}

        {/* Legend */}
        <div className="px-4 py-2 bg-[#f8f8f7] rounded-b-xl text-[10px] text-[#8a8a85] flex gap-3">
          <span style={{ color: '#059669' }}>● &gt;{info.recMargin}%</span>
          <span style={{ color: '#d97706' }}>● ≥{info.minMargin}%</span>
          <span style={{ color: '#dc2626' }}>● &lt;{info.minMargin}%</span>
        </div>
      </div>
    </div>
  )
}
