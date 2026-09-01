import { describe, it, expect } from 'vitest'
import { isReadyToShip, sortByWaiting, daysWaiting, matchesQuery, type ShipRow } from '@/lib/production/shipping'

const row = (p: Partial<ShipRow>): ShipRow => ({
  id: 1, number: '05300', client: 'ИП Иванов',
  packagedAt: null, shippedAt: null, tasksTotal: 5, tasksDone: 5, ...p,
})

describe('что попадает на экран отгрузки', () => {
  it('упакован и не отгружен — готов', () => {
    expect(isReadyToShip(row({ packagedAt: '2026-08-20T10:00:00Z' }))).toBe(true)
  })

  it('отметки «упакован» нет, но цех закрыл всё — тоже готов', () => {
    // Упаковку отмечают не всегда; закрытые задачи означают то же самое.
    expect(isReadyToShip(row({ packagedAt: null, tasksTotal: 5, tasksDone: 5 }))).toBe(true)
  })

  it('цех ещё не закончил — не готов', () => {
    expect(isReadyToShip(row({ tasksDone: 3 }))).toBe(false)
  })

  it('уже отгружен — с экрана уходит', () => {
    expect(isReadyToShip(row({ packagedAt: '2026-08-20T10:00:00Z', shippedAt: '2026-08-21T09:00:00Z' }))).toBe(false)
  })

  it('заказ без задач цеха и без упаковки не считается готовым', () => {
    expect(isReadyToShip(row({ tasksTotal: 0, tasksDone: 0 }))).toBe(false)
  })
})

describe('порядок: кто ждёт дольше — тот выше', () => {
  it('сортирует от самого давнего', () => {
    const rows = [
      row({ id: 1, packagedAt: '2026-08-25T10:00:00Z' }),
      row({ id: 2, packagedAt: '2026-08-10T10:00:00Z' }),
      row({ id: 3, packagedAt: '2026-08-18T10:00:00Z' }),
    ]
    expect(sortByWaiting(rows).map(r => r.id)).toEqual([2, 3, 1])
  })

  it('без даты упаковки — в конец', () => {
    const rows = [row({ id: 1, packagedAt: null }), row({ id: 2, packagedAt: '2026-08-10T10:00:00Z' })]
    expect(sortByWaiting(rows).map(r => r.id)).toEqual([2, 1])
  })

  it('исходный список не меняется', () => {
    const rows = [row({ id: 1, packagedAt: '2026-08-25T10:00:00Z' }), row({ id: 2, packagedAt: '2026-08-10T10:00:00Z' })]
    sortByWaiting(rows)
    expect(rows.map(r => r.id)).toEqual([1, 2])
  })
})

describe('сколько дней лежит', () => {
  const now = new Date('2026-09-01T12:00:00Z')
  it('считает дни ожидания', () => {
    expect(daysWaiting(row({ packagedAt: '2026-08-25T12:00:00Z' }), now)).toBe(7)
  })
  it('без даты — не выдумывает число', () => {
    expect(daysWaiting(row({ packagedAt: null }), now)).toBeNull()
  })
  it('битую дату не превращает в NaN', () => {
    expect(daysWaiting(row({ packagedAt: 'вчера' }), now)).toBeNull()
  })
})

describe('поиск, когда машина уже приехала', () => {
  const r = row({ number: '05317', client: 'LoLegko' })
  it('по номеру', () => expect(matchesQuery(r, '5317')).toBe(true))
  it('по клиенту, без учёта регистра', () => expect(matchesQuery(r, 'lolegko')).toBe(true))
  it('пустой запрос показывает всё', () => expect(matchesQuery(r, '  ')).toBe(true))
  it('чужой номер не находится', () => expect(matchesQuery(r, '05318')).toBe(false))
})
