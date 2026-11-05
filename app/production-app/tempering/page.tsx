'use client'

// Закалка (владелец 05.11.2026): вбили номер заказа, выбрали все изделия или часть, собрали лист,
// машина уехала, потом приняли: всё приехало или часть разбита — разбитое идёт в переделку.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import ProductionTabs from '@/components/ProductionTabs'
import { confirmDialog } from '@/lib/dialog'
import { loadJson, sendOrToast, toast } from '@/lib/toast'
import { daysWord, oldestFirst } from '@/lib/b2b/inWorkOrders'
import { batchTotals, rowOutstanding, temperKey } from '@/lib/production/tempering'
import { fmtDay, fmtKg, fmtM2, fmtRub, sizeOf, thickOf, type Batch, type BatchLine, type FoundOrder, type PoolLine, type TemperingData } from './types'

const API = '/api/production/tempering'
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
type Tab = 'compose' | 'drafts' | 'away' | 'history'
const TABS: Tab[] = ['compose', 'drafts', 'away', 'history']
type PickOrder = { id: number; no: string; client: string | null; lines: PoolLine[] }
type Picked = { order: PickOrder; line: PoolLine; qty: number }
type Result = { id?: number; deleted?: boolean; returned?: number; broken?: number; warnings?: string[] }

function tabFromUrl(): Tab {
  const t = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('tab')
  return TABS.includes(t as Tab) ? t as Tab : 'compose'
}

async function post(failTitle: string, body: Record<string, unknown>) {
  const r = await sendOrToast(failTitle, API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r) return null
  return await r.json().catch(() => ({})) as Result
}
function warn(title: string, warnings?: string[]) {
  if (warnings?.length) toast.error(title, { detail: warnings.join('; ') })
}
const lineTitle = (l: { material: string; thickness: number | null; width: number | null; height: number | null; layer?: number }) =>
  `${l.material}, ${thickOf(l.thickness)}, ${sizeOf(l)} мм${l.layer && l.layer > 1 ? `, стекло ${l.layer} пакета` : ''}`

function moneyText(t: ReturnType<typeof batchTotals>) {
  const parts = [`закалка ${fmtRub(t.cost)}`, `доставка ${fmtRub(t.transport)}`, `изделия ${fmtRub(t.amount)}`]
  return parts.join(' · ') + (t.noRate ? ` · без ставки строк: ${t.noRate}` : '')
}
function summary(t: ReturnType<typeof batchTotals>) {
  return `${t.orders} зак. · ${t.pieces} шт. · ${fmtM2(t.area)} · ${fmtKg(t.weight)}`
}

