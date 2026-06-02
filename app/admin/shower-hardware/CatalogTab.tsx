'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { ImagePicker } from './ImagePicker'

export const CATEGORIES = [
  'петли','ручки','профили','крепления','штанги',
  'комплектующие','уплотнители','механизмы','аксессуары','прочее',
]
export const SHOWER_TYPES = [
  { v: 'stationary', l: 'Стационарная' },
  { v: 'swing',      l: 'Распашная'    },
  { v: 'sliding',    l: 'Раздвижная'   },
  { v: 'universal',  l: 'Универсальная' },
]
const UNITS = ['шт', 'м.п.', 'хлыст', 'комплект']

const SUBCATEGORIES: Record<string, string[]> = {
  петли:        ['стена—стекло', 'стекло—стекло', 'нижняя'],
  профили:      ['П-профиль', 'штанга', 'труба', 'добор', 'уголок'],
  уплотнители:  ['магнитный', 'пороговый', 'капельник', 'Г-образный'],
  ручки:        ['скоба', 'кнопка', 'скрытая'],
  механизмы:    ['доводчик', 'фиксатор', 'замок'],
  комплектующие: ['заглушка', 'шуруп', 'дюбель', 'вкладыш'],
}

export type Color    = { id: number; name: string; sort_order: number; active: boolean }
export type Supplier = { id: number; name: string; active: boolean }

type Item = {
  id: number; name: string; article: string; category: string; unit: string
  whip_length: number | null; shower_types: string[]
  photo_url: string; url: string; comment: string; active: boolean
  item_role: 'required' | 'optional' | 'addon'
  depends_on_item_id: number | null
  sort_order: number
  min_qty: number
  max_qty: number | null
  hinge_type: 'wall-glass' | 'glass-glass' | null
  track_type: 'open' | 'closed' | null
  lead_days: number | null
  stock_qty: number
  subcategory: string | null
}
type Price = {
  id?: number; item_id: number; supplier_id: number; color_id: number
  website_price: number; discount_percent: number; cost_price: number
  vat_included: boolean
}
type FormPriceRow = {
  supplier_id: number | null; color_id: number | null
  website_price: string; discount_percent: string; vat_included: boolean
}
type FormState = {
  name: string; article: string; category: string; unit: string; whip_length: number | null
  shower_types: string[]; photo_url: string; url: string; comment: string; active: boolean
  prices: FormPriceRow[]
  item_role: 'required' | 'optional' | 'addon'
  depends_on_item_id: number | null
  sort_order: number
  min_qty: number
  max_qty: number | null
  hinge_type: 'wall-glass' | 'glass-glass' | null
  track_type: 'open' | 'closed' | null
  lead_days: number | null
  stock_qty: number
  subcategory: string | null
}

const EMPTY_PRICE: FormPriceRow = { supplier_id: null, color_id: null, website_price: '', discount_percent: '0', vat_included: false }
const EMPTY_FORM: FormState = {
  name: '', article: '', category: 'профили', unit: 'шт', whip_length: null,
  shower_types: [], photo_url: '', url: '', comment: '', active: true,
  prices: [{ ...EMPTY_PRICE }],
  item_role: 'optional', depends_on_item_id: null,
  sort_order: 0, min_qty: 1, max_qty: null,
  hinge_type: null, track_type: null, lead_days: null,
  stock_qty: 0, subcategory: null,
}

