'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import ProductionTabs from '@/components/ProductionTabs'
import { createClient } from '@/lib/supabase-browser'
import { STAGE_LABELS, stageLabel, stageCountLabel, type DetailStageKey } from '@/lib/productionStages'
import { holesFromComment, normalizeHoles, holesLabel } from '@/lib/production/holes'
import { REWORK_REASONS, type ReworkReason } from '@/lib/production/rework'
import { explainEmptyQueue, canCloseWholeOrder } from '@/lib/production/completeOrder'
import { queueEmptyState } from '@/lib/production/queueState'
import { shouldAutoStart } from '@/lib/production/start'
import { toast, sendOrToast } from '@/lib/toast'
import { myStationGroups, canCompleteWholeDetail, type StationGroup, type StationTask } from '@/lib/production/completeMyStage'
import { PROD_SINCE, parseNotes, urgencyRank, isUrgent, deadlineOf, launchedOf, daysLeftLabel, shopMaterial, shopMaterialLabel, type ShopMaterial } from '@/lib/orderFlags'
import LeadSummary from './LeadSummary'
import { materialLabelShort } from '@/lib/materialLabel'
import { loadPointClientIds, pointsFirst } from '@/lib/b2b/points'
import { isLiveShopOrder } from '@/lib/production/liveOrder'
import { readPaged, readIn } from '@/lib/production/paged'
import PointBadge from '@/components/PointBadge'

// «Мои задачи»: карточка = ЗАКАЗ (раскрывается на месте — детали с кнопками и
// чертёж), сверху личное табло мастера по ИЗДЕЛИЯМ (сегодня/неделя, процент),
// очередь разбита по горизонту отгрузки: Сегодня → Завтра → Неделя → Позже,
// чтобы мастер мог брать работу наперёд, если на сегодня нет материала.

type TaskRow = {
  id: number
  order_id: number
  item_index: number
  stage_key: string
  sequence_order: number
  station: string
  status: 'queued' | 'in_progress' | 'done' | 'problem'
  blocked_by_task_id: number | null
  production_day: string | null
  layer_note: string | null
  rework_count: number | null
}
type RouteStage = {
  id:                number
  item_index:        number
  stage_key:         string
  sequence_order:    number
  status:            string
  station:           string
  auto_closed:       boolean | null
  completed_by_name: string | null
}

type DoneRow = { order_id: number; item_index: number; completed_at: string }
type ItemSpec = { materialName?: string; category?: string; thickness?: number; width?: number; height?: number; quantity?: number; shape?: string; hasHoles?: boolean; hasFacet?: boolean; hasSandblast?: boolean; hasTempering?: boolean; hasTriplex?: boolean; comment?: string; holes?: unknown; cutouts?: number }
type OrderLite = { id: number; client_id?: number | null; client_name: string; custom_number: string | null; items?: ItemSpec[]; notes?: unknown }
type BlockerLite = { id: number; status: string; stage_key: string }

const orderNo = (o: OrderLite | undefined, id: number) => o?.custom_number?.trim() || `00${id}`
const MAT_TONE: Record<ShopMaterial['state'], string> = {
  needed: 'bg-red-100 text-red-700', ordered: 'bg-blue-100 text-blue-700', arrived: 'bg-emerald-100 text-emerald-700',
}
const fmtShort = (s: string | null) => { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit' }) }
const qtyOf = (o: OrderLite | undefined, idx: number) => Math.max(1, o?.items?.[idx]?.quantity ?? 1)

function specLine(item?: ItemSpec): string {
  if (!item) return ''
  const dims = item.width && item.height ? `${item.width}×${item.height}` : ''
  const mat = materialLabelShort(item)
  const qty = item.quantity && item.quantity > 1 ? `${item.quantity} шт` : ''
  return [dims, mat, qty].filter(Boolean).join(' · ')
}

// Обработки изделия одной строкой (обращение №2 от цеха: «в карточке только
// размеры, работнику этого недостаточно»). Признаки те же, из которых строится
// маршрут, — резчик видит их до того, как возьмётся за лист.
function featureLine(item?: ItemSpec): string {
  if (!item) return ''
  const f: string[] = []
  if (item.shape === 'curved')   f.push('криволинейка')
  if (item.hasHoles) {
    // Сверловщику нужны размеры, а не факт «отверстия есть»: без них он всё равно
    // идёт спрашивать. Порядок источников — от точного к сырому:
    //   1) группы, заведённые менеджером;
    //   2) диаметры от разбора чертежа — они уже напечатаны следом, комментарием
    //      позиции; у 35 позиций из 83 они есть только там. Сам кусок сюда НЕ
    //      поднимаем (проверено на стенде 375 px: одна и та же строка выводилась
    //      дважды и занимала четыре строки вместо двух) — меняем только подпись,
    //      потому что «размеры не указаны» над готовыми размерами это враньё;
    //   3) размеров нет нигде — так и говорим.
    const g = normalizeHoles(item.holes)
    if (g.length)                        f.push(`отверстия ${holesLabel(g)}`)
    else if (holesFromComment(item.comment)) f.push('отверстия — размеры в комментарии')
    else                                 f.push('отверстия (размеры не указаны)')
  }
  const cut = Math.max(0, Number(item.cutouts) || 0)
  if (cut > 0)                   f.push(`вырезы ${cut}`)
  if (item.hasSandblast)         f.push('песочка')
  if (item.hasFacet)             f.push('фацет')
  if (item.hasTriplex)           f.push('триплекс')
  if (item.hasTempering)         f.push('закалка')
  return f.join(' · ')
}

// Горизонт отгрузки заказа: сегодня (вкл. просрочку) / завтра / эта неделя / позже
type Horizon = 'today' | 'tomorrow' | 'week' | 'later'
const HORIZONS: { key: Horizon; label: string; cls: string }[] = [
  { key: 'today',    label: 'На сегодня (и просроченные)', cls: 'text-red-700' },
  { key: 'tomorrow', label: 'На завтра',                   cls: 'text-amber-700' },
  { key: 'week',     label: 'На этой неделе',              cls: 'text-[#111110]' },
  { key: 'later',    label: 'Позже / без срока',           cls: 'text-[#9a9a95]' },
]

// PostgREST отдаёт ограниченное число строк за запрос, и молча: ответ выглядит
// нормальным, просто короче. Поэтому читаем страницами, пока приходит полная.
// Ошибку не глотаем: раньше упавшая страница превращалась в «Нет задач в очереди»,
// и рабочий не мог отличить пустую смену от сломанной сети.
const PAGE = 1000
async function fetchAllTasks(sb: ReturnType<typeof createClient>, orFilter: string): Promise<TaskRow[]> {
  const cols = 'id,order_id,item_index,stage_key,sequence_order,station,status,blocked_by_task_id,production_day,layer_note,rework_count'
  const out: TaskRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('production_tasks')
      .select(cols).or(orFilter)
      .in('status', ['queued', 'in_progress', 'problem'])
      .order('sequence_order', { ascending: true }).order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as TaskRow[]
    out.push(...page)
    if (page.length < PAGE) break
  }
  return out
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) })
const patchDone: RequestInit = { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ action: 'done' }) }

