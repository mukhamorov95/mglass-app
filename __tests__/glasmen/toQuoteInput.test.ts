import { describe, it, expect } from 'vitest'
import { geometryToQuoteFacts } from '@/lib/glasmen/toQuoteInput'
import { getTemplate } from '@/lib/glasmen/templates'

describe('geometryToQuoteFacts', () => {
  it('группирует отверстия по диаметру с шагом 0,5 мм, по возрастанию', () => {
    const g = {
      ...getTemplate('rect')!.build({ W: 1000, H: 600 }),
      holes: [
        { cx: 100, cy: 100, d: 16 }, { cx: 200, cy: 100, d: 10 }, { cx: 300, cy: 100, d: 10.2 },
        { cx: 400, cy: 100, d: 10.3 }, { cx: 500, cy: 100, d: 9.76 },
      ],
    }
    expect(geometryToQuoteFacts(g)).toEqual({
      width: 1000, height: 600, shape: 'rect',
      holes: [{ d: 10, n: 3 }, { d: 10.5, n: 1 }, { d: 16, n: 1 }],
      hasHoles: true, cutouts: 0, hasCutouts: false,
    })
  })

  it('вырезы фартука и форма curved', () => {
    const f = geometryToQuoteFacts(getTemplate('splashback')!.build())
    expect(f).toMatchObject({ width: 2000, height: 600, shape: 'rect', cutouts: 2, hasCutouts: true, holes: [], hasHoles: false })
    expect(geometryToQuoteFacts(getTemplate('circle')!.build({ D: 600 })).shape).toBe('curved')
  })
})

describe('geometryToQuoteFacts — круг крупнее отверстия', () => {
  it('Ø > 100 мм считается вырезом, а не отверстием (API принимает отверстия 1…100)', () => {
    const g = { ...getTemplate('rect')!.build({ W: 1000, H: 600 }), holes: [{ cx: 300, cy: 300, d: 100 }, { cx: 600, cy: 300, d: 160 }] }
    expect(geometryToQuoteFacts(g)).toMatchObject({ holes: [{ d: 100, n: 1 }], hasHoles: true, cutouts: 1, hasCutouts: true })
  })
})
