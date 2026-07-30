'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// Партнёрский калькулятор. Цену считает СЕРВЕР (/api/partner/quote) нашим движком —
// в браузере никакой себестоимости/маржи. Партнёр видит только свою цену.

type Material = { id: number; name: string; category: string; thickness: number; salePrice: number }
type Draft = {
  key: string
  materialId: number | null
  width: string
  height: string
  quantity: string
  hasTempering: boolean
  hasFacet: boolean
  hasHoles: boolean
}
type PricedItem = { material: string; thickness: number; width: number; height: number; quantity: number; price: number }

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
let seq = 0
const newKey = () => `d${seq++}`

export default function PartnerNewQuotePage() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [linked, setLinked] = useState(true)
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Draft[]>([{ key: newKey(), materialId: null, width: '', height: '', quantity: '1', hasTempering: false, hasFacet: false, hasHoles: false }])
  const [comment, setComment] = useState('')
  const [preview, setPreview] = useState<{ items: PricedItem[]; total: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/partner/materials').then(r => r.json()).then(d => {
      if (!d.linked) { setLinked(false); return }
      setMaterials(d.materials ?? [])
      if (d.materials?.[0]) setDrafts(ds => ds.map(x => x.materialId == null ? { ...x, materialId: d.materials[0].id } : x))
    }).catch(() => setLinked(false)).finally(() => setLoading(false))
  }, [])

  function setField(key: string, patch: Partial<Draft>) {
    setDrafts(ds => ds.map(d => d.key === key ? { ...d, ...patch } : d))
    setPreview(null); setSavedId(null)
  }
  function addRow() {
    setDrafts(ds => [...ds, { key: newKey(), materialId: materials[0]?.id ?? null, width: '', height: '', quantity: '1', hasTempering: false, hasFacet: false, hasHoles: false }])
    setPreview(null)
  }
  function removeRow(key: string) { setDrafts(ds => ds.filter(d => d.key !== key)); setPreview(null) }

  function specs() {
    return drafts
      .filter(d => d.materialId && Number(d.width) > 0 && Number(d.height) > 0 && Number(d.quantity) > 0)
      .map(d => ({ materialId: d.materialId, width: Number(d.width), height: Number(d.height), quantity: Number(d.quantity), hasTempering: d.hasTempering, hasFacet: d.hasFacet, facetTypeMm: 10, hasHoles: d.hasHoles }))
  }

  async function run(save: boolean) {
    setErr(null)
    const items = specs()
    if (items.length === 0) { setErr('Заполните хотя бы одну позицию (материал, размеры, кол-во)'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/partner/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, save, comment }),
      })
      const d = await res.json()
      if (!res.ok) { setErr(d.error || 'Ошибка'); return }
      setPreview({ items: d.items, total: d.total })
      if (save && d.quoteId) setSavedId(d.quoteId)
    } catch { setErr('Сеть недоступна') } finally { setBusy(false) }
  }

  if (loading) return <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка…</div>
  if (!linked) return (
    <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center p-6">
      <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center max-w-sm">
        <p className="text-[14px] text-[#111110] font-medium">Аккаунт не привязан</p>
        <p className="text-[13px] text-[#9a9a95] mt-1">Обратитесь к менеджеру M-Glass.</p>
        <Link href="/partner" className="text-[12px] text-blue-600 mt-3 inline-block">← Мои заказы</Link>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-24">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-3 lg:pt-6 flex items-center justify-between">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Новый просчёт</h1>
        <Link href="/partner" className="text-[12px] text-[#9a9a95] hover:text-[#111110]">← Мои заказы</Link>
      </div>

      <div className="px-4 pt-4 space-y-2 max-w-[760px] mx-auto">
        {drafts.map((d, i) => (
          <div key={d.key} className="bg-white rounded-xl border border-[#e4e4e0] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[#9a9a95]">Позиция {i + 1}</span>
              {drafts.length > 1 && <button onClick={() => removeRow(d.key)} className="text-[11px] text-red-400 hover:text-red-600">Удалить</button>}
            </div>
            <select value={d.materialId ?? ''} onChange={e => setField(d.key, { materialId: Number(e.target.value) })}
              className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2.5 py-2 text-[13px] outline-none focus:border-[#111110]">
              {materials.map(m => <option key={m.id} value={m.id}>{m.name} · {m.thickness}мм</option>)}
            </select>
            <div className="grid grid-cols-3 gap-2">
              <input type="number" value={d.width} onChange={e => setField(d.key, { width: e.target.value })} placeholder="Ширина, мм"
                className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2.5 py-2 text-[13px] font-mono outline-none focus:border-[#111110]" />
              <input type="number" value={d.height} onChange={e => setField(d.key, { height: e.target.value })} placeholder="Высота, мм"
                className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2.5 py-2 text-[13px] font-mono outline-none focus:border-[#111110]" />
              <input type="number" value={d.quantity} onChange={e => setField(d.key, { quantity: e.target.value })} placeholder="Кол-во"
                className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2.5 py-2 text-[13px] font-mono outline-none focus:border-[#111110]" />
            </div>
            <div className="flex flex-wrap gap-3 text-[12px]">
              <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={d.hasTempering} onChange={e => setField(d.key, { hasTempering: e.target.checked })} className="accent-[#111110]" />Закалка</label>
              <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={d.hasFacet} onChange={e => setField(d.key, { hasFacet: e.target.checked })} className="accent-[#111110]" />Фацет</label>
              <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={d.hasHoles} onChange={e => setField(d.key, { hasHoles: e.target.checked })} className="accent-[#111110]" />Отверстия</label>
            </div>
          </div>
        ))}

        <button onClick={addRow} className="w-full text-[13px] text-[#6b6b66] hover:text-[#111110] border border-dashed border-[#d4d4ce] rounded-lg py-2">＋ Добавить позицию</button>

        <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={500} rows={2}
          placeholder="Комментарий к просчёту (необязательно)"
          className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />

        {err && <div className="text-[12px] text-red-500">{err}</div>}

        {preview && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-3">
            {preview.items.map((it, i) => (
              <div key={i} className="flex items-center justify-between text-[12px] py-1 border-b border-[#f4f4f0] last:border-0">
                <span className="text-[#6b6b66] truncate pr-2">{it.material} · {it.width}×{it.height} · {it.quantity} шт</span>
                <span className="font-mono font-medium text-[#111110] flex-shrink-0">{fmt(it.price)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between pt-2 mt-1">
              <span className="text-[13px] font-semibold text-[#111110]">Итого ваша цена</span>
              <span className="text-[17px] font-bold font-mono text-[#111110]">{fmt(preview.total)}</span>
            </div>
          </div>
        )}

        {savedId ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
            <p className="text-[14px] font-semibold text-emerald-800">Просчёт сохранён ✓</p>
            <p className="text-[12px] text-emerald-700 mt-0.5">Он появился в «Мои заказы» → Просчёты. Менеджер M-Glass его проверит.</p>
            <Link href="/partner" className="text-[12px] text-blue-600 mt-2 inline-block">← К моим заказам</Link>
          </div>
        ) : (
          <div className="flex gap-2 pt-1">
            <button onClick={() => run(false)} disabled={busy}
              className="flex-1 py-2.5 rounded-lg border border-[#111110] text-[13px] font-semibold text-[#111110] hover:bg-[#f0f0ec] disabled:opacity-40">
              {busy ? '…' : 'Посчитать'}
            </button>
            <button onClick={() => run(true)} disabled={busy}
              className="flex-1 py-2.5 rounded-lg bg-[#1d1d1f] text-white text-[13px] font-semibold hover:bg-black disabled:opacity-40">
              {busy ? '…' : 'Сохранить просчёт'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
