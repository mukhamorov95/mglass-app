import { describe, it, expect } from 'vitest'
import { normalizeManagerHome, MANAGER_HOMES } from '@/lib/managerHome'

describe('начальный экран менеджера (У2)', () => {
  it('принимает только известные экраны', () => {
    expect(normalizeManagerHome('/b2b-quotes')).toBe('/b2b-quotes')
    expect(normalizeManagerHome('/manager')).toBe('/manager')
  })

  it('чужой путь не становится входом', () => {
    expect(normalizeManagerHome('/cfo')).toBeNull()
    expect(normalizeManagerHome('https://evil.example')).toBeNull()
    expect(normalizeManagerHome('')).toBeNull()
    expect(normalizeManagerHome(null)).toBeNull()
    expect(normalizeManagerHome({ toString: () => '/manager' })).toBeNull()
  })

  it('у каждого варианта есть подпись для владельца', () => {
    expect(MANAGER_HOMES.every(h => h.label.length > 0)).toBe(true)
  })
})
