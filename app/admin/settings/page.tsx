'use client'

import { useEffect, useState } from 'react'
import type { FinancialSettings } from '@/lib/types'

type Row = FinancialSettings & { _dirty?: boolean }

const LABELS: Record<string, string> = {
  mirror_light:    'Зеркало с подсветкой',
  loft:            'Лофт-перегородка',
  shower_standard: 'Душевая — Стандарт',
  shower_budget:   'Душевая — Бюджет',
}

export default function SettingsPage() {
  const [rows, setRows]     = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState<number | null>(null)
  const [saved, setSaved]     = useState<number | null>(null)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const res = await fetch('/api/admin/settings')
    if (!res.ok) { setError('Ошибка загрузки'); setLoading(false); return }
    setRows(await res.json())
    setLoading(false)
  }

  function update(id: number, key: keyof FinancialSettings, value: number | string | null) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [key]: value, _dirty: true } : r))
  }

  async function save(row: Row) {
    setSaving(row.id)
    setError(null)
    const { _dirty, ...fields } = row
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
    const json = await res.json()
    setSaving(null)
    if (!res.ok) { setError(json.error ?? 'Ошибка'); return }
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, _dirty: false } : r))
    setSaved(row.id)
    setTimeout(() => setSaved(null), 2000)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка...</div>
  )

  return (
    <div className="max-w-[800px] mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">Финансовые настройки</h1>
        <p className="text-[13px] text-[#8a8a85] mt-0.5">Налог и маржа для каждого типа продукта</p>
      </div>

      {error && <p className="text-[13px] text-red-600 bg-red-50 px-3 py-2 rounded-lg mb-4">{error}</p>}

      {rows.length === 0 && (
        <p className="text-[13px] text-[#8a8a85]">Нет записей в таблице financial_settings</p>
      )}

      <div className="space-y-4">
        {rows.map(row => {
          const label = row.product_type ? (LABELS[row.product_type] ?? row.product_type) : `Tier: ${row.tier}`
          const divisor = 1 - row.tax_percent / 100 - row.default_margin / 100
          const example = divisor > 0 ? Math.round(10000 / divisor) : 0

          return (
            <div key={row.id} className="bg-white border border-[#e4e4e0] rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-[14px] font-semibold text-[#111110]">{label}</h2>
                  <p className="text-[11px] text-[#8a8a85] mt-0.5">id={row.id} · product_type={row.product_type ?? '—'} · tier={row.tier}</p>
                </div>
                {example > 0 && (
                  <span className="text-[12px] text-[#6b6b66] bg-[#f8f8f7] px-3 py-1.5 rounded-lg font-mono">
                    10 000 → {example.toLocaleString('ru-RU')} ₽
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-4 mb-4">
                {([
                  ['tax_percent',        'Налог (в формуле), %'],
                  ['default_margin',     'Маржа по умолчанию, %'],
                  ['min_margin',         'Минимальная маржа, %'],
                  ['green_threshold',    'Зелёный порог, %'],
                  ['yellow_threshold',   'Жёлтый порог, %'],
                  ['blocked_below',      'Блокировать ниже, %'],
                ] as [keyof FinancialSettings, string][]).map(([key, lbl]) => (
                  <div key={key}>
                    <label className="block text-[10px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-1">{lbl}</label>
                    <input
                      type="number" min="0" max="100" step="0.5"
                      className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] font-mono text-[#111110] outline-none focus:border-[#0071e3] transition-all"
                      value={row[key] as number}
                      onChange={e => update(row.id, key, Number(e.target.value))}
                    />
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between">
                <p className="text-[11px] text-[#8a8a85]">
                  Формула: 10 000 / (1 − {row.tax_percent}% − {row.default_margin}%) = <strong>{example > 0 ? example.toLocaleString('ru-RU') : 'n/a'} ₽</strong>
                </p>
                <button
                  onClick={() => save(row)}
                  disabled={saving === row.id || !row._dirty}
                  className={`text-[13px] font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-40 ${
                    saved === row.id
                      ? 'bg-green-600 text-white'
                      : 'bg-[#111110] text-white hover:bg-[#2a2a28]'
                  }`}
                >
                  {saved === row.id ? 'Сохранено ✓' : saving === row.id ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
