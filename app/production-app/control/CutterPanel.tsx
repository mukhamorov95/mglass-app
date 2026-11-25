'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { loadJson } from '@/lib/toast'
import type { BoardOrder } from '@/lib/production/ordersBoard'
import type { CuttingSettings } from '@/lib/cuttingOptimizer'
import { buildPurchaseGroups, type PurchaseMaterial, type SheetVariant } from '@/lib/purchasing/supply'
import { allocateToSheets, cutPriority, type Allocation } from '@/lib/production/cutterPlan'

// Режим резчика (docs/production/SHOP_KANBAN_ROUTE.md, этапы 2–3): что нарезать — по
// материалу и толщине; резчик вводит, сколько целых листов есть, и детали раскладываются
// по ним — сначала заказы с более ранним запуском. Не влезло целиком — режем часть.

type Plan = { materials: PurchaseMaterial[]; variants: SheetVariant[]; settings: CuttingSettings }

const m2 = (w: number, h: number) => (w * h) / 1e6
const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

export default function CutterPanel({ orders }: { orders: BoardOrder[] }) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const [sheets, setSheets] = useState('')
  const [alloc, setAlloc] = useState<Allocation | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    loadJson<Plan>('/api/production/cutting-plan').then(r => {
      if (!alive) return
      if (r.error !== null) setErr(r.error)
      else setPlan(r.data)
    })
    return () => { alive = false }
  }, [])

  const queue = useMemo(() => orders.filter(o => o.cut_items.length > 0).sort(cutPriority), [orders])
  const byId = useMemo(() => new Map(queue.map(o => [o.id, o])), [queue])
  const rank = useMemo(() => new Map(queue.map((o, i) => [o.id, i])), [queue])

  const built = useMemo(() => {
    if (!plan) return null
    return buildPurchaseGroups(queue.map(o => ({ id: o.id, client: o.client, items: o.cut_items })), plan.materials, plan.variants)
  }, [plan, queue])

  const groups = useMemo(() => {
    if (!built) return []
    return [...built.groups.entries()].map(([k, g]) => ({
      key: k, g, label: g.materialLabel, pieces: g.pieces.length,
      area: g.pieces.reduce((s, p) => s + m2(p.width, p.height), 0),
      orders: new Set(g.pieces.map(p => p.orderId)).size,
    })).sort((a, b) => b.area - a.area)
  }, [built])

  const sel = groups.find(x => x.key === key) ?? null

  function run() {
    if (!sel || !plan) return
    const n = Math.floor(Number(sheets.replace(',', '.')))
    if (!(n > 0)) { setAlloc(null); return }
    setBusy(true)
    // Даём кнопке отрисовать «Раскладываю…»: расчёт синхронный.
    setTimeout(() => {
      setAlloc(allocateToSheets(sel.g, n, plan.settings, rank))
      setBusy(false)
    }, 20)
  }

  if (err) return <div className="bg-white border border-[#e4e4e0] rounded-xl p-3 text-[13px] text-[#c0392b]">Режим резчика не загрузился: {err}</div>
  if (!built) return <div className="bg-white border border-[#e4e4e0] rounded-xl p-3 text-[13px] text-[#9a9a95]">Считаю, что нарезать…</div>

  const orderName = (id: number) => { const o = byId.get(id); return o ? `№ ${o.no} · ${o.client || 'без заказчика'}` : `заказ ${id}` }

  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl p-3 space-y-3">
      <div>
        <h2 className="text-[15px] font-semibold text-[#111110]">✂️ Нужно нарезать</h2>
        <p className="text-[12px] text-[#9a9a95]">Детали, у которых резка не отмечена: {queue.length} заказов. Выберите материал, введите, сколько целых листов есть, — разложу, сначала старые заказы.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {groups.length === 0 && <span className="text-[13px] text-[#9a9a95]">Резать нечего.</span>}
        {groups.map(x => (
          <button key={x.key} onClick={() => { setKey(x.key); setAlloc(null) }}
            className={`text-left rounded-lg border px-3 py-2 ${key === x.key ? 'border-[#111110] bg-[#f5f5f3]' : 'border-[#e4e4e0] hover:border-[#111110]'}`}>
            <div className="text-[13px] font-semibold text-[#111110]">{x.label}</div>
            <div className="text-[11px] text-[#6b6b66] tabular-nums">{x.pieces} дет. · {fmt(x.area)} м² · заказов {x.orders}</div>
          </button>
        ))}
      </div>
      {built.unknown.length > 0 && (
        <p className="text-[11px] text-[#b9770e]">Нет в справочнике листов, не раскладываю: {built.unknown.map(u => `${u.material} ${u.thickness} мм (${u.pieces} шт.)`).join('; ')}</p>
      )}

      {sel && (
        <div className="border-t border-[#e4e4e0] pt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[12px] text-[#6b6b66]">
              Сколько целых листов «{sel.label}» есть
              <input value={sheets} onChange={e => setSheets(e.target.value)} inputMode="numeric" placeholder="например 3"
                className="block mt-1 w-40 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[15px]" />
            </label>
            <button onClick={run} disabled={busy || !sheets.trim()}
              className="px-4 py-2 rounded-lg bg-[#111110] text-white text-[13px] font-semibold disabled:opacity-40">
              {busy ? 'Раскладываю…' : 'Разложить'}
            </button>
            <span className="text-[11px] text-[#9a9a95]">Лист по справочнику: {sel.g.sheetWidth}×{sel.g.sheetHeight} мм</span>
          </div>

          {alloc && (
            <div className="space-y-3">
              <p className="text-[13px] text-[#111110]">
                Помещается <b>{alloc.placed.length}</b> из {sel.pieces} деталей
                {alloc.result ? <> на <b>{alloc.result.sheetsNeeded}</b> лист. {alloc.result.sheetWidth}×{alloc.result.sheetHeight}, заполнение {alloc.result.avgEfficiency}%</> : null}.
              </p>
              <div>
                <h3 className="text-[12px] font-semibold text-[#6b6b66] mb-1">Заказы по порядку запуска</h3>
                <ul className="space-y-0.5">
                  {alloc.byOrder.map(r => (
                    <li key={r.orderId} className="text-[12px] tabular-nums">
                      <span className={r.placed === r.total ? 'text-[#1e7d4f]' : r.placed > 0 ? 'text-[#b9770e]' : 'text-[#9a9a95]'}>
                        {r.placed === r.total ? '✓ целиком' : r.placed > 0 ? `часть: ${r.placed} из ${r.total}` : `не влезло (${r.total})`}
                      </span>{' '}
                      <span className="text-[#111110]">{orderName(r.orderId)}</span>
                      {byId.get(r.orderId)?.launch_day && <span className="text-[#9a9a95]"> · запуск {byId.get(r.orderId)!.launch_day!.slice(8, 10)}.{byId.get(r.orderId)!.launch_day!.slice(5, 7)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
              {alloc.result && (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {alloc.result.sheets.map(sh => (
                    <div key={sh.index} className="border border-[#e4e4e0] rounded-lg p-2">
                      <div className="text-[12px] font-semibold text-[#111110]">Лист {sh.index + 1} · {sh.efficiency}%</div>
                      <ul className="mt-1 space-y-0.5">
                        {sheetLines(sh.pieces).map(l => (
                          <li key={l.k} className="text-[11px] text-[#3b3b38] tabular-nums">{l.size} × {l.n} — {orderName(l.orderId)}</li>
                        ))}
                      </ul>
                      {sh.remnants.length > 0 && (
                        <div className="mt-1 text-[11px] text-[#2c5d8a]">Остатки: {sh.remnants.map(r => `${Math.round(r.w)}×${Math.round(r.h)}`).join(', ')}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {alloc.result?.sheets.some(s => s.remnants.length > 0) && (
                <p className="text-[11px] text-[#6b6b66]">После резки запишите остатки на стеллаж — <Link href="/production-app/remnants" className="underline">✂️ Остатки</Link>: так закупка увидит, что кусок есть.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function sheetLines(pieces: { label: string; orderId: number }[]) {
  const acc = new Map<string, { k: string; size: string; orderId: number; n: number }>()
  for (const p of pieces) {
    const k = `${p.orderId}|${p.label}`
    const cur = acc.get(k)
    if (cur) cur.n++
    else acc.set(k, { k, size: p.label, orderId: p.orderId, n: 1 })
  }
  return [...acc.values()]
}
