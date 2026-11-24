import { describe, it, expect } from 'vitest'
import { notifyAuthor } from '@/lib/partner/notifyAuthor'

describe('notifyAuthor', () => {
  it('запуск — кто запустил', () => expect(notifyAuthor('in_work', { launched_by_name: 'Нуржан' }, [])).toBe('Нуржан'))
  it('отгрузка — по следу отгрузки', () => expect(notifyAuthor('shipped', { client_shipment: { by: 'Никита', at: '2026-11-20' } }, [])).toBe('Никита'))
  it('готов — последний закрывший упаковку', () => expect(notifyAuthor('ready', {}, [
    { order_id: 1, completed_at: '2026-11-20T08:00:00Z', completed_by_name: 'А' },
    { order_id: 1, completed_at: '2026-11-21T08:00:00Z', completed_by_name: 'Б' },
  ])).toBe('Б'))
  it('нет данных — null, а не выдумка', () => {
    expect(notifyAuthor('in_work', {}, [])).toBeNull()
    expect(notifyAuthor('recalc', { launched_by_name: 'X' }, [])).toBeNull()
    expect(notifyAuthor('shipped', undefined, [])).toBeNull()
  })
})
