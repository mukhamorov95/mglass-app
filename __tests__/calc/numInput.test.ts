import { describe, it, expect } from 'vitest'
import { numOr } from '@/lib/calc/numInput'

describe('число из поля конструктора', () => {
  it('запятая — десятичный знак, а не мусор: маржа 35,5 не становится 355', () => {
    expect(numOr('35,5')).toBe(35.5)
    expect(numOr('5,5')).toBe(5.5)
    expect(numOr('12.5')).toBe(12.5)
  })
  it('пробелы и знаки единиц отбрасываются; пустое — 0', () => {
    expect(numOr('1 000')).toBe(1000)
    expect(numOr('35 %')).toBe(35)
    expect(numOr('5 000 ₽')).toBe(5000)
    expect(numOr('')).toBe(0)
  })
  it('два десятичных знака — не число, а не «склейка» цифр', () => {
    expect(numOr('1,5,5')).toBe(0)
  })
})
