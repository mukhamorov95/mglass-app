import { describe, it, expect } from 'vitest'
import { isPartnerService, pickServices, publicServices, serviceIdsOf } from '@/lib/partner/partnerServices'
import type { B2BService } from '@/lib/types'

const svc = (id: number, name: string, type: B2BService['type'], value = 10, cost_price = 5): B2BService =>
  ({ id, name, type, value, cost_price, description: '', active: true, sort_order: id })

const all = [svc(9, 'Непрямоугольная форма', 'percent', 30), svc(10, 'Фигурные', 'calculated'), svc(15, 'Вектор', 'fixed', 1000),
  svc(16, 'Триплекс', 'per_m2', 4500), svc(19, 'Плёнка', 'film'), svc(28, 'Пескоструй', 'per_m2', 3000)]

describe('partnerServices', () => {
  it('только простые типы, без триплекса', () => {
    expect(all.filter(isPartnerService).map(s => s.id)).toEqual([9, 15, 28])
  })
  it('наружу без себестоимости', () => {
    expect(publicServices(all)[0]).toEqual({ id: 9, name: 'Непрямоугольная форма', type: 'percent', value: 30 })
    expect(JSON.stringify(publicServices(all))).not.toContain('cost')
  })
  it('выбор по id — цена из справочника, чужие и запрещённые отбрасываются', () => {
    expect(pickServices(all, [9, 10, 16, 999, 'x']).map(s => s.id)).toEqual([9])
    expect(pickServices(all, null)).toEqual([])
  })
  it('id услуг из сохранённой позиции, без авто-надбавок', () => {
    expect(serviceIdsOf({ services: [{ id: 9 }, { id: -1000004 }, { id: 15 }] })).toEqual([9, 15])
  })
})
