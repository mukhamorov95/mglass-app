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

type BrigadeStats = { brigade_id: string; avg_rating: number; count: number }

const SPECS = ['Замеры', 'Монтаж зеркал', 'Монтаж лофт', 'Монтаж душевых', 'Монтаж общий', 'Доставка']

const EMPTY: Omit<Brigade, 'id'> = {
  name: '', lead_name: '', phone: '', specialization: [], active: true, notes: '',
}

export default function BrigadesPage() {
  const [brigades, setBrigades] = useState<Brigade[]>([])
  const [stats, setStats]       = useState<Record<string, BrigadeStats>>({})
  const [loading, setLoading]   = useState(true)
  const [editing, setEditing]   = useState<Brigade | null>(null)
  const [form, setForm]         = useState(EMPTY)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [showForm, setShowForm] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [brigRes, statsRes] = await Promise.all([
      fetch('/api/admin/brigades'),
      fetch('/api/admin/brigades/stats'),
    ])
    const brigData  = await brigRes.json()
    const statsData: BrigadeStats[] = statsRes.ok ? await statsRes.json() : []
    setBrigades(brigData)
    setStats(Object.fromEntries(statsData.map(s => [s.brigade_id, s])))
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

  const inp = 'w-full border border-line rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0071e3]'

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-semibold text-ink">Бригады</h1>
          <p className="text-[13px] text-muted mt-0.5">Замерщики и монтажные бригады</p>
        </div>
        <button onClick={openNew}
          className="px-4 py-2 bg-ink text-white text-[13px] font-medium rounded-lg hover:bg-[#2a2a28]">
          + Добавить
        </button>
      </div>

      {showForm && (
        <div className="bg-surface border border-line rounded-xl p-5 mb-4 space-y-3">
          <p className="text-[13px] font-semibold text-ink mb-1">{editing ? 'Редактировать' : 'Новая бригада'}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-muted mb-1">Название бригады *</p>
              <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} className={inp} />
            </div>
            <div>
              <p className="text-[10px] text-muted mb-1">Бригадир / ФИО</p>
              <input value={form.lead_name ?? ''} onChange={e => setForm(f => ({...f, lead_name: e.target.value}))} className={inp} />
            </div>
            <div>
              <p className="text-[10px] text-muted mb-1">Телефон</p>
              <input value={form.phone ?? ''} onChange={e => setForm(f => ({...f, phone: e.target.value}))} className={inp} />
            </div>
          </div>
          <div>
            <p className="text-[10px] text-muted mb-2">Специализация</p>
            <div className="flex flex-wrap gap-2">
              {SPECS.map(spec => (
                <button key={spec} onClick={() => toggleSpec(spec)}
                  className={`px-3 py-1.5 text-[12px] rounded-lg border transition-colors ${
                    form.specialization.includes(spec)
                      ? 'bg-ink text-white border-ink'
                      : 'bg-surface text-ink-soft border-line hover:bg-canvas'
                  }`}>
                  {spec}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] text-muted mb-1">Заметки</p>
            <textarea value={form.notes ?? ''} onChange={e => setForm(f => ({...f, notes: e.target.value}))} rows={2} className={inp + ' resize-none'} />
          </div>
          {error && <p className="text-[12px] text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
              className="px-4 py-2 bg-ink text-white text-[13px] rounded-lg disabled:opacity-40 hover:bg-[#2a2a28]">
              {saving ? 'Сохраняю...' : 'Сохранить'}
            </button>
            <button onClick={() => { setShowForm(false); setEditing(null); setForm(EMPTY) }}
              className="px-4 py-2 border border-line text-[13px] text-ink-soft rounded-lg hover:bg-canvas">
              Отмена
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-[13px] text-muted text-center py-8">Загрузка...</p>
      ) : brigades.length === 0 ? (
        <div className="bg-surface border border-line rounded-xl p-12 text-center">
          <p className="text-[13px] text-muted">Бригады не добавлены</p>
        </div>
      ) : (
        <div className="space-y-2">
          {brigades.map(b => (
            <div key={b.id} className={`bg-surface border border-line rounded-xl px-5 py-4 flex items-start justify-between gap-4 ${!b.active ? 'opacity-50' : ''}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <p className="text-[14px] font-semibold text-ink">{b.name}</p>
                  {!b.active && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Неактивна</span>}
                  {stats[b.id] && (
                    <span className="text-[11px] text-amber-600 font-semibold tabular-nums">
                      ★ {stats[b.id].avg_rating.toFixed(1)}
                      <span className="text-faint font-normal ml-1">({stats[b.id].count} оц.)</span>
                    </span>
                  )}
                </div>
                <div className="flex gap-3 flex-wrap">
                  {b.lead_name && <span className="text-[12px] text-ink-soft">👤 {b.lead_name}</span>}
                  {b.phone     && <span className="text-[12px] text-ink-soft">📞 {b.phone}</span>}
                </div>
                {b.specialization?.length > 0 && (
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {b.specialization.map(s => (
                      <span key={s} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full">{s}</span>
                    ))}
                  </div>
                )}
                {b.notes && <p className="text-[11px] text-faint mt-1">{b.notes}</p>}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => openEdit(b)}
                  className="px-3 py-1.5 text-[12px] border border-line rounded-lg text-ink-soft hover:bg-canvas">
                  Изменить
                </button>
                <button onClick={() => toggle(b)}
                  className="px-3 py-1.5 text-[12px] border border-line rounded-lg text-ink-soft hover:bg-canvas">
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
