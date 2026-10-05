import { describe, it, expect } from 'vitest'
import { emptyDay, COUNT_KEYS, type AmoActivityReport, type ManagerActivity } from '@/lib/amoActivity'
import type { AmoResultsReport, ManagerResult } from '@/lib/amoResults'
import { buildDayRows, countAppDocs } from '@/lib/managerDay'

const DAY = '2026-10-01'
const t = (hhmm: string) => Date.parse(`${DAY}T${hhmm}:00+03:00`) / 1000

function manager(userId: number, name: string, patch: Partial<ReturnType<typeof emptyDay>>): ManagerActivity {
  const d = { ...emptyDay(DAY), ...patch }
  return {
    userId, name, days: [d],
    total: Object.fromEntries(COUNT_KEYS.map(k => [k, d[k] as number])) as ManagerActivity['total'],
    workDays: 1, medianStartMin: null, medianEndMin: null, avgActiveHours: d.activeHours, medianReplyMin: null, repliesCounted: 0,
  }
}

const activity: AmoActivityReport = {
  from: t('00:00'), to: t('00:00') + 86400, days: [DAY], noAuthorUnassigned: 0, autoReplies: 0,
  managers: [
    manager(11127302, 'Александра', {
      firstAt: t('14:16'), lastAt: t('17:32'), actions: 143, messagesOwn: 6, messagesNoAuthor: 27,
      callsOut: 3, callsOutConnected: 3, cardsMoved: 5, tasksCompleted: 5, unanswered: 4, replyMinutes: [10, 15, 40],
    }),
  ],
}

const result = (userId: number, name: string, kp: number, invoice: number): ManagerResult => ({
  userId, name, leadsReceived: 2, leadsDaytime: 2, leadsNoContact: 0, firstContactMedianMin: 12,
  advanced: { measure: 1, kp, invoice, paid: 0, won: 0, lost: 0 },
  paidDeals: 0, paidBudget: 0, lostOfReceived: 0, tasksOpen: 0, tasksOverdue: 0, tasksOverdue30: 0,
})

describe('buildDayRows — день менеджера одной строкой', () => {
  const results: AmoResultsReport = { from: 0, to: 0, managers: [result(11127302, 'Александра', 2, 1)] }
  const pbx = [
    { userId: 11127302, ext: '102', inboundAnswered: 0, outbound: 5, outboundAnswered: 4, talkSec: 162 },
    { userId: 13677554, ext: '100', inboundAnswered: 0, outbound: 0, outboundAnswered: 0, talkSec: 0 },
    { userId: null, ext: '199', inboundAnswered: 3, outbound: 1, outboundAnswered: 1, talkSec: 60 },
  ]
  const names = new Map([[11127302, 'Александра'], [13677554, 'Семён']])

  it('берёт цифры amo как есть — те же, что на «Рабочем дне AMO»', () => {
    const rows = buildDayRows({ day: DAY, activity, results, pbx, docs: new Map(), names })
    const a = rows.find(r => r.amo_user_id === 11127302)!
    expect(a.first_at).toBe('2026-10-01T11:16:00.000Z')
    expect(a.last_at).toBe('2026-10-01T14:32:00.000Z')
    expect([a.actions, a.messages_own, a.messages_no_author, a.cards_moved, a.unanswered]).toEqual([143, 6, 27, 5, 4])
    expect(a.reply_median_min).toBe(15)
    expect(a.replies_counted).toBe(3)
  })

  it('этапы amo и АТС — отдельными полями, звонки amo не подменяются АТС', () => {
    const a = buildDayRows({ day: DAY, activity, results, pbx, docs: new Map(), names }).find(r => r.amo_user_id === 11127302)!
    expect([a.adv_kp, a.adv_invoice, a.adv_measure]).toEqual([2, 1, 1])
    expect([a.pbx_out, a.pbx_out_ok, a.pbx_talk_sec]).toEqual([5, 4, 162])
    expect([a.calls_out, a.calls_out_ok]).toEqual([3, 3])
  })

  it('человек без действий в amo, но с номером в АТС, получает строку с нулями', () => {
    const s = buildDayRows({ day: DAY, activity, results, pbx, docs: new Map(), names }).find(r => r.amo_user_id === 13677554)!
    expect(s.name).toBe('Семён')
    expect([s.actions, s.pbx_out, s.adv_kp]).toEqual([0, 0, 0])
    expect(s.first_at).toBeNull()
  })

  it('номер АТС без хозяина в строки не попадает', () => {
    const rows = buildDayRows({ day: DAY, activity, results, pbx, docs: new Map(), names })
    expect(rows.map(r => r.amo_user_id).sort()).toEqual([11127302, 13677554])
  })

  it('этапы или АТС не ответили — null, а не ноль: «не знаем» ≠ «не было»', () => {
    const a = buildDayRows({ day: DAY, activity, results: null, pbx: null, docs: new Map(), names })[0]
    expect([a.adv_kp, a.leads_received, a.pbx_out, a.pbx_talk_sec]).toEqual([null, null, null, null])
  })

  it('два внутренних номера одного человека складываются', () => {
    const two = [
      { userId: 1593673, ext: '101', inboundAnswered: 1, outbound: 6, outboundAnswered: 4, talkSec: 399 },
      { userId: 1593673, ext: '105', inboundAnswered: 0, outbound: 2, outboundAnswered: 1, talkSec: 30 },
    ]
    const y = buildDayRows({ day: DAY, activity, results: null, pbx: two, docs: new Map(), names }).find(r => r.amo_user_id === 1593673)!
    expect([y.pbx_out, y.pbx_out_ok, y.pbx_in, y.pbx_talk_sec]).toEqual([8, 5, 1, 429])
  })
})

describe('countAppDocs — документы приложения по amo-id автора', () => {
  it('быстрый расчёт считается и быстрым, и расчётом; чужие учётки без amo-id пропускаются', () => {
    const docs = countAppDocs({
      users: [{ id: 'u-yana', amo_user_id: 1593673 }, { id: 'u-nobody', amo_user_id: null }],
      calcs: [
        { created_by: 'u-yana', product_type: 'quick' },
        { created_by: 'u-yana', product_type: 'mirror' },
        { created_by: 'u-nobody', product_type: 'quick' },
        { created_by: null, product_type: 'quick' },
      ],
      kp: [{ manager_id: 'u-yana' }],
      contracts: [],
    })
    expect(docs.get(1593673)).toEqual({ quick: 1, calcs: 2, kp: 1, contracts: 0 })
    expect(docs.size).toBe(1)
  })
})
