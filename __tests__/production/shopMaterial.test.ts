import { describe, it, expect } from 'vitest'
import { shopMaterial, shopMaterialLabel } from '@/lib/orderFlags'
import { writeFor, shopRequestMove } from '@/lib/purchasing/supply'

const req = (status: string, expected: string | null = null) => ({ status, expected })

describe('плашка у резчика — нужно / заказан к <дата> / есть', () => {
  it('цех нажал «Нет мат.», закупщик ещё не трогал — «нужно»', () => {
    expect(shopMaterial('needed', req('need'))).toEqual({ state: 'needed', expected: null })
    expect(shopMaterial('needed', null)).toEqual({ state: 'needed', expected: null })
  })

  it('закупщик отметил «заказан» и затёр needed — плашка не пропадает, а показывает дату', () => {
    expect(shopMaterial('ordered', req('ordered', '2026-10-09'))).toEqual({ state: 'ordered', expected: '2026-10-09' })
    expect(shopMaterial('invoice_received', req('need'))).toEqual({ state: 'ordered', expected: null })
  })

  it('заявку отметили «заказано» в закупках цеха, статус заказа ещё needed — «заказан»', () => {
    expect(shopMaterial('needed', req('ordered', '2026-10-12'))?.state).toBe('ordered')
  })

  it('материал пришёл — «есть», пока цех сам не скажет «пришёл»', () => {
    expect(shopMaterial('received', req('arrived'))).toEqual({ state: 'arrived', expected: null })
    expect(shopMaterial('needed', req('arrived'))?.state).toBe('arrived')
    expect(shopMaterial('ordered', req('arrived'))?.state).toBe('arrived')
  })

  it('цех нажал «Пришёл» (ready) — плашки нет, даже со старой незакрытой заявкой', () => {
    expect(shopMaterial('ready', req('need'))).toBeNull()
    expect(shopMaterial('ready', req('arrived'))).toBeNull()
  })

  it('закупщик заказал сам, без просьбы цеха — у резчика плашки нет', () => {
    expect(shopMaterial('ordered', null)).toBeNull()
    expect(shopMaterial(undefined, null)).toBeNull()
  })

  it('подписи', () => {
    expect(shopMaterialLabel({ state: 'needed', expected: null })).toBe('🛒 материал нужен')
    expect(shopMaterialLabel({ state: 'ordered', expected: '2026-10-09' })).toBe('🚚 заказан к 09.10')
    expect(shopMaterialLabel({ state: 'ordered', expected: null })).toBe('🚚 заказан, срок не назван')
    expect(shopMaterialLabel({ state: 'arrived', expected: null })).toBe('📦 материал есть')
  })
})

describe('отметка закупщика, когда цех ждёт', () => {
  const today = '2026-10-07'
  it('«есть» — «принят», а не ready: ready ставит цех своим «Пришёл»', () => {
    expect(writeFor('in_stock', { materialStatus: 'needed' }, today, { shopWaiting: true }).materialStatus).toBe('received')
    expect(writeFor('in_stock', { materialStatus: 'ordered' }, today, { shopWaiting: true }).materialStatus).toBe('received')
    expect(writeFor('in_stock', {}, today).materialStatus).toBe('ready')
  })

  it('отмена «заказан» возвращает «нет (цех)», если цех ещё ждёт', () => {
    expect(writeFor('not_ordered', { materialStatus: 'ordered' }, today, { shopWaiting: true }).materialStatus).toBe('needed')
  })

  it('заявка цеха идёт следом за отметкой', () => {
    const at = '2026-10-07T10:00:00.000Z'
    expect(shopRequestMove('ordered', at, 'Вера', '2026-10-09')).toEqual({
      fromStatuses: ['need'], patch: { status: 'ordered', ordered_at: at, ordered_by: 'Вера', expected_date: '2026-10-09' },
    })
    expect(shopRequestMove('ordered', at, 'Вера', null).patch).not.toHaveProperty('expected_date')
    expect(shopRequestMove('in_stock', at, 'Вера', null)).toEqual({
      fromStatuses: ['need', 'ordered'], patch: { status: 'arrived', arrived_at: at, arrived_by: 'Вера' },
    })
    expect(shopRequestMove('not_ordered', at, 'Вера', null).fromStatuses).toEqual(['ordered'])
  })
})
