'use client'

import { useEffect, useState } from 'react'

type Zone = {
  id:          string
  name:        string
  description: string | null
  price:       number
  sort_order:  number
  active:      boolean
}

type FormulaParam = { id: number; section: string; param_key: string; param_name: string; value: number; unit: string }

const EMPTY: Omit<Zone, 'id'> = { name: '', description: '', price: 0, sort_order: 0, active: true }

function fmt(n: number) { return n === 0 ? 'Бесплатно / по договору' : n.toLocaleString('ru-RU') + ' ₽' }

export default function DeliveryZonesPage() {
  const [zones, setZones]     = useState<Zone[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Zone | null>(null)
  const [form, setForm]       = useState(EMPTY)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [showForm, setShowForm] = useState(false)

  const [linearParams, setLinearParams] = useState<FormulaParam[]>([])
  const [linearDraft, setLinearDraft]   = useState<Record<number, string>>({})
  const [linearSaving, setLinearSaving] = useState(false)
  const [linearSaved, setLinearSaved]   = useState(false)

  useEffect(() => { load().catch(() => setLoading(false)) }, [])

  async function load() {
    setLoading(true)
    const [zonesRes, formulaRes] = await Promise.all([
      fetch('/api/admin/delivery-zones'),
      fetch('/api/admin/pricing-formula'),
    ])
    setZones(await zonesRes.json())
    if (formulaRes.ok) {
      const all = await formulaRes.json() as FormulaParam[]
      const delivery = all.filter(p => p.section === 'delivery')
      setLinearParams(delivery)
      const draft: Record<number, string> = {}
      for (const p of delivery) draft[p.id] = String(p.value)
      setLinearDraft(draft)
    }
    setLoading(false)
  }

  async function saveLinear() {
    setLinearSaving(true)
    await Promise.all(linearParams.map(p =>
      fetch('/api/admin/pricing-formula', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, value: Number(linearDraft[p.id]) || 0 }),
      })
    ))
    setLinearSaving(false)
    setLinearSaved(true)
    setTimeout(() => setLinearSaved(false), 2000)
  }

  function openEdit(z: Zone) {
    setEditing(z)
    setForm({ name: z.name, description: z.description ?? '', price: z.price, sort_order: z.sort_order, active: z.active })
    setError('')
    setShowForm(true)
  }

  async function save() {
    if (!form.name.trim()) { setError('Название обязательно'); return }
    setSaving(true); setError('')
    const res = await fetch('/api/admin/delivery-zones' + (editing ? `/${editing.id}` : ''), {
      method:  editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Ошибка'); setSaving(false); return }
    await load()
    setEditing(null); setForm(EMPTY); setShowForm(false); setSaving(false)
  }

  async function toggle(z: Zone) {
    await fetch(`/api/admin/delivery-zones/${z.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !z.active }),
    })
    await load()
  }

  const inp = 'w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0071e3]'

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-bold text-[#111110]">Зоны доставки</h1>
          <p className="text-[13px] text-[#8a8a85] mt-0.5">Стоимость доставки по зонам</p>
        </div>
        <button onClick={() => { setEditing(null); setForm(EMPTY); setShowForm(true) }}
          className="px-4 py-2 bg-[#111110] text-white text-[13px] font-medium rounded-lg hover:bg-[#2a2a28]">
          + Добавить зону
        </button>
      </div>

      {showForm && (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-5 mb-4 space-y-3">
          <p className="text-[13px] font-semibold text-[#111110] mb-1">{editing ? 'Редактировать зону' : 'Новая зона'}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-[#9a9a95] mb-1">Название *</p>
              <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} className={inp} placeholder="В пределах МКАД" />
            </div>
            <div>
              <p className="text-[10px] text-[#9a9a95] mb-1">Стоимость, ₽ (0 = по договору)</p>
              <input type="number" min={0} value={form.price} onChange={e => setForm(f => ({...f, price: Number(e.target.value)}))} className={inp} />
            </div>
          </div>
          <div>
            <p className="text-[10px] text-[#9a9a95] mb-1">Описание</p>
            <input value={form.description ?? ''} onChange={e => setForm(f => ({...f, description: e.target.value}))} className={inp} placeholder="Доставка по Москве" />
          </div>
          <div>
            <p className="text-[10px] text-[#9a9a95] mb-1">Порядок сортировки</p>
            <input type="number" min={0} value={form.sort_order} onChange={e => setForm(f => ({...f, sort_order: Number(e.target.value)}))} className="w-24 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#0071e3]" />
          </div>
          {error && <p className="text-[12px] text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
              className="px-4 py-2 bg-[#111110] text-white text-[13px] rounded-lg disabled:opacity-40 hover:bg-[#2a2a28]">
              {saving ? 'Сохраняю...' : 'Сохранить'}
            </button>
            <button onClick={() => { setShowForm(false); setEditing(null) }}
              className="px-4 py-2 border border-[#e4e4e0] text-[13px] text-[#6b6b66] rounded-lg hover:bg-[#f8f8f7]">
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Linear MKAD delivery settings */}
      {linearParams.length > 0 && (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[14px] font-semibold text-[#111110]">Линейная доставка за МКАД</p>
              <p className="text-[12px] text-[#8a8a85] mt-0.5">Базовая стоимость + стоимость за каждый км от МКАД</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            {linearParams.map(p => (
              <div key={p.id}>
                <p className="text-[10px] text-[#9a9a95] mb-1">{p.param_name}, {p.unit}</p>
                <input
                  type="number" min="0"
                  value={linearDraft[p.id] ?? ''}
                  onChange={e => setLinearDraft(d => ({ ...d, [p.id]: e.target.value }))}
                  className={inp}
                />
              </div>
            ))}
          </div>
          {linearParams.length >= 2 && (() => {
            const bp  = Number(linearDraft[linearParams.find(p => p.param_key === 'base_price')?.id ?? 0]) || 0
            const pkm = Number(linearDraft[linearParams.find(p => p.param_key === 'price_per_km')?.id ?? 0]) || 0
            return (
              <div className="mb-3 text-[12px] text-[#6b6b66] bg-[#f8f8f7] rounded-lg px-3 py-2 space-y-0.5">
                <p>5 км: {(bp + pkm * 5).toLocaleString('ru-RU')} ₽</p>
                <p>20 км: {(bp + pkm * 20).toLocaleString('ru-RU')} ₽</p>
                <p>50 км: {(bp + pkm * 50).toLocaleString('ru-RU')} ₽</p>
              </div>
            )
          })()}
          <button onClick={saveLinear} disabled={linearSaving}
            className="px-4 py-2 bg-[#111110] text-white text-[13px] rounded-lg disabled:opacity-40 hover:bg-[#2a2a28]">
            {linearSaved ? 'Сохранено' : linearSaving ? 'Сохраняю...' : 'Сохранить тарифы'}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-center text-[#9a9a95] text-[13px] py-8">Загрузка...</p>
      ) : (
        <div className="space-y-2">
          {zones.map(z => (
            <div key={z.id} className={`bg-white border border-[#e4e4e0] rounded-xl px-5 py-4 flex items-center justify-between gap-4 ${!z.active ? 'opacity-50' : ''}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[14px] font-semibold text-[#111110]">{z.name}</p>
                  {!z.active && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Скрыта</span>}
                </div>
                {z.description && <p className="text-[12px] text-[#6b6b66] mt-0.5">{z.description}</p>}
              </div>
              <div className="text-right flex-shrink-0 min-w-[130px]">
                <p className={`text-[15px] font-bold font-mono ${z.price === 0 ? 'text-[#9a9a95]' : 'text-[#111110]'}`}>{fmt(z.price)}</p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => openEdit(z)}
                  className="px-3 py-1.5 text-[12px] border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-[#f8f8f7]">
                  Изменить
                </button>
                <button onClick={() => toggle(z)}
                  className="px-3 py-1.5 text-[12px] border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-[#f8f8f7]">
                  {z.active ? 'Скрыть' : 'Включить'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
