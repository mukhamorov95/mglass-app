import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { routeKey, isTrackablePageRequest, isWallRoute } from '@/lib/routeKey'

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

describe('isTrackablePageRequest', () => {
  const h = (o: Record<string, string> = {}) => new Headers(o)
  it('страница — да; API, статика, POST и предзагрузка — нет', () => {
    expect(isTrackablePageRequest('/b2b-today', 'GET', h())).toBe(true)
    expect(isTrackablePageRequest('/b2b-today', 'GET', h({ rsc: '1' }))).toBe(true)
    expect(isTrackablePageRequest('/api/invoices', 'GET', h())).toBe(false)
    expect(isTrackablePageRequest('/_next/data/x.json', 'GET', h())).toBe(false)
    expect(isTrackablePageRequest('/b2b-today', 'POST', h())).toBe(false)
    expect(isTrackablePageRequest('/b2b-today', 'GET', h({ 'next-router-prefetch': '1' }))).toBe(false)
    expect(isTrackablePageRequest('/b2b-today', 'GET', h({ 'sec-purpose': 'prefetch' }))).toBe(false)
  })
})

describe('что считается переходом человека (У12)', () => {
  const h = (o: Record<string, string>) => new Headers(o)

  it('загрузка страницы целиком считается', () => {
    expect(isTrackablePageRequest('/b2b-quotes', 'GET', h({ 'sec-fetch-dest': 'document' }))).toBe(true)
  })

  it('переход внутри приложения считается', () => {
    expect(isTrackablePageRequest('/b2b-quotes', 'GET', h({ 'sec-fetch-dest': 'empty', rsc: '1' }))).toBe(true)
  })

  it('фоновый запрос к адресу страницы не считается', () => {
    expect(isTrackablePageRequest('/b2b-quotes', 'GET', h({ 'sec-fetch-dest': 'empty' }))).toBe(false)
    expect(isTrackablePageRequest('/b2b-quotes', 'GET', h({ 'sec-fetch-dest': 'iframe' }))).toBe(false)
  })

  it('подгрузка ссылки роутером не считается', () => {
    expect(isTrackablePageRequest('/b2b-quotes', 'GET', h({ 'sec-fetch-dest': 'document', 'next-router-prefetch': '1' }))).toBe(false)
    expect(isTrackablePageRequest('/b2b-quotes', 'GET', h({ 'sec-purpose': 'prefetch;prerender' }))).toBe(false)
  })

  it('браузер без Sec-Fetch-* не теряется', () => {
    expect(isTrackablePageRequest('/b2b-quotes', 'GET', h({}))).toBe(true)
  })

  it('API и внутренние адреса не считаются', () => {
    expect(isTrackablePageRequest('/api/search', 'GET', h({ 'sec-fetch-dest': 'document' }))).toBe(false)
    expect(isTrackablePageRequest('/_next/static/x.js', 'GET', h({ 'sec-fetch-dest': 'document' }))).toBe(false)
    expect(isTrackablePageRequest('/b2b-quotes', 'POST', h({ 'sec-fetch-dest': 'document' }))).toBe(false)
  })

  it('экраны-стены помечены', () => {
    expect(isWallRoute('/device-limit')).toBe(true)
    expect(isWallRoute('/access-denied')).toBe(true)
    expect(isWallRoute('/b2b-quotes')).toBe(false)
  })
})
