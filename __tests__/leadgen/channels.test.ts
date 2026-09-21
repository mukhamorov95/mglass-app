import { describe, it, expect } from 'vitest'
import { amoStageZone } from '@/lib/funnelZones'
import {
  leadSource, channelGroup, outcome, buildChannelTable, buildMonthly, daysToWin,
  roundPreservingSum, thousandsTable, monthsBetween, moscowMonth, UNKNOWN_SOURCE,
  type ChannelLead,
} from '@/lib/leadgen/channels'

const STAGES: Record<number, string> = {
  1: 'Разговор состоялся',
  2: 'замер назначен',
  3: 'Кп отправлено',
  4: 'счёт Оплачен',
  5: 'оплата дизайнерам',
  6: 'отложенный спрос',
}
const zoneOf = (id: number) => (STAGES[id] ? amoStageZone(STAGES[id]) : null)
const ts = (iso: string) => Math.floor(Date.parse(iso) / 1000)

let seq = 0
function lead(o: { source?: string; tags?: string[]; status: number; price?: number; at?: string; yclid?: boolean; closedAt?: string }): ChannelLead {
  const cf: ChannelLead['custom_fields_values'] = []
  if (o.source !== undefined) cf.push({ field_name: 'ИСТОЧНИК СДЕЛКИ', values: [{ value: o.source }] })
  if (o.yclid) cf.push({ field_name: 'yclid', values: [{ value: '123' }] })
  return {
    id: ++seq,
    price: o.price ?? 0,
    status_id: o.status,
    created_at: ts(o.at ?? '2026-05-10T12:00:00+03:00'),
    closed_at: o.closedAt ? ts(o.closedAt) : null,
    custom_fields_values: cf,
    _embedded: { tags: (o.tags ?? []).map(name => ({ name })) },
  }
}

describe('amoStageZone', () => {
  it('раскладывает этапы AmoCRM по зонам из SYSTEM.md', () => {
    expect(amoStageZone('Разговор состоялся')).toBe(1)
    expect(amoStageZone('Чертежи в Работу')).toBe(2)
    expect(amoStageZone('Счет выставлен - ждем оплату')).toBe(2)
    expect(amoStageZone('ОПлата получена - Проверка чертежей')).toBe(3)
    expect(amoStageZone('отложенный спрос')).toBeNull()
  })

  it('«оплата дизайнерам» из AmoCRM попадает в зону 3, как «Оплата дизайнером» в таблице', () => {
    expect(amoStageZone('оплата дизайнерам')).toBe(3)
    expect(amoStageZone('Оплата дизайнером')).toBe(3)
  })
})

describe('leadSource', () => {
  it('берёт поле и схлопывает пробелы', () => {
    expect(leadSource(lead({ source: 'сайт  mglass.pro', status: 1 }))).toBe('сайт mglass.pro')
  })
  it('без поля — по известному тегу', () => {
    expect(leadSource(lead({ tags: ['WZ (MGlass 1)', 'Авито'], status: 1 }))).toBe('Авито')
    expect(leadSource(lead({ tags: ['Дизайнер'], status: 1 }))).toBe('Партнёр')
  })
  it('без поля и без известного тега — «не указан»', () => {
    expect(leadSource(lead({ tags: ['Входящий'], status: 1 }))).toBe(UNKNOWN_SOURCE)
  })
})

describe('channelGroup', () => {
  it('группирует значения поля по смыслу', () => {
    expect(channelGroup('Партнёр')).toBe('relations')
    expect(channelGroup('По рекомендации')).toBe('relations')
    expect(channelGroup('Повторный заказ')).toBe('relations')
    expect(channelGroup('Ватсап/Телеграмм с сайта')).toBe('site')
    expect(channelGroup('Звонок Входящий на ГОРОДСКОЙ')).toBe('site')
    expect(channelGroup('Энвибокс')).toBe('site')
    expect(channelGroup('Авито')).toBe('avito')
    expect(channelGroup('Инстаграмм')).toBe('other')
    expect(channelGroup(UNKNOWN_SOURCE)).toBe('unknown')
  })
})

describe('outcome', () => {
  it('оплачено — зона 3 или «реализовано успешно»; до замера — зона 2 и дальше', () => {
    expect(outcome(lead({ status: 142 }), zoneOf)).toEqual({ paid: true, measured: true })
    expect(outcome(lead({ status: 5 }), zoneOf)).toEqual({ paid: true, measured: true })
    expect(outcome(lead({ status: 3 }), zoneOf)).toEqual({ paid: false, measured: true })
    expect(outcome(lead({ status: 1 }), zoneOf)).toEqual({ paid: false, measured: false })
    expect(outcome(lead({ status: 143 }), zoneOf)).toEqual({ paid: false, measured: false })
    expect(outcome(lead({ status: 6 }), zoneOf)).toEqual({ paid: false, measured: false })
  })
})

