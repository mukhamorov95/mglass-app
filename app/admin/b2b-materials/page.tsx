'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { B2BMaterial, B2B_CATEGORIES, type PatternDirection } from '@/lib/types'
import { TEMPERING_COST } from '@/lib/b2bCalculator'

const VAT = 22

const PATTERN_OPTIONS: { value: PatternDirection; label: string }[] = [
  { value: 'none',         label: 'Нет направления' },
  { value: 'along_length', label: 'Волна по длине (3210)' },
  { value: 'along_width',  label: 'Волна по ширине (2250)' },
]

type SupplierOption = { id: string; name: string }

type SheetVariant = {
  id: number
  material_id: number
  sheet_width: number
  sheet_height: number
  supplier_id: string | null
  supplier_material_name: string | null
  is_default: boolean
  active: boolean
  sort_order: number
}

const EMPTY: Omit<B2BMaterial, 'id' | 'created_at'> = {
  name: '', category: 'стекло', thickness: 6, cost_price: 0, sale_price: 0,
  vat_rate: 22, waste_percent: 15, passthrough: false, active: true, notes: null,
  sheet_width: 3210, sheet_height: 2250, pattern_direction: 'none',
  supplier_id: null, supplier_material_name: null, stock_sheets: 0,
}

function parseNotes(m: B2BMaterial): B2BMaterial {
  try {
    if (m.notes) {
      const parsed = JSON.parse(m.notes)
      return {
        ...m,
        sale_price: parsed?.sale_price ?? 0,
        passthrough: parsed?.passthrough ?? false,
        sheet_width: m.sheet_width ?? 3210,
        sheet_height: m.sheet_height ?? 2250,
        pattern_direction: m.pattern_direction ?? 'none',
      }
    }
  } catch {}
  return { ...m, sale_price: 0, passthrough: false, sheet_width: m.sheet_width ?? 3210, sheet_height: m.sheet_height ?? 2250, pattern_direction: m.pattern_direction ?? 'none' }
}

// Себестоимость на 1 м² нетто: закупка с отходом + закалка (для не-зеркал)
function calcCostPerM2(m: B2BMaterial): number {
  const waste = m.passthrough ? 10 : m.waste_percent
  const material = m.cost_price * (1 + waste / 100)
  const tempering = m.category !== 'зеркало' ? (TEMPERING_COST[m.thickness] ?? 0) : 0
  return material + tempering
}

function calcMargin(m: B2BMaterial): { pct: number; rub: number } | null {
  const sp = m.sale_price ?? 0
  if (sp <= 0 || m.cost_price <= 0) return null
  const cost = calcCostPerM2(m)
  const pct = Math.round((sp - cost) / sp * 100)
  const rub = Math.round((sp - cost) / (1 + VAT / 100))
  return { pct, rub }
}

const THICKNESS_OPTIONS = [3, 4, 5, 6, 8, 10, 12]

