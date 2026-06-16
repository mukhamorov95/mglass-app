'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'

type Period = 'today' | 'week' | 'month' | 'year'

type ManagerStat = {
  id: number
  name: string
  newLeads: number
  callsMade: number
  messagesSent: number
  cardsMoved: number
  activeLeads: number
  zone1: number
  zone2: number
  zone3: number
  staleZone1: number
  staleZone2: number
  staleZone3: number
  invoiceStale: number
  days?: number
}

type StatsData = {
  period: Period
  managers: ManagerStat[]
  noData?: boolean
  fromDate?: string
}

type DrawerTab = 'overview' | 'stale1' | 'stale2' | 'stale3' | 'longstale'

// Safe mapper: handles both camelCase (today) and snake_case (historical) shapes
function normalise(raw: Record<string, unknown>): ManagerStat {
  const n = (key1: string, key2: string): number =>
    Number((raw[key1] ?? raw[key2]) ?? 0)
  return {
    id:           Number(raw.id ?? 0),
    name:         String(raw.name ?? ''),
    newLeads:     n('newLeads',     'new_leads'),
    callsMade:    n('callsMade',    'calls_made'),
    messagesSent: n('messagesSent', 'messages_sent'),
    cardsMoved:   n('cardsMoved',   'cards_moved'),
    activeLeads:  n('activeLeads',  'active_leads'),
    zone1:        n('zone1',        'zone1'),
    zone2:        n('zone2',        'zone2'),
    zone3:        n('zone3',        'zone3'),
    staleZone1:   n('staleZone1',   'stale_zone1'),
    staleZone2:   n('staleZone2',   'stale_zone2'),
    staleZone3:   n('staleZone3',   'stale_zone3'),
    invoiceStale: n('invoiceStale', 'invoice_stale'),
    days:         raw.days !== undefined ? Number(raw.days) : undefined,
  }
}

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Сегодня',
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
  if (period === 'today' && m.callsMade === 0 && m.messagesSent === 0 && m.activeLeads > 0) n++
  if (m.staleZone1 > 0) n++
  if (m.staleZone2 > 0) n++
  if (m.invoiceStale > 0) n++
  return n
}

function numColor(val: number, green: number, orange: number): string {
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

// ── Drawer ────────────────────────────────────────────────────────────────────

function DrawerPlaceholder({ count }: { count: number }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      {count > 0 && (
        <div className="mb-4 text-[28px] font-bold font-mono text-[#c4c4be]">{count}</div>
      )}
      <p className="text-[13px] font-medium text-[#6b6b66] mb-1">
        {count > 0 ? `${count} сделок в этой категории` : 'Нет данных'}
      </p>
      <p className="text-[12px] text-[#9a9a95] max-w-[340px]">
        Детализация сделок будет добавлена следующим шагом.
        Сейчас <span className="font-mono text-[#6b6b66]">/api/commercial/stats</span> отдаёт только агрегаты без списка сделок.
      </p>
    </div>
  )
}

