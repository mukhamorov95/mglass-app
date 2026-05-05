'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { Service } from '@/lib/types'

const EMPTY: Omit<Service, 'id'> = { name: '', unit: 'шт', cost_price: 0, sale_price: null, active: true, comment: null }

export default function ServicesAdminPage() {
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const { data, error } = await supabase.from('services').select('*').order('name')
    if (error) setError(error.message)
    else setServices(data ?? [])
    setLoading(false)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const payload = {
      ...form,
      cost_price: Number(form.cost_price),
      sale_price: form.sale_price ? Number(form.sale_price) : null,
    }
    if (editingId !== null) {
      const { error } = await supabase.from('services').update(payload).eq('id', editingId)
      if (error) { setError(error.message); setSaving(false); return }
      setEditingId(null)
    } else {
      const { error } = await supabase.from('services').insert(payload)
      if (error) { setError(error.message); setSaving(false); return }
    }
    setForm(EMPTY)
    await load()
    setSaving(false)
  }

  async function toggleActive(id: number, active: boolean) {
    const supabase = createClient()
    await supabase.from('services').update({ active: !active }).eq('id', id)
    await load()
  }

  function startEdit(s: Service) {
    setEditingId(s.id)
    setForm({ name: s.name, unit: s.unit, cost_price: s.cost_price, sale_price: s.sale_price, active: s.active, comment: s.comment })
    setError(null)
  }

  return (
    <div className="max-w-[900px] mx-auto px-6 py-8">

      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">Услуги</h1>
        <p className="text-[13px] text-[#8a8a85] mt-0.5">{services.filter(s => s.active).length} активных позиций</p>
      </div>

      <div className={`rounded-xl border p-5 mb-8 transition-all ${editingId !== null ? 'bg-blue-50 border-blue-200' : 'bg-white border-[#e4e4e0]'}`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85]">
            {editingId !== null ? `Редактировать — ID ${editingId}` : 'Добавить услугу'}
          </h2>
          {editingId !== null && (
            <span className="text-[11px] font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-md">Режим редактирования</span>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="col-span-2">
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Название</label>
            <input
              className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] outline-none focus:border-[#111110] transition-all"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="Название услуги"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Единица</label>
            <select
              className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] outline-none focus:border-[#111110] transition-all"
              value={form.unit}
              onChange={e => setForm({ ...form, unit: e.target.value })}>
              {['шт', 'м²', 'пог.м', 'заказ', 'этаж', 'изделие'].map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Себестоимость (₽)</label>
            <input type="number"
              className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
              value={form.cost_price}
              onChange={e => setForm({ ...form, cost_price: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Цена продажи (₽)</label>
            <input type="number"
              className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
              value={form.sale_price ?? ''}
              onChange={e => setForm({ ...form, sale_price: e.target.value ? Number(e.target.value) : null })}
              placeholder="пусто = по финмодели"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Комментарий</label>
            <input
              className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] outline-none focus:border-[#111110] transition-all"
              value={form.comment ?? ''}
              onChange={e => setForm({ ...form, comment: e.target.value })}
              placeholder="Необязательно"
            />
          </div>
        </div>

        {error && <p className="mt-3 text-[13px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        <div className="flex gap-2 mt-4">
          <button onClick={handleSave} disabled={saving || !form.name}
            className="bg-[#111110] text-white text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
            {saving ? 'Сохранение...' : editingId !== null ? 'Сохранить изменения' : 'Добавить позицию'}
          </button>
          {editingId !== null && (
            <button onClick={() => { setEditingId(null); setForm(EMPTY); setError(null) }}
              className="bg-[#f0f0ec] text-[#111110] text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#e8e8e4] transition-colors">
              Отмена
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-[13px] text-[#8a8a85]">Загрузка...</div>
        ) : services.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-[#8a8a85]">Нет услуг</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#f0f0ec]">
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest">Название</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest w-20">Ед.</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest w-36">Себестоимость</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest w-36">Цена продажи</th>
                <th className="w-36 px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {services.map(s => (
                <tr key={s.id}
                  className={`border-b border-[#f8f8f7] last:border-0 transition-colors
                    ${editingId === s.id ? 'bg-blue-50' : 'hover:bg-[#fafaf9]'}
                    ${!s.active ? 'opacity-35' : ''}`}>
                  <td className="px-4 py-3 font-medium text-[#111110]">{s.name}</td>
                  <td className="px-4 py-3 text-[#6b6b66]">{s.unit}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-[#111110]">
                    {s.cost_price.toLocaleString('ru-RU')} ₽
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[#6b6b66]">
                    {s.sale_price ? `${s.sale_price.toLocaleString('ru-RU')} ₽` : <span className="text-[#c4c4be]">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 justify-end">
                      <button onClick={() => startEdit(s)}
                        className="text-[12px] font-semibold text-blue-600 hover:text-blue-800 transition-colors">
                        Изменить
                      </button>
                      <button onClick={() => toggleActive(s.id, s.active)}
                        className="text-[12px] text-[#9a9a95] hover:text-[#6b6b66] transition-colors">
                        {s.active ? 'Скрыть' : 'Показать'}
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