export default function B2BMaterialsPage() {
  const [items, setItems] = useState<B2BMaterial[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterCat, setFilterCat] = useState<string>('all')
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  const [sheetVariants, setSheetVariants] = useState<Record<number, SheetVariant[]>>({})
  const [newVariantWidth, setNewVariantWidth] = useState(3210)
  const [newVariantHeight, setNewVariantHeight] = useState(2250)

  useEffect(() => {
    load()
    createClient()
      .from('suppliers')
      .select('id, name, status')
      .neq('status', 'inactive')
      .eq('supplier_type', 'glass_mirror')
      .order('name')
      .then(({ data }) => setSuppliers((data ?? []) as SupplierOption[]))
  }, [])

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const [{ data, error }, { data: varData }] = await Promise.all([
      supabase.from('b2b_materials').select('*').order('name').order('thickness'),
      supabase.from('b2b_material_sheet_variants').select('*').order('sort_order').order('id'),
    ])
    if (error) setError(error.message)
    else {
      setItems((data ?? []).map(parseNotes))
      const grouped: Record<number, SheetVariant[]> = {}
      for (const v of (varData ?? []) as SheetVariant[]) {
        if (!grouped[v.material_id]) grouped[v.material_id] = []
        grouped[v.material_id].push(v)
      }
      setSheetVariants(grouped)
    }
    setLoading(false)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const salePrice = Number(form.sale_price) || 0
    const { sale_price: _sp, passthrough: _pt, ...rest } = form
    const notesObj: Record<string, unknown> = {}
    if (salePrice > 0) notesObj.sale_price = salePrice
    if (form.passthrough) notesObj.passthrough = true
    const payload = {
      ...rest,
      cost_price: Number(form.cost_price),
      vat_rate: Number(form.vat_rate),
      waste_percent: form.passthrough ? 10 : Number(form.waste_percent),
      thickness: Number(form.thickness),
      sheet_width: Number(form.sheet_width) || 3210,
      sheet_height: Number(form.sheet_height) || 2250,
      pattern_direction: form.pattern_direction ?? 'none',
      stock_sheets: Number(form.stock_sheets) || 0,
      notes: Object.keys(notesObj).length > 0 ? JSON.stringify(notesObj) : null,
    }
    if (editingId !== null) {
      const { error } = await supabase.from('b2b_materials').update(payload).eq('id', editingId)
      if (error) { setError(error.message); setSaving(false); return }
      setEditingId(null)
    } else {
      const { error } = await supabase.from('b2b_materials').insert(payload)
      if (error) { setError(error.message); setSaving(false); return }
    }
    setForm(EMPTY)
    await load()
    setSaving(false)
  }

  async function toggleActive(id: number, active: boolean) {
    const supabase = createClient()
    await supabase.from('b2b_materials').update({ active: !active }).eq('id', id)
    await load()
  }

  async function deleteItem(id: number, name: string, thickness: number) {
    if (!confirm(`Удалить «${name} ${thickness}мм»?\nЭто действие нельзя отменить.`)) return
    const supabase = createClient()
    await supabase.from('b2b_materials').delete().eq('id', id)
    await load()
  }

  function startEdit(m: B2BMaterial) {
    setEditingId(m.id)
    setForm({
      name: m.name, category: m.category, thickness: m.thickness,
      cost_price: m.cost_price, sale_price: m.sale_price ?? 0,
      vat_rate: m.vat_rate, waste_percent: m.waste_percent,
      passthrough: m.passthrough ?? false,
      active: m.active, notes: m.notes,
      sheet_width: m.sheet_width ?? 3210,
      sheet_height: m.sheet_height ?? 2250,
      pattern_direction: m.pattern_direction ?? 'none',
      supplier_id: m.supplier_id ?? null,
      supplier_material_name: m.supplier_material_name ?? null,
      stock_sheets: m.stock_sheets ?? 0,
    })
    setError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function addSheetVariant(materialId: number) {
    if (!newVariantWidth || !newVariantHeight) return
    const sb = createClient()
    const existing = sheetVariants[materialId] ?? []
    const isFirst = existing.filter(v => v.active).length === 0
    const { data, error } = await sb
      .from('b2b_material_sheet_variants')
      .insert({ material_id: materialId, sheet_width: newVariantWidth, sheet_height: newVariantHeight, is_default: isFirst })
      .select()
      .single()
    if (error) { setError(error.message); return }
    setSheetVariants(sv => ({ ...sv, [materialId]: [...(sv[materialId] ?? []), data as SheetVariant] }))
  }

  async function setDefaultSheetVariant(materialId: number, variantId: number) {
    const sb = createClient()
    await sb.from('b2b_material_sheet_variants').update({ is_default: false }).eq('material_id', materialId)
    const { error } = await sb.from('b2b_material_sheet_variants').update({ is_default: true }).eq('id', variantId)
    if (error) { setError(error.message); return }
    setSheetVariants(sv => ({
      ...sv,
      [materialId]: (sv[materialId] ?? []).map(v => ({ ...v, is_default: v.id === variantId })),
    }))
  }

  async function toggleSheetVariantActive(materialId: number, variant: SheetVariant) {
    const sb = createClient()
    const update: { active: boolean; is_default?: boolean } = { active: !variant.active }
    if (variant.is_default && variant.active) update.is_default = false
    const { error } = await sb.from('b2b_material_sheet_variants').update(update).eq('id', variant.id)
    if (error) { setError(error.message); return }
    setSheetVariants(sv => ({
      ...sv,
      [materialId]: (sv[materialId] ?? []).map(v => v.id === variant.id ? { ...v, ...update } : v),
    }))
  }

  function handleCategoryChange(cat: string) {
    const catInfo = B2B_CATEGORIES.find(c => c.value === cat)
    setForm(f => ({ ...f, category: cat, waste_percent: f.passthrough ? 10 : (catInfo?.wasteDefault ?? f.waste_percent) }))
  }

  const filtered = filterCat === 'all' ? items : items.filter(i => i.category === filterCat)

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-ink tracking-tight">B2B Материалы</h1>
        <p className="text-[13px] text-muted mt-0.5">{items.filter(i => i.active).length} активных позиций</p>
      </div>

      <div className={`rounded-xl border p-5 mb-8 transition-all ${editingId !== null ? 'bg-blue-50 border-blue-200' : 'bg-surface border-line'}`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            {editingId !== null ? `Редактировать — ID ${editingId}` : 'Добавить материал'}
          </h2>
          {editingId !== null && (
            <span className="text-[11px] font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-md">Режим редактирования</span>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="col-span-2">
            <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-1.5">Название</label>
            <input
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] text-ink outline-none focus:border-ink transition-all"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="М1 прозрачное"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-1.5">Категория</label>
            <select
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] text-ink outline-none focus:border-ink transition-all"
              value={form.category}
              onChange={e => handleCategoryChange(e.target.value)}>
              {B2B_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-1.5">Толщина (мм)</label>
            <select
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] font-mono text-ink outline-none focus:border-ink transition-all"
              value={form.thickness}
              onChange={e => setForm({ ...form, thickness: Number(e.target.value) })}>
              {THICKNESS_OPTIONS.map(t => <option key={t} value={t}>{t} мм</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-1.5">Цена продажи (₽/м²)</label>
            <input type="number" min="0"
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] font-mono text-ink outline-none focus:border-ink transition-all"
              value={form.sale_price}
              onChange={e => setForm({ ...form, sale_price: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-1.5">Закупка материала (₽/м²)</label>
            <input type="number" min="0"
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] font-mono text-ink outline-none focus:border-ink transition-all"
              value={form.cost_price}
              onChange={e => setForm({ ...form, cost_price: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-1.5">НДС (%)</label>
            <input type="number" min="0" max="100"
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] font-mono text-ink outline-none focus:border-ink transition-all"
              value={form.vat_rate}
              onChange={e => setForm({ ...form, vat_rate: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-1.5">
              Отход (%)
              {form.passthrough && <span className="ml-1 text-orange-500 normal-case font-normal">фикс. 10%</span>}
            </label>
            <input type="number" min="0" max="100"
              disabled={form.passthrough}
              className={`w-full border rounded-lg px-3 py-2 text-[14px] font-mono text-ink outline-none transition-all ${form.passthrough ? 'bg-canvas border-line text-muted cursor-not-allowed' : 'bg-surface border-line focus:border-ink'}`}
              value={form.passthrough ? 10 : form.waste_percent}
              onChange={e => setForm({ ...form, waste_percent: Number(e.target.value) })}
            />
          </div>

          <div className="col-span-2 flex items-center gap-3 pt-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox"
                checked={form.passthrough}
                onChange={e => setForm(f => ({ ...f, passthrough: e.target.checked, waste_percent: e.target.checked ? 10 : f.waste_percent }))}
                className="w-4 h-4 accent-orange-500"
              />
              <span className="text-[13px] font-medium text-ink">Проходной материал</span>
              <span className="text-[11px] text-muted">— отход всегда 10%</span>
            </label>
          </div>

          {/* Раскрой */}
          <div className="col-span-2">
            <div className="text-[11px] font-semibold text-muted uppercase tracking-widest mb-2 pt-1 border-t border-line-soft mt-1">
              Раскрой листа
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] text-muted mb-1">Длина листа, мм</label>
                <input type="number" min="100" max="9000"
                  className="w-full border border-line rounded-lg px-3 py-2 text-[13px] font-mono text-ink outline-none focus:border-ink"
                  value={form.sheet_width ?? 3210}
                  onChange={e => setForm(f => ({ ...f, sheet_width: Number(e.target.value) }))}
                />
              </div>
              <div>
                <label className="block text-[11px] text-muted mb-1">Ширина листа, мм</label>
                <input type="number" min="100" max="9000"
                  className="w-full border border-line rounded-lg px-3 py-2 text-[13px] font-mono text-ink outline-none focus:border-ink"
                  value={form.sheet_height ?? 2250}
                  onChange={e => setForm(f => ({ ...f, sheet_height: Number(e.target.value) }))}
                />
              </div>
              <div>
                <label className="block text-[11px] text-muted mb-1">Направление рисунка</label>
                <select
                  className="w-full border border-line rounded-lg px-3 py-2 text-[13px] text-ink outline-none focus:border-ink bg-surface"
                  value={form.pattern_direction ?? 'none'}
                  onChange={e => setForm(f => ({ ...f, pattern_direction: e.target.value as PatternDirection }))}
                >
                  {PATTERN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-muted mb-1">Остаток на складе, листов</label>
              <input type="number" min="0" step="0.5"
                className="w-40 border border-line rounded-lg px-3 py-2 text-[13px] font-mono text-ink outline-none focus:border-ink"
                value={form.stock_sheets ?? 0}
                onChange={e => setForm(f => ({ ...f, stock_sheets: Number(e.target.value) }))}
              />
            </div>
          </div>

          {/* Поставщик */}
          <div className="col-span-4">
            <div className="text-[11px] font-semibold text-muted uppercase tracking-widest mb-2 pt-1 border-t border-line-soft mt-1">
              Поставщик
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-muted mb-1">Поставщик</label>
                <div className="flex gap-1.5">
                  <select
                    className="flex-1 bg-surface border border-line rounded-lg px-3 py-2 text-[13px] text-ink outline-none focus:border-ink transition-all"
                    value={form.supplier_id ?? ''}
                    onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value || null }))}>
                    <option value="">— не выбран —</option>
                    {form.supplier_id && !suppliers.find(s => s.id === form.supplier_id) && (
                      <option value={form.supplier_id}>⚠ Текущий поставщик (не тип Стекло и зеркала)</option>
                    )}
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <a href="/admin/suppliers" target="_blank"
                    className="flex items-center px-2 py-2 text-[12px] text-[#0071e3] border border-line rounded-lg hover:bg-[#f0f7ff] transition-colors whitespace-nowrap"
                    title="Добавить поставщика">+ поставщик</a>
                </div>
                {suppliers.length === 0 && (
                  <p className="text-[11px] text-amber-600 mt-1.5">
                    Нет поставщиков типа «Стекло и зеркала».{' '}
                    <a href="/admin/suppliers" target="_blank" className="underline">Назначьте тип поставщика</a>.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-[11px] text-muted mb-1">Наименование у поставщика</label>
                <input
                  className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[13px] text-ink outline-none focus:border-ink transition-all"
                  value={form.supplier_material_name ?? ''}
                  onChange={e => setForm(f => ({ ...f, supplier_material_name: e.target.value || null }))}
                  placeholder="Как называется у поставщика"
                />
              </div>
            </div>
          </div>

          {/* Форматы листов */}
          {editingId !== null && (
            <div className="col-span-4">
              <div className="text-[11px] font-semibold text-muted uppercase tracking-widest mb-2 pt-1 border-t border-line-soft mt-1">
                Форматы листов
              </div>
              <p className="text-[11px] text-amber-600 mb-2">
                Расчёты пока используют основной формат из полей материала. Варианты форматов будут подключены в следующем этапе (закупка, раскрой).
              </p>
              {(sheetVariants[editingId] ?? []).length === 0 ? (
                <p className="text-[12px] text-muted mb-2">Нет добавленных форматов</p>
              ) : (
                <div className="space-y-1 mb-3">
                  {(sheetVariants[editingId] ?? []).map(v => (
                    <div key={v.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${v.active ? 'bg-surface border-line' : 'bg-canvas border-line opacity-50'}`}>
                      <span className="font-mono text-[13px] text-ink flex-1">{v.sheet_width} × {v.sheet_height} мм</span>
                      {v.is_default && v.active
                        ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-600">основной</span>
                        : v.active && (
                          <button onClick={() => setDefaultSheetVariant(editingId, v.id)}
                            className="text-[11px] text-blue-500 hover:text-blue-700 transition-colors">сделать основным</button>
                        )
                      }
                      <button onClick={() => toggleSheetVariantActive(editingId, v)}
                        className="text-[11px] text-muted hover:text-ink-soft transition-colors">
                        {v.active ? 'скрыть' : 'показать'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <div>
                  <label className="block text-[11px] text-muted mb-1">Длина, мм</label>
                  <input type="number" min="100" max="9000"
                    className="w-24 border border-line rounded-lg px-3 py-1.5 text-[13px] font-mono text-ink outline-none focus:border-ink"
                    value={newVariantWidth}
                    onChange={e => setNewVariantWidth(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-muted mb-1">Ширина, мм</label>
                  <input type="number" min="100" max="9000"
                    className="w-24 border border-line rounded-lg px-3 py-1.5 text-[13px] font-mono text-ink outline-none focus:border-ink"
                    value={newVariantHeight}
                    onChange={e => setNewVariantHeight(Number(e.target.value))}
                  />
                </div>
                <button
                  onClick={() => addSheetVariant(editingId)}
                  disabled={!newVariantWidth || !newVariantHeight}
                  className="bg-ink text-white text-[12px] font-medium px-3 py-1.5 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
                  + Добавить формат
                </button>
              </div>
            </div>
          )}

          <div className="col-span-2">
            <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-1.5">Примечание</label>
            <input
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] text-ink outline-none focus:border-ink transition-all"
              value={(() => { try { const n = JSON.parse(form.notes ?? '{}'); return n.comment ?? '' } catch { return form.notes ?? '' } })()}
              onChange={e => {
                try {
                  const n = JSON.parse(form.notes ?? '{}')
                  setForm({ ...form, notes: JSON.stringify({ ...n, comment: e.target.value || undefined }) })
                } catch {
                  setForm({ ...form, notes: e.target.value || null })
                }
              }}
              placeholder="Необязательно"
            />
          </div>
        </div>

        {error && <p className="mt-3 text-[13px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        <div className="flex gap-2 mt-4">
          <button onClick={handleSave} disabled={saving || !form.name.trim()}
            className="bg-ink text-white text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
            {saving ? 'Сохранение...' : editingId !== null ? 'Сохранить' : 'Добавить'}
          </button>
          {editingId !== null && (
            <button onClick={() => { setEditingId(null); setForm(EMPTY); setError(null) }}
              className="bg-line-soft text-ink text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#e8e8e4] transition-colors">
              Отмена
            </button>
          )}
        </div>
      </div>

      {/* Фильтр */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => setFilterCat('all')}
          className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${filterCat === 'all' ? 'bg-ink text-white' : 'bg-surface border border-line text-ink-soft hover:bg-canvas'}`}>
          Все
        </button>
        {B2B_CATEGORIES.map(c => (
          <button key={c.value} onClick={() => setFilterCat(c.value)}
            className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${filterCat === c.value ? 'bg-ink text-white' : 'bg-surface border border-line text-ink-soft hover:bg-canvas'}`}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="bg-surface border border-line rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-[13px] text-muted">Загрузка...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-muted">Нет материалов</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line-soft">
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest">Название</th>
                <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest w-20">Толщ.</th>
                <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest w-28">Продажа/м²</th>
                <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest w-32">Закупка/м²</th>
                <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest w-36">Себест./м² нетто</th>
                <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest w-20">Отход</th>
                <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-emerald-700 uppercase tracking-widest w-28 bg-emerald-50/60">Маржа %</th>
                <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-emerald-700 uppercase tracking-widest w-32 bg-emerald-50/60">Маржа ₽/м²</th>
                <th className="w-32 px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m, idx) => {
                const cat = B2B_CATEGORIES.find(c => c.value === m.category)
                const margin = calcMargin(m)
                const costPerM2 = Math.round(calcCostPerM2(m))
                const marginColor = margin === null ? '' : margin.pct >= 30 ? 'text-emerald-600' : margin.pct >= 15 ? 'text-yellow-600' : 'text-red-500'
                const tempering = m.category !== 'зеркало' ? (TEMPERING_COST[m.thickness] ?? 0) : 0
                // Разделитель между разными наименованиями
                const prevName = idx > 0 ? filtered[idx - 1].name : null
                const isNewName = prevName !== m.name
                return (
                  <tr key={m.id}
                    className={`border-b border-canvas last:border-0 transition-colors ${isNewName && idx > 0 ? 'border-t border-line' : ''} ${editingId === m.id ? 'bg-blue-50' : 'hover:bg-subtle'} ${!m.active ? 'opacity-35' : ''}`}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {isNewName && (
                          <p className="font-medium text-ink">{m.name}</p>
                        )}
                        {!isNewName && (
                          <p className="text-muted text-[12px] pl-3">↳ {m.thickness} мм</p>
                        )}
                        {isNewName && m.passthrough && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-600">проходной</span>
                        )}
                      </div>
                      {isNewName && cat && <p className="text-[11px] text-muted mt-0.5">{cat.label}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono text-ink-soft">{m.thickness} мм</td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-ink">
                      {(m.sale_price ?? 0) > 0
                        ? `${(m.sale_price).toLocaleString('ru-RU')} ₽`
                        : <span className="text-orange-400 text-[11px]">не задана</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-soft">
                      {m.cost_price.toLocaleString('ru-RU')} ₽
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-soft">
                      <span className="text-ink">{costPerM2.toLocaleString('ru-RU')} ₽</span>
                      {tempering > 0 && (
                        <span className="text-[10px] text-muted block">вкл. закалку {tempering} ₽</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono text-ink-soft">
                      {m.passthrough
                        ? <span className="text-orange-500 font-semibold">10%</span>
                        : `${m.waste_percent}%`}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-mono font-semibold bg-emerald-50/40 ${marginColor}`}>
                      {margin !== null ? `${margin.pct}%` : <span className="text-[#d4d4ce]">—</span>}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-mono bg-emerald-50/40 ${marginColor}`}>
                      {margin !== null ? `${margin.rub.toLocaleString('ru-RU')} ₽` : <span className="text-[#d4d4ce]">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3 justify-end">
                        <button onClick={() => startEdit(m)} className="text-[12px] font-semibold text-blue-600 hover:text-blue-800 transition-colors">Изменить</button>
                        <button onClick={() => toggleActive(m.id, m.active)} className="text-[12px] text-muted hover:text-ink-soft transition-colors">
                          {m.active ? 'Скрыть' : 'Показать'}
                        </button>
                        <button onClick={() => deleteItem(m.id, m.name, m.thickness)} className="text-[12px] text-red-400 hover:text-red-600 transition-colors">✕</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Легенда */}
      <p className="mt-3 text-[11px] text-muted">
        Себест./м² нетто = закупка × (1 + отход%) + закалка по толщине (для стекла). Маржа ₽ — без НДС.
      </p>
    </div>
  )
}
