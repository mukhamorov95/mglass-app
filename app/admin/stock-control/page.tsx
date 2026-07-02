'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'

type StockItem = {
  id: number
  name: string
  category: string
  unit: string
  stock_qty: number
  min_stock: number
  recommended_stock: number
  storage_unit: string
  is_critical: boolean
  _source: 'hardware' | 'material'
  _dirty?: boolean
}

function status(item: StockItem): 'ok' | 'warn' | 'crit' {
  if (item.min_stock === 0 && item.recommended_stock === 0) return 'ok'
  if (item.stock_qty <= item.min_stock) return 'crit'
  if (item.stock_qty < item.recommended_stock) return 'warn'
  return 'ok'
}

const STATUS_LABELS = {
  ok:   { label: 'Норма',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  warn: { label: 'Внимание', cls: 'bg-amber-50  text-amber-700  border-amber-200'  },
  crit: { label: 'Критично', cls: 'bg-red-50    text-red-700    border-red-200'    },
}

export default function StockControlPage() {
  const db    = useRef(createClient())
  const [items,   setItems]   = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState<'all' | 'crit' | 'warn' | 'ok'>('all')
  const [search,  setSearch]  = useState('')
  const [saving,  setSaving]  = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [hw, mat] = await Promise.all([
      db.current.from('shower_catalog_items')
        .select('id, name, category, unit, stock_qty, min_stock, recommended_stock, storage_unit, is_critical')
        .order('name'),
      db.current.from('materials')
        .select('id, name, category, unit, stock_qty, min_stock_qty, recommended_stock, storage_unit, is_critical')
        .eq('active', true)
        .order('name'),
    ])

    const hwItems: StockItem[] = ((hw.data ?? []) as any[]).map(r => ({
      id: r.id, name: r.name, category: r.category, unit: r.unit,
      stock_qty: r.stock_qty ?? 0,
      min_stock: r.min_stock ?? 0,
      recommended_stock: r.recommended_stock ?? 0,
      storage_unit: r.storage_unit ?? r.unit ?? 'шт',
      is_critical: r.is_critical ?? false,
      _source: 'hardware' as const,
    }))

    const matItems: StockItem[] = ((mat.data ?? []) as any[]).map(r => ({
      id: r.id, name: r.name, category: r.category, unit: r.unit,
      stock_qty: r.stock_qty ?? 0,
      min_stock: r.min_stock_qty ?? 0,
      recommended_stock: r.recommended_stock ?? 0,
      storage_unit: r.storage_unit ?? r.unit ?? 'шт',
      is_critical: r.is_critical ?? false,
      _source: 'material' as const,
    }))

    setItems([...hwItems, ...matItems])
    setLoading(false)
  }

  function update(id: number, source: string, key: keyof StockItem, value: unknown) {
    setItems(prev => prev.map(i =>
      i.id === id && i._source === source ? { ...i, [key]: value, _dirty: true } : i
    ))
  }

  async function save(item: StockItem) {
    setSaving(item.id)
    const table  = item._source === 'hardware' ? 'shower_catalog_items' : 'materials'
    const minKey = item._source === 'hardware' ? 'min_stock' : 'min_stock_qty'
    await db.current.from(table).update({
      stock_qty: item.stock_qty,
      [minKey]:  item.min_stock,
      recommended_stock: item.recommended_stock,
      storage_unit: item.storage_unit,
      is_critical: item.is_critical,
    }).eq('id', item.id)
    setItems(prev => prev.map(i =>
      i.id === item.id && i._source === item._source ? { ...i, _dirty: false } : i
    ))
    setSaving(null)
  }

  async function toggleCritical(item: StockItem) {
    const table = item._source === 'hardware' ? 'shower_catalog_items' : 'materials'
    const next  = !item.is_critical
    setItems(prev => prev.map(i =>
      i.id === item.id && i._source === item._source ? { ...i, is_critical: next } : i
    ))
    await db.current.from(table).update({ is_critical: next }).eq('id', item.id)
  }

  const criticalItems = items.filter(i => i.is_critical)
  const display = (showAll ? items : criticalItems).filter(i => {
    if (filter !== 'all' && status(i) !== filter) return false
    if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const counts = {
    crit: criticalItems.filter(i => status(i) === 'crit').length,
    warn: criticalItems.filter(i => status(i) === 'warn').length,
    ok:   criticalItems.filter(i => status(i) === 'ok').length,
  }

  return (
    <div className="min-h-screen bg-canvas p-6">
      <div className="max-w-5xl mx-auto space-y-4">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[18px] font-semibold text-ink">Критические остатки</h1>
            <p className="text-[12px] text-muted mt-0.5">Мониторинг ключевых позиций склада</p>
          </div>
          <button onClick={() => setShowAll(v => !v)}
            className={`text-[12px] px-3 py-1.5 rounded-lg font-medium border transition-colors ${showAll ? 'bg-ink text-white border-ink' : 'bg-surface text-ink-soft border-line hover:border-ink'}`}>
            {showAll ? 'Только критические' : 'Все позиции'}
          </button>
        </div>

        {/* Сводка */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { key: 'crit', label: 'Критично', count: counts.crit, cls: 'bg-red-50 border-red-200 text-red-700' },
            { key: 'warn', label: 'Внимание', count: counts.warn, cls: 'bg-amber-50 border-amber-200 text-amber-700' },
            { key: 'ok',   label: 'Норма',    count: counts.ok,   cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
          ].map(s => (
            <button key={s.key} onClick={() => setFilter(filter === s.key as typeof filter ? 'all' : s.key as typeof filter)}
              className={`rounded-xl border px-4 py-3 text-left transition-all ${filter === s.key ? s.cls + ' ring-2 ring-offset-1 ring-current' : 'bg-surface border-line'}`}>
              <p className={`text-[24px] font-semibold tabular-nums ${filter === s.key ? '' : 'text-ink'}`}>{s.count}</p>
              <p className={`text-[11px] font-semibold uppercase tracking-wide ${filter === s.key ? '' : 'text-muted'}`}>{s.label}</p>
            </button>
          ))}
        </div>

        {/* Поиск */}
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по названию..."
          className="w-full border border-line rounded-lg px-3 py-2 text-[13px] outline-none focus:border-ink bg-surface" />

        {/* Таблица */}
        <div className="bg-surface border border-line rounded-xl overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-subtle border-b border-line">
              <tr>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-wide">Позиция</th>
                <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-wide w-24">Факт</th>
                <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-wide w-24">Минимум</th>
                <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-wide w-28">Рекомендуемый</th>
                <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-wide w-28">Статус</th>
                <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-wide w-24">Критич.</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {loading ? (
                <tr><td colSpan={7} className="text-center py-8 text-muted">Загрузка...</td></tr>
              ) : display.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-muted">Нет позиций</td></tr>
              ) : display.map(item => {
                const st = status(item)
                const sl = STATUS_LABELS[st]
                return (
                  <tr key={`${item._source}-${item.id}`} className={`hover:bg-subtle ${st === 'crit' ? 'bg-red-50/30' : st === 'warn' ? 'bg-amber-50/30' : ''}`}>
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-ink">{item.name}</p>
                      <p className="text-[10px] text-muted">{item.category} · {item._source === 'hardware' ? 'фурнитура' : 'материал'}</p>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <input type="number" min="0" value={item.stock_qty}
                        onChange={e => update(item.id, item._source, 'stock_qty', Number(e.target.value) || 0)}
                        className="w-16 text-center border border-line rounded-lg px-2 py-1 text-[12px] font-mono tabular-nums outline-none focus:border-ink" />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <input type="number" min="0" value={item.min_stock}
                        onChange={e => update(item.id, item._source, 'min_stock', Number(e.target.value) || 0)}
                        className="w-16 text-center border border-line rounded-lg px-2 py-1 text-[12px] font-mono tabular-nums outline-none focus:border-ink" />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <input type="number" min="0" value={item.recommended_stock}
                        onChange={e => update(item.id, item._source, 'recommended_stock', Number(e.target.value) || 0)}
                        className="w-20 text-center border border-line rounded-lg px-2 py-1 text-[12px] font-mono tabular-nums outline-none focus:border-ink" />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border ${sl.cls}`}>{sl.label}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <button onClick={() => toggleCritical(item)}
                        className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors ${item.is_critical ? 'bg-ink text-white' : 'bg-line-soft text-muted hover:bg-line'}`}>
                        {item.is_critical ? '★ Да' : '☆ Нет'}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {item._dirty && (
                        <button onClick={() => save(item)} disabled={saving === item.id}
                          className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 disabled:opacity-40">
                          {saving === item.id ? '...' : 'Сохр.'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-muted text-center">
          Норма = остаток ≥ рекомендуемого · Внимание = ниже рекомендуемого · Критично = ниже минимума
        </p>
      </div>
    </div>
  )
}
