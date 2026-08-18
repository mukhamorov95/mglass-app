import { describe, it, expect } from 'vitest'
import { M_MODELS, getModel } from '@/lib/configurator/arrangement'
import { buildFromModel } from '@/components/configurator/scene/assembly'

const mid = ([a, b]: [number, number]) => Math.round((a + b) / 200) * 100
const dimsFor = (code: string) => {
  const m = getModel(code)
  return {
    width: mid(m.constraints.width),
    height: 2000,
    width2: m.constraints.needsWidth2 && m.constraints.width2 ? mid(m.constraints.width2) : undefined,
    doorWidth: m.constraints.doorWidth ? 600 : undefined,
  }
}

describe('buildFromModel — все 9 моделей строятся', () => {
  for (const m of M_MODELS) {
    it(`${m.code} ${m.name}: стекло есть, габариты валидны`, () => {
      const a = buildFromModel(m, dimsFor(m.code), 8)
      expect(a.glass.length).toBeGreaterThan(0)
      expect(a.bounds.w).toBeGreaterThan(0)
      expect(a.bounds.h).toBeCloseTo(2.0)
      // все размеры стёкол положительные и конечные
      for (const g of a.glass) {
        expect(g.size.every(s => Number.isFinite(s) && s > 0)).toBe(true)
        expect(g.pos.every(Number.isFinite)).toBe(true)
      }
    })
  }

  it('распашные (М2, М4, М7, М11) дают петли + ручку', () => {
    for (const code of ['М2', 'М4', 'М7', 'М11']) {
      const a = buildFromModel(getModel(code), dimsFor(code), 8)
      expect(a.hardware.some(h => h.model === 'balge' || h.model === 'dessau')).toBe(true)
      expect(a.hardware.some(h => h.model === 'sd210')).toBe(true)
    }
  })

  it('раздвижные (М8, М9, М10, М12) — без распашных петель, но с роликами и купе', () => {
    for (const code of ['М8', 'М9', 'М10', 'М12']) {
      const a = buildFromModel(getModel(code), dimsFor(code), 8)
      expect(a.hardware.filter(h => h.model === 'balge').length).toBe(0)
      expect(a.hardware.filter(h => h.model === 'roller').length).toBeGreaterThanOrEqual(2)  // 2 каретки на створку (сверху)
      expect(a.hardware.some(h => h.model === 'kupe')).toBe(true)
      expect(a.hardware.some(h => h.model === 'holder')).toBe(true)
    }
  })

  it('угловая М7: глубина сцены = боковой размер', () => {
    const a = buildFromModel(getModel('М7'), { width: 1000, height: 2000, width2: 800, doorWidth: 600 }, 8)
    expect(a.bounds.d).toBeCloseTo(0.8)
    expect(a.niche.walls).toEqual({ back: true, left: true, right: false })
  })
})
