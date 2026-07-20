'use client'

import { useEffect, useState, useRef } from 'react'

type Modifier = {
  id: number
  rule_key: string
  rule_name: string
  percent_add: number
  active: boolean
  applies_to: string
  description: string | null
  sort_order: number
}

const APPLIES_OPTIONS = [
  { value: 'all',    label: 'Все материалы' },
  { value: 'glass',  label: 'Только стекло' },
  { value: 'mirror', label: 'Только зеркало' },
]

function appliesLabel(v: string) {
  return APPLIES_OPTIONS.find(o => o.value === v)?.label ?? v
}

const EMPTY: Omit<Modifier, 'id'> = {
  rule_key: '', rule_name: '', percent_add: 0,
  active: true, applies_to: 'all', description: null, sort_order: 0,
}

export default function WasteModifiersPage() {
  const [rows, setRows]       = useState<Modifier[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast]     = useState<string | null>(null)
  const [editId, setEditId]   = useState<number | null>(null)
  const [draft, setDraft]     = useState<Partial<Modifier>>({})
  const [adding, setAdding]   = useState(false)
  const [newRow, setNewRow]   = useState<typeof EMPTY>({ ...EMPTY })
  const inputRef = useRef<HTMLInputElement>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  async function load() {
    const res = await fetch('/api/admin/waste-modifiers')
    if (res.ok) setRows(await res.json())
    setLoading(false)
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => setLoading(false)) }, [])
  useEffect(() => { if (adding) inputRef.current?.focus() }, [adding])

  async function toggleActive(row: Modifier) {
    await fetch('/api/admin/waste-modifiers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id, active: !row.active }),
    })
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, active: !r.active } : r))
  }

  async function saveEdit() {
    if (editId == null) return
    await fetch('/api/admin/waste-modifiers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editId, ...draft }),
    })
    setEditId(null); setDraft({})
    showToast('Сохранено')
    load()
  }

  async function deleteRow(id: number) {
    if (!confirm('Удалить этот модификатор?')) return
    await fetch('/api/admin/waste-modifiers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    showToast('Удалено')
    load()
  }

  async function addRow() {
    if (!newRow.rule_key.trim() || !newRow.rule_name.trim()) return
    const res = await fetch('/api/admin/waste-modifiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newRow, sort_order: rows.length }),
    })
    if (res.ok) {
      setAdding(false)
      setNewRow({ ...EMPTY })
      showToast('Добавлено')
      load()
    }
  }

  function startEdit(row: Modifier) {
    setEditId(row.id)
    setDraft({
      rule_name: row.rule_name,
      percent_add: row.percent_add,
      applies_to: row.applies_to,
      description: row.description ?? '',
      sort_order: row.sort_order,
    })
  }

  return (
    <div className="max-w-[900px] mx-auto px-6 py-8">
      {toast && (
        <div className="fixed top-4 right-4 bg-[#111110] text-white text-[13px] px-4 py-2.5 rounded-xl shadow-lg z-50">{toast}</div>
      )}

      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">Модификаторы расхода</h1>
        <p className="text-[13px] text-[#8a8a85] mt-0.5">
          Дополнительные надбавки к базовому расходу материала. Применяются автоматически по форме изделия или условиям раскроя.
        </p>
        <div className="mt-2 bg-[#fffbeb] border border-[#fbbf24] rounded-lg px-4 py-2.5 text-[12px] text-[#92400e]">
          <strong>Итоговый расход</strong> = Базовый % (из справочника стекло/зеркало) + активные модификаторы.
          Пример: CrystalVision 25% + Круглое +12% = <strong>37%</strong> расчётной площади.
        </div>
      </div>

      {loading ? (
        <div className="text-[13px] text-[#8a8a85] py-12 text-center">Загрузка...</div>
      ) : (
        <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden mb-4">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-[#f8f8f7] border-b border-[#e4e4e0]">
                <th className="px-4 py-3 text-left font-semibold text-[#8a8a85] text-[11px] uppercase tracking-wider">Название правила</th>
                <th className="px-3 py-3 text-center font-semibold text-[#8a8a85] text-[11px] uppercase tracking-wider w-[80px]">+%</th>
                <th className="px-3 py-3 text-center font-semibold text-[#8a8a85] text-[11px] uppercase tracking-wider w-[130px]">Применять к</th>
                <th className="px-3 py-3 text-left font-semibold text-[#8a8a85] text-[11px] uppercase tracking-wider">Описание</th>
                <th className="px-3 py-3 text-center font-semibold text-[#8a8a85] text-[11px] uppercase tracking-wider w-[70px]">Активно</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0ee]">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[#8a8a85]">Нет правил. Добавьте ниже.</td>
                </tr>
              )}
              {rows.map(row => (
                <tr key={row.id} className={`hover:bg-[#fafaf9] ${!row.active ? 'opacity-50' : ''}`}>
                  {editId === row.id ? (
                    <>
                      <td className="px-3 py-2">
                        <input value={draft.rule_name ?? ''} onChange={e => setDraft(p => ({ ...p, rule_name: e.target.value }))}
                          className="w-full border border-[#0071e3] rounded px-2 py-1 text-[13px] outline-none" />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input type="number" value={draft.percent_add ?? 0} onChange={e => setDraft(p => ({ ...p, percent_add: Number(e.target.value) }))}
                          className="w-16 border border-[#0071e3] rounded px-2 py-1 text-[13px] text-center outline-none font-mono" />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <select value={draft.applies_to ?? 'all'} onChange={e => setDraft(p => ({ ...p, applies_to: e.target.value }))}
                          className="border border-[#0071e3] rounded px-1.5 py-1 text-[12px] outline-none bg-white w-full">
                          {APPLIES_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input value={draft.description ?? ''} onChange={e => setDraft(p => ({ ...p, description: e.target.value }))}
                          className="w-full border border-[#0071e3] rounded px-2 py-1 text-[13px] outline-none" />
                      </td>
                      <td className="px-3 py-2 text-center">—</td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center gap-1">
                          <button onClick={saveEdit} className="text-[12px] font-medium px-2.5 py-1 rounded bg-[#0071e3] text-white hover:bg-[#0062c4]">OK</button>
                          <button onClick={() => { setEditId(null); setDraft({}) }} className="text-[12px] px-2 py-1 rounded border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f4]">✕</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2.5 font-medium text-[#111110]">
                        {row.rule_name}
                        <span className="ml-2 text-[11px] text-[#b0b0aa] font-mono">{row.rule_key}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono font-semibold text-[#b45309]">+{row.percent_add}%</td>
                      <td className="px-3 py-2.5 text-center text-[12px] text-[#8a8a85]">{appliesLabel(row.applies_to)}</td>
                      <td className="px-3 py-2.5 text-[12px] text-[#8a8a85]">{row.description ?? '—'}</td>
                      <td className="px-3 py-2.5 text-center">
                        <button onClick={() => toggleActive(row)}
                          className={`w-8 h-4 rounded-full transition-colors relative ${row.active ? 'bg-[#34c759]' : 'bg-[#d8d8d4]'}`}>
                          <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${row.active ? 'left-4' : 'left-0.5'}`} />
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <div className="flex items-center gap-1 justify-center">
                          <button onClick={() => startEdit(row)}
                            className="text-[12px] px-2 py-1 rounded border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f4]">✎</button>
                          <button onClick={() => deleteRow(row.id)}
                            className="text-[12px] px-2 py-1 rounded border border-red-200 text-red-500 hover:bg-red-50">✕</button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}

              {/* Add row inline */}
              {adding && (
                <tr className="bg-[#f0f7ff]">
                  <td className="px-3 py-2">
                    <input ref={inputRef} placeholder="Название правила" value={newRow.rule_name}
                      onChange={e => setNewRow(p => ({ ...p, rule_name: e.target.value }))}
                      className="w-full border border-[#0071e3] rounded px-2 py-1 text-[13px] outline-none" />
                    <input placeholder="rule_key (уникальный)" value={newRow.rule_key}
                      onChange={e => setNewRow(p => ({ ...p, rule_key: e.target.value }))}
                      className="w-full border border-[#d0d0cc] rounded px-2 py-1 text-[12px] outline-none mt-1 font-mono" />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input type="number" value={newRow.percent_add}
                      onChange={e => setNewRow(p => ({ ...p, percent_add: Number(e.target.value) }))}
                      className="w-16 border border-[#0071e3] rounded px-2 py-1 text-[13px] text-center outline-none font-mono" />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <select value={newRow.applies_to} onChange={e => setNewRow(p => ({ ...p, applies_to: e.target.value }))}
                      className="border border-[#0071e3] rounded px-1.5 py-1 text-[12px] outline-none bg-white w-full">
                      {APPLIES_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input placeholder="Описание (необязательно)" value={newRow.description ?? ''}
                      onChange={e => setNewRow(p => ({ ...p, description: e.target.value }))}
                      className="w-full border border-[#d0d0cc] rounded px-2 py-1 text-[13px] outline-none" />
                  </td>
                  <td className="px-3 py-2 text-center">—</td>
                  <td className="px-3 py-2 text-center">
                    <div className="flex items-center gap-1">
                      <button onClick={addRow} className="text-[12px] font-medium px-2.5 py-1 rounded bg-[#0071e3] text-white hover:bg-[#0062c4]">OK</button>
                      <button onClick={() => { setAdding(false); setNewRow({ ...EMPTY }) }} className="text-[12px] px-2 py-1 rounded border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f4]">✕</button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <button onClick={() => setAdding(true)} disabled={adding}
        className="text-[13px] font-medium px-4 py-2 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
        + Добавить правило
      </button>

      <div className="mt-6 border-t border-[#f0f0ee] pt-4">
        <a href="/admin/glass-prices" className="text-[13px] text-[#0071e3] hover:underline">
          ← Справочник цен на стекло и зеркало
        </a>
      </div>
    </div>
  )
}
