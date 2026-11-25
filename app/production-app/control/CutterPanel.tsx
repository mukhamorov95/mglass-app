'use client'

import { useEffect, useMemo, useState } from 'react'
import { loadJson } from '@/lib/toast'
import type { BoardOrder } from '@/lib/production/ordersBoard'
import type { CuttingSettings } from '@/lib/cuttingOptimizer'
import { buildPurchaseGroups, type PurchaseMaterial, type SheetVariant } from '@/lib/purchasing/supply'
import { allocateToSheets, cutCandidates, cutPriority, type Allocation, type CutCandidate, type CutPosition } from '@/lib/production/cutterPlan'
import type { CutResult } from '@/lib/production/cutDoneApply'
import { confirmDialog } from '@/lib/dialog'
import CutDonePanel, { type CutRecord } from './CutDonePanel'

// Режим резчика (docs/production/SHOP_KANBAN_ROUTE.md, этапы 2–3): что нарезать — по
// материалу и толщине; резчик вводит, сколько целых листов есть, и детали раскладываются
// по ним — сначала заказы с более ранним запуском. Не влезло целиком — режем часть.

type Plan = { materials: PurchaseMaterial[]; variants: SheetVariant[]; settings: CuttingSettings }

// Недописанные остатки и отмена переживают перезагрузку телефона в цеху.
const RECORD_KEY = 'mg_cutter_done_v1'
function storedRecord(): CutRecord | null {
  try { return JSON.parse(localStorage.getItem(RECORD_KEY) ?? 'null') as CutRecord | null } catch { return null }
}

const posKey = (c: CutPosition) => `${c.order_id}|${c.item_index}|${c.layer}`

const m2 = (w: number, h: number) => (w * h) / 1e6
const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

