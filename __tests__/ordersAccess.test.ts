import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (p: string) => readFileSync(join(root, p), 'utf8')

describe('маршруты розничного заказа (/api/orders/[id]/*) — не по одной сессии', () => {
  const dir = 'app/api/orders/[id]'
  const routes = readdirSync(join(root, dir)).map(n => `${dir}/${n}/route.ts`).filter(p => existsSync(join(root, p)))

  it('каждый маршрут с service-ключом проверяет доступ к заказу или роль', () => {
    for (const p of routes) {
      const src = read(p)
      if (!/SERVICE_ROLE_KEY|createServiceClient\(\)/.test(src)) continue
      expect(/requireOrderAccess|requireRole|isOwnerRole/.test(src), p).toBe(true)
    }
  })

  it('мёртвый /api/orders/production удалён, «Заказы» и «Мой день» перенаправляют', () => {
    expect(existsSync(join(root, 'app/api/orders/production/route.ts'))).toBe(false)
    expect(read('app/orders/page.tsx')).toContain("redirect('/b2b-orders')")
    expect(read('app/my-day/page.tsx')).toContain("redirect('/')")
    expect(read('app/admin/installations/page.tsx')).toContain("redirect('/installations')")
  })

  it('в меню нет «Заказов», «Моего дня» и второго экрана «Монтажей»', () => {
    const menus = read('components/Sidebar.tsx') + read('lib/nav/managerMenu.ts')
    expect(menus).not.toMatch(/href: '\/orders'/)
    expect(menus).not.toMatch(/href: '\/my-day'/)
    expect(menus).not.toMatch(/href: '\/admin\/installations'/)
  })
})
