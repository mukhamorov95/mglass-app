'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { CatalogTab, type Color, type Supplier } from './CatalogTab'
import { BudgetKitTab } from './BudgetKitTab'
import { StandardFilterTab } from './StandardFilterTab'
import { SelfCostTab } from './SelfCostTab'

// ── Types ────────────────────────────────────────────────────────
type BudgetModel = {
  id: number; name: string; shower_type: string; supplier: string; manufacturer: string
  color: string; website_price: number; discount_percent: number; cost_price: number
  has_vat: boolean; kit_composition: string; photo_url: string; comment: string; active: boolean
}

type StandardHw = {
  id: number; name: string; category: string; shower_type: string; supplier: string
  manufacturer: string; colors: string[]; website_price: number; discount_percent: number
  cost_price: number; has_vat: boolean; unit: string; photo_url: string; description: string
  compatible_with: number[]; active: boolean
}

// ── Constants ─────────────────────────────────────────────────────
const SHOWER_TYPES = [
  { value: 'stationary', label: 'Стационарная' },
  { value: 'swing',      label: 'Распашная' },
  { value: 'sliding',    label: 'Раздвижная' },
  { value: 'universal',  label: 'Универсальная' },
]

const CATEGORIES = [
  { value: 'петли',          label: 'Петли' },
  { value: 'ручки',          label: 'Ручки' },
  { value: 'профили',        label: 'Профили' },
  { value: 'крепления',      label: 'Крепления к стене' },
  { value: 'штанги',         label: 'Штанги' },
  { value: 'комплектующие',  label: 'Комплектующие для штанг' },
  { value: 'уплотнители',    label: 'Уплотнители' },
  { value: 'доп',            label: 'Дополнительные элементы' },
]

const UNITS = ['шт', 'м.п.', 'компл.']

const EMPTY_BUDGET: Omit<BudgetModel, 'id'> = {
  name: '', shower_type: 'stationary', supplier: '', manufacturer: '', color: '',
  website_price: 0, discount_percent: 0, cost_price: 0, has_vat: false,
  kit_composition: '', photo_url: '', comment: '', active: true,
}

const EMPTY_STD: Omit<StandardHw, 'id'> = {
  name: '', category: 'петли', shower_type: 'universal', supplier: '', manufacturer: '',
  colors: [], website_price: 0, discount_percent: 0, cost_price: 0, has_vat: false,
  unit: 'шт', photo_url: '', description: '', compatible_with: [], active: true,
}

// ── Helpers ───────────────────────────────────────────────────────
function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }
function calcCostPrice(website: number, discount: number) {
  return Math.round(website * (1 - discount / 100))
}

function Input({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1">{label}</label>
      <input className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110]" {...props} />
    </div>
  )
}

function Select({ label, children, ...props }: { label: string } & React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1">{label}</label>
      <select className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110]" {...props}>{children}</select>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Tab 1 — Бюджетные душевые