describe('buildChannelTable', () => {
  const leads = [
    lead({ source: 'Партнёр', status: 4, price: 200_000 }),
    lead({ source: 'Партнёр', status: 1 }),
    lead({ source: 'По рекомендации', status: 142, price: 150_000 }),
    lead({ source: 'Авито', status: 143 }),
    lead({ source: 'Авито', status: 2 }),
    lead({ source: 'сайт стеклянные-перегородки.рф', status: 142, price: 100_000, yclid: true }),
    lead({ tags: [], status: 1 }),
    lead({ source: 'Партнёр', status: 142, price: 999_999, at: '2026-03-15T12:00:00+03:00' }),
  ]
  const t = buildChannelTable(leads, zoneOf, '2026-04', '2026-07')

  it('считает только сделки окна', () => {
    expect(t.total.deals).toBe(7)
    expect(t.total.paid).toBe(3)
    expect(t.total.paidSum).toBe(450_000)
  })

  it('строка группы — сумма её строк, группы — итог', () => {
    const rel = t.groups.find(g => g.group === 'relations')!
    expect(rel.rows.map(r => r.source)).toEqual(['Партнёр', 'По рекомендации'])
    expect(rel.stats).toEqual({ deals: 3, measured: 2, paid: 2, paidSum: 350_000, lost: 0 })
    const sumDeals = t.groups.reduce((s, g) => s + g.stats.deals, 0)
    expect(sumDeals).toBe(t.total.deals)
    expect(t.groups.map(g => g.group)).toEqual(['relations', 'site', 'avito', 'unknown'])
  })

  it('Директ — срез поверх каналов, а не отдельный канал', () => {
    expect(t.direct).toEqual({ deals: 1, measured: 1, paid: 1, paidSum: 100_000, lost: 0 })
  })

  it('месяц берётся по Москве', () => {
    expect(moscowMonth(ts('2026-03-31T21:30:00Z'))).toBe('2026-04')
    const edge = lead({ source: 'Авито', status: 1, at: '2026-03-31T21:30:00Z' })
    expect(buildChannelTable([edge], zoneOf, '2026-04', '2026-04').total.deals).toBe(1)
  })
})

describe('buildMonthly', () => {
  it('раскладывает по месяцам и группам, итог месяца — все группы', () => {
    const leads = [
      lead({ source: 'Партнёр', status: 142, price: 100_000, at: '2026-05-02T12:00:00+03:00' }),
      lead({ source: 'Авито', status: 1, at: '2026-05-20T12:00:00+03:00' }),
      lead({ source: 'Авито', status: 4, price: 50_000, at: '2026-06-01T12:00:00+03:00' }),
    ]
    const m = buildMonthly(leads, zoneOf, '2026-05', '2026-07')
    expect(m.months).toEqual(['2026-05', '2026-06', '2026-07'])
    expect(m.cell('relations', '2026-05')).toEqual({ deals: 1, paid: 1, paidSum: 100_000 })
    expect(m.cell('total', '2026-05')).toEqual({ deals: 2, paid: 1, paidSum: 100_000 })
    expect(m.cell('avito', '2026-06')).toEqual({ deals: 1, paid: 1, paidSum: 50_000 })
    expect(m.cell('total', '2026-07')).toEqual({ deals: 0, paid: 0, paidSum: 0 })
  })
})

describe('monthsBetween', () => {
  it('переходит через год', () => {
    expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })
})

describe('daysToWin', () => {
  it('медиана и квартили по «реализовано успешно»', () => {
    const leads = [10, 20, 30, 40, 50].map(d => lead({
      status: 142, at: '2026-01-01T12:00:00+03:00',
      closedAt: new Date(Date.parse('2026-01-01T12:00:00+03:00') + d * 86400_000).toISOString(),
    }))
    leads.push(lead({ status: 143, closedAt: '2026-02-01T00:00:00Z' }))
    expect(daysToWin(leads)).toEqual({ n: 5, p25: 20, median: 30, p75: 40 })
  })
})

describe('округление денег в тысячи', () => {
  it('строки складываются в итог', () => {
    expect(roundPreservingSum([1.4, 1.4, 1.2], 4)).toEqual([2, 1, 1])
    expect(roundPreservingSum([0.5, 0.5], 1).reduce((s, v) => s + v, 0)).toBe(1)
  })

  it('на цифрах маршрута апрель–июль: строки дают 14 449, а не 14 450', () => {
    const src: [string, number][] = [
      ['Партнёр', 3_940_453], ['Ватсап/Телеграмм с сайта', 2_678_779], ['По рекомендации', 2_433_679],
      ['Повторный заказ', 1_424_713], ['Авито', 1_356_875], ['Энвибокс', 998_950], ['сайт mglass.pro', 684_587],
      ['Инстаграмм', 357_000], ['Сергей Перехват', 270_400], ['сайт стеклянные-перегородки.рф', 182_000],
      ['Звонок Входящий на 38', 77_000], ['Другое', 44_710],
    ]
    const leads = src.map(([source, price]) => lead({ source, status: 142, price }))
    const t = buildChannelTable(leads, zoneOf, '2026-04', '2026-07')
    const k = thousandsTable(t)
    expect(k.total).toBe(14_449)
    expect(k.groups.reduce((s, v) => s + v, 0)).toBe(k.total)
    k.rows.forEach((rows, gi) => expect(rows.reduce((s, v) => s + v, 0)).toBe(k.groups[gi]))
  })
})
