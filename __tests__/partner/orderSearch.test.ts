import { describe, expect, it } from 'vitest'
import { cleanClientNo, matchesOrder, unpaidFirst } from '@/lib/partner/orderSearch'

describe('поиск заказа в кабинете', () => {
  const o = { number: '05831', clientOrderNumber: 'СГ-1207', amount: 16623, summary: 'Мору бронза 8мм' }
  it('по нашему номеру, в том числе без ведущего нуля', () => {
    expect(matchesOrder(o, '05831')).toBe(true)
    expect(matchesOrder(o, '5831')).toBe(true)
  })
  it('по номеру клиента', () => {
    expect(matchesOrder(o, 'сг-1207')).toBe(true)
    expect(matchesOrder(o, '1207')).toBe(true)
  })
  it('мимо', () => expect(matchesOrder(o, '9999')).toBe(false))
  it('неоплаченные первыми, порядок внутри сохраняется', () => {
    const list = [{ id: 1, payment: { status: 'paid' as const } }, { id: 2, payment: { status: 'awaiting' as const, total: 1 } }, { id: 3, payment: null }, { id: 4, payment: { status: 'partial' as const, paid: 1, total: 2, remainder: 1 } }]
    expect(unpaidFirst(list).map(x => x.id)).toEqual([2, 4, 1, 3])
  })
  it('номер клиента чистится и режется', () => {
    expect(cleanClientNo('  СГ  12 ')).toBe('СГ 12')
    expect(cleanClientNo('   ')).toBeNull()
    expect(cleanClientNo(5)).toBeNull()
  })
})
