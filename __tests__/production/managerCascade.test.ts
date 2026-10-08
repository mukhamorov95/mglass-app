import { describe, it, expect } from 'vitest'
import { orderMarkOf, orderUnmarksOf, pickTasksToClose, pickTasksToReopen, CASCADE_FROM } from '@/lib/production/managerCascade'
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

describe('снятие отметки возвращает в очередь закрытое этим каскадом', () => {
  const c = (id: number, stage_key: string, from: string | null, extra: Partial<{ status: string; auto_closed: boolean; completed_by: string | null }> = {}) =>
    ({ id, stage_key, status: 'done', auto_closed: true, auto_closed_from: from, completed_by: null, ...extra })

  it('снятые отметки — ключ пришёл пустым; поставленные и отсутствующие — нет', () => {
    expect(orderUnmarksOf({ packaged: null })).toEqual(['packaged'])
    expect(orderUnmarksOf({ shipped: null, packaged: null })).toEqual(['packaged', 'shipped'])
    expect(orderUnmarksOf({ shipped: '', packaged: false })).toEqual(['packaged', 'shipped'])
    expect(orderUnmarksOf({ packaged: '2026-10-08' })).toEqual([])
    expect(orderUnmarksOf({ cut: null })).toEqual([])
  })

  it('переоткрывается только закрытое этим каскадом и без исполнителя', () => {
    const tasks = [
      c(1, 'cutting', 'manager:packaged'),
      c(2, 'packaging', 'manager:packaged'),
      c(3, 'cutting', 'manager:shipped'),                               // другой каскад
      c(4, 'polishing', 'tempering'),                                   // каскад цеха
      c(5, 'drilling', 'manager:packaged', { completed_by: 'u1' }),     // отметил человек
      c(6, 'tempering', 'manager:packaged', { auto_closed: false }),
      c(7, 'tempering', 'manager:packaged', { status: 'queued' }),      // уже открыта
      c(8, 'cutting', null),
    ]
    expect(pickTasksToReopen(tasks, [CASCADE_FROM.manager.packaged], null).map(t => t.id)).toEqual([1, 2])
    expect(pickTasksToReopen(tasks, [CASCADE_FROM.manager.shipped], null).map(t => t.id)).toEqual([3])
  })

  it('оставшаяся отметка держит своё: отгружен — ничего, упакован — до упаковки не трогаем', () => {
    const tasks = [c(1, 'cutting', 'shipping:shipped'), c(2, 'packaging', 'shipping:shipped'), c(3, 'custom_stage', 'shipping:shipped')]
    expect(pickTasksToReopen(tasks, [CASCADE_FROM.shipping.shipped], 'shipped')).toEqual([])
    expect(pickTasksToReopen(tasks, [CASCADE_FROM.shipping.shipped], 'packaged').map(t => t.id)).toEqual([3])
    expect(pickTasksToReopen(tasks, [CASCADE_FROM.shipping.shipped], null).map(t => t.id)).toEqual([1, 2, 3])
  })
})
