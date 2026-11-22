import { describe, expect, it } from 'vitest'
import { installsOf, managerKey, marginStateOf, sameManager, stageOf, type ObjInstall } from '@/lib/realization/objects'
import type { MarginObject } from '@/lib/sales/marginBook'

const ins = (p: Partial<ObjInstall>): ObjInstall => ({ order_no: null, order_nos: null, scheduled_date: null, status: 'planned', kind: 'install', crew_members: null, ...p })

describe('менеджер книги ↔ учётка', () => {
  it('все имена книги с 01.08 находят свою учётку', () => {
    for (const [book, user] of [['Айжан', 'Айжан'], ['Александра', 'Александра'], ['Яна', 'Яна'], ['Дима', 'Дмитрий'], ['Влад', 'Владислав']]) {
      expect(sameManager(book, user)).toBe(true)
    }
  })
  it('чужое имя и пустое не совпадают', () => {
    expect(sameManager('Яна', 'Айжан')).toBe(false)
    expect(sameManager(null, null)).toBe(false)
    expect(managerKey(' Семён ')).toBe(managerKey('Семен'))
  })
})

describe('стадия объекта', () => {
  const today = '2026-11-22'
  it('выезд по номеру из списка заказов события', () => {
    expect(installsOf('05 812', [ins({ order_nos: ['05812', '05813'] })])).toHaveLength(1)
    expect(installsOf(null, [ins({ order_no: '' })])).toHaveLength(0)
  })
  it('закрыт — сдан, даже без монтажа', () => {
    expect(stageOf(true, [], today).stage).toBe('done')
  })
  it('будущий выезд — монтаж назначен, прошедший — смонтирован', () => {
    expect(stageOf(false, [ins({ scheduled_date: '2026-11-25' })], today)).toEqual({ stage: 'montage_planned', montageDate: '2026-11-25' })
    expect(stageOf(false, [ins({ scheduled_date: '2026-11-10', status: 'done' })], today)).toEqual({ stage: 'mounted', montageDate: '2026-11-10' })
  })
  it('рекламация и отменённый выезд стадию не двигают', () => {
    expect(stageOf(false, [ins({ scheduled_date: '2026-11-25', kind: 'claim' }), ins({ scheduled_date: '2026-11-26', status: 'canceled' })], today).stage).toBe('work')
  })
})

describe('маржа объекта', () => {
  const base = { var_total: 50000, md_pct: 41.2, issues: [] } as unknown as MarginObject
  it('нет в книге и без правок — не внесена', () => {
    expect(marginStateOf(undefined)).toEqual({ kind: 'none' })
    expect(marginStateOf({ ...base, var_total: null })).toEqual({ kind: 'none' })
  })
  it('все обязательные статьи — процент', () => {
    expect(marginStateOf(base)).toEqual({ kind: 'ok', pct: 41.2 })
  })
  it('не все статьи — называем недостающие словами', () => {
    expect(marginStateOf({ ...base, issues: [{ kind: 'missing_costs', keys: ['glass', 'installer'] }] })).toEqual({ kind: 'partial', missing: ['стекло', 'монтажник'] })
  })
})
