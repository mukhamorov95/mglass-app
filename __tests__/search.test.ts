import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseQuery, toGroups, quickActions } from '@/lib/search'

describe('parseQuery', () => {
  it('номер заказа — и текстом, и цифрами', () => {
    expect(parseQuery('05268')).toEqual({ q: '05268', digits: '05268' })
    expect(parseQuery(' #5572 ')).toEqual({ q: '#5572', digits: '5572' })
  })
  it('номер с дефисом остаётся текстом для custom_number', () => {
    expect(parseQuery('0908-4')).toEqual({ q: '0908-4', digits: '09084' })
  })
  it('телефон в любом виде → 10 цифр без 7/8, как phone_key', () => {
    expect(parseQuery('+7 (926) 418-69-72').digits).toBe('9264186972')
    expect(parseQuery('89264186972').digits).toBe('9264186972')
    expect(parseQuery('418-69-72').digits).toBe('4186972')
  })
  it('имя — только текст, подстановочные знаки ilike вырезаны', () => {
    expect(parseQuery('ООО 100%_Стекло\\')).toEqual({ q: 'ООО 100Стекло', digits: '' })
    expect(parseQuery('Громова').digits).toBe('')
  })
  it('длинный ввод обрезается', () => {
    expect(parseQuery('а'.repeat(200)).q.length).toBe(60)
  })
})

describe('toGroups', () => {
  const payload = {
    orders: [{ id: 5572, custom_number: null, client_name: 'ООО Стеклодом', launched_at: null, total: 35031 }],
    clients: [{ id: 7, name: 'ИП Громова', inn: '7701234567', phone: '+7 916 000 00 00' }],
    deals: [],
    calcs: [
      { id: 1, client_name: 'Ирина', client_phone: null, order_number: null, deal_id: 12, status: 'draft', created_at: '2026-09-20T10:00:00Z' },
      { id: 2, client_name: null, client_phone: null, order_number: '77', deal_id: null, status: 'draft', created_at: '2026-09-21T10:00:00Z' },
    ],
  }
  it('пустые группы не показываются, ссылки ведут в карточки', () => {
    const g = toGroups(payload, true)
    expect(g.map(x => x.key)).toEqual(['orders', 'clients', 'calcs'])
    expect(g[0].items[0]).toMatchObject({ title: '#5572 · ООО Стеклодом', subtitle: 'просчёт', href: '/b2b-deal/5572', amount: 35031 })
    expect(g[1].items[0].href).toBe('/b2b-crm/7')
    expect(g[2].items.map(i => i.href)).toEqual(['/deal/12', '/calculations/2'])
  })
  it('без доступа к сделкам расчёт ведёт в сам расчёт, а не в сделку', () => {
    expect(toGroups(payload, false).find(x => x.key === 'calcs')!.items[0].href).toBe('/calculations/1')
  })
  it('пустой ответ — пустой список', () => {
    expect(toGroups(null, true)).toEqual([])
  })
})

describe('quickActions', () => {
  it('только разделы, которые роль может открыть', () => {
    const allowed = new Set(['/b2b-today', '/b2b-quotes'])
    expect(quickActions(p => allowed.has(p)).map(a => a.href)).toEqual(['/b2b-today', '/b2b-quotes'])
  })
})

describe('app_search в миграции', () => {
  it('работает под RLS вызывающего и закрыт для anon', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260929_app_search.sql'), 'utf8')
    expect(sql).toMatch(/security invoker/i)
    expect(sql).not.toMatch(/security definer/i)
    expect(sql).toMatch(/revoke all on function public\.app_search[^;]+from public, anon/i)
  })
})