export default function MyQueuePage() {
  const sb = createClient()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tasks, setTasks] = useState<TaskRow[]>([])
  // Сколько задач пришло до фильтра по живым заказам — отличает «станция не назначена»
  // от «назначенное лично есть, но оно по старым/уехавшим заказам».
  const [rawCount, setRawCount] = useState(0)
  const [doneWeek, setDoneWeek] = useState<DoneRow[]>([])
  const [doneOrders, setDoneOrders] = useState<Map<number, OrderLite>>(new Map())
  const [orders, setOrders] = useState<Map<number, OrderLite>>(new Map())
  const [pointClients, setPointClients] = useState<Set<number>>(new Set())
  const [blockers, setBlockers] = useState<Map<number, BlockerLite>>(new Map())
  // П3: вместо андона — «Переделать». Хранится задача, на которой рабочий нашёл брак.
  const [reworkFor, setReworkFor] = useState<number | null>(null)
  const [reworkBusy, setReworkBusy] = useState(false)
  // «Другое» — единственная причина со свободным текстом: список из пяти закрывает
  // известное, а тут цех сам покажет, чего в нём не хватает (через месяц будет видно из данных).
  const [reworkOther, setReworkOther] = useState('')
  const [myStations, setMyStations] = useState<string[]>([])
  // Свой профиль — не тот, чью очередь смотрим: сервер проверяет права нажавшего.
  const [myRole, setMyRole] = useState<string | null>(null)
  const [ownStations, setOwnStations] = useState<string[]>([])
  // «Всё готово» закрывает ЗАКАЗ целиком — это решение упаковщика: он последний
  // в маршруте и единственный, кто физически видит, что заказ собран. Резчик,
  // нажав её, закроет и полировку, и закалку, и упаковку по всем деталям —
  // получится каша, за которую потом никто не отвечает (решение владельца 28.08).
  // Кнопку показываем только тому, кого пустит сервер (то же правило, что в маршруте).
  const canCloseWhole = canCloseWholeOrder(myRole, ownStations)
  const canCloseOrder = myStations.includes('packaging') && canCloseWhole
  // Какую станцию какого заказа подтверждаем: `${orderId}:${station}`. Одна кнопка — одна станция.
  const [confirmMine, setConfirmMine] = useState<string | null>(null)
  // Заказ, найденный по номеру, но БЕЗ моих задач: менеджер не отметил признак,
  // и маршрут через мою станцию не построился. Рабочий видит пустоту и идёт к
  // владельцу — так 01.09 пришёл Адилет с четырьмя заказами сразу.
  // mineHere — задачи МОЕЙ станции в найденном заказе. Их наличие меняет смысл
  // сообщения на противоположный: не «менеджер не отметил», а «ещё не дошло до меня».
  const [foreignOrder, setForeignOrder] = useState<
    { id: number; number: string; client: string; mineHere: { stage: string; status: string }[]; waitingFor: string[] } | null
  >(null)
  const [addingStage, setAddingStage] = useState(false)
  const [me, setMe] = useState<{ id: string; name: string } | null>(null)
  // Статус закупки материала по заказам с пометками: 'orderId:all' / 'orderId:idx' → need|ordered|arrived + дата прибытия
  const [matReq, setMatReq] = useState<Map<string, { status: string; expected: string | null }>>(new Map())
  // Полный маршрут детали — ВСЕ этапы, включая чужие станции. Рабочий должен
  // видеть путь изделия целиком: где оно было, где стоит сейчас, куда пойдёт.
  const [routes, setRoutes] = useState<Map<string, RouteStage[]>>(new Map())
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  // В поиске карточки раскрыты по умолчанию: ищут конкретный заказ, чтобы с ним работать,
  // а не чтобы посмотреть. Здесь — те, что человек свернул руками вопреки этому.
  const [collapsedInSearch, setCollapsedInSearch] = useState<Set<number>>(new Set())
  // «Всё готово» закрывает заказ целиком одним касанием — подтверждаем вторым тапом,
  // чтобы телефон в кармане не закрыл смену.
  const [confirmDone, setConfirmDone] = useState<number | null>(null)
  // Открытые задачи заказа ЦЕЛИКОМ, не только свои: нужны и счётчику «Всё готово»
  // (сервер закрывает весь заказ), и объяснению пустой карточки в поиске.
  const [orderWork, setOrderWork] = useState<Map<number, { station: string; n: number }[]>>(new Map())
  const [workLoaded, setWorkLoaded] = useState(false)
  // Начальник/владелец выбрал мастера в сводке — показываем ЕГО очередь
  const [viewMaster, setViewMaster] = useState<{ id: string; name: string; stations: string[] } | null>(null)
  const [search, setSearch] = useState('')
  // Режим резчика: те же заказы, но пересобранные по материалу и толщине —
  // видно, какие заказы можно объединить в один крой и сколько изделий выйдет
  const [groupMode, setGroupMode] = useState<'time' | 'material'>('time')
  const [matFilter, setMatFilter] = useState<'all' | 'glass' | 'mirror'>('all')
  const [expandedMat, setExpandedMat] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user }, error: authErr } = await sb.auth.getUser()
      if (authErr || !user) throw new Error('Сессия истекла — войдите заново')

      let queueUserId = user.id
      const { data: profile, error: profErr } = await sb.from('users').select('production_stations,name,role').eq('id', user.id).maybeSingle()
      if (profErr) throw new Error(`Профиль не прочитан: ${profErr.message}`)
      const prof = profile as { production_stations: string[] | null; name: string | null; role: string | null } | null
      setMe({ id: user.id, name: prof?.name ?? user.email ?? 'Цех' })
      setMyRole(prof?.role ?? null)
      setOwnStations(prof?.production_stations ?? [])
      let stations: string[]
      if (viewMaster) {
        queueUserId = viewMaster.id
        stations = viewMaster.stations
      } else {
        stations = prof?.production_stations ?? []
      }
      setMyStations(stations)

      const orFilter = stations.length
        ? `assigned_to.eq.${queueUserId},and(assigned_to.is.null,station.in.(${stations.join(',')}))`
        : `assigned_to.eq.${queueUserId}`

      // Понедельник этой недели — для табло «за неделю»
      const monday = new Date()
      monday.setHours(0, 0, 0, 0)
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))

      const [taskRows, doneRows] = await Promise.all([
        // Берём и закрытые задачи: в обычном списке они не показываются, но
        // нужны поиску — иначе отмеченный заказ пропадает и его не найти.
        // Только незакрытые: рабочая очередь. Закрытые задачи (их столько же, сколько
        // открытых) переполняли ответ, и упаковка — последняя по sequence_order —
        // обрезалась первой: заказ переставал выпадать у мастера, хотя задачи в нём
        // были. Поиск по уже отмеченным заказам делает отдельный запрос ниже.
        //
        // Страницами: у Никиты одних незакрытых больше тысячи, а PostgREST отдаёт
        // не больше страницы за раз. Одним запросом часть очереди молча терялась.
        fetchAllTasks(sb, orFilter),
        // Отмеченное за неделю — тоже страницами: у упаковщика за неделю бывает больше тысячи.
        stations.length
          ? readPaged<DoneRow>((from, to) => sb.from('production_tasks').select('order_id,item_index,completed_at')
              .eq('status', 'done').in('station', stations).gte('completed_at', monday.toISOString())
              .order('id').range(from, to))
          : Promise.resolve([] as DoneRow[]),
      ])

      const list = taskRows
      setRawCount(list.length)
      const dw = doneRows

      const orderIds = [...new Set(list.map(t => t.order_id))]
      const doneOrderIds = [...new Set(dw.map(t => t.order_id))].filter(id => !orderIds.includes(id))
      const blockerIds = [...new Set(list.map(t => t.blocked_by_task_id).filter((x): x is number => x != null))]

      // Списки id — пачками по 500 (lib/production/paged.ts): у Никиты заказов в очереди
      // сотни, и одним .in() упираемся и в длину адреса, и в потолок строк.
      const [orderRows, doneOrderRows, blockerRows, points] = await Promise.all([
        readIn<OrderLite, number>(orderIds, (part, from, to) => sb.from('b2b_orders')
          .select('id,client_id,client_name,custom_number,items,notes')
          .in('id', part).gte('created_at', PROD_SINCE).is('archived_at', null)
          .order('id').range(from, to)),
        readIn<Pick<OrderLite, 'id' | 'items'>, number>(doneOrderIds, (part, from, to) => sb.from('b2b_orders')
          .select('id,items').in('id', part).gte('created_at', PROD_SINCE)
          .order('id').range(from, to)),
        readIn<BlockerLite, number>(blockerIds, (part, from, to) => sb.from('production_tasks')
          .select('id,status,stage_key').in('id', part).order('id').range(from, to)),
        loadPointClientIds(sb),
      ])
      setPointClients(points)

      // Производственный контур — только заказы с PROD_SINCE, не в архиве и не уехавшие:
      // задачи отгруженного заказа — не работа, даже если их никто не закрыл.
      const freshOrders = new Map(orderRows.filter(o => isLiveShopOrder(o)).map(o => [o.id, o]))
      const freshIds = [...freshOrders.keys()]
      setTasks(list.filter(t => freshOrders.has(t.order_id)))
      setOrders(freshOrders)

      // Маршрут целиком по видимым заказам: без этого рабочий видит только свою станцию и не
      // понимает, готова ли деталь и кто её вёл до него. Это ВСЕ задачи заказов (и закрытые) —
      // на сотне заказов их тысячи, поэтому пачками и страницами. Из них же — что открыто
      // у всего цеха (orderWork): отдельный запрос по тем же заказам был бы вторым чтением.
      const routeRows = await readIn<RouteStage & { order_id: number }, number>(freshIds, (part, from, to) => sb.from('production_tasks')
        .select('id,item_index,stage_key,sequence_order,status,station,auto_closed,completed_by_name,order_id')
        .in('order_id', part).order('id').range(from, to))

      const workMap = new Map<number, Map<string, number>>()
      for (const w of routeRows) {
        if (w.status === 'done') continue
        const byStation = workMap.get(w.order_id) ?? new Map<string, number>()
        byStation.set(w.station, (byStation.get(w.station) ?? 0) + 1)
        workMap.set(w.order_id, byStation)
      }
      setOrderWork(new Map([...workMap].map(([id, m]) =>
        [id, [...m].map(([station, n]) => ({ station, n })).sort((a, b) => b.n - a.n)])))
      setWorkLoaded(true)

      // Заявки цеха на материал — мастер видит, когда стекло заказано и когда пришло,
      // не выходя из очереди. По всем заказам, а не только с 'needed': закупщик,
      // отметив «заказан», затирает 'needed', а ожидание цеха остаётся (shopMaterial).
      const reqs = await readIn<{ b2b_order_id: number; item_index: number | null; status: string; expected_date: string | null }, number>(
        [...freshOrders.keys()], (part, from, to) => sb.from('shop_purchase_requests')
          .select('id,b2b_order_id,item_index,status,expected_date')
          .in('b2b_order_id', part).order('id', { ascending: true }).range(from, to))
      const m = new Map<string, { status: string; expected: string | null }>()
      for (const r of reqs) {
        m.set(`${r.b2b_order_id}:${r.item_index ?? 'all'}`, { status: r.status, expected: r.expected_date }) // позднейшая заявка перезаписывает
      }
      setMatReq(m)
      // Для табло нужны только количества изделий — имя клиента здесь не читаем.
      const dMap = new Map<number, OrderLite>(doneOrderRows.map(o => [o.id, { ...o, client_name: '', custom_number: null }]))
      for (const [id, o] of freshOrders) dMap.set(id, o)
      setDoneOrders(dMap)
      setDoneWeek(dw.filter(t => dMap.has(t.order_id)))
      setBlockers(new Map(blockerRows.map(b => [b.id, b])))

      const rm = new Map<string, RouteStage[]>()
      for (const r of [...routeRows].sort((a, b) => a.sequence_order - b.sequence_order || a.id - b.id)) {
        const k = `${r.order_id}:${r.item_index}`
        const arr = rm.get(k) ?? []
        arr.push(r)
        rm.set(k, arr)
      }
      setRoutes(rm)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [sb, viewMaster])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const handlePick = useCallback((m: { id: string; name: string; stations: string[] } | null) => {
    setViewMaster(prev => ((prev?.id ?? null) === (m?.id ?? null) ? prev : m))
  }, [])

  // Один вход на все старты (П2): и явное «Взял», и автостарт при раскрытии
  // карточки. via отличает сильный сигнал от слабого — см. lib/production/start.ts.
  async function sendStart(taskIds: number[], via: 'button' | 'open', orderId: number | null) {
    const was = new Map(tasks.filter(t => taskIds.includes(t.id)).map(t => [t.id, t.status]))
    if (taskIds.length) setTasks(prev => prev.map(t => taskIds.includes(t.id) ? { ...t, status: 'in_progress' } : t))
    const r = await sendOrToast(via === 'button' ? 'Не взято в работу' : 'Отметка «в работе» не записалась',
      '/api/production/start', post({ task_ids: taskIds, order_id: orderId, via }))
    // Сервер не принял — на экране не должно висеть «в работе», которого нет в базе.
    if (!r && was.size) setTasks(prev => prev.map(t => was.has(t.id) ? { ...t, status: was.get(t.id)! } : t))
  }

  // Убрать задачи с экрана сразу (кнопку жмут в перчатке — ждать ответа незачем),
  // а если сервер отказал — вернуть их на место. Причина отказа — в тосте.
  async function optimistic(removeIf: (t: TaskRow) => boolean, failTitle: string, url: string, init: RequestInit): Promise<boolean> {
    const removed = tasks.filter(removeIf)
    setTasks(prev => prev.filter(t => !removeIf(t)))
    const r = await sendOrToast(failTitle, url, init, removed.length ? 'Задачи вернулись в список' : undefined)
    if (!r) {
      setTasks(prev => [...prev, ...removed.filter(x => !prev.some(t => t.id === x.id))])
      return false
    }
    return true
  }

  async function markStart(taskId: number) {
    await sendStart([taskId], 'button', tasks.find(t => t.id === taskId)?.order_id ?? null)
  }

  async function markStartOrder(taskIds: number[]) {
    await sendStart(taskIds, 'button', tasks.find(t => taskIds.includes(t.id))?.order_id ?? null)
  }

  async function markDone(taskId: number) {
    const task = tasks.find(t => t.id === taskId)
    const ok = await optimistic(t => t.id === taskId, 'Не отмечено', `/api/production-tasks/${taskId}`, patchDone)
    if (!ok) return
    // Деталь готова = материал на неё был: гасим её пометку «ждёт материал»
    if (task) {
      const marked = parseNotes(orders.get(task.order_id)?.notes).material_needed_items
      if (Array.isArray(marked) && (marked as number[]).includes(task.item_index)) {
        await mergeNotes(task.order_id, n => {
          const prev = Array.isArray(n.material_needed_items) ? (n.material_needed_items as number[]) : []
          return { ...n, material_needed_items: prev.filter(i => i !== task.item_index) }
        }).catch(e => toast.error('Отметка «нет материала» не снялась', { detail: String(e instanceof Error ? e.message : e) }))
      }
    }
    void load()
  }

  // «Готово всё» по ОДНОЙ детали (обращение №3 от цеха). У Никиты две станции —
  // закалка и упаковка. Он жмёт «Готово» на закалке, каскад закрывает всё ДО неё,
  // а упаковка остаётся: она после. Приходится жать второй раз.
  // Закрываем последний этап детали — каскад сам закроет все предыдущие. Тот же
  // механизм, что у «Всё готово» на заказ, только в границах одной детали.
  async function completeItem(orderId: number, itemIndex: number) {
    const route = (routes.get(`${orderId}:${itemIndex}`) ?? [])
      .filter(r => r.status !== 'done')
      .sort((a, b) => a.sequence_order - b.sequence_order)
    const last = route[route.length - 1]
    // Маршрута нет в памяти — значит не догрузился или деталь уже закрыта. Молча ничего
    // не делать нельзя: рабочий решит, что отметил.
    if (!last) {
      toast.error('Деталь не закрыта', { detail: 'Маршрут детали не загружен или все этапы уже закрыты — обновите экран' })
      return
    }
    const ok = await optimistic(t => t.order_id === orderId && t.item_index === itemIndex,
      'Деталь не закрыта', `/api/production-tasks/${last.id}`, patchDone)
    if (ok) void load()
  }

  // «Готово: <станция>»: закрыть ОДНУ свою станцию по всем деталям заказа.
  // Резчик делает заказ разом, а не по детали — жать пятнадцать раз незачем.
  // Но станция — одна за нажатие (владелец, 25.09): у Эльзата резка и полировка,
  // и общая кнопка закрывала полировку в секунду резки. Нарезал — отметил резку,
  // отполировал — отметил полировку. Границу проверяет сервер по станциям профиля.
  async function completeMyStage(orderId: number, station: string) {
    setConfirmMine(null)
    const ok = await optimistic(t => t.order_id === orderId && t.station === station,
      `Не отмечено: ${stageLabel(station)}`, '/api/production/complete-my-stage', post({ order_id: orderId, station }))
    if (ok) void load()
  }

  // «Всё готово»: закрыть заказ целиком, минуя цепочку готовности. Именно она и была
  // проблемой — упаковка Никиты числилась заблокированной, потому что предыдущие этапы
  // никто не отметил, и закрыть её из очереди он не мог. Атрибуция — в
  // lib/production/completeOrder.ts: на нажавшего пишется по одной задаче на деталь,
  // остальное закрывает каскад без исполнителя.
  async function completeOrder(orderId: number) {
    setConfirmDone(null)
    const ok = await optimistic(t => t.order_id === orderId, 'Заказ не закрыт', '/api/production/complete-order', post({ order_id: orderId }))
    if (ok) { setForeignOrder(null); void load() }
  }

  async function purchaseRequest(title: string, details: string | null, orderId: number, itemIndex: number | null) {
    const { error } = await sb.from('shop_purchase_requests').insert({ title, qty: null, details, author_id: me?.id, author_name: me?.name ?? 'Цех', b2b_order_id: orderId, item_index: itemIndex })
    if (error) { toast.error('Заявка на материал не записалась', { detail: `${error.message}. Скажите закупщику голосом` }); return }
    await sendOrToast('Заявка записана, но закупщику не ушло сообщение', '/api/shop-purchases/notify',
      post({ title, qty: '', author: me?.name ?? 'Цех', link: '', order_id: orderId }), 'Скажите закупщику голосом')
  }

  // Точечный патч notes под блокировкой строки. Раньше здесь был свежий
  // read-merge-write: он спасал от устаревшего снимка, но окно между чтением и
  // записью оставалось — параллельная отметка этапа могла потеряться.
  // patch_order_notes_shallow мержит верхний уровень в одной транзакции.
  async function mergeNotes(orderId: number, patch: (n: Record<string, unknown>) => Record<string, unknown>) {
    const { data: fresh } = await sb.from('b2b_orders').select('notes').eq('id', orderId).single()
    const n = parseNotes((fresh as { notes: string | null } | null)?.notes ?? null)
    const next = patch(n)
    const changed: Record<string, unknown> = {}
    for (const k of Object.keys(next)) if (next[k] !== n[k]) changed[k] = next[k]
    if (Object.keys(changed).length === 0) return
    const { error } = await sb.rpc('patch_order_notes_shallow', { p_order_id: orderId, p_patch: changed })
    if (error) throw new Error(error.message)
  }

  // «Пришёл» от цеха закрывает его заявки: иначе закупщик видит их открытыми,
  // а у резчика плашка висит дальше (shopMaterial держит ожидание на заявке).
  async function closeShopRequests(orderId: number, itemIndex: number | null) {
    let q = sb.from('shop_purchase_requests')
      .update({ status: 'arrived', arrived_at: new Date().toISOString(), arrived_by: me?.name ?? 'Цех' })
      .eq('b2b_order_id', orderId).in('status', ['need', 'ordered'])
    q = itemIndex == null ? q.is('item_index', null) : q.eq('item_index', itemIndex)
    const { error } = await q
    if (error) toast.error('«Пришёл» записан, но заявка у закупщика осталась открытой', { detail: `${error.message}. Скажите закупщику` })
  }

  // «Нет материала на весь заказ» (повторное нажатие = материал пришёл)
  async function toggleNoMaterialOrder(orderId: number) {
    const o = orders.get(orderId)
    const turnOn = shopMaterial(parseNotes(o?.notes).material_status, matReq.get(`${orderId}:all`)) == null
    try {
      await mergeNotes(orderId, n => ({ ...n, material_status: turnOn ? 'needed' : 'ready', material_checked_at: new Date().toISOString(), material_checked_by: me?.name ?? null }))
    } catch (e) {
      toast.error(turnOn ? '«Нет материала» не записалось' : '«Материал пришёл» не записалось', { detail: e instanceof Error ? e.message : String(e) })
      return
    }
    if (turnOn) {
      const details = (o?.items ?? []).map(it => specLine(it)).filter(Boolean).join('; ')
      await purchaseRequest(`Материал: ${orderNo(o, orderId)} — весь заказ (${o?.client_name ?? ''})`, details || null, orderId, null)
    } else {
      await closeShopRequests(orderId, null)
    }
    void load()
  }

  // «Нет материала» на конкретную деталь: остальной заказ идёт дальше, эта позиция ждёт
  async function toggleNoMaterialItem(orderId: number, itemIndex: number) {
    const o = orders.get(orderId)
    const cur = parseNotes(o?.notes).material_needed_items
    const arr = Array.isArray(cur) ? (cur as number[]) : []
    const turnOn = !arr.includes(itemIndex)
    try {
      await mergeNotes(orderId, n => {
        const prev = Array.isArray(n.material_needed_items) ? (n.material_needed_items as number[]) : []
        const next = turnOn ? [...new Set([...prev, itemIndex])] : prev.filter(i => i !== itemIndex)
        return { ...n, material_needed_items: next }
      })
    } catch (e) {
      toast.error(`Поз. ${itemIndex + 1}: отметка материала не записалась`, { detail: e instanceof Error ? e.message : String(e) })
      return
    }
    if (turnOn) await purchaseRequest(`Материал: ${orderNo(o, orderId)} · поз. ${itemIndex + 1} (${o?.client_name ?? ''})`, specLine(o?.items?.[itemIndex]) || null, orderId, itemIndex)
    else await closeShopRequests(orderId, itemIndex)
    void load()
  }

  // Тап по причине И ЕСТЬ подтверждение — ни модалки с «Отправить», ни обязательного
  // комментария. Два тапа вместо четырёх, и второй несёт причину.
  async function submitRework(reason: ReworkReason, comment?: string) {
    if (reworkFor == null || reworkBusy) return
    setReworkBusy(true)
    const r = await sendOrToast('Переделка не записалась', '/api/production/rework',
      post({ task_id: reworkFor, reason, comment: comment?.trim() || null }), 'Попробуйте ещё раз')
    setReworkBusy(false)
    // Отказ — лист причин остаётся открытым, чтобы повторить, не выбирая заново.
    if (!r) return
    setReworkFor(null)
    setReworkOther('')
    void load()
  }

  const isReady = (t: TaskRow) => {
    if (t.blocked_by_task_id == null) return true
    const b = blockers.get(t.blocked_by_task_id)
    return b?.status === 'done'
  }

  // П2: раскрыл карточку заказа на своей станции — значит взялся за него.
  // Кнопка «Взял» существует с 30.06 и за два месяца собрала 0 нажатий, поэтому
  // сигнал берём из действия, которое рабочий и так делает, а кнопку оставляем жить.
  // Без await и без блокировки UI: он пришёл посмотреть, что делать, а не отмечаться.
  // Свёрнутая карточка задачу НЕ снимает — он мог свернуть список и продолжать работу;
  // прежний автостарт снимет сервер, когда рабочий раскроет другой заказ.
  const toggleOrder = (orderId: number) => {
    const searching = search.trim().length > 0
    const opening = searching ? collapsedInSearch.has(orderId) : !expanded.has(orderId)
    if (searching) {
      setCollapsedInSearch(prev => {
        const n = new Set(prev)
        if (n.has(orderId)) n.delete(orderId); else n.add(orderId)
        return n
      })
    } else {
      setExpanded(prev => {
        const n = new Set(prev)
        if (n.has(orderId)) n.delete(orderId); else n.add(orderId)
        return n
      })
    }
    if (!opening) return
    // Чужая очередь (начальник выбрал мастера в сводке) или не рабочий цеха — только смотрим.
    if (!shouldAutoStart({ viewingOther: viewMaster != null, role: myRole })) return
    const ids = tasks.filter(t => t.order_id === orderId && t.status === 'queued' && isReady(t)).map(t => t.id)
    void sendStart(ids, 'open', orderId)
  }

  // Автораскрытие в поиске НЕ считается взятием в работу: совпадений может быть
  // несколько, и стартовать разом несколько заказов было бы неправдой. Автостарт
  // остаётся только на явном тапе (П2).
  const isOpen = (orderId: number) =>
    search.trim() ? !collapsedInSearch.has(orderId) : expanded.has(orderId)

  // Закрытые задачи держим в памяти только ради поиска — во всех счётчиках,
  // табло и группировках участвуют активные.
  const activeTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'problem')
  const q = search.trim().toLowerCase()
  const orderMatches = (id: number) => {
    if (!q) return true
    const o = orders.get(id)
    return orderNo(o, id).toLowerCase().includes(q) || (o?.client_name ?? '').toLowerCase().includes(q)
  }

  // ── Группировка по заказам ──
  // Без запроса — только незакрытые задачи (рабочий список). В поиске
  // показываем и выполненные: мастеру нужно найти заказ, который он уже отметил.
  const byOrder = new Map<number, TaskRow[]>()
  for (const t of tasks) {
    if (!q && (t.status === 'done' || t.status === 'problem')) continue
    if (!orderMatches(t.order_id)) continue
    byOrder.set(t.order_id, [...(byOrder.get(t.order_id) ?? []), t])
  }

  // Поиск не нашёл ничего среди МОИХ задач — ищем заказ вообще, чтобы предложить
  // добавить свой этап, а не показывать пустой экран.
  const qTrim = search.trim()
  const lookForeign = qTrim.length >= 3 && byOrder.size === 0
  useEffect(() => {
    if (!lookForeign) return
    let cancelled = false
    const digits = qTrim.replace(/\D/g, '')
    const stations = myStations
    ;(async () => {
      const { data } = await sb.from('b2b_orders')
        .select('id,custom_number,client_name')
        .or(`custom_number.ilike.%${qTrim}%${digits ? `,id.eq.${Number(digits)}` : ''}`)
        .gte('created_at', PROD_SINCE).limit(1)
      const o = (data ?? [])[0] as { id: number; custom_number: string | null; client_name: string | null } | undefined
      if (!o) { if (!cancelled) setForeignOrder(null); return }

      // Есть ли в заказе задачи моей станции и что держит их в очереди. Без этой
      // проверки экран объявлял «при просчёте не отметили» даже там, где задачи
      // стоят с первого дня и просто ждут предыдущих этапов (заказ 05385, 09.09).
      const { data: all } = await sb.from('production_tasks')
        .select('stage_key,station,status,sequence_order').eq('order_id', o.id)
      const rows = (all ?? []) as { stage_key: string; station: string | null; status: string; sequence_order: number }[]
      const mineHere = rows
        .filter(r => stations.includes(r.station ?? r.stage_key))
        .map(r => ({ stage: r.station ?? r.stage_key, status: r.status }))
      const myFirst = Math.min(...rows
        .filter(r => stations.includes(r.station ?? r.stage_key))
        .map(r => r.sequence_order))
      const waitingFor = mineHere.length === 0 ? [] : [...new Set(rows
        .filter(r => r.status !== 'done' && r.sequence_order < myFirst)
        .map(r => r.stage_key))]

      if (!cancelled) setForeignOrder({
        id: o.id, number: o.custom_number?.trim() || `00${o.id}`, client: o.client_name ?? '—',
        mineHere, waitingFor,
      })
    })()
    return () => { cancelled = true }
  }, [lookForeign, qTrim, sb, myStations])

  async function addMyStage(orderId: number, stage: string) {
    setAddingStage(true)
    const r = await sendOrToast(`Этап «${stageLabel(stage)}» не добавлен`, '/api/production/add-my-stage', post({ order_id: orderId, stage }))
    setAddingStage(false)
    if (!r) return
    setForeignOrder(null)
    void load()
  }

  // Горизонт по дате отгрузки заказа
  const todayStr = new Date(); todayStr.setHours(0, 0, 0, 0)
  const dayMs = 86400000
  const sunday = new Date(todayStr.getTime() + (7 - ((todayStr.getDay() + 6) % 7) - 1) * dayMs)
  const horizonOf = (id: number): Horizon => {
    const d = deadlineOf(orders.get(id)?.notes)
    if (!d) return 'later'
    const dd = new Date(d); dd.setHours(0, 0, 0, 0)
    if (dd.getTime() <= todayStr.getTime()) return 'today'
    if (dd.getTime() === todayStr.getTime() + dayMs) return 'tomorrow'
    if (dd.getTime() <= sunday.getTime()) return 'week'
    return 'later'
  }
  const groups: Record<Horizon, number[]> = { today: [], tomorrow: [], week: [], later: [] }
  for (const id of byOrder.keys()) groups[horizonOf(id)].push(id)
  const rankOrder = (id: number) => urgencyRank(orders.get(id)?.notes)
  const isPointOrder = (id: number) => {
    const c = orders.get(id)?.client_id
    return c != null && pointClients.has(c)
  }
  // Заказы точек — первыми внутри своего горизонта (решение владельца 01.10).
  for (const k of Object.keys(groups) as Horizon[]) groups[k] = pointsFirst(groups[k].sort((a, b) => rankOrder(a) - rankOrder(b)), isPointOrder)

  // ── Группировка по материалу и толщине ──
  // Деталь считаем один раз, даже если у мастера по ней две задачи (резка+кромка)
  type MatGroup = { key: string; kind: 'glass' | 'mirror'; label: string; perOrder: Map<number, { details: number; pieces: number }>; details: number; pieces: number; areaM2: number }
  const byMaterial = new Map<string, MatGroup>()
  if (groupMode === 'material') {
    const seenDetail = new Set<string>()
    for (const t of activeTasks) {
      if (!orderMatches(t.order_id)) continue
      const dk = `${t.order_id}:${t.item_index}`
      if (seenDetail.has(dk)) continue
      seenDetail.add(dk)
      const it = orders.get(t.order_id)?.items?.[t.item_index]
      const cat = (it?.category ?? '').trim().toLowerCase()
      const mat = (it?.materialName || it?.category || '').trim() || 'Материал не указан'
      // Зеркало: категория «зеркало» или готовое изделие/материал с «зеркал…»;
      // всё остальное (стекло/тонированное/сатин/рифленое…) — стекло
      const kind: 'glass' | 'mirror' = cat === 'зеркало' || cat === 'изделие' || /зеркал/i.test(mat) ? 'mirror' : 'glass'
      const key = `${kind}|${mat.toLowerCase()}|${it?.thickness ?? ''}`
      const typed = kind === 'mirror' && !/^зеркал/i.test(mat) ? `Зеркало · ${mat}` : kind === 'glass' ? `Стекло · ${mat}` : mat
      const g = byMaterial.get(key) ?? { key, kind, label: [typed, it?.thickness ? `${it.thickness} мм` : ''].filter(Boolean).join(' · '), perOrder: new Map(), details: 0, pieces: 0, areaM2: 0 }
      const qty = qtyOf(orders.get(t.order_id), t.item_index)
      const po = g.perOrder.get(t.order_id) ?? { details: 0, pieces: 0 }
      po.details += 1; po.pieces += qty
      g.perOrder.set(t.order_id, po)
      g.details += 1; g.pieces += qty
      if (it?.width && it?.height) g.areaM2 += it.width * it.height * qty / 1e6
      byMaterial.set(key, g)
    }
  }
  const matGroups = [...byMaterial.values()]
    .filter(g => matFilter === 'all' || g.kind === matFilter)
    .sort((a, b) => b.pieces - a.pieces)

  // ── Табло мастера: по ИЗДЕЛИЯМ (quantity), сегодня и неделя ──
  // Деталь считается ОДИН раз, даже если у мастера на неё несколько задач
  // (две станции = две задачи на одну стекляшку) — иначе выработка врёт вдвое.
  const piecesOf = (rows: { order_id: number; item_index: number }[], src: Map<number, OrderLite>) => {
    const seen = new Set<string>()
    return rows.reduce((s, t) => {
      const k = `${t.order_id}:${t.item_index}`
      if (seen.has(k)) return s
      seen.add(k)
      return s + qtyOf(src.get(t.order_id), t.item_index)
    }, 0)
  }
  const todayIso = new Date(); todayIso.setHours(0, 0, 0, 0)
  const doneToday = doneWeek.filter(t => new Date(t.completed_at) >= todayIso)
  const donePiecesToday = piecesOf(doneToday, doneOrders)
  const donePiecesWeek = piecesOf(doneWeek, doneOrders)
  const leftToday = activeTasks.filter(t => ['today'].includes(horizonOf(t.order_id)))
  const leftWeek = activeTasks.filter(t => ['today', 'tomorrow', 'week'].includes(horizonOf(t.order_id)))
  const leftPiecesToday = piecesOf(leftToday, orders)
  const leftPiecesWeek = piecesOf(leftWeek, orders)
  const planToday = donePiecesToday + leftPiecesToday
  const planWeek = donePiecesWeek + leftPiecesWeek
  const pctToday = planToday > 0 ? Math.round(donePiecesToday / planToday * 100) : null
  const pctWeek = planWeek > 0 ? Math.round(donePiecesWeek / planWeek * 100) : null

  const emptyState = queueEmptyState({
    loadError, stations: myStations,
    assignedToMe: myStations.length ? 0 : rawCount,
    visible: byOrder.size,
  })
  const totalReady = activeTasks.filter(isReady).length
  const totalWaiting = activeTasks.length - totalReady
  const totalDetails = new Set(activeTasks.map(t => `${t.order_id}:${t.item_index}`)).size

  if (loading) return (
    <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка...</div>
  )

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Мои задачи{viewMaster ? ` · ${viewMaster.name}` : ''}</h1>
            <p className="text-[13px] text-[#9a9a95] mt-0.5">{byOrder.size} заказов · {totalDetails} деталей · {totalReady} задач готово · {totalWaiting} ждут этапа</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Обращение №1 от цеха: «нет возможности удалить заказ целиком, приходится
                стирать по цифрам». Родная крестик-кнопка type=search на телефоне не
                показывается, поэтому своя — и с полем под палец, не 28 px. */}
            <div className="relative">
              <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск: № заказа"
                className={`border border-[#e4e4e0] rounded-lg pl-3 ${search ? 'pr-9' : 'pr-3'} py-2 text-[13px] bg-white w-44 outline-none focus:border-[#111110] [&::-webkit-search-cancel-button]:hidden`} />
              {search && (
                <button onClick={() => setSearch('')} aria-label="Очистить поиск"
                  className="absolute right-0 top-0 h-full w-9 flex items-center justify-center text-[#9a9a95] hover:text-[#111110] text-[16px] leading-none">×</button>
              )}
            </div>
          </div>
        </div>
        <ProductionTabs />
      </div>

      <div className="px-4 pt-4">
        <LeadSummary onPick={handlePick} />

        {/* Заказ есть, но моих задач в нём нет. Раньше здесь была пустота, и рабочий
            шёл к владельцу: «не отображается». Теперь видно, что заказ существует,
            и почему его нет у меня — признак при просчёте не отмечен. */}
        {lookForeign && foreignOrder && myStations.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-[14px] font-bold font-mono text-[#111110]">{foreignOrder.number}</p>
            <p className="text-[13px] text-[#6b6b66]">{foreignOrder.client}</p>

            {foreignOrder.mineHere.length > 0 && foreignOrder.mineHere.every(m => m.status === 'done') ? (
              // Уже отмечено. Раньше закрытые задачи держали в общем списке ради
              // этого случая — из-за них выборка упиралась в лимит и заказы пропадали.
              <p className="text-[12px] text-emerald-700 mt-1.5">
                Вы уже отметили этот заказ — {foreignOrder.mineHere.length} шт. Ничего делать не нужно.
              </p>
            ) : foreignOrder.mineHere.length > 0 ? (
              // Задачи станции в заказе есть — значит просчёт ни при чём, и мастеру
              // нужно не объяснение, а действие. Раньше он вводил номер и сразу жал
              // «Всё готово»; вернули это, не заставляя открывать заказ.
              <>
                <p className="text-[12px] text-amber-800 mt-1.5">
                  Ваши задачи в заказе есть — {foreignOrder.mineHere.length} шт.
                  {foreignOrder.waitingFor.length > 0
                    ? ` Не отмечены этапы до вас: ${foreignOrder.waitingFor.map(stageLabel).join(', ')}.`
                    : ''}
                </p>
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {/* Закрыть заказ целиком сервер разрешает только упаковщику и владельцу —
                      остальным кнопка обещала бы то, чего не сделает. */}
                  {canCloseWhole && (
                    <button
                      onClick={() => confirmDone === foreignOrder.id
                        ? completeOrder(foreignOrder.id)
                        : setConfirmDone(foreignOrder.id)}
                      className={`px-3.5 py-2.5 rounded-lg text-[12px] font-semibold ${
                        confirmDone === foreignOrder.id
                          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                          : 'bg-[#111110] text-white hover:bg-black'}`}>
                      {confirmDone === foreignOrder.id ? 'Точно всё? Нажмите ещё раз' : 'Всё готово'}
                    </button>
                  )}
                  <a href={`/production-app/orders/${foreignOrder.id}`}
                    className="px-3.5 py-2.5 rounded-lg border border-[#111110] text-[#111110] text-[12px] font-semibold hover:bg-[#f0f0ec]">
                    Открыть по деталям
                  </a>
                </div>
                <p className="text-[11px] text-amber-700 mt-2">
                  {canCloseWhole
                    ? '«Всё готово» закроет заказ целиком: упаковано — значит все предыдущие станции пройдены.'
                    : 'Свой этап отметьте по деталям. Заказ целиком закрывает упаковщик.'}
                </p>
              </>
            ) : (
              <>
                <p className="text-[12px] text-amber-800 mt-1.5">
                  Заказ есть, но задач вашей станции в нём нет — при просчёте не отметили
                  {myStations.includes('drilling') ? ' отверстия или вырезы' : ' эту обработку'}.
                </p>
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {myStations.map(st => (
                    <button key={st} onClick={() => addMyStage(foreignOrder.id, st)} disabled={addingStage}
                      className="px-3.5 py-2.5 rounded-lg bg-[#111110] text-white text-[12px] font-semibold hover:bg-black disabled:opacity-40">
                      {addingStage ? '…' : `Добавить: ${stageLabel(st)}`}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-amber-700 mt-2">
                  Добавится по всем изделиям заказа. Скажите менеджеру — в следующий раз отметит при просчёте.
                </p>
              </>
            )}
          </div>
        )}

        {/* Табло мастера: изделия за сегодня и за неделю */}
        {myStations.length > 0 && (
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-[#9a9a95]">Сегодня · изделий</p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-[22px] font-bold text-[#111110]">{donePiecesToday}</span>
                <span className="text-[13px] text-[#9a9a95]">из {planToday}</span>
                {pctToday != null && <span className={`text-[13px] font-semibold ${pctToday >= 100 ? 'text-emerald-700' : pctToday >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{pctToday}%</span>}
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-[#f0f0ee] overflow-hidden">
                <div className={`h-full rounded-full ${pctToday != null && pctToday >= 100 ? 'bg-emerald-500' : 'bg-[#111110]'}`} style={{ width: `${Math.min(pctToday ?? 0, 100)}%` }} />
              </div>
            </div>
            <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-[#9a9a95]">Неделя · изделий</p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-[22px] font-bold text-[#111110]">{donePiecesWeek}</span>
                <span className="text-[13px] text-[#9a9a95]">из {planWeek}</span>
                {pctWeek != null && <span className={`text-[13px] font-semibold ${pctWeek >= 100 ? 'text-emerald-700' : pctWeek >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{pctWeek}%</span>}
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-[#f0f0ee] overflow-hidden">
                <div className={`h-full rounded-full ${pctWeek != null && pctWeek >= 100 ? 'bg-emerald-500' : 'bg-[#111110]'}`} style={{ width: `${Math.min(pctWeek ?? 0, 100)}%` }} />
              </div>
              {leftPiecesWeek > 0 && (
                <p className="mt-1.5 text-[11px] text-[#6b6b66]">
                  к отгрузкам недели осталось <b>{leftPiecesWeek} изд.</b> · ≈{Math.ceil(leftPiecesWeek / Math.max(1, 7 - ((todayIso.getDay() + 6) % 7)))} в день
                </p>
              )}
            </div>
          </div>
        )}

        {/* Переключатель вида очереди: по срокам / по материалу и толщине (для резчика) */}
        <div className="flex gap-1.5 mb-4">
          <button onClick={() => setGroupMode('time')}
            className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${groupMode === 'time' ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110]'}`}>
            📅 По срокам
          </button>
          <button onClick={() => setGroupMode('material')}
            className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${groupMode === 'material' ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110]'}`}>
            🪟 По материалу и толщине
          </button>
        </div>

        {/* Фильтр типа материала — только в режиме резчика */}
        {groupMode === 'material' && (
          <div className="flex gap-1.5 mb-4 -mt-2">
            {([['all', 'Все'], ['glass', 'Стекло'], ['mirror', 'Зеркало']] as const).map(([k, lbl]) => (
              <button key={k} onClick={() => setMatFilter(k)}
                className={`px-3 py-1 rounded-full text-[12px] font-medium border transition-colors ${matFilter === k ? 'bg-[#6b6b66] text-white border-[#6b6b66]' : 'bg-white text-[#9a9a95] border-[#e4e4e0] hover:border-[#6b6b66] hover:text-[#6b6b66]'}`}>
                {lbl}
              </button>
            ))}
          </div>
        )}

        {/* Ошибка загрузки — отдельно и сверху: прежний список (если был) остаётся под ней. */}
        {emptyState === 'error' && (
          <div className="bg-red-50 rounded-xl border border-red-200 p-5 mb-4 text-center">
            <p className="text-[14px] font-semibold text-red-800">Не загрузилось: {loadError}</p>
            <button onClick={() => void load()}
              className="mt-3 px-5 py-3 rounded-lg bg-[#111110] text-white text-[14px] font-semibold">
              Повторить
            </button>
          </div>
        )}

        {emptyState !== 'error' && byOrder.size === 0 && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-6 text-center">
            {q ? (
              <p className="text-[13px] text-[#9a9a95]">По запросу «{search}» ничего не найдено</p>
            ) : emptyState === 'no-station' ? (
              <>
                <p className="text-[15px] font-semibold text-[#111110]">
                  {viewMaster ? `У ${viewMaster.name} не назначена станция` : 'Станция не назначена — скажите владельцу'}
                </p>
                <p className="text-[12px] text-[#6b6b66] mt-1">
                  Очередь собирается по станциям из профиля. Пока станции нет, сюда ничего не придёт.
                </p>
                {(myRole === 'admin' || myRole === 'ceo') && (
                  <Link href="/production-app/activity" className="inline-block mt-3 text-[13px] text-blue-600 underline underline-offset-2">
                    Состав цеха и ссылка для входа →
                  </Link>
                )}
              </>
            ) : (
              <p className="text-[13px] text-[#9a9a95]">Нет задач в очереди</p>
            )}
          </div>
        )}

        {groupMode === 'material' && matGroups.map(g => {
          const openG = expandedMat.has(g.key)
          return (
          <div key={g.key} className="mb-2">
            <button
              onClick={() => setExpandedMat(prev => { const n = new Set(prev); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })}
              className={`w-full flex items-baseline justify-between gap-2 bg-white rounded-xl border px-4 py-3 text-left ${openG ? 'border-[#111110] rounded-b-none' : 'border-[#e4e4e0] hover:border-[#111110]'}`}>
              <p className="text-[13px] font-bold text-[#111110]"><span className="text-[#9a9a95] mr-1.5">{openG ? '▾' : '▸'}</span>{g.label}</p>
              <p className="text-[11px] text-[#9a9a95] flex-shrink-0">
                {g.perOrder.size} зак. · {g.details} дет. · <span className="font-semibold text-[#111110]">{g.pieces} изд.</span>
                {/* прикидка листов: jumbo 3210×2250, полезный выход раскроя ~85% */}
                {g.areaM2 > 0 && ` · ${Math.round(g.areaM2 * 10) / 10} м² · ≈${Math.max(1, Math.ceil(g.areaM2 / (3.21 * 2.25 * 0.85)))} лист.`}
              </p>
            </button>
            {openG && (
            <div className="bg-white rounded-b-xl border border-t-0 border-[#111110] overflow-hidden">
              {pointsFirst([...g.perOrder.entries()].sort((a, b) => rankOrder(a[0]) - rankOrder(b[0])), ([oid]) => isPointOrder(oid))
                .map(([oid, cnt]) => {
                  const o = orders.get(oid)
                  const launched = launchedOf(o?.notes)
                  const deadline = deadlineOf(o?.notes)
                  const daysLbl = daysLeftLabel(deadline)
                  const overdue = daysLbl?.includes('роср')
                  return (
                    <Link key={oid} href={`/p/o/${oid}`} className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-[#f8f8f7] last:border-0 hover:bg-[#fafaf9]">
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold text-[#111110] truncate">
                          {isUrgent(o?.notes) && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white mr-1.5">🔥 СРОЧНО</span>}
                          {isPointOrder(oid) && <PointBadge className="mr-1.5" />}
                          {orderNo(o, oid)}
                        </p>
                        <p className="text-[11px] text-[#6b6b66] truncate">{o?.client_name}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[12px] font-mono text-[#111110]">{cnt.details} дет. · {cnt.pieces} изд.</p>
                        <p className="text-[11px] flex gap-x-2 justify-end">
                          {fmtShort(launched) && <span className="text-[#9a9a95]">запуск {fmtShort(launched)}</span>}
                          {fmtShort(deadline) && <span className={overdue ? 'text-red-700 font-semibold' : 'text-[#9a9a95]'}>отгрузка {fmtShort(deadline)}</span>}
                        </p>
                      </div>
                    </Link>
                  )
                })}
            </div>
            )}
          </div>
        )})}

        {groupMode === 'time' && HORIZONS.map(h => groups[h.key].length > 0 && (
          <div key={h.key} className="mb-5">
            <p className={`text-[11px] font-semibold uppercase tracking-widest mb-2 ${h.cls}`}>
              {h.label} · {groups[h.key].length}
            </p>
            <div className="space-y-2">
              {groups[h.key].map(id => (
                <OrderCard key={id}
                  order={orders.get(id)} orderId={id} point={isPointOrder(id)}
                  tasks={byOrder.get(id) ?? []}
                  blockers={blockers}
                  open={isOpen(id)}
                  onToggle={() => toggleOrder(id)}
                  isReady={isReady}
                  canCloseOrder={canCloseOrder}
                  onCompleteMyStage={completeMyStage}
                  confirmingStation={confirmMine?.startsWith(`${id}:`) ? confirmMine.slice(`${id}:`.length) : null}
                  onAskConfirmMine={(st: string | null) => setConfirmMine(st && confirmMine !== `${id}:${st}` ? `${id}:${st}` : null)}
                  routes={routes}
                  myStations={myStations}
                  onCompleteItem={completeItem}
                  onStart={markStart}
                  onStartAll={markStartOrder}
                  onDone={markDone}
                  onCompleteOrder={completeOrder}
                  work={orderWork.get(id) ?? null}
                  workLoaded={workLoaded}
                  confirming={confirmDone === id}
                  onAskConfirm={() => setConfirmDone(confirmDone === id ? null : id)}
                  onRework={setReworkFor}
                  onNoMatOrder={toggleNoMaterialOrder}
                  onNoMatItem={toggleNoMaterialItem}
                  matReq={matReq}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Лист причин переделки. Кнопки крупные — цех работает с телефона и в перчатках. */}
      {reworkFor != null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center" onClick={() => { setReworkFor(null); setReworkOther('') }}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h2 className="text-[15px] font-bold text-[#111110]">Что случилось?</h2>
            <p className="text-[12px] text-[#9a9a95] mt-1 mb-3">Деталь вернётся в работу, этап переоткроется</p>
            <div className="space-y-2">
              {REWORK_REASONS.filter(r => r.code !== 'other').map(r => (
                <button key={r.code} disabled={reworkBusy} onClick={() => submitRework(r.code)}
                  className="w-full px-4 py-3.5 rounded-xl border border-[#e4e4e0] text-[15px] font-medium text-[#111110] text-left active:scale-[0.99] hover:border-red-300 hover:bg-red-50 disabled:opacity-50">
                  {r.label}
                </button>
              ))}
              {/* «Другое» со свободным текстом. Один лишний шаг только здесь — четыре
                  частые причины остаются в один тап, а редкую цех опишет словами. */}
              <div className="rounded-xl border border-[#e4e4e0] p-3">
                <p className="text-[15px] font-medium text-[#111110] mb-2">Другое — своими словами</p>
                <input value={reworkOther} onChange={e => setReworkOther(e.target.value)}
                  placeholder="Что случилось?" enterKeyHint="send"
                  onKeyDown={e => { if (e.key === 'Enter' && reworkOther.trim()) submitRework('other', reworkOther) }}
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2.5 text-[15px] outline-none focus:border-[#111110]" />
                <button disabled={reworkBusy || !reworkOther.trim()} onClick={() => submitRework('other', reworkOther)}
                  className="w-full mt-2 py-2.5 rounded-lg bg-red-600 text-white text-[14px] font-medium disabled:opacity-40">
                  Переделать
                </button>
              </div>
            </div>
            <button onClick={() => { setReworkFor(null); setReworkOther('') }} className="w-full mt-3 py-2.5 rounded-lg text-[13px] font-medium text-[#9a9a95]">Отмена</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Карточка заказа: раскрывается на месте, внутри детали и чертёж ───────────

function OrderCard({ order, orderId, point, tasks, blockers, open, onToggle, isReady, canCloseOrder, onCompleteMyStage, confirmingStation, onAskConfirmMine, routes, myStations, onCompleteItem, onStart, onStartAll, onDone, onCompleteOrder, work, workLoaded, confirming, onAskConfirm, onRework, onNoMatOrder, onNoMatItem, matReq }: {
  order: OrderLite | undefined
  orderId: number
  point: boolean
  tasks: TaskRow[]
  blockers: Map<number, BlockerLite>
  open: boolean
  onToggle: () => void
  isReady: (t: TaskRow) => boolean
  canCloseOrder: boolean
  onCompleteMyStage: (orderId: number, station: string) => void
  confirmingStation: string | null
  onAskConfirmMine: (station: string | null) => void
  routes: Map<string, RouteStage[]>
  myStations: string[]
  onCompleteItem: (orderId: number, itemIndex: number) => void
  onStart: (id: number) => void
  onStartAll: (ids: number[]) => void
  onDone: (id: number) => void
  onCompleteOrder: (orderId: number) => void
  work: { station: string; n: number }[] | null
  workLoaded: boolean
  confirming: boolean
  onAskConfirm: () => void
  onRework: (id: number) => void
  onNoMatOrder: (orderId: number) => void
  onNoMatItem: (orderId: number, itemIndex: number) => void
  matReq: Map<string, { status: string; expected: string | null }>
}) {
  const notes = order?.notes
  const urgent = isUrgent(notes)
  const deadline = deadlineOf(notes)
  const launched = launchedOf(notes)
  const daysLbl = daysLeftLabel(deadline)
  const pn = parseNotes(notes)
  const drawingUrl = (pn.drawing_url as string | undefined) ?? null
  const isImg = drawingUrl ? /\.(png|jpe?g|webp|gif)(\?|$)/i.test(drawingUrl) : false
  const orderMat = shopMaterial(pn.material_status, matReq.get(`${orderId}:all`))
  const noMatOrder = orderMat != null
  const noMatItems = Array.isArray(pn.material_needed_items) ? (pn.material_needed_items as number[]) : []
  const itemMat = (idx: number): ShopMaterial | null => noMatItems.includes(idx)
    ? shopMaterial('needed', matReq.get(`${orderId}:${idx}`) ?? matReq.get(`${orderId}:all`))
    : orderMat
  // В поиске в карточку попадают и закрытые задачи — их показываем отдельной
  // строкой «уже сделано», а в счётчиках работы они не участвуют.
  const doneTasks = tasks.filter(t => t.status === 'done')
  const live = tasks.filter(t => t.status !== 'done' && t.status !== 'problem')
  // Мои открытые с учётом проблемных: «Всё готово» на сервере закрывает и их,
  // и заказ, где осталась только проблема, кнопку терять не должен.
  const myOpen = tasks.filter(t => t.status !== 'done')
  // Мои станции в этом заказе — по кнопке на каждую, в порядке маршрута. Очередь уже
  // показывает только мои задачи, поэтому счётчик совпадает с тем, что закроет сервер.
  const myGroups: StationGroup[] = myStationGroups(
    myOpen.map(t => ({ ...t, started_at: null, assigned_to: null, started_by: null })) as StationTask[],
    myStations)
  // Сколько закроется на самом деле: сервер закрывает ЗАКАЗ, а не мою долю в нём.
  const orderOpen = work ? work.reduce((s, w) => s + w.n, 0) : myOpen.length
  const emptyReason = explainEmptyQueue({ myOpen: myOpen.length, workLoaded, orderOpen })
  const ready = live.filter(isReady)
  const inWork = live.filter(t => t.status === 'in_progress').length
  // Деталь ≠ задача: у мастера с двумя станциями (закалка+упаковка) на одну
  // стекляшку приходится две задачи. Считаем детали по уникальному item_index,
  // иначе карточка пишет «4 дет.» там, где деталей две (как в режиме «По материалу»).
  const liveItems = [...new Set(live.map(t => t.item_index))]
  const pieces = liveItems.reduce((s, i) => s + qtyOf(order, i), 0)
  const startable = ready.filter(t => t.status === 'queued').map(t => t.id)
  const overdue = daysLbl?.includes('роср')
  const border = urgent || overdue ? 'border-red-300' : open ? 'border-[#111110]' : 'border-[#e4e4e0]'

  return (
    <div className={`rounded-xl border bg-white ${border}`}>
      {/* Шапка — div, не button: внутри живут кнопки-действия (вложенные button невалидны) */}
      <div onClick={onToggle} className="w-full text-left px-4 py-3 cursor-pointer">
        <div className="flex items-center justify-between gap-x-3 gap-y-1.5 flex-wrap">
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-[#111110] truncate flex items-center gap-1.5">
              <span className="text-[#9a9a95]">{open ? '▾' : '▸'}</span>
              {urgent && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white">🔥 СРОЧНО</span>}
              {point && <PointBadge />}
              {orderNo(order, orderId)}
              {drawingUrl && <span title="Есть чертёж">📐</span>}
              {orderMat && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${MAT_TONE[orderMat.state]}`}>{shopMaterialLabel(orderMat)}</span>}
              {!noMatOrder && noMatItems.length > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">🛒 нет мат. на {noMatItems.length} поз.</span>}
            </p>
            <p className="text-[12px] text-[#6b6b66] truncate">{order?.client_name}</p>
          </div>
          {/* Быстрые действия по заказу — доступны со свёрнутой карточки */}
          {!open && (
            <div className="flex items-center gap-1.5 flex-wrap ml-auto" onClick={e => e.stopPropagation()}>
              {startable.length > 0 && (
                <button onClick={() => onStartAll(startable)} title="Взял весь заказ в работу"
                  className="px-3 py-2 rounded-lg border border-emerald-300 text-emerald-700 text-[12px] font-medium hover:bg-emerald-50">
                  Взял весь ({startable.length})
                </button>
              )}
              {myOpen.length > 0 && (
                confirming ? (
                  <span className="flex items-center gap-1.5">
                    <button onClick={() => onCompleteOrder(orderId)}
                      className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-[12px] font-bold hover:opacity-90">
                      Да, закрыть {orderOpen}
                    </button>
                    <button onClick={onAskConfirm}
                      className="px-2.5 py-2 rounded-lg border border-[#e4e4e0] text-[#6b6b66] text-[12px]">Отмена</button>
                  </span>
                ) : canCloseOrder ? (
                  <button onClick={onAskConfirm} title="Закрыть все этапы всех деталей заказа"
                    className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-[12px] font-medium hover:opacity-90">
                    ✅ Всё готово ({orderOpen})
                  </button>
                ) : null
              )}
              {/* Свой этап по всему заказу — для тех, кто НЕ на упаковке. Закрывает
                  только мои станции: заказ целиком закрывает упаковщик. */}
              {!canCloseOrder && myGroups.map(g => (
                confirmingStation === g.station ? (
                  <span key={g.station} className="flex items-center gap-1.5">
                    <button onClick={() => onCompleteMyStage(orderId, g.station)}
                      className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-[12px] font-bold hover:opacity-90">
                      Да, закрыть: {stageLabel(g.station)} — {g.count}
                    </button>
                    <button onClick={() => onAskConfirmMine(null)}
                      className="px-2.5 py-2 rounded-lg border border-[#e4e4e0] text-[#6b6b66] text-[12px]">Отмена</button>
                  </span>
                ) : (
                  <button key={g.station} onClick={() => onAskConfirmMine(g.station)}
                    title={`Отметить «${stageLabel(g.station)}» по всем деталям заказа. Другие ваши этапы останутся открытыми.`}
                    className="px-3 py-2 rounded-lg border border-emerald-600 text-emerald-700 text-[12px] font-medium hover:bg-emerald-50">
                    ✅ Готово: {stageLabel(g.station)} ({g.count})
                  </button>
                )
              ))}
              <button onClick={() => onNoMatOrder(orderId)} title={noMatOrder ? 'Материал пришёл' : 'Нет материала на весь заказ'}
                className={`px-3 py-2 rounded-lg text-[12px] font-medium border ${noMatOrder ? 'bg-[#111110] text-white border-[#111110]' : 'border-red-200 text-red-600 hover:bg-red-50'}`}>
                {noMatOrder ? '✅ Пришёл' : '🛒 Нет мат.'}
              </button>
            </div>
          )}
          <div className="text-right flex-shrink-0">
            <p className="text-[12px] font-mono text-[#111110]">
              {liveItems.length} дет. · {pieces} изд.{live.length !== liveItems.length ? ` · ${live.length} задач` : ''}{inWork > 0 ? ` · 🔧 ${inWork}` : ''}
              {doneTasks.length > 0 && <span className="text-emerald-700"> · ✓ {doneTasks.length} сделано</span>}
            </p>
            <p className="text-[11px] flex gap-x-2 justify-end flex-wrap">
              {fmtShort(launched) && <span className="text-[#9a9a95]">запуск {fmtShort(launched)}</span>}
              {fmtShort(deadline) && <span className="text-[#9a9a95]">отгрузка {fmtShort(deadline)}</span>}
              {daysLbl && <span className={urgent || overdue ? 'text-red-700 font-semibold' : 'text-[#6b6b66]'}>{daysLbl}</span>}
            </p>
          </div>
        </div>
      </div>

      {open && (
        <div className="border-t border-[#f0f0ee] px-4 py-3 space-y-3">

          {/* Пустая карточка обязана объяснить себя. Владелец нашёл заказ по поиску,
              увидел «0 дет. · ✓ 2 сделано» и написал «изменений не вижу» — код отработал
              верно, а карточка молчала. Рабочий в такой ситуации решит, что заказ потерялся,
              и пойдёт искать обходной путь: Никита так и нашёл «Открыть карточку заказа».
              Ничего не выдумываем: пока состав работы по заказу не загружен, говорим только
              то, что знаем наверняка. */}
          {emptyReason && (
            emptyReason === 'unknown' ? (
              <p className="text-[13px] text-[#6b6b66]">По этому заказу у тебя нет открытых задач.</p>
            ) : emptyReason === 'order-done' ? (
              <p className="text-[13px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                ✅ Заказ готов — все этапы всех деталей закрыты.
                {doneTasks.length > 0 && <span className="text-[#6b6b66]"> Твоих отметок здесь {doneTasks.length}.</span>}
              </p>
            ) : (
              <div className="text-[13px] text-[#111110] bg-[#f5f5f3] border border-[#e4e4e0] rounded-lg px-3 py-2">
                <p>Заказ в работе, но не на твоей станции — по нему у тебя открытых задач нет.</p>
                <p className="text-[12px] text-[#6b6b66] mt-1">
                  Сейчас открыто: {work!.map(w => `${stageLabel(w.station)} — ${w.n}`).join(' · ')}
                </p>
                {doneTasks.length > 0 && (
                  <p className="text-[12px] text-[#6b6b66] mt-0.5">Твоих отметок по нему {doneTasks.length}.</p>
                )}
              </div>
            )
          )}

          {/* Чертёж заказа (прикрепляется менеджером или в «Заказах»);
              bucket приватный — грузим через прокси с подписанной ссылкой */}
          {drawingUrl && (
            <a href={`/api/b2b/drawing/${orderId}`} target="_blank" rel="noreferrer" className="block">
              {isImg
                ? <img src={`/api/b2b/drawing/${orderId}`} alt="Чертёж" className="max-h-56 rounded-lg border border-[#e4e4e0] object-contain" />
                : <span className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#e4e4e0] text-[13px] text-[#111110] hover:border-[#111110]">📐 Открыть чертёж (PDF)</span>}
            </a>
          )}

          {/* П9: наклейки нужны там, где режут, а не через карточку заказа.
              Резчик клеит их сразу после реза — путь до них должен быть в один тап. */}
          <Link href={`/production-app/orders/${orderId}/labels`}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#e4e4e0] text-[13px] text-[#111110] hover:border-[#111110]">
            🏷 Наклейки и маршрутный лист
          </Link>

          {startable.length > 1 && (
            <button onClick={() => onStartAll(startable)}
              className="w-full py-2 rounded-lg border border-emerald-300 text-emerald-700 text-[13px] font-medium hover:bg-emerald-50">
              Взял весь заказ в работу ({startable.length} задач)
            </button>
          )}

          {/* Действия по всему заказу. В режиме подтверждения строка отдана ТОЛЬКО ему:
              на 375 px три кнопки в ряд сжимались до ~110 px, ломались на 2–3 строки, и
              «Да, закрыть» оказывалась вплотную к «Нет материала» — целясь в одну, попадёшь
              в другую. Кнопка материала возвращается, как только подтверждение снято. */}
          {myOpen.length > 0 && confirming && (
            <div className="flex gap-2">
              <button onClick={() => onCompleteOrder(orderId)}
                className="flex-1 py-3 rounded-lg bg-emerald-600 text-white text-[14px] font-bold">
                Да, закрыть {orderOpen} задач
              </button>
              <button onClick={onAskConfirm}
                className="px-5 py-3 rounded-lg border border-[#e4e4e0] text-[#6b6b66] text-[14px]">Отмена</button>
            </div>
          )}

          <div className={`flex gap-2 ${confirming ? 'hidden' : ''}`}>
            {canCloseOrder && myOpen.length > 0 && (
              <button onClick={onAskConfirm}
                className="flex-1 py-3 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold">
                ✅ Всё готово ({orderOpen} задач)
              </button>
            )}
            {!canCloseOrder && myGroups.map(g => (
              <button key={g.station} onClick={() => onCompleteMyStage(orderId, g.station)}
                title={`Отметить «${stageLabel(g.station)}» по всем деталям заказа. Другие ваши этапы останутся открытыми.`}
                className="flex-1 py-3 rounded-lg border border-emerald-600 text-emerald-700 text-[13px] font-semibold">
                ✅ Готово: {stageLabel(g.station)} ({g.count})
              </button>
            ))}
            <button onClick={() => onNoMatOrder(orderId)}
              className={`flex-1 py-2 rounded-lg text-[13px] font-semibold border ${noMatOrder ? 'bg-[#111110] text-white border-[#111110]' : 'border-red-200 text-red-600 hover:bg-red-50'}`}>
              {noMatOrder ? '✅ Материал пришёл' : '🛒 Нет материала на весь заказ'}
            </button>
          </div>

          {/* Одна карточка = ОДНА ДЕТАЛЬ, внутри её этапы. Раньше карточка была
              на задачу, и у мастера с двумя станциями одна стекляшка выглядела
              как два разных изделия. */}
          <div className="space-y-1.5">
            {liveItems.map(idx => {
              const itemTasks = live.filter(t => t.item_index === idx).sort((a, b) => a.sequence_order - b.sequence_order)
              const anyActive = itemTasks.some(t => t.status === 'in_progress')
              const noMat = noMatOrder || noMatItems.includes(idx)
              return (
                <div key={idx} className={`rounded-lg border px-3 py-2 ${noMat ? 'border-red-200 bg-red-50/50' : anyActive ? 'border-emerald-300 bg-emerald-50/40' : 'border-[#eceff1]'}`}>
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-[12px] font-mono text-[#111110]">{specLine(order?.items?.[idx]) || `Поз. ${idx + 1}`}</p>
                      {(() => {
                        const it = order?.items?.[idx]
                        const feats = featureLine(it)
                        const cmt = it?.comment?.trim()
                        if (!feats && !cmt) return null
                        return (
                          <p className="text-[11px] text-[#6b6b66] mt-0.5">
                            {feats && <span className="text-violet-700">{feats}</span>}
                            {feats && cmt ? ' · ' : ''}
                            {cmt}
                          </p>
                        )
                      })()}
                      <p className={`text-[11px] ${noMat ? 'text-red-700' : 'text-[#6b6b66]'}`}>
                        Поз. {idx + 1}
                        {noMat && (() => { const m = itemMat(idx); return m ? ` · ${shopMaterialLabel(m)}` : '' })()}
                      </p>
                    </div>
                    <button onClick={() => onNoMatItem(orderId, idx)} title={noMatItems.includes(idx) ? 'Материал пришёл' : 'Нет материала на эту деталь'}
                      className={`px-2.5 py-1.5 rounded-lg text-[12px] font-medium border flex-shrink-0 ${noMatItems.includes(idx) ? 'bg-[#111110] text-white border-[#111110]' : 'border-amber-300 text-amber-700 hover:bg-amber-50'}`}>
                      {noMatItems.includes(idx) ? 'Мат. есть' : 'Нет мат.'}
                    </button>
                  </div>

                  {/* Весь путь изделия, включая чужие станции: рабочий должен видеть,
                      где деталь была и куда пойдёт, а не только свой этап. */}
                  {(() => {
                    const route = routes.get(`${orderId}:${idx}`) ?? []
                    if (route.length === 0) return null
                    return (
                      <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1">
                        {route.map((r, i) => {
                          const done = r.status === 'done'
                          const mine = myStations.includes(r.station)
                          const cls = done
                            ? (r.auto_closed ? 'bg-[#f0f0ee] text-[#9a9a95] line-through' : 'bg-emerald-50 text-emerald-700')
                            : r.status === 'in_progress' ? 'bg-amber-50 text-amber-700'
                            : 'bg-white text-[#9a9a95] border border-[#e4e4e0]'
                          return (
                            <span key={i} className="flex items-center gap-1">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap ${cls} ${mine ? 'font-semibold' : ''}`}
                                title={done ? (r.auto_closed ? 'Закрыт автоматически — никто не отмечал' : `Отметил: ${r.completed_by_name ?? '—'}`) : 'Ещё не отмечен'}>
                                {done ? '✓ ' : ''}{stageLabel(r.stage_key)}
                              </span>
                              {i < route.length - 1 && <span className="text-[9px] text-[#d4d4d0]">→</span>}
                            </span>
                          )
                        })}
                      </div>
                    )
                  })()}

                  {/* Этапы этой детали. Заблокированные тоже с кнопкой: если предыдущий
                      мастер не отметил, это не значит, что он не сделал работу, — и
                      следующий не должен из-за этого стоять. Сервер при отметке сам
                      закроет пропущенные этапы как auto_closed, никому их не приписав. */}
                  <div className="mt-2 space-y-1">
                    {itemTasks.map(t => {
                      const active = t.status === 'in_progress'
                      const ready  = isReady(t)
                      const blocker = !ready && t.blocked_by_task_id ? blockers.get(t.blocked_by_task_id) : null
                      return (
                        <div key={t.id} className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-[11px] text-[#111110]">
                            {STAGE_LABELS[t.stage_key as DetailStageKey] ?? t.stage_key}
                            {t.layer_note ? ` · ${t.layer_note}` : ''}{active ? ' · 🔧 в работе' : ''}
                            {!ready && (
                              <span className="ml-1.5 text-[10px] text-amber-700"
                                title="Предыдущий этап никто не отметил. Если работа сделана — отмечай свой, он закроется сам.">
                                · не отмечен: {blocker ? stageLabel(blocker.stage_key) : 'предыдущий этап'}
                              </span>
                            )}
                            {(t.rework_count ?? 0) > 0 && (
                              <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-600"
                                title="Этот этап уже переделывали">
                                переделка{(t.rework_count ?? 0) > 1 ? ` ×${t.rework_count}` : ''}
                              </span>
                            )}
                          </span>
                          <div className="flex gap-1.5 flex-shrink-0">
                            {/* Высота под палец: было py-1 — 28 px, а это самая нажимаемая
                                кнопка во всём цеху, и жмут её с телефона, часто в перчатке.
                                Ширины хватает и так, растёт только высота. */}
                            {!active && <button onClick={() => onStart(t.id)} className="px-2.5 py-2.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66] text-[12px] font-medium hover:border-[#111110] hover:text-[#111110]">Взял</button>}
                            <button onClick={() => onDone(t.id)}
                              title={ready ? 'Этап сделан' : 'Отметить свой этап, даже если предыдущий никто не отметил'}
                              className={`px-3.5 py-2.5 rounded-lg text-[12px] font-medium ${ready ? 'bg-emerald-600 text-white' : 'border border-emerald-600 text-emerald-700'}`}>Готово</button>
                            <button onClick={() => onRework(t.id)} title="Брак — деталь надо изготовить заново"
                              className="px-2.5 py-2.5 rounded-lg border border-red-200 text-red-600 text-[12px] font-medium">Переделать</button>
                          </div>
                        </div>
                      )
                    })}
                    {/* Одно нажатие закрывает деталь целиком, включая этапы ПОСЛЕ моей
                        станции. Без него мастер с двумя станциями жмёт «Готово» дважды:
                        каскад закрывает только предыдущие этапы. */}
                    {(() => {
                      // Счётчик — по ВСЕМУ маршруту детали, а не по моим задачам:
                      // закроется вся деталь, включая чужие станции. Кнопка,
                      // обещающая меньше, чем делает, у нас уже была.
                      const route = routes.get(`${orderId}:${idx}`) ?? []
                      const openAll = route.filter(r => r.status !== 'done').length
                      // Только если после моего первого открытого этапа идут одни мои станции
                      // (закалка → упаковка). У резчика-полировщика дальше чужие станции —
                      // кнопка закрыла бы за них закалку и упаковку.
                      if (!canCompleteWholeDetail(route, myStations)) return null
                      return (
                        <button onClick={() => onCompleteItem(orderId, idx)}
                          className="mt-1.5 w-full py-2.5 rounded-lg border border-emerald-600 text-emerald-700 text-[12px] font-semibold hover:bg-emerald-50">
                          ✅ Готово всё по детали ({stageCountLabel(openAll)})
                        </button>
                      )
                    })()}
                  </div>
                </div>
              )
            })}
          </div>

          <Link href={`/p/o/${orderId}`} className="inline-block text-[12px] text-[#9a9a95] underline underline-offset-2">
            Открыть карточку заказа →
          </Link>
        </div>
      )}
    </div>
  )
}
