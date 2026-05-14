'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

type ComponentType = 'frame' | 'led_strip' | 'power_supply' | 'diffuser'

type LightingComponent = {
  id: number
  component_type: ComponentType
  name: string
  description: string | null
  voltage: number | null
  color_temp: number | null
  power_per_meter: number | null
  max_power: number | null
  cost_price: number
  sale_price: number | null
  unit: string
  active: boolean
  sort_order: number
}

const TABS: { value: ComponentType; label: string }[] = [
  { value: 'frame',         label: 'Каркас (профиль)' },
  { value: 'led_strip',     label: 'LED-лента' },
  { value: 'power_supply',  label: 'Блок питания' },
  { value: 'diffuser',      label: 'Рассеиватель' },
]

const EMPTY: Omit<LightingComponent, 'id'> = {
  component_type: 'frame',
  name: '',
  description: null,
  voltage: null,
  color_temp: null,
  power_per_meter: null,
  max_power: null,
  cost_price: 0,
  sale_price: null,
  unit: 'пог.м',
  active: true,
  sort_order: 0,
}

const fmtN = (n: number | null) => n == null ? '—' : n.toLocaleString('ru-RU')

export default function MirrorLightingPage() {
  const [tab, setTab] = useState<ComponentType>('frame')
  const [items, setItems] = useState<LightingComponent[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<LightingComponent> | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    const sb = createClient()
    const { data } = await sb
      .from('mirror_lighting_components')
      .select('*')
      .order('component_type')
      .order('sort_order')
      .order('id')
    setItems((data ?? []) as LightingComponent[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const visible = items.filter(i => i.component_type === tab)

  async function toggleActive(item: LightingComponent) {
    const sb = createClient()
    const next = !item.active
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, active: next } : i))
    await sb.from('mirror_lighting_components').update({ active: next }).eq('id', item.id)
  }

  async function deleteItem(item: LightingComponent) {
    if (!confirm(`Удалить «${item.name}»?\nЭто действие нельзя отменить.`)) return
    const sb = createClient()
    setItems(prev => prev.filter(i => i.id !== item.id))
    await sb.from('mirror_lighting_components').delete().eq('id', item.id)
  }

  async function save() {
    if (!editing) return
    if (!editing.name?.trim()) return
    setSaving(true)
    const sb = createClient()
    const isNew = !editing.id
    const nextOrder = isNew
      ? items.filter(i => i.component_type === tab).length + 1
      : (editing.sort_order ?? 0)
    const payload = {
      component_type: tab,
      name:            editing.name?.trim() ?? '',
      description:     editing.description ?? null,
      voltage:         editing.voltage ?? null,
      color_temp:      editing.color_temp ?? null,
      power_per_meter: editing.power_per_meter ?? null,
      max_power:       editing.max_power ?? null,
      cost_price:      editing.cost_price ?? 0,
      sale_price:      editing.sale_price ?? null,
      unit:            editing.unit ?? 'шт',
      active:          editing.active ?? true,
      sort_order:      nextOrder,
    }
    if (editing.id) {
      await sb.from('mirror_lighting_components').update(payload).eq('id', editing.id)
    } else {
      await sb.from('mirror_lighting_components').insert(payload)
    }
    await load()
    setEditing(null)
    setSaving(false)
  }

  const inp = 'w-full border border-[#e4e4e0] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400'
  const num = 'w-full border border-[#e4e4e0] rounded-md px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-400'

  if (loading) return <div className="p-6 text-sm text-gray-400">Загрузка...</div>

  return (
    <div className="max-w-4xl mx-auto px-4 py-4">

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-base font-semibold text-[#111110]">Компоненты подсветки зеркал</h1>
        <button
          onClick={() => setEditing({ ...EMPTY, component_type: tab, unit: tab === 'power_supply' ? 'шт' : 'пог.м' })}
          className="px-3 py-1.5 bg-[#111110] text-white rounded-lg text-sm font-medium hover:bg-[#2a2a28] transition-colors">
          + Добавить
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-[#f0f0ec] rounded-lg mb-4 w-fit">
        {TABS.map(t => (
          <button key={t.value} onClick={() => setTab(t.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              tab === t.value ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66] hover:text-[#111110]'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#f0f0ec] bg-[#fafaf9]">
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-wide">Название</th>
              {tab === 'led_strip' && <>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-wide">Напряжение</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-wide">Темп. K</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-wide">Вт/м</th>
              </>}
              {tab === 'power_supply' && <>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-wide">Напряжение</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-wide">Макс. Вт</th>
              </>}
              <th className="text-right px-3 py-2 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-wide">Ед.</th>
              <th className="text-right px-3 py-2 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-wide">Себест.</th>
              <th className="text-right px-3 py-2 text-[11px] font-semibold text-[#9a9a95] uppercase tracking-wide">Продажная</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-sm text-[#9a9a95]">Нет позиций</td></tr>
            )}
            {visible.map(item => (
              <tr key={item.id} className={`border-b border-[#f5f5f3] last:border-0 hover:bg-[#fafaf9] ${!item.active ? 'opacity-40' : ''}`}>
                <td className="px-3 py-2">
                  <p className="text-sm font-medium text-[#111110]">{item.name}</p>
                  {item.description && <p className="text-[11px] text-[#9a9a95]">{item.description}</p>}
                </td>
                {tab === 'led_strip' && <>
                  <td className="px-3 py-2 text-right text-sm font-mono">{item.voltage ? `${item.voltage}V` : '—'}</td>
                  <td className="px-3 py-2 text-right text-sm font-mono">{fmtN(item.color_temp)}</td>
                  <td className="px-3 py-2 text-right text-sm font-mono">{item.power_per_meter ?? '—'}</td>
                </>}
                {tab === 'power_supply' && <>
                  <td className="px-3 py-2 text-right text-sm font-mono">{item.voltage ? `${item.voltage}V` : '—'}</td>
                  <td className="px-3 py-2 text-right text-sm font-mono">{fmtN(item.max_power)}</td>
                </>}
                <td className="px-3 py-2 text-right text-[11px] text-[#9a9a95]">{item.unit}</td>
                <td className="px-3 py-2 text-right text-sm font-mono">{fmtN(item.cost_price)} ₽</td>
                <td className="px-3 py-2 text-right text-sm font-mono text-[#9a9a95]">
                  {item.sale_price ? `${fmtN(item.sale_price)} ₽` : '—'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => toggleActive(item)}
                      className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                        item.active
                          ? 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                          : 'border-[#e4e4e0] text-[#9a9a95] hover:bg-[#f5f5f3]'
                      }`}>
                      {item.active ? 'Вкл' : 'Выкл'}
                    </button>
                    <button onClick={() => setEditing({ ...item })}
                      className="text-[11px] px-2 py-0.5 rounded border border-[#e4e4e0] text-[#4b4b47] hover:bg-[#f5f5f3] transition-colors">
                      Ред.
                    </button>
                    <button onClick={() => deleteItem(item)}
                      className="text-[11px] px-2 py-0.5 rounded border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5">
            <h2 className="text-sm font-semibold text-[#111110] mb-4">
              {editing.id ? 'Редактировать' : 'Добавить'} — {TABS.find(t => t.value === tab)?.label}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-[#9a9a95] font-semibold uppercase tracking-wide">Название *</label>
                <input className={inp} value={editing.name ?? ''} onChange={e => setEditing(p => ({ ...p!, name: e.target.value }))} />
              </div>

              <div>
                <label className="text-[11px] text-[#9a9a95] font-semibold uppercase tracking-wide">Описание</label>
                <input className={inp} value={editing.description ?? ''} onChange={e => setEditing(p => ({ ...p!, description: e.target.value || null }))} />
              </div>

              {(tab === 'led_strip' || tab === 'power_supply') && (
                <div>
                  <label className="text-[11px] text-[#9a9a95] font-semibold uppercase tracking-wide">Напряжение (V)</label>
                  <div className="flex gap-2 mt-1">
                    {[12, 24].map(v => (
                      <button key={v} onClick={() => setEditing(p => ({ ...p!, voltage: editing.voltage === v ? null : v }))}
                        className={`flex-1 py-1.5 rounded border text-sm font-medium transition-colors ${
                          editing.voltage === v ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#4b4b47] hover:bg-[#f5f5f3]'
                        }`}>
                        {v}V
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {tab === 'led_strip' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-[#9a9a95] font-semibold uppercase tracking-wide">Цветовая температура (K)</label>
                    <input type="number" className={num} value={editing.color_temp ?? ''} placeholder="3000"
                      onChange={e => setEditing(p => ({ ...p!, color_temp: Number(e.target.value) || null }))} />
                  </div>
                  <div>
                    <label className="text-[11px] text-[#9a9a95] font-semibold uppercase tracking-wide">Мощность (Вт/м)</label>
                    <input type="number" step="0.1" className={num} value={editing.power_per_meter ?? ''} placeholder="9.6"
                      onChange={e => setEditing(p => ({ ...p!, power_per_meter: Number(e.target.value) || null }))} />
                  </div>
                </div>
              )}

              {tab === 'power_supply' && (
                <div>
                  <label className="text-[11px] text-[#9a9a95] font-semibold uppercase tracking-wide">Макс. мощность (Вт)</label>
                  <input type="number" className={num} value={editing.max_power ?? ''} placeholder="60"
                    onChange={e => setEditing(p => ({ ...p!, max_power: Number(e.target.value) || null }))} />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#9a9a95] font-semibold uppercase tracking-wide">Себестоимость (₽)</label>
                  <input type="number" className={num} value={editing.cost_price ?? 0}
                    onChange={e => setEditing(p => ({ ...p!, cost_price: Number(e.target.value) || 0 }))} />
                </div>
                <div>
                  <label className="text-[11px] text-[#9a9a95] font-semibold uppercase tracking-wide">Продажная (₽)</label>
                  <input type="number" className={num} value={editing.sale_price ?? ''} placeholder="—"
                    onChange={e => setEditing(p => ({ ...p!, sale_price: Number(e.target.value) || null }))} />
                </div>
              </div>

              <div>
                <label className="text-[11px] text-[#9a9a95] font-semibold uppercase tracking-wide">Единица</label>
                <select className={inp} value={editing.unit ?? 'шт'} onChange={e => setEditing(p => ({ ...p!, unit: e.target.value }))}>
                  <option>шт</option>
                  <option>пог.м</option>
                  <option>м</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={save} disabled={saving || !editing.name?.trim()}
                className="flex-1 py-2 bg-[#111110] text-white rounded-lg text-sm font-semibold hover:bg-[#2a2a28] disabled:opacity-50 transition-colors">
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button onClick={() => setEditing(null)}
                className="px-4 py-2 border border-[#e4e4e0] rounded-lg text-sm text-[#4b4b47] hover:bg-[#fafaf9] transition-colors">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
