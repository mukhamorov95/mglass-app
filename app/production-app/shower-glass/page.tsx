'use client'

// Отгрузка Шовер Гласс (владелец 03.11.2026): собираем отгрузку из заказов и изделий и видим,
// что уехало, заказ уехал полностью или нет, какой вес и на какую сумму.
// Вкладки (05.11.2026): в работе, упакованы, отгружены, просроченные, сверху самые старые; отдельно отгрузки.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import ProductionTabs from '@/components/ProductionTabs'
import OrderLookup from '@/components/OrderLookup'
import { confirmDialog } from '@/lib/dialog'
import { loadJson, sendOrToast, toast } from '@/lib/toast'
import { daysWord, oldestFirst } from '@/lib/b2b/inWorkOrders'
import { ORDER_HIDDEN_LABEL, ORDER_STATE_LABEL, numberMatches, orderInShipment, orderInShipmentText, shareOf, shipmentTotals, stripZeros, type OrderShipState, type OrderStage } from '@/lib/production/clientShipments'
import { fmtDay, fmtKg, fmtRub, type OrderLine, type PoolOrder, type Shipment, type ShipmentsData } from './types'

const API = '/api/production/client-shipments'
const STATE_CLS: Record<OrderShipState, string> = {
  none: 'bg-[#f5f5f3] text-[#4b4b47] border-[#e4e4e0]',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  full: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']

type Tab = OrderStage | 'overdue' | 'shipments' | 'history'
type OrderTab = Exclude<Tab, 'shipments' | 'history'>
const ORDER_TABS: { key: OrderTab; label: string; hint: string; empty: string }[] = [
  { key: 'in_work', label: 'В работе', hint: 'Не упакованы целиком и ещё не уехали.', empty: 'Заказов в работе нет.' },
  { key: 'packed', label: 'Упакованы', hint: 'Цех упаковал все позиции, заказ ещё не уехал.', empty: 'Заказов, упакованных целиком, нет. Заказ попадает сюда, когда цех закрыл упаковку по всем позициям.' },
  { key: 'shipped', label: 'Отгружены', hint: 'Уехали полностью или отмечены отгруженными (с 01.07). Отмеченный без этого экрана заказ можно занести в отгрузку: отметьте его изделия.', empty: 'Отгруженных заказов нет.' },
  { key: 'overdue', label: 'Просроченные', hint: 'Срок прошёл, а заказ уехал не полностью. Эти же заказы есть во вкладках «В работе» и «Упакованы».', empty: 'Просроченных заказов нет.' },
]
const TAB_KEYS: Tab[] = [...ORDER_TABS.map(t => t.key), 'shipments', 'history']
const inTab = (o: PoolOrder, tab: OrderTab) => !o.hidden && (tab === 'overdue' ? o.overdue_days > 0 : o.stage === tab)
const matches = (o: PoolOrder, q: string) => numberMatches(q, o.no, o.id)
const overdueLabel = (days: number) => `Просрочен на ${days} ${daysWord(days)}`

function tabFromUrl(): Tab {
  const t = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('tab')
  return TAB_KEYS.includes(t as Tab) ? t as Tab : 'in_work'
}

const selKey = (orderId: number, lineKey: string) => `${orderId}:${lineKey}`
const pieces = (n: number) => `${n} шт.`

function summaryText(t: ReturnType<typeof shipmentTotals>, canMoney: boolean) {
  return [`${t.orders} зак.`, pieces(t.pieces), fmtKg(t.weight), canMoney ? fmtRub(t.amount) : null].filter(Boolean).join(' · ')
}

async function post(failTitle: string, body: Record<string, unknown>) {
  const r = await sendOrToast(failTitle, API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r) return null
  return await r.json().catch(() => ({})) as { id?: number; shipped_orders?: number[]; reverted_orders?: number[]; deleted?: boolean; warnings?: string[] }
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
  const [tab, setTabState] = useState<Tab>(tabFromUrl)
  const [composing, setComposing] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [target, setTarget] = useState<number | 'new'>('new')
  const [busy, setBusy] = useState(false)

  // Вкладка в адресе: «назад» из листа отгрузки возвращает туда же.
  function setTab(next: Tab) {
    setTabState(next)
    window.history.replaceState(null, '', `${window.location.pathname}?tab=${next}`)
  }

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
  const q = query.trim().toLowerCase()
  const allDrafts = useMemo(() => (data?.shipments ?? []).filter(s => s.status === 'draft'), [data])
  const shipmentMatches = useCallback((s: Shipment) => !q || s.lines.some(l => numberMatches(q, l.order_no, l.order_id)), [q])
  const drafts = useMemo(() => allDrafts.filter(shipmentMatches), [allDrafts, shipmentMatches])
  const history = useMemo(() => (data?.shipments ?? []).filter(s => s.status === 'shipped' && shipmentMatches(s))
    .sort((a, b) => (b.ship_date ?? '').localeCompare(a.ship_date ?? '') || b.id - a.id), [data, shipmentMatches])

  const allSent = useMemo(() => (data?.shipments ?? []).filter(s => s.status === 'shipped')
    .sort((a, b) => (b.ship_date ?? '').localeCompare(a.ship_date ?? '') || b.id - a.id), [data])
  const sentTarget = target === 'new' ? undefined : allSent.find(s => s.id === target)

  // Цифры на вкладках и списки по клику считаются одним условием inTab.
  const orders = useMemo(() => data?.orders ?? [], [data])
  const tabCount = (t: OrderTab) => orders.filter(o => inTab(o, t)).length
  const visible = useMemo(() => {
    const list = tab === 'history' ? orders
      : tab === 'shipments' ? orders.filter(o => !o.hidden && (sentTarget || o.stage !== 'shipped') && o.lines.some(l => l.free > 0))
      : orders.filter(o => inTab(o, tab))
    return oldestFirst(list.filter(o => matches(o, q)), o => o.launch_day)
  }, [orders, tab, q, sentTarget])
  const elsewhere = useMemo(() => (q ? ORDER_TABS.filter(t => t.key !== tab && orders.some(o => inTab(o, t.key) && matches(o, q))) : []), [orders, tab, q])
  const inHistory = useMemo(() => !!q && orders.some(o => matches(o, q)), [orders, q])

  // Номера нет на экране: старый заказ или другой клиент, отвечает общий поиск.
  const digits = /^\d+$/.test(q) ? stripZeros(q) : ''
  const askBase = !!data && !!digits && !inHistory

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
    if (sentTarget) {
      const ok = await confirmDialog({
        title: `Добавить в отправленную отгрузку от ${fmtDay(sentTarget.ship_date)}?`,
        text: `${summaryText(pickedTotals, !!data?.canMoney)}. Изделия сразу станут отгруженными этой датой. Заказ, у которого уедет всё, станет отгруженным, его открытые задачи цеха закроются.`,
        confirmLabel: 'Добавить',
      })
      if (!ok) return
    }
    const res = target === 'new'
      ? await post('Отгрузка не создана', { action: 'create', ship_date: newDate, lines })
      : await post('Изделия не добавлены', { action: 'add', shipment_id: target, lines })
    if (!res) return
    setSelected(new Map())
    setTarget('new')
    setComposing(false)
    setTab('shipments')
    if (sentTarget) {
      toast.success('Изделия добавлены в отправленную отгрузку', { detail: `Лежат в блоке «Отправленные». Заказов отгружено полностью: ${res.shipped_orders?.length ?? 0}.` })
      warn('Изделия добавлены, но не всё записалось', res.warnings)
      return
    }
    toast.success(target === 'new' ? 'Отгрузка собрана' : 'Изделия добавлены', { detail: 'Она ждёт в блоке «К отправке». Заказы станут отгруженными после кнопки «Отправить».' })
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
    toast.success('Отгрузка отправлена', { detail: `Лежит в блоке «Отправленные» ниже. Заказов отгружено полностью: ${res.shipped_orders?.length ?? 0}.` })
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
      text: 'Изделия снова можно будет выбрать в заказах.', confirmLabel: 'Расформировать', danger: true,
    })
    if (!ok) return
    if (await post('Отгрузка не расформирована', { action: 'delete', shipment_id: s.id })) toast.success('Отгрузка расформирована')
  })

  const setPacked = (order: PoolOrder, line: OrderLine, on: boolean) => run(async () => {
    const res = await post(on ? 'Упаковка не отмечена' : 'Упаковка не снята', { action: on ? 'pack' : 'unpack', order_id: order.id, line_key: line.key })
    if (!res) return
    toast.success(on ? `Упаковано: заказ ${order.no}` : `Упаковка снята: заказ ${order.no}`, {
      detail: on ? `${line.label}. Этапы цеха до упаковки по этой позиции тоже закрыты.` : `${line.label}. Позиция вернулась в очередь цеха.`,
    })
    warn('Записалось не всё', res.warnings)
  })

  const removeSentLine = (s: Shipment, orderId: number, key: string, label: string) => run(async () => {
    const ok = await confirmDialog({
      title: `Убрать изделие из отправленной отгрузки от ${fmtDay(s.ship_date)}?`,
      text: `${label}. Изделие снова можно будет выбрать. Если заказ был отгружен полностью, отметка снимется и задачи цеха, закрытые отгрузкой, вернутся.${s.lines.length === 1 ? ' Это последняя строка: отгрузка удалится.' : ''}`,
      confirmLabel: 'Убрать', danger: true,
    })
    if (!ok) return
    const res = await post('Строка не убрана', { action: 'remove', shipment_id: s.id, order_id: orderId, line_key: key })
    if (!res) return
    toast.success(res.deleted ? 'Строка убрана, отгрузка удалена' : 'Строка убрана из отправленной отгрузки', { detail: `Отметка снята с заказов: ${res.reverted_orders?.length ?? 0}.` })
    warn('Строка убрана, но не всё записалось', res.warnings)
  })

  const setRest = (order: PoolOrder, show: boolean) => run(async () => {
    const res = await post('Галочка не сохранилась', { action: 'rest', order_id: order.id, show })
    if (res) toast.success(show ? `Заказ ${order.no}: остаток показывается` : `Заказ ${order.no}: остаток скрыт`, { detail: 'На листе отгрузки так же.' })
  })

  const setEarlier = (s: Shipment, order: PoolOrder, lines: { line_key: string; qty: number }[]) => run(async () => {
    const res = await post('Отметка не сохранилась', { action: 'earlier', shipment_id: s.id, order_id: order.id, lines: lines.map(l => ({ ...l, order_id: order.id })) })
    if (!res) return
    const full = !!res.shipped_orders?.length
    toast.success(full ? `Заказ ${order.no} отгружен полностью` : 'Отметка сохранена', { detail: full ? `Датой этой отгрузки: ${fmtDay(s.ship_date)}.` : res.reverted_orders?.length ? 'Заказ больше не отгружен целиком, прежняя отметка возвращена.' : undefined })
    warn('Отметка сохранена, но не всё записалось', res.warnings)
  })

  const addToSent = (s: Shipment) => {
    setTarget(s.id)
    setComposing(true)
    setTab('shipments')
    window.scrollTo({ top: 0 })
  }

  const removeLine = (s: Shipment, orderId: number, key: string) => run(async () => {
    if (await post('Строка не убрана', { action: 'remove', shipment_id: s.id, order_id: orderId, line_key: key })) toast.success('Строка убрана из отгрузки')
  })

  const setDate = (s: Shipment, date: string) => run(async () => {
    if (date && await post('Дата не изменена', { action: 'set_date', shipment_id: s.id, ship_date: date })) toast.success(`Дата отгрузки: ${fmtDay(date)}`)
  })

  const canMoney = !!data?.canMoney
  const orderTab = ORDER_TABS.find(t => t.key === tab)
  const orderRows = (list: PoolOrder[]) => (
    <div className="space-y-1.5">
      {list.map(o => (
        <OrderRow key={o.id} order={o} selected={selected} canMoney={canMoney} canPack={!!data?.canPack} busy={busy} expanded={open.has(o.id)}
          onPacked={(l, on) => setPacked(o, l, on)}
          onExpand={() => setOpen(prev => { const n = new Set(prev); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n })}
          onToggle={on => toggleOrder(o, on)} onLine={(l, n) => setLine(o, l, n)} />
      ))}
    </div>
  )
  const tabCls = (t: Tab, alarm = false) => `h-10 px-3 rounded-lg border text-[13px] font-medium ${tab === t
    ? 'bg-[#111110] text-white border-[#111110]'
    : alarm ? 'bg-red-50 text-red-700 border-red-200' : 'bg-white text-[#4b4b47] border-[#e4e4e0]'}`

  return (
    <div className="min-h-screen bg-[#f5f5f3]">
      <ProductionTabs />
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-[#111110]">🚛 Отгрузка Шовер Гласс</h1>
          <p className="text-[13px] text-[#6b6b66] mt-1">Отметьте заказы или отдельные изделия, в том числе часть заказа, соберите отгрузку и отправьте её в день, когда машина уехала.</p>
        </div>

        {loadError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            Не удалось загрузить: {loadError}. <button onClick={() => void load()} className="underline font-medium">Обновить</button>
          </div>
        )}
        {!data && !loadError && <p className="text-[13px] text-[#9a9a95]">Загружаю…</p>}

        {data && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              {ORDER_TABS.map(t => {
                const n = tabCount(t.key)
                return (
                  <button key={t.key} onClick={() => { setTab(t.key); setComposing(false) }} aria-pressed={tab === t.key}
                    className={tabCls(t.key, t.key === 'overdue' && n > 0)}>{t.label} · {n}</button>
                )
              })}
              <button onClick={() => setTab('shipments')} aria-pressed={tab === 'shipments'} className={tabCls('shipments')}>Отгрузки · {data.shipments.length}</button>
              <button onClick={() => { setTab('history'); setComposing(false) }} aria-pressed={tab === 'history'} className={tabCls('history')}>История заказов · {orders.length}</button>
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Номер заказа"
                className="ml-auto h-10 w-36 rounded-lg border border-[#e4e4e0] bg-white px-2.5 text-[13px]" />
            </div>

            {orderTab && (
              <section className="space-y-2">
                {allDrafts.length > 0 && (
                  <button onClick={() => setTab('shipments')} className="w-full text-left rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[13px] text-sky-800">
                    Собрано и ждёт отправки: {allDrafts.length} отгр. Открыть →
                  </button>
                )}
                <p className="text-[12px] text-[#6b6b66]">Сверху самые старые заказы, снизу новые. {orderTab.hint}</p>
                {q && visible.length > 0 && <p className="text-[12px] text-[#6b6b66]">Найдено в этой вкладке: {visible.length}</p>}
                {visible.length === 0 && (
                  <div className="text-[13px] text-[#9a9a95] space-y-1.5">
                    <p>{q ? 'В этой вкладке такого номера нет.' : orderTab.empty}</p>
                    {elsewhere.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>Есть во вкладке:</span>
                        {elsewhere.map(t => <button key={t.key} onClick={() => setTab(t.key)} className="underline text-[#111110]">{t.label}</button>)}
                      </div>
                    )}
                    {inHistory && elsewhere.length === 0 && (
                      <button onClick={() => setTab('history')} className="underline text-[#111110]">Есть в истории заказов</button>
                    )}
                    {askBase && <OrderLookup query={digits} linkBase="/production-app/orders" />}
                  </div>
                )}
                {orderRows(visible)}
              </section>
            )}

            {tab === 'history' && (
              <section className="space-y-2">
                <p className="text-[12px] text-[#6b6b66]">Все заказы Шовер Гласс с 01.07.2026, в том числе в архиве и незапущенные просчёты. Сверху самые старые, снизу новые. Более ранний номер найдётся через поиск.</p>
                {visible.length === 0 && (
                  <div className="text-[13px] text-[#9a9a95] space-y-1.5">
                    <p>{q ? 'В истории такого номера нет.' : 'Заказов нет.'}</p>
                    {askBase && <OrderLookup query={digits} linkBase="/production-app/orders" />}
                  </div>
                )}
                {monthsOf(visible).map(([month, list]) => (
                  <div key={month} className="space-y-1.5">
                    <p className="text-[12px] text-[#6b6b66] pt-1">
                      <span className="font-semibold text-[#111110]">{MONTHS[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}</span> · {list.length} зак.
                    </p>
                    {orderRows(list)}
                  </div>
                ))}
              </section>
            )}

            {tab === 'shipments' && (
              <>
                <section className="space-y-2">
                  <button onClick={() => { if (composing) setTarget('new'); setComposing(c => !c) }} aria-expanded={composing}
                    className={`h-10 px-4 rounded-lg text-[13px] font-medium ${composing ? 'border border-[#e4e4e0] bg-white text-[#4b4b47]' : 'bg-[#111110] text-white'}`}>
                    {composing ? 'Скрыть список заказов' : '+ Новая отгрузка'}
                  </button>
                  {composing && (
                    <>
                      <p className="text-[12px] text-[#6b6b66]">
                        {sentTarget ? `Добавляем в отправленную отгрузку от ${fmtDay(sentTarget.ship_date)}. Отмеченные без этого экрана заказы тоже в списке. ` : 'Отметьте заказы или изделия: внизу появится панель с датой и итогом. '}
                        Сверху самые старые заказы, снизу новые.
                      </p>
                      {visible.length === 0 && <p className="text-[13px] text-[#9a9a95]">{q ? 'По этому номеру заказов к отгрузке нет.' : 'Заказов, которые можно отгрузить, нет.'}</p>}
                      {orderRows(visible)}
                    </>
                  )}
                </section>

                <section className="space-y-2">
                  <h2 className="text-[15px] font-semibold text-[#111110]">К отправке{drafts.length ? ` · ${drafts.length}` : ''}</h2>
                  {drafts.length === 0 && <p className="text-[13px] text-[#9a9a95]">{q ? 'С этим заказом собранных отгрузок нет.' : 'Собранных отгрузок нет.'}</p>}
                  {drafts.map(s => (
                    <DraftCard key={s.id} s={s} orderById={orderById} canMoney={canMoney} today={data.today} busy={busy}
                      onDispatch={dispatch} onRemove={remove} onRemoveLine={removeLine} onDate={setDate} onRest={setRest} />
                  ))}
                </section>

                <History shipments={history} orderById={orderById} canMoney={canMoney} busy={busy} onUndo={undo} onAdd={addToSent} onRemoveLine={removeSentLine} onRest={setRest} onEarlier={setEarlier} emptyText={q ? 'С этим заказом отправленных отгрузок нет.' : 'Отправленных отгрузок пока нет.'} />
              </>
            )}
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
              {allSent.map(d => <option key={d.id} value={d.id}>В отправленную от {fmtDay(d.ship_date)}</option>)}
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

function monthsOf(list: PoolOrder[]) {
  const m = new Map<string, PoolOrder[]>()
  for (const o of list) m.set(o.launch_day.slice(0, 7), [...(m.get(o.launch_day.slice(0, 7)) ?? []), o])
  return [...m.entries()]
}

function OrderRow({ order, selected, canMoney, canPack, busy, expanded, onPacked, onExpand, onToggle, onLine }: {
  order: PoolOrder; selected: Map<string, number>; canMoney: boolean; canPack: boolean; busy: boolean; expanded: boolean
  onPacked: (l: OrderLine, on: boolean) => void
  onExpand: () => void; onToggle: (on: boolean) => void; onLine: (l: OrderLine, qty: number) => void
}) {
  const freeLines = order.hidden ? [] : order.lines.filter(l => l.free > 0)
  const pickedCount = freeLines.filter(l => selected.has(selKey(order.id, l.key))).length
  const totalPieces = order.lines.reduce((s, l) => s + l.qty, 0)
  const shippedPieces = order.lines.reduce((s, l) => s + l.shipped, 0)
  const draftedPieces = order.lines.reduce((s, l) => s + l.drafted, 0)
  const weight = order.lines.reduce((s, l) => s + l.weight, 0)
  const amount = order.lines.reduce((s, l) => s + (l.amount ?? 0), 0)
  const isShipped = order.stage === 'shipped'
  const shippedDay = order.marked_day ? ` · ${fmtDay(order.marked_day)}` : ''
  const stateLabel = order.hidden ? `${ORDER_HIDDEN_LABEL[order.hidden]}${order.hidden === 'archived' && order.archived_day ? ` с ${fmtDay(order.archived_day)}` : ''}`
    : order.state === 'full' ? `${ORDER_STATE_LABEL.full}${shippedDay}`
    : isShipped ? `Отмечен отгруженным${shippedDay}`
    : order.state === 'partial' ? `${ORDER_STATE_LABEL.partial} · ${shippedPieces} из ${totalPieces} шт.`
    : ORDER_STATE_LABEL.none

  return (
    <div className={`rounded-lg border ${isShipped ? 'border-emerald-200' : 'border-[#e4e4e0]'} bg-white`}>
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <input type="checkbox" className="mt-1 h-4 w-4" aria-label={`Выбрать заказ ${order.no}`} disabled={freeLines.length === 0}
          checked={freeLines.length > 0 && pickedCount === freeLines.length}
          ref={el => { if (el) el.indeterminate = pickedCount > 0 && pickedCount < freeLines.length }}
          onChange={e => onToggle(e.target.checked)} />
        <button onClick={onExpand} className="flex-1 min-w-0 text-left">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[14px] font-semibold text-[#111110]">{order.no}</span>
            <span className="text-[12px] text-[#9a9a95]">запуск {fmtDay(order.launch_day)}{order.deadline_day ? ` · срок ${fmtDay(order.deadline_day)}` : ''}</span>
            <span className={`text-[11px] px-1.5 py-0.5 rounded border ${STATE_CLS[isShipped ? 'full' : order.state]}`}>{stateLabel}</span>
            {order.overdue_days > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded border border-red-200 bg-red-50 text-red-700">{overdueLabel(order.overdue_days)}</span>}
            {order.paid && <span className="text-[11px] px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700">Оплачен</span>}
            {draftedPieces > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded border border-sky-200 bg-sky-50 text-sky-700">В отгрузке {draftedPieces} шт.</span>}
          </div>
          <p className="text-[12px] text-[#6b6b66] mt-0.5">
            {order.lines.length} поз. · {pieces(totalPieces)} · {fmtKg(weight)}{canMoney ? ` · ${fmtRub(amount)}` : ''}
          </p>
          <p className="text-[12px] font-medium mt-0.5">
            {order.hidden ? <span className="text-[#6b6b66]">В работу и отгрузку не идёт</span> : order.state === 'full' ? <span className="text-emerald-700">Отгружено полностью</span> : isShipped && shippedPieces === 0 ? (
              <span className="text-emerald-700">Отгружен по отметке, по изделиям не разнесён</span>
            ) : (
              <>
                <span className={order.packed_lines === order.lines.length ? 'text-emerald-700' : 'text-[#4b4b47]'}>Упаковано позиций {order.packed_lines} из {order.lines.length}</span>
                <span className="text-[#9a9a95]"> · </span>
                <span className={shippedPieces > 0 ? 'text-amber-700' : 'text-[#4b4b47]'}>Отгружено {shippedPieces} из {totalPieces} шт.</span>
              </>
            )}
          </p>
        </button>
        <span className="text-[#9a9a95] text-[12px] mt-1" aria-hidden>{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div className="border-t border-[#f0f0ec] divide-y divide-[#f4f4f0]">
          <div className="px-3 py-1.5">
            <Link href={`/production-app/orders/${order.id}`} className="text-[12px] text-[#6b6b66] underline">Открыть карточку заказа</Link>
          </div>
          {order.lines.map(l => {
            const qty = selected.get(selKey(order.id, l.key)) ?? 0
            return (
              <div key={l.key} className="flex items-start gap-2.5 px-3 py-2">
                <input type="checkbox" className="mt-1 h-4 w-4" aria-label={`Выбрать ${l.label}`} disabled={l.free === 0 || !!order.hidden} checked={qty > 0}
                  onChange={e => onLine(l, e.target.checked ? l.free : 0)} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-[#111110]">{l.label}{l.size ? `, ${l.size} мм` : ''}</p>
                  <p className="text-[12px] text-[#6b6b66]">
                    {pieces(l.qty)} · {fmtKg(l.weight)}{canMoney ? ` · ${fmtRub(l.amount ?? 0)}` : ''}
                    {l.drafted > 0 ? ` · в отгрузке ${l.drafted}` : ''}
                  </p>
                  {!order.hidden && <p className="text-[12px] font-medium mt-0.5">
                    {l.shipped >= l.qty ? <span className="text-emerald-700">Отгружено</span> : (
                      <>
                        {l.packed ? <span className="text-emerald-700">Упаковано</span> : <span className="text-amber-700">Не упаковано</span>}
                        {l.shipped > 0 && <span className="text-amber-700"> · отгружено {l.shipped} из {l.qty}</span>}
                      </>
                    )}
                  </p>}
                </div>
                {canPack && !isShipped && !order.hidden && l.shipped < l.qty && (
                  l.packed
                    ? l.shipped + l.drafted === 0 && (
                        <button disabled={busy} onClick={() => onPacked(l, false)} className="h-8 px-2 text-[12px] text-[#6b6b66] underline disabled:opacity-50">Снять упаковку</button>
                      )
                    : <button disabled={busy} onClick={() => onPacked(l, true)} className="h-8 px-2.5 shrink-0 rounded-lg border border-[#111110] text-[12px] font-medium text-[#111110] disabled:opacity-50">Упаковано</button>
                )}
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

// Две отметки у заказа в отгрузке: что уехало этой отгрузкой и что осталось по заказу.
function viewOf(order: PoolOrder | undefined, s: Shipment) {
  if (!order) return null
  return orderInShipment(order.lines, key => s.lines.filter(l => l.order_id === order.id && l.key === key).reduce((n, l) => n + l.qty, 0), s.status === 'shipped')
}

function OrderInShipment({ order, s, no, busy, onRest, editing, onEarlier }: {
  order: PoolOrder | undefined; s: Shipment; no: string; busy: boolean; onRest: (o: PoolOrder, show: boolean) => void
  editing?: boolean; onEarlier?: (s: Shipment, o: PoolOrder, lines: { line_key: string; qty: number }[]) => void
}) {
  const v = viewOf(order, s)
  const sent = s.status === 'shipped'
  const restOff = !!order?.rest_off
  const text = v ? orderInShipmentText(v, sent, restOff) : null
  const hereOf = (key: string) => s.lines.filter(l => l.order_id === order?.id && l.key === key).reduce((n, l) => n + l.qty, 0)
  // Что можно отметить уехавшим раньше: всё, что не уехало этой и другими отгрузками.
  const room = (l: OrderLine) => Math.max(0, l.qty - (l.shipped - l.earlier) - l.drafted)
  const candidates = order?.lines.filter(l => room(l) > 0 && !(hereOf(l.key) >= l.qty)) ?? []
  const label = (l: OrderLine) => (l.size ? `${l.label}, ${l.size} мм` : l.label)
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[13px] font-semibold text-[#111110]">{no}</span>
        {v && text && <span className={`text-[11px] px-1.5 py-0.5 rounded border ${STATE_CLS[v.wholeHere ? 'full' : 'none']}`}>{text.here}</span>}
        {text?.earlier && <span className={`text-[11px] px-1.5 py-0.5 rounded border ${STATE_CLS.none}`}>{text.earlier}</span>}
        {v && text?.after && <span className={`text-[11px] px-1.5 py-0.5 rounded border ${STATE_CLS[v.remaining === 0 ? 'full' : 'partial']}`}>{text.after}</span>}
      </div>
      {order && v && !v.wholeHere && (
        <label className="flex items-center gap-1.5 text-[12px] text-[#4b4b47] mt-1 w-fit">
          <input type="checkbox" disabled={busy} checked={!restOff} onChange={e => onRest(order, e.target.checked)} className="w-4 h-4" />
          Показывать, сколько отгружено и сколько осталось
        </label>
      )}
      {v && !restOff && !editing && v.rest.length > 0 && (
        <p className="text-[12px] text-amber-700 mt-0.5">Осталось отгрузить: {v.rest.map(r => `${r.label} — ${r.left} шт.`).join('; ')}</p>
      )}
      {editing && order && onEarlier && candidates.length > 0 && (
        <div className="rounded-lg bg-[#f5f5f3] p-2 mt-1 space-y-1">
          <p className="text-[12px] font-medium text-[#111110]">Уехало раньше, до этой отгрузки:</p>
          {candidates.map(l => (
            <label key={l.key} className="flex items-center gap-1.5 text-[12px] text-[#4b4b47]">
              {room(l) === 1
                ? <input type="checkbox" disabled={busy} checked={l.earlier > 0} onChange={e => onEarlier(s, order, [{ line_key: l.key, qty: e.target.checked ? 1 : 0 }])} className="w-4 h-4 shrink-0" />
                : (
                  <select disabled={busy} value={l.earlier} aria-label="Сколько штук уехало раньше" onChange={e => onEarlier(s, order, [{ line_key: l.key, qty: Number(e.target.value) }])} className="h-7 px-1 rounded border border-[#e4e4e0] bg-white">
                    {Array.from({ length: room(l) + 1 }, (_, n) => <option key={n} value={n}>{n} шт.</option>)}
                  </select>
                )}
              {label(l)}, {l.qty} шт.
            </label>
          ))}
          {candidates.some(l => l.earlier < room(l)) && (
            <button disabled={busy} onClick={() => onEarlier(s, order, candidates.map(l => ({ line_key: l.key, qty: room(l) })))} className="h-8 px-2 rounded-lg border border-[#e4e4e0] bg-white text-[12px] text-[#111110]">Отметить всё остальное</button>
          )}
        </div>
      )}
    </>
  )
}

function groupByOrder(s: Shipment) {
  const m = new Map<number, Shipment['lines']>()
  for (const l of s.lines) m.set(l.order_id, [...(m.get(l.order_id) ?? []), l])
  return [...m.entries()]
}

function DraftCard({ s, orderById, canMoney, today, busy, onDispatch, onRemove, onRemoveLine, onDate, onRest }: {
  onRest: (o: PoolOrder, show: boolean) => void
  s: Shipment; orderById: Map<number, PoolOrder>; canMoney: boolean; today: string; busy: boolean
  onDispatch: (s: Shipment, fullOrders: string[]) => void; onRemove: (s: Shipment) => void
  onRemoveLine: (s: Shipment, orderId: number, key: string) => void; onDate: (s: Shipment, date: string) => void
}) {
  const groups = groupByOrder(s)
  const future = !!s.ship_date && s.ship_date > today
  const fullOrders = groups.filter(([id]) => viewOf(orderById.get(id), s)?.remaining === 0).map(([, ls]) => ls[0].order_no)
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
          return (
            <div key={orderId} className="py-2">
              <OrderInShipment order={orderById.get(orderId)} s={s} no={lines[0].order_no} busy={busy} onRest={onRest} />
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

function History({ shipments, orderById, canMoney, busy, onUndo, onAdd, onRemoveLine, onRest, onEarlier, emptyText }: {
  onRest: (o: PoolOrder, show: boolean) => void; onEarlier: (s: Shipment, o: PoolOrder, lines: { line_key: string; qty: number }[]) => void
  shipments: Shipment[]; orderById: Map<number, PoolOrder>; canMoney: boolean; busy: boolean; onUndo: (s: Shipment) => void
  onAdd: (s: Shipment) => void; onRemoveLine: (s: Shipment, orderId: number, key: string, label: string) => void; emptyText: string
}) {
  const [openId, setOpenId] = useState<number | null>(null)
  const [editId, setEditId] = useState<number | null>(null)
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
      <h2 className="text-[15px] font-semibold text-[#111110]">Отправленные · {shipments.length}</h2>
      {shipments.length === 0 && <p className="text-[13px] text-[#9a9a95]">{emptyText}</p>}
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
                {(() => {
                  const groups = groupByOrder(s).map(([id]) => orderById.get(id))
                  const hidden = groups.filter(o => o?.rest_off).length
                  const debt = groups.reduce((n, o) => n + (o?.rest_off ? 0 : viewOf(o, s)?.remaining ?? 0), 0)
                  const tail = hidden > 0 ? ` · остаток скрыт: ${hidden} зак.` : ''
                  return <span className={`text-[12px] font-medium ${debt > 0 ? 'text-amber-700' : hidden > 0 ? 'text-[#6b6b66]' : 'text-emerald-700'}`}>
                    {debt > 0 ? `Осталось отгрузить по заказам: ${debt} шт.${tail}` : hidden > 0 ? `Остаток скрыт: ${hidden} зак.` : 'По заказам всё отгружено'}
                  </span>
                })()}
              </button>
              {openId === s.id && (
                <div className="border-t border-[#f0f0ec] px-3 py-2 space-y-2">
                  {groupByOrder(s).map(([orderId, lines]) => {
                    return (
                      <div key={orderId}>
                        <OrderInShipment order={orderById.get(orderId)} s={s} no={lines[0].order_no} busy={busy} onRest={onRest} editing={editId === s.id} onEarlier={onEarlier} />
                        {lines.map(l => (
                          <div key={l.key} className="flex items-start gap-2 text-[12px] text-[#6b6b66] mt-0.5">
                            <p className="flex-1 min-w-0">{l.label} · {l.qty} из {l.lineQty} шт. · {fmtKg(l.weight)}{canMoney ? ` · ${fmtRub(l.amount)}` : ''}</p>
                            {editId === s.id && (
                              <button disabled={busy} onClick={() => onRemoveLine(s, l.order_id, l.key, l.label)} aria-label="Убрать изделие из отгрузки" className="px-1.5 text-[#9a9a95] hover:text-red-500">✕</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )
                  })}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button onClick={() => setEditId(editId === s.id ? null : s.id)} aria-pressed={editId === s.id}
                      className={`h-9 px-3 rounded-lg border text-[13px] ${editId === s.id ? 'border-[#111110] bg-[#111110] text-white' : 'border-[#e4e4e0] text-[#111110]'}`}>
                      {editId === s.id ? 'Закончить правку' : 'Редактировать'}
                    </button>
                    {editId === s.id && <button disabled={busy} onClick={() => onAdd(s)} className="h-9 px-3 rounded-lg border border-[#e4e4e0] text-[13px] text-[#111110]">+ Добавить изделия</button>}
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
