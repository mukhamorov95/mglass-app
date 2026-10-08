import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/production-app' }))

import { shopTabsView, MAIN_FOR_SHOP } from '@/components/ProductionTabs'

describe('вкладки цеха для роли production', () => {
  it('шесть основных в порядке: Сегодня, Табло, Мои задачи, Заказы, Отгрузка, Скан', () => {
    const { main } = shopTabsView('/production-app/my-queue', false)
    expect(main.map(t => t.href)).toEqual(MAIN_FOR_SHOP)
    expect(main).toHaveLength(6)
  })

  it('остальное — под «Ещё», ничего не потеряно', () => {
    const { main, rest } = shopTabsView('/production-app', false)
    expect(rest.length).toBeGreaterThan(0)
    expect(new Set([...main, ...rest].map(t => t.href)).size).toBe(main.length + rest.length)
    expect(rest.map(t => t.href)).toContain('/production-app/buy')
  })

  it('«Ещё» закрыто на основной вкладке и раскрыто, если открыта вкладка из него', () => {
    expect(shopTabsView('/production-app/orders', false).open).toBe(false)
    expect(shopTabsView('/production-app/remnants', false).open).toBe(true)
    expect(shopTabsView('/production-app', true).open).toBe(true)
  })
})
