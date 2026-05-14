'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { B2BService } from '@/lib/types'

const TYPE_LABELS: Record<string, string> = {
  percent: '% от цены изделия',
  per_m2:  '₽ × м² изделия',
  fixed:   '₽ фиксированно',
}

const EMPTY: Omit<B2BService, 'id'> = {
  name: '', type: 'percent', value: 0, cost_price: 0, description: '', active: true, sort_order: 0,
}

export default function B2BServicesPage() {
  const [services, setServices] = useState<B2BService[]>([])
  const [loading, setLoading]   = useState(true)
  const [form, setForm]         = useState(EMPTY)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('b2b_services')
      .select('*')
      .order('sort_order')
      .order('name')
    if (error) setError(error.message)
    else setServices(data ?? [])
    setLoading(false)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const payload = { ...form, value: Number(form.value) || 0, cost_price: Number(form.cost_price) || 0, sort_order: Number(form.sort_order) || 0 }
    if (editingId !== null) {
      const { error } = await supabase.from('b2b_services').update(payload).eq('id', editingId)
      if (error) { setError(error.message); setSaving(false); return }
      setEditingId(null)
    } else {
      const { error } = await supabase.from('b2b_services').insert(payload)
      if (error) { setError(error.message); setSaving(false); return }
    }
    setForm(EMPTY)
    await load()
    setSaving(false)
  }

  async function toggleActive(id: number, active: boolean) {
    const supabase = createClient()
    await supabase.from('b2b_services').update({ active: !active }).eq('id', id)
    await load()
  }

  function startEdit(s: B2BService) {
    setEditingId(s.id)
    setForm({ name: s.name, type: s.type, value: s.value, cost_price: s.cost_price ?? 0, description: s.description, active: s.active, sort_order: s.sort_order })
    setError(null)
  }

  return (
    <div className="max-w-[800px] mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">B2B Доп. услуги</h1>
        <p className="text-[13px] text-[#8a8a85] mt-0.5">Настройка услуг по обработке — добавляются к цене изделия</p>
      </div>

      {/* Справка по типам */}
      <div className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-xl px-4 py-3 mb-6 text-[12px] text-[#6b6b66] space-y-1">
        <p><span className="font-semibold text-[#111110]">% от цены изделия</span> — наценка за сложность (напр. 30% за непрямоугольную форму)</p>
        <p><span className="font-semibold text-[#111110]">₽ × м²</span> — цена умножается на площадь изделия (напр. пескоструй, полимер, триплекс)</p>
        <p><span className="font-semibold text-[#111110]">₽ фиксированно</span> — фиксированная сумма × кол-во штук (напр. макет, сенсорная кнопка)</p>
      </div>

      {/* Форма */}
      <div className={`rounded-xl border p-5 mb-8 transition-all ${editingId !== null ? 'bg-blue-50 border-blue-200' : 'bg-white border-[#e4e4e0]'}`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85]">
            {editingId !== null ? `Редактировать — ID ${editingId}` : 'Добавить услугу'}
          </h2>
          {editingId !== null && (
            <span className="text-[11px] font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-md">Режим редактирования</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Название</label>
            <input
              className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] outline-none focus:border-[#111110] transition-all"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="Изготовление фигурных изделий"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Тип расчёта</label>
            <select
              className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] outline-none focus:border-[#111110] transition-all"
              value={form.type}
              onChange={e => setForm({ ...form, type: e.target.value as B2BService['type'] })}>
              <option value="percent">% от цены изделия</option>
              <option value="per_m2">₽ × м² изделия</option>
              <option value="fixed">₽ фиксированно за шт</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">
              {form.type === 'percent' ? 'Процент (%)' : 'Сумма (₽)'}
            </label>
            <input type="number" min="0"
              className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
              value={form.value}
              onChange={e => setForm({ ...form, value: Number(e.target.value) })}
              placeholder={form.type === 'percent' ? '30' : '1200'}
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">
              Себестоимость (₽{form.type === 'per_m2' ? '/м²' : form.type === 'fixed' ? '/шт' : ''})
            </label>
            <input type="number" min="0"
              className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
              value={form.cost_price}
              onChange={e => setForm({ ...form, cost_price: Number(e.target.value) })}
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Порядок сортировки</label>
            <input type="number" min="0"
              className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
              value={form.sort_order}
              onChange={e => setForm({ ...form, sort_order: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Описание (необязательно)</label>
            <input
              className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] outline-none focus:border-[#111110] transition-all"
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="Пояснение для менеджера"
            />
          </div>
        </div>

        {error && <p className="mt-3 text-[13px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        <div className="flex gap-2 mt-4">
          <button onClick={handleSave} disabled={saving || !form.name.trim()}
            className="bg-[#111110] text-white text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
            {saving ? 'Сохранение...' : editingId !== null ? 'Сохранить' : 'Добавить'}
          </button>
          {editingId !== null && (
            <button onClick={() => { setEditingId(null); setForm(EMPTY); setError(null) }}
              className="bg-[#f0f0ec] text-[#111110] text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#e8e8e4] transition-colors">
              Отмена
            </button>
          )}
        </div>
      </div>

      {/* Список */}
      <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-[13px] text-[#8a8a85]">Загрузка...</div>
        ) : services.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-[#8a8a85]">Нет услуг — добавьте первую</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#f0f0ec]">
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest">Услуга</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest">Тип</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest w-24">Цена</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest w-24">Себест.</th>
                <th className="w-36 px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {services.map(s => (
                <tr key={s.id}
                  className={`border-b border-[#f8f8f7] last:border-0 transition-colors ${editingId === s.id ? 'bg-blue-50' : 'hover:bg-[#fafaf9]'} ${!s.active ? 'opacity-35' : ''}`}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-[#111110]">{s.name}</p>
                    {s.description && <p className="text-[12px] text-[#9a9a95] mt-0.5">{s.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-[#6b6b66]">{TYPE_LABELS[s.type]}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-[#111110]">
                    {s.type === 'percent' ? `${s.value}%` : `${s.value.toLocaleString('ru-RU')} ₽`}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[#6b6b66]">
                    {(s.cost_price ?? 0) > 0
                      ? `${(s.cost_price ?? 0).toLocaleString('ru-RU')} ₽`
                      : <span className="text-[#c4c4be]">—</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 justify-end">
                      <button onClick={() => startEdit(s)} className="text-[12px] font-semibold text-blue-600 hover:text-blue-800 transition-colors">Изменить</button>
                      <button onClick={() => toggleActive(s.id, s.active)} className="text-[12px] text-[#9a9a95] hover:text-[#6b6b66] transition-colors">
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
