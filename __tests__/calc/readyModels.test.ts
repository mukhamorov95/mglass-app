import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { READY_MODELS } from '@/lib/calc/readyModels'
import { interpretStep, readStep } from '@/lib/calc/stepImport'
import { getModel } from '@/lib/configurator/arrangement'

const fileOf = (name: string) => interpretStep(readStep(readFileSync(`__tests__/fixtures/step/${name}.STEP`, 'utf8')))
const within = (v: number, [lo, hi]: [number, number]) => v >= lo && v <= hi

describe('готовые модели', () => {
  it('сохранённое совпадает с разбором файла — поменялся разбор, обновить модель', () => {
    for (const m of READY_MODELS) expect(m.imp).toEqual(fileOf(m.imp.name))
  })

  it('0828-2 — схема и ширины М7; высота выше типовой', () => {
    const m = READY_MODELS.find(x => x.id === 'm7-0828-2')!
    const c = getModel(m.code).constraints
    const front = m.imp.panels.filter(p => p.run === 'front')
    const side = m.imp.panels.filter(p => p.run === 'side')
    expect(m.imp.shape).toBe(getModel(m.code).shape)
    expect(front.map(p => p.kind)).toEqual(['fixed', 'door'])
    expect(side.map(p => p.kind)).toEqual(['fixed'])
    expect(within(front.reduce((s, p) => s + p.w, 0), c.width)).toBe(true)
    expect(within(side[0].w, c.width2!)).toBe(true)
    expect(within(front[1].w, c.doorWidth!)).toBe(true)
    expect(getModel(m.code).thickness).toContain(m.imp.thickness)
    expect(Math.max(...m.imp.panels.map(p => p.h))).toBeGreaterThan(c.height[1])
  })
})
