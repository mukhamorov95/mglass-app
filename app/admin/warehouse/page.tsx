'use client'

import { useEffect, useState } from 'react'

type Material = {
  id:            number
  name:          string
  category:      string
  unit:          string
  cost_price:    number
  stock_qty:     number
  min_stock_qty: number
  _dirty?:       boolean
}

const CATEGORY_LABELS: Record<string, string> = {
  'зеркало':    'Зеркала',
  'стекло':     'Стекло',
  'подсветка':  'Подсветка',
  'профиль':    'Профили',
  'электрика':  'Электрика',
  'расходники': 'Расходники',
  'работа':     'Работа',
  'услуга':     'Услуги',
  'фурнитура':  'Фурнитура',
}

function stockStatus(mat: Material): 'ok' | 'low' | 'out' {
  if (mat.stock_qty <= 0)                              return 'out'
  if (mat.min_stock_qty > 0 && mat.stock_qty <= mat.min_stock_qty) return 'low'
  return 'ok'
}

export default function WarehousePage() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState<number | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [filterLow, setFilterLow] = useState(false)
  const [search, setSearch]       = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const res = await fetch('/api/admin/warehouse')
    if (!res.ok) { setError('Ошибка загрузки'); setLoading(false); return }
    setMaterials(await res.json())
    setLoading(false)
  }

  function update(id: number, key: 'stock_qty' | 'min_stock_qty', value: number) {
    setMaterials(prev => prev.map(m => m.id === id ? { ...m, [key]: value, _dirty: true } : m))
  }

  async function save(mat: Material) {
    setSaving(mat.id)
    setError(null)
    const res = await fetch('/api/admin/warehouse', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: mat.id, stock_qty: mat.stock_qty, min_stock_qty: mat.min_stock_qty }),
    })
    const json = await res.json()
    setSaving(null)
    if (!res.ok) { setError(json.error ?? 'Ошибка'); return }
    setMaterials(prev => prev.map(m => m.id === mat.id ? { ...m, _dirty: false } : m))
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-muted">Загрузка...</div>
  )

  const lowCount = materials.filter(m => stockStatus(m) !== 'ok').length
  const outCount = materials.filter(m => stockStatus(m) === 'out').length

  // Group by category
  const grouped = materials
    .filter(m => {
      if (filterLow && stockStatus(m) === 'ok') return false
      if (search) return m.name.toLowerCase().includes(search.toLowerCase())
      return true
    })
    .reduce((acc, m) => {
      const cat = m.category
      if (!acc[cat]) acc[cat] = []
      acc[cat].push(m)
      return acc
    }, {} as Record<string, Material[]>)

  return (
    <div className="max-w-[900px] mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-ink tracking-tight">Склад</h1>
        <p className="text-[13px] text-muted mt-0.5">Остатки и минимальные нормативы</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-surface border border-line rounded-xl p-4 text-center">
          <p className="text-[24px] font-semibold text-ink tabular-nums">{materials.length}</p>
          <p className="text-[12px] text-muted mt-0.5">материалов</p>
        </div>
        <div className={`border rounded-xl p-4 text-center ${lowCount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-surface border-line'}`}>
          <p className={`text-[24px] font-semibold tabular-nums ${lowCount > 0 ? 'text-amber-700' : 'text-ink'}`}>{lowCount}</p>
          <p className="text-[12px] text-muted mt-0.5">ниже минимума</p>
        </div>
        <div className={`border rounded-xl p-4 text-center ${outCount > 0 ? 'bg-red-50 border-red-200' : 'bg-surface border-line'}`}>
          <p className={`text-[24px] font-semibold tabular-nums ${outCount > 0 ? 'text-red-600' : 'text-ink'}`}>{outCount}</p>
          <p className="text-[12px] text-muted mt-0.5">нет на складе</p>
        </div>
      </div>

      {error && <p className="text-[13px] text-red-600 bg-red-50 px-3 py-2 rounded-lg mb-4">{error}</p>}

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по названию..."
          className="border border-line rounded-lg px-3 py-2 text-[13px] outline-none focus:border-ink bg-surface w-56"
        />
        <button
          onClick={() => setFilterLow(!filterLow)}
          className={`px-4 py-2 rounded-lg text-[13px] font-medium border transition-colors ${
            filterLow ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-surface text-ink-soft border-line hover:bg-canvas'
          }`}
        >
          {filterLow ? '⚠ Только дефицит' : 'Все материалы'}
        </button>
      </div>

      {/* Materials by category */}
      <div className="space-y-4">
        {Object.entries(grouped).map(([cat, mats]) => (
          <div key={cat} className="bg-surface border border-line rounded-xl overflow-hidden">
            <div className="px-5 py-2.5 bg-canvas border-b border-line">
              <p className="text-[12px] font-semibold text-muted uppercase tracking-wider">
                {CATEGORY_LABELS[cat] ?? cat} ({mats.length})
              </p>
            </div>
            <div className="divide-y divide-line-soft">
              {mats.map(m => {
                const status = stockStatus(m)
                return (
                  <div key={m.id} className="px-5 py-3.5 flex items-center gap-4">
                    {/* Status dot */}
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      status === 'ok'  ? 'bg-emerald-500' :
                      status === 'low' ? 'bg-amber-400'   : 'bg-red-500'
                    }`} />

                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-ink truncate">{m.name}</p>
                      <p className="text-[11px] text-muted">{m.unit}</p>
                    </div>

                    {/* Stock qty */}
                    <div className="text-right flex-shrink-0">
                      <p className="text-[10px] font-semibold text-muted uppercase mb-1">Остаток</p>
                      <input
                        type="number" min="0" step="0.1"
                        value={m.stock_qty}
                        onChange={e => update(m.id, 'stock_qty', Number(e.target.value))}
                        className={`w-20 text-center border rounded-lg px-2 py-1.5 text-[13px] font-mono tabular-nums outline-none focus:border-[#0071e3] ${
                          status === 'out' ? 'border-red-300 bg-red-50' :
                          status === 'low' ? 'border-amber-300 bg-amber-50' :
                          'border-line bg-surface'
                        }`}
                      />
                    </div>

                    {/* Min qty */}
                    <div className="text-right flex-shrink-0">
                      <p className="text-[10px] font-semibold text-muted uppercase mb-1">Мин.</p>
                      <input
                        type="number" min="0" step="0.1"
                        value={m.min_stock_qty}
                        onChange={e => update(m.id, 'min_stock_qty', Number(e.target.value))}
                        className="w-20 text-center border border-line rounded-lg px-2 py-1.5 text-[13px] font-mono tabular-nums bg-surface outline-none focus:border-[#0071e3]"
                      />
                    </div>

                    {/* Save */}
                    <button
                      onClick={() => save(m)}
                      disabled={saving === m.id || !m._dirty}
                      className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-30 hover:bg-[#2a2a28] transition-colors flex-shrink-0"
                    >
                      {saving === m.id ? '...' : '✓'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
