import { describe, it, expect } from 'vitest'
import { remnantError, checkRemnants, stockSummary, remnantM2, thresholdLabel } from '@/lib/production/remnants'
import { isRemnant } from '@/lib/cuttingOptimizer'

const SHEET = { w: 3210, h: 2250 }

describe('остаток листа — порог 400×800 (решение владельца 15.09)', () => {
  it('кусок 400×800 и больше — остаток, в любой ориентации', () => {
    expect(remnantError({ w: 400, h: 800 }, SHEET)).toBeNull()
    expect(remnantError({ w: 1200, h: 450 }, SHEET)).toBeNull()
  })
  it('меньше — полоса, в отход', () => {
    expect(remnantError({ w: 200, h: 200 }, SHEET)).toBe('200×200 меньше 400×800 — это полоса, в отход')
    expect(remnantError({ w: 350, h: 2000 }, SHEET)).toMatch(/полоса/)
    expect(remnantError({ w: 500, h: 700 }, SHEET)).toMatch(/полоса/)
  })
  it('больше листа или пустой ввод — ошибка', () => {
    expect(remnantError({ w: 3300, h: 900 }, SHEET)).toMatch(/больше листа/)
    expect(remnantError({ w: 0, h: 900 }, SHEET)).toBe('укажите ширину и высоту в мм')
  })
  it('порог из настроек', () => {
    expect(remnantError({ w: 450, h: 900 }, SHEET, { min_remnant_short: 500, min_remnant_long: 1000 })).toMatch(/меньше 500×1000/)
    expect(thresholdLabel({ min_remnant_short: 500, min_remnant_long: 1000 })).toBe('500×1000')
  })
  it('порог один на систему: раскрой и калькулятор без настроек считают по 400×800', () => {
    expect(isRemnant(300, 300)).toBe(false)
    expect(isRemnant(400, 800)).toBe(true)
    expect(isRemnant(300, 300, { min_remnant_short: 200, min_remnant_long: 200 })).toBe(true)
  })
  it('проверка списка: округляет размеры, чистит место', () => {
    const r = checkRemnants([{ w: 812.4, h: 1500, location: ' С-1 ' }, { w: 100, h: 100 }], SHEET)
    expect(r.ok).toEqual([{ w: 812, h: 1500, location: 'С-1' }])
    expect(r.errors).toHaveLength(1)
  })
})

describe('стеллаж', () => {
  it('сводка по материалу — только лежащие, по площади', () => {
    const s = stockSummary([
      { material_name: 'Мору Crystal Clear', thickness: '8.0', width_mm: 1000, height_mm: 2000, status: 'in_stock' },
      { material_name: 'Мору Crystal Clear', thickness: 8, width_mm: 500, height_mm: 1000, status: 'in_stock' },
      { material_name: 'Прозрачное М1', thickness: 4, width_mm: 3000, height_mm: 2000, status: 'in_stock' },
      { material_name: 'Прозрачное М1', thickness: 4, width_mm: 3000, height_mm: 2000, status: 'used' },
    ])
    expect(s).toEqual([
      { key: 'Прозрачное М1|4', material: 'Прозрачное М1', thickness: 4, count: 1, m2: 6 },
      { key: 'Мору Crystal Clear|8', material: 'Мору Crystal Clear', thickness: 8, count: 2, m2: 2.5 },
    ])
  })
  it('площадь куска', () => {
    expect(remnantM2(812, 1500)).toBe(1.22)
  })
})