export default function TemperingPage() {
  const [data, setData] = useState<TemperingData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTabState] = useState<Tab>(tabFromUrl)
  const [selected, setSelected] = useState<Map<string, number>>(new Map())
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<FoundOrder[] | null>(null)
  const [finding, setFinding] = useState(false)
  const [date, setDate] = useState('')
  const [target, setTarget] = useState<number | 'new'>('new')
  const [busy, setBusy] = useState(false)

  function setTab(next: Tab) {
    setTabState(next)
    window.history.replaceState(null, '', `${window.location.pathname}?tab=${next}`)
  }

  const load = useCallback(async () => {
    const r = await loadJson<TemperingData>(API)
    if (r.error !== null) { setLoadError(r.error); return }
    setLoadError(null)
    setData(r.data)
    setDate(d => d || r.data.today)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const run = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try { await fn(); await load() } finally { setBusy(false) }
  }

  const batches = useMemo(() => data?.batches ?? [], [data])
  const drafts = useMemo(() => batches.filter(b => b.status === 'draft'), [batches])
  const sent = useMemo(() => batches.filter(b => b.status === 'sent').sort((a, b) => b.batch_date.localeCompare(a.batch_date) || b.id - a.id), [batches])
  const away = useMemo(() => sent.filter(b => batchTotals(b.lines).away > 0), [sent])
  const done = useMemo(() => sent.filter(b => batchTotals(b.lines).away === 0), [sent])
  const pool = useMemo(() => oldestFirst(data?.pool ?? [], o => o.launch_day), [data])
  const poolPieces = pool.reduce((s, o) => s + o.lines.filter(l => l.task === 'open').reduce((n, l) => n + l.free, 0), 0)
  const awayPieces = away.reduce((s, b) => s + batchTotals(b.lines).away, 0)
  const sentTarget = target === 'new' ? undefined : sent.find(b => b.id === target)

  // Выбор держим по всем заказам сразу: поиском нашли один, из списка взяли другой — лист один.
  const known = useMemo(() => {
    const map = new Map<number, PickOrder>()
    for (const o of pool) map.set(o.id, o)
    for (const o of found ?? []) if (!o.blocked) map.set(o.id, o)
    return map
  }, [pool, found])
  const [pickedOrders, setPickedOrders] = useState<Map<number, PickOrder>>(new Map())

  const picked = useMemo(() => {
    const out: Picked[] = []
    const all = new Map([...pickedOrders, ...known])
    for (const o of all.values()) for (const line of o.lines) {
      const qty = selected.get(temperKey(o.id, line.key, line.layer))
      if (qty) out.push({ order: o, line, qty: Math.min(qty, line.free) })
    }
    return out.filter(p => p.qty > 0)
  }, [known, pickedOrders, selected])

  const pickedPieces = picked.reduce((s, p) => s + p.qty, 0)
  const pickedArea = picked.reduce((s, p) => s + p.line.area * p.qty / p.line.qty, 0)
  const pickedBefore = useMemo(() => [...new Set(picked.flatMap(p => p.line.before))], [picked])

  function setLine(o: PickOrder, l: PoolLine, qty: number) {
    setPickedOrders(prev => new Map(prev).set(o.id, o))
    setSelected(prev => {
      const next = new Map(prev)
      const k = temperKey(o.id, l.key, l.layer)
      if (qty > 0) next.set(k, Math.min(qty, l.free)); else next.delete(k)
      return next
    })
  }
  // «Все изделия» берут только то, что ещё ждёт закалку; уже отмеченное закалённым выбирают руками.
  function setOrder(o: PickOrder, on: boolean) {
    for (const l of o.lines) if (l.free > 0 && (!on || l.task !== 'done')) setLine(o, l, on ? l.free : 0)
  }

  async function search() {
    const q = query.trim()
    if (!q) { setFound(null); return }
    setFinding(true)
    const r = await loadJson<{ found: FoundOrder[] }>(`${API}?find=${encodeURIComponent(q)}`)
    setFinding(false)
    if (r.error !== null) { toast.error('Поиск не сработал', { detail: r.error }); return }
    setFound(r.data.found)
  }

  const build = () => run(async () => {
    const lines = picked.map(p => ({ order_id: p.order.id, line_key: p.line.key, layer: p.line.layer, qty: p.qty }))
    if (sentTarget) {
      const ok = await confirmDialog({
        title: `Добавить в отправленный лист от ${fmtDay(sentTarget.batch_date)}?`,
        text: `${pickedPieces} шт. сразу станут уехавшими на закалку.${pickedBefore.length ? ` Закроются неотмеченные этапы до закалки: ${pickedBefore.join(', ')}.` : ''}`,
        confirmLabel: 'Добавить',
      })
      if (!ok) return
    }
    const res = await post('Лист не собран', target === 'new' ? { action: 'create', batch_date: date, lines } : { action: 'add', batch_id: target, lines })
    if (!res) return
    setSelected(new Map()); setPickedOrders(new Map()); setFound(null); setQuery('')
    if (sentTarget) {
      toast.success('Изделия добавлены в отправленный лист', { detail: 'Лист лежит во вкладке «На закалке».' })
      warn('Изделия добавлены, но не всё записалось', res.warnings)
      setTarget('new'); setTab('away')
      return
    }
    toast.success(target === 'new' ? 'Лист собран' : 'Изделия добавлены', { detail: 'Он ждёт во вкладке «К отправке». На закалку изделия уедут после кнопки «Отправить».' })
    setTarget('new'); setTab('drafts')
  })

  const send = (b: Batch) => run(async () => {
    const t = batchTotals(b.lines)
    const ok = await confirmDialog({
      title: `Отправить лист от ${fmtDay(b.batch_date)}?`,
      text: `${summary(t)}. Изделия станут уехавшими на закалку. По строкам, уехавшим целиком, неотмеченные этапы до закалки закроются автоматически.`,
      confirmLabel: 'Отправить',
    })
    if (!ok) return
    const res = await post('Лист не отправлен', { action: 'send', batch_id: b.id })
    if (!res) return
    toast.success('Лист отправлен', { detail: 'Он лежит во вкладке «На закалке», оттуда его принимают.' })
    warn('Лист отправлен, но не всё записалось', res.warnings)
    setTab('away')
  })

  const removeDraft = (b: Batch) => run(async () => {
    const ok = await confirmDialog({ title: `Удалить черновик от ${fmtDay(b.batch_date)}?`, text: 'Изделия снова можно будет выбрать.', confirmLabel: 'Удалить', danger: true })
    if (!ok) return
    const res = await post('Черновик не удалён', { action: 'delete', batch_id: b.id })
    if (res) toast.success('Черновик удалён')
  })

  const removeLine = (b: Batch, l: BatchLine) => run(async () => {
    const isSent = b.status === 'sent'
    const ok = await confirmDialog({
      title: 'Убрать изделие из листа?',
      text: `Заказ ${l.order_no}. ${lineTitle(l)}.${isSent ? ' Этапы, закрытые отправкой, вернутся в очередь.' : ''}${b.lines.length === 1 ? ' Это последняя строка: лист удалится.' : ''}`,
      confirmLabel: 'Убрать', danger: true,
    })
    if (!ok) return
    const res = await post('Строка не убрана', { action: 'remove', batch_id: b.id, row_id: l.id })
    if (!res) return
    toast.success(res.deleted ? 'Строка убрана, лист удалён' : 'Строка убрана')
    warn('Строка убрана, но не всё записалось', res.warnings)
  })

  const undo = (b: Batch) => run(async () => {
    const ok = await confirmDialog({ title: `Вернуть лист от ${fmtDay(b.batch_date)} в черновик?`, text: 'Изделия больше не на закалке. Этапы, закрытые отправкой, вернутся в очередь.', confirmLabel: 'Вернуть', danger: true })
    if (!ok) return
    const res = await post('Лист не возвращён', { action: 'undo', batch_id: b.id })
    if (!res) return
    toast.success('Лист в черновике', { detail: 'Он лежит во вкладке «К отправке».' })
    warn('Лист возвращён, но не всё записалось', res.warnings)
    setTab('drafts')
  })

  const receiveAll = (b: Batch) => run(async () => {
    const left = batchTotals(b.lines).away
    const ok = await confirmDialog({
      title: `Приехало всё по листу от ${fmtDay(b.batch_date)}?`,
      text: `Принимаем ${left} шт. Этап закалки закроется у строк, которые вернулись целиком.`,
      confirmLabel: 'Всё приехало',
    })
    if (!ok) return
    const res = await post('Приёмка не записана', { action: 'receive', batch_id: b.id })
    if (!res) return
    toast.success(`Принято: ${res.returned ?? 0} шт.`, { detail: 'Лист перешёл в историю.' })
    warn('Приёмка записана, но не всё прошло', res.warnings)
  })

  const receive = (b: Batch, rows: { id: number; returned: number; broken: number; comment: string }[]) => run(async () => {
    const returned = rows.reduce((s, r) => s + r.returned, 0)
    const broken = rows.reduce((s, r) => s + r.broken, 0)
    const ok = await confirmDialog({
      title: `Записать приёмку: приехало ${returned} шт., бой ${broken} шт.?`,
      text: broken > 0 ? 'Разбитые изделия пойдут в переделку с резки: маршрут позиции откроется заново, менеджер получит сообщение в приложении.' : 'Этап закалки закроется у строк, которые вернулись целиком.',
      confirmLabel: 'Записать', danger: broken > 0,
    })
    if (!ok) return
    const res = await post('Приёмка не записана', { action: 'receive', batch_id: b.id, rows })
    if (!res) return
    toast.success(`Записано: приехало ${res.returned ?? 0} шт., бой ${res.broken ?? 0} шт.`)
    warn('Приёмка записана, но не всё прошло', res.warnings)
  })

  if (loadError) return <div className="p-6 text-[13px] text-red-700">Не удалось загрузить закалку: {loadError}. Обновите страницу.</div>

  const canMoney = !!data?.canMoney
  const tabBtn = (key: Tab, label: string, n: number) => (
    <button key={key} onClick={() => setTab(key)} aria-pressed={tab === key}
      className={`h-10 px-3 rounded-xl border text-[13px] font-medium ${tab === key ? 'bg-[#111110] border-[#111110] text-white' : 'bg-white border-[#e4e4e0] text-[#4b4b47]'}`}>
      {label} · {n}
    </button>
  )

  return (
    <div className="max-w-4xl mx-auto px-4 py-4 pb-32 space-y-4">
      <ProductionTabs />
      <div>
        <h1 className="text-[20px] font-semibold text-[#111110]">♨️ Закалка</h1>
        <p className="text-[13px] text-[#6b6b66]">Вбейте номер заказа, выберите все изделия или часть, соберите лист и отправьте. Когда стекло вернётся, примите его: всё приехало или часть разбита.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabBtn('compose', 'Собрать лист', pool.length)}
        {tabBtn('drafts', 'К отправке', drafts.length)}
        {tabBtn('away', 'На закалке', away.length)}
        {tabBtn('history', 'История', done.length)}
      </div>

      {!data && <p className="text-[13px] text-[#9a9a95]">Загружаю…</p>}

      {data && tab === 'compose' && (
        <div className="space-y-4">
          <form onSubmit={e => { e.preventDefault(); void search() }} className="flex gap-2">
            <input value={query} onChange={e => { setQuery(e.target.value); if (!e.target.value.trim()) setFound(null) }} placeholder="Номер заказа" inputMode="numeric"
              className="flex-1 min-w-0 h-11 px-3 rounded-xl border border-[#e4e4e0] bg-white text-[14px]" />
            <button disabled={finding} className="h-11 px-4 rounded-xl bg-[#111110] text-white text-[13px] font-medium disabled:opacity-50">{finding ? 'Ищу…' : 'Найти'}</button>
          </form>

          {found && found.length === 0 && <p className="text-[13px] text-[#6b6b66]">Заказ с таким номером не найден.</p>}
          {found?.map(o => <OrderCard key={o.id} order={o} status={o.status} blocked={o.blocked} selected={selected} setLine={setLine} setOrder={setOrder} defaultOpen />)}

          <div>
            <p className="text-[13px] font-semibold text-[#111110]">Ждут закалки: {pool.length} зак., {poolPieces} шт.</p>
            <p className="text-[12px] text-[#6b6b66]">Этап закалки в цехе ещё открыт и изделия не в листе. Сверху самые старые заказы.</p>
          </div>
          {pool.map(o => <OrderCard key={o.id} order={o} overdue={o.overdue_days} selected={selected} setLine={setLine} setOrder={setOrder} />)}
          {pool.length === 0 && <p className="text-[13px] text-[#9a9a95]">Сейчас ничего не ждёт закалки.</p>}
        </div>
      )}

      {data && tab === 'drafts' && (
        <div className="space-y-3">
          {drafts.length === 0 && <p className="text-[13px] text-[#9a9a95]">Собранных листов нет. Соберите новый во вкладке «Собрать лист».</p>}
          {drafts.map(b => (
            <BatchCard key={b.id} batch={b} canMoney={canMoney} busy={busy} defaultOpen onRemoveLine={removeLine} actions={(
              <>
                <button disabled={busy} onClick={() => send(b)} className="h-9 px-4 rounded-lg bg-[#111110] text-white text-[13px] font-medium disabled:opacity-50">Отправить</button>
                <button disabled={busy} onClick={() => { setTarget(b.id); setTab('compose') }} className="h-9 px-3 rounded-lg border border-[#e4e4e0] text-[13px]">+ Добавить изделия</button>
                <button disabled={busy} onClick={() => removeDraft(b)} className="h-9 px-3 rounded-lg border border-red-200 text-[13px] text-red-600">Удалить</button>
              </>
            )} />
          ))}
        </div>
      )}

      {data && tab === 'away' && (
        <div className="space-y-3">
          <p className="text-[13px] text-[#111110] font-semibold">На закалке сейчас: {awayPieces} шт.</p>
          {away.length === 0 && <p className="text-[13px] text-[#9a9a95]">На закалке ничего нет.</p>}
          {away.map(b => <AwayCard key={b.id} batch={b} canMoney={canMoney} busy={busy} onAll={receiveAll} onSave={receive} onUndo={undo} onRemoveLine={removeLine}
            onAdd={() => { setTarget(b.id); setTab('compose') }} />)}
        </div>
      )}

      {data && tab === 'history' && <History batches={done} canMoney={canMoney} busy={busy} />}

      {picked.length > 0 && tab === 'compose' && (
        <div className="fixed left-0 right-0 bottom-0 z-40 bg-white border-t border-[#e4e4e0] px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          <div className="max-w-4xl mx-auto space-y-2">
            <p className="text-[13px] font-semibold text-[#111110]">
              Выбрано: {new Set(picked.map(p => p.order.id)).size} зак. · {pickedPieces} шт. · {fmtM2(pickedArea)}
            </p>
            {pickedBefore.length > 0 && <p className="text-[12px] text-amber-700">При отправке закроются неотмеченные этапы до закалки: {pickedBefore.join(', ')}.</p>}
            <div className="flex flex-wrap items-center gap-2">
              <select value={target} onChange={e => setTarget(e.target.value === 'new' ? 'new' : Number(e.target.value))} className="h-10 px-2 rounded-lg border border-[#e4e4e0] bg-white text-[13px]">
                <option value="new">Новый лист</option>
                {drafts.map(d => <option key={d.id} value={d.id}>В лист от {fmtDay(d.batch_date)}</option>)}
                {away.map(d => <option key={d.id} value={d.id}>В отправленный от {fmtDay(d.batch_date)}</option>)}
              </select>
              {target === 'new' && <input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-10 px-2 rounded-lg border border-[#e4e4e0] bg-white text-[13px]" />}
              <button disabled={busy} onClick={build} className="h-10 px-4 rounded-lg bg-[#111110] text-white text-[13px] font-medium disabled:opacity-50">{target === 'new' ? 'Собрать лист' : 'Добавить'}</button>
              <button onClick={() => { setSelected(new Map()); setPickedOrders(new Map()) }} className="h-10 px-3 text-[13px] text-[#6b6b66]">Снять выбор</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function OrderCard({ order, status, blocked, overdue, selected, setLine, setOrder, defaultOpen }: {
  order: PickOrder; status?: string; blocked?: boolean; overdue?: number; selected: Map<string, number>
  setLine: (o: PickOrder, l: PoolLine, qty: number) => void; setOrder: (o: PickOrder, on: boolean) => void; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  const waiting = order.lines.filter(l => l.free > 0 && l.task !== 'done')
  const pieces = waiting.reduce((s, l) => s + l.free, 0)
  const on = waiting.length > 0 && waiting.every(l => (selected.get(temperKey(order.id, l.key, l.layer)) ?? 0) >= l.free)
  return (
    <div className="rounded-xl border border-[#e4e4e0] bg-white">
      <div className="flex items-center gap-3 px-3 py-2.5">
        {!blocked && pieces > 0 && <input type="checkbox" aria-label={`Все изделия заказа ${order.no}`} checked={on} onChange={e => setOrder(order, e.target.checked)} className="w-5 h-5 shrink-0" />}
        <button onClick={() => setOpen(v => !v)} aria-expanded={open} className="flex-1 min-w-0 text-left flex flex-wrap items-baseline gap-x-2">
          <span className="text-[14px] font-semibold text-[#111110]">{order.no}</span>
          {order.client && <span className="text-[12px] text-[#6b6b66]">{order.client}</span>}
          <span className="text-[12px] text-[#6b6b66]">ждёт закалки {pieces} шт.</span>
          {!!overdue && overdue > 0 && <span className="text-[12px] text-red-600">просрочен на {overdue} {daysWord(overdue)}</span>}
          {status && <span className="text-[12px] text-[#6b6b66]">{status}</span>}
        </button>
      </div>
      {blocked && <p className="px-3 pb-2.5 text-[12px] text-amber-700">Этот заказ на закалку не отправить: {status?.toLowerCase()}.</p>}
      {!blocked && order.lines.length === 0 && <p className="px-3 pb-2.5 text-[12px] text-[#6b6b66]">В заказе нет изделий с закалкой.</p>}
      {open && !blocked && order.lines.length > 0 && (
        <div className="border-t border-[#f0f0ec] divide-y divide-[#f5f5f3]">
          {order.lines.map(l => {
            const k = temperKey(order.id, l.key, l.layer)
            const qty = selected.get(k) ?? 0
            const state = [
              l.drafted ? `в листе ${l.drafted}` : '', l.away ? `на закалке ${l.away}` : '', l.returned ? `вернулось ${l.returned}` : '', l.broken ? `бой ${l.broken}` : '',
              l.task === 'done' ? 'закалка уже отмечена в цехе' : '', l.task === 'none' ? 'этапа закалки в цехе нет' : '',
            ].filter(Boolean).join(' · ')
            return (
              <div key={k} className="flex items-center gap-3 px-3 py-2">
                <input type="checkbox" disabled={l.free === 0} aria-label={lineTitle(l)} checked={qty > 0} onChange={e => setLine(order, l, e.target.checked ? l.free : 0)} className="w-5 h-5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-[#111110]">{lineTitle(l)}</p>
                  <p className="text-[12px] text-[#6b6b66]">{l.qty} шт. · свободно {l.free}{state ? ` · ${state}` : ''}</p>
                </div>
                {qty > 0 && l.free > 1 && (
                  <input type="number" min={1} max={l.free} value={qty} aria-label="Количество" onChange={e => setLine(order, l, Math.floor(Number(e.target.value)) || 0)}
                    className="w-16 h-9 px-2 rounded-lg border border-[#e4e4e0] text-[13px] text-right" />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function LineRows({ batch, busy, canMoney, onRemoveLine, editable }: { batch: Batch; busy: boolean; canMoney: boolean; onRemoveLine?: (b: Batch, l: BatchLine) => void; editable?: boolean }) {
  return (
    <div className="divide-y divide-[#f5f5f3]">
      {batch.lines.map(l => (
        <div key={l.id} className="flex items-start gap-2 py-1.5">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-[#111110]"><span className="font-semibold">{l.order_no}</span> {lineTitle(l)}</p>
            <p className="text-[12px] text-[#6b6b66]">
              {l.qty} шт. · {fmtM2(l.area_m2)} · {fmtKg(l.weight_kg)}
              {canMoney ? ` · закалка ${l.cost == null ? 'нет ставки' : fmtRub(l.cost)}` : ''}
              {l.returned_qty ? ` · вернулось ${l.returned_qty}` : ''}{l.broken_qty ? ` · бой ${l.broken_qty}` : ''}
            </p>
          </div>
          {editable && onRemoveLine && l.returned_qty + l.broken_qty === 0 && (
            <button disabled={busy} onClick={() => onRemoveLine(batch, l)} aria-label="Убрать изделие из листа" className="px-1.5 text-[#9a9a95] hover:text-red-500">✕</button>
          )}
        </div>
      ))}
    </div>
  )
}

function BatchCard({ batch, canMoney, busy, actions, onRemoveLine, defaultOpen }: {
  batch: Batch; canMoney: boolean; busy: boolean; actions?: React.ReactNode; onRemoveLine?: (b: Batch, l: BatchLine) => void; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  const t = batchTotals(batch.lines)
  return (
    <div className="rounded-xl border border-[#e4e4e0] bg-white">
      <button onClick={() => setOpen(v => !v)} aria-expanded={open} className="w-full text-left px-3 py-2.5 flex flex-wrap items-baseline gap-x-2">
        <span className="text-[14px] font-semibold text-[#111110]">{fmtDay(batch.batch_date)}</span>
        <span className="text-[12px] text-[#6b6b66]">{summary(t)}</span>
        {t.broken > 0 && <span className="text-[12px] font-medium text-red-600">Бой: {t.broken} шт.</span>}
        {t.away > 0 && batch.status === 'sent' && <span className="text-[12px] font-medium text-amber-700">Ждём: {t.away} шт.</span>}
        {canMoney && <span className="text-[12px] text-[#6b6b66] w-full">{moneyText(t)}</span>}
      </button>
      {open && (
        <div className="border-t border-[#f0f0ec] px-3 py-2 space-y-2">
          <LineRows batch={batch} busy={busy} canMoney={canMoney} onRemoveLine={onRemoveLine} editable={!!onRemoveLine} />
          <div className="flex flex-wrap gap-2">
            {actions}
            <Link href={`/production-app/tempering/${batch.id}/print`} className="h-9 px-3 inline-flex items-center rounded-lg border border-[#e4e4e0] text-[13px] text-[#4b4b47]">Лист на закалку</Link>
          </div>
        </div>
      )}
    </div>
  )
}

function AwayCard({ batch, canMoney, busy, onAll, onSave, onUndo, onRemoveLine, onAdd }: {
  batch: Batch; canMoney: boolean; busy: boolean; onAll: (b: Batch) => void
  onSave: (b: Batch, rows: { id: number; returned: number; broken: number; comment: string }[]) => void
  onUndo: (b: Batch) => void; onRemoveLine: (b: Batch, l: BatchLine) => void; onAdd: () => void
}) {
  const [parts, setParts] = useState(false)
  const [marks, setMarks] = useState<Record<number, { returned: string; broken: string }>>({})
  const t = batchTotals(batch.lines)
  const untouched = t.returned + t.broken === 0
  const rows = batch.lines.filter(l => rowOutstanding(l) > 0)
  const num = (s: string | undefined) => Math.floor(Number(s)) || 0
  const payload = rows.map(l => ({ id: l.id, returned: num(marks[l.id]?.returned), broken: num(marks[l.id]?.broken), comment: '' })).filter(r => r.returned + r.broken > 0)
  const set = (id: number, field: 'returned' | 'broken', value: string) =>
    setMarks(m => ({ ...m, [id]: { returned: m[id]?.returned ?? '', broken: m[id]?.broken ?? '', [field]: value } }))
  return (
    <BatchCard batch={batch} canMoney={canMoney} busy={busy} defaultOpen onRemoveLine={onRemoveLine} actions={(
      <div className="w-full space-y-2">
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => onAll(batch)} className="h-9 px-4 rounded-lg bg-[#111110] text-white text-[13px] font-medium disabled:opacity-50">Всё приехало</button>
          <button onClick={() => setParts(v => !v)} aria-pressed={parts} className="h-9 px-3 rounded-lg border border-[#e4e4e0] text-[13px]">{parts ? 'Скрыть' : 'Приехало не всё или бой'}</button>
          <button disabled={busy} onClick={onAdd} className="h-9 px-3 rounded-lg border border-[#e4e4e0] text-[13px]">+ Добавить изделия</button>
          {untouched && <button disabled={busy} onClick={() => onUndo(batch)} className="h-9 px-3 rounded-lg border border-red-200 text-[13px] text-red-600">Вернуть в черновик</button>}
        </div>
        {parts && (
          <div className="rounded-lg bg-[#f5f5f3] p-2 space-y-2">
            {rows.map(l => (
              <div key={l.id} className="flex flex-wrap items-center gap-2">
                <p className="flex-1 min-w-[180px] text-[12px] text-[#111110]"><span className="font-semibold">{l.order_no}</span> {lineTitle(l)}, ждём {rowOutstanding(l)} шт.</p>
                <label className="text-[12px] text-[#6b6b66] flex items-center gap-1">Приехало
                  <input type="number" min={0} max={rowOutstanding(l)} value={marks[l.id]?.returned ?? ''} onChange={e => set(l.id, 'returned', e.target.value)} className="w-14 h-8 px-1 rounded border border-[#e4e4e0] bg-white text-right" />
                </label>
                <label className="text-[12px] text-red-600 flex items-center gap-1">Бой
                  <input type="number" min={0} max={rowOutstanding(l)} value={marks[l.id]?.broken ?? ''} onChange={e => set(l.id, 'broken', e.target.value)} className="w-14 h-8 px-1 rounded border border-[#e4e4e0] bg-white text-right" />
                </label>
              </div>
            ))}
            <button disabled={busy || payload.length === 0} onClick={() => { onSave(batch, payload); setMarks({}) }} className="h-9 px-4 rounded-lg bg-[#111110] text-white text-[13px] font-medium disabled:opacity-50">Записать приёмку</button>
          </div>
        )}
      </div>
    )} />
  )
}

function History({ batches, canMoney, busy }: { batches: Batch[]; canMoney: boolean; busy: boolean }) {
  const months = useMemo(() => {
    const map = new Map<string, Batch[]>()
    for (const b of batches) map.set(b.batch_date.slice(0, 7), [...(map.get(b.batch_date.slice(0, 7)) ?? []), b])
    return [...map.entries()]
  }, [batches])
  if (batches.length === 0) return <p className="text-[13px] text-[#9a9a95]">Принятых листов пока нет. Лист попадает сюда, когда по нему всё принято.</p>
  return (
    <div className="space-y-4">
      {months.map(([m, list]) => {
        const t = batchTotals(list.flatMap(b => b.lines))
        return (
          <div key={m} className="space-y-2">
            <p className="text-[13px] text-[#111110]">
              <span className="font-semibold">{MONTHS[Number(m.slice(5, 7)) - 1]} {m.slice(0, 4)}</span> · {list.length} лист. · {summary(t)}{t.broken ? ` · бой ${t.broken} шт.` : ''}
            </p>
            {canMoney && <p className="text-[12px] text-[#6b6b66]">{moneyText(t)}</p>}
            {list.map(b => <BatchCard key={b.id} batch={b} canMoney={canMoney} busy={busy} />)}
          </div>
        )
      })}
    </div>
  )
}
