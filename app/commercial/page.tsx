'use client'

import { useEffect, useState, useCallback } from 'react'
import { PageHeader, SegmentedTabs, MetricTile } from '@/components/ds'

type Period = 'today' | 'week' | 'month' | 'year'

type ManagerStat = {
  id: number; name: string
  newLeads: number; callsMade: number; messagesSent: number; cardsMoved: number
  activeLeads: number; zone1: number; zone2: number; zone3: number
  staleZone1: number; staleZone2: number; staleZone3: number; invoiceStale: number
  days?: number
}

type StatsData = {
  period: Period
  managers: ManagerStat[]
  noData?: boolean
  fromDate?: string
}

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Сегодня',
  week:  'Неделя',
  month: 'Месяц',
  year:  'Год',
}

function scoreColor(val: number, good: number, bad: number): string {
  if (val >= good)  return 'text-green-600'
  if (val >= bad)   return 'text-orange-500'
  return 'text-red-500'
}

function Flag({ condition, text }: { condition: boolean; text: string }) {
  if (!condition) return null
  return <span className="inline-block text-[11px] bg-red-50 text-red-600 border border-red-200 rounded px-1.5 py-0.5 mr-1 mb-1">{text}</span>
}

function ManagerCard({ m, period }: { m: ManagerStat; period: Period }) {
  const firstName = m.name.split(' ')[0]
  const isToday = period === 'today'

  return (
    <div className="bg-surface border border-line rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-line-soft flex items-center justify-between">
        <div>
          <p className="text-[14px] font-semibold text-ink">{firstName}</p>
          <p className="text-[11px] text-muted mt-0.5">Активных сделок: <strong className="text-ink tabular-nums">{m.activeLeads}</strong></p>
        </div>
        <div className="text-right">
          <div className="flex gap-1 text-[11px]">
            <span className="text-blue-600 font-mono font-semibold tabular-nums">{m.zone1}</span>
            <span className="text-faint">/</span>
            <span className="text-orange-500 font-mono font-semibold tabular-nums">{m.zone2}</span>
            <span className="text-faint">/</span>
            <span className="text-green-600 font-mono font-semibold tabular-nums">{m.zone3}</span>
          </div>
          <p className="text-[11px] text-faint mt-0.5">К / П / Пр-во</p>
        </div>
      </div>

      {/* Activity */}
      <div className="grid grid-cols-4 divide-x divide-line-soft border-b border-line-soft">
        {[
          { label: 'Лидов',  value: m.newLeads,     good: 2, bad: 1 },
          { label: 'Звонков', value: m.callsMade,   good: 3, bad: 1 },
          { label: 'Сообщ',  value: m.messagesSent, good: 5, bad: 2 },
          { label: 'Перем',  value: m.cardsMoved,   good: 3, bad: 1 },
        ].map(k => (
          <div key={k.label} className="px-3 py-2.5 text-center">
            <p className={`text-[18px] font-semibold font-mono leading-none tabular-nums ${scoreColor(k.value, k.good, k.bad)}`}>{k.value}</p>
            <p className="text-[11px] text-muted mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Flags */}
      <div className="px-5 py-3 min-h-[44px]">
        <Flag condition={m.callsMade === 0 && m.messagesSent === 0 && isToday} text="0 активности" />
        <Flag condition={m.staleZone1 > 0} text={`Зона 1: ${m.staleZone1} зависших`} />
        <Flag condition={m.invoiceStale > 0} text={`Счёт >5д: ${m.invoiceStale}`} />
        <Flag condition={m.staleZone2 > 0} text={`Зона 2: ${m.staleZone2} >3д`} />
        {!m.staleZone1 && !m.invoiceStale && !m.staleZone2 && (m.callsMade > 0 || m.messagesSent > 0) && (
          <span className="text-[11px] text-green-600">✅ Норма</span>
        )}
        {!m.staleZone1 && !m.invoiceStale && !m.staleZone2 && m.callsMade === 0 && m.messagesSent === 0 && !isToday && (
          <span className="text-[11px] text-faint">— нет данных</span>
        )}
      </div>
    </div>
  )
}

export default function CommercialPage() {
  const [period, setPeriod]   = useState<Period>('today')
  const [data, setData]       = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback((p: Period) => {
    setLoading(true)
    fetch(`/api/commercial/stats?period=${p}`)
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load(period) }, [period, load])

  const totals = data?.managers.reduce((acc, m) => ({
    newLeads:     acc.newLeads     + m.newLeads,
    callsMade:    acc.callsMade    + m.callsMade,
    messagesSent: acc.messagesSent + m.messagesSent,
    cardsMoved:   acc.cardsMoved   + m.cardsMoved,
    activeLeads:  acc.activeLeads  + m.activeLeads,
  }), { newLeads: 0, callsMade: 0, messagesSent: 0, cardsMoved: 0, activeLeads: 0 })

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-[1200px] mx-auto px-4 py-5">

        {/* Header */}
        <PageHeader
          title="Коммерческий"
          subtitle="Аналитика по менеджерам"
          actions={
            <SegmentedTabs
              value={period}
              onChange={setPeriod}
              tabs={(Object.keys(PERIOD_LABELS) as Period[]).map(p => ({ value: p, label: PERIOD_LABELS[p] }))}
            />
          }
        />

        {/* Summary strip */}
        {totals && !loading && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
            {[
              { label: 'Лидов',        value: totals.newLeads },
              { label: 'Звонков',      value: totals.callsMade },
              { label: 'Сообщений',    value: totals.messagesSent },
              { label: 'Перемещений',  value: totals.cardsMoved },
              { label: 'Активных сделок', value: totals.activeLeads },
            ].map(k => (
              <MetricTile key={k.label} label={k.label} value={k.value} hint={`вся команда · ${PERIOD_LABELS[period].toLowerCase()}`} />
            ))}
          </div>
        )}

        {/* No data state */}
        {!loading && data?.noData && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-6 text-center mb-5">
            <p className="text-[14px] font-semibold text-amber-800 mb-1">Нет исторических данных</p>
            <p className="text-[12px] text-amber-700">
              Данные за период «{PERIOD_LABELS[period]}» накапливаются автоматически каждый день в 18:00.
              Переключитесь на «Сегодня» чтобы увидеть данные в реальном времени.
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-surface border border-line rounded-xl h-[160px] animate-pulse" />
            ))}
          </div>
        )}

        {/* Manager cards */}
        {!loading && data && !data.noData && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {data.managers.map(m => (
              <ManagerCard key={m.id} m={m} period={period} />
            ))}
          </div>
        )}

        {/* Footer note */}
        {!loading && period !== 'today' && data?.fromDate && (
          <p className="text-[11px] text-faint mt-4 text-center">
            Данные с {new Date(data.fromDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} по сегодня · обновляются ежедневно в 18:00
          </p>
        )}

      </div>
    </div>
  )
}
