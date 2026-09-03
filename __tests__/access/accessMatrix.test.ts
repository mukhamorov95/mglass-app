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

// Регрессия конкретного бага: менеджер не мог сформировать КП из корзины зеркал —
// кнопка «КП (PDF)» открывает /cart/print, а /cart не было в allowlist → access-denied.
describe('accessMatrix — менеджер проходит весь путь продажи (класс бага Веры)', () => {
  const salesPaths = [
    // Зеркало, душевая, лофт и ограждение убраны из доступа 03.09.2026 — решение
    // владельца: экраны «не отображают честную картину» (у душевой фурнитура
    // бралась из вписанных руками чисел, а не из справочника цен). Путь продажи
    // проверяется на оставшихся: быстрый расчёт и B2B.
    '/calculator/b2b', '/calculator/quick',
    '/cart', '/cart/print',          // корзина мультизаказа + КП (PDF)
    '/calculations', '/calculations/123', '/calculations/123/print',
    '/kp', '/contracts', '/crm', '/sales', '/orders', '/clients',
    '/b2b-quotes', '/b2b-orders', '/b2b-cutting',
  ]
  for (const p of salesPaths) {
    it(`менеджер открывает ${p}`, () => {
      expect(canAccessRoute('manager', p)).toBe(true)
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

describe('accessMatrix — закупщик с manager_workspace (Вера) получает менеджерский контур', () => {
  const managerPaths = ['/crm', '/kp', '/orders', '/clients', '/calendar', '/installations', '/calculator/quick', '/sales', '/contracts', '/manager', '/measure-requests']
  // Пути, которых у закупщика нет в собственном allowlist (для проверки «закрыто без флага»).
  // '/orders' исключён — он есть и у buyer штатно (логист видит заказы).
  const managerOnlyPaths = managerPaths.filter(p => p !== '/orders')
  it('с флагом — все менеджерские маршруты доступны', () => {
    for (const p of managerPaths) {
      expect(canAccessRoute('buyer', p, { managerWorkspace: true }), `buyer+mgr → ${p}`).toBe(true)
    }
  })
  it('без флага — менеджерские маршруты закрыты', () => {
    for (const p of managerOnlyPaths) {
      expect(canAccessRoute('buyer', p), `buyer → ${p}`).toBe(false)
    }
  })
  it('флаг НЕ протекает в другие роли (production не получает /manager)', () => {
    expect(canAccessRoute('production', '/manager', { managerWorkspace: true })).toBe(false)
    expect(canAccessRoute('seo', '/crm', { managerWorkspace: true })).toBe(false)
  })
  it('флаг не открывает финконтур (/cfo закрыт даже с manager_workspace)', () => {
    expect(canAccessRoute('buyer', '/cfo', { managerWorkspace: true })).toBe(false)
    expect(canAccessRoute('buyer', '/commercial', { managerWorkspace: true })).toBe(false)
  })
  it('explainAccess синхронен с гейтом при managerWorkspace', () => {
    for (const p of [...managerPaths, '/cfo', '/commercial', '/whatever-new']) {
      const gate = canAccessRoute('buyer', p, { managerWorkspace: true })
      const ex = explainAccess('buyer', p, { managerWorkspace: true })
      expect(ex.allowed, `${p}: ${ex.reason}`).toBe(gate)
      expect(ex.reason.length).toBeGreaterThan(0)
    }
  })
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
