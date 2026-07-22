import { describe, it, expect } from 'vitest'
import { canAccessRoute } from '@/lib/getRole'

// Закупщик Вера с B2B-скоупом должна проходить в калькулятор и B2B-контур.
// Регрессия: гейт знал только 'mglass_only' и выкидывал 'all_clients' в /access-denied.
describe('canAccessRoute — B2B-скоуп закупщика', () => {
  const B2B_PATHS = ['/calculator/b2b', '/b2b-quotes', '/b2b-orders', '/b2b-cutting', '/production-app', '/p/o/123']

  it('без скоупа закупщик в калькулятор B2B не проходит', () => {
    expect(canAccessRoute('buyer', '/calculator/b2b')).toBe(false)
    expect(canAccessRoute('buyer', '/calculator/b2b', { b2bScope: null })).toBe(false)
  })

  it('mglass_only открывает весь B2B-контур', () => {
    for (const p of B2B_PATHS) {
      expect(canAccessRoute('buyer', p, { b2bScope: 'mglass_only' })).toBe(true)
    }
  })

  it('all_clients открывает тот же B2B-контур (Вера — все клиенты)', () => {
    for (const p of B2B_PATHS) {
      expect(canAccessRoute('buyer', p, { b2bScope: 'all_clients' })).toBe(true)
    }
  })

  it('скоуп не даёт закупщику лишнего — чужой калькулятор и заработок закрыты', () => {
    expect(canAccessRoute('buyer', '/calculator/mirror', { b2bScope: 'all_clients' })).toBe(false)
    expect(canAccessRoute('buyer', '/my-earnings', { b2bScope: 'all_clients' })).toBe(false)
    expect(canAccessRoute('buyer', '/commercial', { b2bScope: 'all_clients' })).toBe(false)
  })

  it('обычный доступ закупщика (каталог) сохраняется независимо от скоупа', () => {
    expect(canAccessRoute('buyer', '/admin/glass-prices')).toBe(true)
    expect(canAccessRoute('buyer', '/b2b-orders')).toBe(true)
  })
})
