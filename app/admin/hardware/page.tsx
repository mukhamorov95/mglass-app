'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { HardwareItem } from '@/lib/types'
import { PageHeader } from '@/components/ds'

const EMPTY: Omit<HardwareItem, 'id'> = { name: '', short_name: null, system_type: 'universal', unit: 'шт', cost_price: 0, active: true, comment: null }

const SYSTEM_LABELS: Record<HardwareItem['system_type'], string> = {
  sliding: 'Раздвижная',
  swing: 'Распашная',
  universal: 'Универсальная',
}

type ShowerKit = { id: number; model_id: string; color: string; cost_price: number; active: boolean }

const SHOWER_MODELS = ['M1','M2','M3','M4','M5','M6','M7','M8','M9','M10','M11','M12']
const SHOWER_COLORS: { value: string; label: string }[] = [
  { value: 'chrome', label: 'Хром' },
  { value: 'black',  label: 'Чёрный' },
  { value: 'bronze', label: 'Бронза' },
  { value: 'gold',   label: 'Золото' },
  { value: 'white',  label: 'Белый' },
]

export default function HardwareAdminPage() {
  const [items, setItems]       = useState<HardwareItem[]>([])
  const [loading, setLoading]   = useState(true)
  const [form, setForm]         = useState(EMPTY)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<'all' | HardwareItem['system_type']>('all')

  const [kits, setKits]         = useState<ShowerKit[]>([])
  const [kitsLoading, setKitsLoading] = useState(true)
  const [editCell, setEditCell] = useState<{ model_id: string; color: string } | null>(null)
  const [editVal, setEditVal]   = useState('')
  const [kitsSaving, setKitsSaving] = useState(false)

  useEffect(() => { load(); loadKits() }, [])

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.from('hardware_items').select('*').order('system_type').order('name')
      if (error) setError(error.message)
      else setItems(data ?? [])
    } catch {
      setLoadError('Не удалось загрузить фурнитуру лофт')
    } finally {
      setLoading(false)
    }
  }

  async function loadKits() {
    setKitsLoading(true)
    const supabase = createClient()
    const { data } = await supabase.from('shower_hardware_kits').select('*').order('model_id').order('color')
    setKits((data ?? []) as ShowerKit[])
    setKitsLoading(false)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const payload = { ...form, cost_price: Number(form.cost_price ?? 0) }
    if (editingId !== null) {
      const { error } = await supabase.from('hardware_items').update(payload).eq('id', editingId)
      if (error) { setError(error.message); setSaving(false); return }
      setEditingId(null)
    } else {
      const { error } = await supabase.from('hardware_items').insert(payload)
      if (error) { setError(error.message); setSaving(false); return }
    }
    setForm(EMPTY)
    await load()
    setSaving(false)
  }

  async function toggleActive(id: number, active: boolean) {
    const supabase = createClient()
    await supabase.from('hardware_items').update({ active: !active }).eq('id', id)
    await load()
  }

  function startEdit(item: HardwareItem) {
    setEditingId(item.id)
    setForm({ name: item.name, short_name: item.short_name ?? null, system_type: item.system_type, unit: item.unit, cost_price: item.cost_price ?? 0, active: item.active, comment: item.comment })
    setError(null)
  }

  function kitPrice(model_id: string, color: string): number {
    return kits.find(k => k.model_id === model_id && k.color === color)?.cost_price ?? 0
  }

  function startCellEdit(model_id: string, color: string) {
    setEditCell({ model_id, color })
    setEditVal(String(kitPrice(model_id, color)))
  }

  async function saveCellEdit() {
    if (!editCell) return
    setKitsSaving(true)
    const supabase = createClient()
    const price = Number(editVal) || 0
    const existing = kits.find(k => k.model_id === editCell.model_id && k.color === editCell.color)
    if (existing) {
      await supabase.from('shower_hardware_kits').update({ cost_price: price }).eq('id', existing.id)
    } else {
      await supabase.from('shower_hardware_kits').insert({ model_id: editCell.model_id, color: editCell.color, cost_price: price })
    }
    setEditCell(null)
    await loadKits()
    setKitsSaving(false)
  }

  const filtered = filterType === 'all' ? items : items.filter(i => i.system_type === filterType)

  return (
    <div className="max-w-[1000px] mx-auto px-6 py-8 space-y-10">

      {/* ── Раздел 1: Фурнитура лофт ── */}
      <div>
        <PageHeader title="Фурнитура" subtitle={`${items.filter(i => i.active).length} активных позиций · Лофт-перегородки`} />

        <div className={`rounded-xl border p-5 mb-6 transition-all ${editingId !== null ? 'bg-blue-50 border-blue-200' : 'bg-surface border-line'}`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              {editingId !== null ? `Редактировать — ID ${editingId}` : 'Добавить позицию'}
            </h2>
            {editingId !== null && (
              <span className="text-[11px] font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-md">Режим редактирования</span>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="col-span-2">
              <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-1.5">Название</label>
              <input className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] text-ink outline-none focus:border-ink"
                value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Название позиции" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-1.5">Система</label>
              <select className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] text-ink outline-none focus:border-ink"
                value={form.system_type} onChange={e => setForm({ ...form, system_type: e.target.value as HardwareItem['system_type'] })}>
                <option value="sliding">Раздвижная</option>
                <option value="swing">Распашная</option>
                <option value="universal">Универсальная</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-1.5">Единица</label>
              <select className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] text-ink outline-none focus:border-ink"
                value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                {['шт', 'пог.м', 'компл.'].map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-1.5">Себестоимость (₽)</label>
              <input type="number" className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] font-mono text-ink outline-none focus:border-ink"
                value={form.cost_price ?? 0} onChange={e => setForm({ ...form, cost_price: Number(e.target.value) })} />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] font-semibold text-muted uppercase tracking-widest mb-1.5">Комментарий</label>
              <input className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] text-ink outline-none focus:border-ink"
                value={form.comment ?? ''} onChange={e => setForm({ ...form, comment: e.target.value })} placeholder="Необязательно" />
            </div>
          </div>
          {error && <p className="mt-3 text-[13px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          <div className="flex gap-2 mt-4">
            <button onClick={handleSave} disabled={saving || !form.name}
              className="bg-ink text-white text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40">
              {saving ? 'Сохранение...' : editingId !== null ? 'Сохранить изменения' : 'Добавить позицию'}
            </button>
            {editingId !== null && (
              <button onClick={() => { setEditingId(null); setForm(EMPTY); setError(null) }}
                className="bg-line-soft text-ink text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#e8e8e4]">
                Отмена
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          {(['all', 'sliding', 'swing', 'universal'] as const).map(t => (
            <button key={t} onClick={() => setFilterType(t)}
              className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${filterType === t ? 'bg-ink text-white' : 'bg-surface border border-line text-ink-soft hover:bg-canvas'}`}>
              {t === 'all' ? 'Все' : SYSTEM_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="bg-surface border border-line rounded-xl overflow-hidden">
          {loadError ? (
            <div className="p-8 text-center text-[13px]">
              <p className="text-red-600 mb-3">{loadError}</p>
              <button onClick={load} className="text-[12px] font-medium px-3 py-1.5 bg-line-soft rounded-lg hover:bg-[#e8e8e4] text-ink">Повторить</button>
            </div>
          ) : loading ? (
            <div className="p-8 text-center text-[13px] text-muted">Загрузка...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-muted">Нет позиций</div>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line-soft">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest">Название</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest">Система</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest w-20">Ед.</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest w-36">Себестоимость</th>
                  <th className="w-36 px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <tr key={item.id}
                    className={`border-b border-line-soft last:border-0 ${editingId === item.id ? 'bg-blue-50' : 'hover:bg-subtle'} ${!item.active ? 'opacity-35' : ''}`}>
                    <td className="px-4 py-3 font-medium text-ink">{item.name}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${item.system_type === 'sliding' ? 'bg-blue-50 text-blue-700' : item.system_type === 'swing' ? 'bg-purple-50 text-purple-700' : 'bg-line-soft text-ink-soft'}`}>
                        {SYSTEM_LABELS[item.system_type]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{item.unit}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-ink tabular-nums">
                      {(item.cost_price ?? 0) > 0 ? `${(item.cost_price ?? 0).toLocaleString('ru-RU')} ₽` : <span className="text-faint font-normal">не задана</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 justify-end">
                        <button onClick={() => startEdit(item)} className="text-[12px] font-semibold text-blue-600 hover:text-blue-800">Изменить</button>
                        <button onClick={() => toggleActive(item.id, item.active)} className="text-[12px] text-muted hover:text-ink-soft">
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

      {/* ── Раздел 2: Душевые — комплекты фурнитуры ── */}
      <div>
        <div className="mb-4">
          <h2 className="text-[18px] font-semibold text-ink tracking-tight">Душевые перегородки — комплекты фурнитуры</h2>
          <p className="text-[13px] text-muted mt-0.5">Себестоимость фурнитурного комплекта по модели и цвету. Нажмите на ячейку чтобы изменить.</p>
        </div>

        {kitsLoading ? (
          <div className="bg-surface border border-line rounded-xl p-8 text-center text-[13px] text-muted">Загрузка...</div>
        ) : (
          <div className="bg-surface border border-line rounded-xl overflow-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line-soft">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest w-20">Модель</th>
                  {SHOWER_COLORS.map(c => (
                    <th key={c.value} className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SHOWER_MODELS.map(model => (
                  <tr key={model} className="border-b border-line-soft last:border-0 hover:bg-subtle">
                    <td className="px-4 py-2.5 font-semibold text-ink">{model}</td>
                    {SHOWER_COLORS.map(c => {
                      const isEditing = editCell?.model_id === model && editCell?.color === c.value
                      const price = kitPrice(model, c.value)
                      return (
                        <td key={c.value} className="px-3 py-2 text-right">
                          {isEditing ? (
                            <div className="flex items-center gap-1 justify-end">
                              <input
                                type="number"
                                autoFocus
                                className="w-24 border border-blue-400 rounded px-2 py-1 text-[13px] font-mono text-right outline-none bg-blue-50 tabular-nums"
                                value={editVal}
                                onChange={e => setEditVal(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveCellEdit(); if (e.key === 'Escape') setEditCell(null) }}
                              />
                              <button onClick={saveCellEdit} disabled={kitsSaving}
                                className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 whitespace-nowrap disabled:opacity-40">
                                {kitsSaving ? '...' : 'OK'}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => startCellEdit(model, c.value)}
                              className={`font-mono text-[13px] hover:text-blue-600 transition-colors cursor-pointer tabular-nums ${price > 0 ? 'text-ink' : 'text-faint'}`}>
                              {price > 0 ? `${price.toLocaleString('ru-RU')} ₽` : '—'}
                            </button>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
