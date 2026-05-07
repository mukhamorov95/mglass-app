'use client'

import { useEffect, useState } from 'react'

type Brigade = {
  id:             string
  name:           string
  lead_name:      string | null
  phone:          string | null
  specialization: string[]
  active:         boolean
  notes:          string | null
}

const SPECS = ['Замеры', 'Монтаж зеркал', 'Монтаж лофт', 'Монтаж душевых', 'Монтаж общий', 'Доставка']

const EMPTY: Omit<Brigade, 'id'> = {
  name: '', lead_name: '', phone: '', specialization: [], active: true, notes: '',
}

export default function BrigadesPage() {
  const [brigades, setBrigades] = useState<Brigade[]>([])
  const [loading, setLoading]   = useState(true)
  const [editing, setEditing]   = useState<Brigade | null>(null)
  const [form, setForm]         = useState(EMPTY)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [showForm, setShowForm] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const res  = await fetch('/api/admin/brigades')
    const data = await res.json()
    setBrigades(data)
    setLoading(false)
  }

  function openNew() {
    setEditing(null)
    setForm(EMPTY)
    setError('')
    setShowForm(true)
  }

  function openEdit(b: Brigade) {
    setEditing(b)
    setForm({ name: b.name, lead_name: b.lead_name ?? '', phone: b.phone ?? '', specialization: b.specialization ?? [], active: b.active, notes: b.notes ?? '' })
    setError('')
    setShowForm(true)
  }

  function toggleSpec(spec: string) {
    setForm(f => ({
      ...f,
      specialization: f.specialization.includes(spec)
        ? f.specialization.filter(s => s !== spec)
        : [...f.specialization, spec],
    }))
  }

  async function save() {
    if (!form.name.trim()) { setError('Название обязательно'); return }
    setSaving(true); setError('')
    const res = await fetch('/api/admin/brigades' + (editing ? `/${editing.id}` : ''), {
      method:  editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Ошибка'); setSaving(false); return }
    await load()
    setEditing(null); setForm(EMPTY); setShowForm(false); setSaving(false)
  }

  async function toggle(b: Brigade) {
    await fetch(`/api/admin/brigades/${b.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !b.active }),
    })
    await load()
  }

  const inp = 'w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0071e3]'

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-bold text-[#111110]">Бригады</h1>
          <p className="text-[13px] text-[#8a8a85] mt-0.5">Замерщики и монтажные бригады</p>
        </div>
        <button onClick={openNew}
          className="px-4 py-2 bg-[#111110] text-white text-[13px] font-medium rounded-lg hover:bg-[#2a2a28]">
          + Добавить
        </button>
      </div>

      {showForm && (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-5 mb-4 space-y-3">
          <p className="text-[13px] font-semibold text-[#111110] mb-1">{editing ? 'Редактировать' : 'Новая бригада'}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-[#9a9a95] mb-1">Название бригады *</p>
              <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} className={inp} />
            </div>
            <div>
              <p className="text-[10px] text-[#9a9a95] mb-1">Бригадир / ФИО</p>
              <input value={form.lead_name ?? ''} onChange={e => setForm(f => ({...f, lead_name: e.target.value}))} className={inp} />
            </div>
            <div>
              <p className="text-[10px] text-[#9a9a95] mb-1">Телефон</p>
              <input value={form.phone ?? ''} onChange={e => setForm(f => ({...f, phone: e.target.value}))} className={inp} />
            </div>
          </div>
          <div>
            <p className="text-[10px] text-[#9a9a95] mb-2">Специализация</p>
            <div className="flex flex-wrap gap-2">
              {SPECS.map(spec => (
                <button key={spec} onClick={() => toggleSpec(spec)}
                  className={`px-3 py-1.5 text-[12px] rounded-lg border transition-colors ${
                    form.specialization.includes(spec)
                      ? 'bg-[#111110] text-white border-[#111110]'
                      : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:bg-[#f8f8f7]'
                  }`}>
                  {spec}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] text-[#9a9a95] mb-1">Заметки</p>
            <textarea value={form.notes ?? ''} onChange={e => setForm(f => ({...f, notes: e.target.value}))} rows={2} className={inp + ' resize-none'} />
          </div>
          {error && <p className="text-[12px] text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
              className="px-4 py-2 bg-[#111110] text-white text-[13px] rounded-lg disabled:opacity-40 hover:bg-[#2a2a28]">
              {saving ? 'Сохраняю...' : 'Сохранить'}
            </button>
            <button onClick={() => { setShowForm(false); setEditing(null); setForm(EMPTY) }}
              className="px-4 py-2 border border-[#e4e4e0] text-[13px] text-[#6b6b66] rounded-lg hover:bg-[#f8f8f7]">
              Отмена
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-[13px] text-[#9a9a95] text-center py-8">Загрузка...</p>
      ) : brigades.length === 0 ? (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-12 text-center">
          <p className="text-[13px] text-[#9a9a95]">Бригады не добавлены</p>
        </div>
      ) : (
        <div className="space-y-2">
          {brigades.map(b => (
            <div key={b.id} className={`bg-white border border-[#e4e4e0] rounded-xl px-5 py-4 flex items-start justify-between gap-4 ${!b.active ? 'opacity-50' : ''}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-[14px] font-semibold text-[#111110]">{b.name}</p>
                  {!b.active && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Неактивна</span>}
                </div>
                <div className="flex gap-3 flex-wrap">
                  {b.lead_name && <span className="text-[12px] text-[#6b6b66]">👤 {b.lead_name}</span>}
                  {b.phone     && <span className="text-[12px] text-[#6b6b66]">📞 {b.phone}</span>}
                </div>
                {b.specialization?.length > 0 && (
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {b.specialization.map(s => (
                      <span key={s} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full">{s}</span>
                    ))}
                  </div>
                )}
                {b.notes && <p className="text-[11px] text-[#b4b4b0] mt-1">{b.notes}</p>}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => openEdit(b)}
                  className="px-3 py-1.5 text-[12px] border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-[#f8f8f7]">
                  Изменить
                </button>
                <button onClick={() => toggle(b)}
                  className="px-3 py-1.5 text-[12px] border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-[#f8f8f7]">
                  {b.active ? 'Скрыть' : 'Включить'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
