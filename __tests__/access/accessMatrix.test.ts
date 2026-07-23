import { describe, it, expect } from 'vitest'
import { canAccessRoute, explainAccess, ROLE_ALLOWED, isOwnerRole, type Role } from '@/lib/getRole'

// Матрица доступов — ловит гейт-регрессии (класс бага Веры: меню есть, доступа
// нет) на CI, до мержа. Самопроверка по ROLE_ALLOWED автоматически покрывает
// новые маршруты, добавленные в allowlist.

const ALL_ROLES = Object.keys(ROLE_ALLOWED) as Role[]

describe('accessMatrix — каждая роль открывает свои маршруты', () => {
  for (const role of ALL_ROLES) {
    it(`${role}: все маршруты из ROLE_ALLOWED доступны`, () => {
      for (const path of ROLE_ALLOWED[role]) {
        expect(canAccessRoute(role, path), `${role} → ${path}`).toBe(true)
        // и вложенный путь под этим префиксом (кроме корня)
        if (path !== '/') {
          expect(canAccessRoute(role, `${path}/sub`), `${role} → ${path}/sub`).toBe(true)
        }
      }
    })
  }
})

describe('accessMatrix — владелец видит всё, чужой — ничего', () => {
  const anywhere = ['/', '/cfo', '/commercial', '/admin/users', '/b2b-orders', '/production-app', '/accounting', '/whatever-new-page']
  it('admin и ceo проходят везде', () => {
    for (const p of anywhere) {
      expect(canAccessRoute('admin', p), `admin → ${p}`).toBe(true)
      expect(canAccessRoute('ceo', p), `ceo → ${p}`).toBe(true)
    }
    expect(isOwnerRole('admin')).toBe(true)
    expect(isOwnerRole('ceo')).toBe(true)
  })
  it('нет роли / неизвестная роль — отказ', () => {
    expect(canAccessRoute(null, '/cfo')).toBe(false)
    expect(canAccessRoute(undefined, '/')).toBe(false)
    expect(canAccessRoute('nonsense', '/b2b-orders')).toBe(false)
  })
})

describe('accessMatrix — изоляция данных между ролями (важные границы)', () => {
  // Финансовые контуры не должны протекать в чужие роли.
  const denials: [Role, string][] = [
    ['manager', '/cfo'],
    ['manager', '/commercial'],
    ['manager', '/accounting'],
    ['production', '/cfo'],
    ['production', '/b2b-orders'],
    ['production', '/commercial'],
    ['buyer', '/cfo'],
    ['buyer', '/commercial'],
    ['buyer', '/manager'],
    ['seo', '/cfo'],
    ['seo', '/b2b-orders'],
    ['commercial', '/accounting'],
    ['accountant', '/commercial'],
    ['measurer', '/cfo'],
    ['partner', '/cfo'],
    ['partner', '/admin/users'],
  ]
  for (const [role, path] of denials) {
    it(`${role} НЕ видит ${path}`, () => {
      expect(canAccessRoute(role, path)).toBe(false)
    })
  }
})

describe('explainAccess синхронен с canAccessRoute (диагностика = реальный гейт)', () => {
  const paths = ['/', '/cfo', '/commercial', '/accounting', '/calculator/b2b', '/b2b-orders', '/production-app', '/admin/users', '/api/x']
  const scopes = [null, 'mglass_only', 'all_clients'] as const
  for (const role of ALL_ROLES) {
    it(`${role}: allowed совпадает для всех путей и скоупов`, () => {
      for (const p of paths) {
        for (const sc of scopes) {
          const gate = canAccessRoute(role, p, { b2bScope: sc })
          const explained = explainAccess(role, p, { b2bScope: sc })
          expect(explained.allowed, `${role} ${p} scope=${sc}: ${explained.reason}`).toBe(gate)
          expect(explained.reason.length).toBeGreaterThan(0)
        }
      }
    })
  }
})

describe('accessMatrix — корень и публичные пути открыты всем ролям', () => {
  for (const role of ALL_ROLES) {
    it(`${role}: /, /login, /access-denied, /api/* открыты`, () => {
      expect(canAccessRoute(role, '/')).toBe(true)
      expect(canAccessRoute(role, '/login')).toBe(true)
      expect(canAccessRoute(role, '/access-denied')).toBe(true)
      expect(canAccessRoute(role, '/api/anything')).toBe(true)
    })
  }
})
