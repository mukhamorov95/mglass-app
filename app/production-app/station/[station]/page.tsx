'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import ProductionTabs from '@/components/ProductionTabs'
import { SheetSVG } from '@/components/SheetSVG'
import { STAGE_LABELS, type DetailStageKey } from '@/lib/productionStages'
import {
  runCuttingOptimizer, DEFAULT_CUTTING_SETTINGS,
  type CuttingSettings, type PieceGroup, type MaterialCuttingResult,
} from '@/lib/cuttingOptimizer'
import { PROD_SINCE } from '@/lib/orderFlags'

// Агрегированный экран станции: задачи этого этапа из ВСЕХ заказов, собранные
// в партии по «материал + толщина». Для резки — со сводным раскроем (листы).
// Показываются только готовые к работе (предыдущий этап выполнен).
// Отметка — всей партией или построчно.

const STATIONS = ['cutting', 'curved', 'polishing', 'drilling', 'facet', 'tempering', 'triplex', 'packaging'] as const
type Station = typeof STATIONS[number]

type Task = { id: number; order_id: number; item_index: number; status: string; blocked_by_task_id: number | null; layer: number | null; layer_note: string | null }
type Item = {
  materialName?: string; thickness?: number; category?: string; width?: number; height?: number; quantity?: number
  hasTriplex?: boolean; triplexLayers?: number
  triplexGlasses?: { materialId?: number; materialName?: string; thickness?: number }[]
}
type OrderRow = { id: number; client_name: string; custom_number: string | null; items: Item[]; notes: string | null; launched_at: string | null }
type MatRow = { name: string; thickness: number; sheet_width: number | null; sheet_height: number | null; pattern_direction: string | null }

// А4: срок отгрузки заказа (из А1). Партия кроится по срочности, а не по числу листов.
function addWorkingDays(from: Date, days: number): Date {
  const d = new Date(from); let left = days
  while (left > 0) { d.setDate(d.getDate() + 1); const wd = d.getDay(); if (wd !== 0 && wd !== 6) left-- }
  return d
}
function orderDeadlineMs(o: OrderRow): number | null {
  let n: Record<string, unknown> = {}
  try { n = o.notes ? JSON.parse(o.notes) : {} } catch {}
  const dd = n.deadline_date
  if (typeof dd === 'string' && dd) return new Date(dd).getTime()
  if (o.launched_at) return addWorkingDays(new Date(o.launched_at), 15).getTime()
  return null
}

type Batch = {
  key: string
  label: string
  totalPieces: number
  totalAreaM2: number
  result: MaterialCuttingResult | null      // только для резки
  orders: { orderId: number; number: string; client: string; taskId: number; size: string; qty: number }[]
  taskIds: number[]
  minDeadlineMs: number | null              // самый ранний срок среди заказов партии
}