// ════════════════════════════════════════════════════════════════
function BudgetTab() {
  const [items, setItems]   = useState<BudgetModel[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm]     = useState<Omit<BudgetModel,'id'>>(EMPTY_BUDGET)
  const [editId, setEditId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [filterType, setFilterType] = useState('all')

  useEffect(() => { load().catch(() => setLoading(false)) }, [])

  async function load() {
    setLoading(true)
    const { data } = await createClient().from('shower_budget_models').select('*').order('shower_type').order('name')
    setItems((data ?? []) as BudgetModel[])
    setLoading(false)
  }

  function setF<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm(f => {
      const next = { ...f, [key]: value }
      if (key === 'website_price' || key === 'discount_percent') {
        next.cost_price = calcCostPrice(
          key === 'website_price' ? (value as number) : f.website_price,
          key === 'discount_percent' ? (value as number) : f.discount_percent,
        )
      }
      return next
    })
  }

  async function save() {
    if (!form.name) return
    setSaving(true)
    const db = createClient()
    if (editId !== null) {
      await db.from('shower_budget_models').update(form).eq('id', editId)
      setEditId(null)
    } else {
      await db.from('shower_budget_models').insert(form)
    }
    setForm(EMPTY_BUDGET)
    await load(); setSaving(false)
  }

  function startEdit(item: BudgetModel) {
    setEditId(item.id)
    const { id: _, ...rest } = item
    setForm(rest)
  }

  async function toggleActive(id: number, active: boolean) {
    await createClient().from('shower_budget_models').update({ active: !active }).eq('id', id)
    await load()
  }

  const filtered = items.filter(i => filterType === 'all' || i.shower_type === filterType)

  return (
    <div className="space-y-6">
      {/* Форма */}
      <div className={`rounded-xl border p-5 ${editId !== null ? 'bg-blue-50 border-blue-200' : 'bg-white border-[#e4e4e0]'}`}>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85] mb-4">
          {editId !== null ? `Редактировать #${editId}` : 'Добавить модель'}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="col-span-2">
            <Input label="Название модели" value={form.name} onChange={e => setF('name', e.target.value)} placeholder="Напр: M1 Стационарная" />
          </div>
          <Select label="Тип душевой" value={form.shower_type} onChange={e => setF('shower_type', e.target.value)}>
            {SHOWER_TYPES.filter(t => t.value !== 'universal').map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
          <Input label="Цвет фурнитуры" value={form.color} onChange={e => setF('color', e.target.value)} placeholder="Хром, чёрный..." />
          <Input label="Поставщик" value={form.supplier} onChange={e => setF('supplier', e.target.value)} />
          <Input label="Производитель" value={form.manufacturer} onChange={e => setF('manufacturer', e.target.value)} />
          <Input label="Цена на сайте (₽)" type="number" value={form.website_price} onChange={e => setF('website_price', Number(e.target.value))} />
          <Input label="Скидка (%)" type="number" value={form.discount_percent} onChange={e => setF('discount_percent', Number(e.target.value))} />
          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1">Закупочная цена</label>
            <div className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] font-mono font-semibold text-emerald-700 bg-emerald-50">
              {fmt(form.cost_price)}
            </div>
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 cursor-pointer text-[13px] text-[#4b4b47]">
              <input type="checkbox" checked={form.has_vat} onChange={e => setF('has_vat', e.target.checked)} className="w-4 h-4 rounded" />
              НДС включён
            </label>
          </div>
          <div className="col-span-2">
            <Input label="Ссылка на фото" value={form.photo_url} onChange={e => setF('photo_url', e.target.value)} placeholder="https://..." />
          </div>
          <div className="col-span-4">
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1">Состав комплекта</label>
            <textarea className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110] h-20 resize-none"
              value={form.kit_composition} onChange={e => setF('kit_composition', e.target.value)}
              placeholder="Перечислите, что входит в комплект..." />
          </div>
          <div className="col-span-4">
            <Input label="Комментарий" value={form.comment} onChange={e => setF('comment', e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={save} disabled={saving || !form.name}
            className="bg-[#111110] text-white text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40">
            {saving ? 'Сохранение...' : editId !== null ? 'Сохранить' : 'Добавить'}
          </button>
          {editId !== null && (
            <button onClick={() => { setEditId(null); setForm(EMPTY_BUDGET) }}
              className="bg-[#f0f0ec] text-[#111110] text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#e8e8e4]">
              Отмена
            </button>
          )}
        </div>
      </div>

      {/* Фильтры */}
      <div className="flex gap-2">
        <button onClick={() => setFilterType('all')}
          className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${filterType === 'all' ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#6b6b66]'}`}>
          Все ({items.length})
        </button>
        {SHOWER_TYPES.filter(t => t.value !== 'universal').map(t => (
          <button key={t.value} onClick={() => setFilterType(t.value)}
            className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${filterType === t.value ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#6b6b66]'}`}>
            {t.label} ({items.filter(i => i.shower_type === t.value).length})
          </button>
        ))}
      </div>

      {/* Таблица */}
      <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
        {loading ? <div className="p-8 text-center text-[#9a9a95] text-[13px]">Загрузка...</div>
          : filtered.length === 0 ? <div className="p-8 text-center text-[#9a9a95] text-[13px]">Нет позиций</div>
          : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#f0f0ec]">
                  {['Модель','Тип','Поставщик','Цвет','Сайт','Скидка','Закупка','НДС',''].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <tr key={item.id} className={`border-b border-[#f8f8f7] last:border-0 hover:bg-[#fafaf9] ${!item.active ? 'opacity-40' : ''} ${editId === item.id ? 'bg-blue-50' : ''}`}>
                    <td className="px-3 py-2.5 font-medium text-[#111110]">
                      <div>{item.name}</div>
                      {item.kit_composition && <div className="text-[10px] text-[#9a9a95] truncate max-w-[160px]">{item.kit_composition}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                        item.shower_type === 'swing' ? 'bg-purple-50 text-purple-700' :
                        item.shower_type === 'sliding' ? 'bg-blue-50 text-blue-700' : 'bg-[#f0f0ec] text-[#6b6b66]'
                      }`}>{SHOWER_TYPES.find(t => t.value === item.shower_type)?.label}</span>
                    </td>
                    <td className="px-3 py-2.5 text-[#6b6b66]">{item.supplier || '—'}</td>
                    <td className="px-3 py-2.5 text-[#6b6b66]">{item.color || '—'}</td>
                    <td className="px-3 py-2.5 font-mono">{item.website_price > 0 ? fmt(item.website_price) : '—'}</td>
                    <td className="px-3 py-2.5 text-[#6b6b66]">{item.discount_percent > 0 ? `${item.discount_percent}%` : '—'}</td>
                    <td className="px-3 py-2.5 font-mono font-semibold text-emerald-700">{item.cost_price > 0 ? fmt(item.cost_price) : '—'}</td>
                    <td className="px-3 py-2.5 text-center">{item.has_vat ? <span className="text-emerald-600 text-[11px] font-semibold">ДА</span> : '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => startEdit(item)} className="text-[12px] font-semibold text-blue-600 hover:text-blue-800">Изм.</button>
                        <button onClick={() => toggleActive(item.id, item.active)} className="text-[12px] text-[#9a9a95] hover:text-[#6b6b66]">
                          {item.active ? 'Скрыть' : 'Показать'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Tab 2 — Стандартные душевые
// ════════════════════════════════════════════════════════════════
function StandardTab() {
  const [items, setItems]   = useState<StandardHw[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm]     = useState<Omit<StandardHw,'id'>>(EMPTY_STD)
  const [editId, setEditId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [filterCat, setFilterCat] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [colorsInput, setColorsInput] = useState('')

  useEffect(() => { load().catch(() => setLoading(false)) }, [])

  async function load() {
    setLoading(true)
    const { data } = await createClient().from('shower_standard_hardware').select('*').order('category').order('name')
    setItems((data ?? []) as StandardHw[])
    setLoading(false)
  }

  function setF<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm(f => {
      const next = { ...f, [key]: value }
      if (key === 'website_price' || key === 'discount_percent') {
        next.cost_price = calcCostPrice(
          key === 'website_price' ? (value as number) : f.website_price,
          key === 'discount_percent' ? (value as number) : f.discount_percent,
        )
      }
      return next
    })
  }

  async function save() {
    if (!form.name) return
    setSaving(true)
    const colors = colorsInput.split(',').map(s => s.trim()).filter(Boolean)
    const payload = { ...form, colors }
    const db = createClient()
    if (editId !== null) {
      await db.from('shower_standard_hardware').update(payload).eq('id', editId)
      setEditId(null)
    } else {
      await db.from('shower_standard_hardware').insert(payload)
    }
    setForm(EMPTY_STD); setColorsInput('')
    await load(); setSaving(false)
  }

  function startEdit(item: StandardHw) {
    setEditId(item.id)
    const { id: _, ...rest } = item
    setForm(rest)
    setColorsInput(item.colors.join(', '))
  }

  async function toggleActive(id: number, active: boolean) {
    await createClient().from('shower_standard_hardware').update({ active: !active }).eq('id', id)
    await load()
  }

  const filtered = items.filter(i =>
    (filterCat === 'all' || i.category === filterCat) &&
    (filterType === 'all' || i.shower_type === filterType)
  )

  // Группируем по категории для отображения
  const grouped = CATEGORIES.reduce<Record<string, StandardHw[]>>((acc, cat) => {
    const catItems = filtered.filter(i => i.category === cat.value)
    if (catItems.length > 0) acc[cat.value] = catItems
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {/* Форма */}
      <div className={`rounded-xl border p-5 ${editId !== null ? 'bg-blue-50 border-blue-200' : 'bg-white border-[#e4e4e0]'}`}>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85] mb-4">
          {editId !== null ? `Редактировать #${editId}` : 'Добавить позицию'}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="col-span-2">
            <Input label="Название" value={form.name} onChange={e => setF('name', e.target.value)} placeholder="Напр: Петля 135° стеклянная" />
          </div>
          <Select label="Категория" value={form.category} onChange={e => setF('category', e.target.value)}>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
          <Select label="Тип душевой" value={form.shower_type} onChange={e => setF('shower_type', e.target.value)}>
            {SHOWER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
          <Input label="Поставщик" value={form.supplier} onChange={e => setF('supplier', e.target.value)} />
          <Input label="Производитель" value={form.manufacturer} onChange={e => setF('manufacturer', e.target.value)} />
          <div className="col-span-2">
            <Input label="Цвета (через запятую)" value={colorsInput} onChange={e => setColorsInput(e.target.value)}
              placeholder="Хром, Чёрный, Золото" />
          </div>
          <Input label="Цена на сайте (₽)" type="number" value={form.website_price} onChange={e => setF('website_price', Number(e.target.value))} />
          <Input label="Скидка (%)" type="number" value={form.discount_percent} onChange={e => setF('discount_percent', Number(e.target.value))} />
          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1">Закупочная цена</label>
            <div className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] font-mono font-semibold text-emerald-700 bg-emerald-50">
              {fmt(form.cost_price)}
            </div>
          </div>
          <Select label="Единица" value={form.unit} onChange={e => setF('unit', e.target.value)}>
            {UNITS.map(u => <option key={u}>{u}</option>)}
          </Select>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 cursor-pointer text-[13px] text-[#4b4b47]">
              <input type="checkbox" checked={form.has_vat} onChange={e => setF('has_vat', e.target.checked)} className="w-4 h-4 rounded" />
              НДС включён
            </label>
          </div>
          <div className="col-span-2">
            <Input label="Ссылка на фото" value={form.photo_url} onChange={e => setF('photo_url', e.target.value)} placeholder="https://..." />
          </div>
          <div className="col-span-4">
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1">Описание</label>
            <textarea className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] h-16 resize-none"
              value={form.description} onChange={e => setF('description', e.target.value)} placeholder="Описание, характеристики..." />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={save} disabled={saving || !form.name}
            className="bg-[#111110] text-white text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40">
            {saving ? 'Сохранение...' : editId !== null ? 'Сохранить' : 'Добавить'}
          </button>
          {editId !== null && (
            <button onClick={() => { setEditId(null); setForm(EMPTY_STD); setColorsInput('') }}
              className="bg-[#f0f0ec] text-[#111110] text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#e8e8e4]">
              Отмена
            </button>
          )}
        </div>
      </div>

      {/* Фильтры */}
      <div className="flex flex-wrap gap-2">
        <div className="flex gap-1 flex-wrap">
          <span className="text-[11px] text-[#9a9a95] self-center mr-1">Тип:</span>
          {[{ value: 'all', label: 'Все' }, ...SHOWER_TYPES].map(t => (
            <button key={t.value} onClick={() => setFilterType(t.value)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${filterType === t.value ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#6b6b66]'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          <span className="text-[11px] text-[#9a9a95] self-center mr-1">Кат.:</span>
          <button onClick={() => setFilterCat('all')}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${filterCat === 'all' ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#6b6b66]'}`}>
            Все
          </button>
          {CATEGORIES.map(c => (
            <button key={c.value} onClick={() => setFilterCat(c.value)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${filterCat === c.value ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#6b6b66]'}`}>
              {c.label} ({items.filter(i => i.category === c.value).length})
            </button>
          ))}
        </div>
      </div>

      {/* Список по категориям */}
      {loading ? (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-8 text-center text-[#9a9a95] text-[13px]">Загрузка...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-8 text-center text-[#9a9a95] text-[13px]">Нет позиций</div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([cat, catItems]) => (
            <div key={cat} className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-[#fafaf9] border-b border-[#e4e4e0] flex items-center justify-between">
                <p className="text-[12px] font-semibold text-[#4b4b47] uppercase tracking-wide">
                  {CATEGORIES.find(c => c.value === cat)?.label}
                </p>
                <span className="text-[11px] text-[#9a9a95]">{catItems.length} поз.</span>
              </div>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#f5f5f3]">
                    {['Название','Тип','Поставщик','Цвета','Ед.','Сайт','Скидка','Закупка','НДС',''].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {catItems.map(item => (
                    <tr key={item.id} className={`border-b border-[#f8f8f7] last:border-0 hover:bg-[#fafaf9] ${!item.active ? 'opacity-40' : ''} ${editId === item.id ? 'bg-blue-50' : ''}`}>
                      <td className="px-3 py-2.5 font-medium text-[#111110]">
                        <div>{item.name}</div>
                        {item.description && <div className="text-[10px] text-[#9a9a95] truncate max-w-[160px]">{item.description}</div>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          item.shower_type === 'swing' ? 'bg-purple-50 text-purple-700' :
                          item.shower_type === 'sliding' ? 'bg-blue-50 text-blue-700' :
                          item.shower_type === 'stationary' ? 'bg-[#f0f0ec] text-[#6b6b66]' : 'bg-gray-100 text-gray-500'
                        }`}>{SHOWER_TYPES.find(t => t.value === item.shower_type)?.label}</span>
                      </td>
                      <td className="px-3 py-2.5 text-[#6b6b66] text-[12px]">{item.supplier || '—'}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-0.5">
                          {item.colors.length > 0 ? item.colors.map(c => (
                            <span key={c} className="text-[10px] bg-[#f0f0ec] text-[#6b6b66] px-1.5 py-0.5 rounded">{c}</span>
                          )) : <span className="text-[#c4c4be]">—</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[#6b6b66]">{item.unit}</td>
                      <td className="px-3 py-2.5 font-mono text-[12px]">{item.website_price > 0 ? fmt(item.website_price) : '—'}</td>
                      <td className="px-3 py-2.5 text-[#6b6b66] text-[12px]">{item.discount_percent > 0 ? `${item.discount_percent}%` : '—'}</td>
                      <td className="px-3 py-2.5 font-mono font-semibold text-emerald-700 text-[12px]">{item.cost_price > 0 ? fmt(item.cost_price) : '—'}</td>
                      <td className="px-3 py-2.5 text-center">{item.has_vat ? <span className="text-emerald-600 text-[10px] font-semibold">ДА</span> : '—'}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => startEdit(item)} className="text-[12px] font-semibold text-blue-600 hover:text-blue-800">Изм.</button>
                          <button onClick={() => toggleActive(item.id, item.active)} className="text-[12px] text-[#9a9a95] hover:text-[#6b6b66]">
                            {item.active ? 'Скрыть' : 'Показать'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// Main page
// ════════════════════════════════════════════════════════════════
export default function ShowerHardwarePage() {
  const [tab, setTab] = useState<'catalog' | 'budget' | 'standard' | 'selfcost'>('catalog')
  const [colors,    setColors]    = useState<Color[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  async function loadShared() {
    const db = createClient()
    const [{ data: cols }, { data: sups }] = await Promise.all([
      db.from('shower_hw_colors').select('*').order('sort_order'),
      db.from('shower_hw_suppliers').select('*').eq('active', true).order('name'),
    ])
    setColors((cols ?? []) as Color[])
    setSuppliers((sups ?? []) as Supplier[])
  }

  useEffect(() => { loadShared().catch(() => {}) }, [])

  const TABS = [
    { key: 'catalog',  label: 'Справочник' },
    { key: 'budget',   label: 'Бюджетные душевые' },
    { key: 'standard', label: 'Стандартные душевые' },
    { key: 'selfcost', label: '💰 Себестоимость (Иван)' },
  ] as const

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">Фурнитура душевые</h1>
        <p className="text-[13px] text-[#8a8a85] mt-0.5">Справочник фурнитуры, бюджетные комплекты M1–M12, стандартные позиции</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-[#ececea] rounded-xl w-fit mb-6">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-5 py-2 rounded-lg text-[13px] font-medium transition-all ${tab === t.key ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66] hover:text-[#111110]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'catalog'  && <CatalogTab colors={colors} suppliers={suppliers} onRefreshSuppliers={loadShared} />}
      {tab === 'budget'   && <BudgetKitTab colors={colors} suppliers={suppliers} />}
      {tab === 'standard' && <StandardFilterTab colors={colors} suppliers={suppliers} />}
      {tab === 'selfcost' && <SelfCostTab />}
    </div>
  )
}
