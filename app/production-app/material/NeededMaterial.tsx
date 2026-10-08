'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { PROD_SINCE, parseNotes, materialStatus, isOrderCut } from '@/lib/orderFlags'
import { readPaged, readIn, errorText } from '@/lib/production/paged'
import { materialLabelShort } from '@/lib/materialLabel'

// «Нужен материал» — сводка закупки: все заказы, где мастер отметил «нет
// материала» (на весь заказ или на отдельные позиции), сгруппированные по
// материалу и толщине. Отметка на позицию считает ТОЛЬКО эту позицию,
// отметка на заказ — все его позиции.

type Item = { materialName?: string; category?: string; thickness?: number; width?: number; height?: number; quantity?: number }
type Order = { id: number; custom_number: string | null; client_name: string; items: unknown; notes: unknown }
type Line = { orderId: number; itemIndex: number; label: string; client: string; full: boolean; spec: string; qty: number }
type Group = { key: string; label: string; pieces: number; areaM2: number; lines: Line[] }

const specOf = (it: Item) => {
  const dims = it.width && it.height ? `${it.width}×${it.height}` : ''
  const mat = materialLabelShort(it)
  return [dims, mat].filter(Boolean).join(' · ')
}

type ReqStatus = Map<string, { status: string; expected: string | null }>

async function loadNeeded(): Promise<{ orders: Order[]; reqStatus: ReqStatus }> {
  const sb = createClient()
  const all = await readPaged<Order>((from, to) => sb.from('b2b_orders')
    .select('id,custom_number,client_name,items,notes')
    .gte('created_at', PROD_SINCE)
    .is('archived_at', null)
    .not('notes', 'ilike', '%"status":"quote"%')
    .not('notes', 'ilike', '%"historical":true%')
    .order('id').range(from, to))
  const flagged = all.filter(o => {
    const n = parseNotes(o.notes)
    const items = Array.isArray(n.material_needed_items) ? (n.material_needed_items as number[]) : []
    return materialStatus(o.notes) === 'needed' || items.length > 0
  })
  // Нарезанный заказ материал уже не ждёт — то же правило, что в закупке и на главной цеха.
  const cutTasks = await readIn<{ order_id: number }, number>(flagged.map(o => o.id), (part, from, to) =>
    sb.from('production_tasks').select('id, order_id').eq('stage_key', 'cutting').eq('status', 'done')
      .in('order_id', part).order('id').range(from, to))
  const cutByTask = new Set(cutTasks.map(t => Number(t.order_id)))
  const orders = flagged.filter(o => !isOrderCut(parseNotes(o.notes).stages as Record<string, unknown> | undefined, cutByTask.has(o.id)))
  const reqs = await readIn<{ b2b_order_id: number; item_index: number | null; status: string; expected_date: string | null }, number>(
    orders.map(o => o.id), (part, from, to) => sb.from('shop_purchase_requests')
      .select('id,b2b_order_id,item_index,status,expected_date')
      .in('b2b_order_id', part).order('id', { ascending: true }).range(from, to))
  const reqStatus: ReqStatus = new Map()
  for (const r of reqs) reqStatus.set(`${r.b2b_order_id}:${r.item_index ?? 'all'}`, { status: r.status, expected: r.expected_date })
  return { orders, reqStatus }
}

export default function NeededMaterial() {
  const [orders, setOrders] = useState<Order[]>([])
  // Статус закупки: 'orderId:all' / 'orderId:idx' → need|ordered|arrived + дата прибытия
  const [reqStatus, setReqStatus] = useState<ReqStatus>(new Map())
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [tick, setTick] = useState(0)
  const reload = () => { setLoading(true); setTick(t => t + 1) }

  useEffect(() => {
    let alive = true
    loadNeeded().then(r => {
      if (!alive) return
      setOrders(r.orders)
      setReqStatus(r.reqStatus)
      setErr(null)
    }).catch(e => {
      if (alive) setErr(errorText(e))
    }).finally(() => {
      if (alive) setLoading(false)
    })
    return () => { alive = false }
  }, [tick])

  if (loading) return <div className="px-4 pt-6 text-center text-[13px] text-[#9a9a95]">Загрузка…</div>

  const groups = new Map<string, Group>()
  for (const o of orders) {
    const full = materialStatus(o.notes) === 'needed'
    const marked = Array.isArray(parseNotes(o.notes).material_needed_items) ? (parseNotes(o.notes).material_needed_items as number[]) : []
    const items = Array.isArray(o.items) ? (o.items as Item[]) : []
    const label = o.custom_number?.trim() || `00${o.id}`
    items.forEach((it, idx) => {
      if (!full && !marked.includes(idx)) return
      const mat = (it.materialName || it.category || '').trim() || 'Материал не указан'
      const key = `${mat.toLowerCase()}|${it.thickness ?? ''}`
      const g = groups.get(key) ?? { key, label: [mat, it.thickness ? `${it.thickness} мм` : ''].filter(Boolean).join(' · '), pieces: 0, areaM2: 0, lines: [] }
      const qty = Math.max(1, it.quantity ?? 1)
      g.pieces += qty
      if (it.width && it.height) g.areaM2 += it.width * it.height * qty / 1e6
      g.lines.push({ orderId: o.id, itemIndex: idx, label, client: o.client_name, full, spec: specOf(it), qty })
      groups.set(key, g)
    })
  }
  const sorted = [...groups.values()].sort((a, b) => b.pieces - a.pieces)

  return (
    <div className="px-4 pt-4 space-y-4">
      {err && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-800 flex items-center justify-between gap-3">
          <span>Список не загрузился: {err}</span>
          <button onClick={reload} className="underline flex-shrink-0">Повторить</button>
        </div>
      )}
      {!err && sorted.length === 0 && (
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center">
          <p className="text-[14px] text-[#9a9a95]">Отметок «нет материала» нет — материала хватает</p>
          <p className="text-[12px] text-[#b0b0aa] mt-1">Мастер ставит их в «Моих задачах» (на заказ или на деталь) или во вкладке «Проверка материала»</p>
        </div>
      )}
      {sorted.map(g => (
        <div key={g.key}>
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <p className="text-[13px] font-bold text-[#111110]">{g.label}</p>
            <p className="text-[11px] text-[#9a9a95] flex-shrink-0"><span className="font-semibold text-[#111110]">{g.pieces} изд.</span>{g.areaM2 > 0 ? ` · ≈${Math.round(g.areaM2 * 10) / 10} м²` : ''}</p>
          </div>
          <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
            {g.lines.map((l, i) => {
              const r = reqStatus.get(`${l.orderId}:${l.full ? 'all' : l.itemIndex}`) ?? reqStatus.get(`${l.orderId}:all`)
              const kDate = r?.expected ? ` · к ${new Date(r.expected).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}` : ''
              return (
              <div key={i} className="flex items-center justify-between gap-2 px-4 py-2 border-b border-[#f8f8f7] last:border-0">
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-[#111110] truncate">
                    {l.label}
                    {l.full && <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">весь заказ</span>}
                    {r?.status === 'arrived'
                      ? <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">📦 пришёл</span>
                      : r?.status === 'ordered'
                      ? <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">🚚 заказано{kDate}</span>
                      : <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">в закупке</span>}
                  </p>
                  <p className="text-[11px] text-[#6b6b66] truncate">{l.client}</p>
                </div>
                <p className="text-[12px] font-mono text-[#111110] flex-shrink-0">{l.spec}{l.qty > 1 ? ` ×${l.qty}` : ''}</p>
              </div>
            )})}
          </div>
        </div>
      ))}
    </div>
  )
}