export default function CutterPanel({ orders, canMark, onMarked }: { orders: BoardOrder[]; canMark: boolean; onMarked: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const [sheets, setSheets] = useState('')
  const [alloc, setAlloc] = useState<Allocation | null>(null)
  const [busy, setBusy] = useState(false)
  const [off, setOff] = useState<Set<string>>(new Set())
  const [marking, setMarking] = useState(false)
  const [markErr, setMarkErr] = useState<string | null>(null)
  const [record, setRecord] = useState<CutRecord | null>(storedRecord)

  function keep(r: CutRecord | null) {
    setRecord(r)
    try { if (r) localStorage.setItem(RECORD_KEY, JSON.stringify(r)); else localStorage.removeItem(RECORD_KEY) } catch { /* без памяти браузера панель живёт до перезагрузки */ }
  }

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
    setOff(new Set())
    setMarkErr(null)
    // Даём кнопке отрисовать «Раскладываю…»: расчёт синхронный.
    setTimeout(() => {
      setAlloc(allocateToSheets(sel.g, n, plan.settings, rank))
      setBusy(false)
    }, 20)
  }

  const cut = alloc ? cutCandidates(alloc.placed, queue) : { full: [], partial: [] }
  const chosen = cut.full.filter(c => !off.has(posKey(c)))
  const chosenPieces = chosen.reduce((n, c) => n + c.total, 0)

  async function markCut() {
    if (!alloc?.result || !sel || !built) return
    const materialId = built.materialByKey.get(sel.key)?.id
    if (!materialId) return
    const orderNos = [...new Set(chosen.map(c => byId.get(c.order_id)?.no ?? String(c.order_id)))]
    const ok = await confirmDialog({
      title: chosen.length ? `Отметить резку: ${chosen.length} поз., ${chosenPieces} дет.?` : 'Записать только листы и остатки?',
      text: chosen.length
        ? `Заказы № ${orderNos.join(', ')}. Отметка запишется на вас, отменить можно сразу после.`
        : 'Ни одна позиция не выбрана — резка в заказах не отметится.',
      confirmLabel: chosen.length ? 'Отрезано' : 'Дальше',
    })
    if (!ok) return
    setMarking(true); setMarkErr(null)
    let result: CutRecord['result'] = null
    if (chosen.length) {
      const r = await loadJson<CutResult>('/api/production/cut-done', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions: chosen.map(c => ({ order_id: c.order_id, item_index: c.item_index, layer: c.layer })) }),
      })
      if (r.error !== null) { setMarking(false); setMarkErr(`Не отмечено: ${r.error}. Обновите страницу и проверьте табло, прежде чем жать снова.`); return }
      const totalOf = new Map(chosen.map(c => [posKey(c), c.total]))
      const pieces = r.data.done.reduce((n, d) => n + (totalOf.get(posKey(d)) ?? 0), 0)
      result = { ...r.data, pieces }
    }
    const names: Record<number, string> = {}
    for (const c of [...cut.full, ...cut.partial]) names[c.order_id] = orderName(c.order_id)
    keep({
      materialId, label: sel.label, names, result, undone: false, location: '',
      sheet: { w: alloc.result.sheetWidth, h: alloc.result.sheetHeight },
      sheets: alloc.result.sheets.map(sh => ({
        index: sh.index, orderIds: [...new Set(sh.pieces.map(p => p.orderId))],
        remnants: sh.remnants.map(x => ({ on: true, w: String(Math.round(x.w)), h: String(Math.round(x.h)) })),
      })),
    })
    setMarking(false); setAlloc(null); setSheets('')
    onMarked()
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
      {record && <CutDonePanel rec={record} onChange={keep} onClose={() => keep(null)} onMarksChanged={onMarked} />}
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
              {alloc.result && canMark && (
                <div className="border-t border-[#e4e4e0] pt-3 space-y-2">
                  <h3 className="text-[13px] font-semibold text-[#111110]">Отрезали? Отметить резку</h3>
                  {cut.full.length > 0 && <p className="text-[11px] text-[#6b6b66]">Здесь позиции, у которых в раскладке все детали. Что не резали — снимите галочку.</p>}
                  <ul className="space-y-1">
                    {cut.full.map(c => (
                      <li key={posKey(c)}>
                        <label className="flex items-start gap-2 text-[13px] text-[#111110] cursor-pointer">
                          <input type="checkbox" className="w-5 h-5 shrink-0" checked={!off.has(posKey(c))}
                            onChange={() => setOff(prev => { const next = new Set(prev); if (!next.delete(posKey(c))) next.add(posKey(c)); return next })} />
                          <span className="tabular-nums">{orderName(c.order_id)}, {positionName(byId.get(c.order_id), c)} — {c.total} дет.</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {cut.partial.length > 0 && (
                    <p className="text-[12px] text-[#b9770e]">Не отмечу, влезли не все детали: {cut.partial.map(c => `${orderName(c.order_id)}, ${positionName(byId.get(c.order_id), c)} — ${c.placed} из ${c.total}`).join('; ')}.</p>
                  )}
                  {record && <p className="text-[12px] text-[#b9770e]">Сначала запишите или закройте блок «Отрезано» выше.</p>}
                  <button onClick={markCut} disabled={marking || !!record}
                    className="w-full sm:w-auto px-5 py-3 rounded-lg bg-[#1e7d4f] text-white text-[14px] font-semibold disabled:opacity-40">
                    {marking ? 'Отмечаю…' : chosen.length ? `✓ Отрезано: ${chosen.length} поз., ${chosenPieces} дет.` : 'Отрезано — записать только остатки'}
                  </button>
                  {markErr && <p className="text-[12px] text-[#c0392b]">{markErr}</p>}
                </div>
              )}
              {alloc.result && !canMark && <p className="text-[11px] text-[#6b6b66]">Отмечает резку цех — со своего входа.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function positionName(o: BoardOrder | undefined, c: CutCandidate) {
  const it = o?.cut_items.find(x => x.item_index === c.item_index) as { hasTriplex?: boolean } | undefined
  return `поз. ${c.item_index + 1}${it?.hasTriplex ? `, стекло ${c.layer}` : ''}`
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
