import { describe, it, expect } from 'vitest'
import { computeConfiguration } from '@/lib/configurator/catalog'
import { buildAssembly } from '@/components/configurator/scene/assembly'

// Билдер 3D должен быть детерминированным и масштабироваться от размеров.
describe('buildAssembly', () => {
  it('стационар: одно стекло, габарит в метрах = размерам/1000', () => {
    const cfg = computeConfiguration('stationary', { width: 1000, height: 2000 }, 8, 'chrome')
    const a = buildAssembly(cfg)
    const fixed = a.glass.filter(g => g.role === 'fixed')
    expect(fixed).toHaveLength(1)
    expect(fixed[0].size[0]).toBeCloseTo(1.0)   // ширина 1000 мм → 1 м
    expect(fixed[0].size[1]).toBeCloseTo(2.0)   // высота 2000 мм → 2 м
    expect(fixed[0].size[2]).toBeCloseTo(0.008) // толщина 8 мм
    expect(a.bounds.w).toBeCloseTo(1.0)
    expect(a.bounds.h).toBeCloseTo(2.0)
  })

  it('прямая распашная: неподвижное + приоткрытая дверь (повёрнута)', () => {
    const cfg = computeConfiguration('straight-swing', { width: 1200, height: 2000, doorWidth: 600 }, 8, 'chrome')
    const a = buildAssembly(cfg)
    const door = a.glass.find(g => g.role === 'door')!
    const fixed = a.glass.find(g => g.role === 'fixed')!
    expect(fixed.size[0]).toBeCloseTo(0.6)      // 1200 − 600 = 600 мм
    expect(door.size[0]).toBeCloseTo(0.6)
    expect(door.rotY).not.toBe(0)               // дверь приоткрыта
    expect(door.pos[2]).toBeGreaterThan(0)      // вынесена по глубине (открыта наружу)
  })

  it('угловая: боковое стекло сложено под 90° (rotY = π/2) вдоль Z', () => {
    const cfg = computeConfiguration('corner-swing', { width: 1000, height: 2000, width2: 800, doorWidth: 600 }, 8, 'chrome')
    const a = buildAssembly(cfg)
    const ret = a.glass.find(g => g.role === 'return')!
    expect(ret).toBeTruthy()
    expect(ret.rotY).toBeCloseTo(Math.PI / 2)
    expect(ret.size[0]).toBeCloseTo(0.8)        // ширина2 800 мм
    expect(a.bounds.d).toBeCloseTo(0.8)         // глубина сцены = боковой пролёт
  })

  it('живое масштабирование: рост высоты растит стекло линейно', () => {
    const lo = buildAssembly(computeConfiguration('stationary', { width: 900, height: 1800 }, 8, 'chrome'))
    const hi = buildAssembly(computeConfiguration('stationary', { width: 900, height: 2200 }, 8, 'chrome'))
    expect(hi.bounds.h - lo.bounds.h).toBeCloseTo(0.4)   // +400 мм → +0.4 м
  })

  it('раздвижная: дверь вынесена вперёд по Z (передний рельс), без поворота', () => {
    const cfg = computeConfiguration('straight-sliding', { width: 1400, height: 2000 }, 8, 'chrome')
    const a = buildAssembly(cfg)
    const door = a.glass.find(g => g.role === 'door')!
    expect(door.rotY).toBe(0)
    expect(door.pos[2]).toBeGreaterThan(0)
  })

  it('фурнитура: распашная даёт петли (модель из артикула) + ручку-скобу', () => {
    const balge = buildAssembly(computeConfiguration('straight-swing', { width: 1200, height: 2000, doorWidth: 600 }, 8, 'chrome', 'Balge-004'))
    expect(balge.hardware.filter(h => h.key.startsWith('hinge')).every(h => h.model === 'balge')).toBe(true)
    expect(balge.hardware.some(h => h.model === 'sd210')).toBe(true)   // ручка

    const dessau = buildAssembly(computeConfiguration('straight-swing', { width: 1200, height: 2000, doorWidth: 600 }, 8, 'chrome', 'Dessau-103'))
    expect(dessau.hardware.filter(h => h.key.startsWith('hinge')).every(h => h.model === 'dessau')).toBe(true)
  })

  it('фурнитура: стационар без двери — петель и ручки нет', () => {
    const a = buildAssembly(computeConfiguration('stationary', { width: 1000, height: 2000 }, 8, 'chrome'))
    expect(a.hardware).toHaveLength(0)
  })
})
