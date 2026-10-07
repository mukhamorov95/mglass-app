import { describe, it, expect } from 'vitest'
import { queueEmptyState } from '@/lib/production/queueState'
import { canCloseWholeOrder } from '@/lib/production/completeOrder'

describe('пустой экран «Мои задачи» говорит, почему он пустой', () => {
  it('ошибка загрузки важнее всего — даже если что-то успело прийти', () => {
    expect(queueEmptyState({ loadError: 'сеть', stations: ['cutting'], assignedToMe: 0, visible: 3 })).toBe('error')
    expect(queueEmptyState({ loadError: 'сеть', stations: [], assignedToMe: 0, visible: 0 })).toBe('error')
  })

  it('станция не назначена и лично ничего не назначено — дело в профиле', () => {
    expect(queueEmptyState({ loadError: null, stations: [], assignedToMe: 0, visible: 0 })).toBe('no-station')
  })

  it('станции есть, задач нет — правда пусто', () => {
    expect(queueEmptyState({ loadError: null, stations: ['polishing'], assignedToMe: 0, visible: 0 })).toBe('empty')
  })

  it('без станции, но с назначенной лично работой, которую фильтр скрыл, — пусто, а не «нет станции»', () => {
    expect(queueEmptyState({ loadError: null, stations: [], assignedToMe: 2, visible: 0 })).toBe('empty')
  })

  it('есть что показать — не пусто', () => {
    expect(queueEmptyState({ loadError: null, stations: [], assignedToMe: 1, visible: 1 })).toBeNull()
  })
})

describe('«Всё готово» на заказ — тем же правилом, что на сервере', () => {
  it('упаковщик и владелец — да, остальные — нет', () => {
    expect(canCloseWholeOrder('production', ['tempering', 'packaging'])).toBe(true)
    expect(canCloseWholeOrder('admin', [])).toBe(true)
    expect(canCloseWholeOrder('ceo', null)).toBe(true)
    expect(canCloseWholeOrder('production', ['cutting', 'polishing'])).toBe(false)
    expect(canCloseWholeOrder('buyer', null)).toBe(false)
    expect(canCloseWholeOrder(null, undefined)).toBe(false)
  })
})
