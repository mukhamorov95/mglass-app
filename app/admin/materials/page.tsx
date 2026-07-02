'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { Material, MATERIAL_CATEGORIES } from '@/lib/types'

const UNITS = ['м²', 'пог.м', 'шт', 'заказ', 'этаж', 'изделие']

// Логические группы для отображения
const GROUPS: { label: string; categories: string[]; color: string }[] = [
  { label: 'Зеркало',              categories: ['зеркало'],               color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { label: 'Стекло',               categories: ['стекло'],                color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  { label: 'Подсветка и электрика',categories: ['подсветка', 'электрика'],color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  { label: 'Профиль',              categories: ['профиль'],               color: 'bg-orange-50 text-orange-700 border-orange-200' },
  { label: 'Работа',               categories: ['работа'],                color: 'bg-violet-50 text-violet-700 border-violet-200' },
  { label: 'Расходники',           categories: ['расходники'],            color: 'bg-stone-50 text-stone-600 border-stone-200' },
  { label: 'Услуги',               categories: ['услуга'],                color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { label: 'Фурнитура',            categories: ['фурнитура'],             color: 'bg-pink-50 text-pink-700 border-pink-200' },
]

const EMPTY: Omit<Material, 'id' | 'created_at' | 'updated_at' | 'image_url'> = {
  name: '', short_name: null, category: 'зеркало', unit: 'м²', cost_price: 0, sale_price: null,
  has_vat: false, vat_rate: 20, active: true, in_stock: true, comment: null,
}

type TransferModal = {
  material: Material
  target: 'mirror_lighting' | 'hardware' | ''
  componentType: 'frame' | 'led_strip' | 'power_supply' | 'diffuser' | ''
  systemType: 'sliding' | 'swing' | 'universal'
  transferring: boolean
  error: string | null
}

export default function MaterialsAdminPage() {
  const [materials, setMaterials]   = useState<Material[]>([])
  const [loading, setLoading]       = useState(true)
  const [form, setForm]             = useState(EMPTY)
  const [editingId, setEditingId]   = useState<number | null>(null)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [uploadingId, setUploadingId] = useState<number | null>(null)
  const [transfer, setTransfer]     = useState<TransferModal | null>(null)
  const [catalogNames, setCatalogNames] = useState<Set<string>>(new Set())
  const [selectedForClear, setSelectedForClear] = useState<Set<number>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadTargetId = useRef<number | null>(null)
  const formRef = useRef<HTMLDivElement>(null)

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const materialId = uploadTargetId.current
    if (!file || materialId === null) return
    e.target.value = ''

    setUploadingId(materialId)
    const fd = new FormData()
    fd.append('materialId', String(materialId))
    fd.append('file', file)
    await fetch('/api/admin/materials/upload', { method: 'POST', body: fd })
    setUploadingId(null)
    load()
  }

  const triggerUpload = (id: number) => {
    uploadTargetId.current = id
    fileInputRef.current?.click()
  }

  const removeImage = async (id: number) => {
    await fetch(`/api/admin/materials/upload?materialId=${id}`, { method: 'DELETE' })
    load()
  }

  useEffect(() => { load().catch(() => setLoading(false)) }, [])

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const [{ data, error }, { data: mlc }, { data: hw }] = await Promise.all([
      supabase.from('materials').select('*').order('created_at', { ascending: false }),
      supabase.from('mirror_lighting_components').select('name'),
      supabase.from('hardware_items').select('name'),
    ])
    if (error) setError(error.message)
    else setMaterials(data ?? [])
    const names = new Set([
      ...(mlc ?? []).map((r: { name: string }) => r.name.toLowerCase().trim()),
      ...(hw  ?? []).map((r: { name: string }) => r.name.toLowerCase().trim()),
    ])
    setCatalogNames(names)
    setLoading(false)
  }

  function toggleClearItem(id: number) {
    setSelectedForClear(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleClearGroup(ids: number[], checked: boolean) {
    setSelectedForClear(prev => {
      const next = new Set(prev)
      ids.forEach(id => checked ? next.add(id) : next.delete(id))
      return next
    })
  }

  async function deleteSelected() {
    if (selectedForClear.size === 0) return
    if (!confirm(`Удалить ${selectedForClear.size} позиций? Это действие нельзя отменить.`)) return
    const supabase = createClient()
    await supabase.from('materials').delete().in('id', [...selectedForClear])
    setSelectedForClear(new Set())
    await load()
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const payload = {
      ...form,
      cost_price: Number(form.cost_price),
      sale_price: form.sale_price !== null && form.sale_price !== undefined && String(form.sale_price) !== ''
        ? Number(form.sale_price) : null,
    }
    if (editingId !== null) {
      const { error } = await supabase.from('materials').update(payload).eq('id', editingId)
      if (error) { setError(error.message); setSaving(false); return }
      setEditingId(null)
    } else {
      const { error } = await supabase.from('materials').insert(payload)
      if (error) { setError(error.message); setSaving(false); return }
    }
    setForm(EMPTY)
    await load()
    setSaving(false)
  }

  function startEdit(m: Material) {
    setEditingId(m.id)
    setForm({
      name: m.name, short_name: m.short_name ?? null, category: m.category, unit: m.unit,
      cost_price: m.cost_price, sale_price: m.sale_price ?? null,
      has_vat: m.has_vat, vat_rate: m.vat_rate,
      active: m.active, in_stock: m.in_stock ?? true, comment: m.comment,
    })
    // Скроллим к форме
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(EMPTY)
    setError(null)
  }

  async function deleteMaterial(id: number, name: string) {
    if (!confirm(`Удалить «${name}»? Это действие нельзя отменить.`)) return
    const supabase = createClient()
    const { error } = await supabase.from('materials').delete().eq('id', id)
    if (error) { setError(error.message); return }
    setMaterials(prev => prev.filter(m => m.id !== id))
    if (editingId === id) cancelEdit()
  }

  async function toggleActive(id: number, active: boolean) {
    const supabase = createClient()
    await supabase.from('materials').update({ active: !active }).eq('id', id)
    load()
  }

  async function toggleStock(id: number, in_stock: boolean) {
    const supabase = createClient()
    await supabase.from('materials').update({ in_stock: !in_stock }).eq('id', id)
    setMaterials(prev => prev.map(m => m.id === id ? { ...m, in_stock: !in_stock } : m))
  }

  async function handleTransfer() {
    if (!transfer || !transfer.target) return
    if (transfer.target === 'mirror_lighting' && !transfer.componentType) return
    setTransfer(t => t ? { ...t, transferring: true, error: null } : t)
    const res = await fetch('/api/admin/materials/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        materialId:    transfer.material.id,
        target:        transfer.target,
        componentType: transfer.componentType || undefined,
        systemType:    transfer.systemType,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      setTransfer(t => t ? { ...t, transferring: false, error: data.error } : t)
      return
    }
    setTransfer(null)
    await load()
  }

  const totalActive   = materials.filter(m => m.active).length
  const allGroupedCats = GROUPS.flatMap(g => g.categories)
  const queueItems = materials.filter(m =>
    m.active && !m.short_name && !allGroupedCats.includes(m.category)
  )

  const allVisibleIds = materials.filter(m => showInactive || m.active).map(m => m.id)

  return (
    <div className="max-w-[1000px] mx-auto px-6 py-8">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

      {/* Transfer modal */}
      {transfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-[15px] font-semibold text-[#111110] mb-1">Перенести в специализированный справочник</h2>
            <p className="text-[13px] text-[#6b6b66] mb-5 leading-snug">
              <span className="font-medium text-[#111110]">{transfer.material.name}</span>
              <span className="text-[#9a9a95]"> · {transfer.material.unit} · {transfer.material.cost_price.toLocaleString('ru-RU')} ₽</span>
            </p>

            {/* Куда */}
            <div className="mb-4">
              <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-2">Куда перенести</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: 'mirror_lighting', label: '💡 Подсветка зеркал' },
                  { value: 'hardware',        label: '🔩 Фурнитура' },
                ] as const).map(opt => (
                  <button key={opt.value}
                    onClick={() => setTransfer(t => t ? { ...t, target: opt.value } : t)}
                    className={`px-3 py-2.5 rounded-xl border text-[13px] font-medium transition-colors text-left ${
                      transfer.target === opt.value
                        ? 'bg-[#111110] text-white border-[#111110]'
                        : 'border-[#e4e4e0] text-[#111110] hover:bg-[#f5f5f3]'
                    }`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Доп. поля для Подсветки */}
            {transfer.target === 'mirror_lighting' && (
              <div className="mb-4">
                <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-2">Тип компонента</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { value: 'frame',          label: '🔲 Каркас (профиль)' },
                    { value: 'led_strip',      label: '💡 LED-лента' },
                    { value: 'power_supply',   label: '🔌 Блок питания' },
                    { value: 'diffuser',       label: '⬜ Рассеиватель' },
                  ] as const).map(opt => (
                    <button key={opt.value}
                      onClick={() => setTransfer(t => t ? { ...t, componentType: opt.value } : t)}
                      className={`px-3 py-2 rounded-xl border text-[12px] font-medium transition-colors text-left ${
                        transfer.componentType === opt.value
                          ? 'bg-yellow-400 text-[#111110] border-yellow-400'
                          : 'border-[#e4e4e0] text-[#111110] hover:bg-[#f5f5f3]'
                      }`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Доп. поля для Фурнитуры */}
            {transfer.target === 'hardware' && (
              <div className="mb-4">
                <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-2">Система</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: 'swing',     label: '🚪 Лофт' },
                    { value: 'sliding',   label: '🚿 Душевые' },
                    { value: 'universal', label: '🔧 Универс.' },
                  ] as const).map(opt => (
                    <button key={opt.value}
                      onClick={() => setTransfer(t => t ? { ...t, systemType: opt.value } : t)}
                      className={`px-3 py-2 rounded-xl border text-[12px] font-medium transition-colors text-center ${
                        transfer.systemType === opt.value
                          ? 'bg-[#111110] text-white border-[#111110]'
                          : 'border-[#e4e4e0] text-[#111110] hover:bg-[#f5f5f3]'
                      }`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {transfer.error && (
              <p className="mb-3 text-[12px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{transfer.error}</p>
            )}

            <p className="text-[11px] text-[#9a9a95] mb-4">После переноса материал будет скрыт из общего справочника.</p>

            <div className="flex gap-2">
              <button
                onClick={handleTransfer}
                disabled={
                  transfer.transferring ||
                  !transfer.target ||
                  (transfer.target === 'mirror_lighting' && !transfer.componentType)
                }
                className="flex-1 bg-[#111110] text-white text-[13px] font-medium px-4 py-2.5 rounded-xl hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
                {transfer.transferring ? 'Переносим...' : 'Перенести →'}
              </button>
              <button onClick={() => setTransfer(null)}
                className="px-4 py-2.5 rounded-xl border border-[#e4e4e0] text-[13px] text-[#6b6b66] hover:bg-[#f5f5f3] transition-colors">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Шапка */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">Справочник материалов</h1>
          <p className="text-[13px] text-[#8a8a85] mt-0.5">
            {totalActive} активных позиций
            {queueItems.length > 0 && <span className="ml-2 text-amber-600 font-medium">· {queueItems.length} ждут обработки</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => toggleClearGroup(allVisibleIds, selectedForClear.size < allVisibleIds.length)}
            className="h-8 px-3 rounded-lg text-[12px] border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f3] transition-colors">
            {selectedForClear.size < allVisibleIds.length ? 'Выбрать все' : 'Снять все'}
          </button>
          {selectedForClear.size > 0 && (
            <button onClick={deleteSelected}
              className="h-8 px-3 rounded-lg text-[12px] bg-red-500 text-white font-semibold hover:bg-red-600 transition-colors">
              🗑 Удалить ({selectedForClear.size})
            </button>
          )}
          <label className="flex items-center gap-2 cursor-pointer select-none ml-1">
            <div className={`w-8 rounded-full transition-colors relative ${showInactive ? 'bg-[#111110]' : 'bg-[#e4e4e0]'}`}
              style={{ height: 18 }}
              onClick={() => setShowInactive(!showInactive)}>
              <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${showInactive ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-[12px] text-[#6b6b66]">Показать скрытые</span>
          </label>
        </div>
      </div>

      {/* Форма добавления / редактирования */}
      <div ref={formRef}
        className={`rounded-xl border p-5 mb-8 transition-all ${editingId !== null ? 'bg-blue-50 border-blue-200' : 'bg-white border-[#e4e4e0]'}`}>

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85]">
            {editingId !== null ? `Редактировать — ID ${editingId}` : 'Добавить позицию'}
          </h2>
          {editingId !== null && (
            <span className="text-[11px] font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-md">Режим редактирования</span>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="col-span-2">
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Название (от поставщика)</label>
            <input
              autoFocus={editingId !== null}
              className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] outline-none focus:border-[#111110] transition-all"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="Полное название из прайса"
            />
          </div>

          <div className="col-span-2">
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">
              Короткое название
              <span className="ml-1.5 text-[10px] font-normal text-[#b8b8b4] normal-case tracking-normal">показывается в калькуляторе вместо полного</span>
            </label>
            <input
              className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] outline-none focus:border-[#111110] transition-all"
              value={form.short_name ?? ''}
              onChange={e => setForm({ ...form, short_name: e.target.value || null })}
              placeholder="напр. «Зеркало 4 мм» вместо «Зеркало осветлённое 4 мм Guardian»"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Категория</label>
            <select className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] outline-none focus:border-[#111110] transition-all"
              value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {MATERIAL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Единица</label>
            <select className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] outline-none focus:border-[#111110] transition-all"
              value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Закупочная цена (₽)</label>
            <input type="number"
              className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
              value={form.cost_price}
              onChange={e => setForm({ ...form, cost_price: Number(e.target.value) })}
            />
          </div>

          {form.category === 'зеркало' && (
            <div>
              <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">
                Цена в калькуляторе (₽)
              </label>
              <input type="number"
                className="w-full bg-white border border-blue-300 rounded-lg px-3 py-2 text-[14px] font-mono text-[#111110] outline-none focus:border-blue-600 transition-all"
                value={form.sale_price ?? ''}
                placeholder="напр. 2000"
                onChange={e => setForm({ ...form, sale_price: e.target.value === '' ? null : Number(e.target.value) })}
              />
              <p className="text-[10px] text-[#9a9a95] mt-1">Идёт в себестоимость изделия</p>
            </div>
          )}

          <div className="flex items-end pb-0.5">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${form.has_vat ? 'bg-[#111110] border-[#111110]' : 'border-[#c4c4be]'}`}
                onClick={() => setForm({ ...form, has_vat: !form.has_vat })}>
                {form.has_vat && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
              </div>
              <span className="text-[13px] text-[#6b6b66]" onClick={() => setForm({ ...form, has_vat: !form.has_vat })}>НДС включён</span>
            </label>
          </div>

          <div className="col-span-2">
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Комментарий</label>
            <input className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] outline-none focus:border-[#111110] transition-all"
              value={form.comment ?? ''}
              onChange={e => setForm({ ...form, comment: e.target.value })}
              placeholder="Необязательно"
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 text-[13px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
        )}

        <div className="flex gap-2 mt-4">
          <button onClick={handleSave} disabled={saving || !form.name}
            className="bg-[#111110] text-white text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
            {saving ? 'Сохранение...' : editingId !== null ? 'Сохранить изменения' : 'Добавить позицию'}
          </button>
          {editingId !== null && (
            <button onClick={cancelEdit}
              className="bg-[#f0f0ec] text-[#111110] text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#e8e8e4] transition-colors">
              Отмена
            </button>
          )}
        </div>
      </div>

      {/* Группы материалов */}
      {loading ? (
        <div className="py-16 text-center text-[13px] text-[#8a8a85]">Загрузка...</div>
      ) : (
        <div className="space-y-6">

          {/* Секция очереди — новые необработанные материалы */}
          {queueItems.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md border bg-amber-50 text-amber-700 border-amber-200">
                  📥 Новые — обработать
                </span>
                <span className="text-[12px] text-[#9a9a95]">{queueItems.length} позиций</span>
                <div className="flex-1 h-px bg-[#f0f0ec]" />
              </div>
              <div className="bg-white border border-amber-200 rounded-xl overflow-hidden">
                <table className="w-full text-[13px]">
                  <tbody>
                    {queueItems.map((m, idx) => (
                      <tr key={m.id} className={`border-b border-[#f8f8f7] last:border-0 transition-colors ${selectedForClear.has(m.id) ? 'bg-red-50' : 'hover:bg-amber-50/40'}`}>
                        <td className="pl-3 pr-1 py-3 w-8">
                          <input type="checkbox" checked={selectedForClear.has(m.id)} onChange={() => toggleClearItem(m.id)} className="w-4 h-4 cursor-pointer" />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-[#111110]">{m.name}</span>
                              {catalogNames.has(m.name.toLowerCase().trim()) && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 border border-orange-200">дублёр</span>
                              )}
                            </div>
                            <span className="text-[10px] text-[#b8b8b4]">{new Date(m.created_at).toLocaleDateString('ru-RU')}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[#9a9a95] text-[11px] uppercase">{m.category}</td>
                        <td className="px-4 py-3 text-[#6b6b66]">{m.unit}</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-[#111110]">{m.cost_price.toLocaleString('ru-RU')} ₽</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => setTransfer({ material: m, target: '', componentType: '', systemType: 'universal', transferring: false, error: null })}
                              className="h-6 px-2.5 rounded text-[11px] font-medium bg-violet-50 text-violet-600 hover:bg-violet-100 transition-colors">
                              ↗ Перенести
                            </button>
                            <button onClick={() => startEdit(m)}
                              className="h-6 px-2.5 rounded text-[11px] font-medium bg-[#f5f5f3] text-[#4b4b47] hover:bg-[#ebebea] transition-colors">
                              Изменить
                            </button>
                            <button onClick={() => deleteMaterial(m.id, m.name)}
                              className="h-6 px-2 rounded text-[11px] text-red-400 hover:text-red-600 transition-colors">
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {GROUPS.map(group => {
            const items = materials.filter(m =>
              group.categories.includes(m.category) && (showInactive || m.active)
            )
            if (items.length === 0) return null

            return (
              <div key={group.label}>
                {/* Заголовок группы */}
                <div className="flex items-center gap-3 mb-2">
                  <span className={`text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md border ${group.color}`}>
                    {group.label}
                  </span>
                  <span className="text-[12px] text-[#9a9a95]">{items.filter(i => i.active).length} позиций</span>
                  <div className="flex-1 h-px bg-[#f0f0ec]" />
                </div>

                {/* Таблица группы */}
                <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-[#f0f0ec]">
                        <th className="w-8 pl-3 pr-1 py-2.5"></th>
                        <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest">Название</th>
                        <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest w-20">Ед.</th>
                        <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest w-32">Закупка</th>
                        {group.label === 'Зеркало' && (
                          <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-blue-500 uppercase tracking-widest w-36">Цена калькулятора</th>
                        )}
                        <th className="text-center px-4 py-2.5 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest w-16">НДС</th>
                        <th className="text-center px-4 py-2.5 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest w-24">Наличие</th>
                        <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest">Комментарий</th>
                        <th className="text-center px-4 py-2.5 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest w-24">Фото</th>
                        <th className="w-32 px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(m => (
                        <tr key={m.id}
                          className={`border-b border-[#f8f8f7] last:border-0 transition-colors
                            ${selectedForClear.has(m.id) ? 'bg-red-50' : editingId === m.id ? 'bg-blue-50' : 'hover:bg-[#fafaf9]'}
                            ${!m.active ? 'opacity-35' : ''}`}>
                          <td className="pl-3 pr-1 py-3 w-8">
                            <input type="checkbox" checked={selectedForClear.has(m.id)} onChange={() => toggleClearItem(m.id)} className="w-4 h-4 cursor-pointer" />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-[#111110]">{m.name}</span>
                                {catalogNames.has(m.name.toLowerCase().trim()) && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 border border-orange-200">
                                    дублёр
                                  </span>
                                )}
                              </div>
                              {m.short_name && (
                                <span className="text-[11px] text-[#9a9a95]">→ {m.short_name}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[#6b6b66]">{m.unit}</td>
                          <td className="px-4 py-3 text-right font-mono font-semibold text-[#111110]">
                            {m.cost_price.toLocaleString('ru-RU')} ₽
                          </td>
                          {group.label === 'Зеркало' && (
                            <td className="px-4 py-3 text-right font-mono font-semibold text-blue-600">
                              {m.sale_price ? m.sale_price.toLocaleString('ru-RU') + ' ₽' : <span className="text-orange-400 text-[11px] font-normal">не задана</span>}
                            </td>
                          )}
                          <td className="px-4 py-3 text-center">
                            {m.has_vat
                              ? <span className="text-emerald-600 font-bold text-[11px]">ДА</span>
                              : <span className="text-[#c4c4be]">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => toggleStock(m.id, m.in_stock ?? true)}
                              className={`text-[11px] font-semibold px-2 py-0.5 rounded-md transition-colors ${
                                (m.in_stock ?? true)
                                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                  : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
                              }`}>
                              {(m.in_stock ?? true) ? 'В наличии' : 'Под заказ'}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-[#9a9a95] text-[12px]">{m.comment ?? ''}</td>
                          <td className="px-4 py-3 text-center">
                            {uploadingId === m.id ? (
                              <span className="text-[11px] text-[#9a9a95]">Загрузка...</span>
                            ) : m.image_url ? (
                              <div className="flex items-center justify-center gap-1.5">
                                <img src={m.image_url} alt={m.name} className="h-10 w-10 object-contain rounded border border-[#e4e4e0]" />
                                <button onClick={() => removeImage(m.id)} className="text-[#c4c4be] hover:text-red-400 transition-colors text-[13px]" title="Удалить фото">×</button>
                              </div>
                            ) : (
                              <button onClick={() => triggerUpload(m.id)}
                                className="text-[11px] text-[#9a9a95] hover:text-blue-600 transition-colors">
                                📷
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3 justify-end">
                              <button
                                onClick={() => setTransfer({ material: m, target: '', componentType: '', systemType: 'universal', transferring: false, error: null })}
                                className="text-[12px] text-violet-500 hover:text-violet-700 transition-colors font-medium"
                                title="Перенести в специализированный справочник">
                                ↗ Перенести
                              </button>
                              <button
                                onClick={() => startEdit(m)}
                                className="text-[12px] font-semibold text-blue-600 hover:text-blue-800 transition-colors">
                                Изменить
                              </button>
                              <button
                                onClick={() => toggleActive(m.id, m.active)}
                                className="text-[12px] text-[#9a9a95] hover:text-[#6b6b66] transition-colors">
                                {m.active ? 'Скрыть' : 'Показать'}
                              </button>
                              <button
                                onClick={() => deleteMaterial(m.id, m.name)}
                                className="text-[12px] text-red-400 hover:text-red-600 transition-colors">
                                Удалить
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}

          {/* Прочие категории которые не попали в группы */}
          {(() => {
            const allGroupedCats = GROUPS.flatMap(g => g.categories)
            const otherItems = materials.filter(m =>
              !allGroupedCats.includes(m.category) && (showInactive || m.active)
            )
            if (otherItems.length === 0) return null
            return (
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md border bg-[#f0f0ec] text-[#6b6b66] border-[#e4e4e0]">
                    Прочее
                  </span>
                  <div className="flex-1 h-px bg-[#f0f0ec]" />
                </div>
                <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
                  <table className="w-full text-[13px]">
                    <tbody>
                      {otherItems.map(m => (
                        <tr key={m.id} className={`border-b border-[#f8f8f7] last:border-0 transition-colors ${selectedForClear.has(m.id) ? 'bg-red-50' : 'hover:bg-[#fafaf9]'}`}>
                          <td className="pl-3 pr-1 py-3 w-8">
                            <input type="checkbox" checked={selectedForClear.has(m.id)} onChange={() => toggleClearItem(m.id)} className="w-4 h-4 cursor-pointer" />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-[#111110]">{m.name}</span>
                                {catalogNames.has(m.name.toLowerCase().trim()) && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 border border-orange-200">
                                    дублёр
                                  </span>
                                )}
                              </div>
                              {m.short_name && (
                                <span className="text-[11px] text-[#9a9a95]">→ {m.short_name}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[#9a9a95] text-[11px] uppercase">{m.category}</td>
                          <td className="px-4 py-3 text-[#6b6b66]">{m.unit}</td>
                          <td className="px-4 py-3 text-right font-mono font-semibold">{m.cost_price.toLocaleString('ru-RU')} ₽</td>
                          <td className="px-4 py-3">
                            <div className="flex gap-3 justify-end">
                              <button
                                onClick={() => setTransfer({ material: m, target: '', componentType: '', systemType: 'universal', transferring: false, error: null })}
                                className="text-[12px] text-violet-500 hover:text-violet-700 font-medium">
                                ↗ Перенести
                              </button>
                              <button onClick={() => startEdit(m)} className="text-[12px] font-semibold text-blue-600 hover:text-blue-800">Изменить</button>
                              <button onClick={() => toggleActive(m.id, m.active)} className="text-[12px] text-[#9a9a95] hover:text-[#6b6b66]">{m.active ? 'Скрыть' : 'Показать'}</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
