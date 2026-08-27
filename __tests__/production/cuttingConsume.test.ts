import { describe, it, expect } from 'vitest'
import {
  planConsume, shouldConsume, shouldReverse, type CuttingMark,
} from '@/lib/production/cuttingConsume'

const mark = (over: Partial<CuttingMark> = {}): CuttingMark =>
  ({ orderId: 5269, itemIndex: 0, stageKey: 'cutting', source: 'worker', attempt: 0, ...over })

describe('shouldConsume — списываем по живой отметке резки', () => {
  it('рабочий закрыл резку из очереди — списываем', () => {
    expect(shouldConsume(mark())).toBe(true)
  })

  it('карточка заказа и «Всё готово» — тоже живые пути', () => {
    expect(shouldConsume(mark({ source: 'order-card' }))).toBe(true)
    expect(shouldConsume(mark({ source: 'complete-order' }))).toBe(true)
  })

  it('КАСКАД НЕ СПИСЫВАЕТ: он закрывает этапы, которых физически не делали', () => {
    expect(shouldConsume(mark({ source: 'cascade' }))).toBe(false)
  })

  it('другие этапы материал не трогают', () => {
    for (const s of ['polishing', 'tempering', 'packaging', 'drilling']) {
      expect(shouldConsume(mark({ stageKey: s }))).toBe(false)
    }
  })

  it('каскад именно по резке — всё равно нет: решает источник, а не этап', () => {
    expect(shouldConsume(mark({ stageKey: 'cutting', source: 'cascade' }))).toBe(false)
  })
})

describe('planConsume', () => {
  it('на деталь — одно намерение', () => {
    expect(planConsume([mark(), mark({ itemIndex: 1 })])).toEqual([
      { orderId: 5269, itemIndex: 0, attempt: 0 },
      { orderId: 5269, itemIndex: 1, attempt: 0 },
    ])
  })

  it('дубль в одной пачке схлопывается — «Всё готово» шлёт пачкой', () => {
    expect(planConsume([mark(), mark()])).toHaveLength(1)
  })

  it('ПЕРЕДЕЛКА — ОТДЕЛЬНОЕ СПИСАНИЕ: та же деталь, другая попытка, новый лист', () => {
    const r = planConsume([mark({ attempt: 0 }), mark({ attempt: 1 })])
    expect(r).toHaveLength(2)
    expect(r.map(x => x.attempt)).toEqual([0, 1])
  })

  it('каскадные отметки в пачке отсеиваются, живые остаются', () => {
    const r = planConsume([mark({ source: 'cascade' }), mark({ itemIndex: 2 })])
    expect(r).toEqual([{ orderId: 5269, itemIndex: 2, attempt: 0 }])
  })

  it('пачка без единой живой резки не даёт вызовов складу', () => {
    expect(planConsume([mark({ stageKey: 'packaging' }), mark({ source: 'cascade' })])).toEqual([])
  })
})

describe('shouldReverse — мисклик откатываем, переделку нет', () => {
  it('отмена отметки: материал не расходовался, нужно встречное движение', () => {
    expect(shouldReverse('cutting', 'unset')).toBe(true)
  })

  it('«Переделать»: лист израсходован, откат был бы неправдой', () => {
    expect(shouldReverse('cutting', 'rework')).toBe(false)
  })

  it('отмена не-резки склада не касается', () => {
    expect(shouldReverse('packaging', 'unset')).toBe(false)
  })
})
