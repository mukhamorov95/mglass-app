import { describe, it, expect } from 'vitest'
import { renumberItem, canonicalIndex, itemNeedsStage, type ExistingTask } from '@/lib/production/addStage'

const t = (stage: string, seq: number, item = 0): ExistingTask => ({ item_index: item, stage_key: stage, sequence_order: seq })

describe('вставка пропущенного этапа', () => {
  const current = [t('cutting', 1), t('polishing', 2), t('tempering', 3), t('packaging', 4)]

  it('сверловка встаёт между полировкой и закалкой, а не в конец', () => {
    const r = renumberItem(current, 'drilling')
    expect(r.map(x => x.stage_key)).toEqual(['cutting', 'polishing', 'drilling', 'tempering', 'packaging'])
  })

  it('номера идут подряд и без совпадений — иначе цепочка ожидания неопределённа', () => {
    const r = renumberItem(current, 'drilling')
    expect(r.map(x => x.sequence_order)).toEqual([1, 2, 3, 4, 5])
    expect(new Set(r.map(x => x.sequence_order)).size).toBe(r.length)
  })

  it('новым помечен только добавленный этап', () => {
    const r = renumberItem(current, 'drilling')
    expect(r.filter(x => x.isNew).map(x => x.stage_key)).toEqual(['drilling'])
  })

  it('добавление уже существующего этапа ничего не создаёт', () => {
    const r = renumberItem(current, 'polishing')
    expect(r.filter(x => x.isNew)).toHaveLength(0)
    expect(r).toHaveLength(4)
  })

  it('песочка встаёт после фацета и до закалки', () => {
    const r = renumberItem([t('cutting', 1), t('facet', 2), t('tempering', 3)], 'sandblast')
    expect(r.map(x => x.stage_key)).toEqual(['cutting', 'facet', 'sandblast', 'tempering'])
  })

  it('порядок берётся из канонического маршрута, а не из порядка задач в базе', () => {
    const shuffled = [t('packaging', 9), t('cutting', 1), t('tempering', 5)]
    expect(renumberItem(shuffled, 'drilling').map(x => x.stage_key))
      .toEqual(['cutting', 'drilling', 'tempering', 'packaging'])
  })

  it('canonicalIndex ставит резку раньше упаковки', () => {
    expect(canonicalIndex('cutting')).toBeLessThan(canonicalIndex('packaging'))
  })

  it('неизвестный этап уходит в конец, а не ломает сортировку', () => {
    const r = renumberItem([t('cutting', 1)], 'выдуманный')
    expect(r[r.length - 1].stage_key).toBe('выдуманный')
  })

  it('видно, каким деталям этап нужен', () => {
    const tasks = [t('cutting', 1, 0), t('drilling', 2, 0), t('cutting', 1, 1)]
    expect(itemNeedsStage(tasks, 0, 'drilling')).toBe(false)
    expect(itemNeedsStage(tasks, 1, 'drilling')).toBe(true)
  })
})
