import { describe, it, expect } from 'vitest'
import { getApplicableStages } from '@/lib/productionStages'
import { buildItemRoute } from '@/lib/productionRouting'

const keys = (item: Parameters<typeof getApplicableStages>[0]) =>
  getApplicableStages(item).map(s => s.key)

describe('песочка как этап маршрута', () => {
  it('не выбрана — детали в маршруте нет', () => {
    expect(keys({ hasHoles: false })).not.toContain('sandblast')
  })

  it('выбрана — этап появляется', () => {
    expect(keys({ hasHoles: false, hasSandblast: true })).toContain('sandblast')
  })

  it('идёт до закалки: калёное стекло не пескоструят', () => {
    const r = keys({ hasSandblast: true, hasTempering: true, materialName: 'Стекло 8мм' })
    expect(r.indexOf('sandblast')).toBeLessThan(r.indexOf('tempering'))
  })

  it('идёт после резки — песочат уже раскроенное стекло', () => {
    const r = keys({ hasSandblast: true })
    expect(r.indexOf('cutting')).toBeLessThan(r.indexOf('sandblast'))
  })

  it('старые позиции без поля маршрут не меняют', () => {
    expect(keys({ hasHoles: true })).toEqual(['cutting', 'polishing', 'drilling', 'packaging'])
  })

  it('маршрут нумеруется подряд вместе с песочкой', () => {
    const route = buildItemRoute({ hasHoles: true, hasSandblast: true })
    expect(route.map(r => r.sequenceOrder)).toEqual(route.map((_, i) => i + 1))
    expect(route.map(r => r.stageKey)).toContain('sandblast')
  })
})

describe('вырезы ведут на станцию сверловки', () => {
  it('вырез без отверстий всё равно доводит деталь до сверловщика', () => {
    // Раньше признак ставился только по отверстиям, и такая деталь проходила мимо него.
    expect(keys({ hasHoles: false, hasCutouts: true })).toContain('drilling')
  })

  it('ни отверстий, ни вырезов — сверловка отпадает', () => {
    expect(keys({ hasHoles: false, hasCutouts: false })).not.toContain('drilling')
  })

  it('отверстия и вырезы вместе дают ОДНУ задачу, а не две', () => {
    const r = keys({ hasHoles: true, hasCutouts: true })
    expect(r.filter(k => k === 'drilling')).toHaveLength(1)
  })
})

describe('признаки изделия определяют маршрут', () => {
  it('криволинейка только при shape=curved', () => {
    expect(keys({ shape: 'curved' })).toContain('curved')
    expect(keys({ shape: 'rect' })).not.toContain('curved')
  })

  it('сверление отпадает, когда отверстий явно нет', () => {
    expect(keys({ hasHoles: false })).not.toContain('drilling')
    expect(keys({ hasHoles: true })).toContain('drilling')
  })
})
