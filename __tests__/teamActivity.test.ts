import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sumActivity, type DayRow, type Schedule } from '@/lib/morning'
import { isSnapshotPeriod, sellersActivity, snapshotLabel, snapshotRange } from '@/lib/teamActivity'

const row = (patch: Partial<DayRow>): DayRow => ({
  day: '2026-10-01', amo_user_id: 1, name: 'Яна', first_at: null, last_at: null, active_hours: null, longest_pause_min: null,
  actions: 0, messages_own: 0, messages_no_author: 0, client_messages: 0, reply_median_min: null, replies_counted: 0,
  unanswered: 0, left_waiting: 0, tasks_completed: 0, tasks_postponed: 0, cards_moved: 0,
  calls_out: 0, calls_out_ok: 0, calls_in: 0, calls_in_missed: 0, talk_sec: 0,
  leads_received: null, first_contact_median_min: null, adv_measure: null, adv_kp: null, adv_invoice: null, adv_paid: null,
  pbx_out: null, pbx_out_ok: null, pbx_in: null, pbx_talk_sec: null, app_quick: 0, app_calcs: 0, app_kp: 0, app_contracts: 0,
  ...patch,
})
const sch: Schedule = { amo_user_id: 1, name: 'Яна', work_from: '09:00:00', work_to: '18:00:00', work_days: [1, 2, 3, 4, 5], starts_on: null }

describe('периоды снимков', () => {
  it('сегодняшний неполный день не входит ни в один период', () => {
    expect(snapshotRange('yesterday', '2026-10-07')).toEqual({ from: '2026-10-06', to: '2026-10-06' })
    expect(snapshotRange('week', '2026-10-07')).toEqual({ from: '2026-09-30', to: '2026-10-06' })
    expect(snapshotRange('month', '2026-10-07')).toEqual({ from: '2026-09-07', to: '2026-10-06' })
  })

  it('«сегодня» — не период снимка: живой режим отдельно', () => {
    expect(isSnapshotPeriod('today')).toBe(false)
    expect(isSnapshotPeriod('week')).toBe(true)
    expect(isSnapshotPeriod('x')).toBe(false)
  })
})

describe('активность продавцов — те же функции, что «Команда»', () => {
  const days = ['2026-10-05', '2026-10-06']
  const rows = [
    row({ day: '2026-10-05', messages_own: 60, messages_no_author: 9, calls_out: 4, calls_out_ok: 2, actions: 80, leads_received: 3, cards_moved: 5 }),
    row({ day: '2026-10-06', messages_own: 8, pbx_out: 7, pbx_out_ok: 5, pbx_in: 1, pbx_talk_sec: 600, actions: 20, leads_received: 1 }),
    row({ day: '2026-10-06', amo_user_id: 2, name: 'Чужой', messages_own: 100 }),
  ]

  it('звонки и сообщения совпадают с sumActivity «Команды»', () => {
    const [p] = sellersActivity(rows, [{ amoUserId: 1, name: 'Яна', schedule: sch }], days)
    const team = sumActivity(rows.filter(r => r.amo_user_id === 1), sch, days)
    expect(p.act).toEqual(team)
    expect(p.act.msgs).toBe(77)
    expect(p.act.out).toBe(11)  // amo 4 + АТС 7: в день с АТС берётся АТС
    expect(p.leads).toBe(4)
  })

  it('заявки, которых в снимках нет, — null, а не ноль', () => {
    const [p] = sellersActivity([row({ day: '2026-10-06' })], [{ amoUserId: 1, name: 'Яна', schedule: sch }], ['2026-10-06'])
    expect(p.leads).toBeNull()
  })

  it('продавец без снимков остаётся в списке с нулями', () => {
    const [p] = sellersActivity(rows, [{ amoUserId: 9, name: 'Новый' }], days)
    expect(p.act.msgs).toBe(0)
    expect(p.act.out).toBe(0)
  })
})

describe('подпись периода', () => {
  it('один день — «вчера», несколько — диапазон', () => {
    expect(snapshotLabel(['2026-10-06'], '2026-10-07')).toBe('вчера, 06.10')
    expect(snapshotLabel(['2026-10-02'], '2026-10-05')).toBe('последний рабочий день, 02.10')
    expect(snapshotLabel(['2026-09-30', '2026-10-06'], '2026-10-07')).toBe('30.09–06.10')
    expect(snapshotLabel([], '2026-10-07')).toBe('снимков нет')
  })
})

describe('экраны владельца не считают звонки живым запросом', () => {
  it('/commercial, /ceo и Sales Control не просят «сегодня» у salesMonitor для звонков', () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
    expect(read('app/ceo/page.tsx')).not.toContain('period=today')
    expect(read('app/commercial/page.tsx')).not.toMatch(/'today'/)
    const route = read('app/api/commercial/stats/route.ts')
    expect(route).toMatch(/callsMade:\s+null/)
  })
})
