import { describe, it, expect } from 'vitest'
import { checkPartForShop, checkPartsForShop, DEFAULT_SHOP_RULES, type ShopPart } from '@/lib/b2b/shopChecklist'

const ok: ShopPart = {
  label: 'Душ', width: 900, height: 2000, thickness: 8, material: 'Прозрачное', quantity: 1,
  isMirror: false, tempering: true, shape: 'rect',
  holes: [{ d: 14, x: 60, y: 300 }, { d: 14, x: 60, y: 1700 }], cutouts: [],
}
const codes = (p: ShopPart, rules = DEFAULT_SHOP_RULES) => checkPartForShop(p, 0, rules).map(i => i.code)

describe('чек-лист детали для цеха', () => {
  it('полная деталь — готова', () => expect(checkPartsForShop([ok])).toMatchObject({ ready: true, blocking: 0, warnings: 0 }))
  it('эскиз без размеров и толщины — блок, с вопросом', () => {
    const r = checkPartForShop({ ...ok, width: null, thickness: null })
    expect(r.map(i => i.code)).toEqual(expect.arrayContaining(['size_missing', 'thickness_missing']))
    expect(r.every(i => i.severity === 'block' && i.ask.length > 0)).toBe(true)
  })
  it('отверстие без диаметра и без привязки — две разные просьбы', () => {
    expect(codes({ ...ok, holes: [{ d: null, x: 50, y: 50 }] })).toContain('hole_no_diameter')
    expect(codes({ ...ok, holes: [{ d: 10, x: null, y: 50 }] })).toContain('hole_no_position')
  })
  it('на чертеже 4 отверстия, размеры у 2 — спросить про остальные', () => expect(codes({ ...ok, holesSeen: 4 })).toContain('holes_count_mismatch'))
  it('отверстие за краем — ошибка в размерах', () => expect(codes({ ...ok, holes: [{ d: 20, x: 895, y: 300 }] })).toContain('hole_outside'))
  it('больше листа 3210 × 2250 — блок; повёрнутая деталь влезает', () => {
    expect(codes({ ...ok, width: 2300, height: 3300 })).toContain('too_big_for_sheet')
    expect(codes({ ...ok, width: 3200, height: 2200 })).not.toContain('too_big_for_sheet')
  })
  it('зеркало с закалкой — блок; стекло без ответа о закалке — вопрос', () => {
    expect(codes({ ...ok, isMirror: true, tempering: true })).toContain('mirror_tempering')
    expect(checkPartForShop({ ...ok, tempering: null })).toEqual([expect.objectContaining({ code: 'tempering_unknown', severity: 'warn' })])
  })
  it('фигурная деталь без габарита заготовки — блок', () => expect(codes({ ...ok, shape: 'curved' })).toContain('curved_no_blank'))
  it('вырез без размеров и привязки', () => expect(codes({ ...ok, cutouts: [{ w: null, h: 40, x: null, y: 10 }] })).toEqual(expect.arrayContaining(['cutout_no_size', 'cutout_no_position'])))
  it('без норм цеха числовые правила молчат — норму не выдумываем', () => {
    expect(codes({ ...ok, holes: [{ d: 4, x: 5, y: 300 }] })).toEqual([])
  })
  it('с нормами цеха — близко к краю, мелкий диаметр, тесно друг к другу', () => {
    const rules = { ...DEFAULT_SHOP_RULES, edgeMin: (t: number) => 2 * t, gapMin: (t: number) => 2 * t, diameterMin: (t: number) => t }
    const c = codes({ ...ok, holes: [{ d: 6, x: 10, y: 300 }, { d: 14, x: 30, y: 300 }] }, rules)
    expect(c).toEqual(expect.arrayContaining(['hole_near_edge', 'hole_too_small', 'holes_too_close']))
  })
})
