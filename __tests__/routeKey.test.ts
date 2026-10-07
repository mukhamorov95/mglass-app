import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { routeKey, createPageViewDeduper, isWallRoute } from '@/lib/routeKey'

describe('routeKey', () => {
  it('идентификаторы сводит в [id], обычные сегменты с цифрами не трогает', () => {
    expect(routeKey('/b2b-deal/5564')).toBe('/b2b-deal/[id]')
    expect(routeKey('/calculator/b2b')).toBe('/calculator/b2b')
    expect(routeKey('/b2b-orders/0908-4/print')).toBe('/b2b-orders/[id]/print')
    expect(routeKey('/deal/3f2a1b4c-1d2e-4f5a-9b8c-7d6e5f4a3b2c')).toBe('/deal/[id]')
    expect(routeKey('/kp/share/abcdefghijklmnopqrstuvwxyz0123')).toBe('/kp/share/[id]')
    expect(routeKey('/')).toBe('/')
    expect(routeKey('/production-app/board/')).toBe('/production-app/board')
  })

  it('кириллица и прочие символы в сегменте — тоже [id], чтобы функция в базе не отбросила строку', () => {
    expect(routeKey('/clients/%D0%98%D0%B2%D0%B0%D0%BD')).toBe('/clients/[id]')
  })

  it('результат всегда проходит проверку функции track_page_view', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260929_user_page_days.sql'), 'utf8')
    const m = sql.match(/p_route !~ '([^']+)'/)
    expect(m).not.toBeNull()
    const re = new RegExp(m![1])
    for (const p of ['/', '/b2b-deal/5564', '/calculator/b2b', '/clients/%D0%98', '/deals/board', '/x/' + 'a'.repeat(200)]) {
      expect(re.test(routeKey(p)), p).toBe(true)
    }
  })
})

describe('счётчик в браузере (08.10)', () => {
  it('смена пути — переход, тот же путь подряд — нет', () => {
    const next = createPageViewDeduper()
    expect(next('/b2b-today')).toBe('/b2b-today')
    expect(next('/b2b-today')).toBeNull()
    expect(next('/b2b-deal/5564')).toBe('/b2b-deal/[id]')
    expect(next('/b2b-deal/5565')).toBe('/b2b-deal/[id]')
    expect(next('/b2b-today')).toBe('/b2b-today')
  })

  it('пустой путь, API и внутренние адреса не считаются', () => {
    const next = createPageViewDeduper()
    expect(next(null)).toBeNull()
    expect(next(undefined)).toBeNull()
    expect(next('')).toBeNull()
    expect(next('/api/search')).toBeNull()
    expect(next('/_next/static/x.js')).toBeNull()
  })

  it('у каждой вкладки свой счётчик подряд', () => {
    const a = createPageViewDeduper()
    const b = createPageViewDeduper()
    expect(a('/')).toBe('/')
    expect(b('/')).toBe('/')
  })

  it('middleware больше не пишет переходы — иначе двойной счёт', () => {
    const mw = readFileSync(join(process.cwd(), 'middleware.ts'), 'utf8')
    expect(mw).not.toContain('track_page_view')
  })

  it('экраны-стены помечены', () => {
    expect(isWallRoute('/device-limit')).toBe(true)
    expect(isWallRoute('/access-denied')).toBe(true)
    expect(isWallRoute('/b2b-quotes')).toBe(false)
  })
})
