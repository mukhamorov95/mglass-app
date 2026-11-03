'use client'

// Отгрузка Шовер Гласс (владелец 03.11.2026): собираем отгрузку из заказов и изделий и видим,
// что уехало, заказ уехал полностью или нет, какой вес и на какую сумму.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import ProductionTabs from '@/components/ProductionTabs'
import { confirmDialog } from '@/lib/dialog'
import { loadJson, sendOrToast, toast } from '@/lib/toast'
import { ORDER_STATE_LABEL, orderShipState, shareOf, shipmentTotals, type OrderShipState } from '@/lib/production/clientShipments'
import { fmtDay, fmtKg, fmtRub, type OrderLine, type PoolOrder, type Shipment, type ShipmentsData } from './types'

const API = '/api/production/client-shipments'
const STATE_CLS: Record<OrderShipState, string> = {
  none: 'bg-[#f5f5f3] text-[#4b4b47] border-[#e4e4e0]',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  full: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']

const selKey = (orderId: number, lineKey: string) => `${orderId}:${lineKey}`
const pieces = (n: number) => `${n} шт.`

function summaryText(t: ReturnType<typeof shipmentTotals>, canMoney: boolean) {
  return [`${t.orders} зак.`, pieces(t.pieces), fmtKg(t.weight), canMoney ? fmtRub(t.amount) : null].filter(Boolean).join(' · ')
}

async function post(failTitle: string, body: Record<string, unknown>) {
  const r = await sendOrToast(failTitle, API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r) return null
  return await r.json().catch(() => ({})) as { id?: number; shipped_orders?: number[]; reverted_orders?: number[]; warnings?: string[] }
}

function warn(title: string, warnings?: string[]) {
  if (warnings?.length) toast.error(title, { detail: warnings.join('; ') })
}

export default function ShowerGlassShipmentsPage() {
  const [data, setData] = useState<ShipmentsData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Map<string, number>>(new Map())
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [query, setQuery] = useState('')
  const [showMarked, setShowMarked] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [target, setTarget] = useState<number | 'new'>('new')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await loadJson<ShipmentsData>(API)
    if (r.error !== null) { setLoadError(r.error); return }
    setLoadError(null)
    setData(r.data)
    setNewDate(d => d || r.data.today)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const orderById = useMemo(() => new Map((data?.orders ?? []).map(o => [o.id, o])), [data])
  const drafts = useMemo(() => (data?.shipments ?? []).filter(s => s.status === 'draft'), [data])
  const history = useMemo(() => (data?.shipments ?? []).filter(s => s.status === 'shipped')
    .sort((a, b) => (b.ship_date ?? '').localeCompare(a.ship_date ?? '') || b.id - a.id), [data])

  // Список и счётчики над ним считаются из одного и того же отбора.
  const pool = useMemo(() => (data?.orders ?? []).filter(o => !o.marked_outside && o.state !== 'full'), [data])
  const marked = useMemo(() => (data?.orders ?? []).filter(o => o.marked_outside), [data])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = showMarked ? marked : pool
    return q ? list.filter(o => o.no.toLowerCase().includes(q) || String(o.id).includes(q)) : list
  }, [pool, marked, showMarked, query])

  const picked = useMemo(() => {
    const out: { order: PoolOrder; line: OrderLine; qty: number }[] = []
    for (const o of data?.orders ?? []) for (const l of o.lines) {
      const qty = selected.get(selKey(o.id, l.key))
      if (qty) out.push({ order: o, line: l, qty: Math.min(qty, l.free) })
    }
    return out.filter(p => p.qty > 0)
  }, [data, selected])

  const pickedTotals = useMemo(() => shipmentTotals(picked.map(p => ({
    order_id: p.order.id, qty: p.qty,
    weight: shareOf(p.line.weight, p.line.qty, p.line.shipped + p.line.drafted, p.qty),
    amount: shareOf(p.line.amount ?? 0, p.line.qty, p.line.shipped + p.line.drafted, p.qty),
  }))), [picked])

  function setLine(order: PoolOrder, line: OrderLine, qty: number) {
    setSelected(prev => {
      const next = new Map(prev)
      if (qty > 0) next.set(selKey(order.id, line.key), Math.min(qty, line.free))
      else next.delete(selKey(order.id, line.key))
      return next
    })
  }

  function toggleOrder(order: PoolOrder, on: boolean) {
    setSelected(prev => {
      const next = new Map(prev)
      for (const l of order.lines) {
        if (on && l.free > 0) next.set(selKey(order.id, l.key), l.free)
        else next.delete(selKey(order.id, l.key))
      }
      return next
    })
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try { await action(); await load() } finally { setBusy(false) }
  }

  const collect = () => run(async () => {
    const lines = picked.map(p => ({ order_id: p.order.id, line_key: p.line.key, qty: p.qty }))
    const res = target === 'new'
      ? await post('Отгрузка не создана', { action: 'create', ship_date: newDate, lines })
      : await post('Изделия не добавлены', { action: 'add', shipment_id: target, lines })
    if (!res) return
    setSelected(new Map())
    setTarget('new')
    toast.success(target === 'new' ? 'Отгрузка собрана' : 'Изделия добавлены', { detail: 'Она ждёт в блоке «Отгрузки к отправке» выше. Заказы станут отгруженными после кнопки «Отправить».' })
  })

  const dispatch = (s: Shipment, fullOrders: string[]) => run(async () => {
    const t = shipmentTotals(s.lines)
    const ok = await confirmDialog({
      title: `Отправить отгрузку от ${fmtDay(s.ship_date)}?`,
      text: `${summaryText(t, !!data?.canMoney)}. ${fullOrders.length
        ? `Отгруженными этой датой станут заказы: ${fullOrders.join(', ')}. Открытые задачи цеха по ним закроются.`
        : 'Ни один заказ не уедет полностью, отметка «отгружен» не поставится.'}`,
      confirmLabel: 'Отправить',
    })
    if (!ok) return
    const res = await post('Отгрузка не отправлена', { action: 'dispatch', shipment_id: s.id })
    if (!res) return
    toast.success('Отгрузка отправлена', { detail: `Лежит в истории ниже. Заказов отгружено полностью: ${res.shipped_orders?.length ?? 0}.` })
    warn('Отгрузка отправлена, но не всё записалось', res.warnings)
  })

  const undo = (s: Shipment) => run(async () => {
    const ok = await confirmDialog({
      title: `Вернуть отгрузку от ${fmtDay(s.ship_date)} в черновик?`,
      text: 'Отметка «отгружен» снимется с заказов, которые стали отгруженными из-за неё, задачи цеха вернутся в работу. Зафиксированные вес и сумма сбросятся.',
      confirmLabel: 'Вернуть', danger: true,
    })
    if (!ok) return
    const res = await post('Отгрузка не возвращена', { action: 'undo', shipment_id: s.id })
    if (!res) return
    toast.success('Отгрузка снова в черновиках', { detail: `Отметка снята с заказов: ${res.reverted_orders?.length ?? 0}.` })
    warn('Отгрузка возвращена, но не всё записалось', res.warnings)
  })

  const remove = (s: Shipment) => run(async () => {
    const ok = await confirmDialog({
      title: `Расформировать отгрузку от ${fmtDay(s.ship_date)}?`,
      text: 'Изделия вернутся в список заказов к отгрузке.', confirmLabel: 'Расформировать', danger: true,
    })
    if (!ok) return
    if (await post('Отгрузка не расформирована', { action: 'delete', shipment_id: s.id })) toast.success('Отгрузка расформирована')
  })

  const removeLine = (s: Shipment, orderId: number, key: string) => run(async () => {
    if (await post('Строка не убрана', { action: 'remove', shipment_id: s.id, order_id: orderId, line_key: key })) toast.success('Строка убрана из отгрузки')
  })

  const setDate = (s: Shipment, date: string) => run(async () => {
    if (date && await post('Дата не изменена', { action: 'set_date', shipment_id: s.id, ship_date: date })) toast.success(`Дата отгрузки: ${fmtDay(date)}`)
  })

  const canMoney = !!data?.canMoney

  return (
    <div className="min-h-screen bg-[#f5f5f3]">
      <ProductionTabs />
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-[#111110]">🚛 Отгрузка Шовер Гласс</h1>
          <p className="text-[13px] text-[#6b6b66] mt-1">Отметьте заказы или отдельные изделия, соберите отгрузку и отправьте её в день, когда машина уехала.</p>
        </div>

        {loadError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            Не удалось загрузить: {loadError}. <button onClick={() => void load()} className="underline font-medium">Обновить</button>
          </div>
        )}
        {!data && !loadError && <p className="text-[13px] text-[#9a9a95]">Загружаю…</p>}

        {data && (
          <>
            <section className="space-y-2">
              <h2 className="text-[15px] font-semibold text-[#111110]">Отгрузки к отправке{drafts.length ? ` · ${drafts.length}` : ''}</h2>
              {drafts.length === 0 && <p className="text-[13px] text-[#9a9a95]">Собранных отгрузок нет. Отметьте изделия в списке ниже.</p>}
              {drafts.map(s => (
                <DraftCard key={s.id} s={s} orderById={orderById} canMoney={canMoney} today={data.today} busy={busy}
                  onDispatch={dispatch} onRemove={remove} onRemoveLine={removeLine} onDate={setDate} />
              ))}
            </section>

            <section className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[15px] font-semibold text-[#111110]">{showMarked ? 'Отмечены отгруженными не отсюда' : 'Заказы к отгрузке'} · {visible.length}</h2>
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Номер заказа"
                  className="ml-auto h-9 w-36 rounded-lg border border-[#e4e4e0] bg-white px-2.5 text-[13px]" />
              </div>
              <label className="flex items-center gap-2 text-[12px] text-[#6b6b66]">
                <input type="checkbox" checked={showMarked} onChange={e => setShowMarked(e.target.checked)} />
                Показать заказы, отмеченные отгруженными без этого экрана (с 01.07): {marked.length}
              </label>
              {visible.length === 0 && <p className="text-[13px] text-[#9a9a95]">{query ? 'По этому номеру ничего нет.' : 'Заказов нет.'}</p>}
              <div className="space-y-1.5">
                {visible.map(o => (
                  <OrderRow key={o.id} order={o} selected={selected} canMoney={canMoney} expanded={open.has(o.id)}
                    onExpand={() => setOpen(prev => { const n = new Set(prev); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n })}
                    onToggle={on => toggleOrder(o, on)} onLine={(l, q) => setLine(o, l, q)} />
                ))}
              </div>
            </section>

            <History shipments={history} orderById={orderById} canMoney={canMoney} busy={busy} onUndo={undo} />
          </>
        )}
      </div>

      {picked.length > 0 && (
        <div className="sticky bottom-0 z-30 border-t border-[#e4e4e0] bg-white px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-2">
            <p className="text-[14px] font-semibold text-[#111110] w-full sm:w-auto sm:mr-auto">Выбрано: {summaryText(pickedTotals, canMoney)}</p>
            <select value={target} onChange={e => setTarget(e.target.value === 'new' ? 'new' : Number(e.target.value))}
              className="h-10 rounded-lg border border-[#e4e4e0] bg-white px-2 text-[13px] min-w-0">
              <option value="new">Новая отгрузка</option>
              {drafts.map(d => <option key={d.id} value={d.id}>В отгрузку от {fmtDay(d.ship_date)}</option>)}
            </select>
            {target === 'new' && (
              <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="h-10 rounded-lg border border-[#e4e4e0] bg-white px-2 text-[13px]" />
            )}
            <button onClick={() => setSelected(new Map())} className="h-10 px-3 rounded-lg border border-[#e4e4e0] text-[13px] text-[#4b4b47]">Сбросить</button>
            <button onClick={collect} disabled={busy || (target === 'new' && !newDate)}
              className="h-10 px-4 rounded-lg bg-[#111110] text-white text-[13px] font-medium disabled:opacity-50">
              {target === 'new' ? 'Собрать отгрузку' : 'Добавить'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function OrderRow({ order, selected, canMoney, expanded, onExpand, onToggle, onLine }: {
  order: PoolOrder; selected: Map<string, number>; canMoney: boolean; expanded: boolean
  onExpand: () => void; onToggle: (on: boolean) => void; onLine: (l: OrderLine, qty: number) => void
}) {
  const freeLines = order.lines.filter(l => l.free > 0)
  const pickedCount = freeLines.filter(l => selected.has(selKey(order.id, l.key))).length
  const totalPieces = order.lines.reduce((s, l) => s + l.qty, 0)
  const shippedPieces = order.lines.reduce((s, l) => s + l.shipped, 0)
  const draftedPieces = order.lines.reduce((s, l) => s + l.drafted, 0)
  const packedLines = order.lines.filter(l => l.packed).length
  const weight = order.lines.reduce((s, l) => s + l.weight, 0)
  const amount = order.lines.reduce((s, l) => s + (l.amount ?? 0), 0)

  return (
    <div className="rounded-lg border border-[#e4e4e0] bg-white">
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <input type="checkbox" className="mt-1 h-4 w-4" aria-label={`Выбрать заказ ${order.no}`} disabled={freeLines.length === 0}
          checked={freeLines.length > 0 && pickedCount === freeLines.length}
          ref={el => { if (el) el.indeterminate = pickedCount > 0 && pickedCount < freeLines.length }}
          onChange={e => onToggle(e.target.checked)} />
        <button onClick={onExpand} className="flex-1 min-w-0 text-left">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[14px] font-semibold text-[#111110]">{order.no}</span>
            <span className="text-[12px] text-[#9a9a95]">{fmtDay(order.created_at.slice(0, 10))}</span>
            <span className={`text-[11px] px-1.5 py-0.5 rounded border ${STATE_CLS[order.state]}`}>
              {ORDER_STATE_LABEL[order.state]}{order.state === 'partial' ? ` · ${shippedPieces} из ${totalPieces}` : ''}
            </span>
            {order.paid && <span className="text-[11px] px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700">Оплачен</span>}
            {order.marked_shipped && <span className="text-[11px] px-1.5 py-0.5 rounded border border-purple-200 bg-purple-50 text-purple-700">Отмечен {fmtDay(order.marked_shipped.slice(0, 10))}</span>}
            {draftedPieces > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded border border-sky-200 bg-sky-50 text-sky-700">В отгрузке {draftedPieces} шт.</span>}
          </div>
          <p className="text-[12px] text-[#6b6b66] mt-0.5">
            {order.lines.length} поз. · {pieces(totalPieces)} · {fmtKg(weight)}{canMoney ? ` · ${fmtRub(amount)}` : ''} · упаковано позиций {packedLines} из {order.lines.length}
          </p>
        </button>
        <span className="text-[#9a9a95] text-[12px] mt-1" aria-hidden>{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div className="border-t border-[#f0f0ec] divide-y divide-[#f4f4f0]">
          {order.lines.map(l => {
            const qty = selected.get(selKey(order.id, l.key)) ?? 0
            return (
              <div key={l.key} className="flex items-start gap-2.5 px-3 py-2">
                <input type="checkbox" className="mt-1 h-4 w-4" aria-label={`Выбрать ${l.label}`} disabled={l.free === 0} checked={qty > 0}
                  onChange={e => onLine(l, e.target.checked ? l.free : 0)} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-[#111110]">{l.label}{l.size ? `, ${l.size} мм` : ''}</p>
                  <p className="text-[12px] text-[#6b6b66]">
                    {pieces(l.qty)} · {fmtKg(l.weight)}{canMoney ? ` · ${fmtRub(l.amount ?? 0)}` : ''}
                    {l.shipped > 0 ? ` · отгружено ${l.shipped}` : ''}{l.drafted > 0 ? ` · в отгрузке ${l.drafted}` : ''}
                    {!l.packed && <span className="text-amber-700"> · не упаковано</span>}
                  </p>
                </div>
                {l.free > 1 && qty > 0 && (
                  <label className="flex items-center gap-1 text-[12px] text-[#6b6b66]">
                    <input type="number" min={1} max={l.free} value={qty} aria-label="Сколько штук отгрузить"
                      onChange={e => onLine(l, Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                      className="h-8 w-14 rounded border border-[#e4e4e0] px-1.5 text-[13px]" />
                    из {l.free}
                  </label>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Что будет с заказом после этой отгрузки: «уедет полностью» или «частично, 2 из 5».
function afterShipment(order: PoolOrder | undefined, s: Shipment) {
  if (!order) return { state: 'none' as OrderShipState, shippedAfter: 0, total: 0 }
  const here = (key: string) => s.lines.find(l => l.order_id === order.id && l.key === key)?.qty ?? 0
  const state = orderShipState(order.lines, key => (order.lines.find(l => l.key === key)?.shipped ?? 0) + here(key))
  return {
    state,
    shippedAfter: order.lines.reduce((sum, l) => sum + l.shipped + here(l.key), 0),
    total: order.lines.reduce((sum, l) => sum + l.qty, 0),
  }
}

function groupByOrder(s: Shipment) {
  const m = new Map<number, Shipment['lines']>()
  for (const l of s.lines) m.set(l.order_id, [...(m.get(l.order_id) ?? []), l])
  return [...m.entries()]
}

function DraftCard({ s, orderById, canMoney, today, busy, onDispatch, onRemove, onRemoveLine, onDate }: {
  s: Shipment; orderById: Map<number, PoolOrder>; canMoney: boolean; today: string; busy: boolean
  onDispatch: (s: Shipment, fullOrders: string[]) => void; onRemove: (s: Shipment) => void
  onRemoveLine: (s: Shipment, orderId: number, key: string) => void; onDate: (s: Shipment, date: string) => void
}) {
  const groups = groupByOrder(s)
  const future = !!s.ship_date && s.ship_date > today
  const fullOrders = groups.filter(([id]) => afterShipment(orderById.get(id), s).state === 'full').map(([, ls]) => ls[0].order_no)
  return (
    <div className="rounded-lg border border-[#e4e4e0] bg-white p-3 space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[13px] text-[#4b4b47]">
          Дата
          <input type="date" defaultValue={s.ship_date ?? ''} key={s.ship_date ?? ''} onBlur={e => { if (e.target.value !== (s.ship_date ?? '')) onDate(s, e.target.value) }}
            className="h-9 rounded-lg border border-[#e4e4e0] px-2 text-[13px]" />
        </label>
        <p className="text-[13px] font-semibold text-[#111110]">{summaryText(shipmentTotals(s.lines), canMoney)}</p>
      </div>
      <div className="divide-y divide-[#f4f4f0]">
        {groups.map(([orderId, lines]) => {
          const after = afterShipment(orderById.get(orderId), s)
          return (
            <div key={orderId} className="py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-semibold text-[#111110]">{lines[0].order_no}</span>
                <span className={`text-[11px] px-1.5 py-0.5 rounded border ${STATE_CLS[after.state === 'full' ? 'full' : 'partial']}`}>
                  {after.state === 'full' ? 'уедет полностью' : `уедет частично: ${after.shippedAfter} из ${after.total}`}
                </span>
              </div>
              {lines.map(l => (
                <div key={l.key} className="flex items-start gap-2 text-[12px] text-[#6b6b66] mt-1">
                  <p className="flex-1 min-w-0">{l.label}{l.size ? `, ${l.size} мм` : ''} · {l.qty} из {l.lineQty} шт. · {fmtKg(l.weight)}{canMoney ? ` · ${fmtRub(l.amount)}` : ''}</p>
                  <button disabled={busy} onClick={() => onRemoveLine(s, l.order_id, l.key)} aria-label="Убрать строку из отгрузки" className="px-1.5 text-[#9a9a95] hover:text-red-500">✕</button>
                </div>
              ))}
            </div>
          )
        })}
      </div>
      {future && <p className="text-[12px] text-amber-700">Отправить можно в день отгрузки, {fmtDay(s.ship_date)}.</p>}
      <div className="flex flex-wrap gap-2">
        <button disabled={busy || future || s.lines.length === 0} onClick={() => onDispatch(s, fullOrders)} className="h-10 px-4 rounded-lg bg-[#111110] text-white text-[13px] font-medium disabled:opacity-50">Отправить</button>
        <Link href={`/production-app/shower-glass/${s.id}/print`} className="h-10 px-3 inline-flex items-center rounded-lg border border-[#e4e4e0] text-[13px] text-[#4b4b47]">Лист отгрузки</Link>
        <button disabled={busy} onClick={() => onRemove(s)} className="h-10 px-3 rounded-lg border border-[#e4e4e0] text-[13px] text-red-600">Расформировать</button>
      </div>
    </div>
  )
}

function History({ shipments, orderById, canMoney, busy, onUndo }: {
  shipments: Shipment[]; orderById: Map<number, PoolOrder>; canMoney: boolean; busy: boolean; onUndo: (s: Shipment) => void
}) {
  const [openId, setOpenId] = useState<number | null>(null)
  const months = useMemo(() => {
    const m = new Map<string, Shipment[]>()
    for (const s of shipments) {
      const k = (s.ship_date ?? '').slice(0, 7)
      m.set(k, [...(m.get(k) ?? []), s])
    }
    return [...m.entries()]
  }, [shipments])

  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-semibold text-[#111110]">История отгрузок · {shipments.length}</h2>
      {shipments.length === 0 && <p className="text-[13px] text-[#9a9a95]">Отправленных отгрузок пока нет.</p>}
      {months.map(([month, list]) => (
        <div key={month} className="space-y-1.5">
          <p className="text-[12px] text-[#6b6b66]">
            <span className="font-semibold text-[#111110]">{MONTHS[Number(month.slice(5, 7)) - 1] ?? 'без даты'} {month.slice(0, 4)}</span>
            {' · '}{list.length} отгр. · {summaryText(shipmentTotals(list.flatMap(s => s.lines)), canMoney)}
          </p>
          {list.map(s => (
            <div key={s.id} className="rounded-lg border border-[#e4e4e0] bg-white">
              <button onClick={() => setOpenId(openId === s.id ? null : s.id)} className="w-full text-left px-3 py-2.5 flex flex-wrap items-center gap-x-2">
                <span className="text-[13px] font-semibold text-[#111110]">{fmtDay(s.ship_date)}</span>
                <span className="text-[12px] text-[#6b6b66]">{summaryText(shipmentTotals(s.lines), canMoney)}</span>
              </button>
              {openId === s.id && (
                <div className="border-t border-[#f0f0ec] px-3 py-2 space-y-2">
                  {groupByOrder(s).map(([orderId, lines]) => {
                    const o = orderById.get(orderId)
                    return (
                      <div key={orderId}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13px] font-semibold text-[#111110]">{lines[0].order_no}</span>
                          {o && <span className={`text-[11px] px-1.5 py-0.5 rounded border ${STATE_CLS[o.state]}`}>Сейчас: {ORDER_STATE_LABEL[o.state].toLowerCase()}</span>}
                        </div>
                        {lines.map(l => (
                          <p key={l.key} className="text-[12px] text-[#6b6b66] mt-0.5">{l.label} · {l.qty} из {l.lineQty} шт. · {fmtKg(l.weight)}{canMoney ? ` · ${fmtRub(l.amount)}` : ''}</p>
                        ))}
                      </div>
                    )
                  })}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Link href={`/production-app/shower-glass/${s.id}/print`} className="h-9 px-3 inline-flex items-center rounded-lg border border-[#e4e4e0] text-[13px] text-[#4b4b47]">Лист отгрузки</Link>
                    <button disabled={busy} onClick={() => onUndo(s)} className="h-9 px-3 rounded-lg border border-[#e4e4e0] text-[13px] text-red-600">Вернуть в черновик</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}