function DrawerOverview({ m, period }: { m: ManagerStat; period: Period }) {
  const flags = redFlags(m, period)
  const rows: { label: string; value: React.ReactNode; sub?: string }[] = [
    {
      label: 'Лиды сегодня',
      value: <span className={numColor(m.newLeads, 2, 1)}>{m.newLeads}</span>,
    },
    {
      label: 'Сообщения',
      value: <span className={numColor(m.messagesSent, 5, 2)}>{m.messagesSent}</span>,
    },
    {
      label: 'Звонки',
      value: <span className={numColor(m.callsMade, 3, 1)}>{m.callsMade}</span>,
    },
    {
      label: 'Движения карточек',
      value: <span className={numColor(m.cardsMoved, 3, 1)}>{m.cardsMoved}</span>,
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
              period === 'today' && m.callsMade === 0 && m.messagesSent === 0 && m.activeLeads > 0 && '0 звонков и 0 сообщений',
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
  onClose,
}: {
  manager: ManagerStat | null
  period: Period
  onClose: () => void
}) {
  const [tab, setTab] = useState<DrawerTab>('overview')
  const drawerRef = useRef<HTMLDivElement>(null)

  // Reset tab when manager changes
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

  function renderTabContent() {
    if (!manager) return null
    switch (tab) {
      case 'overview':
        return <DrawerOverview m={manager} period={period} />
      case 'stale1':
        return <DrawerPlaceholder count={manager.staleZone1} />
      case 'stale2':
        return <DrawerPlaceholder count={manager.staleZone2} />
      case 'stale3':
        return <DrawerPlaceholder count={manager.staleZone3} />
      case 'longstale':
        return <DrawerPlaceholder count={0} />
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
                {/* Count badge on stale tabs */}
                {t.id === 'stale1' && manager.staleZone1 > 0 && (
                  <span className="ml-1.5 text-[10px] bg-red-100 text-red-600 px-1 py-0.5 rounded font-semibold">{manager.staleZone1}</span>
                )}
                {t.id === 'stale2' && manager.staleZone2 > 0 && (
                  <span className="ml-1.5 text-[10px] bg-orange-100 text-orange-600 px-1 py-0.5 rounded font-semibold">{manager.staleZone2}</span>
                )}
                {t.id === 'stale3' && manager.staleZone3 > 0 && (
                  <span className="ml-1.5 text-[10px] bg-yellow-100 text-yellow-600 px-1 py-0.5 rounded font-semibold">{manager.staleZone3}</span>
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
  const [period, setPeriod]               = useState<Period>('today')
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
      .then((raw: { period: Period; managers: Record<string, unknown>[]; noData?: boolean; fromDate?: string }) => {
        setData({ ...raw, managers: (raw.managers ?? []).map(normalise) })
        setManagerFilter('all')
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load(period) }, [period, load])

  const managers = useMemo(() => {
    if (!data) return []
    if (managerFilter === 'all') return data.managers
    return data.managers.filter(m => m.id === managerFilter)
  }, [data, managerFilter])

  const totals = useMemo(() => {
    if (!managers.length) return null
    return managers.reduce((acc, m) => ({
      newLeads:     acc.newLeads     + m.newLeads,
      callsMade:    acc.callsMade    + m.callsMade,
      messagesSent: acc.messagesSent + m.messagesSent,
      cardsMoved:   acc.cardsMoved   + m.cardsMoved,
      activeLeads:  acc.activeLeads  + m.activeLeads,
      staleZone1:   acc.staleZone1   + m.staleZone1,
      staleZone2:   acc.staleZone2   + m.staleZone2,
      invoiceStale: acc.invoiceStale + m.invoiceStale,
      flags:        acc.flags        + redFlags(m, period),
    }), { newLeads: 0, callsMade: 0, messagesSent: 0, cardsMoved: 0, activeLeads: 0, staleZone1: 0, staleZone2: 0, invoiceStale: 0, flags: 0 })
  }, [managers, period])

  const isToday = period === 'today'

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

        {/* No data */}
        {!loading && !error && data?.noData && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-6 text-center mb-5">
            <p className="text-[14px] font-semibold text-amber-800 mb-1">Нет исторических данных</p>
            <p className="text-[12px] text-amber-700">
              Данные за «{PERIOD_LABELS[period]}» накапливаются ежедневно в 18:00.
              Переключитесь на «Сегодня» для данных в реальном времени.
            </p>
          </div>
        )}

        {/* Summary cards */}
        {(loading || (totals && !data?.noData)) && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
            {[
              { label: 'Лиды',      value: totals?.newLeads,     good: 4,  orange: 2 },
              { label: 'Звонки',    value: totals?.callsMade,    good: 8,  orange: 3 },
              { label: 'Сообщения', value: totals?.messagesSent, good: 15, orange: 5 },
              { label: 'Движения',  value: totals?.cardsMoved,   good: 8,  orange: 3 },
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
                    {k.value ?? 0}
                  </p>
                )}
                <p className="text-[10px] text-[#c4c4be] mt-1">
                  {managerFilter === 'all' ? 'вся команда' : 'менеджер'} · {PERIOD_LABELS[period].toLowerCase()}
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
                  {isToday && <Th right>Флаги</Th>}
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
                          <Td right className={numColor(m.newLeads, 2, 1)}>{m.newLeads}</Td>
                          <Td right className={numColor(m.messagesSent, 5, 2)}>{m.messagesSent}</Td>
                          <Td right className={numColor(m.callsMade, 3, 1)}>{m.callsMade}</Td>
                          <Td right className={numColor(m.cardsMoved, 3, 1)}>{m.cardsMoved}</Td>
                          <Td right className="text-[#111110] font-mono">{m.activeLeads}</Td>
                          <Td right className="text-blue-600 font-mono">{m.zone1}</Td>
                          <Td right className="text-orange-500 font-mono">{m.zone2}</Td>
                          <Td right className="text-green-600 font-mono">{m.zone3}</Td>
                          <Td right><Badge n={m.staleZone1} color="bg-red-50 text-red-600" /></Td>
                          <Td right><Badge n={m.staleZone2} color="bg-orange-50 text-orange-600" /></Td>
                          <Td right><Badge n={m.staleZone3} color="bg-yellow-50 text-yellow-600" /></Td>
                          <Td right><Badge n={m.invoiceStale} color="bg-red-50 text-red-600" /></Td>
                          {isToday && (
                            <Td right>
                              {flags > 0
                                ? <span className="text-[11px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">{flags}</span>
                                : <span className="text-[11px] text-green-600">✓</span>
                              }
                            </Td>
                          )}
                        </tr>
                      )
                    })
                }

                {/* Footer totals */}
                {!loading && totals && managers.length > 1 && (
                  <tr className="border-t-2 border-[#e4e4e0] bg-[#fafaf9]">
                    <Td><span className="text-[11px] font-semibold text-[#9a9a95] uppercase tracking-wide">Итого</span></Td>
                    <Td right className="font-semibold text-[#111110]">{totals.newLeads}</Td>
                    <Td right className="font-semibold text-[#111110]">{totals.messagesSent}</Td>
                    <Td right className="font-semibold text-[#111110]">{totals.callsMade}</Td>
                    <Td right className="font-semibold text-[#111110]">{totals.cardsMoved}</Td>
                    <Td right className="font-semibold text-[#111110]">{totals.activeLeads}</Td>
                    <Td right className="text-blue-600 font-semibold">{managers.reduce((s, m) => s + m.zone1, 0)}</Td>
                    <Td right className="text-orange-500 font-semibold">{managers.reduce((s, m) => s + m.zone2, 0)}</Td>
                    <Td right className="text-green-600 font-semibold">{managers.reduce((s, m) => s + m.zone3, 0)}</Td>
                    <Td right><Badge n={totals.staleZone1} color="bg-red-50 text-red-600" /></Td>
                    <Td right><Badge n={totals.staleZone2} color="bg-orange-50 text-orange-600" /></Td>
                    <Td right><Badge n={managers.reduce((s, m) => s + m.staleZone3, 0)} color="bg-yellow-50 text-yellow-600" /></Td>
                    <Td right><Badge n={totals.invoiceStale} color="bg-red-50 text-red-600" /></Td>
                    {isToday && (
                      <Td right>
                        {totals.flags > 0
                          ? <span className="text-[11px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">{totals.flags}</span>
                          : <span className="text-[11px] text-green-600">✓</span>
                        }
                      </Td>
                    )}
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
        {!loading && !error && period !== 'today' && data?.fromDate && (
          <p className="text-[11px] text-[#c4c4be] mt-2 text-center">
            Данные с {new Date(data.fromDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} по сегодня · обновляются ежедневно в 18:00
          </p>
        )}
        {!loading && !error && period === 'today' && (
          <p className="text-[11px] text-[#c4c4be] mt-2 text-center">
            Данные в реальном времени из AmoCRM · {PERIOD_LABELS[period]}
          </p>
        )}

      </div>

      {/* Drawer */}
      <ManagerDrawer
        manager={selectedManager}
        period={period}
        onClose={() => setSelectedManager(null)}
      />
    </div>
  )
}
