import { describe, it, expect } from 'vitest'
import {
  buildGroups, buildNameIndex, attribute, summarize, byMonth, ranking, presetPeriod, isDayKey,
  groupKeyOf, UNKNOWN_KEY, bySource, NO_SOURCE, NO_CARD, type ReportClientCard, type ReportOrderRow,
} from '@/lib/b2b/clientReport'

const cards: ReportClientCard[] = [
  { id: 1, name: 'M GLASS' },
  { id: 9, name: 'ООО МОНАРХ' },
  { id: 10, name: 'MR GLASS (ООО ЛЮДИ)' },
  { id: 26, name: 'ВРНГЛАЗИЕРС' },
  { id: 40, name: 'СпецМонтаж' },
  { id: 41, name: 'Альфа' },
  { id: 42, name: 'Бета' },
]
const entities = [
  { client_id: 40, full_name: 'ООО «СпецМонтаж Групп»' },
  // Одно юрлицо на двух карточках — имя неоднозначное, по нему не привязываем.
  { client_id: 41, full_name: 'ИП Общий' },
  { client_id: 42, full_name: 'ИП Общий' },
]
const groups = buildGroups(cards)
const byId = new Map(cards.map(c => [c.id, c]))
const idx = buildNameIndex(cards, entities)
const row = (p: Partial<ReportOrderRow>): ReportOrderRow => ({
  id: 1, client_id: null, client_name: null, launched_at: '2026-09-01', total_after_discount: 1000, ...p,
})

describe('клиент — группа карточек', () => {
  it('три карточки MR GLASS сходятся в одного клиента', () => {
    const g = groups.get(groupKeyOf('MR GLASS (ООО ЛЮДИ)'))!
    expect(g.label).toBe('MR GLASS')
    expect(g.cardIds.sort((a, b) => a - b)).toEqual([9, 10, 26])
  })
  it('M GLASS — своя розница', () => expect(groups.get(groupKeyOf('M GLASS'))!.ownRetail).toBe(true))
  it('обычный клиент — своё имя', () => expect(groups.get(groupKeyOf('СпецМонтаж'))!.label).toBe('СпецМонтаж'))
})

describe('чей заказ', () => {
  it('по карточке', () => {
    const a = attribute(row({ client_id: 26 }), byId, idx)
    expect(a.groupKey).toBe(groupKeyOf('MR GLASS')); expect(a.byName).toBe(false)
  })
  it('без карточки — по названию клиента, регистр и пробелы не важны', () => {
    const a = attribute(row({ client_name: '  спецмонтаж ' }), byId, idx)
    expect(a.groupKey).toBe(groupKeyOf('СпецМонтаж')); expect(a.byName).toBe(true)
  })
  it('без карточки — по названию юрлица', () => {
    expect(attribute(row({ client_name: 'ООО «СпецМонтаж Групп»' }), byId, idx).groupKey).toBe(groupKeyOf('СпецМонтаж'))
  })
  it('без карточки — по псевдониму из списка владельца', () => {
    expect(attribute(row({ client_name: 'ООО ЛЮДИ' }), byId, idx).groupKey).toBe(groupKeyOf('MR GLASS'))
  })
  it('имя на двух карточках — не привязываем к чужому', () => {
    const a = attribute(row({ client_name: 'ИП Общий' }), byId, idx)
    expect(a.groupKey).toBe('n:ИП ОБЩИЙ'); expect(a.byName).toBe(false)
  })
  it('«Без клиента», «-» и пусто — одна строка «не указан»', () => {
    for (const n of ['Без клиента', '-', '', null, 'Клиент не указан']) {
      expect(attribute(row({ client_name: n }), byId, idx).groupKey).toBe(UNKNOWN_KEY)
    }
  })
  it('незнакомое имя — своя строка без карточки', () => {
    expect(attribute(row({ client_name: 'Константин' }), byId, idx).groupKey).toBe('n:КОНСТАНТИН')
  })
  it('сумма — после скидки, иначе с НДС', () => {
    expect(attribute(row({ total_after_discount: null, total_sale_inc_vat: 500 }), byId, idx).amount).toBe(500)
  })
})

