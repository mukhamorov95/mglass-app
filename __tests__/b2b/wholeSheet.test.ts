import { describe, it, expect } from 'vitest'
import { piecesPerSheet, sheetAreaM2, wholeSheetsFor, workingField } from '@/lib/b2b/wholeSheet'

const matte = { sheet_width: 3210, sheet_height: 2250, sheet_edge_mm: 10 }
const clear = { sheet_width: 3210, sheet_height: 2250 }

describe('крупная деталь — целым листом', () => {
  it('рабочее поле матового листа — без 10 мм вдоль обеих длинных сторон', () => {
    expect(workingField(matte)).toEqual({ long: 3210, short: 2230 })
    expect(workingField(clear)).toEqual({ long: 3210, short: 2250 })
    expect(workingField({ sheet_width: 0, sheet_height: 2250 })).toBeNull()
  })
  it('05662: сатин 1155×2772 — вторая такая же не ложится, три детали — три листа', () => {
    expect(piecesPerSheet(1155, 2772, workingField(matte)!)).toBe(1)
    expect(wholeSheetsFor(1155, 2772, 3, matte)).toBe(3)
    expect(sheetAreaM2(matte)).toBeCloseTo(7.2225, 6)
  })
  it('кромка решает: 1120 по ширине — на прозрачном две в ряд, на матовом одна', () => {
    expect(wholeSheetsFor(1120, 3000, 1, clear)).toBeNull()
    expect(wholeSheetsFor(1120, 3000, 1, matte)).toBe(1)
  })
  it('мелкая деталь и деталь больше листа — правило не действует', () => {
    expect(wholeSheetsFor(600, 2200, 1, clear)).toBeNull()
    expect(wholeSheetsFor(2300, 3300, 1, clear)).toBeNull()
  })
})
