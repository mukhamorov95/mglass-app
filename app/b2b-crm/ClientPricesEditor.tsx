'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

// А12: индивидуальный прайс клиента. Одна цена на пару «клиент + материал»,
// ₽/м² вкл. НДС — как в общем прайсе. Скидка клиента к такой цене не применяется
// (см. lib/b2b/clientPrices.ts), поэтому это конечная договорённость, а не «ещё минус».
//
// Пишут владелец и коммерческий (RLS в 20260828_b2b_client_prices.sql), менеджер
// видит цены, но не правит: цена — деньги.

type Material = { id: number; name: string; category: string; thickness: number; sale_price: number }
type PriceRow = { id: number; material_id: number; sale_price: number; comment: string; active: boolean }

export default function ClientPricesEditor({ clientId, canEdit }: { clientId: number; canEdit: boolean }) {
  const [materials, setMaterials] = useState<Material[]>([])
  const [prices, setPrices] = useState<PriceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addMatId, setAddMatId] = useState('')
  const [addPrice, setAddPrice] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    (async () => {
      const sb = createClient()
      const [{ data: mats }, { data: rows, error: err }] = await Promise.all([
        sb.from('b2b_materials').select('id,name,category,thickness,notes').eq('active', true).order('category').order('name'),
        sb.from('b2b_client_prices').select('id,material_id,sale_price,comment,active').eq('client_id', clientId),
      ])
      // Таблица прайсов появляется миграцией — до неё показываем понятную подсказку,
      // а не пустой экран без объяснений.
      if (err) setError('Таблица индивидуальных цен ещё не создана в базе (миграция 20260828)')
      setMaterials(((mats ?? []) as { id: number; name: string; category: string; thickness: number; notes: string | null }[])
        .map(m => {
          let sale = 0
          try { sale = m.notes ? (JSON.parse(m.notes)?.sale_price ?? 0) : 0 } catch {}
          return { id: m.id, name: m.name, category: m.category, thickness: m.thickness, sale_price: sale }
        }))
      setPrices((rows ?? []) as PriceRow[])
      setLoading(false)
    })()
  }, [clientId])

  const matById = new Map(materials.map(m => [m.id, m]))

  async function addPriceRow() {
    const materialId = Number(addMatId)
    const price = Math.round(Number(addPrice.replace(',', '.')))
    if (!materialId || !(price > 0)) return
    setSaving(true)
    try {
      const sb = createClient()
      const { data: { user } } = await sb.auth.getUser()
      let name: string | null = null
      if (user?.id) {
        const { data: prof } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
        name = (prof?.name as string | null) ?? user.email ?? null
      }
      const { data, error: err } = await sb.from('b2b_client_prices')
        .upsert({
          client_id: clientId, material_id: materialId, sale_price: price,
          active: true, created_by: user?.id ?? null, created_by_name: name,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'client_id,material_id' })
        .select('id,material_id,sale_price,comment,active')
        .single()
      if (err) { setError(err.message); return }
      setPrices(prev => [...prev.filter(p => p.material_id !== materialId), data as PriceRow])
      setAddMatId(''); setAddPrice(''); setError(null)
    } finally { setSaving(false) }
  }

  async function removePrice(id: number) {
    const sb = createClient()
    const { error: err } = await sb.from('b2b_client_prices').delete().eq('id', id)
    if (err) { setError(err.message); return }
    setPrices(prev => prev.filter(p => p.id !== id))
  }

  if (loading) return <p className="text-[11px] text-[#9a9a95]">Загрузка прайса…</p>

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95]">
        Индивидуальный прайс · ₽/м² вкл. НДС
      </p>
      {error && <p className="text-[11px] text-red-600">{error}</p>}

      {prices.length === 0 ? (
        <p className="text-[11px] text-[#9a9a95]">
          Цен нет — клиент считается по общему прайсу{canEdit ? '. Добавьте позицию ниже.' : '.'}
        </p>
      ) : (
        <div className="border border-[#e4e4e0] rounded-lg overflow-hidden divide-y divide-[#f0f0ec] bg-white">
          {prices.map(p => {
            const m = matById.get(p.material_id)
            const base = m?.sale_price ?? 0
            const delta = base > 0 ? Math.round((p.sale_price / base - 1) * 100) : 0
            return (
              <div key={p.id} className="px-3 py-1.5 flex items-center gap-3 text-[11px]">
                <span className="flex-1 min-w-0 truncate text-[#111110]">
                  {m ? `${m.name} · ${m.thickness} мм` : `материал #${p.material_id}`}
                </span>
                {base > 0 && (
                  <span className="text-[#9a9a95] font-mono whitespace-nowrap">
                    общий {base.toLocaleString('ru-RU')}
                  </span>
                )}
                <span className="font-mono font-semibold text-[#111110] whitespace-nowrap">
                  {Number(p.sale_price).toLocaleString('ru-RU')}
                </span>
                {base > 0 && delta !== 0 && (
                  <span className={`font-mono whitespace-nowrap ${delta < 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {delta > 0 ? '+' : ''}{delta}%
                  </span>
                )}
                {canEdit && (
                  <button onClick={() => removePrice(p.id)}
                    className="text-[#c4c4be] hover:text-red-500 transition-colors" title="Убрать индивидуальную цену">✕</button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {canEdit && (
        <div className="flex items-center gap-2 flex-wrap">
          <select value={addMatId} onChange={e => setAddMatId(e.target.value)}
            className="border border-[#e4e4e0] rounded-lg px-2 py-1 text-[11px] bg-white outline-none focus:border-[#111110] max-w-[260px]">
            <option value="">Материал…</option>
            {materials.map(m => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.thickness} мм{m.sale_price > 0 ? ` (${m.sale_price.toLocaleString('ru-RU')})` : ''}
              </option>
            ))}
          </select>
          <input value={addPrice} onChange={e => setAddPrice(e.target.value)} placeholder="₽/м²"
            inputMode="numeric"
            className="w-24 border border-[#e4e4e0] rounded-lg px-2 py-1 text-[11px] font-mono text-right bg-white outline-none focus:border-[#111110]" />
          <button onClick={addPriceRow} disabled={saving || !addMatId || !addPrice}
            className="text-[11px] font-semibold px-3 py-1 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
            {saving ? '…' : 'Добавить'}
          </button>
        </div>
      )}
      <p className="text-[10px] text-[#9a9a95]">
        К индивидуальной цене скидка клиента не применяется — это конечная цена.
      </p>
    </div>
  )
}
