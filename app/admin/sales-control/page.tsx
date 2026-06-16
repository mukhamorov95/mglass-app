'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'

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

export default function SalesControlPage() {
  const [period, setPeriod]         = useState<Period>('today')
  const [data, setData]             = useState<StatsData | null>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [managerFilter, setManagerFilter] = useState<number | 'all'>('all')

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
                        <tr key={m.id} className="border-b border-[#f0f0ec] hover:bg-[#fafaf9] transition-colors">
                          <Td>
                            <span className="font-medium text-[#111110]">{firstName}</span>
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

        {/* Footer */}
        {!loading && !error && period !== 'today' && data?.fromDate && (
          <p className="text-[11px] text-[#c4c4be] mt-4 text-center">
            Данные с {new Date(data.fromDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} по сегодня · обновляются ежедневно в 18:00
          </p>
        )}
        {!loading && !error && period === 'today' && (
          <p className="text-[11px] text-[#c4c4be] mt-4 text-center">
            Данные в реальном времени из AmoCRM · {PERIOD_LABELS[period]}
          </p>
        )}

      </div>
    </div>
  )
}
