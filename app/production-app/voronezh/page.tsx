'use client'

// Доставка в Воронеж: клиенты направления (b2b_clients.crm_city='Воронеж'),
// пул их неотгруженных заказов с весом и суммой, формирование партии (рейса)
// с итогами по клиентам. Вес: Σ item.totalWeight (фолбэк 2.5 кг/м²·мм стекла).

import { useEffect, useMemo, useState } from 'react'
import ProductionTabs from '@/components/ProductionTabs'
import { createClient } from '@/lib/supabase-browser'
import { itemsWeight } from '@/lib/deliveryWeight'

const REGION = 'voronezh'
const CITY = 'Воронеж'

type Client = { id: number; name: string; crm_city: string | null; active: boolean }
type OrderItem = { totalWeight?: number; areaPiece?: number; quantity?: number; thickness?: number }
type NotesData = { status?: string; stages?: Record<string, unknown>; deadline_date?: string; launched_at?: string; production_days?: number }
type Readiness = { label: string; cls: string }
type Order = {
  id: number
  custom_number: string | null
  client_id: number | null
  client_name: string | null
  items: OrderItem[] | null
  notes: string | null
  total_after_discount: number | null
  total_sale_inc_vat: number | null
  created_at: string
  parsed: NotesData
  ready: Readiness
}
type Shipment = {
  id: number
  title: string | null
  ship_date: string | null
  status: 'draft' | 'shipped'
  total_weight_kg: number | null
  total_amount: number | null
  max_weight_kg: number | null
  shipped_at: string | null
  created_at: string
  orderIds: number[]
}

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU')
const KG = (n: number) => (Math.round(n * 10) / 10).toLocaleString('ru-RU')
const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
// Текущий год/месяц для дефолтного раскрытия истории (модульный уровень — не в рендере)
const NOW_YEAR = new Date().getFullYear().toString()
const NOW_MONTH_KEY = new Date().toISOString().slice(0, 7)
const orderNo = (o: { custom_number: string | null; id: number }) => o.custom_number?.trim() || `00${o.id}`
const orderSum = (o: Order) => o.total_after_discount ?? o.total_sale_inc_vat ?? 0

const orderWeight = (o: Order) => itemsWeight(o.items)
const orderPieces = (o: Order) => (o.items ?? []).reduce((s, it) => s + Math.max(1, Number(it.quantity ?? 1)), 0)

function parseNotes(raw: string | null): NotesData {
  try { return raw ? JSON.parse(raw) : {} } catch { return {} }
}

