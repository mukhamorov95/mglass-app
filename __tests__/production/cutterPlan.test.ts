import { describe, it, expect } from 'vitest'
import { allocateToSheets, itemsToCut, cutPriority } from '@/lib/production/cutterPlan'
import { DEFAULT_CUTTING_SETTINGS, type PieceGroup, type CuttingPiece } from '@/lib/cuttingOptimizer'

const piece = (orderId: number, w: number, h: number, i: number): CuttingPiece => ({
  id: `${orderId}-${i}`, width: w, height: h, label: `${w}×${h}`, orderId, orderClientName: '', materialKey: 'k', canRotate: true,
})
const group = (pieces: CuttingPiece[]): PieceGroup => ({ pieces, materialLabel: 'Стекло 8 мм', category: '', sheetWidth: 3210, sheetHeight: 2250, patternDirection: 'none' })

describe('режим резчика', () => {
  it('режем только позиции с открытой резкой', () => {
    const tasks = [
      { item_index: 0, stage_key: 'cutting', status: 'done' },
      { item_index: 1, stage_key: 'cutting', status: 'open' },
      { item_index: 1, stage_key: 'tempering', status: 'open' },
    ]
    expect(itemsToCut(['a', 'b', 'c'], tasks, t => t.status === 'done').map(x => x.item)).toEqual(['b'])
    expect(itemsToCut(['a'], [], () => false)).toEqual([])
  })
  it('старые заказы первыми', () => {
    const list = [{ id: 2, no: '2', client: '', launch_day: '2026-11-20' }, { id: 1, no: '1', client: '', launch_day: '2026-11-10' }]
    expect([...list].sort(cutPriority).map(o => o.id)).toEqual([1, 2])
  })
  it('один лист: старый заказ целиком, новый — часть, лишнее не влезло', () => {
    // Лист 3210×2250: шесть деталей 1000×1000 влезают, седьмая — нет.
    const old = [0, 1, 2, 3].map(i => piece(1, 1000, 1000, i))
    const fresh = [0, 1, 2, 3].map(i => piece(2, 1000, 1000, i))
    const a = allocateToSheets(group([...fresh, ...old]), 1, DEFAULT_CUTTING_SETTINGS, new Map([[1, 0], [2, 1]]))
    expect(a.result?.sheetsNeeded).toBe(1)
    expect(a.byOrder[0]).toEqual({ orderId: 1, placed: 4, total: 4 })
    expect(a.byOrder[1].orderId).toBe(2)
    expect(a.byOrder[1].placed).toBeGreaterThan(0)
    expect(a.byOrder[1].placed).toBeLessThan(4)
    expect(a.placed.length + a.skipped.length).toBe(8)
  })
  it('ноль листов — ничего не раскладываем', () => {
    const a = allocateToSheets(group([piece(1, 500, 500, 0)]), 0, DEFAULT_CUTTING_SETTINGS, new Map())
    expect(a.placed).toEqual([])
    expect(a.skipped.length).toBe(1)
  })
})
