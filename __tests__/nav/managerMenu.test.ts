import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MANAGER_AMO, MANAGER_MGLASS, MANAGER_B2B, isGroup, isSection, type NavEntry, type NavItem } from '@/lib/nav/managerMenu'
import { canAccessRoute } from '@/lib/getRole'

const items = (entries: NavEntry[]): NavItem[] =>
  entries.flatMap(e => isGroup(e) ? [] : isSection(e) ? e.items : [e])
const all = [...MANAGER_AMO, ...items(MANAGER_MGLASS), ...MANAGER_B2B]
const labelOf = (href: string) => all.find(i => i.href === href)?.label

describe('меню менеджера — каждая ссылка рабочая', () => {
  it.each(all.map(i => [i.href]))('%s — страница существует', href => {
    expect(existsSync(join(process.cwd(), 'app', href, 'page.tsx'))).toBe(true)
  })
  it.each(all.map(i => [i.href]))('%s — открыт роли manager', href => {
    expect(canAccessRoute('manager', href)).toBe(true)
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
    expect(labelOf('/sales')).toBe('Реестр продаж и оплат')
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
  it('ни один пункт не пропал, кроме переданных цеху', () => {
    const before = [
      '/manager', '/calculator/shower', '/calculator/mirror', '/calculator/loft', '/configurator',
      '/my-day', '/deals', '/calculator/build', '/calculator/quick', '/calculator/b2b-mglass', '/calculations',
      '/kp', '/contracts', '/my-earnings', '/clients', '/crm', '/sales', '/orders',
      '/measure-requests', '/measure-calendar', '/measurer', '/installations', '/calendar', '/inventory',
      '/b2b-today', '/calculator/b2b', '/b2b-quotes', '/b2b-orders', '/b2b-invoices', '/b2b-crm',
    ]
    expect(all.map(i => i.href).sort()).toEqual(before.sort())
  })
})
