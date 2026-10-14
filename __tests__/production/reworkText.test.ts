import { describe, it, expect } from 'vitest'
import { reworkPreviewLine, reworkResultText, type ReworkResult } from '@/lib/production/reworkText'
import { FOUND_AFTER_PRODUCTION } from '@/lib/production/rework'

const res = (p: Partial<ReworkResult>): ReworkResult => ({
  itemIndex: 0, foundAtStage: 'tempering', restartStage: 'cutting', reopen: 4, noRoute: false,
  notified: true, warnings: [], ...p,
})

describe('подтверждение называет последствие до записи', () => {
  it('сколько этапов вернётся и с какого', () => {
    expect(reworkPreviewLine(res({ itemIndex: 1 }))).toBe('Поз. 2: заново с этапа «Резка» — в очередь вернётся 4 этапа')
    expect(reworkPreviewLine(res({ reopen: 1, restartStage: 'packaging' }))).toBe('Поз. 1: заново с этапа «Упаковка» — в очередь вернётся 1 этап')
    expect(reworkPreviewLine(res({ reopen: 5 }))).toContain('5 этапов')
  })

  it('прошедшая цех позиция — маршрут не меняется, решает менеджер', () => {
    expect(reworkPreviewLine(res({ reopen: 0, foundAtStage: FOUND_AFTER_PRODUCTION })))
      .toBe('Поз. 1: уже прошла цех — маршрут не меняется, о переделке решит менеджер')
  })

  it('нет маршрута — только журнал', () => {
    expect(reworkPreviewLine(res({ reopen: 0, noRoute: true }))).toContain('только в журнал брака')
  })
})

describe('итог говорит, что записано, где деталь и что осталось', () => {
  it('позиции сгруппированы по этапу перезапуска', () => {
    const { title, detail } = reworkResultText([
      res({ itemIndex: 0 }), res({ itemIndex: 2 }), res({ itemIndex: 3, reopen: 0, foundAtStage: FOUND_AFTER_PRODUCTION }),
    ], 'Бой при закалке')
    expect(title).toBe('Брак записан: 3 поз. — Бой при закалке')
    expect(detail).toContain('Поз. 1, 3 снова в очереди цеха с этапа «Резка» — видно в «Моей очереди».')
    expect(detail).toContain('Поз. 4: маршрут не менялся, запись — в журнале брака.')
    expect(detail).toContain('Менеджеру отправлено сообщение.')
  })

  it('не ушло менеджеру — так и сказано, с просьбой сказать голосом', () => {
    const { detail } = reworkResultText([res({ notified: false, itemIndex: 1 })], 'Брак кромки')
    expect(detail).toContain('Менеджеру сообщение не ушло (поз. 2) — скажите ему.')
    expect(detail).not.toContain('отправлено')
  })

  it('предупреждения сервера не теряются', () => {
    const { detail } = reworkResultText([res({ warnings: ['переоткрыто 2 из 4 этапов'] })], 'Другое')
    expect(detail).toContain('Поз. 1: переоткрыто 2 из 4 этапов.')
  })
})
