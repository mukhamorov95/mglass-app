import { describe, it, expect } from 'vitest'
import * as mgmt from '@/scripts/lib/managerStatsParse.mjs'

type Fact = { stat_date: string; manager: string; metric: string; value: number }
const { normalizeManager, parseNumber } = mgmt
const dayColumns = mgmt.dayColumns as (h: string[]) => { i: number; date: string }[]
const parseManagerStats = mgmt.parseManagerStats as (rows: string[][]) =>
  { facts: Fact[]; unknown: string[]; days: number }

describe('управленческая книга: колонки и имена', () => {
  it('день получает год из колонки-маркера, а не из головы', () => {
    const cols = dayColumns(['', 'Откуда брать данные?', 'р.2 024', '', '01.07', '02.07', '', 'р.2 026', '', '01.02'])
    expect(cols).toEqual([
      { i: 4, date: '2024-07-01' }, { i: 5, date: '2024-07-02' }, { i: 9, date: '2026-02-01' },
    ])
  })

  it('до первого маркера года дни не считаются — иначе год угадывается', () => {
    expect(dayColumns(['', '01.07', '02.07'])).toEqual([])
  })

  it('имена приводятся к написанию книги продаж', () => {
    expect(normalizeManager('Саша')).toBe('Александра')
    expect(normalizeManager('Семен')).toBe('Семён')
    expect(normalizeManager(' яна ')).toBe('Яна')
    expect(normalizeManager('ИТОГО')).toBeNull()
  })

  it('числа: проценты и рубли читаются, пустое — не ноль', () => {
    expect(parseNumber('р.139 075')).toBe(139075)
    expect(parseNumber('31')).toBe(31)
    expect(parseNumber('')).toBeNull()
  })
})

const ROWS: string[][] = [
  ['', 'Откуда брать данные?', 'р.2 026', '', '01.09', '02.09'],
  ['РАЗГОВОР', 'Аналитика - фильтр - разговоры', 'р.2 227', '381', '24', '18'],
  ['Айжан', '', '', '', '11', '8'],
  ['Саша', '', '', '', '7', ''],
  ['Пётр', '', '', '', '3', '1'],
  ['Конверсия из ЗАЯВКИ В ЗАМЕР', '', '', '', '50%', '40%'],
  ['ЗАМЕР  назначен Новый', '', '', '', '2', '1'],
  ['Айжан', '', '', '', '2', '1'],
  ['Средний чек', '', '', '', '100', '200'],
  ['сумма полученных денег ВСЕГО', '', '', '', 'р.198 921', ''],
  ['Айжан', '', '', '', 'р.198 921', ''],
]

describe('управленческая книга: разбор фактов', () => {
  it('факты берутся по дням, нули и пустые не пишутся', () => {
    const { facts } = parseManagerStats(ROWS)
    expect(facts).toContainEqual({ stat_date: '2026-09-01', manager: 'Айжан', metric: 'talks', value: 11 })
    expect(facts).toContainEqual({ stat_date: '2026-09-02', manager: 'Айжан', metric: 'talks', value: 8 })
    expect(facts).toContainEqual({ stat_date: '2026-09-01', manager: 'Александра', metric: 'talks', value: 7 })
    // у Саши второй день пустой — строки быть не должно
    expect(facts.find(f => f.manager === 'Александра' && f.stat_date === '2026-09-02')).toBeUndefined()
  })

  it('итог строки показателя в факты не попадает — иначе всё удвоится', () => {
    const { facts } = parseManagerStats(ROWS)
    const day1 = facts.filter(f => f.metric === 'talks' && f.stat_date === '2026-09-01')
    expect(day1.reduce((s, f) => s + f.value, 0)).toBe(18) // 11 + 7, без строки «РАЗГОВОР» 24
  })

  it('подытоги закрывают блок, а незнакомый человек не теряется молча', () => {
    const { facts, unknown } = parseManagerStats(ROWS)
    expect(unknown).toContain('talks: Пётр')
    // «Средний чек» закрыл блок замеров: его числа в замеры не попали
    expect(facts.filter(f => f.metric === 'measure_assigned')).toHaveLength(2)
    expect(facts).toContainEqual({ stat_date: '2026-09-01', manager: 'Айжан', metric: 'money_total', value: 198921 })
  })
})