export default function StationBatchesPage() {
  const params = useParams<{ station: string }>()
  const station = (STATIONS.includes(params.station as Station) ? params.station : 'cutting') as Station
  const isCutting = station === 'cutting'

  const sb = createClient()
  const [loading, setLoading] = useState(true)
  const [batches, setBatches] = useState<Batch[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [matPending, setMatPending] = useState<Set<number>>(new Set())  // заказы, ждущие прихода материала (только резка)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: taskRows } = await sb
      .from('production_tasks')
      .select('id,order_id,item_index,status,blocked_by_task_id,layer,layer_note')
      .eq('stage_key', station)
      .in('status', ['queued', 'in_progress'])
    let tasks = (taskRows ?? []) as Task[]

    // Готовность: задача без блокировки или её блокер выполнен.
    const blockerIds = [...new Set(tasks.map(t => t.blocked_by_task_id).filter((x): x is number => x != null))]
    if (blockerIds.length) {
      const { data: bl } = await sb.from('production_tasks').select('id,status').in('id', blockerIds)
      const doneSet = new Set((bl ?? []).filter(b => b.status === 'done').map(b => b.id))
      tasks = tasks.filter(t => t.blocked_by_task_id == null || doneSet.has(t.blocked_by_task_id))
    }

    if (tasks.length === 0) { setBatches([]); setLoading(false); return }

    const orderIds = [...new Set(tasks.map(t => t.order_id))]
    const [{ data: orderRows }, { data: matRows }, { data: cfg }, { data: poRows }] = await Promise.all([
      sb.from('b2b_orders').select('id,client_name,custom_number,items,notes,launched_at').in('id', orderIds).gte('created_at', PROD_SINCE),
      isCutting ? sb.from('b2b_materials').select('name,thickness,sheet_width,sheet_height,pattern_direction').eq('active', true) : Promise.resolve({ data: [] as MatRow[] }),
      isCutting ? sb.from('cutting_settings').select('*').eq('id', 1).single() : Promise.resolve({ data: null }),
      // Заявки на материал по этим заказам (для гейта резки по приходу материала)
      isCutting ? sb.from('purchase_orders').select('b2b_order_ids,status').overlaps('b2b_order_ids', orderIds) : Promise.resolve({ data: [] as { b2b_order_ids: number[] | null; status: string | null }[] }),
    ])

    // Заказ ждёт материал, если по нему ЕСТЬ заявка, но НИ ОДНА не «забрана/закрыта».
    // Нет заявки = режем со склада, не блокируем.
    const ARRIVED = new Set(['picked_up', 'closed'])
    const hasReq = new Set<number>(), arrived = new Set<number>()
    for (const po of (poRows ?? [])) {
      for (const oid of (po.b2b_order_ids ?? [])) {
        if (!orderIds.includes(oid)) continue
        hasReq.add(oid)
        if (po.status && ARRIVED.has(po.status)) arrived.add(oid)
      }
    }
    const pending = new Set<number>([...hasReq].filter(oid => !arrived.has(oid)))
    setMatPending(pending)
    const orders = new Map((orderRows ?? []).map((o: OrderRow) => [o.id, o]))
    // Производственный контур — только заказы с PROD_SINCE
    tasks = tasks.filter(t => orders.has(t.order_id))
    if (tasks.length === 0) { setBatches([]); setLoading(false); return }
    const matLookup = new Map((matRows ?? []).map((m: MatRow) => [`${m.name}|${m.thickness}`, m]))
    const settings: CuttingSettings = { ...DEFAULT_CUTTING_SETTINGS, ...(cfg ?? {}) }

    const groups = new Map<string, PieceGroup>()
    const meta = new Map<string, { orders: Batch['orders']; area: number; minDeadlineMs: number | null }>()
    // Каждая задача — конкретное стекло: у триплекса задачи разложены ПО СЛОЯМ ещё при
    // запуске в производство (layer 1..N), слой задачи определяет материал/толщину.
    for (const t of tasks) {
      const order = orders.get(t.order_id)
      const item = order?.items?.[t.item_index]
      if (!order || !item || !item.width || !item.height) continue
      const ly = t.layer ?? 1
      const glass = (item.hasTriplex && ly >= 2)
        ? (item.triplexGlasses?.[ly - 2] ?? { materialName: item.materialName, thickness: item.thickness })
        : { materialName: item.materialName, thickness: item.thickness }
      const name = glass.materialName ?? 'Неизвестно'
      const thk  = glass.thickness ?? 0
      const key  = `${name}|${thk}`
      const mat  = matLookup.get(key)
      if (!groups.has(key)) {
        groups.set(key, {
          pieces: [], materialLabel: `${name}${thk > 0 ? ' ' + thk + ' мм' : ''}`, category: item.category ?? '',
          sheetWidth: mat?.sheet_width ?? 3210, sheetHeight: mat?.sheet_height ?? 2250,
          patternDirection: (mat?.pattern_direction ?? 'none') as PieceGroup['patternDirection'],
        })
        meta.set(key, { orders: [], area: 0, minDeadlineMs: null })
      }
      const g = groups.get(key)!
      const m = meta.get(key)!
      const qty = item.quantity ?? 1
      for (let i = 0; i < qty; i++) {
        g.pieces.push({ id: `${t.id}-${i}`, width: item.width, height: item.height, label: `${item.width}×${item.height}`, orderId: order.id, orderClientName: order.client_name, materialKey: key, canRotate: true })
      }
      m.area += (item.width * item.height * qty) / 1_000_000
      m.orders.push({ orderId: order.id, number: order.custom_number?.trim() || `#${order.id}`, client: order.client_name, taskId: t.id, size: `${item.width}×${item.height}${t.layer_note ? ` · ${t.layer_note}` : ''}`, qty })
      const dl = orderDeadlineMs(order)
      if (dl != null) m.minDeadlineMs = m.minDeadlineMs == null ? dl : Math.min(m.minDeadlineMs, dl)
    }

    const results = isCutting ? runCuttingOptimizer(groups, settings) : []
    const resByKey = new Map(results.map(r => [r.materialKey, r]))

    const out: Batch[] = [...groups.entries()].map(([key, g]) => {
      const m = meta.get(key)!
      return {
        key, label: g.materialLabel, totalPieces: g.pieces.length, totalAreaM2: m.area,
        result: resByKey.get(key) ?? null, orders: m.orders, taskIds: [...new Set(m.orders.map(o => o.taskId))],
        minDeadlineMs: m.minDeadlineMs,
      }
      // А4: сначала самое срочное по сроку отгрузки; при равенстве — крупные партии
      // (больше листов) вперёд. Заказы без срока — в конец.
    }).sort((a, b) => {
      const ad = a.minDeadlineMs ?? Infinity, bd = b.minDeadlineMs ?? Infinity
      if (ad !== bd) return ad - bd
      return (b.result?.sheetsNeeded ?? b.totalPieces) - (a.result?.sheetsNeeded ?? a.totalPieces)
    })

    setBatches(out)
    setLoading(false)
  }, [sb, station, isCutting])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  async function markTasks(taskIds: number[]) {
    setBusy(true)
    await Promise.all(taskIds.map(id =>
      fetch(`/api/production-tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'done' }) }).catch(() => {})))
    setBusy(false)
    load()
  }

  const totalSheets = batches.reduce((s, b) => s + (b.result?.sheetsNeeded ?? 0), 0)
  const totalPieces = batches.reduce((s, b) => s + b.totalPieces, 0)

  if (loading) return (
    <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка...</div>
  )

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Станции — {STAGE_LABELS[station as DetailStageKey]}</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">
          {batches.length} материалов · {isCutting ? `${totalSheets} листов` : `${totalPieces} деталей`} · партии по материалу и толщине
        </p>
        <ProductionTabs />
        <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-[#f0f0ec]">
          {STATIONS.map(s => (
            <Link key={s} href={`/production-app/station/${s}`}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors ${s === station ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4]'}`}>
              {STAGE_LABELS[s as DetailStageKey]}
            </Link>
          ))}
        </div>
      </div>

      <div className="px-4 pt-4 space-y-3">
        {isCutting && matPending.size > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-[12px] text-amber-800">
            ⏳ {matPending.size} {matPending.size === 1 ? 'заказ отмечен' : 'заказов отмечено'} «нет материала» — они подсвечены ниже, резка не блокируется
          </div>
        )}
        {batches.length === 0 && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center">
            <p className="text-[14px] text-[#9a9a95]">Нет готовых задач на этом этапе</p>
          </div>
        )}
        {batches.map(b => {
          const isOpen = expanded.has(b.key)
          return (
            <div key={b.key} className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <button className="min-w-0 text-left flex-1" onClick={() => setExpanded(p => { const n = new Set(p); n.has(b.key) ? n.delete(b.key) : n.add(b.key); return n })}>
                  <p className="text-[15px] font-bold text-[#111110] truncate flex items-center gap-2">
                    <span className="truncate">{b.label}</span>
                    {(() => {
                      const dm = b.minDeadlineMs
                      if (dm == null) return null
                      const start = new Date(); start.setHours(0, 0, 0, 0)
                      const days = Math.floor((dm - start.getTime()) / 86_400_000)
                      const cls = days < 0 ? 'bg-red-100 text-red-700' : days <= 1 ? 'bg-orange-100 text-orange-700' : days <= 3 ? 'bg-amber-100 text-amber-700' : 'bg-[#eef0ee] text-[#6b6b66]'
                      const txt = days < 0 ? `просрочено ${-days} дн` : days === 0 ? 'сегодня' : days === 1 ? 'завтра' : `${days} дн`
                      return <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`}>⏱ {txt}</span>
                    })()}
                  </p>
                  <p className="text-[12px] text-[#6b6b66]">
                    {b.result ? <><b className="text-blue-700">{b.result.sheetsNeeded}</b> листов · </> : null}
                    {b.totalPieces} деталей · {b.totalAreaM2.toFixed(2)} м² · из {b.orders.length} строк
                    {b.result ? <> · КПД <span className={b.result.avgEfficiency >= 70 ? 'text-emerald-600' : 'text-amber-600'}>{b.result.avgEfficiency}%</span></> : null}
                  </p>
                </button>
                <button onClick={() => markTasks(b.orders.map(o => o.taskId))}
                  disabled={busy}
                  className="text-[12px] font-semibold px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors whitespace-nowrap flex-shrink-0">
                  Готово всё
                </button>
              </div>
              {isOpen && (
                <div className="border-t border-[#f0f0ec]">
                  {isCutting && b.result && b.result.sheets.length > 0 && (
                    <div className="px-4 py-3 space-y-3 bg-[#fafaf9] border-b border-[#f0f0ec]">
                      <p className="text-[11px] font-semibold text-[#9a9a95] uppercase tracking-wide">Карта раскроя · {b.result.sheetsNeeded} лист(ов)</p>
                      {b.result.sheets.map((sheet, si) => (
                        <div key={si}>
                          <p className="text-[11px] text-[#6b6b66] mb-1">Лист {si + 1} · КПД {sheet.efficiency}%</p>
                          <SheetSVG sheet={sheet} sheetW={b.result!.sheetWidth} sheetH={b.result!.sheetHeight} edgeMargin={DEFAULT_CUTTING_SETTINGS.edge_margin} />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="divide-y divide-[#f8f8f7]">
                  {b.orders.map((o, i) => {
                    const waitMat = matPending.has(o.orderId)
                    return (
                    <div key={`${o.taskId}-${i}`} className="px-4 py-2.5 flex items-center justify-between gap-2">
                      <Link href={`/p/o/${o.orderId}`} className="min-w-0">
                        <p className="text-[13px] font-semibold text-[#111110] truncate">{o.number} <span className="text-[#9a9a95] font-normal">· {o.client}</span></p>
                        <p className="text-[12px] text-[#6b6b66]">{o.size} мм{o.qty > 1 ? ` × ${o.qty}` : ''}{waitMat && <span className="text-amber-600 font-medium"> · ⏳ ждёт материал</span>}</p>
                      </Link>
                      <button onClick={() => markTasks([o.taskId])} disabled={busy}
                        title={waitMat ? 'Материал отмечен «нет» — заказ подсвечен на закупку, но резать можно' : ''}
                        className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 disabled:hover:bg-transparent transition-colors whitespace-nowrap flex-shrink-0">
                        Готово
                      </button>
                    </div>
                  )})}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
