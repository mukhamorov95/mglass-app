import { describe, it, expect } from 'vitest'
import { buildFocus, pickHabit, pickWins, coach, reply5Share, FOCUS_LIMIT, type ManagerFacts } from '@/lib/coaching/rules'

const NOW = Date.parse('2026-09-22T15:00:00Z') / 1000 // 18:00 МСК
const H = 3600

const facts = (over: Partial<ManagerFacts> = {}): ManagerFacts => ({
  amoUserId: 1, name: 'Алина',
  week: { replies: [], leftWaiting: 0, tasksCompleted: 0, workDays: 5 },
  results: { days: 90, leadsReceived: 100, leadsDaytime: 80, leadsNoContact: 4, firstContactMedianMin: 2, paidDeals: 15, paidBudget: 2_000_000 },
  missed: [], waiting: [], newLeads: [], hotDeals: [],
  overdue: { count: 0, older30: 0, oldest: null },
  ...over,
})

describe('«Сделай сегодня»', () => {
  it('перезвон клиенту с КП — первым; один клиент — один пункт', () => {
    const { focus } = buildFocus(facts({
      missed: [{ phone: '9264393479', at: NOW - H, attempts: 3, leadId: 39132991, leadName: 'шторка на ванну', stage: 'Продажи → Кп отправлено', url: 'https://x/leads/detail/39132991', kind: 'deal' }],
      waiting: [{ leadId: 39132991, leadName: 'шторка на ванну', stage: 'Продажи → Кп отправлено', url: 'u', at: NOW - 2 * H }],
      newLeads: [{ leadId: 5, leadName: 'Заявка', stage: 'новая', url: 'u5', at: NOW - 3 * H }],
    }), NOW)
    expect(focus.map(f => f.kind)).toEqual(['missed_call', 'new_lead'])
    expect(focus[0].title).toBe('Перезвони +7 926 439-34-79')
    expect(focus[0].detail).toContain('звонил 3 раза, последний сегодня в 17:00')
  })

  it('номер без amo — ссылка tel:, чтобы позвонить в один тап', () => {
    const { focus } = buildFocus(facts({ missed: [{ phone: '9260255476', at: NOW - H, attempts: 1, leadId: null, leadName: null, stage: null, url: null, kind: 'none' }] }), NOW)
    expect(focus[0].url).toBe('tel:+79260255476')
    expect(focus[0].detail).toContain('номера нет в amo')
  })

  it('просроченные — одним пунктом с самой старой задачей', () => {
    const { focus } = buildFocus(facts({ overdue: { count: 113, older30: 51, oldest: { text: 'перезвонить', dueAt: NOW - 40 * 86400, url: 'u' } } }), NOW)
    expect(focus).toHaveLength(1)
    expect(focus[0].title).toBe('Разбери просроченные задачи: 113')
  })

  it('не больше лимита, остальное — числом', () => {
    const newLeads = Array.from({ length: 10 }, (_, i) => ({ leadId: i + 1, leadName: `З${i}`, stage: 's', url: 'u', at: NOW - i * H }))
    const r = buildFocus(facts({ newLeads }), NOW)
    expect(r.focus).toHaveLength(FOCUS_LIMIT)
    expect(r.more).toBe(10 - FOCUS_LIMIT)
  })

  it('десять чатов не вытесняют горячие сделки и новые заявки', () => {
    const waiting = Array.from({ length: 10 }, (_, i) => ({ leadId: 100 + i, leadName: `Ч${i}`, stage: 'Проработка', url: 'u', at: NOW - (i + 1) * H }))
    const { focus } = buildFocus(facts({
      waiting,
      newLeads: [{ leadId: 5, leadName: 'Заявка', stage: 'новая', url: 'u', at: NOW - H }],
      hotDeals: [{ leadId: 6, leadName: 'КП', stage: 'Продажи → Кп отправлено', url: 'u', at: NOW - 5 * 86400, price: 300000, lastTouchAt: null }],
      overdue: { count: 20, older30: 2, oldest: { text: 'позвонить', dueAt: NOW - 86400, url: 'u' } },
    }), NOW)
    const kinds = focus.map(f => f.kind)
    // три по квоте плюс добор по весу — но остальные виды в список попали
    expect(kinds.filter(k => k === 'waiting_chat').length).toBeLessThanOrEqual(4)
    expect(kinds).toContain('new_lead')
    expect(kinds).toContain('hot_deal')
    expect(kinds).toContain('overdue_tasks')
  })
})

describe('привычка недели', () => {
  const replies = (fast: number, slow: number) => [...Array(fast).fill(2), ...Array(slow).fill(60)]
  const team = [
    facts({ amoUserId: 2, week: { replies: replies(16, 4), leftWaiting: 0, tasksCompleted: 20, workDays: 5 } }),
    facts({ amoUserId: 3, week: { replies: replies(15, 5), leftWaiting: 1, tasksCompleted: 10, workDays: 5 } }),
  ]
  it('выбирает самый большой разрыв и даёт действие', () => {
    const me = facts({ week: { replies: replies(10, 10), leftWaiting: 6, tasksCompleted: 5, workDays: 5 } })
    const h = pickHabit(me, [me, ...team])!
    expect(h.key).toBe('left_waiting')
    expect(h.fact).toContain('6 клиентов')
    expect(h.action).toContain('Последние 15 минут')
  })
  it('медленный ответ при нормальном вечере — «первые 5 минут» с медианой команды', () => {
    const me = facts({ week: { replies: replies(10, 10), leftWaiting: 0, tasksCompleted: 5, workDays: 5 } })
    const h = pickHabit(me, [me, ...team])!
    expect(h.key).toBe('reply5')
    expect(h.fact).toContain('50%')
    expect(h.target).toContain('75%')
  })
  it('когда всё в норме — привычки нет, а не придуманная', () => {
    expect(pickHabit(facts({ week: { replies: replies(18, 2), leftWaiting: 0, tasksCompleted: 5, workDays: 5 } }), team)).toBeNull()
  })
  it('мало ответов — доля не считается', () => {
    expect(reply5Share([1, 2, 3])).toBeNull()
  })
})

describe('что получается', () => {
  it('конверсия и быстрый первый контакт — по фактам, не больше двух', () => {
    const me = facts({ results: { days: 90, leadsReceived: 121, leadsDaytime: 93, leadsNoContact: 21, firstContactMedianMin: 2, paidDeals: 18, paidBudget: 2_421_710 } })
    const other = facts({ amoUserId: 9, results: { days: 90, leadsReceived: 270, leadsDaytime: 198, leadsNoContact: 42, firstContactMedianMin: 5, paidDeals: 4, paidBudget: 235_000 } })
    const wins = pickWins(me, [me, other])
    expect(wins.length).toBeLessThanOrEqual(2)
    expect(wins[0].title).toBe('Конверсия выше команды')
  })
  it('итог за период всегда есть, даже без успехов', () => {
    const c = coach(facts({ results: { days: 90, leadsReceived: 5, leadsDaytime: 3, leadsNoContact: 0, firstContactMedianMin: null, paidDeals: 0, paidBudget: 0 } }), [], NOW)
    expect(c.results).toEqual({ days: 90, leads: 5, paidDeals: 0, paidBudget: 0, per100: null })
  })
})
