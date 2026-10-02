import { describe, it, expect } from 'vitest'
import { normalizeKit } from '@/lib/configurator/kit'

// Решение 7 (02.10): цель «остаётся с заказа» своя у модели — поле переживает чтение из базы,
// мусор отбрасывается (пусто → цель плана CFO).
describe('ModelKit.target', () => {
  it('сохраняется 0 < цель < 100, остальное отбрасывается', () => {
    expect(normalizeKit({ slots: [], target: 35 })?.target).toBe(35)
    for (const bad of [0, 100, -5, '38', NaN, null]) expect(normalizeKit({ slots: [], target: bad })?.target).toBeUndefined()
  })
})