// ── Shared price-rows table ───────────────────────────────────────────────────
function PriceRowsTable({
  rows, suppliers, colors, onSet, onAdd, onRemove, error,
}: {
  rows: FormPriceRow[]
  suppliers: Supplier[]
  colors: Color[]
  onSet: <K extends keyof FormPriceRow>(idx: number, k: K, v: FormPriceRow[K]) => void
  onAdd: () => void
  onRemove: (idx: number) => void
  error?: string
}) {
  return (
    <div>
      <div className="border border-[#e4e4e0] rounded-lg overflow-hidden">
        <div className="flex bg-[#f5f5f3] border-b border-[#e4e4e0]">
          <div className="flex-1 px-3 py-2 text-[10px] font-bold text-[#6b6b66] uppercase tracking-wide">Поставщик</div>
          <div className="flex-1 px-3 py-2 text-[10px] font-bold text-[#6b6b66] uppercase tracking-wide">Цвет</div>
          <div className="w-28 px-3 py-2 text-[10px] font-bold text-[#6b6b66] uppercase tracking-wide">Цена на сайте</div>
          <div className="w-20 px-3 py-2 text-[10px] font-bold text-[#6b6b66] uppercase tracking-wide">Скидка %</div>
          <div className="w-28 px-3 py-2 text-[10px] font-bold text-[#6b6b66] uppercase tracking-wide">Закупочная</div>
          <div className="w-16 px-2 py-2 text-[10px] font-bold text-[#6b6b66] uppercase tracking-wide text-center">НДС</div>
          <div className="w-8" />
        </div>
        {rows.map((row, idx) => {
          const cost = Math.round((Number(row.website_price) || 0) * (1 - (Number(row.discount_percent) || 0) / 100))
          return (
            <div key={idx} className="flex items-center border-b border-[#f0f0ec] last:border-0 hover:bg-[#fafaf9]">
              <div className="flex-1 p-1">
                <select value={row.supplier_id ?? ''} onChange={e => onSet(idx, 'supplier_id', e.target.value ? Number(e.target.value) : null)}
                  className="w-full px-2 py-1.5 text-[13px] border border-transparent rounded-lg outline-none bg-transparent hover:border-[#e4e4e0] focus:border-[#111110]">
                  <option value="">— Поставщик —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="flex-1 p-1">
                <select value={row.color_id ?? ''} onChange={e => onSet(idx, 'color_id', e.target.value ? Number(e.target.value) : null)}
                  className="w-full px-2 py-1.5 text-[13px] border border-transparent rounded-lg outline-none bg-transparent hover:border-[#e4e4e0] focus:border-[#111110]">
                  <option value="">— Цвет —</option>
                  {colors.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="w-28 p-1">
                <input type="number" value={row.website_price} onChange={e => onSet(idx, 'website_price', e.target.value)}
                  placeholder="0"
                  className="w-full px-2 py-1.5 text-[13px] font-mono border border-transparent rounded-lg outline-none bg-transparent hover:border-[#e4e4e0] focus:border-[#111110] placeholder-[#c0c0bb]" />
              </div>
              <div className="w-20 p-1 flex items-center gap-0.5">
                <input type="number" value={row.discount_percent} onChange={e => onSet(idx, 'discount_percent', e.target.value)}
                  placeholder="0" min="0" max="100"
                  className="w-full px-2 py-1.5 text-[13px] font-mono border border-transparent rounded-lg outline-none bg-transparent hover:border-[#e4e4e0] focus:border-[#111110] placeholder-[#c0c0bb]" />
                <span className="text-[12px] text-[#9a9a95] pr-1">%</span>
              </div>
              <div className="w-28 px-3 py-1.5 text-[13px] font-mono font-semibold text-emerald-700">
                {row.website_price ? cost.toLocaleString('ru-RU') : <span className="text-[#d4d4d0]">—</span>}
              </div>
              <div className="w-16 flex items-center justify-center">
                <input type="checkbox" checked={row.vat_included} onChange={e => onSet(idx, 'vat_included', e.target.checked)}
                  className="w-4 h-4 rounded cursor-pointer accent-blue-600" />
              </div>
              <div className="w-8 flex items-center justify-center">
                <button onClick={() => onRemove(idx)} className="text-[#c0c0bb] hover:text-red-400 text-lg leading-none px-1">×</button>
              </div>
            </div>
          )
        })}
      </div>
      {error && <p className="text-[12px] text-red-600 mt-1.5 font-medium">{error}</p>}
      <button onClick={onAdd} className="mt-2 text-[12px] font-semibold text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50">
        + Добавить строку цены
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export function CatalogTab({
  colors, suppliers, onRefreshSuppliers,
}: {
  colors: Color[]
  suppliers: Supplier[]
  onRefreshSuppliers: () => void
}) {
  const db = useRef(createClient())
  const formRef = useRef<HTMLDivElement>(null)

  const [items,      setItems]      = useState<Item[]>([])
  const [loading,    setLoading]    = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [prices,     setPrices]     = useState<Price[]>([])

  // Unified form
  const [editId,     setEditId]     = useState<number | null>(null)
  const [formOpen,   setFormOpen]   = useState(false)
  const [form,       setForm]       = useState<FormState>(EMPTY_FORM)
  const [formSaving,     setFormSaving]     = useState(false)
  const [formError,      setFormError]      = useState('')  // ошибка сохранения — над кнопками
  const [priceError,     setPriceError]     = useState('')  // ошибка дубля в таблице цен

  // Filters
  const [filterCat,  setFilterCat]  = useState('all')
  const [filterType, setFilterType] = useState('')
  const [search,     setSearch]     = useState('')

  // Price matrix (expanded row)
  const [editing,     setEditing]     = useState<{ supId: number; colId: number } | null>(null)
  const [editWebsite, setEditWebsite] = useState('')
  const [editDisc,    setEditDisc]    = useState('')
  const editRef = useRef<HTMLInputElement>(null)

  // Supplier quick-add (price matrix)
  const [supDropOpen, setSupDropOpen] = useState(false)
  const [newSupName,  setNewSupName]  = useState('')

  useEffect(() => { load() }, [])
  useEffect(() => { if (editing) editRef.current?.focus() }, [editing])

  async function load() {
    setLoading(true)
    const { data } = await db.current.from('shower_catalog_items').select('*').order('category').order('name')
    setItems((data ?? []) as Item[])
    setLoading(false)
  }

  async function loadPrices(itemId: number) {
    const { data } = await db.current.from('shower_catalog_prices').select('*').eq('item_id', itemId)
    setPrices((data ?? []) as Price[])
  }

  function toggleExpand(id: number) {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id); loadPrices(id); setEditing(null); setSupDropOpen(false)
  }

  // ── Form helpers ────────────────────────────────────────────────────────────
  function setFF<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }
  function toggleST(v: string) {
    setFF('shower_types', form.shower_types.includes(v)
      ? form.shower_types.filter(t => t !== v)
      : [...form.shower_types, v])
  }
  function addFormPrice() { setForm(f => ({ ...f, prices: [...f.prices, { ...EMPTY_PRICE }] })) }
  function removeFormPrice(idx: number) { setForm(f => ({ ...f, prices: f.prices.filter((_, i) => i !== idx) })) }
  function setFormPriceCell<K extends keyof FormPriceRow>(idx: number, k: K, v: FormPriceRow[K]) {
    setForm(f => ({ ...f, prices: f.prices.map((r, i) => i === idx ? { ...r, [k]: v } : r) }))
  }

  async function startEdit(item: Item) {
    const { data } = await db.current.from('shower_catalog_prices').select('*').eq('item_id', item.id)
    const { id: _, ...rest } = item
    setForm({
      ...rest,
      article: rest.article ?? '',
      url: rest.url ?? '',
      comment: rest.comment ?? '',
      item_role: rest.item_role ?? 'optional',
      depends_on_item_id: rest.depends_on_item_id ?? null,
      sort_order: rest.sort_order ?? 0,
      min_qty: rest.min_qty ?? 1,
      max_qty: rest.max_qty ?? null,
      hinge_type: rest.hinge_type ?? null,
      track_type: rest.track_type ?? null,
      lead_days: rest.lead_days ?? null,
      stock_qty: rest.stock_qty ?? 0,
      subcategory: rest.subcategory ?? null,
      prices: (data ?? []).length
        ? (data ?? []).map(p => ({
            supplier_id: p.supplier_id, color_id: p.color_id,
            website_price: String(p.website_price || ''),
            discount_percent: String(p.discount_percent ?? '0'),
            vat_included: p.vat_included ?? false,
          }))
        : [{ ...EMPTY_PRICE }],
    })
    setEditId(item.id)
    setFormError('')
    setPriceError('')
    setExpandedId(null)
    setFormOpen(true)
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  function cancelForm() {
    setEditId(null)
    setForm(EMPTY_FORM)
    setFormError('')
    setPriceError('')
    setFormOpen(false)
  }

  async function saveForm() {
    if (!form.name.trim()) return
    const valid = form.prices.filter(p => p.supplier_id && p.color_id)
    const keys  = valid.map(p => `${p.supplier_id}-${p.color_id}`)
    if (keys.length !== new Set(keys).size) {
      setPriceError('Дубль: для одного поставщика и цвета цена уже добавлена')
      return
    }
    setPriceError('')
    setFormError('')
    setFormSaving(true)

    try {
      const itemData = {
        name: form.name.trim(),
        article: (form.article ?? '').trim(),
        category: form.category,
        unit: form.unit,
        whip_length: form.whip_length,
        shower_types: form.shower_types,
        photo_url: form.photo_url,
        url: (form.url ?? '').trim(),
        comment: (form.comment ?? ''),
        active: form.active,
        item_role: form.item_role,
        depends_on_item_id: form.depends_on_item_id,
        sort_order: form.sort_order,
        min_qty: form.min_qty,
        max_qty: form.max_qty,
        hinge_type: form.hinge_type,
        track_type: form.track_type,
        lead_days: form.lead_days,
        stock_qty: form.stock_qty,
        subcategory: form.subcategory,
      }

      let itemId: number | null = null
      if (editId !== null) {
        const { error } = await db.current.from('shower_catalog_items').update(itemData).eq('id', editId)
        if (error) throw error
        await db.current.from('shower_catalog_prices').delete().eq('item_id', editId)
        itemId = editId
      } else {
        const { data, error } = await db.current.from('shower_catalog_items').insert(itemData).select('id').single()
        if (error) throw error
        itemId = data?.id ?? null
      }

      if (itemId) {
        const priceRows = valid.filter(p => p.website_price).map(p => {
          const web  = Math.round(Number(p.website_price))
          const disc = Math.round(Number(p.discount_percent) || 0)
          const cost = Math.round(web * (1 - disc / 100))
          return {
            item_id: itemId!, supplier_id: p.supplier_id!, color_id: p.color_id!,
            website_price: web, discount_percent: disc, cost_price: cost,
            vat_included: p.vat_included,
          }
        })
        if (priceRows.length) {
          const { error } = await db.current.from('shower_catalog_prices').insert(priceRows)
          if (error) throw error
        }
      }

      cancelForm()
      await load()
    } catch (e: unknown) {
      const rawMsg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e)
      console.error('[CatalogTab] save error:', rawMsg, e)
      // Показываем понятное сообщение — технические детали только в консоли
      if (rawMsg.includes('column') || rawMsg.includes('schema') || rawMsg.includes('cache')) {
        setFormError('Структура базы данных не обновлена. Обратитесь к администратору.')
      } else if (rawMsg.includes('duplicate') || rawMsg.includes('unique')) {
        setFormError('Не удалось сохранить: такая позиция уже существует. Проверьте артикул.')
      } else if (rawMsg.includes('network') || rawMsg.includes('fetch')) {
        setFormError('Нет соединения с сервером. Проверьте интернет и нажмите «Сохранить позицию» повторно.')
      } else {
        setFormError(`Не удалось сохранить позицию. Данные не потеряны — попробуйте ещё раз. Детали: ${rawMsg}`)
      }
    } finally {
      setFormSaving(false)
    }
  }

  async function toggleActive(id: number, active: boolean) {
    await db.current.from('shower_catalog_items').update({ active: !active }).eq('id', id)
    setItems(prev => prev.map(i => i.id === id ? { ...i, active: !active } : i))
  }

  async function duplicateItem(item: Item) {
    const { id: _, ...rest } = item
    const copy = { ...rest, name: `${rest.name} (копия)`, active: false }
    const { data, error } = await db.current.from('shower_catalog_items').insert(copy).select('id').single()
    if (error || !data) return
    const { data: priceData } = await db.current.from('shower_catalog_prices').select('*').eq('item_id', item.id)
    if (priceData && priceData.length > 0) {
      const newPrices = priceData.map(({ id: __, ...p }) => ({ ...p, item_id: data.id }))
      await db.current.from('shower_catalog_prices').insert(newPrices)
    }
    await load()
  }

  // ── Price matrix (expanded view) ────────────────────────────────────────────
  function startPriceEdit(supId: number, colId: number) {
    const p = prices.find(p => p.supplier_id === supId && p.color_id === colId)
    setEditWebsite(p?.website_price ? String(p.website_price) : '')
    setEditDisc(p?.discount_percent ? String(p.discount_percent) : '0')
    setEditing({ supId, colId })
  }

  async function commitPrice() {
    if (!editing || expandedId === null) return
    const { supId, colId } = editing
    const website  = Number(editWebsite) || 0
    const discount = Number(editDisc) || 0
    const cost     = Math.round(website * (1 - discount / 100))
    setEditing(null)

    const existing = prices.find(p => p.supplier_id === supId && p.color_id === colId)
    const updated: Price = {
      ...existing, item_id: expandedId, supplier_id: supId, color_id: colId,
      website_price: website, discount_percent: discount, cost_price: cost,
      vat_included: existing?.vat_included ?? false,
    }
    setPrices(prev => [...prev.filter(p => !(p.supplier_id === supId && p.color_id === colId)), updated])

    if (existing?.id) {
      await db.current.from('shower_catalog_prices')
        .update({ website_price: website, discount_percent: discount, cost_price: cost })
        .eq('id', existing.id)
    } else {
      const { data } = await db.current.from('shower_catalog_prices')
        .insert({ item_id: expandedId, supplier_id: supId, color_id: colId,
          website_price: website, discount_percent: discount, cost_price: cost, vat_included: false })
        .select('id').single()
      if (data) setPrices(prev => prev.map(p =>
        p.supplier_id === supId && p.color_id === colId ? { ...p, id: data.id } : p))
    }
  }

  async function addNewSupplier(forItemId: number) {
    if (!newSupName.trim()) return
    const { data } = await db.current.from('shower_hw_suppliers')
      .insert({ name: newSupName.trim().toUpperCase() }).select('*').single()
    if (data) { onRefreshSuppliers(); setSupDropOpen(false); setNewSupName('') }
  }

  const activeColors        = colors.filter(c => c.active)
  const supplierIdsInMatrix = [...new Set(prices.map(p => p.supplier_id))]
  const availableForAdd     = suppliers.filter(s => !new Set(supplierIdsInMatrix).has(s.id))

  const filtered = items.filter(item => {
    if (filterCat !== 'all' && item.category !== filterCat) return false
    if (filterType && !item.shower_types.includes(filterType)) return false
    if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="space-y-4">

      {/* ── Unified Add / Edit form ── */}
      <div ref={formRef} className={`rounded-xl border overflow-hidden ${editId !== null ? 'border-blue-300' : 'border-[#e4e4e0]'} bg-white`}>
        <button onClick={() => { if (editId !== null) return; setFormOpen(v => !v) }}
          className={`w-full flex items-center justify-between px-5 py-3.5 transition-colors ${editId !== null ? 'bg-blue-50 cursor-default' : 'hover:bg-[#fafaf9]'}`}>
          <span className={`text-[12px] font-bold uppercase tracking-widest ${editId !== null ? 'text-blue-700' : 'text-[#111110]'}`}>
            {editId !== null ? 'Редактирование позиции' : '+ Добавить позицию'}
          </span>
          {editId === null && (
            <svg className={`w-3.5 h-3.5 text-[#9a9a95] transition-transform ${formOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </button>

        {formOpen && (
          <div className="px-5 pb-6 pt-4 border-t border-[#f0f0ec] space-y-5">

            {/* Блок 1: Основная информация */}
            <div>
              <p className="lbl mb-3">Основная информация</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="col-span-2">
                  <label className="lbl">Наименование</label>
                  <input value={form.name} onChange={e => setFF('name', e.target.value)}
                    placeholder="П-профиль, Петля, Ручка-скоба..." className="inp" />
                </div>
                <div>
                  <label className="lbl">Артикул</label>
                  <input value={form.article} onChange={e => setFF('article', e.target.value)}
                    placeholder="AB-123" className="inp" />
                </div>
                <div>
                  <label className="lbl">Категория</label>
                  <select value={form.category} onChange={e => setFF('category', e.target.value)} className="inp">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="lbl">Ед. изм.</label>
                  <select value={form.unit} onChange={e => setFF('unit', e.target.value)} className="inp">
                    {UNITS.map(u => <option key={u}>{u}</option>)}
                  </select>
                </div>
                {(form.unit === 'хлыст' || form.unit === 'м.п.') && (
                  <div>
                    <label className="lbl">Длина (мм)</label>
                    <input type="number" value={form.whip_length ?? ''} placeholder="3000"
                      onChange={e => setFF('whip_length', e.target.value ? Number(e.target.value) : null)} className="inp" />
                  </div>
                )}
                <div className="col-span-2">
                  <label className="lbl">Ссылка на товар</label>
                  <input value={form.url} onChange={e => setFF('url', e.target.value)}
                    placeholder="https://..." className="inp" />
                </div>
                <div className="col-span-2">
                  <label className="lbl">Комментарий</label>
                  <input value={form.comment} onChange={e => setFF('comment', e.target.value)} className="inp" />
                </div>
              </div>
            </div>

            {/* Блок 2: Где используется */}
            <div>
              <p className="lbl mb-2">Где используется</p>
              <div className="flex flex-wrap gap-2">
                {SHOWER_TYPES.map(t => (
                  <label key={t.v} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border cursor-pointer text-[12px] font-medium transition-colors ${
                    form.shower_types.includes(t.v)
                      ? 'bg-blue-100 border-blue-300 text-blue-800'
                      : 'bg-white border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f8f8f7]'
                  }`}>
                    <input type="checkbox" className="hidden" checked={form.shower_types.includes(t.v)} onChange={() => toggleST(t.v)} />
                    {t.l}
                  </label>
                ))}
              </div>
            </div>

            {/* Блок 3: Поведение в калькуляторе */}
            <div>
              <p className="lbl mb-3">Поведение в калькуляторе</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

                <div>
                  <label className="lbl">Роль позиции</label>
                  <select value={form.item_role} onChange={e => setFF('item_role', e.target.value as FormState['item_role'])} className="inp">
                    <option value="optional">Опциональная</option>
                    <option value="required">Обязательная</option>
                    <option value="addon">Дополнение (зависит от другой)</option>
                  </select>
                </div>

                {form.item_role === 'addon' && (
                  <div>
                    <label className="lbl">Зависит от позиции (ID)</label>
                    <select value={form.depends_on_item_id ?? ''} onChange={e => setFF('depends_on_item_id', e.target.value ? Number(e.target.value) : null)} className="inp">
                      <option value="">— не выбрано —</option>
                      {items.filter(i => i.id !== editId).map(i => (
                        <option key={i.id} value={i.id}>{i.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="lbl">Порядок (sort_order)</label>
                  <input type="number" value={form.sort_order} onChange={e => setFF('sort_order', Number(e.target.value) || 0)}
                    placeholder="0" className="inp" />
                </div>

                <div>
                  <label className="lbl">Мин. кол-во</label>
                  <input type="number" min="1" value={form.min_qty} onChange={e => setFF('min_qty', Math.max(1, Number(e.target.value) || 1))}
                    className="inp" />
                </div>

                <div>
                  <label className="lbl">Макс. кол-во</label>
                  <input type="number" min="1" value={form.max_qty ?? ''} onChange={e => setFF('max_qty', e.target.value ? Number(e.target.value) : null)}
                    placeholder="без лимита" className="inp" />
                </div>

                <div>
                  <label className="lbl">Срок поставки (дней)</label>
                  <input type="number" min="0" value={form.lead_days ?? ''} onChange={e => setFF('lead_days', e.target.value ? Number(e.target.value) : null)}
                    placeholder="напр. 14" className="inp" />
                </div>

                <div>
                  <label className="lbl">Остаток на складе</label>
                  <input type="number" min="0" value={form.stock_qty} onChange={e => setFF('stock_qty', Math.max(0, Number(e.target.value) || 0))}
                    placeholder="0" className="inp" />
                </div>

                {SUBCATEGORIES[form.category] && (
                  <div>
                    <label className="lbl">Подкатегория</label>
                    <select value={form.subcategory ?? ''} onChange={e => setFF('subcategory', e.target.value || null)} className="inp">
                      <option value="">— без подкатегории —</option>
                      {SUBCATEGORIES[form.category].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                )}

                {/* Тип петель — только для петель распашной */}
                {form.category === 'петли' && form.shower_types.includes('swing') && (
                  <div>
                    <label className="lbl">Тип петель</label>
                    <select value={form.hinge_type ?? ''} onChange={e => setFF('hinge_type', (e.target.value || null) as FormState['hinge_type'])} className="inp">
                      <option value="">— любой —</option>
                      <option value="wall-glass">Стена — стекло</option>
                      <option value="glass-glass">Стекло — стекло</option>
                    </select>
                  </div>
                )}

                {/* Тип трека — для раздвижной */}
                {form.shower_types.includes('sliding') && (
                  <div>
                    <label className="lbl">Тип трека</label>
                    <select value={form.track_type ?? ''} onChange={e => setFF('track_type', (e.target.value || null) as FormState['track_type'])} className="inp">
                      <option value="">— любой —</option>
                      <option value="open">Открытый</option>
                      <option value="closed">Закрытый</option>
                    </select>
                  </div>
                )}

              </div>
            </div>

            {/* Блок 4: Фото */}
            <div>
              <p className="lbl mb-2">Фото</p>
              <ImagePicker value={form.photo_url} category={form.category} onChange={url => setFF('photo_url', url)} />
            </div>

            {/* Блок 5: Цены */}
            <div>
              <p className="lbl mb-2">Цены по поставщикам и цветам</p>
              <PriceRowsTable
                rows={form.prices} suppliers={suppliers} colors={colors}
                onSet={setFormPriceCell} onAdd={addFormPrice} onRemove={removeFormPrice}
                error={priceError}
              />
            </div>

            {/* Блок 6: Статус */}
            <div>
              <p className="lbl mb-2">Статус</p>
              <label className="flex items-center gap-2 cursor-pointer text-[13px] text-[#4b4b47]">
                <input type="checkbox" checked={form.active} onChange={e => setFF('active', e.target.checked)} className="w-4 h-4 rounded accent-blue-600" />
                Позиция активна
              </label>
            </div>

            {/* Ошибка сохранения — видна перед кнопками */}
            {formError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-[12px] text-red-700 font-medium leading-snug">{formError}</p>
              </div>
            )}

            {/* Кнопки */}
            <div className="flex items-center justify-between pt-1">
              {editId !== null ? (
                <button onClick={cancelForm}
                  className="border border-[#e4e4e0] text-[#4b4b47] text-[13px] px-5 py-2 rounded-lg hover:bg-[#f0f0ec]">
                  Отмена
                </button>
              ) : (
                <button onClick={cancelForm}
                  className="text-[13px] text-[#9a9a95] hover:text-[#4b4b47] px-2 py-2">
                  Очистить
                </button>
              )}
              <button onClick={saveForm} disabled={formSaving || !form.name.trim()}
                className={`text-white text-[13px] font-semibold px-6 py-2 rounded-lg disabled:opacity-40 transition-colors ${
                  editId !== null ? 'bg-blue-600 hover:bg-blue-700' : 'bg-[#111110] hover:bg-[#2a2a28]'
                }`}>
                {formSaving ? 'Сохранение...' : editId !== null ? 'Сохранить изменения' : 'Сохранить позицию'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск..."
          className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110] w-44 bg-white" />
        {['all', ...CATEGORIES].map(c => (
          <button key={c} onClick={() => setFilterCat(c)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium capitalize ${filterCat === c ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#6b6b66]'}`}>
            {c === 'all' ? 'Все' : c}
          </button>
        ))}
        <span className="mx-1 text-[#e4e4e0]">|</span>
        {SHOWER_TYPES.map(t => (
          <button key={t.v} onClick={() => setFilterType(filterType === t.v ? '' : t.v)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${filterType === t.v ? 'bg-blue-600 text-white' : 'bg-white border border-[#e4e4e0] text-[#6b6b66]'}`}>
            {t.l}
          </button>
        ))}
      </div>

      {/* ── Items list ── */}
      <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-[#9a9a95] text-[13px]">Загрузка...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-[#9a9a95] text-[13px]">Нет позиций</div>
        ) : filtered.map(item => (
          <div key={item.id} className={`border-b border-[#f0f0ec] last:border-0 ${!item.active ? 'opacity-50' : ''}`}>

            {/* Row header */}
            <div onClick={() => toggleExpand(item.id)}
              className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#fafaf9] ${expandedId === item.id ? 'bg-blue-50 border-b border-blue-100' : ''}`}>
              <svg className={`w-3.5 h-3.5 text-[#9a9a95] flex-shrink-0 transition-transform ${expandedId === item.id ? 'rotate-90' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
              {item.photo_url ? (
                <img src={item.photo_url} alt="" className="w-9 h-9 object-cover rounded-lg border border-[#e4e4e0] flex-shrink-0" />
              ) : (
                <div className="w-9 h-9 bg-[#f5f5f3] rounded-lg flex-shrink-0 border border-dashed border-[#e4e4e0]" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-[#111110]">{item.name}</span>
                  {item.article && <span className="text-[11px] font-mono text-[#9a9a95]">{item.article}</span>}
                  {item.url && (
                    <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                      className="text-[11px] text-blue-500 hover:text-blue-700 hover:underline flex items-center gap-0.5">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      ссылка
                    </a>
                  )}
                  <span className="text-[10px] bg-[#f0f0ec] text-[#6b6b66] px-1.5 py-0.5 rounded">{item.category}</span>
                  <span className="text-[11px] text-[#9a9a95]">{item.unit}{item.whip_length ? ` ${item.whip_length}мм` : ''}</span>
                </div>
                {(item.shower_types.length > 0 || item.hinge_type || item.track_type || item.item_role !== 'optional') && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {item.shower_types.map(t => (
                      <span key={t} className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">
                        {SHOWER_TYPES.find(st => st.v === t)?.l ?? t}
                      </span>
                    ))}
                    {item.hinge_type && (
                      <span className="text-[10px] bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded-full">
                        {item.hinge_type === 'wall-glass' ? 'стена—стекло' : 'стекло—стекло'}
                      </span>
                    )}
                    {item.track_type && (
                      <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-full">
                        {item.track_type === 'open' ? 'открытый трек' : 'закрытый трек'}
                      </span>
                    )}
                    {item.item_role === 'required' && (
                      <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">обяз.</span>
                    )}
                    {item.item_role === 'addon' && (
                      <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full">доп.</span>
                    )}
                    {item.lead_days && (
                      <span className="text-[10px] bg-[#f5f5f3] text-[#6b6b66] px-1.5 py-0.5 rounded-full">{item.lead_days} дн.</span>
                    )}
                    {item.subcategory && (
                      <span className="text-[10px] bg-[#f0f0ec] text-[#6b6b66] px-1.5 py-0.5 rounded-full">{item.subcategory}</span>
                    )}
                    {item.stock_qty > 0 && (
                      <span className="text-[10px] bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded-full font-medium">склад: {item.stock_qty}</span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                <button onClick={() => startEdit(item)} className="text-[12px] font-semibold text-blue-600 hover:text-blue-800">Изм.</button>
                <button onClick={() => duplicateItem(item)} className="text-[12px] text-[#9a9a95] hover:text-[#4b4b47]" title="Дублировать позицию">Дубль</button>
                <button onClick={() => toggleActive(item.id, item.active)} className="text-[12px] text-[#9a9a95] hover:text-[#6b6b66]">
                  {item.active ? 'Скрыть' : 'Показать'}
                </button>
              </div>
            </div>

            {/* Expanded: price matrix */}
            {expandedId === item.id && (
              <div className="px-4 pb-5 pt-3 bg-[#fafaf9]">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[#8a8a85]">Цены: поставщик × цвет</p>
                  <div className="relative">
                    <button onClick={() => setSupDropOpen(v => !v)}
                      className="text-[12px] font-semibold text-blue-600 hover:text-blue-800 px-2 py-0.5 rounded hover:bg-blue-50">
                      + поставщик
                    </button>
                    {supDropOpen && (
                      <div className="absolute right-0 top-full mt-1 bg-white border border-[#e4e4e0] rounded-xl shadow-xl z-30 p-1.5 min-w-[190px]">
                        {availableForAdd.length === 0 && !newSupName && (
                          <p className="px-3 py-1.5 text-[12px] text-[#9a9a95]">Все поставщики добавлены</p>
                        )}
                        {availableForAdd.map(s => (
                          <button key={s.id} onClick={() => { startPriceEdit(s.id, activeColors[0]?.id); setSupDropOpen(false) }}
                            className="w-full text-left px-3 py-1.5 text-[13px] text-[#111110] hover:bg-[#f8f8f7] rounded-lg">
                            {s.name}
                          </button>
                        ))}
                        <div className="border-t border-[#f0f0ec] mt-1 pt-1 px-1">
                          <input value={newSupName} onChange={e => setNewSupName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && addNewSupplier(item.id)}
                            placeholder="Новый поставщик" autoFocus
                            className="w-full border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] outline-none focus:border-blue-400" />
                          <button onClick={() => addNewSupplier(item.id)}
                            className="mt-1 w-full bg-[#111110] text-white px-2 py-1.5 rounded-lg text-[12px] font-medium">
                            + Добавить
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {supplierIdsInMatrix.length === 0 ? (
                  <p className="text-[12px] text-[#b0b0ab] italic">Нажмите «+ поставщик» для добавления цен</p>
                ) : (
                  <div className="overflow-x-auto">
                    <div style={{ minWidth: 130 + activeColors.length * 108 }}>
                      <div className="flex bg-[#f2f2f0] border border-[#e4e4e0] rounded-t-lg border-b-0">
                        <div className="px-3 py-2 text-[10px] font-bold text-[#6b6b66] uppercase border-r border-[#e4e4e0]" style={{ width: 130 }}>
                          Поставщик
                        </div>
                        {activeColors.map(c => (
                          <div key={c.id} className="px-1 py-2 text-[9px] font-bold text-[#6b6b66] uppercase text-center leading-tight border-r border-[#e4e4e0] last:border-0"
                            style={{ width: 108 }}>
                            {c.name}
                          </div>
                        ))}
                      </div>
                      {supplierIdsInMatrix.map((supId, idx) => {
                        const sup = suppliers.find(s => s.id === supId)
                        return (
                          <div key={supId} className={`flex border border-[#e4e4e0] border-t-0 ${idx === supplierIdsInMatrix.length - 1 ? 'rounded-b-lg' : ''} hover:bg-[#f8f8f7]`}>
                            <div className="px-3 py-2 text-[13px] font-semibold text-[#111110] border-r border-[#e4e4e0] flex items-center" style={{ width: 130 }}>
                              {sup?.name ?? '?'}
                            </div>
                            {activeColors.map(color => {
                              const p    = prices.find(p => p.supplier_id === supId && p.color_id === color.id)
                              const isEd = editing?.supId === supId && editing?.colId === color.id
                              return (
                                <div key={color.id} className="border-r border-[#e4e4e0] last:border-0" style={{ width: 108 }}>
                                  {isEd ? (
                                    <div className="flex flex-col gap-0.5 px-1.5 py-1.5 bg-blue-50 h-full">
                                      <div className="flex items-center gap-1">
                                        <span className="text-[9px] text-[#9a9a95] w-8 flex-shrink-0">сайт</span>
                                        <input ref={editRef} type="number" value={editWebsite}
                                          onChange={e => setEditWebsite(e.target.value)}
                                          onBlur={commitPrice}
                                          onKeyDown={e => { if (e.key === 'Enter') commitPrice(); if (e.key === 'Escape') setEditing(null) }}
                                          className="flex-1 w-0 border border-blue-300 rounded px-1 py-0.5 text-[11px] outline-none" />
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <span className="text-[9px] text-[#9a9a95] w-8 flex-shrink-0">скид.</span>
                                        <input type="number" value={editDisc}
                                          onChange={e => setEditDisc(e.target.value)}
                                          onKeyDown={e => { if (e.key === 'Enter') commitPrice(); if (e.key === 'Escape') setEditing(null) }}
                                          className="flex-1 w-0 border border-blue-300 rounded px-1 py-0.5 text-[11px] outline-none" />
                                        <span className="text-[9px] text-[#9a9a95]">%</span>
                                      </div>
                                      <div className="text-[10px] font-mono font-bold text-emerald-700 text-center">
                                        = {Math.round((Number(editWebsite)||0)*(1-(Number(editDisc)||0)/100)).toLocaleString('ru-RU')} ₽
                                      </div>
                                    </div>
                                  ) : (
                                    <button onClick={() => startPriceEdit(supId, color.id)}
                                      className={`w-full h-full min-h-[52px] px-1 py-1.5 text-center hover:bg-blue-50 transition-colors flex flex-col items-center justify-center gap-0.5 ${p?.cost_price ? '' : 'opacity-40 hover:opacity-100'}`}>
                                      {p?.cost_price ? (
                                        <>
                                          <span className="text-[12px] font-mono font-semibold text-[#111110]">{p.cost_price.toLocaleString('ru-RU')}</span>
                                          {p.discount_percent > 0 && <span className="text-[9px] text-[#9a9a95]">−{p.discount_percent}%</span>}
                                          {p.vat_included && <span className="text-[8px] text-emerald-600 font-bold">НДС</span>}
                                        </>
                                      ) : <span className="text-[13px] text-[#d4d4d0]">—</span>}
                                    </button>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <style>{`.lbl{display:block;font-size:11px;font-weight:700;color:#8a8a85;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px}.inp{width:100%;background:white;border:1px solid #e4e4e0;border-radius:8px;padding:8px 12px;font-size:13px;color:#111110;outline:none}.inp:focus{border-color:#111110}`}</style>
    </div>
  )
}
