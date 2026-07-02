'use client'

import { useEffect, useState } from 'react'

type Stop = {
  id?: number
  route_id?: number
  position: number
  supplier_name: string
  address: string
  contact_name: string
  contact_phone: string
  what_to_pick: string
  order_ref: string
  work_hours: string
  comment: string
  status: 'pending' | 'completed' | 'problem'
}

type Route = {
  id: number
  route_date: string
  driver_name: string
  status: string
  notes: string | null
}

const EMPTY_STOP: Omit<Stop, 'id' | 'route_id'> = {
  position: 0, supplier_name: '', address: '', contact_name: '', contact_phone: '',
  what_to_pick: '', order_ref: '', work_hours: '', comment: '', status: 'pending',
}

export default function ProcurementRoutesPage() {
  const [routes,   setRoutes]   = useState<Route[]>([])
  const [selected, setSelected] = useState<Route | null>(null)
  const [stops,    setStops]    = useState<Stop[]>([])
  const [loading,  setLoading]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [printMode, setPrint]   = useState(false)

  const today = new Date().toISOString().slice(0, 10)
  const [newDate,   setNewDate]   = useState(today)
  const [newDriver, setNewDriver] = useState('Сергей Васильевич')

  useEffect(() => { loadRoutes().catch(() => setLoading(false)) }, [])

  async function loadRoutes() {
    const res = await fetch('/api/admin/procurement-routes')
    setRoutes(res.ok ? await res.json() : [])
  }

  async function selectRoute(r: Route) {
    setSelected(r); setLoading(true)
    const res = await fetch(`/api/admin/procurement-routes?route_id=${r.id}`)
    setStops(res.ok ? await res.json() : [])
    setLoading(false)
  }

  async function createRoute() {
    const res = await fetch('/api/admin/procurement-routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route_date: newDate, driver_name: newDriver, status: 'draft' }),
    })
    if (res.ok) {
      const r = await res.json()
      await loadRoutes()
      setSelected(r)
      setStops([])
    }
  }

  async function addStop() {
    if (!selected) return
    const pos  = stops.length
    const stop = { ...EMPTY_STOP, position: pos, route_id: selected.id }
    const res  = await fetch('/api/admin/procurement-routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _type: 'stop', ...stop }),
    })
    if (res.ok) {
      const s = await res.json()
      setStops(prev => [...prev, { ...stop, id: s.id }])
    }
  }

  async function updateStop(idx: number, key: keyof Stop, value: string) {
    const stop = { ...stops[idx], [key]: value }
    setStops(prev => prev.map((s, i) => i === idx ? stop : s))
    if (stop.id) {
      await fetch('/api/admin/procurement-routes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _type: 'stop', id: stop.id, [key]: value }),
      })
    }
  }

  async function removeStop(idx: number) {
    const stop = stops[idx]
    if (stop.id) {
      await fetch('/api/admin/procurement-routes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _type: 'stop', id: stop.id }),
      })
    }
    setStops(prev => prev.filter((_, i) => i !== idx))
  }

  async function deleteRoute(id: number) {
    if (!confirm('Удалить маршрут?')) return
    await fetch('/api/admin/procurement-routes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _type: 'route', id }),
    })
    setSelected(null); setStops([])
    loadRoutes()
  }

  function fmtDate(d: string) {
    return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' })
  }

  const statusColors = {
    pending:   'bg-gray-100 text-gray-600',
    completed: 'bg-emerald-100 text-emerald-700',
    problem:   'bg-red-100 text-red-700',
  }

  return (
    <div className={`min-h-screen ${printMode ? 'bg-white' : 'bg-[#f8f8f7]'}`}>
      {!printMode && (
        <div className="flex h-screen">
          {/* Left panel — route list */}
          <div className="w-64 flex-shrink-0 bg-white border-r border-[#e4e4e0] flex flex-col">
            <div className="p-4 border-b border-[#e4e4e0]">
              <p className="text-[13px] font-semibold text-[#111110] mb-3">Маршрутные листы</p>
              <div className="space-y-2">
                <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
                  className="w-full border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-[#111110]" />
                <input value={newDriver} onChange={e => setNewDriver(e.target.value)}
                  placeholder="Водитель"
                  className="w-full border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-[#111110]" />
                <button onClick={createRoute}
                  className="w-full bg-[#111110] text-white text-[12px] font-medium rounded-lg py-1.5 hover:bg-[#2a2a28]">
                  + Создать маршрут
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-[#f0f0ec]">
              {routes.map(r => (
                <button key={r.id} onClick={() => selectRoute(r)}
                  className={`w-full text-left px-4 py-3 hover:bg-[#fafaf9] transition-colors ${selected?.id === r.id ? 'bg-blue-50' : ''}`}>
                  <p className="text-[12px] font-semibold text-[#111110]">{fmtDate(r.route_date)}</p>
                  <p className="text-[11px] text-[#9a9a95] mt-0.5">🚗 {r.driver_name}</p>
                </button>
              ))}
              {routes.length === 0 && (
                <p className="px-4 py-6 text-[12px] text-[#9a9a95] text-center">Нет маршрутов</p>
              )}
            </div>
          </div>

          {/* Right panel — stops */}
          <div className="flex-1 overflow-y-auto p-6">
            {!selected ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-[14px] text-[#9a9a95]">Выбери маршрут слева или создай новый</p>
              </div>
            ) : (
              <div className="max-w-3xl space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-[18px] font-semibold text-[#111110]">
                      Маршрут — {fmtDate(selected.route_date)}
                    </h1>
                    <p className="text-[12px] text-[#9a9a95]">Водитель: {selected.driver_name}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setPrint(true)}
                      className="px-3 py-1.5 border border-[#e4e4e0] text-[12px] font-medium rounded-lg hover:bg-[#f0f0ec]">
                      🖨 Распечатать
                    </button>
                    <button onClick={() => deleteRoute(selected.id)}
                      className="px-3 py-1.5 text-[12px] text-red-600 hover:bg-red-50 rounded-lg">
                      Удалить
                    </button>
                  </div>
                </div>

                {loading ? (
                  <p className="text-[13px] text-[#9a9a95]">Загрузка...</p>
                ) : (
                  <>
                    {stops.map((stop, idx) => (
                      <div key={idx} className="bg-white border border-[#e4e4e0] rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="w-6 h-6 rounded-full bg-[#111110] text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                            {idx + 1}
                          </span>
                          <div className="flex items-center gap-2">
                            <select value={stop.status}
                              onChange={e => updateStop(idx, 'status', e.target.value)}
                              className={`text-[11px] font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${statusColors[stop.status]}`}>
                              <option value="pending">В очереди</option>
                              <option value="completed">Выполнено</option>
                              <option value="problem">Проблема</option>
                            </select>
                            <button onClick={() => removeStop(idx)} className="text-[#c4c4be] hover:text-red-400 text-lg">×</button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <SInput label="Поставщик" value={stop.supplier_name} onChange={v => updateStop(idx, 'supplier_name', v)} />
                          <SInput label="Адрес" value={stop.address} onChange={v => updateStop(idx, 'address', v)} />
                          <SInput label="Контактное лицо" value={stop.contact_name} onChange={v => updateStop(idx, 'contact_name', v)} />
                          <SInput label="Телефон" value={stop.contact_phone} onChange={v => updateStop(idx, 'contact_phone', v)} />
                          <SInput label="Что забрать" value={stop.what_to_pick} onChange={v => updateStop(idx, 'what_to_pick', v)} />
                          <SInput label="К заказу / счёту" value={stop.order_ref} onChange={v => updateStop(idx, 'order_ref', v)} />
                          <SInput label="Часы работы" value={stop.work_hours} onChange={v => updateStop(idx, 'work_hours', v)} />
                          <SInput label="Комментарий" value={stop.comment} onChange={v => updateStop(idx, 'comment', v)} />
                        </div>
                      </div>
                    ))}
                    <button onClick={addStop}
                      className="w-full border-2 border-dashed border-[#e4e4e0] rounded-xl py-3 text-[13px] font-medium text-[#9a9a95] hover:border-[#111110] hover:text-[#111110] transition-colors">
                      + Добавить точку
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Print view */}
      {printMode && selected && (
        <div className="max-w-[760px] mx-auto px-8 py-10">
          <div className="no-print flex justify-between mb-6">
            <button onClick={() => setPrint(false)} className="text-[13px] text-[#6b6b66] hover:text-[#111110]">← Назад</button>
            <button onClick={() => window.print()} className="px-4 py-2 bg-[#111110] text-white text-[13px] rounded-lg">Печать</button>
          </div>
          <div style={{ borderBottom: '2px solid #111', paddingBottom: 12, marginBottom: 20, display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: 10, color: '#999', textTransform: 'uppercase', marginBottom: 4 }}>MGlass</p>
              <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Маршрутный лист закупщика</h1>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 13, color: '#333' }}>{fmtDate(selected.route_date)}</p>
              <p style={{ fontSize: 13, color: '#666' }}>Водитель: {selected.driver_name}</p>
            </div>
          </div>
          {stops.map((stop, idx) => (
            <div key={idx} style={{ marginBottom: 16, padding: '12px 16px', border: '1px solid #e4e4e0', borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <strong style={{ fontSize: 14 }}>#{idx + 1} — {stop.supplier_name || '—'}</strong>
                <span style={{ fontSize: 11, color: '#666' }}>Время работы: {stop.work_hours || '—'}</span>
              </div>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <tbody>
                  {stop.address && <tr><td style={{ color: '#666', width: 140 }}>Адрес:</td><td>{stop.address}</td></tr>}
                  {stop.contact_name && <tr><td style={{ color: '#666' }}>Контакт:</td><td>{stop.contact_name} {stop.contact_phone}</td></tr>}
                  {stop.what_to_pick && <tr><td style={{ color: '#666' }}>Что забрать:</td><td style={{ fontWeight: 600 }}>{stop.what_to_pick}</td></tr>}
                  {stop.order_ref && <tr><td style={{ color: '#666' }}>Заказ/счёт:</td><td>{stop.order_ref}</td></tr>}
                  {stop.comment && <tr><td style={{ color: '#666' }}>Примечание:</td><td style={{ color: '#555' }}>{stop.comment}</td></tr>}
                </tbody>
              </table>
              <div style={{ marginTop: 8, borderTop: '1px dashed #ddd', paddingTop: 8, display: 'flex', gap: 24, fontSize: 11, color: '#888' }}>
                <span>Статус: ___________</span>
                <span>Время прибытия: ___________</span>
                <span>Подпись: ___________</span>
              </div>
            </div>
          ))}
          <style>{`@media print { .no-print { display: none } }`}</style>
        </div>
      )}
    </div>
  )
}

function SInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-[#9a9a95] uppercase tracking-wide mb-1">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)}
        className="w-full border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-[#111110] bg-white" />
    </div>
  )
}
