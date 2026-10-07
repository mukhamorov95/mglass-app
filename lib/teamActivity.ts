import { addDays, dayLabel, sumActivity, type Activity, type DayRow, type Schedule } from '@/lib/morning'

// Звонки и сообщения на экранах владельца (/commercial, /ceo, /admin/sales-control) —
// из снимков дня manager_day_stats, теми же функциями, что «Команда». Раньше они
// считались lib/salesMonitor.ts живым запросом в amo (до 45 с) и расходились со
// снимком: у Яны за один день 69 сообщений в снимке против 8 в sales_monitor_daily.

export const SNAPSHOT_PERIODS = ['yesterday', 'week', 'month', 'year'] as const
export type SnapshotPeriod = typeof SNAPSHOT_PERIODS[number]

export const isSnapshotPeriod = (p: string): p is SnapshotPeriod =>
  (SNAPSHOT_PERIODS as readonly string[]).includes(p)

const SPAN: Record<Exclude<SnapshotPeriod, 'yesterday'>, number> = { week: 7, month: 30, year: 365 }

// Сегодняшний день в период не входит: снимок дня полный только утром следующего.
export function snapshotRange(period: SnapshotPeriod, today: string): { from: string; to: string } {
  const to = addDays(today, -1)
  if (period === 'yesterday') return { from: to, to }
  return { from: addDays(today, -SPAN[period]), to }
}

export type Seller = { amoUserId: number; name: string; schedule?: Schedule }

export type SellerActivity = {
  amoUserId: number
  name: string
  act: Activity
  leads: number | null   // null — заявки в снимках не считались
}

export function sellersActivity(rows: DayRow[], sellers: Seller[], days: string[]): SellerActivity[] {
  return sellers.map(s => {
    const mine = rows.filter(r => Number(r.amo_user_id) === s.amoUserId && days.includes(r.day))
    const counted = mine.filter(r => r.leads_received != null)
    return {
      amoUserId: s.amoUserId,
      name: s.name,
      act: sumActivity(mine, s.schedule, days),
      leads: counted.length ? counted.reduce((n, r) => n + (r.leads_received ?? 0), 0) : null,
    }
  })
}

const dm = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`

// Подпись периода снимков: «вчера, 06.10», «последний рабочий день, 03.10», «01.10–06.10».
export function snapshotLabel(days: string[], today: string): string {
  if (!days.length) return 'снимков нет'
  if (days.length === 1) return `${dayLabel(days[0], today).title.toLowerCase()}, ${dm(days[0])}`
  return `${dm(days[0])}–${dm(days[days.length - 1])}`
}
