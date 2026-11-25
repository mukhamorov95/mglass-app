import { describe, it, expect } from 'vitest'
import { parseWhipLength, supplierCostPerM, guessFrameColor, decorFrameLine, type SupplierRow } from '@/lib/mirror/frameDecor'
import type { MirrorFrame } from '@/lib/types'

const frame = (p: Partial<MirrorFrame & { supplier_row_id: number | null }>) => ({
  id: 5, article: 'FSZP-10.3 AL/BL', name: 'FSZP-10.3', supplier: 'АВ24', supplier_url: null, frame_type: 'slim', color: 'black',
  profile_size: null, whip_length_m: 3, cost_per_m: 0, sale_per_m: 0, waste_factor: 1.1,
  cut_minutes: 10, assemble_minutes: 25, pack_minutes: 5, assemble_cost_rub: 300, assemble_sale_rub: 900,
  image_url: null, active: true, sort_order: 0, notes: null, created_at: '', supplier_row_id: null, ...p,
}) as MirrorFrame & { supplier_row_id: number | null }

const row: SupplierRow = { id: 77, supplier: 'av24', article: 'FSZP-10.3 AL/BL', name: 'Профиль … длина 3 метра, алюминий/черный', color: 'черный', unit: 'шт', cost_price: 292 }

describe('обрамление зеркала', () => {
  it('длина хлыста и цена метра из прайса', () => {
    expect(parseWhipLength('Профиль FSZP-20.3 толщиной 6 мм, длина 3 м, алюминий')).toBe(3)
    expect(parseWhipLength('длина 3 метра')).toBe(3)
    expect(parseWhipLength('Труба АД31Т1 20х10х1,5х6000')).toBe(6)
    expect(supplierCostPerM(row, 3)).toBeCloseTo(97.33, 2)
    expect(supplierCostPerM({ ...row, unit: 'м.п.' }, 3)).toBe(292)
    expect(guessFrameColor('брашированное золото')).toBe('brush')
    expect(guessFrameColor('черный')).toBe('black')
  })
  it('600×800: периметр 2,8 м × 1,1 = 3,08 м → 2 хлыста по прайсу + сборка', () => {
    const l = decorFrameLine(frame({ supplier_row_id: 77 }), [row], 600, 800, { marginPct: 40, taxPct: 12 })
    expect(l.problem).toBeNull()
    expect(l.whips).toBe(2)
    expect(l.costFrom).toBe('supplier')
    expect(l.cost).toBe(292 * 2 + 300)
    expect(l.saleFrom).toBe('formula')
    expect(l.sale).toBe(Math.round((292 * 2 + 300) / 0.48))
  })
  it('продажа метра из справочника — расход × цена + сборка', () => {
    const l = decorFrameLine(frame({ cost_per_m: 100, sale_per_m: 400 }), [], 600, 800, { marginPct: 40, taxPct: 12 })
    expect(l.saleFrom).toBe('directory')
    expect(l.sale).toBe(Math.round(3.08 * 400) + 900)
  })
  it('без себестоимости — причина, а не ноль', () => {
    expect(decorFrameLine(frame({}), [], 600, 800, { marginPct: 40, taxPct: 12 }).problem).toMatch(/нет себестоимости/)
  })
})
