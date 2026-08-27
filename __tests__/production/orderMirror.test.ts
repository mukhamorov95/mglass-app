import { describe, it, expect } from 'vitest'
import { pickOrderStageFlags, type MirrorTask } from '@/lib/productionOrderMirror'

const DAY = '2026-08-26'
const t = (stage_key: string, status: string): MirrorTask => ({ stage_key, status })

describe('pickOrderStageFlags — order-level флаг только когда этап закрыт целиком', () => {
  it('все задачи этапа закрыты — флаг ставится датой, а не полным ISO', () => {
    expect(pickOrderStageFlags([t('cutting', 'done'), t('cutting', 'done')], {}, DAY)).toEqual({ cut: DAY })
  })

  it('одна задача этапа открыта — флага нет', () => {
    expect(pickOrderStageFlags([t('cutting', 'done'), t('cutting', 'queued')], {}, DAY)).toEqual({})
  })

  it('задача в проблеме не считается закрытой', () => {
    expect(pickOrderStageFlags([t('cutting', 'problem')], {}, DAY)).toEqual({})
  })

  it('уже стоящий флаг не перезаписывается — там может быть ручная отметка менеджера', () => {
    expect(pickOrderStageFlags([t('cutting', 'done')], { cut: '2026-08-01' }, DAY)).toEqual({})
  })

  it('историческое булево true тоже не затирается', () => {
    expect(pickOrderStageFlags([t('cutting', 'done')], { cut: true }, DAY)).toEqual({})
  })

  it('этап без order-level эквивалента (криволинейка) пропускается', () => {
    expect(pickOrderStageFlags([t('curved', 'done')], {}, DAY)).toEqual({})
  })

  it('несколько закрытых этапов — один патч', () => {
    const tasks = [t('cutting', 'done'), t('polishing', 'done'), t('packaging', 'queued')]
    expect(pickOrderStageFlags(tasks, {}, DAY)).toEqual({ cut: DAY, edge_processed: DAY })
  })

  it('закрытая упаковка даёт packaged — на этот переход в П19 повиснет списание склада', () => {
    expect(pickOrderStageFlags([t('packaging', 'done')], {}, DAY)).toEqual({ packaged: DAY })
  })
})
