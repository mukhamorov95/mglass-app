'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import {
  runCuttingOptimizer, DEFAULT_CUTTING_SETTINGS,
  type CuttingSettings, type PieceGroup, type MaterialCuttingResult,
} from '@/lib/cuttingOptimizer'

// Агрегированный экран резчика: все задачи этапа «резка» из ВСЕХ заказов,
// собранные в партии по «материал + толщина», со сводным раскроем (листы).
// Резчик отмечает либо всю партию («Всё нарезано»), либо строку заказа.

type Task = { id: number; order_id: number; item_index: number; status: string }
type Item = { materialName?: string; thickness?: number; category?: string; width?: number; height?: number; quantity?: number }
type OrderRow = { id: number; client_name: string; custom_number: string | null; items: Item[] }
type MatRow = { name: string; thickness: number; sheet_width: number | null; sheet_height: number | null; pattern_direction: string | null }

type Batch = {
  key: string
  label: string
  result: MaterialCuttingResult         // листы/КПД из оптимизатора
  totalPieces: number
  orders: { orderId: number; number: string; client: string; taskId: number; size: string; qty: number }[]
  taskIds: number[]
}

export default function CuttingBatchesPage() {
  const sb = createClient()
  const [loading, setLoading] = useState(true)
  const [batches, setBatches] = useState<Batch[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    // 1) задачи этапа резки в работе
    const { data: taskRows } = await sb
      .from('production_tasks')
      .select('id,order_id,item_index,status')
      .eq('stage_key', 'cutting')
      .in('status', ['queued', 'in_progress'])
    const tasks = (taskRows ?? []) as Task[]

    if (tasks.length === 0) { setBatches([]); setLoading(false); return }

    const orderIds = [...new Set(tasks.map(t => t.order_id))]
    const [{ data: orderRows }, { data: matRows }, { data: cfg }] = await Promise.all([
      sb.from('b2b_orders').select('id,client_name,custom_number,items').in('id', orderIds),
      sb.from('b2b_materials').select('name,thickness,sheet_width,sheet_height,pattern_direction').eq('active', true),
      sb.from('cutting_settings').select('*').eq('id', 1).single(),
    ])
    const orders = new Map((orderRows ?? []).map((o: OrderRow) => [o.id, o]))
    const matLookup = new Map((matRows ?? []).map((m: MatRow) => [`${m.name}|${m.thickness}`, m]))
    const settings: CuttingSettings = { ...DEFAULT_CUTTING_SETTINGS, ...(cfg ?? {}) }

    // 2) группируем по материал|толщина
    const groups = new Map<string, PieceGroup>()
    const meta = new Map<string, Batch['orders']>()
    for (const t of tasks) {
      const order = orders.get(t.order_id)
      const item = order?.items?.[t.item_index]
      if (!order || !item || !item.width || !item.height) continue
      const name = item.materialName ?? 'Неизвестно'
      const thk  = item.thickness ?? 0
      const key  = `${name}|${thk}`
      const mat  = matLookup.get(key)
      if (!groups.has(key)) {
        groups.set(key, {
          pieces: [], materialLabel: `${name}${thk > 0 ? ' ' + thk + ' мм' : ''}`, category: item.category ?? '',
          sheetWidth: mat?.sheet_width ?? 3210, sheetHeight: mat?.sheet_height ?? 2250,
          patternDirection: (mat?.pattern_direction ?? 'none') as PieceGroup['patternDirection'],
        })
        meta.set(key, [])
      }
      const g = groups.get(key)!
      const qty = item.quantity ?? 1
      for (let i = 0; i < qty; i++) {
        g.pieces.push({
          id: `${t.id}-${i}`, width: item.width, height: item.height, label: `${item.width}×${item.height}`,
          orderId: order.id, orderClientName: order.client_name, materialKey: key, canRotate: true,
        })
      }
      meta.get(key)!.push({
        orderId: order.id, number: order.custom_number?.trim() || `#${order.id}`,
        client: order.client_name, taskId: t.id, size: `${item.width}×${item.height}`, qty,
      })
    }

    const results = runCuttingOptimizer(groups, settings)
    const out: Batch[] = results.map(r => {
      const ords = meta.get(r.materialKey) ?? []
      return {
        key: r.materialKey, label: r.materialLabel, result: r,
        totalPieces: r.totalPieces, orders: ords,
        taskIds: [...new Set(ords.map(o => o.taskId))],
      }
    }).sort((a, b) => b.result.sheetsNeeded - a.result.sheetsNeeded)

    setBatches(out)
    setLoading(false)
  }, [sb])

  useEffect(() => { load() }, [load])

  async function markTasks(taskIds: number[]) {
    setBusy(true)
    await Promise.all(taskIds.map(id =>
      fetch(`/api/production-tasks/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'done' }),
      }).catch(() => {})))
    setBusy(false)
    load()
  }

  const totalSheets = batches.reduce((s, b) => s + b.result.sheetsNeeded, 0)

  if (loading) return (
    <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка...</div>
  )

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Резка — партии</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">{batches.length} материалов · {totalSheets} листов всего</p>
      </div>

      <div className="px-4 pt-4 space-y-3">
        {batches.length === 0 && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center">
            <p className="text-[14px] text-[#9a9a95]">Нет задач на резку</p>
          </div>
        )}
        {batches.map(b => {
          const isOpen = expanded.has(b.key)
          return (
            <div key={b.key} className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <button className="min-w-0 text-left flex-1" onClick={() => setExpanded(p => { const n = new Set(p); n.has(b.key) ? n.delete(b.key) : n.add(b.key); return n })}>
                  <p className="text-[15px] font-bold text-[#111110] truncate">{b.label}</p>
                  <p className="text-[12px] text-[#6b6b66]">
                    <b className="text-blue-700">{b.result.sheetsNeeded}</b> листов · {b.totalPieces} деталей · из {b.orders.length} строк ·
                    КПД <span className={b.result.avgEfficiency >= 70 ? 'text-emerald-600' : 'text-amber-600'}>{b.result.avgEfficiency}%</span>
                  </p>
                </button>
                <button onClick={() => markTasks(b.taskIds)} disabled={busy}
                  className="text-[12px] font-semibold px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors whitespace-nowrap flex-shrink-0">
                  Всё нарезано
                </button>
              </div>
              {isOpen && (
                <div className="border-t border-[#f0f0ec] divide-y divide-[#f8f8f7]">
                  {b.orders.map((o, i) => (
                    <div key={`${o.taskId}-${i}`} className="px-4 py-2.5 flex items-center justify-between gap-2">
                      <Link href={`/p/o/${o.orderId}`} className="min-w-0">
                        <p className="text-[13px] font-semibold text-[#111110] truncate">{o.number} <span className="text-[#9a9a95] font-normal">· {o.client}</span></p>
                        <p className="text-[12px] text-[#6b6b66]">{o.size} мм{o.qty > 1 ? ` × ${o.qty}` : ''}</p>
                      </Link>
                      <button onClick={() => markTasks([o.taskId])} disabled={busy}
                        className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 transition-colors whitespace-nowrap flex-shrink-0">
                        Нарезано
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
