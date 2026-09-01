'use client'

// Отгрузка — отдельный экран, а не продолжение маршрута цеха.
//
// Упаковано не значит отгружено: заказ лежит на складе, пока за ним не приедут,
// иногда днями. С июля отметку «Отгружен» перестали ставить вовсе — вместе со
// всеми ручными этапами на карточке заказа, когда производство переехало в своё
// приложение. К 01.09 накопилось 134 заказа, где цех закрыл всё, а факт отъезда
// нигде не записан.
//
// Отмечать может любой из цеха и менеджер: чаще это Никита, но подходит тот, кто
// оказался у машины. Один ответственный — верный способ снова получить ноль отметок.

import { useCallback, useEffect, useMemo, useState } from 'react'
import ProductionTabs from '@/components/ProductionTabs'
import { createClient } from '@/lib/supabase-browser'
import { mskDateTime, mskDayShort } from '@/lib/time'
import { isReadyToShip, sortByWaiting, daysWaiting, matchesQuery, type ShipRow } from '@/lib/production/shipping'

const PROD_SINCE = '2026-07-01'

type OrderRow = { id: number; custom_number: string | null; client_name: string | null; notes: unknown }

function parseNotes(n: unknown): Record<string, unknown> {
  if (!n) return {}
  if (typeof n === 'object') return n as Record<string, unknown>
  try { return JSON.parse(String(n)) as Record<string, unknown> } catch { return {} }
}

export default function ShippingPage() {
  const sb = createClient()
  const [rows, setRows]       = useState<ShipRow[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ]             = useState('')
  const [busy, setBusy]       = useState<number | null>(null)
  const [justShipped, setJustShipped] = useState<Map<number, string>>(new Map())
  const [now, setNow]         = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: orders }, { data: tasks }] = await Promise.all([
      sb.from('b2b_orders').select('id,custom_number,client_name,notes').gte('created_at', PROD_SINCE).limit(2000),
      sb.from('production_tasks').select('order_id,status'),
    ])

    const agg = new Map<number, { total: number; done: number }>()
    for (const t of (tasks ?? []) as { order_id: number; status: string }[]) {
      const a = agg.get(t.order_id) ?? { total: 0, done: 0 }
      a.total++
      if (t.status === 'done') a.done++
      agg.set(t.order_id, a)
    }

    const list: ShipRow[] = ((orders ?? []) as OrderRow[]).map(o => {
      const n = parseNotes(o.notes)
      const stages = (n.stages ?? {}) as Record<string, string | null>
      const a = agg.get(o.id) ?? { total: 0, done: 0 }
      return {
        id:         o.id,
        number:     o.custom_number?.trim() || `00${o.id}`,
        client:     o.client_name ?? '—',
        packagedAt: stages.packaged ?? null,
        shippedAt:  stages.shipped ?? null,
        tasksTotal: a.total,
        tasksDone:  a.done,
      }
    })
    setRows(list)
    setLoading(false)
  }, [sb])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setNow(new Date()); load().catch(() => setLoading(false)) }, [load])

  async function ship(id: number, undo = false) {
    setBusy(id)
    const res = await fetch('/api/production/ship', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: id, undo }),
    }).catch(() => null)
    if (res?.ok) {
      const j = await res.json().catch(() => ({}))
      setRows(prev => prev.map(r => (r.id === id ? { ...r, shippedAt: undo ? null : (j.shipped_at ?? new Date().toISOString()) } : r)))
      setJustShipped(prev => {
        const m = new Map(prev)
        if (undo) m.delete(id); else m.set(id, j.by ?? '')
        return m
      })
    }
    setBusy(null)
  }

  const ready    = useMemo(() => sortByWaiting(rows.filter(isReadyToShip).filter(r => matchesQuery(r, q))), [rows, q])
  const searched = useMemo(() => (q.trim() ? rows.filter(r => matchesQuery(r, q)) : []), [rows, q])
  const shippedFound = useMemo(() => searched.filter(r => r.shippedAt), [searched])

  return (
    <div className="min-h-screen bg-[#f8f8f7]">
      <div className="sticky top-0 z-20 bg-[#f8f8f7] border-b border-[#e4e4e0] px-4 pt-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Отгрузка</h1>
            <p className="text-[13px] text-[#9a9a95] mt-0.5">
              {loading ? 'Загрузка…' : `${ready.length} ждут отгрузки`}
            </p>
          </div>
          <div className="relative flex-shrink-0">
            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Номер заказа или клиент"
              className={`border border-[#e4e4e0] rounded-lg pl-3 ${q ? 'pr-9' : 'pr-3'} py-2 text-[13px] bg-white w-56 outline-none focus:border-[#111110] [&::-webkit-search-cancel-button]:hidden`} />
            {q && (
              <button onClick={() => setQ('')} aria-label="Очистить поиск"
                className="absolute right-0 top-0 h-full w-9 flex items-center justify-center text-[#9a9a95] hover:text-[#111110] text-[16px] leading-none">×</button>
            )}
          </div>
        </div>
        <ProductionTabs />
      </div>

      <div className="px-4 py-4 max-w-3xl">
        {!loading && ready.length === 0 && !q && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-6 text-center text-[13px] text-[#9a9a95]">
            Готовых к отгрузке нет.
          </div>
        )}

        <div className="space-y-2">
          {ready.map(r => {
            const d = now ? daysWaiting(r, now) : null
            const long = d != null && d >= 7
            return (
              <div key={r.id} className={`bg-white rounded-xl border px-4 py-3 ${long ? 'border-amber-300' : 'border-[#e4e4e0]'}`}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-[15px] font-bold font-mono text-[#111110]">{r.number}</p>
                    <p className="text-[13px] text-[#6b6b66] truncate">{r.client}</p>
                    <p className={`text-[11px] mt-0.5 ${long ? 'text-amber-700 font-medium' : 'text-[#9a9a95]'}`}>
                      {r.packagedAt
                        ? `упакован ${mskDayShort(r.packagedAt)}${d != null ? ` · лежит ${d} дн.` : ''}`
                        : `цех закрыт${r.tasksTotal ? ` · ${r.tasksDone} из ${r.tasksTotal} задач` : ''}`}
                    </p>
                  </div>
                  <button onClick={() => ship(r.id)} disabled={busy === r.id}
                    className="px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold hover:opacity-90 disabled:opacity-40 flex-shrink-0">
                    {busy === r.id ? '…' : '🚚 Отгрузили'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Найденный по поиску, но уже отгруженный: чтобы человек видел, что заказ
            уехал и когда, а не искал его в пустоте и не жал отметку второй раз. */}
        {shippedFound.length > 0 && (
          <div className="mt-6">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-2">Уже отгружены</p>
            <div className="space-y-2">
              {shippedFound.map(r => (
                <div key={r.id} className="bg-white rounded-xl border border-[#eceff1] px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-[14px] font-bold font-mono text-[#6b6b66]">{r.number}</p>
                    <p className="text-[12px] text-[#9a9a95] truncate">{r.client}</p>
                    <p className="text-[11px] text-emerald-700 mt-0.5">
                      отгружен {r.shippedAt ? mskDateTime(r.shippedAt) : ''}
                      {justShipped.get(r.id) ? ` · ${justShipped.get(r.id)}` : ''}
                    </p>
                  </div>
                  <button onClick={() => ship(r.id, true)} disabled={busy === r.id}
                    title="Отметили по ошибке — вернуть в список"
                    className="px-3 py-2 rounded-lg border border-[#e4e4e0] text-[#6b6b66] text-[12px] hover:border-[#111110] flex-shrink-0">
                    {busy === r.id ? '…' : 'Вернуть'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
