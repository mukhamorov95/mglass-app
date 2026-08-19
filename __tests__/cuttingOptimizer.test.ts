import { describe, it, expect } from 'vitest'
import {
  runCuttingOptimizer, DEFAULT_CUTTING_SETTINGS,
  type PieceGroup, type CuttingPiece,
} from '../lib/cuttingOptimizer'

function piece(id: string, w: number, h: number): CuttingPiece {
  return { id, width: w, height: h, label: `${w}x${h}`, orderId: 0, orderClientName: '', materialKey: 'k', canRotate: true }
}
function oneGroup(over: Partial<PieceGroup>): Map<string, PieceGroup> {
  const g: PieceGroup = {
    pieces: [], materialLabel: 'M', category: 'стекло',
    sheetWidth: 3210, sheetHeight: 2250, patternDirection: 'none', ...over,
  }
  return new Map([['k', g]])
}

describe('cuttingOptimizer — выбор формата листа', () => {
  it('выбирает формат, в который детали влезают (меньше нераскроенных)', () => {
    // Деталь 2200×1500 не влезает в 2000×2000, но влезает в 3210×2250.
    const pieces = [piece('a', 2200, 1500), piece('b', 2200, 1500)]
    const r = runCuttingOptimizer(
      oneGroup({ pieces, sheetFormats: [{ width: 2000, height: 2000 }, { width: 3210, height: 2250 }] }),
      DEFAULT_CUTTING_SETTINGS,
    )
    expect(r[0].unplacedCount).toBe(0)
    expect(r[0].sheetWidth).toBe(3210)
    expect(r[0].sheetHeight).toBe(2250)
  })

  it('при равном числе листов берёт меньший по площади (меньше закупки/отхода)', () => {
    const pieces = [piece('a', 500, 500)]
    const r = runCuttingOptimizer(
      oneGroup({ pieces, sheetFormats: [{ width: 3210, height: 2250 }, { width: 1000, height: 1000 }] }),
      DEFAULT_CUTTING_SETTINGS,
    )
    expect(r[0].sheetsNeeded).toBe(1)
    expect(r[0].sheetWidth).toBe(1000)
    expect(r[0].sheetHeight).toBe(1000)
  })

  it('без заданных форматов кроит на дефолтный размер группы', () => {
    const r = runCuttingOptimizer(oneGroup({ pieces: [piece('a', 500, 500)] }), DEFAULT_CUTTING_SETTINGS)
    expect(r[0].sheetWidth).toBe(3210)
    expect(r[0].sheetHeight).toBe(2250)
  })

  it('дедуп одинаковых форматов не ломает выбор', () => {
    const r = runCuttingOptimizer(
      oneGroup({ pieces: [piece('a', 500, 500)], sheetFormats: [{ width: 2000, height: 2000 }, { width: 2000, height: 2000 }] }),
      DEFAULT_CUTTING_SETTINGS,
    )
    expect(r[0].sheetsNeeded).toBe(1)
    expect(r[0].sheetWidth).toBe(2000)
  })

  it('игнорирует некорректные форматы и падает на дефолт', () => {
    const r = runCuttingOptimizer(
      oneGroup({ pieces: [piece('a', 500, 500)], sheetFormats: [{ width: 0, height: 0 }] }),
      DEFAULT_CUTTING_SETTINGS,
    )
    expect(r[0].sheetWidth).toBe(3210)
  })
})

describe('cuttingOptimizer — направление рисунка (фактурное стекло)', () => {
  // Лист 2100×1100 (ландшафт), деталь 900×2000 (портрет): влезает ТОЛЬКО повёрнутой.
  const sheet = { sheetWidth: 2100, sheetHeight: 1100 }
  const portrait = () => [piece('a', 900, 2000)]

  it('обычное стекло: поворот разрешён — деталь раскроена', () => {
    const r = runCuttingOptimizer(oneGroup({ ...sheet, pieces: portrait(), patternDirection: 'none' }), DEFAULT_CUTTING_SETTINGS)
    expect(r[0].unplacedCount).toBe(0)
  })

  it('фактурное (вдоль длины): поворот запрещён — деталь НЕ влезает без вращения', () => {
    const r = runCuttingOptimizer(oneGroup({ ...sheet, pieces: portrait(), patternDirection: 'along_length' }), DEFAULT_CUTTING_SETTINGS)
    expect(r[0].unplacedCount).toBe(1)
  })

  it('respect_pattern=false: поворот разрешён даже для фактурного', () => {
    const r = runCuttingOptimizer(
      oneGroup({ ...sheet, pieces: portrait(), patternDirection: 'along_length' }),
      { ...DEFAULT_CUTTING_SETTINGS, respect_pattern: false },
    )
    expect(r[0].unplacedCount).toBe(0)
  })
})
