import { describe, it, expect } from 'vitest'
import {
  isAttributable, planConsume, shouldConsume, shouldReverse, type CuttingMark,
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

  it('КАСКАД ТОЖЕ СПИСЫВАЕТ: он утверждает, что резка БЫЛА, просто её не отметили', () => {
    expect(shouldConsume(mark({ source: 'cascade' }))).toBe(true)
  })

  it('другие этапы материал не трогают', () => {
    for (const s of ['polishing', 'tempering', 'packaging', 'drilling']) {
      expect(shouldConsume(mark({ stageKey: s }))).toBe(false)
    }
  })

})

describe('isAttributable — материал списываем, имя не подставляем', () => {
  it('живая отметка приписывается человеку', () => {
    expect(isAttributable('worker')).toBe(true)
    expect(isAttributable('order-card')).toBe(true)
    expect(isAttributable('complete-order')).toBe(true)
  })

  it('каскад — БЕЗ автора: «неизвестно КТО» и «неизвестно БЫЛО ЛИ» разные утверждения', () => {
    expect(isAttributable('cascade')).toBe(false)
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

  it('каскадная резка в пачке тоже даёт списание', () => {
    const r = planConsume([mark({ source: 'cascade' }), mark({ itemIndex: 2 })])
    expect(r).toHaveLength(2)
  })

  it('пачка без резки вообще не даёт вызовов складу', () => {
    expect(planConsume([mark({ stageKey: 'packaging' }), mark({ stageKey: 'tempering' })])).toEqual([])
  })
})

describe('shouldReverse — по переоткрытию РЕЗКИ, а не по снятому этапу', () => {
  it('резку переоткрыли отменой отметки: материал не расходовался, нужен откат', () => {
    expect(shouldReverse({ stageKey: 'cutting', reason: 'unset' })).toBe(true)
  })

  it('«Переделать»: лист израсходован, откат был бы неправдой', () => {
    expect(shouldReverse({ stageKey: 'cutting', reason: 'rework' })).toBe(false)
  })

  it('переоткрытие не-резки склада не касается', () => {
    expect(shouldReverse({ stageKey: 'packaging', reason: 'unset' })).toBe(false)
  })

  it('ключевое: важно ЧТО переоткрыли, а не что сняли руками — мисклик по упаковке каскадом закрыл резку, и её переоткрытие обязано вернуть материал', () => {
    expect(shouldReverse({ stageKey: 'cutting', reason: 'unset' })).toBe(true)
  })
})
