'use client'

import { useEffect, useState } from 'react'

// Себестоимость КОМПЛЕКТА ФУРНИТУРЫ бюджет-тарифа по каждой модели M1–M12 и цвету.
// Вера/владелец выверяют реальную цену; пусто → калькулятор считает по формуле
// (base × 0.6 × цвет). Эти же числа использует AI-менеджер Иван — цена едина.

type Model = { id: string; label: string; desc: string; hardwareBase: number }
type Color = { value: string; label: string; multiplier: number; colorId: number | null }
type Price = { model_id: string; color_id: number; price: number }

const fmt = (n: number) => n.toLocaleString('ru-RU') + ' ₽'

export function SelfCostTab() {
  const [models, setModels] = useState<Model[]>([])
  const [colors, setColors] = useState<Color[]>([])
  const [hwMult, setHwMult] = useState(0.6)
  const [draft, setDraft]   = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    setLoading(true); setErr(''); setMsg('')
    try {
      const r = await fetch('/api/shower/budget-hardware')
      if (!r.ok) throw new Error(r.status === 403 ? 'Нет доступа (нужен владелец / CFO / закупщик)' : 'Ошибка загрузки')
      const d = await r.json()
      setModels(d.models); setColors(d.colors); setHwMult(d.hwTierMultiplier)
      const dr: Record<string, string> = {}
      for (const p of (d.prices as Price[])) dr[`${p.model_id}:${p.color_id}`] = String(p.price)
      setDraft(dr)
    } catch (e) { setErr((e as Error).message) }
    finally { setLoading(false) }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [])

  const key     = (mId: string, cId: number) => `${mId}:${cId}`
  const formula = (m: Model, c: Color) => Math.round(m.hardwareBase * hwMult * c.multiplier)

  async function save() {
    setSaving(true); setMsg(''); setErr('')
    const items: Price[] = []
    for (const m of models) for (const c of colors) {
      if (c.colorId == null) continue
      const v = (draft[key(m.id, c.colorId)] ?? '').trim()
      items.push({ model_id: m.id, color_id: c.colorId, price: v === '' ? 0 : Math.max(0, Math.round(Number(v) || 0)) })
    }
    try {
      const r = await fetch('/api/shower/budget-hardware', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка сохранения')
      setMsg(`Сохранено вручную: ${d.saved} · сброшено на формулу: ${d.cleared}`)
      await load()
    } catch (e) { setErr((e as Error).message) }
    finally { setSaving(false) }
  }

  if (loading) return <p className="text-[13px] text-[#8a8a85]">Загрузка…</p>
  if (err && !models.length) return <p className="text-[13px] text-red-600">{err}</p>

  return (
    <div>
      <div className="mb-4 rounded-xl bg-[#f0f7ff] border border-[#d6e6fb] p-4 text-[12px] text-[#3a4a5a] leading-relaxed">
        <b>Себестоимость комплекта фурнитуры</b> (бюджет-тариф) по каждой модели и цвету.
        Стекло считается отдельно из матрицы цен (напр., «М1 прозрачное» 8 мм = <b>3 258 ₽/м²</b>) — здесь только фурнитура.
        Пустая ячейка = <b>по формуле</b> (базовая × {hwMult} × коэф. цвета). Заполненное значение — реальная выверенная себестоимость.
        Эти числа использует и калькулятор, и AI-менеджер <b>Иван</b> — цена всегда одна.
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#e4e4e0] bg-white">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[#f7f7f5] border-b border-[#e4e4e0] text-[#6b6b66]">
              <th className="text-left px-3 py-2.5 font-semibold">Модель</th>
              <th className="text-right px-3 py-2.5 font-semibold">База</th>
              {colors.map(c => (
                <th key={c.value} className="text-center px-3 py-2.5 font-semibold min-w-[130px]">
                  {c.label}
                  {c.colorId == null && <span className="block text-[10px] text-red-500 font-normal">нет цвета в БД</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {models.map(m => (
              <tr key={m.id} className="border-b border-[#f0f0ec] last:border-0">
                <td className="px-3 py-2.5">
                  <div className="font-semibold text-[#111110]">{m.label}</div>
                  <div className="text-[11px] text-[#9a9a95]">{m.desc}</div>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-[12px] text-[#9a9a95]">{fmt(m.hardwareBase)}</td>
                {colors.map(c => {
                  if (c.colorId == null) return <td key={c.value} className="px-3 py-2.5 text-center text-[#c7c7cc]">—</td>
                  const k = key(m.id, c.colorId)
                  const val = draft[k] ?? ''
                  const isManual = val.trim() !== ''
                  return (
                    <td key={c.value} className="px-3 py-2.5 text-center">
                      <input
                        inputMode="numeric"
                        value={val}
                        onChange={e => setDraft(d => ({ ...d, [k]: e.target.value.replace(/[^\d]/g, '') }))}
                        placeholder={String(formula(m, c))}
                        className={`w-[110px] text-center rounded-lg px-2 py-1.5 text-[13px] outline-none border transition-colors ${
                          isManual
                            ? 'bg-amber-50 border-amber-300 text-[#111110] font-semibold focus:border-amber-500'
                            : 'bg-white border-[#e8e8ed] text-[#6b6b66] focus:border-[#0071e3]'
                        }`}
                      />
                      <div className="text-[10px] text-[#c0c0c0] mt-0.5">
                        {isManual ? 'выверено' : `формула ${fmt(formula(m, c))}`}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-4 mt-4">
        <button onClick={save} disabled={saving}
          className="px-5 py-2 rounded-lg bg-[#111110] text-white text-[13px] font-medium disabled:opacity-50 hover:bg-black transition-colors">
          {saving ? 'Сохранение…' : 'Сохранить себестоимость'}
        </button>
        {msg && <span className="text-[12px] text-emerald-700">{msg}</span>}
        {err && <span className="text-[12px] text-red-600">{err}</span>}
      </div>
    </div>
  )
}
