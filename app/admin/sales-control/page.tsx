'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'

// «Сейчас» — живая воронка и списки зависших сделок из amo (их нет в снимках),
// без звонков и сообщений. Остальные периоды — снимки дня, как на «Команде».
type Period = 'today' | 'yesterday' | 'week' | 'month' | 'year'

type StaleInfoItem = {
  id: number
  name: string
  daysStale: number
  stageName: string
}

type ManagerStat = {
  id: number
  name: string
  newLeads: number | null
  callsMade: number | null
  messagesSent: number | null
  cardsMoved: number | null
  activeLeads: number
  zone1: number
  zone2: number
  zone3: number
  staleZone1: number
  staleZone2: number
  staleZone3: number
  invoiceStale: number
  days?: number
  staleZone1Deals?: StaleInfoItem[]
  staleZone2Deals?: StaleInfoItem[]
  staleZone3Deals?: StaleInfoItem[]
  invoiceStaleDeals?: StaleInfoItem[]
}

type StatsData = {
  period: Period
  live?: boolean
  domain?: string
  managers: ManagerStat[]
  noData?: boolean
  label?: string
  firstSnapshot?: string | null
  stateDate?: string | null
  errors?: string[]
}

type DrawerTab = 'overview' | 'stale1' | 'stale2' | 'stale3' | 'longstale'

// Safe mapper: handles both camelCase (today) and snake_case (historical) shapes
function normalise(raw: Record<string, unknown>): ManagerStat {
  const n = (key1: string, key2: string): number =>
    Number((raw[key1] ?? raw[key2]) ?? 0)
  const na = (key: string): number | null => (raw[key] == null ? null : Number(raw[key]))
  const arr = (key: string): StaleInfoItem[] | undefined => {
    const v = raw[key]
    return Array.isArray(v) ? (v as StaleInfoItem[]) : undefined
  }
  return {
    id:           Number(raw.id ?? 0),
    name:         String(raw.name ?? ''),
    newLeads:     na('newLeads'),
    callsMade:    na('callsMade'),
    messagesSent: na('messagesSent'),
    cardsMoved:   na('cardsMoved'),
    activeLeads:  n('activeLeads',  'active_leads'),
    zone1:        n('zone1',        'zone1'),
    zone2:        n('zone2',        'zone2'),
    zone3:        n('zone3',        'zone3'),
    staleZone1:   n('staleZone1',   'stale_zone1'),
    staleZone2:   n('staleZone2',   'stale_zone2'),
    staleZone3:   n('staleZone3',   'stale_zone3'),
    invoiceStale: n('invoiceStale', 'invoice_stale'),
    days:         raw.days !== undefined ? Number(raw.days) : undefined,
    staleZone1Deals:   arr('staleZone1Deals'),
    staleZone2Deals:   arr('staleZone2Deals'),
    staleZone3Deals:   arr('staleZone3Deals'),
    invoiceStaleDeals: arr('invoiceStaleDeals'),
  }
}

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Сейчас',
  yesterday: 'Последний день',
  week:  'Неделя',
  month: 'Месяц',
  year:  'Год',
}

const DRAWER_TABS: { id: DrawerTab; label: string }[] = [
  { id: 'overview',  label: 'Обзор'           },
  { id: 'stale1',    label: 'Без касания'      },
  { id: 'stale2',    label: 'Продажа >3д'      },
  { id: 'stale3',    label: 'Производство >3д' },
  { id: 'longstale', label: 'Долгострой'       },
]

function redFlags(m: ManagerStat, period: Period): number {
  let n = 0
  if (period === 'yesterday' && m.callsMade === 0 && m.messagesSent === 0 && m.activeLeads > 0) n++
  if (m.staleZone1 > 0) n++
  if (m.staleZone2 > 0) n++
  if (m.invoiceStale > 0) n++
  return n
}

