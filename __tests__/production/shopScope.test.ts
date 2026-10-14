import { describe, it, expect } from 'vitest'
import { shopScopeOf, inShopScope, withShopScope } from '@/lib/production/shopScope'

describe('цех глазами M-Glass', () => {
  it('фильтр включается только словом mglass', () => {
    expect(shopScopeOf('mglass')).toBe('mglass')
    expect(shopScopeOf('all')).toBeNull()
    expect(shopScopeOf(undefined)).toBeNull()
  })
  it('без фильтра проходит всё, с фильтром — только M GLASS по id или названию', () => {
    expect(inShopScope(null, { client_id: 42, client_name: 'ShowerGlass' })).toBe(true)
    expect(inShopScope('mglass', { client_id: 1, client_name: null })).toBe(true)
    expect(inShopScope('mglass', { client_id: null, client_name: 'MGLASS' })).toBe(true)
    expect(inShopScope('mglass', { client_id: 42, client_name: 'ShowerGlass' })).toBe(false)
  })
  it('ссылки экрана не теряют фильтр', () => {
    expect(withShopScope('/production-app/board', 'mglass')).toBe('/production-app/board?client=mglass')
    expect(withShopScope('/production-app/board?filter=overdue', 'mglass')).toBe('/production-app/board?filter=overdue&client=mglass')
    expect(withShopScope('/production-app/board', null)).toBe('/production-app/board')
  })
})
