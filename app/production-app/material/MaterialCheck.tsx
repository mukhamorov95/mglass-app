'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { materialStatus, parseNotes } from '@/lib/orderFlags'

// Стадия «Материал» до резки (Бекмурза). Новый заказ, ушедший в резку, ждёт
// решения: «материал есть» → режем; «материала нет» → notes.material_status=needed
// + заявка в закупку (резка НЕ блокируется — мастер сам решает, что резать).
// Когда материал пришёл — «пришёл» → ready.

type Item = { materialName?: string; category?: string; thickness?: number; width?: number; height?: number; quantity?: number }
type Order = { id: number; custom_number: string | null; client_name: string; items: unknown; notes: unknown }

function itemsArr(items: unknown): Item[] { return Array.isArray(items) ? items as Item[] : [] }
function materialsText(items: unknown): string {
  return itemsArr(items).map(it => {
    const glass = [it.materialName || it.category || '', it.thickness ? `${it.thickness}мм` : ''].filter(Boolean).join(' ')
    const dims = it.width && it.height ? `${it.width}×${it.height}` : ''
    const qty = it.quantity && it.quantity > 1 ? ` ×${it.quantity}` : ''
    return ([glass, dims].filter(Boolean).join(' ') + qty).trim()
  }).filter(Boolean).join('; ')
}

export default function MaterialCheck() {
  const sb = createClient()
  const [orders, setOrders] = useState<Order[]>([])
  const [me, setMe] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data: { user } } = await sb.auth.getUser()
    if (user) {
      const { data: p } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
      setMe({ id: user.id, name: (p as { name: string | null } | null)?.name ?? user.email ?? 'Цех' })
    }
    const { data: tasks } = await sb.from('production_tasks').select('order_id').eq('stage_key', 'cutting').in('status', ['queued', 'in_progress'])
    const ids = [...new Set((tasks ?? []).map((t: { order_id: number }) => t.order_id))]
    if (!ids.length) { setOrders([]); setLoading(false); return }
    const { data: ords } = await sb.from('b2b_orders').select('id,custom_number,client_name,items,notes').in('id', ids)
    setOrders((ords ?? []) as Order[])
    setLoading(false)
  }, [sb])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  async function setStatus(o: Order, status: 'ready' | 'needed') {
    setBusy(o.id)
    try {
      const updated = { ...parseNotes(o.notes), material_status: status, material_checked_at: new Date().toISOString(), material_checked_by: me?.name ?? null }
      await sb.from('b2b_orders').update({ notes: JSON.stringify(updated) }).eq('id', o.id)
      if (status === 'needed') {
        const label = o.custom_number?.trim() || `#${o.id}`
        const title = `Материал: ${label} (${o.client_name})`
        const details = materialsText(o.items) || null
        await sb.from('shop_purchase_requests').insert({ title, qty: null, details, author_id: me?.id, author_name: me?.name, b2b_order_id: o.id, item_index: null })
        fetch('/api/shop-purchases/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, qty: '', author: me?.name, link: '' }) }).catch(() => {})
      }
      await load()
    } finally { setBusy(null) }
  }

  if (loading) return null
  const toCheck = orders.filter(o => materialStatus(o.notes) === null)
  const waiting = orders.filter(o => materialStatus(o.notes) === 'needed')
  if (!toCheck.length && !waiting.length) return null

  const label = (o: Order) => o.custom_number?.trim() || `#${o.id}`

  return (
    <div className="px-4 pt-4 space-y-4">
      {toCheck.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#111110] mb-2">Проверь материал · новые заказы · {toCheck.length}</p>
          <div className="space-y-2">
            {toCheck.map(o => (
              <div key={o.id} className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
                <p className="text-[14px] font-bold text-[#111110]">{label(o)} <span className="font-normal text-[#6b6b66]">· {o.client_name}</span></p>
                <p className="text-[12px] text-[#6b6b66] mt-0.5">{materialsText(o.items) || 'состав не указан'}</p>
                <div className="flex gap-2 mt-2.5">
                  <button disabled={busy === o.id} onClick={() => setStatus(o, 'ready')} className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold disabled:opacity-50">✅ Материал есть</button>
                  <button disabled={busy === o.id} onClick={() => setStatus(o, 'needed')} className="flex-1 py-2 rounded-lg border border-red-200 text-red-600 text-[13px] font-semibold disabled:opacity-50">🛒 Материала нет</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {waiting.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-red-600 mb-2">Ждут материала · в закупке · {waiting.length}</p>
          <div className="space-y-2">
            {waiting.map(o => (
              <div key={o.id} className="bg-red-50 rounded-xl border border-red-200 px-4 py-3">
                <p className="text-[14px] font-bold text-[#111110]">{label(o)} <span className="font-normal text-[#6b6b66]">· {o.client_name}</span></p>
                <p className="text-[12px] text-red-700 mt-0.5">Ждём материал — заявка в закупке. {materialsText(o.items)}</p>
                <button disabled={busy === o.id} onClick={() => setStatus(o, 'ready')} className="mt-2.5 w-full py-2 rounded-lg bg-[#111110] text-white text-[13px] font-semibold disabled:opacity-50">✅ Материал пришёл — можно резать</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
