import { describe, it, expect } from 'vitest'
import { applyLoadDraft, withLoadDraft, dropShipmentDraft, loadKey } from '@/lib/shipmentLoadDraft'

describe('applyLoadDraft', () => {
  it('без черновика — то, что в базе', () => {
    expect(applyLoadDraft(4, [10, 11, 12], [11], new Map())).toEqual([11])
  })

  it('непринятая базой отметка остаётся на экране после перезагрузки списка', () => {
    const draft = withLoadDraft(new Map(), 4, 10, true)
    expect(applyLoadDraft(4, [10, 11, 12], [], draft)).toEqual([10])
  })

  it('непринятое снятие отметки тоже держится', () => {
    const draft = withLoadDraft(new Map(), 4, 11, false)
    expect(applyLoadDraft(4, [10, 11, 12], [11, 12], draft)).toEqual([12])
  })

  it('черновик другого рейса не смешивается', () => {
    const draft = withLoadDraft(new Map(), 5, 10, true)
    expect(applyLoadDraft(4, [10], [], draft)).toEqual([])
  })

  it('заказ, убранный из рейса, не возвращается черновиком', () => {
    const draft = withLoadDraft(new Map(), 4, 10, true)
    expect(applyLoadDraft(4, [11], [], draft)).toEqual([])
  })
})

describe('withLoadDraft / dropShipmentDraft', () => {
  it('сохранённая отметка убирает запись из черновика', () => {
    const d1 = withLoadDraft(new Map(), 4, 10, true)
    expect(d1.has(loadKey(4, 10))).toBe(true)
    expect(withLoadDraft(d1, 4, 10, null).size).toBe(0)
  })

  it('отправка рейса чистит только его черновик', () => {
    let d = withLoadDraft(new Map(), 4, 10, true)
    d = withLoadDraft(d, 41, 10, true)
    d = withLoadDraft(d, 5, 12, false)
    expect([...dropShipmentDraft(d, 4).keys()].sort()).toEqual(['41:10', '5:12'])
  })
})
