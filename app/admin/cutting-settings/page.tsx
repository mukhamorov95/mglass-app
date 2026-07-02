'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

type Settings = {
  gap_between_pieces: number
  edge_margin: number
  allow_rotation: boolean
  respect_pattern: boolean
}

const DEFAULTS: Settings = {
  gap_between_pieces: 2,
  edge_margin: 2,
  allow_rotation: true,
  respect_pattern: true,
}

export default function CuttingSettingsPage() {
  const [form, setForm] = useState<Settings>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { load().catch(() => setLoading(false)) }, [])

  async function load() {
    setLoading(true)
    const { data } = await createClient().from('cutting_settings').select('*').eq('id', 1).single()
    if (data) setForm({ gap_between_pieces: data.gap_between_pieces ?? 2, edge_margin: data.edge_margin ?? 2, allow_rotation: data.allow_rotation ?? true, respect_pattern: data.respect_pattern ?? true })
    setLoading(false)
  }

  async function save() {
    setSaving(true)
    setSaved(false)
    setError(null)
    const { error } = await createClient().from('cutting_settings').update(form).eq('id', 1)
    if (error) setError(error.message)
    else setSaved(true)
    setSaving(false)
  }

  function field(label: string, desc: string, unit: string, key: keyof Settings, type: 'number' | 'boolean') {
    if (type === 'boolean') {
      return (
        <div className="flex items-center justify-between py-3 border-b border-[#f0f0ec] last:border-0">
          <div>
            <div className="text-[14px] font-semibold text-[#111110]">{label}</div>
            <div className="text-[12px] text-[#9a9a95] mt-0.5">{desc}</div>
          </div>
          <button
            onClick={() => setForm(f => ({ ...f, [key]: !f[key] }))}
            className={`relative w-11 h-6 rounded-full transition-colors ${form[key] ? 'bg-blue-600' : 'bg-[#d0d0cc]'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form[key] ? 'translate-x-5.5 left-0.5' : 'left-0.5'}`} />
          </button>
        </div>
      )
    }
    return (
      <div className="flex items-center justify-between py-3 border-b border-[#f0f0ec] last:border-0">
        <div>
          <div className="text-[14px] font-semibold text-[#111110]">{label}</div>
          <div className="text-[12px] text-[#9a9a95] mt-0.5">{desc}</div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={form[key] as number}
            onChange={e => setForm(f => ({ ...f, [key]: Number(e.target.value) }))}
            min={0}
            max={50}
            className="w-20 border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] text-right focus:outline-none focus:border-blue-400"
          />
          <span className="text-[13px] text-[#9a9a95] w-6">{unit}</span>
        </div>
      </div>
    )
  }

  if (loading) return <div className="min-h-screen bg-[#fafaf9] flex items-center justify-center text-[#9a9a95]">Загрузка...</div>

  return (
    <div className="min-h-screen bg-[#fafaf9] py-8 px-4">
      <div className="max-w-xl mx-auto space-y-6">

        <div>
          <h1 className="text-[20px] font-bold text-[#111110]">Настройки раскроя</h1>
          <p className="text-[13px] text-[#9a9a95] mt-1">Технологические параметры для расчёта карт раскроя</p>
        </div>

        <div className="bg-white rounded-xl border border-[#e4e4e0] px-5">
          <div className="py-2 border-b border-[#f0f0ec] mb-1">
            <span className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wide">Технологические зазоры</span>
          </div>
          {field('Зазор между деталями', 'Минимальное расстояние между соседними деталями на листе', 'мм', 'gap_between_pieces', 'number')}
          {field('Кромочный допуск', 'Отступ от края листа по периметру', 'мм', 'edge_margin', 'number')}
        </div>

        <div className="bg-white rounded-xl border border-[#e4e4e0] px-5">
          <div className="py-2 border-b border-[#f0f0ec] mb-1">
            <span className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wide">Алгоритм раскроя</span>
          </div>
          {field('Разрешить поворот деталей', 'Алгоритм может поворачивать детали на 90° для лучшей упаковки', '', 'allow_rotation', 'boolean')}
          {field('Учитывать направление рисунка', 'Для рифлёного и узорного стекла — запрещает поворот деталей', '', 'respect_pattern', 'boolean')}
        </div>

        {/* Info box */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-[12px] text-blue-700 space-y-1">
          <div className="font-semibold">Как работает алгоритм</div>
          <div>Используется метод <b>Guillotine BSSF</b> — детали сортируются по убыванию площади, каждая укладывается в наиболее подходящий свободный прямоугольник листа. Разрез идёт по всей ширине или высоте, что соответствует реальной технологии резки стекла.</div>
          <div className="mt-1">Размеры листов и направление рисунка настраиваются <a href="/admin/b2b-materials" className="underline">в справочнике материалов B2B</a>.</div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700">{error}</div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-[14px] font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Сохраняю...' : 'Сохранить'}
          </button>
          {saved && <span className="text-emerald-600 text-[13px] font-medium">✓ Сохранено</span>}
        </div>
      </div>
    </div>
  )
}
