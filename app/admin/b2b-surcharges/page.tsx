'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import type { SurchargeRule, SurchargeAxis } from '@/lib/surcharges'

type Row = SurchargeRule & { _new?: boolean }

const AXES: { value: SurchargeAxis; title: string; hint: string }[] = [
  { value: 'length', title: 'Высота / длина', hint: 'ключ — длинная сторона детали, max(ширина, высота)' },
  { value: 'width',  title: 'Ширина',         hint: 'ключ — короткая сторона детали, min(ширина, высота)' },
  { value: 'shape',  title: 'Сложность формы', hint: 'только для криволинейных (галка «Криволинейка»); ключ — длинная сторона' },
]

let tempId = -1

export default function B2BSurchargesPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  // loading стартует true, поэтому setState синхронно в эффекте не вызываем —
  // только после await (иначе react-hooks/set-state-in-effect ругается).
  async function load() {
    const sb = createClient()
    const { data } = await sb.from('b2b_surcharge_rules').select('*').order('axis').order('sort_order')
    setRows((data ?? []) as Row[])
    setLoading(false)
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => setLoading(false)) }, [])

  function setField(id: number, field: keyof Row, value: unknown) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  function addRow(axis: SurchargeAxis) {
    const maxSort = Math.max(0, ...rows.filter(r => r.axis === axis).map(r => r.sort_order ?? 0))
    setRows(prev => [...prev, {
      id: tempId--, axis, min_mm: 0, max_mm: null, surcharge_percent: 0,
      label: '', shape_filter: axis === 'shape' ? 'curved' : null, active: true,
      sort_order: maxSort + 1, _new: true,
    }])
  }

  async function saveRow(row: Row) {
    if (!row.label.trim()) { setMsg('Заполните название'); return }
    setSavingId(row.id); setMsg(null)
    const sb = createClient()
    const payload = {
      axis: row.axis,
      min_mm: Number(row.min_mm) || 0,
      max_mm: row.max_mm == null || String(row.max_mm) === '' ? null : Number(row.max_mm),
      surcharge_percent: Number(row.surcharge_percent) || 0,
      label: row.label.trim(),
      shape_filter: row.axis === 'shape' ? 'curved' : null,
      active: row.active,
      sort_order: Number(row.sort_order) || 0,
      updated_at: new Date().toISOString(),
    }
    const { error } = row._new
      ? await sb.from('b2b_surcharge_rules').insert(payload)
      : await sb.from('b2b_surcharge_rules').update(payload).eq('id', row.id)
    setSavingId(null)
    if (error) { setMsg('Ошибка: ' + error.message); return }
    setMsg('Сохранено')
    await load()
  }

  async function deleteRow(row: Row) {
    if (row._new) { setRows(prev => prev.filter(r => r.id !== row.id)); return }
    if (!confirm(`Удалить правило «${row.label}»?`)) return
    const sb = createClient()
    const { error } = await sb.from('b2b_surcharge_rules').delete().eq('id', row.id)
    if (error) { setMsg('Ошибка: ' + error.message); return }
    await load()
  }

  async function toggleActive(row: Row) {
    if (row._new) { setField(row.id, 'active', !row.active); return }
    const sb = createClient()
    await sb.from('b2b_surcharge_rules').update({ active: !row.active, updated_at: new Date().toISOString() }).eq('id', row.id)
    await load()
  }

  return (
    <div className="min-h-screen bg-[#f5f5f3] px-4 py-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-[20px] font-semibold text-[#111110]">Надбавки за габариты</h1>
          <Link href="/admin/owner" className="text-[12px] text-[#9a9a95] hover:text-[#111110]">← Справочники</Link>
        </div>
        <p className="text-[12px] text-[#6b6b66] mb-5 leading-relaxed">
          Крупные и сложные изделия честно дороже (двое носят, дольше полируют, сложный рез).
          Ступень применяется <b>автоматически</b> по габаритам позиции в калькуляторе, менеджер может снять её галочкой,
          в КП пишется отдельной строкой. Процент считается от цены изделия. Диапазоны внутри одной оси
          не должны пересекаться. Пустой «до» = без верхней границы.
        </p>

        {msg && <div className="mb-3 text-[12px] px-3 py-1.5 rounded-lg bg-[#eef7ee] text-[#166534] border border-emerald-200 inline-block">{msg}</div>}

        {loading ? (
          <p className="text-[13px] text-[#9a9a95]">Загрузка…</p>
        ) : AXES.map(ax => {
          const axRows = rows.filter(r => r.axis === ax.value).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          return (
            <div key={ax.value} className="mb-6 bg-white rounded-2xl border border-[#e4e4e0] p-4">
              <div className="mb-3">
                <h2 className="text-[14px] font-semibold text-[#111110]">{ax.title}</h2>
                <p className="text-[11px] text-[#9a9a95]">{ax.hint}</p>
              </div>

              <div className="hidden sm:grid grid-cols-[70px_70px_64px_1fr_92px] gap-2 px-1 mb-1 text-[10px] font-medium text-[#9a9a95] uppercase tracking-wide">
                <span>От, мм</span><span>До, мм</span><span>%</span><span>Название (в КП)</span><span></span>
              </div>

              {axRows.length === 0 && <p className="text-[12px] text-[#9a9a95] px-1 py-2">Правил нет</p>}

              {axRows.map(row => (
                <div key={row.id} className={`grid grid-cols-2 sm:grid-cols-[70px_70px_64px_1fr_92px] gap-2 items-center py-1.5 border-t border-[#f2f2ef] ${row.active ? '' : 'opacity-45'}`}>
                  <input type="number" value={String(row.min_mm ?? '')} onChange={e => setField(row.id, 'min_mm', e.target.value)}
                    className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] font-mono outline-none focus:border-[#111110]" placeholder="0" />
                  <input type="number" value={row.max_mm == null ? '' : String(row.max_mm)} onChange={e => setField(row.id, 'max_mm', e.target.value === '' ? null : e.target.value)}
                    className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] font-mono outline-none focus:border-[#111110]" placeholder="∞" />
                  <input type="number" value={String(row.surcharge_percent ?? '')} onChange={e => setField(row.id, 'surcharge_percent', e.target.value)}
                    className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] font-mono outline-none focus:border-[#111110]" placeholder="0" />
                  <input type="text" value={row.label} onChange={e => setField(row.id, 'label', e.target.value)}
                    className="col-span-2 sm:col-span-1 bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] outline-none focus:border-[#111110]" placeholder="Крупногабарит: высота 2400–2600 мм" />
                  <div className="col-span-2 sm:col-span-1 flex items-center gap-1 justify-end">
                    <button onClick={() => toggleActive(row)} title={row.active ? 'Активно' : 'Выключено'}
                      className={`text-[10px] px-1.5 py-1 rounded-md border ${row.active ? 'border-emerald-200 text-emerald-600 bg-emerald-50' : 'border-[#e4e4e0] text-[#9a9a95]'}`}>
                      {row.active ? 'вкл' : 'выкл'}
                    </button>
                    <button onClick={() => saveRow(row)} disabled={savingId === row.id}
                      className="text-[11px] px-2 py-1 rounded-md bg-[#1d1d1f] text-white font-medium hover:bg-black disabled:opacity-40">
                      {savingId === row.id ? '…' : '✓'}
                    </button>
                    <button onClick={() => deleteRow(row)} title="Удалить"
                      className="text-[11px] px-1.5 py-1 rounded-md border border-red-200 text-red-500 hover:bg-red-50">✕</button>
                  </div>
                </div>
              ))}

              <button onClick={() => addRow(ax.value)}
                className="mt-2 text-[12px] text-[#6b6b66] hover:text-[#111110] border border-dashed border-[#d4d4ce] rounded-lg px-3 py-1.5 w-full">
                ＋ Добавить ступень
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
