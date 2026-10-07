import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MANAGER_AMO, MANAGER_MGLASS, MANAGER_B2B, isGroup, isSection, visibleFor, type NavEntry, type NavItem } from '@/lib/nav/managerMenu'
import { canAccessRoute } from '@/lib/getRole'

const items = (entries: NavEntry[]): NavItem[] =>
  entries.flatMap(e => isGroup(e) ? [] : isSection(e) ? e.items : [e])
const all = [...MANAGER_AMO, ...items(MANAGER_MGLASS), ...MANAGER_B2B]
const labelOf = (href: string) => all.find(i => i.href === href)?.label

describe('меню менеджера — каждая ссылка рабочая', () => {
  it.each(all.map(i => [i.href]))('%s — страница существует', href => {
    expect(existsSync(join(process.cwd(), 'app', href, 'page.tsx'))).toBe(true)
  })
  it.each(all.filter(i => !i.ownerOnly).map(i => [i.href]))('%s — открыт роли manager', href => {
    expect(canAccessRoute('manager', href)).toBe(true)
  })
  it('маржа — только владельцу: менеджеру пункт не показывается', () => {
    const margin = all.find(i => i.href === '/sales/margin')!
    expect(margin.ownerOnly).toBe(true)
    expect(visibleFor(margin, false)).toBe(false)
    expect(visibleFor(margin, true)).toBe(true)
    // Право на маржу (Вера, 05.10) открывает пункт и без роли владельца.
    expect(visibleFor(margin, false, { margin_edit: true })).toBe(true)
    expect(visibleFor(margin, false, { margin_edit: false })).toBe(false)
  })
  it('ссылки не повторяются', () => {
    expect(new Set(all.map(i => i.href)).size).toBe(all.length)
  })
})

describe('структура по ТЗ (Н1)', () => {
  it('группы MGlass: Главная → Расчёты и документы → Исполнение → Личное', () => {
    expect(MANAGER_MGLASS.filter(isGroup).map(g => g.groupLabel))
      .toEqual(['Главная', 'Расчёты и документы', 'Исполнение', 'Личное'])
  })
  it('понятные названия', () => {
    expect(labelOf('/crm')).toBe('Воронка продаж')
    expect(labelOf('/sales')).toBe('Продажи M-Glass')
    expect(labelOf('/sales/margin')).toBe('Маржа')
    expect(labelOf('/calculations')).toBe('Расчёты')
    expect(labelOf('/inventory')).toBe('Склад и резервы')
    expect(labelOf('/calendar')).toBe('Календарь замеров и монтажей')
  })
  it('КП и договоры — не на первом уровне', () => {
    const top = MANAGER_MGLASS.filter((e): e is NavItem => !isGroup(e) && !isSection(e)).map(i => i.href)
    expect(top).not.toContain('/kp')
    expect(top).not.toContain('/contracts')
  })
  it('Расчёт B2B — в B2B, цех — не в меню менеджера', () => {
    expect(MANAGER_B2B.map(i => i.href)).toContain('/calculator/b2b-mglass')
    expect(items(MANAGER_MGLASS).map(i => i.href)).not.toContain('/calculator/b2b-mglass')
    expect(all.map(i => i.href)).not.toContain('/production-app')
    expect(all.map(i => i.href)).not.toContain('/b2b-cutting')
  })
  it('старые калькуляторы душевой, зеркала и лофта — не в меню (решение владельца 30.09)', () => {
    for (const href of ['/calculator/shower', '/calculator/mirror', '/calculator/loft']) {
      expect(all.map(i => i.href)).not.toContain(href)
    }
  })
  it('ни один пункт не пропал, кроме переданных цеху, старых калькуляторов и убранных 08.10', () => {
    // 08.10 (docs/SYSTEM_ORDER_ROUTE.md, этап 8): «Мой день» → «/», «Заказы» → /b2b-orders.
    const before = [
      '/manager', '/configurator',
      '/deals', '/calculator/build', '/calculator/quick', '/calculator/b2b-mglass', '/calculations',
      // '/sales/managers' — третий срез продаж (показатели менеджеров), добавлен 17.09
      '/kp', '/contracts', '/my-earnings', '/clients', '/crm', '/sales', '/sales/managers',
      '/measure-requests', '/measure-calendar', '/measurer', '/installations', '/calendar', '/inventory',
      '/b2b-today', '/calculator/b2b', '/b2b-quotes', '/b2b-orders', '/b2b-invoices', '/b2b-crm',
      // Отчёт по клиентам B2B — клиент × период (просьба владельца 30.09)
      '/b2b-crm/report',
      // Входящие заявки B2B — Авито и другие каналы до клиента (концепция Авито v2, 02.10)
      '/b2b-crm/inquiries',
      // Маржа объектов по книге «Маржа» — только владельцу (просьба владельца 05.10)
      '/sales/margin',
    ]
    expect(all.map(i => i.href).sort()).toEqual(before.sort())
  })
})
