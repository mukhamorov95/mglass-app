import { describe, it, expect } from 'vitest'
import { canSeeKitCost } from '@/lib/configurator/costAccess'

// /api/configurator/quote раньше решал по наличию сессии: вошёл — значит получай
// полную разбивку (glassCost, hardwareCost, materialsCost, marginPct, taxPct,
// строки комплекта). Партнёр — вошедший пользователь, и получал нашу
// себестоимость с маршрута, написанного ровно чтобы её не отдавать.

describe('кому конфигуратор отдаёт себестоимость', () => {
  it('внутренние роли, которые и так работают с ценой', () => {
    for (const role of ['admin', 'ceo', 'manager', 'commercial', 'cfo']) {
      expect(canSeeKitCost(role), role).toBe(true)
    }
  })

  it('партнёр — никогда', () => {
    expect(canSeeKitCost('partner')).toBe(false)
  })

  it('цех, замерщик, закупщик, маркетолог, бухгалтерия — нет', () => {
    for (const role of ['production', 'measurer', 'buyer', 'seo', 'accountant']) {
      expect(canSeeKitCost(role), role).toBe(false)
    }
  })

  it('без роли и без сессии — нет', () => {
    expect(canSeeKitCost(null)).toBe(false)
    expect(canSeeKitCost(undefined)).toBe(false)
    expect(canSeeKitCost('')).toBe(false)
  })

  it('незнакомая роль не получает доступ по умолчанию', () => {
    expect(canSeeKitCost('новая_роль')).toBe(false)
  })
})