function ShipmentCard({ s, orders, clientNames, onShipped, onDelete, onRemove, onLimit }: {
  s: Shipment
  orders: Order[]
  clientNames: Map<number, string>
  onShipped: (s: Shipment) => void
  onDelete: (s: Shipment) => void
  onRemove: (shipmentId: number, orderId: number) => void
  onLimit: (shipmentId: number, kg: number | null) => void
}) {
  const os = orders.filter(o => s.orderIds.includes(o.id))
  const weight = s.status === 'shipped' && s.total_weight_kg != null ? s.total_weight_kg : os.reduce((sum, o) => sum + orderWeight(o), 0)
  const amount = s.status === 'shipped' && s.total_amount != null ? s.total_amount : os.reduce((sum, o) => sum + orderSum(o), 0)
  const pieces = os.reduce((sum, o) => sum + orderPieces(o), 0)
  // Разбивка по заказчикам: группируем по привязке (client_id), не по имени в
  // заказе — у объединённых клиентов (MR GLASS = ВРНГЛАЗИЕРС/МОНАРХ/ЛЮДИ)
  // исторические юр-имена в заказах сохранены, но заказчик один
  const byClient = new Map<string, Order[]>()
  for (const o of os) {
    const name = (o.client_id != null ? clientNames.get(o.client_id) : null) ?? o.client_name ?? '—'
    byClient.set(name, [...(byClient.get(name) ?? []), o])
  }
  // Загрузка машины: <90% зелёная, 90–100% жёлтая, сверх лимита — красная с перегрузом
  const limit = s.max_weight_kg ?? null
  const loadPct = limit ? weight / limit * 100 : null
  const loadTone = loadPct == null ? '' : loadPct > 100 ? 'bg-red-500' : loadPct >= 90 ? 'bg-amber-400' : 'bg-emerald-500'
  return (
    <div className="border border-[#e4e4e0] rounded-lg bg-white p-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div>
          <span className="font-medium text-[#111110]">{s.title ?? `Партия ${s.id}`}</span>
          {s.shipped_at && <span className="ml-2 text-[13px] text-emerald-700">отправлена {new Date(s.shipped_at).toLocaleDateString('ru-RU')}</span>}
        </div>
        <div className="flex items-center gap-x-3 gap-y-1.5 text-[13px] flex-wrap">
          <span className="font-mono font-medium">{os.length} зак. · {pieces} изд. · {KG(weight)} кг · {RUB(amount)} ₽</span>
          <a href={`/production-app/voronezh/${s.id}/print`} target="_blank" rel="noreferrer"
            className="px-3 py-1.5 rounded-md border border-[#e4e4e0] text-[12px] text-[#4b4b47] hover:border-[#111110] hover:text-[#111110]">🖨 Лист рейса</a>
          {s.status === 'draft' && (
            <>
              <button onClick={() => onShipped(s)} className="px-3 py-1.5 rounded-md bg-[#111110] text-white text-[12px] hover:opacity-85">✓ Отправлена</button>
              <button onClick={() => onDelete(s)} className="px-3 py-1.5 rounded-md border border-[#e4e4e0] text-[12px] text-[#9a9a95] hover:text-red-600 hover:border-red-200">Расформировать</button>
            </>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {s.status === 'draft' && (
          <label className="flex items-center gap-1.5 text-[12px] text-[#9a9a95]">
            Лимит машины, кг:
            <input type="number" defaultValue={limit ?? ''} placeholder="—" min={0}
              onBlur={e => { const v = e.target.value.trim(); onLimit(s.id, v === '' ? null : Number(v)) }}
              className="w-20 border border-[#e4e4e0] rounded-md px-2 py-1 text-[12px] font-mono bg-white" />
          </label>
        )}
        {limit != null && loadPct != null && (
          <div className="flex items-center gap-2 flex-1 min-w-[220px]">
            <div className="flex-1 h-2 rounded-full bg-[#f0f0ee] overflow-hidden">
              <div className={`h-full rounded-full ${loadTone}`} style={{ width: `${Math.min(loadPct, 100)}%` }} />
            </div>
            <span className={`text-[12px] font-mono ${loadPct > 100 ? 'text-red-600 font-semibold' : loadPct >= 90 ? 'text-amber-600' : 'text-[#9a9a95]'}`}>
              {loadPct > 100 ? `Перегруз +${KG(weight - limit)} кг` : `${Math.round(loadPct)}% из ${KG(limit)} кг`}
            </span>
          </div>
        )}
      </div>
      {os.length === 0 && (
        <div className="mt-2 text-[13px] text-[#9a9a95]">Рейс пустой — отметьте заказы ниже и добавьте их сюда.</div>
      )}
      <div className="mt-2 space-y-3">
        {[...byClient.entries()].map(([name, cos]) => {
          const cw = cos.reduce((sum, o) => sum + orderWeight(o), 0)
          const ca = cos.reduce((sum, o) => sum + orderSum(o), 0)
          const cp = cos.reduce((sum, o) => sum + orderPieces(o), 0)
          return (
            <div key={name}>
              <div className="flex items-center gap-2 text-[13px]">
                <span className="font-medium text-[#111110]">{name}</span>
                <span className="text-[#9a9a95] font-mono">{cos.length} зак. · <span className="text-[#111110] font-semibold">{cp} изд.</span> · {KG(cw)} кг · {RUB(ca)} ₽</span>
              </div>
              <div className="mt-1 space-y-0.5">
                {cos.map(o => (
                  <div key={o.id} className="flex items-center gap-2 text-[13px] text-[#4b4b47] pl-3">
                    <span className="font-mono">{orderNo(o)}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${o.ready.cls}`}>{o.ready.label}</span>
                    <span className="text-[#9a9a95] ml-auto font-mono">{orderPieces(o)} изд. · {KG(orderWeight(o))} кг · {RUB(orderSum(o))} ₽</span>
                    {s.status === 'draft' && (
                      <button onClick={() => onRemove(s.id, o.id)} className="text-[#9a9a95] hover:text-red-600 px-1" title="Убрать из рейса">✕</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Готовность как в /b2b-orders: упакован → готов к отгрузке; иначе по сроку.
// Считается в load() (не в рендере — правило purity), nowMs фиксируется там же.
function readinessOf(parsed: NotesData, nowMs: number): Readiness {
  const stages = parsed.stages ?? {}
  if (stages.shipped) return { label: 'Отгружен (цех)', cls: 'bg-purple-50 text-purple-700 border-purple-200' }
  if (stages.packaged) return { label: 'Готов / упакован', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
  const deadline = parsed.deadline_date
    ? new Date(parsed.deadline_date)
    : parsed.launched_at
      ? new Date(new Date(parsed.launched_at).getTime() + (parsed.production_days ?? 7) * 86400000)
      : null
  if (!deadline) return { label: 'В работе', cls: 'bg-[#f5f5f3] text-[#4b4b47] border-[#e4e4e0]' }
  const days = Math.round((new Date(deadline).setHours(0, 0, 0, 0) - new Date(nowMs).setHours(0, 0, 0, 0)) / 86400000)
  if (days < 0) return { label: `Просрочен ${Math.abs(days)} дн.`, cls: 'bg-red-50 text-red-600 border-red-200' }
  if (days <= 1) return { label: days === 0 ? 'Срок сегодня' : 'Срок завтра', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
  return { label: `Готов ~${deadline.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}`, cls: 'bg-[#f5f5f3] text-[#4b4b47] border-[#e4e4e0]' }
}

export default function VoronezhPage() {
  const [loading, setLoading] = useState(true)
  const [clients, setClients] = useState<Client[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)
  const [addingClient, setAddingClient] = useState(false)
  // История: ключ в toggled инвертирует дефолт раскрытия (текущий год/месяц открыты)
  const [toggled, setToggled] = useState<Set<string>>(new Set())
  const [err, setErr] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [newTripDate, setNewTripDate] = useState('')
  // Целевой рейс: отмеченные заказы добавляются в него
  const [targetShip, setTargetShip] = useState<number | null>(null)
  // Июньские заказы отмечены в цехе отгруженными, но владелец хочет видеть их
  // в пуле (реальный вывоз в Воронеж мог не состояться) — тумблер, потом уберём
  const [showJune, setShowJune] = useState(true)

  async function load() {
    const sb = createClient()
    setErr(null)
    const [cl, ord, sh, shOrd] = await Promise.all([
      sb.from('b2b_clients').select('id, name, crm_city, active').order('name'),
      sb.from('b2b_orders')
        .select('id, custom_number, client_id, client_name, items, notes, total_after_discount, total_sale_inc_vat, created_at')
        .is('archived_at', null)
        .not('notes', 'ilike', '%"status":"quote"%')
        .not('notes', 'ilike', '%"historical":true%')
        .order('id', { ascending: false }),
      sb.from('delivery_shipments').select('*').eq('region', REGION).order('id', { ascending: false }),
      sb.from('delivery_shipment_orders').select('shipment_id, order_id'),
    ])
    if (cl.error || ord.error) {
      setErr(cl.error?.message ?? ord.error?.message ?? 'Ошибка загрузки')
      setLoading(false)
      return
    }
    // Таблицы партий могут ещё не существовать (миграция не применена) —
    // клиенты и пул заказов работают, формирование партий деградирует с подсказкой
    if (sh.error) setErr(`Партии недоступны: ${sh.error.message}`)
    setClients((cl.data ?? []) as Client[])
    const nowMs = Date.now()
    const links = (shOrd.data ?? []) as { shipment_id: number; order_id: number }[]
    // Заказы, уже добавленные в рейсы, докачиваем БЕЗ фильтров пула — в рейсе
    // может лежать и просчёт, и заказ из архива, карточка обязана их показать
    const rawOrders = (ord.data ?? []) as Omit<Order, 'parsed' | 'ready'>[]
    const haveIds = new Set(rawOrders.map(o => o.id))
    const missingIds = [...new Set(links.map(l => l.order_id))].filter(oid => !haveIds.has(oid))
    if (missingIds.length > 0) {
      const { data: extra } = await sb.from('b2b_orders')
        .select('id, custom_number, client_id, client_name, items, notes, total_after_discount, total_sale_inc_vat, created_at')
        .in('id', missingIds)
      rawOrders.push(...((extra ?? []) as Omit<Order, 'parsed' | 'ready'>[]))
    }
    setOrders(rawOrders.map(o => {
      const parsed = parseNotes(o.notes)
      return { ...o, parsed, ready: readinessOf(parsed, nowMs) }
    }))
    setShipments(((sh.data ?? []) as Omit<Shipment, 'orderIds'>[]).map(s => ({
      ...s,
      orderIds: links.filter(l => l.shipment_id === s.id).map(l => l.order_id),
    })))
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [])

  const vClients = useMemo(() => clients.filter(c => c.crm_city === CITY), [clients])
  const otherClients = useMemo(() => clients.filter(c => c.crm_city !== CITY && c.active), [clients])

  // Заказы, уже лежащие в какой-либо партии (черновик или отправленной), из пула убираем
  const inShipment = useMemo(() => new Set(shipments.flatMap(s => s.orderIds)), [shipments])

  const pool = useMemo(() => {
    const ids = new Set(vClients.map(c => c.id))
    return orders.filter(o => {
      if (o.client_id == null || !ids.has(o.client_id) || inShipment.has(o.id)) return false
      const shipped = Boolean((o.parsed.stages ?? {})['shipped'])
      // Июньские «отгруженные в цехе» показываем по тумблеру — вывоз мог не состояться
      const isJune = o.created_at >= '2026-06-01' && o.created_at < '2026-07-01'
      return !shipped || (showJune && isJune)
    })
  }, [orders, vClients, inShipment, showJune])

  // Поиск по номеру заказа (свой номер или 00id) и имени клиента
  const q = search.trim().toLowerCase()
  const filteredPool = q
    ? pool.filter(o => orderNo(o).toLowerCase().includes(q) || (o.client_name ?? '').toLowerCase().includes(q))
    : pool

  const poolByClient = new Map<number, Order[]>()
  for (const o of filteredPool) {
    const arr = poolByClient.get(o.client_id!) ?? []
    arr.push(o)
    poolByClient.set(o.client_id!, arr)
  }

  const pickedOrders = pool.filter(o => picked.has(o.id))
  const pickedWeight = pickedOrders.reduce((s, o) => s + orderWeight(o), 0)
  const pickedAmount = pickedOrders.reduce((s, o) => s + orderSum(o), 0)
  const pickedPieces = pickedOrders.reduce((s, o) => s + orderPieces(o), 0)
  const pickedByClient = new Map<string, { count: number; weight: number; amount: number; pieces: number }>()
  for (const o of pickedOrders) {
    const name = o.client_name ?? '—'
    const cur = pickedByClient.get(name) ?? { count: 0, weight: 0, amount: 0, pieces: 0 }
    pickedByClient.set(name, { count: cur.count + 1, weight: cur.weight + orderWeight(o), amount: cur.amount + orderSum(o), pieces: cur.pieces + orderPieces(o) })
  }

  async function setClientCity(id: number, toVoronezh: boolean) {
    const sb = createClient()
    const { error } = await sb.from('b2b_clients').update({ crm_city: toVoronezh ? CITY : null }).eq('id', id)
    if (error) { setErr(error.message); return }
    setClients(prev => prev.map(c => c.id === id ? { ...c, crm_city: toVoronezh ? CITY : null } : c))
  }

  function togglePick(id: number) {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Рейс создаётся заранее «к числу», заказы добираются в него по мере готовности
  async function createTrip() {
    if (!newTripDate) return
    setSaving(true)
    const sb = createClient()
    const title = `Воронеж к ${new Date(newTripDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
    const { data: ship, error } = await sb.from('delivery_shipments')
      .insert({ region: REGION, title, ship_date: newTripDate })
      .select('id')
      .single()
    setSaving(false)
    if (error || !ship) { setErr(error?.message ?? 'Не удалось создать рейс'); return }
    setNewTripDate('')
    setTargetShip(ship.id)
    load()
  }

  async function addPickedToTrip(shipmentId: number) {
    if (pickedOrders.length === 0) return
    setSaving(true)
    const sb = createClient()
    const { error } = await sb.from('delivery_shipment_orders')
      .insert(pickedOrders.map(o => ({ shipment_id: shipmentId, order_id: o.id })))
    setSaving(false)
    if (error) { setErr(error.message); return }
    setPicked(new Set())
    load()
  }

  async function setLimit(shipmentId: number, kg: number | null) {
    const sb = createClient()
    const { error } = await sb.from('delivery_shipments').update({ max_weight_kg: kg }).eq('id', shipmentId)
    if (error) { setErr(error.message); return }
    setShipments(prev => prev.map(s => s.id === shipmentId ? { ...s, max_weight_kg: kg } : s))
  }

  async function removeFromShipment(shipmentId: number, orderId: number) {
    const sb = createClient()
    await sb.from('delivery_shipment_orders').delete().eq('shipment_id', shipmentId).eq('order_id', orderId)
    load()
  }

  async function deleteShipment(s: Shipment) {
    if (!confirm(`Расформировать партию «${s.title ?? s.id}»? Заказы вернутся в пул.`)) return
    const sb = createClient()
    await sb.from('delivery_shipments').delete().eq('id', s.id)
    load()
  }

  async function markShipped(s: Shipment) {
    if (!confirm(`Отметить партию «${s.title ?? s.id}» отправленной?`)) return
    const sb = createClient()
    const os = orders.filter(o => s.orderIds.includes(o.id))
    const weight = os.reduce((sum, o) => sum + orderWeight(o), 0)
    const amount = os.reduce((sum, o) => sum + orderSum(o), 0)
    await sb.from('delivery_shipments')
      .update({ status: 'shipped', shipped_at: new Date().toISOString(), total_weight_kg: Math.round(weight * 10) / 10, total_amount: Math.round(amount) })
      .eq('id', s.id)
    load()
  }

  const drafts = shipments.filter(s => s.status === 'draft')
  const done = shipments.filter(s => s.status === 'shipped')
  // Куда добавлять отмеченные заказы: выбранный черновик, иначе первый по дате отправки
  const effectiveTarget = targetShip != null && drafts.some(d => d.id === targetShip)
    ? targetShip
    : (drafts[0]?.id ?? null)

  // История доставок: год → месяц (новые сверху); дата рейса = отправка || план || создание
  const tripDate = (s: Shipment) => (s.shipped_at ?? s.ship_date ?? s.created_at).slice(0, 10)
  const byMonth = new Map<string, Shipment[]>()
  for (const s of [...done].sort((a, b) => tripDate(b).localeCompare(tripDate(a)))) {
    const mKey = tripDate(s).slice(0, 7)
    byMonth.set(mKey, [...(byMonth.get(mKey) ?? []), s])
  }
  const byYear = new Map<string, [string, Shipment[]][]>()
  for (const [mKey, trips] of byMonth) {
    const y = mKey.slice(0, 4)
    byYear.set(y, [...(byYear.get(y) ?? []), [mKey, trips]])
  }
  const historyYears = [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  const currentYear = NOW_YEAR
  const currentMonthKey = NOW_MONTH_KEY
  const isOpen = (key: string, def: boolean) => toggled.has(key) ? !def : def
  const clientNames = new Map(clients.map(c => [c.id, c.name]))
  const toggleGroup = (key: string) => setToggled(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  return (
    <div className="min-h-screen bg-[#f5f5f3]">
      <ProductionTabs />
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-[#111110]">🚚 Доставка в Воронеж</h1>
          <p className="text-[13px] text-[#9a9a95] mt-1">Заказы клиентов Воронежа: что готовить к отгрузке и что едет в ближайшую машину. Вес расчётный, по стеклу.</p>
        </div>

        {err && <div className="border border-red-200 bg-red-50 text-red-700 text-[13px] rounded-lg px-4 py-3">{err}</div>}
        {loading && <div className="text-[#9a9a95] text-[14px]">Загрузка…</div>}

        {!loading && (
          <>
            {/* Клиенты направления */}
            <div className="border border-[#e4e4e0] rounded-lg bg-white p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[13px] uppercase tracking-wide text-[#9a9a95]">Клиенты Воронежа</h2>
                <button onClick={() => setAddingClient(v => !v)} className="text-[13px] text-[#111110] underline underline-offset-2">
                  {addingClient ? 'Скрыть' : '+ Добавить клиента'}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {vClients.length === 0 && <span className="text-[13px] text-[#9a9a95]">Пока никто не отмечен — добавьте клиентов, которых возим в Воронеж.</span>}
                {vClients.map(c => (
                  <span key={c.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#f5f5f3] border border-[#e4e4e0] text-[13px] text-[#111110]">
                    {c.name}
                    <button onClick={() => setClientCity(c.id, false)} className="text-[#9a9a95] hover:text-red-600" title="Убрать из Воронежа">✕</button>
                  </span>
                ))}
              </div>
              {addingClient && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[#e4e4e0] pt-3">
                  {otherClients.map(c => (
                    <button key={c.id} onClick={() => setClientCity(c.id, true)}
                      className="px-2.5 py-1 rounded-full border border-[#e4e4e0] text-[12px] text-[#4b4b47] hover:border-[#111110] hover:text-[#111110]">
                      + {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Панель отмеченных заказов: добавление в рейс */}
            {picked.size > 0 && (
              <div className="border-2 border-[#111110] rounded-lg bg-white p-4 sticky top-2 z-10 shadow-sm">
                <div className="flex flex-wrap items-center gap-3 justify-between">
                  <div className="text-[14px] font-medium text-[#111110]">
                    Отмечено: {pickedOrders.length} зак. · <span className="font-mono">{pickedPieces} изд.</span> · <span className="font-mono">{KG(pickedWeight)} кг</span> · <span className="font-mono">{RUB(pickedAmount)} ₽</span>
                  </div>
                  {effectiveTarget != null ? (
                    <div className="flex items-center gap-2">
                      {drafts.length > 1 && (
                        <select value={effectiveTarget} onChange={e => setTargetShip(Number(e.target.value))}
                          className="border border-[#e4e4e0] rounded-md px-2 py-1.5 text-[13px] bg-white">
                          {drafts.map(d => <option key={d.id} value={d.id}>{d.title ?? `Рейс ${d.id}`}</option>)}
                        </select>
                      )}
                      <button onClick={() => addPickedToTrip(effectiveTarget)} disabled={saving}
                        className="px-4 py-2 rounded-md bg-[#111110] text-white text-[13px] hover:opacity-85 disabled:opacity-50">
                        {saving ? 'Сохраняю…' : `＋ В рейс${drafts.length === 1 ? ` «${drafts[0].title}»` : ''}`}
                      </button>
                    </div>
                  ) : (
                    <span className="text-[13px] text-[#9a9a95]">Сначала создайте рейс к дате ↓</span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[#4b4b47]">
                  {[...pickedByClient.entries()].map(([name, v]) => (
                    <span key={name}>{name}: {v.count} зак. · {v.pieces} изд. · {KG(v.weight)} кг · {RUB(v.amount)} ₽</span>
                  ))}
                </div>
              </div>
            )}

            {/* Рейсы: создаются к дате, заказы добираются по мере готовности */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 justify-between">
                <h2 className="text-[13px] uppercase tracking-wide text-[#9a9a95]">Рейсы в Воронеж</h2>
                <div className="flex items-center gap-2">
                  <input type="date" value={newTripDate} onChange={e => setNewTripDate(e.target.value)}
                    className="border border-[#e4e4e0] rounded-md px-2 py-1.5 text-[13px] bg-white" />
                  <button onClick={createTrip} disabled={saving || !newTripDate}
                    className="px-3 py-2 rounded-md border border-[#111110] text-[13px] text-[#111110] hover:bg-[#111110] hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#111110]">
                    ＋ Рейс к дате
                  </button>
                </div>
              </div>
              {drafts.length === 0 && (
                <div className="text-[13px] text-[#9a9a95] border border-dashed border-[#e4e4e0] rounded-lg bg-white p-4">
                  Выберите дату и создайте рейс — затем отмечайте заказы ниже и добавляйте их в него.
                </div>
              )}
              {drafts.map(s => <ShipmentCard key={s.id} s={s} orders={orders} clientNames={clientNames} onShipped={markShipped} onDelete={deleteShipment} onRemove={removeFromShipment} onLimit={setLimit} />)}
            </div>

            {/* Пул заказов по клиентам */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 justify-between">
                <h2 className="text-[13px] uppercase tracking-wide text-[#9a9a95]">Заказы к отправке — {filteredPool.length}{q ? ` из ${pool.length}` : ''} шт · {KG(filteredPool.reduce((s, o) => s + orderWeight(o), 0))} кг</h2>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[12px] text-[#4b4b47] cursor-pointer">
                    <input type="checkbox" checked={showJune} onChange={e => setShowJune(e.target.checked)} className="w-3.5 h-3.5 accent-[#111110]" />
                    Июньские
                  </label>
                  <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск: номер заказа или клиент"
                    className="border border-[#e4e4e0] rounded-md px-3 py-1.5 text-[13px] bg-white w-64" />
                </div>
              </div>
              {vClients.length > 0 && pool.length === 0 && (
                <div className="text-[13px] text-[#9a9a95] border border-[#e4e4e0] rounded-lg bg-white p-4">Активных заказов у клиентов Воронежа нет.</div>
              )}
              {pool.length > 0 && filteredPool.length === 0 && (
                <div className="text-[13px] text-[#9a9a95] border border-[#e4e4e0] rounded-lg bg-white p-4">По запросу «{search}» ничего не найдено.</div>
              )}
              {[...poolByClient.entries()].map(([clientId, os]) => {
                const client = vClients.find(c => c.id === clientId)
                const w = os.reduce((s, o) => s + orderWeight(o), 0)
                const a = os.reduce((s, o) => s + orderSum(o), 0)
                return (
                  <div key={clientId} className="border border-[#e4e4e0] rounded-lg bg-white">
                    <div className="px-4 py-2.5 border-b border-[#e4e4e0] flex items-center justify-between">
                      <span className="font-medium text-[#111110]">{client?.name ?? os[0]?.client_name}</span>
                      <span className="text-[13px] text-[#9a9a95] font-mono">{os.length} зак. · {KG(w)} кг · {RUB(a)} ₽</span>
                    </div>
                    <div className="divide-y divide-[#f0f0ee]">
                      {os.map(o => {
                        const r = o.ready
                        return (
                          <label key={o.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-[#fafaf9]">
                            <input type="checkbox" checked={picked.has(o.id)} onChange={() => togglePick(o.id)} className="w-4 h-4 accent-[#111110]" />
                            <span className="font-mono text-[14px] text-[#111110]">{orderNo(o)}</span>
                            <span className={`text-[11px] px-2 py-0.5 rounded-full border ${r.cls}`}>{r.label}</span>
                            <span className="ml-auto font-mono text-[13px] text-[#4b4b47]">{KG(orderWeight(o))} кг</span>
                            <span className="font-mono text-[13px] text-[#111110] w-28 text-right">{RUB(orderSum(o))} ₽</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* История доставок: год → месяц → рейсы, всё сворачивается */}
            {done.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-[13px] uppercase tracking-wide text-[#9a9a95]">История доставок — {done.length}</h2>
                {historyYears.map(([year, months]) => {
                  const yStats = months.flatMap(([, trips]) => trips)
                  const yOpen = isOpen(`y${year}`, year === currentYear)
                  return (
                    <div key={year} className="border border-[#e4e4e0] rounded-lg bg-white">
                      <button onClick={() => toggleGroup(`y${year}`)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left">
                        <span className="font-semibold text-[15px] text-[#111110]">{yOpen ? '▾' : '▸'} {year}</span>
                        <span className="text-[13px] text-[#9a9a95] font-mono">
                          {yStats.length} рейс(ов) · {KG(yStats.reduce((s, t) => s + (t.total_weight_kg ?? 0), 0))} кг · {RUB(yStats.reduce((s, t) => s + (t.total_amount ?? 0), 0))} ₽
                        </span>
                      </button>
                      {yOpen && (
                        <div className="px-4 pb-4 space-y-2">
                          {months.map(([mKey, trips]) => {
                            const mOpen = isOpen(`m${mKey}`, mKey === currentMonthKey)
                            return (
                              <div key={mKey}>
                                <button onClick={() => toggleGroup(`m${mKey}`)}
                                  className="w-full flex items-center justify-between py-1.5 text-left border-b border-[#f0f0ee]">
                                  <span className="text-[14px] font-medium text-[#111110]">{mOpen ? '▾' : '▸'} {MONTHS_RU[Number(mKey.slice(5, 7)) - 1]}</span>
                                  <span className="text-[12px] text-[#9a9a95] font-mono">
                                    {trips.length} рейс(ов) · {KG(trips.reduce((s, t) => s + (t.total_weight_kg ?? 0), 0))} кг · {RUB(trips.reduce((s, t) => s + (t.total_amount ?? 0), 0))} ₽
                                  </span>
                                </button>
                                {mOpen && (
                                  <div className="mt-2 space-y-2">
                                    {trips.map(s => <ShipmentCard key={s.id} s={s} orders={orders} clientNames={clientNames} onShipped={markShipped} onDelete={deleteShipment} onRemove={removeFromShipment} onLimit={setLimit} />)}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
