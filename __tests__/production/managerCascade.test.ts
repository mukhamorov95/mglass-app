import { describe, it, expect } from 'vitest'
import { orderMarkOf, pickTasksToClose, CASCADE_FROM } from '@/lib/production/managerCascade'
import { isLiveShopOrder } from '@/lib/production/liveOrder'

const t = (id: number, stage_key: string, status = 'queued') => ({ id, stage_key, status })

describe('отметка заказа мимо цеха закрывает его задачи', () => {
  it('отгрузка важнее упаковки, снятие отметки — не повод закрывать', () => {
    expect(orderMarkOf({ shipped: '2026-10-07', packaged: '2026-10-06' })).toBe('shipped')
    expect(orderMarkOf({ packaged: '2026-10-07' })).toBe('packaged')
    expect(orderMarkOf({ packaged: null })).toBeNull()
    expect(orderMarkOf({ shipped: null, packaged: null })).toBeNull()
    expect(orderMarkOf({ shipped: '' })).toBeNull()
    expect(orderMarkOf({ cut: '2026-10-07' })).toBeNull()
  })

  it('закрывает только открытые: очередь, в работе, проблема', () => {
    const tasks = [t(1, 'cutting', 'done'), t(2, 'polishing', 'in_progress'), t(3, 'tempering', 'problem'), t(4, 'packaging')]
    expect(pickTasksToClose(tasks, 'shipped').map(x => x.id)).toEqual([2, 3, 4])
  })

  it('упаковка закрывает этапы до упаковки включительно', () => {
    const tasks = [t(1, 'cutting'), t(2, 'drilling'), t(3, 'triplex'), t(4, 'packaging')]
    expect(pickTasksToClose(tasks, 'packaged').map(x => x.id)).toEqual([1, 2, 3, 4])
  })

  it('неизвестный этап упаковка не закрывает, отгрузка — закрывает', () => {
    const tasks = [t(1, 'installation')]
    expect(pickTasksToClose(tasks, 'packaged')).toEqual([])
    expect(pickTasksToClose(tasks, 'shipped').map(x => x.id)).toEqual([1])
  })

  it('источник закрытия отличим от станции цеха', () => {
    expect(CASCADE_FROM.manager.packaged).not.toBe('packaging')
    expect(CASCADE_FROM.manager.shipped).toMatch(/^manager:/)
    expect(CASCADE_FROM.shipping.shipped).toMatch(/^shipping:/)
  })
})

describe('живой заказ цеха', () => {
  it('архивный и отгруженный — не работа цеха', () => {
    expect(isLiveShopOrder({ archived_at: null, notes: '{}' })).toBe(true)
    expect(isLiveShopOrder({ archived_at: '2026-10-01T00:00:00Z', notes: '{}' })).toBe(false)
    expect(isLiveShopOrder({ notes: JSON.stringify({ stages: { shipped: '2026-10-05' } }) })).toBe(false)
    expect(isLiveShopOrder({ notes: JSON.stringify({ stages: { shipped: true } }) })).toBe(false)
    expect(isLiveShopOrder({ notes: JSON.stringify({ stages: { packaged: '2026-10-05' } }) })).toBe(true)
    expect(isLiveShopOrder({ notes: null })).toBe(true)
  })
})
