import { describe, it, expect } from 'vitest'
import { copyList, ordersCount, packedOn, shippedOn, stageDayKey, unpackedPieces, type DayOrder } from '@/lib/production/dayLists'

const o = (id: number, packagedAt: unknown, shippedAt: unknown): DayOrder =>
  ({ id, number: `00${id}`, client: 'Клиент', packagedAt, shippedAt })

describe('день отметки', () => {
  it('дата без времени берётся как есть', () => {
    expect(stageDayKey('2026-09-01')).toBe('2026-09-01')
  })

  it('полная метка приводится к московскому дню, а не к UTC', () => {
    // 22:30 UTC — это 01:30 следующих суток по Москве. По UTC заказ уехал бы
    // во вчерашний список, и вечерний отчёт разошёлся бы с тем, что видел человек.
    expect(stageDayKey('2026-09-01T22:30:00.000Z')).toBe('2026-09-02')
    expect(stageDayKey('2026-09-02T10:55:12.062Z')).toBe('2026-09-02')
  })

  it('старое `true` без даты — не сегодня и не когда-либо', () => {
    // 3788 отгрузок записаны голым true. День восстановить неоткуда,
    // и приписывать их сегодняшнему отчёту нельзя.
    expect(stageDayKey('true')).toBeNull()
    expect(stageDayKey(true)).toBeNull()
    expect(stageDayKey(null)).toBeNull()
    expect(stageDayKey('')).toBeNull()
    expect(stageDayKey('позавчера')).toBeNull()
  })
})

describe('списки за день', () => {
  const orders = [
    o(5301, '2026-09-02', null),
    o(5296, '2026-09-02T08:00:00.000Z', '2026-09-02T09:00:00.000Z'),
    o(5264, '2026-09-01', '2026-09-01'),
    o(5100, true, true),
  ]

  it('упаковано сегодня — по дню упаковки, по возрастанию номера', () => {
    expect(packedOn(orders, '2026-09-02').map(r => r.id)).toEqual([5296, 5301])
  })

  it('отгружено сегодня — по дню отгрузки', () => {
    expect(shippedOn(orders, '2026-09-02').map(r => r.id)).toEqual([5296])
  })

  it('заказы со старым `true` не попадают ни в один день', () => {
    expect(packedOn(orders, '2026-09-02').some(r => r.id === 5100)).toBe(false)
    expect(shippedOn(orders, '2026-09-01').some(r => r.id === 5100)).toBe(false)
  })
})

describe('остаток по упаковке', () => {
  const t = (item_index: number, status: string, station = 'packaging') => ({ item_index, station, status })

  it('считает штуки, а не позиции', () => {
    const qty = new Map([[0, 3], [1, 1]])
    expect(unpackedPieces([t(0, 'queued'), t(1, 'done')], qty)).toBe(3)
  })

  it('всё упаковано — ноль, и хвост в текст не попадёт', () => {
    expect(unpackedPieces([t(0, 'done'), t(1, 'done')], new Map([[0, 2], [1, 2]]))).toBe(0)
  })

  it('задач упаковки нет вовсе — null, а не ноль', () => {
    // Ноль читался бы как «всё упаковано», хотя считать было не из чего.
    expect(unpackedPieces([t(0, 'done', 'cutting')], new Map())).toBeNull()
    expect(unpackedPieces([], new Map())).toBeNull()
  })

  it('позиция без известного количества считается за одну штуку', () => {
    expect(unpackedPieces([t(4, 'queued')], new Map())).toBe(1)
  })
})

describe('текст для вставки', () => {
  it('номера в столбик, ничего лишнего', () => {
    expect(copyList([{ number: '005313' }, { number: '005314' }])).toBe('005313\n005314')
  })

  it('остаток дописывается только там, где он есть в данных', () => {
    expect(copyList([{ number: '005313', remaining: 0 }, { number: '05264', remaining: 6 }, { number: '005320', remaining: null }]))
      .toBe('005313\n05264( осталось 6 шт)\n005320')
  })

  it('пустой список — пустая строка, а не заголовок', () => {
    expect(copyList([])).toBe('')
  })
})

describe('склонение в подписи списка', () => {
  const plural = ordersCount

  it('единица, кроме одиннадцати', () => {
    expect(plural(1)).toBe('1 заказ')
    expect(plural(21)).toBe('21 заказ')
    expect(plural(11)).toBe('11 заказов')
  })

  it('от двух до четырёх, кроме подростковых', () => {
    expect(plural(3)).toBe('3 заказа')
    expect(plural(22)).toBe('22 заказа')
    expect(plural(13)).toBe('13 заказов')
  })

  it('остальные', () => {
    expect(plural(5)).toBe('5 заказов')
    expect(plural(0)).toBe('0 заказов')
  })
})
