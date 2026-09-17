import { describe, it, expect } from 'vitest'
import {
  pickUrgent, daysSince, plurDays, lyingFor, orphanTitle, orphanSpec, orphanTotal, productLabel,
  STALE_SHOWN, type MyDayDeal, type MyDayMeasure, type OrphanCalc,
} from '@/lib/b2c/myDay'

const NOW = new Date('2026-09-17T12:00:00+03:00').getTime()
const DAY = 86_400_000

const deal = (p: Partial<MyDayDeal> & { id: number }): MyDayDeal => ({
  client_name: 'Клиент', phone: null, address: null,
  updated_at: new Date(NOW).toISOString(), next_contact_at: null, ...p,
})
const measure = (p: Partial<MyDayMeasure> & { id: number }): MyDayMeasure => ({
  deal_id: null, client_name: 'Клиент', address: null, scheduled_at: null, status: 'new', ...p,
})

describe('pickUrgent', () => {
  it('обещанный контакт на сегодня и раньше попадает в promised, завтрашний — нет', () => {
    const r = pickUrgent([
      deal({ id: 1, next_contact_at: '2026-09-15' }),
      deal({ id: 2, next_contact_at: '2026-09-17' }),
      deal({ id: 3, next_contact_at: '2026-09-18' }),
    ], [], NOW)
    expect(r.promised.map(d => d.id)).toEqual([1, 2])
  })

  it('сделка с назначенным контактом не считается зависшей', () => {
    const old = new Date(NOW - 30 * DAY).toISOString()
    const r = pickUrgent([
      deal({ id: 1, updated_at: old }),
      deal({ id: 2, updated_at: old, next_contact_at: '2026-09-30' }),
    ], [], NOW)
    expect(r.stale.map(d => d.id)).toEqual([1])
  })

  it('зависшие сортируются от самой старой и итог не врёт при обрезке', () => {
    const deals = Array.from({ length: STALE_SHOWN + 5 }, (_, i) =>
      deal({ id: i + 1, updated_at: new Date(NOW - (40 - i) * DAY).toISOString() }))
    const r = pickUrgent(deals, [], NOW)
    expect(r.stale).toHaveLength(STALE_SHOWN)
    expect(r.staleTotal).toBe(STALE_SHOWN + 5)
    expect(r.stale[0].id).toBe(1)
  })

  it('ровно 7 дней — ещё не зависшая, 7 дней и час — зависшая', () => {
    const r = pickUrgent([
      deal({ id: 1, updated_at: new Date(NOW - 7 * DAY).toISOString() }),
      deal({ id: 2, updated_at: new Date(NOW - 7 * DAY - 3600_000).toISOString() }),
    ], [], NOW)
    expect(r.stale.map(d => d.id)).toEqual([2])
  })

  it('замер сегодня и завтра — в soon, послезавтра — нет', () => {
    const r = pickUrgent([], [
      measure({ id: 1, scheduled_at: '2026-09-17T09:00:00+03:00' }),
      measure({ id: 2, scheduled_at: '2026-09-18T09:00:00+03:00' }),
      measure({ id: 3, scheduled_at: '2026-09-19T09:00:00+03:00' }),
    ], NOW)
    expect(r.soon.map(m => m.id)).toEqual([1, 2])
  })

  it('заявки без даты: самая старая первой', () => {
    const r = pickUrgent([], [
      measure({ id: 1, created_at: '2026-08-03T08:00:00Z' }),
      measure({ id: 2, created_at: '2026-07-06T22:00:00Z' }),
    ], NOW)
    expect(r.unscheduled.map(m => m.id)).toEqual([2, 1])
  })
})

describe('возраст', () => {
  it('daysSince считает целые сутки', () => {
    expect(daysSince(new Date(NOW - 3 * DAY - 3600_000).toISOString(), NOW)).toBe(3)
    expect(daysSince(null, NOW)).toBe(0)
  })
  it('свежий расчёт — «сегодня», не «лежит 0 дней»', () => {
    expect(lyingFor(new Date(NOW - 3600_000).toISOString(), NOW)).toBe('сегодня')
    expect(lyingFor(new Date(NOW - 6 * DAY).toISOString(), NOW)).toBe('лежит 6 дней')
  })
  it('склонение дней', () => {
    expect(plurDays(1)).toBe('1 день')
    expect(plurDays(3)).toBe('3 дня')
    expect(plurDays(11)).toBe('11 дней')
    expect(plurDays(21)).toBe('21 день')
    expect(plurDays(45)).toBe('45 дней')
  })
})

describe('расчёты без клиента', () => {
  const mirror: OrphanCalc = {
    id: 137, created_at: '2026-09-11T09:01:30Z', product_type: 'mirror',
    client_name: null, client_phone: null, final_price: '56688.00',
    client_text: 'Зеркало Осветлённое 4 мм\n\nРазмер:\n1020 × 2150 мм\n\nПодсветка:\nLUX 2835',
  }

  it('заголовок — первая осмысленная строка, остальное раскрывается', () => {
    expect(orphanTitle(mirror)).toBe('Зеркало Осветлённое 4 мм')
    expect(orphanSpec(mirror)).toEqual(['Размер:', '1020 × 2150 мм', 'Подсветка:', 'LUX 2835'])
  })

  it('без текста — тип и номер, чтобы строка не была безымянной', () => {
    expect(orphanTitle({ ...mirror, client_text: null, product_type: 'quick' })).toBe('Быстрый расчёт #137')
    expect(orphanTitle({ ...mirror, client_text: '   \n\n', client_name: 'Галина' })).toBe('Галина')
  })

  it('итог списка = число расчётов и их сумма, считая только те, где сумма есть', () => {
    const t = orphanTotal([mirror, { ...mirror, id: 1, final_price: 1000 }, { ...mirror, id: 2, final_price: null }])
    expect(t).toEqual({ count: 3, sum: 57688, withSum: 2 })
  })

  it('незнакомый тип не превращается в пустую подпись', () => {
    expect(productLabel('railing')).toBe('Ограждение')
    expect(productLabel('нечто')).toBe('нечто')
    expect(productLabel(null)).toBe('Расчёт')
  })
})
