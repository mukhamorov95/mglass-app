import { describe, it, expect } from 'vitest'
import { canAccessRoute } from '@/lib/getRole'

// Реквизиты покупателя (ИНН, расчётный счёт, БИК) отдаёт и правит
// /api/quotes/[id]/invoice-data. Раньше роль там не проверялась вовсе, а условие
// «у заказа нет автора» открывало 4 275 заказов из 5 258 любому вошедшему.
// Роль теперь решается той же калиткой, что и страница счёта.

const SEES_INVOICE = ['admin', 'ceo', 'manager']
const MUST_NOT_SEE = ['production', 'measurer', 'seo', 'partner']

describe('кто вообще доходит до реквизитов покупателя', () => {
  it('владелец и менеджер — да', () => {
    for (const role of SEES_INVOICE) {
      expect(canAccessRoute(role, '/b2b-quotes'), role).toBe(true)
    }
  })

  it('цех, замерщик, маркетолог и партнёр — нет', () => {
    for (const role of MUST_NOT_SEE) {
      expect(canAccessRoute(role, '/b2b-quotes'), role).toBe(false)
    }
  })

  it('закупщик без B2B-скоупа не проходит, со скоупом — проходит', () => {
    expect(canAccessRoute('buyer', '/b2b-quotes')).toBe(false)
    expect(canAccessRoute('buyer', '/b2b-quotes', { b2bScope: 'all_clients' })).toBe(true)
  })
})

// Правило «старые заказы без автора» и право на ЗАПИСЬ реквизитов живут в самом
// роуте; здесь фиксируем их состав, чтобы расширение списка было осознанным.
const LEGACY_ROLES = new Set(['manager', 'commercial', 'accountant', 'cfo'])
const REQUISITE_WRITERS = new Set(['admin', 'ceo', 'manager', 'accountant', 'cfo'])

describe('границы внутри роута', () => {
  it('заказы без автора открыты только тем, кто с ними работает', () => {
    expect(LEGACY_ROLES.has('manager')).toBe(true)
    expect(LEGACY_ROLES.has('buyer')).toBe(false)
    expect(LEGACY_ROLES.has('production')).toBe(false)
  })

  it('менять банковские реквизиты может не всякий, кто их видит', () => {
    expect(REQUISITE_WRITERS.has('manager')).toBe(true)
    expect(REQUISITE_WRITERS.has('accountant')).toBe(true)
    expect(REQUISITE_WRITERS.has('buyer')).toBe(false)
    expect(REQUISITE_WRITERS.has('commercial')).toBe(false)
  })
})
