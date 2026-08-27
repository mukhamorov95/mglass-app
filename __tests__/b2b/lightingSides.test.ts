import { describe, it, expect } from 'vitest'
import { lightingLengthM, ALL_SIDES } from '../../lib/b2bFactoryProducts'

// Подсветка бывает не по всему периметру: «парящий эффект» по горизонтальным сторонам,
// подсветка только по бокам, только сверху. Лента, профиль и рассеиватель кроятся по
// выбранным сторонам — раньше всегда брался полный периметр, и на таких зеркалах мы
// закладывали примерно вдвое больше материала, чем уходит.

const W = 800, H = 1200

describe('длина подсветки по сторонам', () => {
  it('весь периметр — как и раньше', () => {
    expect(lightingLengthM(W, H, ALL_SIDES)).toBeCloseTo(4.0, 3)
  })

  it('стороны не заданы — считаем весь периметр (прежнее поведение не сломано)', () => {
    expect(lightingLengthM(W, H, undefined)).toBeCloseTo(4.0, 3)
  })

  it('только верх и низ — две ширины', () => {
    const m = lightingLengthM(W, H, { top: true, bottom: true, left: false, right: false })
    expect(m).toBeCloseTo(1.6, 3)
  })

  it('только бока — две высоты', () => {
    const m = lightingLengthM(W, H, { top: false, bottom: false, left: true, right: true })
    expect(m).toBeCloseTo(2.4, 3)
  })

  it('одна сторона — одна длина', () => {
    expect(lightingLengthM(W, H, { top: true, bottom: false, left: false, right: false })).toBeCloseTo(0.8, 3)
    expect(lightingLengthM(W, H, { top: false, bottom: false, left: true, right: false })).toBeCloseTo(1.2, 3)
  })

  it('«парящий» по горизонтали экономит больше половины против периметра', () => {
    const full = lightingLengthM(W, H, ALL_SIDES)
    const floating = lightingLengthM(W, H, { top: true, bottom: true, left: false, right: false })
    expect(floating).toBeLessThan(full / 2)
  })

  it('ни одной стороны — ноль, а не периметр', () => {
    expect(lightingLengthM(W, H, { top: false, bottom: false, left: false, right: false })).toBe(0)
  })

  it('сумма противоположных сторон не зависит от порядка', () => {
    const a = lightingLengthM(W, H, { top: true, bottom: false, left: true, right: false })
    const b = lightingLengthM(W, H, { top: false, bottom: true, left: false, right: true })
    expect(a).toBeCloseTo(b, 6)
  })
})