describe('итоги', () => {
  const rows = [
    { launched_at: '2026-08-10', amount: 1000 },
    { launched_at: '2026-09-01', amount: 3000 },
    { launched_at: '2026-09-20', amount: 0 },
  ]
  it('средний чек — без нулевых заказов', () => expect(summarize(rows)).toEqual({ orders: 3, sum: 4000, avg: 2000 }))
  it('пусто — нули, а не NaN', () => expect(summarize([])).toEqual({ orders: 0, sum: 0, avg: 0 }))
  it('по месяцам, свежие сверху, сумма месяцев = итог', () => {
    const m = byMonth(rows)
    expect(m.map(x => x.month)).toEqual(['2026-09', '2026-08'])
    expect(m.reduce((s, x) => s + x.sum, 0)).toBe(summarize(rows).sum)
  })
  it('рейтинг: крупные сверху, сумма строк = итог', () => {
    const att = [
      row({ id: 1, client_id: 10, total_after_discount: 5000 }),
      row({ id: 2, client_id: 9, total_after_discount: 1000 }),
      row({ id: 3, client_id: 40, total_after_discount: 2000 }),
      row({ id: 4, client_name: 'Константин', total_after_discount: 700 }),
    ].map(r => attribute(r, byId, idx))
    const r = ranking(att, groups)
    expect(r.map(x => x.label)).toEqual(['MR GLASS', 'СпецМонтаж', 'Константин'])
    expect(r[0]).toMatchObject({ orders: 2, sum: 6000, merged: 3, hasCard: true })
    expect(r[2].hasCard).toBe(false)
    expect(r.reduce((s, x) => s + x.sum, 0)).toBe(summarize(att).sum)
  })
})

describe('по источникам', () => {
  const src: ReportClientCard[] = [
    { id: 9, name: 'ООО МОНАРХ', crm_source: null },
    { id: 10, name: 'MR GLASS (ООО ЛЮДИ)', crm_source: 'referral' },
    { id: 26, name: 'ВРНГЛАЗИЕРС', crm_source: 'avito' },
    { id: 40, name: 'СпецМонтаж', crm_source: 'avito' },
    { id: 41, name: 'Альфа', crm_source: null },
  ]
  const g = buildGroups(src)
  const ids = new Map(src.map(c => [c.id, c]))
  const ix = buildNameIndex(src, [])
  const att = [
    row({ id: 1, client_id: 9, total_after_discount: 5000 }),
    row({ id: 2, client_id: 26, total_after_discount: 1000 }),
    row({ id: 3, client_id: 40, total_after_discount: 2000 }),
    row({ id: 4, client_id: 40, total_after_discount: 500 }),
    row({ id: 5, client_id: 41, total_after_discount: 300 }),
    row({ id: 6, client_name: 'Константин', total_after_discount: 700 }),
    row({ id: 7, client_name: 'Без клиента', total_after_discount: 100 }),
  ].map(r => attribute(r, ids, ix))
  const s = bySource(att, g, ids)
  const by = Object.fromEntries(s.map(x => [x.source, x]))

  it('группа берёт метку самой старой карточки, где она стоит', () => {
    // MR GLASS: карточка 9 без метки, 10 — referral, 26 — avito → referral.
    expect(by.referral).toEqual({ source: 'referral', clients: 1, orders: 2, sum: 6000 })
  })
  it('клиенты считаются группами, а не заказами', () =>
    expect(by.avito).toEqual({ source: 'avito', clients: 1, orders: 2, sum: 2500 }))
  it('карточка без метки — «не указан», заказ без карточки — отдельно', () => {
    expect(by[NO_SOURCE]).toMatchObject({ clients: 1, orders: 1, sum: 300 })
    // «Клиент не указан» — не клиент: в счёт клиентов не идёт, деньги остаются.
    expect(by[NO_CARD]).toMatchObject({ clients: 1, orders: 2, sum: 800 })
  })
  it('сумма строк = итог периода', () =>
    expect(s.reduce((a, x) => a + x.sum, 0)).toBe(summarize(att).sum))
})

describe('периоды', () => {
  const today = '2026-09-30'
  it('этот месяц', () => expect(presetPeriod('month', today)).toEqual({ from: '2026-09-01', to: today }))
  it('прошлый месяц — до последнего дня', () => expect(presetPeriod('prev_month', today)).toEqual({ from: '2026-08-01', to: '2026-08-31' }))
  it('прошлый месяц в январе — декабрь прошлого года', () => expect(presetPeriod('prev_month', '2027-01-15')).toEqual({ from: '2026-12-01', to: '2026-12-31' }))
  it('квартал', () => expect(presetPeriod('quarter', today)).toEqual({ from: '2026-07-01', to: today }))
  it('прошлый год', () => expect(presetPeriod('prev_year', today)).toEqual({ from: '2025-01-01', to: '2025-12-31' }))
  it('февраль високосного года', () => expect(presetPeriod('prev_month', '2028-03-10').to).toBe('2028-02-29'))
  it('дата из адреса проверяется', () => {
    expect(isDayKey('2026-09-30')).toBe(true)
    expect(isDayKey('2026-9-30')).toBe(false)
    expect(isDayKey("2026-09-30' or 1=1")).toBe(false)
  })
})
