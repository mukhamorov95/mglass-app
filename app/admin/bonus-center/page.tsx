'use client'

import { useEffect, useState } from 'react'

type Bonus = {
  id: number
  name: string
  description: string | null
  type: string
  value: string | null
  conditions: string | null
  active: boolean
  sort_order: number
}

const TYPE_LABELS: Record<string, string> = {
  free_measurement:      'Бесплатный замер',
  free_delivery:         'Бесплатная доставка',
  discount_installation: 'Скидка на монтаж',
  film:                  'Плёнка безопасности',
  hw_upgrade:            'Upgrade фурнитуры',
  premium_lighting:      'Премиум подсветка',
  second_order:          'Скидка на 2-й заказ',
  custom:                'Другое',
}

const BONUS_TYPES = Object.entries(TYPE_LABELS)

const EMPTY: Omit<Bonus, 'id' | 'sort_order'> = {
  name: '', description: '', type: 'free_measurement',
  value: '', conditions: '', active: true,
}

export default function BonusCenterPage() {
  const [bonuses, setBonuses] = useState<Bonus[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<Omit<Bonus, 'id' | 'sort_order'>>(EMPTY)
  const [editId, setEditId] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { load().catch(() => setLoading(false)) }, [])

  async function load() {
    setLoading(true)
    const res = await fetch('/api/admin/sales-bonuses')
    setBonuses(res.ok ? await res.json() : [])
    setLoading(false)
  }

  async function toggle(b: Bonus) {
    await fetch('/api/admin/sales-bonuses', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: b.id, active: !b.active }),
    })
    setBonuses(prev => prev.map(x => x.id === b.id ? { ...x, active: !x.active } : x))
  }

  function startEdit(b: Bonus) {
    setForm({ name: b.name, description: b.description ?? '', type: b.type, value: b.value ?? '', conditions: b.conditions ?? '', active: b.active })
    setEditId(b.id)
    setShowForm(true)
    setError(null)
  }

  function startNew() {
    setForm(EMPTY)
    setEditId(null)
    setShowForm(true)
    setError(null)
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Укажите название бонуса'); return }
    setSaving(true)
    setError(null)
    const res = await fetch('/api/admin/sales-bonuses', {
      method: editId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editId ? { id: editId, ...form } : form),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) { setError(json.error ?? 'Ошибка'); return }
    setShowForm(false)
    load()
  }

  async function handleDelete(id: number) {
    if (!confirm('Удалить бонус?')) return
    await fetch('/api/admin/sales-bonuses', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setBonuses(prev => prev.filter(b => b.id !== id))
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка...</div>
  )

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider mb-1">Только для владельца</p>
          <h1 className="text-[22px] font-bold text-[#111110] tracking-tight">Bonus Center</h1>
          <p className="text-[13px] text-[#6b6b66] mt-1">
            AI Sales Manager использует активные бонусы при работе с клиентом.
            Бонусы предлагаются только при наличии явного повода — не раздаются бездумно.
          </p>
        </div>
        <button
          onClick={startNew}
          className="flex-shrink-0 px-4 py-2 bg-[#111110] text-white rounded-xl text-[13px] font-medium hover:bg-[#333] transition-colors"
        >
          + Добавить
        </button>
      </div>

      {/* How AI uses bonuses */}
      <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4">
        <p className="text-[12px] font-semibold text-amber-800 mb-1">Как AI использует бонусы</p>
        <ul className="text-[12px] text-amber-700 space-y-0.5 list-disc list-inside">
          <li>Бонус предлагается только если клиент сомневается, говорит &quot;дорого&quot; или нужна доп. мотивация</li>
          <li>AI не раздаёт бонусы автоматически каждому — только при явном поводе</li>
          <li>Неактивные бонусы AI не видит и не предлагает</li>
          <li>Условия показываются менеджеру, чтобы он знал, когда предлагать</li>
        </ul>
      </div>

      {/* Bonuses list */}
      <div className="space-y-3">
        {bonuses.length === 0 && (
          <div className="text-center py-10 text-[13px] text-[#8a8a85]">Нет бонусов</div>
        )}
        {bonuses.map(b => (
          <div key={b.id} className={`bg-white border rounded-xl p-4 transition-opacity ${b.active ? 'border-[#e4e4e0]' : 'border-[#f0f0ec] opacity-50'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-semibold text-[#111110]">{b.name}</span>
                  <span className="text-[11px] bg-[#f0f0ec] text-[#6b6b66] px-2 py-0.5 rounded-full">
                    {TYPE_LABELS[b.type] ?? b.type}
                  </span>
                  {b.value && (
                    <span className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                      {b.value}%
                    </span>
                  )}
                  {b.active
                    ? <span className="text-[11px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Активен</span>
                    : <span className="text-[11px] bg-[#f5f5f0] text-[#8a8a85] px-2 py-0.5 rounded-full">Выключен</span>
                  }
                </div>
                {b.description && <p className="text-[12px] text-[#6b6b66] mt-1">{b.description}</p>}
                {b.conditions && (
                  <p className="text-[12px] text-amber-700 mt-1.5 bg-amber-50 rounded-lg px-2 py-1">
                    <span className="font-medium">Когда предлагать:</span> {b.conditions}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => toggle(b)}
                  className={`text-[12px] px-3 py-1.5 rounded-lg border transition-colors ${
                    b.active
                      ? 'border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f0]'
                      : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                  }`}
                >
                  {b.active ? 'Откл.' : 'Вкл.'}
                </button>
                <button
                  onClick={() => startEdit(b)}
                  className="text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors"
                >
                  Изменить
                </button>
                <button
                  onClick={() => handleDelete(b.id)}
                  className="text-[12px] px-2 py-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-[16px] font-semibold text-[#111110] mb-5">
              {editId ? 'Изменить бонус' : 'Новый бонус'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Название</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Бесплатный замер"
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Тип</label>
                <select
                  value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
                >
                  {BONUS_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Описание</label>
                <input
                  type="text"
                  value={form.description ?? ''}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Краткое описание бонуса"
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Значение (% или описание)</label>
                <input
                  type="text"
                  value={form.value ?? ''}
                  onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                  placeholder="10 (для скидок) или оставьте пустым"
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Когда предлагать (условие)</label>
                <textarea
                  value={form.conditions ?? ''}
                  onChange={e => setForm(f => ({ ...f, conditions: e.target.value }))}
                  rows={2}
                  placeholder="При заказе от 50 000 ₽ или если клиент колеблется"
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                  className="w-4 h-4 rounded"
                />
                <span className="text-[13px] text-[#111110]">Активен (AI видит этот бонус)</span>
              </label>
            </div>
            {error && <p className="mt-3 text-[12px] text-red-500">{error}</p>}
            <div className="mt-5 flex gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 bg-[#111110] text-white rounded-xl text-[13px] font-medium hover:bg-[#333] disabled:opacity-50 transition-colors"
              >
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="px-5 py-2 border border-[#e4e4e0] rounded-xl text-[13px] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
