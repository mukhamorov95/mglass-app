'use client'

import { useEffect, useState } from 'react'

type Supplier = {
  id:        string
  name:      string
  contact:   string | null
  phone:     string | null
  email:     string | null
  materials: string | null
  notes:     string | null
  active:    boolean
}

const EMPTY: Omit<Supplier, 'id'> = {
  name: '', contact: '', phone: '', email: '', materials: '', notes: '', active: true,
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading]     = useState(true)
  const [editing, setEditing]     = useState<Supplier | null>(null)
  const [form, setForm]           = useState(EMPTY)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const [search, setSearch]       = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const res  = await fetch('/api/admin/suppliers')
    const data = await res.json()
    setSuppliers(data)
    setLoading(false)
  }

  function openNew() {
    setEditing(null)
    setForm(EMPTY)
    setError('')
  }

  function openEdit(s: Supplier) {
    setEditing(s)
    setForm({ name: s.name, contact: s.contact ?? '', phone: s.phone ?? '', email: s.email ?? '', materials: s.materials ?? '', notes: s.notes ?? '', active: s.active })
    setError('')
  }

  async function save() {
    if (!form.name.trim()) { setError('Название обязательно'); return }
    setSaving(true)
    setError('')
    const res = await fetch('/api/admin/suppliers' + (editing ? `/${editing.id}` : ''), {
      method:  editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Ошибка'); setSaving(false); return }
    await load()
    setEditing(null)
    setForm(EMPTY)
    setSaving(false)
  }

  async function toggle(s: Supplier) {
    await fetch(`/api/admin/suppliers/${s.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ active: !s.active }),
    })
    await load()
  }

  const visible = suppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.materials ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const inp = 'w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0071e3]'

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-bold text-[#111110]">Поставщики</h1>
          <p className="text-[13px] text-[#8a8a85] mt-0.5">Справочник поставщиков материалов</p>
        </div>
        <button onClick={openNew}
          className="px-4 py-2 bg-[#111110] text-white text-[13px] font-medium rounded-lg hover:bg-[#2a2a28]">
          + Добавить
        </button>
      </div>

      <input
        value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Поиск по названию или материалам..."
        className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] mb-4 outline-none focus:border-[#0071e3]"
      />

      {/* Form */}
      {(editing !== null || form !== EMPTY) && (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-5 mb-4 space-y-3">
          <p className="text-[13px] font-semibold text-[#111110] mb-1">{editing ? 'Редактировать' : 'Новый поставщик'}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-[#9a9a95] mb-1">Название *</p>
              <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} className={inp} />
            </div>
            <div>
              <p className="text-[10px] text-[#9a9a95] mb-1">Контактное лицо</p>
              <input value={form.contact ?? ''} onChange={e => setForm(f => ({...f, contact: e.target.value}))} className={inp} />
            </div>
            <div>
              <p className="text-[10px] text-[#9a9a95] mb-1">Телефон</p>
              <input value={form.phone ?? ''} onChange={e => setForm(f => ({...f, phone: e.target.value}))} className={inp} />
            </div>
            <div>
              <p className="text-[10px] text-[#9a9a95] mb-1">Email</p>
              <input value={form.email ?? ''} onChange={e => setForm(f => ({...f, email: e.target.value}))} className={inp} />
            </div>
          </div>
          <div>
            <p className="text-[10px] text-[#9a9a95] mb-1">Материалы / Номенклатура</p>
            <input value={form.materials ?? ''} onChange={e => setForm(f => ({...f, materials: e.target.value}))} placeholder="Зеркало, профиль, фурнитура..." className={inp} />
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
            <button onClick={() => { setEditing(null); setForm(EMPTY) }}
              className="px-4 py-2 border border-[#e4e4e0] text-[13px] text-[#6b6b66] rounded-lg hover:bg-[#f8f8f7]">
              Отмена
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-[13px] text-[#9a9a95] text-center py-8">Загрузка...</p>
      ) : visible.length === 0 ? (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-12 text-center">
          <p className="text-[13px] text-[#9a9a95]">Поставщики не найдены</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(s => (
            <div key={s.id} className={`bg-white border border-[#e4e4e0] rounded-xl px-5 py-4 flex items-start justify-between gap-4 ${!s.active ? 'opacity-50' : ''}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-[14px] font-semibold text-[#111110]">{s.name}</p>
                  {!s.active && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Неактивен</span>}
                </div>
                {s.materials && <p className="text-[12px] text-[#6b6b66]">Материалы: {s.materials}</p>}
                <div className="flex gap-3 mt-1 flex-wrap">
                  {s.contact && <span className="text-[11px] text-[#9a9a95]">👤 {s.contact}</span>}
                  {s.phone   && <span className="text-[11px] text-[#9a9a95]">📞 {s.phone}</span>}
                  {s.email   && <span className="text-[11px] text-[#9a9a95]">✉ {s.email}</span>}
                </div>
                {s.notes && <p className="text-[11px] text-[#b4b4b0] mt-1">{s.notes}</p>}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => openEdit(s)}
                  className="px-3 py-1.5 text-[12px] border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-[#f8f8f7]">
                  Изменить
                </button>
                <button onClick={() => toggle(s)}
                  className="px-3 py-1.5 text-[12px] border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-[#f8f8f7]">
                  {s.active ? 'Скрыть' : 'Включить'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
