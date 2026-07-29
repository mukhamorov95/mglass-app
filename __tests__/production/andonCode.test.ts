import { describe, it, expect } from 'vitest'
import { andonCode, ANDON_REASONS } from '@/lib/productionRouting'
import { PROBLEM_REASONS } from '@/lib/productionStages'

// В проекте два словаря причин: коды (БД, CHECK-констрейнт) и русские строки
// (старые экраны). andonCode переводит вторые в первые — без него проблема со
// старого экрана отваливалась бы с 400 и терялась.
describe('andonCode — старый словарь причин переводится в коды БД', () => {
  it('каждая русская причина старого экрана имеет код', () => {
    for (const label of PROBLEM_REASONS) {
      const code = andonCode(label)
      expect(ANDON_REASONS.some(r => r.code === code), `нет кода для «${label}»`).toBe(true)
      // «Другое» законно ложится в other, остальные должны найтись по метке
      if (label !== 'Другое') expect(code).not.toBe('other')
    }
  })

  it('конкретные соответствия', () => {
    expect(andonCode('Брак закалки')).toBe('tempering_defect')
    expect(andonCode('Скол при резке')).toBe('cut_defect')
    expect(andonCode('Брак сверления')).toBe('drilling_defect')
    expect(andonCode('Царапина')).toBe('scratch')
  })

  it('готовый код проходит насквозь', () => {
    expect(andonCode('tempering_defect')).toBe('tempering_defect')
  })

  it('регистр не важен', () => {
    expect(andonCode('брак закалки')).toBe('tempering_defect')
  })

  it('пусто и мусор → other, проблема не теряется', () => {
    expect(andonCode('')).toBe('other')
    expect(andonCode(null)).toBe('other')
    expect(andonCode(undefined)).toBe('other')
    expect(andonCode('что-то своё')).toBe('other')
  })
})