function numColor(val: number | null, green: number, orange: number): string {
  if (val == null)   return 'text-[#c4c4be]'
  if (val >= green)  return 'text-green-600 font-semibold'
  if (val >= orange) return 'text-orange-500 font-semibold'
  return val === 0 ? 'text-[#c4c4be]' : 'text-red-500 font-semibold'
}

function Badge({ n, color }: { n: number; color: string }) {
  if (n === 0) return <span className="text-[#c4c4be]">—</span>
  return (
    <span className={`inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded ${color}`}>
      {n}
    </span>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#9a9a95] whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function Td({ children, right, className = '' }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return (
    <td className={`px-3 py-2.5 text-[13px] ${right ? 'text-right' : 'text-left'} ${className}`}>
      {children}
    </td>
  )
}

function SkeletonRow() {
  return (
    <tr className="border-b border-[#f0f0ec]">
      {Array.from({ length: 14 }).map((_, i) => (
        <td key={i} className="px-3 py-2.5">
          <div className="h-4 bg-[#f0f0ec] rounded animate-pulse" style={{ width: i === 0 ? 80 : 32 }} />
        </td>
      ))}
    </tr>
  )
}

// ── Drawer stale list ─────────────────────────────────────────────────────────

function DrawerStaleList({
  deals,
  domain,
  emptyText,
  badgeColor,
  noDetailNote,
}: {
  deals?: StaleInfoItem[]
  domain?: string
  emptyText: string
  badgeColor: string
  noDetailNote?: boolean
}) {
  if (noDetailNote || !deals) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
        <p className="text-[13px] font-medium text-[#6b6b66] mb-1">Текущие данные</p>
        <p className="text-[12px] text-[#9a9a95] max-w-[340px]">
          Список сделок — только в режиме «Сейчас» (живой запрос в AmoCRM, до 45 секунд).
        </p>
      </div>
    )
  }

  if (deals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
        <div className="text-2xl mb-2">✅</div>
        <p className="text-[13px] font-medium text-green-700">{emptyText}</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-[#f0f0ec]">
      {deals.map(d => (
        <div key={d.id} className="flex items-center justify-between px-5 py-3 hover:bg-[#fafaf9] transition-colors">
          <div className="min-w-0 flex-1 pr-3">
            {domain ? (
              <a
                href={`https://${domain}/leads/detail/${d.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] font-medium text-[#111110] hover:text-blue-600 transition-colors truncate block"
              >
                {d.name || `Сделка #${d.id}`}
              </a>
            ) : (
              <p className="text-[13px] font-medium text-[#111110] truncate">{d.name || `Сделка #${d.id}`}</p>
            )}
            <p className="text-[11px] text-[#9a9a95] mt-0.5 truncate">{d.stageName}</p>
          </div>
          <span className={`flex-shrink-0 text-[11px] font-bold px-2 py-1 rounded ${badgeColor}`}>
            {d.daysStale}д
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Drawer ────────────────────────────────────────────────────────────────────

function DrawerOverview({ m, period }: { m: ManagerStat; period: Period }) {
  const flags = redFlags(m, period)
  const rows: { label: string; value: React.ReactNode; sub?: string }[] = [
    {
      label: 'Лиды',
      value: <span className={numColor(m.newLeads, 2, 1)}>{m.newLeads ?? '—'}</span>,
    },
    {
      label: 'Сообщения',
      value: <span className={numColor(m.messagesSent, 5, 2)}>{m.messagesSent ?? '—'}</span>,
    },
    {
      label: 'Звонки',
      value: <span className={numColor(m.callsMade, 3, 1)}>{m.callsMade ?? '—'}</span>,
    },
    {
      label: 'Движения карточек',
      value: <span className={numColor(m.cardsMoved, 3, 1)}>{m.cardsMoved ?? '—'}</span>,
    },
    { label: 'Активных сделок', value: <span className="font-semibold text-[#111110]">{m.activeLeads}</span> },
    { label: 'Квалификация (зона 1)', value: <span className="font-semibold text-blue-600">{m.zone1}</span>, sub: 'новые заявки, проработка, прогрев' },
    { label: 'Продажа (зона 2)',      value: <span className="font-semibold text-orange-500">{m.zone2}</span>, sub: 'замер → КП → счёт' },
    { label: 'Оплата / Производство', value: <span className="font-semibold text-green-600">{m.zone3}</span>, sub: 'зона 3' },
  ]

  const problemRows: { label: string; value: React.ReactNode; color: string }[] = [
    { label: 'Без касания',      value: m.staleZone1,   color: m.staleZone1   > 0 ? 'text-red-600 font-semibold' : 'text-[#c4c4be]' },
    { label: 'Продажа >3д',      value: m.staleZone2,   color: m.staleZone2   > 0 ? 'text-orange-600 font-semibold' : 'text-[#c4c4be]' },
    { label: 'Производство >3д', value: m.staleZone3,   color: m.staleZone3   > 0 ? 'text-yellow-600 font-semibold' : 'text-[#c4c4be]' },
    { label: 'Счета >5д',        value: m.invoiceStale, color: m.invoiceStale > 0 ? 'text-red-600 font-semibold' : 'text-[#c4c4be]' },
  ]

  return (
    <div className="px-5 py-4 space-y-4">
      {/* Activity */}
      <div className="bg-[#fafaf9] border border-[#f0f0ec] rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#f0f0ec]">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#9a9a95]">Активность</p>
        </div>
        <div className="divide-y divide-[#f0f0ec]">
          {rows.map(r => (
            <div key={r.label} className="flex items-center justify-between px-4 py-2.5">
              <div>
                <p className="text-[13px] text-[#111110]">{r.label}</p>
                {r.sub && <p className="text-[11px] text-[#9a9a95] mt-0.5">{r.sub}</p>}
              </div>
              <p className="text-[16px] font-mono">{r.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Problems */}
      <div className="bg-[#fafaf9] border border-[#f0f0ec] rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#f0f0ec]">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#9a9a95]">Проблемные зоны</p>
        </div>
        <div className="divide-y divide-[#f0f0ec]">
          {problemRows.map(r => (
            <div key={r.label} className="flex items-center justify-between px-4 py-2.5">
              <p className="text-[13px] text-[#111110]">{r.label}</p>
              <p className={`text-[16px] font-mono ${r.color}`}>{r.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Flags summary */}
      <div className={`rounded-xl px-4 py-3 border ${
        flags > 0 ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100'
      }`}>
        <p className={`text-[13px] font-semibold ${flags > 0 ? 'text-red-700' : 'text-green-700'}`}>
          {flags > 0 ? `🚩 ${flags} красных флага — требует внимания` : '✅ Нет критических флагов'}
        </p>
        {flags > 0 && (
          <p className="text-[12px] text-red-600 mt-1">
            {[
              period === 'yesterday' && m.callsMade === 0 && m.messagesSent === 0 && m.activeLeads > 0 && '0 звонков и 0 сообщений',
              m.staleZone1 > 0 && `${m.staleZone1} лидов без касания`,
              m.staleZone2 > 0 && `${m.staleZone2} сделок без движения >3д`,
              m.invoiceStale > 0 && `${m.invoiceStale} счётов без оплаты >5д`,
            ].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      {m.days !== undefined && (
        <p className="text-[11px] text-[#c4c4be] text-center">
          Данные за {m.days} {m.days === 1 ? 'день' : m.days < 5 ? 'дня' : 'дней'} · агрегированные
        </p>
      )}
    </div>
  )
}

function ManagerDrawer({
  manager,
  period,
  domain,
  onClose,
}: {
  manager: ManagerStat | null
  period: Period
  domain?: string
  onClose: () => void
}) {
  const [tab, setTab] = useState<DrawerTab>('overview')
  const drawerRef = useRef<HTMLDivElement>(null)

  // Reset tab when manager changes
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setTab('overview') }, [manager?.id])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Lock body scroll when open
  useEffect(() => {
    if (manager) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [manager])

  if (!manager) return null

  const firstName = manager.name.split(' ')[0]
  const isToday = period === 'today'

  // Долгострой = lids in stale zone1 stale > 7d OR in Долгострой stage
  const longstaleDeals = manager.staleZone1Deals?.filter(
    d => d.daysStale >= 7 || d.stageName.toLowerCase().includes('долгострой')
  )

  function renderTabContent() {
    if (!manager) return null
    switch (tab) {
      case 'overview':
        return <DrawerOverview m={manager} period={period} />
      case 'stale1':
        return (
          <DrawerStaleList
            deals={manager.staleZone1Deals}
            domain={domain}
            emptyText="Нет лидов без касания"
            badgeColor="bg-red-50 text-red-600"
            noDetailNote={!isToday}
          />
        )
      case 'stale2':
        return (
          <DrawerStaleList
            deals={manager.staleZone2Deals}
            domain={domain}
            emptyText="Нет зависших сделок в зоне 2"
            badgeColor="bg-orange-50 text-orange-600"
            noDetailNote={!isToday}
          />
        )
      case 'stale3':
        return (
          <DrawerStaleList
            deals={manager.staleZone3Deals}
            domain={domain}
            emptyText="Нет зависших в производстве"
            badgeColor="bg-yellow-50 text-yellow-700"
            noDetailNote={!isToday}
          />
        )
      case 'longstale':
        return (
          <DrawerStaleList
            deals={isToday ? (longstaleDeals ?? []) : undefined}
            domain={domain}
            emptyText="Нет долгостроев (>7 дней)"
            badgeColor="bg-purple-50 text-purple-700"
            noDetailNote={!isToday}
          />
        )
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        className="fixed right-0 top-0 h-full z-50 flex flex-col bg-white shadow-2xl
                   w-full sm:w-[560px] lg:w-[640px] transition-transform duration-200"
      >
        {/* Header */}
        <div className="flex-shrink-0 border-b border-[#f0f0ec]">
          <div className="flex items-start justify-between px-5 py-4">
            <div>
              <h2 className="text-[16px] font-semibold text-[#111110] tracking-tight">{firstName}</h2>
              <p className="text-[12px] text-[#9a9a95] mt-0.5">
                {manager.name} · {PERIOD_LABELS[period]}
              </p>
            </div>
            <button
              onClick={onClose}
              className="mt-0.5 w-7 h-7 flex items-center justify-center rounded-md text-[#9a9a95] hover:text-[#111110] hover:bg-[#f0f0ec] transition-colors"
              aria-label="Закрыть"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex px-5 gap-0.5 overflow-x-auto scrollbar-none pb-px">
            {DRAWER_TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-shrink-0 px-3 py-2 text-[12px] font-medium border-b-2 transition-all ${
                  tab === t.id
                    ? 'border-[#111110] text-[#111110]'
                    : 'border-transparent text-[#9a9a95] hover:text-[#6b6b66]'
                }`}
              >
                {t.label}
                {t.id === 'stale1' && manager.staleZone1 > 0 && (
                  <span className="ml-1.5 text-[10px] bg-red-100 text-red-600 px-1 py-0.5 rounded font-semibold">{manager.staleZone1}</span>
                )}
                {t.id === 'stale2' && manager.staleZone2 > 0 && (
                  <span className="ml-1.5 text-[10px] bg-orange-100 text-orange-600 px-1 py-0.5 rounded font-semibold">{manager.staleZone2}</span>
                )}
                {t.id === 'stale3' && manager.staleZone3 > 0 && (
                  <span className="ml-1.5 text-[10px] bg-yellow-100 text-yellow-600 px-1 py-0.5 rounded font-semibold">{manager.staleZone3}</span>
                )}
                {t.id === 'longstale' && (longstaleDeals?.length ?? 0) > 0 && (
                  <span className="ml-1.5 text-[10px] bg-purple-100 text-purple-600 px-1 py-0.5 rounded font-semibold">{longstaleDeals!.length}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {renderTabContent()}
        </div>
      </div>
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SalesControlPage() {
  const [period, setPeriod]               = useState<Period>('yesterday')
  const [data, setData]                   = useState<StatsData | null>(null)
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState<string | null>(null)
  const [managerFilter, setManagerFilter] = useState<number | 'all'>('all')
  const [selectedManager, setSelectedManager] = useState<ManagerStat | null>(null)

  const load = useCallback((p: Period) => {
    setLoading(true)
    setError(null)
    fetch(`/api/commercial/stats?period=${p}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((raw: Omit<StatsData, 'managers'> & { managers: Record<string, unknown>[] }) => {
        setData({ ...raw, managers: (raw.managers ?? []).map(normalise) })
        setManagerFilter('all')
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(period) }, [period, load])

  const managers = useMemo(() => {
    if (!data) return []
    if (managerFilter === 'all') return data.managers
    return data.managers.filter(m => m.id === managerFilter)
  }, [data, managerFilter])

  const totals = useMemo(() => {
    if (!managers.length) return null
    return managers.reduce((acc, m) => ({
      newLeads:     acc.newLeads     + (m.newLeads ?? 0),
      callsMade:    acc.callsMade    + (m.callsMade ?? 0),
      messagesSent: acc.messagesSent + (m.messagesSent ?? 0),
      cardsMoved:   acc.cardsMoved   + (m.cardsMoved ?? 0),
      activeLeads:  acc.activeLeads  + m.activeLeads,
      staleZone1:   acc.staleZone1   + m.staleZone1,
      staleZone2:   acc.staleZone2   + m.staleZone2,
      invoiceStale: acc.invoiceStale + m.invoiceStale,
      flags:        acc.flags        + redFlags(m, period),
    }), { newLeads: 0, callsMade: 0, messagesSent: 0, cardsMoved: 0, activeLeads: 0, staleZone1: 0, staleZone2: 0, invoiceStale: 0, flags: 0 })
  }, [managers, period])

  const live = data?.live === true
  const act = (v: number | undefined) => (live ? null : v ?? null)

  return (
    <div className="min-h-screen bg-[#f8f8f7]">
      <div className="max-w-[1400px] mx-auto px-4 py-5">

        {/* Header */}
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div>
            <h1 className="text-[16px] font-semibold text-[#111110] tracking-tight">Sales Control</h1>
            <p className="text-[12px] text-[#9a9a95] mt-0.5">Аналитика команды · управленческий вид</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Manager filter */}
            {data && !data.noData && data.managers.length > 1 && (
              <select
                value={managerFilter}
                onChange={e => setManagerFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className="text-[12px] border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 bg-white text-[#111110] outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="all">Все менеджеры</option>
                {data.managers.map(m => (
                  <option key={m.id} value={m.id}>{m.name.split(' ')[0]}</option>
                ))}
              </select>
            )}
            {/* Period tabs */}
            <div className="flex bg-[#f0f0ec] rounded-lg p-0.5">
              {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${
                    period === p ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66] hover:text-[#111110]'
                  }`}>
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Error */}
        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 mb-5">
            <p className="text-[13px] text-red-700 font-semibold">Ошибка загрузки</p>
            <p className="text-[12px] text-red-600 mt-0.5">{error}</p>
            <button onClick={() => load(period)} className="mt-2 text-[12px] text-red-700 underline">
              Повторить
            </button>
          </div>
        )}

        {!loading && data?.errors && data.errors.length > 0 && (
          <p role="alert" className="text-[12px] text-[#c23a2b] mb-3">Не всё загрузилось: {data.errors.join(' · ')}</p>
        )}

        {/* No data */}
        {!loading && !error && data?.noData && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-6 text-center mb-5">
            <p className="text-[14px] font-semibold text-amber-800 mb-1">Снимков дня за этот период нет</p>
            <p className="text-[12px] text-amber-700">
              Снимок вчерашнего дня пишется каждое утро в 6:30. Списки зависших сделок — в режиме «Сейчас».
            </p>
          </div>
        )}

        {/* Summary cards */}
        {(loading || (totals && !data?.noData)) && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
            {[
              { label: 'Лиды',      value: act(totals?.newLeads),     good: 4,  orange: 2 },
              { label: 'Звонки',    value: act(totals?.callsMade),    good: 8,  orange: 3 },
              { label: 'Сообщения', value: act(totals?.messagesSent), good: 15, orange: 5 },
              { label: 'Движения',  value: act(totals?.cardsMoved),   good: 8,  orange: 3 },
              { label: 'Активных',  value: totals?.activeLeads,  good: 0,  orange: 0 },
              { label: 'Флаги',     value: totals?.flags,        good: -1, orange: -1 },
            ].map(k => (
              <div key={k.label} className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-1">{k.label}</p>
                {loading ? (
                  <div className="h-7 w-12 bg-[#f0f0ec] rounded animate-pulse" />
                ) : (
                  <p className={`text-[22px] font-bold font-mono leading-none ${
                    k.label === 'Флаги'
                      ? (k.value ?? 0) > 0 ? 'text-red-500' : 'text-green-600'
                      : k.label === 'Активных'
                        ? 'text-[#111110]'
                        : numColor(k.value ?? 0, k.good, k.orange)
                  }`}>
                    {k.value ?? '—'}
                  </p>
                )}
                <p className="text-[10px] text-[#9a9a95] mt-1">
                  {live && k.value == null && k.label !== 'Флаги' && k.label !== 'Активных'
                    ? 'за день — в «Команде»'
                    : `${managerFilter === 'all' ? 'вся команда' : 'менеджер'} · ${live ? 'сейчас' : data?.label ?? ''}`}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Table */}
        {!error && !data?.noData && (
          <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[#f0f0ec] bg-[#fafaf9]">
                  <Th>Менеджер</Th>
                  <Th right>Лиды</Th>
                  <Th right>Сообщ</Th>
                  <Th right>Звонки</Th>
                  <Th right>Движ</Th>
                  <Th right>Активные</Th>
                  <Th right>Квалиф</Th>
                  <Th right>Продажа</Th>
                  <Th right>Опл/Пр-во</Th>
                  <Th right>Без кас.</Th>
                  <Th right>Прод&gt;3д</Th>
                  <Th right>Пр-во&gt;3д</Th>
                  <Th right>Счета&gt;5д</Th>
                  <Th right>Флаги</Th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
                  : managers.map(m => {
                      const flags = redFlags(m, period)
                      const firstName = m.name.split(' ')[0]
                      return (
                        <tr
                          key={m.id}
                          onClick={() => setSelectedManager(m)}
                          className="border-b border-[#f0f0ec] hover:bg-[#fafaf9] transition-colors cursor-pointer group"
                          title={`Открыть детали: ${firstName}`}
                        >
                          <Td>
                            <span className="font-medium text-[#111110] group-hover:text-blue-600 transition-colors">{firstName}</span>
                            {m.days !== undefined && (
                              <span className="ml-1.5 text-[10px] text-[#c4c4be]">{m.days}д</span>
                            )}
                          </Td>
                          <Td right className={numColor(m.newLeads, 2, 1)}>{m.newLeads ?? '—'}</Td>
                          <Td right className={numColor(m.messagesSent, 5, 2)}>{m.messagesSent ?? '—'}</Td>
                          <Td right className={numColor(m.callsMade, 3, 1)}>{m.callsMade ?? '—'}</Td>
                          <Td right className={numColor(m.cardsMoved, 3, 1)}>{m.cardsMoved ?? '—'}</Td>
                          <Td right className="text-[#111110] font-mono">{m.activeLeads}</Td>
                          <Td right className="text-blue-600 font-mono">{m.zone1}</Td>
                          <Td right className="text-orange-500 font-mono">{m.zone2}</Td>
                          <Td right className="text-green-600 font-mono">{m.zone3}</Td>
                          <Td right><Badge n={m.staleZone1} color="bg-red-50 text-red-600" /></Td>
                          <Td right><Badge n={m.staleZone2} color="bg-orange-50 text-orange-600" /></Td>
                          <Td right><Badge n={m.staleZone3} color="bg-yellow-50 text-yellow-600" /></Td>
                          <Td right><Badge n={m.invoiceStale} color="bg-red-50 text-red-600" /></Td>
                          <Td right>
                            {flags > 0
                              ? <span className="text-[11px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">{flags}</span>
                              : <span className="text-[11px] text-green-600">✓</span>
                            }
                          </Td>
                        </tr>
                      )
                    })
                }

                {/* Footer totals */}
                {!loading && totals && managers.length > 1 && (
                  <tr className="border-t-2 border-[#e4e4e0] bg-[#fafaf9]">
                    <Td><span className="text-[11px] font-semibold text-[#9a9a95] uppercase tracking-wide">Итого</span></Td>
                    <Td right className="font-semibold text-[#111110]">{act(totals.newLeads) ?? '—'}</Td>
                    <Td right className="font-semibold text-[#111110]">{act(totals.messagesSent) ?? '—'}</Td>
                    <Td right className="font-semibold text-[#111110]">{act(totals.callsMade) ?? '—'}</Td>
                    <Td right className="font-semibold text-[#111110]">{act(totals.cardsMoved) ?? '—'}</Td>
                    <Td right className="font-semibold text-[#111110]">{totals.activeLeads}</Td>
                    <Td right className="text-blue-600 font-semibold">{managers.reduce((s, m) => s + m.zone1, 0)}</Td>
                    <Td right className="text-orange-500 font-semibold">{managers.reduce((s, m) => s + m.zone2, 0)}</Td>
                    <Td right className="text-green-600 font-semibold">{managers.reduce((s, m) => s + m.zone3, 0)}</Td>
                    <Td right><Badge n={totals.staleZone1} color="bg-red-50 text-red-600" /></Td>
                    <Td right><Badge n={totals.staleZone2} color="bg-orange-50 text-orange-600" /></Td>
                    <Td right><Badge n={managers.reduce((s, m) => s + m.staleZone3, 0)} color="bg-yellow-50 text-yellow-600" /></Td>
                    <Td right><Badge n={totals.invoiceStale} color="bg-red-50 text-red-600" /></Td>
                    <Td right>
                      {totals.flags > 0
                        ? <span className="text-[11px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">{totals.flags}</span>
                        : <span className="text-[11px] text-green-600">✓</span>
                      }
                    </Td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Empty state */}
            {!loading && managers.length === 0 && !data?.noData && (
              <div className="px-5 py-10 text-center text-[13px] text-[#9a9a95]">
                Нет данных по выбранному менеджеру
              </div>
            )}
          </div>
        )}

        {/* Click hint */}
        {!loading && managers.length > 0 && !data?.noData && (
          <p className="text-[11px] text-[#c4c4be] mt-3 text-center">
            Нажмите на строку менеджера для подробностей
          </p>
        )}

        {/* Footer */}
        {!loading && !error && data && !live && !data.noData && (
          <p className="text-[11px] text-[#9a9a95] mt-2 text-center">
            Звонки и сообщения — снимки дня amo ({data.label}), как на «Команде»; сегодняшний неполный день не входит.
            Воронка и зависшие — на {data.stateDate ? `${data.stateDate.slice(8, 10)}.${data.stateDate.slice(5, 7)}` : '—'}, крон 18:00.
          </p>
        )}
        {!loading && !error && live && (
          <p className="text-[11px] text-[#9a9a95] mt-2 text-center">
            Воронка и зависшие сделки — живой запрос в AmoCRM. Звонки и сообщения за сегодня — на «Команде» (главная, «Обновить»).
          </p>
        )}

      </div>

      {/* Drawer */}
      <ManagerDrawer
        manager={selectedManager}
        period={period}
        domain={data?.domain}
        onClose={() => setSelectedManager(null)}
      />
    </div>
  )
}
