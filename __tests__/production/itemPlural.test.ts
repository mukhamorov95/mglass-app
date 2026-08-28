import { describe, it, expect } from 'vitest'
import { stageCountLabel } from '@/lib/productionStages'

// Подпись счётчика на кнопке «Готово всё по детали». Проверяем ту же функцию,
// которую видит рабочий, а не её копию рядом с тестом.
const stageWord = (n: number) => stageCountLabel(n).split(' ')[1]

describe('счётчик этапов на кнопке', () => {
  it('один — этап', () => expect(stageWord(1)).toBe('этап'))
  it('два-четыре — этапа', () => {
    expect(stageWord(2)).toBe('этапа')
    expect(stageWord(3)).toBe('этапа')
    expect(stageWord(4)).toBe('этапа')
  })
  it('пять и больше — этапов', () => {
    expect(stageWord(5)).toBe('этапов')
    expect(stageWord(8)).toBe('этапов')
  })
  it('одиннадцать-четырнадцать — этапов, а не этап', () => {
    expect(stageWord(11)).toBe('этапов')
    expect(stageWord(12)).toBe('этапов')
    expect(stageWord(14)).toBe('этапов')
  })
  it('двадцать один — этап', () => expect(stageWord(21)).toBe('этап'))
})
