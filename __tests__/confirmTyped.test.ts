import { describe, it, expect } from 'vitest'
import { typedMatches } from '@/lib/confirmTyped'

describe('подтверждение необратимого набранным словом', () => {
  it('совпадение без учёта регистра, пробелов по краям и ё/е', () => {
    expect(typedMatches('удалить', 'УДАЛИТЬ')).toBe(true)
    expect(typedMatches('  УДАЛИТЬ ', 'УДАЛИТЬ')).toBe(true)
    expect(typedMatches('3', '3')).toBe(true)
    expect(typedMatches('всё', 'ВСЕ')).toBe(true)
  })

  it('пусто, отмена и другое число — не подтверждение', () => {
    expect(typedMatches(null, 'УДАЛИТЬ')).toBe(false)
    expect(typedMatches('', 'УДАЛИТЬ')).toBe(false)
    expect(typedMatches('   ', '')).toBe(false)
    expect(typedMatches('4', '3')).toBe(false)
    expect(typedMatches('да', 'УДАЛИТЬ')).toBe(false)
  })
})
