import { describe, it, expect } from 'vitest'
import { selectRecipients, type ReviewLead, type ReviewContact } from '@/lib/reviewEligibility'
import { buildMessage, mskMidnightIso } from '@/lib/reviewMessage'

const contact = (id: number, type: string, phone: string, name = 'Анна Петрова'): ReviewContact => ({
  id, name,
  custom_fields_values: [
    { field_name: 'Телефон', field_code: 'PHONE', values: [{ value: phone }] },
    { field_name: 'Тип контакта', values: [{ value: type }] },
  ],
})
const lead = (id: number, contactIds: number[], extra: Partial<ReviewLead> = {}, fields: Record<string, string> = {}): ReviewLead => ({
  id, name: `Сделка ${id}`, price: 50000, closed_at: 1_790_000_000 + id, updated_at: 0,
  custom_fields_values: Object.entries(fields).map(([field_name, value]) => ({ field_name, values: [{ value }] })),
  ...extra,
  _embedded: { contacts: contactIds.map(id => ({ id })), ...extra._embedded },
})

describe('selectRecipients', () => {
  it('пишет заказчику, даже если первым в сделке стоит дизайнер', () => {
    const { rows } = selectRecipients(
      [lead(1, [10, 11])],
      [contact(10, 'Дизайнер', '+7 916 000-00-01'), contact(11, 'Заказчик', '8 (916) 000-00-02')],
      new Set(),
    )
    expect(rows.map(r => r.phone)).toEqual(['79160000002'])
  })

  it('не пишет дизайнеру, партнёру и прорабу — нет заказчика, нет сообщения', () => {
    const { rows, skipped } = selectRecipients(
      [lead(1, [10]), lead(2, [11]), lead(3, [12]), lead(4, [])],
      [contact(10, 'Дизайнер', '79160000001'), contact(11, 'Партнер', '79160000002'), contact(12, 'Прораб', '79160000003')],
      new Set(),
    )
    expect(rows).toEqual([])
    expect(skipped.no_customer).toBe(4)
  })

  it('не выходит на клиента партнёрской сделки — по источнику, тегу и «Дизайнерским»', () => {
    const c = [contact(10, 'Заказчик', '79160000001'), contact(11, 'Заказчик', '79160000002'), contact(12, 'Заказчик', '79160000003')]
    const { rows, skipped } = selectRecipients([
      lead(1, [10], {}, { 'ИСТОЧНИК СДЕЛКИ': 'Партнёр' }),
      lead(2, [11], { _embedded: { tags: [{ name: 'Дизайнер' }] } }),
      lead(3, [12], {}, { 'Дизайнерские': '7500' }),
    ], c, new Set())
    expect(rows).toEqual([])
    expect(skipped.partner).toBe(3)
  })

  it('«Дизайнерские» = 0 партнёрской сделку не делает', () => {
    const { rows } = selectRecipients([lead(1, [10], {}, { 'Дизайнерские': '0' })], [contact(10, 'Заказчик', '79160000001')], new Set())
    expect(rows).toHaveLength(1)
  })

  it('один человек — одна строка, про последний заказ', () => {
    const { rows, skipped } = selectRecipients(
      [lead(1, [10]), lead(5, [11])],
      [contact(10, 'Заказчик', '79160000001'), contact(11, 'Заказчик', '+79160000001')],
      new Set(),
    )
    expect(rows.map(r => r.amo_lead_id)).toEqual([5])
    expect(skipped.duplicate).toBe(1)
  })

  it('тому, кто уже в очереди или кому писали, повторно не ставит', () => {
    const { rows, skipped } = selectRecipients([lead(1, [10])], [contact(10, 'Заказчик', '79160000001')], new Set(['79160000001']))
    expect(rows).toEqual([])
    expect(skipped.asked_before).toBe(1)
  })

  it('с рекламацией по последнему заказу — не пишем', () => {
    const { rows, skipped } = selectRecipients(
      [lead(1, [10], {}, { 'Была рекламация?': 'Да' })],
      [contact(10, 'Заказчик', '79160000001')],
      new Set(),
    )
    expect(rows).toEqual([])
    expect(skipped.complaint).toBe(1)
  })
})

describe('buildMessage', () => {
  it('без скидки за отзыв и без подсказки оценки — правила Яндекса', () => {
    const t = buildMessage('Светлана', '2026-09-10')
    expect(t).toMatch(/^Здравствуйте, Светлана!/)
    expect(t).toContain('в сентябре')
    expect(t).not.toMatch(/скидк|бонус|%|хорошего/i)
    expect(t).toContain('yandex.ru/maps/org/')
  })
})

describe('mskMidnightIso', () => {
  it('сутки начинаются в полночь по Москве, а не по UTC', () => {
    // 05.10 01:30 МСК = 04.10 22:30 UTC — уже новые сутки
    expect(mskMidnightIso(Date.parse('2026-10-04T22:30:00Z'))).toBe('2026-10-04T21:00:00.000Z')
    expect(mskMidnightIso(Date.parse('2026-10-05T20:59:00Z'))).toBe('2026-10-04T21:00:00.000Z')
  })
})
