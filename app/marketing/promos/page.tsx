'use client'

import { useEffect, useState } from 'react'

type Promo = {
  id: number
  name: string
  type: string
  description: string | null
  discount_value: number | null
  conditions: string | null
  target: string
  start_date: string | null
  end_date: string | null
  active: boolean
  margin_safe: boolean
}

const TYPES = [
  { v: 'free_measurement', l: 'Бесплатный замер' },
  { v: 'free_delivery',    l: 'Бесплатная доставка' },
  { v: 'discount',         l: 'Скидка %' },
  { v: 'gift',             l: 'Подарок' },
  { v: 'partner_bonus',    l: 'Бонус партнёру' },
  { v: 'b2b_trial',        l: 'B2B тест' },
  { v: 'seasonal',         l: 'Сезонная акция' },
  { v: 'custom',           l: 'Другое' },
]

const TARGETS = [
  { v: 'all',      l: 'Все' },
  { v: 'b2c',      l: 'B2C' },
  { v: 'b2b',      l: 'B2B' },
  { v: 'designer', l: 'Дизайнеры' },
  { v: 'foreman',  l: 'Прорабы' },
]

const EMPTY: Omit<Promo, 'id'> = {
  name: '', type: 'discount', description: '', discount_value: null,
  conditions: '', target: 'all', start_date: null, end_date: null, active: true, margin_safe: true,
}

export default function PromoCenterPage() {
  const [promos, setPromos] = useState<Promo[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<Omit<Promo, 'id'>>(EMPTY)
  const [editId, setEditId] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const res = await fetch('/api/marketing/promos')
    setPromos(res.ok ? await res.json() : [])
    setLoading(false)
  }

  async function toggle(p: Promo) {
    await fetch('/api/marketing/promos', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, active: !p.active }) })
    setPromos(prev => prev.map(x => x.id === p.id ? { ...x, active: !x.active } : x))
  }

  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    const method = editId ? 'PUT' : 'POST'
    const body = editId ? { id: editId, ...form } : form
    await fetch('/api/marketing/promos', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setSaving(false)
    setShowForm(false)
    load()
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка...</div>

  const active = promos.filter(p => p.active)
  const inactive = promos.filter(p => !p.active)

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-[#111110] tracking-tight">Promo Center</h1>
          <p className="text-[13px] text-[#6b6b66] mt-1">{active.length} активных акций</p>
        </div>
        <button onClick={() => { setForm(EMPTY); setEditId(null); setShowForm(true) }}
          className="flex-shrink-0 px-4 py-2 bg-[#111110] text-white rounded-xl text-[13px] font-medium hover:bg-[#333] transition-colors">
          + Акция
        </button>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
        <p className="text-[12px] font-semibold text-amber-800 mb-1">Правило маржи</p>
        <p className="text-[12px] text-amber-700">Каждая акция должна быть проверена на маржинальность. Акции, помеченные как «безопасные», не снижают маржу ниже 25%.</p>
      </div>

      <div className="space-y-3">
        {promos.length === 0 && <div className="text-center py-16 text-[13px] text-[#8a8a85]">Нет акций. Нажмите «+ Акция».</div>}
        {[...active, ...inactive].map(p => (
          <div key={p.id} className={`bg-white border rounded-xl p-4 ${p.active ? 'border-[#e4e4e0]' : 'border-[#f0f0ec] opacity-60'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-[14px] font-semibold text-[#111110]">{p.name}</span>
                  {p.active
                    ? <span className="text-[11px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Активна</span>
                    : <span className="text-[11px] bg-[#f5f5f0] text-[#8a8a85] px-2 py-0.5 rounded-full">Выключена</span>
                  }
                  {p.margin_safe && <span className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">✓ Маржа ок</span>}
                  {p.discount_value && <span className="text-[11px] bg-red-50 text-red-700 px-2 py-0.5 rounded-full font-medium">−{p.discount_value}%</span>}
                  <span className="text-[11px] bg-[#f0f0ec] text-[#6b6b66] px-2 py-0.5 rounded-full">
                    {TARGETS.find(t => t.v === p.target)?.l ?? p.target}
                  </span>
                </div>
                {p.description && <p className="text-[12px] text-[#6b6b66] mb-1">{p.description}</p>}
                {p.conditions && <p className="text-[12px] text-amber-700 bg-amber-50 rounded px-2 py-1">Условие: {p.conditions}</p>}
                {(p.start_date || p.end_date) && (
                  <p className="text-[12px] text-[#8a8a85] mt-1">
                    {p.start_date ? `с ${p.start_date}` : ''}{p.end_date ? ` по ${p.end_date}` : ''}
                  </p>
                )}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => toggle(p)}
                  className="text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors">
                  {p.active ? 'Откл.' : 'Вкл.'}
                </button>
                <button onClick={() => { const { id, ...rest } = p; setForm(rest); setEditId(id); setShowForm(true) }}
                  className="text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors">
                  Ред.
                </button>
                <button onClick={async () => { if (!confirm('Удалить?')) return; await fetch('/api/marketing/promos', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id }) }); setPromos(prev => prev.filter(x => x.id !== p.id)) }}
                  className="text-[12px] px-2 py-1.5 text-red-400 hover:text-red-600 transition-colors">✕</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-[16px] font-semibold text-[#111110] mb-5">{editId ? 'Редактировать акцию' : 'Новая акция'}</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Название *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Бесплатный замер на апрель"
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Тип</label>
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[12px] bg-white">
                    {TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Аудитория</label>
                  <select value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[12px] bg-white">
                    {TARGETS.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Описание</label>
                <input type="text" value={form.description ?? ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Скидка (%)</label>
                  <input type="number" value={form.discount_value ?? ''} onChange={e => setForm(f => ({ ...f, discount_value: e.target.value ? Number(e.target.value) : null }))}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Условие</label>
                <input type="text" value={form.conditions ?? ''} onChange={e => setForm(f => ({ ...f, conditions: e.target.value }))}
                  placeholder="При заказе от 50 000 ₽"
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Начало</label>
                  <input type="date" value={form.start_date ?? ''} onChange={e => setForm(f => ({ ...f, start_date: e.target.value || null }))}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[12px]" />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#6b6b66] mb-1">Конец</label>
                  <input type="date" value={form.end_date ?? ''} onChange={e => setForm(f => ({ ...f, end_date: e.target.value || null }))}
                    className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[12px]" />
                </div>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} className="w-4 h-4 rounded" />
                  <span className="text-[13px]">Активна</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.margin_safe} onChange={e => setForm(f => ({ ...f, margin_safe: e.target.checked }))} className="w-4 h-4 rounded" />
                  <span className="text-[13px]">Маржа ок (≥25%)</span>
                </label>
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button onClick={save} disabled={saving}
                className="px-5 py-2 bg-[#111110] text-white rounded-xl text-[13px] font-medium disabled:opacity-50 transition-colors">
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button onClick={() => setShowForm(false)}
                className="px-5 py-2 border border-[#e4e4e0] rounded-xl text-[13px] text-[#6b6b66] hover:bg-[#f5f5f0] transition-colors">Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
