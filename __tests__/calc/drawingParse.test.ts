import { describe, it, expect } from 'vitest'
import { drawingToRequest, compareToFixture, glassIdOf, finishIdOf, type ShowerDrawingParse } from '@/lib/calc/drawingParse'
import fixture from '../fixtures/configurator/drawing-0245.json'

const F = fixture as unknown as ShowerDrawingParse

describe('drawingToRequest — эталон 0245', () => {
  it('лист 1 → М4 1450×2310, дверь 650, чёрный, осветлённое матовое, подписи петли и ручки', () => {
    const a = drawingToRequest(F.showers[0])
    expect(a.code).toBe('М4')
    expect(a.dims).toEqual({ width: 1450, height: 2310, doorWidth: 650 })
    expect(a.finishId).toBe('black')
    expect(a.glassId).toBe('matte-crystal')
    expect(a.drawn).toEqual({ hinge: 'FDP-232', handle: 'SD-210' })
    expect(a.stops).toEqual([])
    expect(a.notes).toEqual([])   // высоту вне сетки отмечает buildStops
    expect(a.evidence.find(e => e.field === 'ширина')?.evidence).toContain('1450')
  })

  it('лист 2 → М7 угол 1469 × 916; ширина вне сетки М7 — пометка, а не остановка', () => {
    const a = drawingToRequest(F.showers[1])
    expect(a.code).toBe('М7')
    expect(a.dims).toEqual({ width: 1469, height: 2310, width2: 916, doorWidth: 650 })
    expect(a.stops).toEqual([])
    expect(a.notes).toContain('Ширина 1469 вне сетки М7 700–1400 — нестандарт')
  })
})

describe('расхождение — остановка, а не цена', () => {
  it('не прочитанные поля, чужой цвет, толщина 10, неизвестная модель', () => {
    const s = structuredClone(F.showers[1])
    s.depth_mm = { value: null, evidence: '' }
    s.color = { value: 'Золото', evidence: 'штамп' }
    s.thickness_mm = { value: 10, evidence: 'штамп' }
    const a = drawingToRequest(s)
    expect(a.stops).toEqual([
      'Глубина (боковая сторона) не прочитана',
      'Цвет «Золото» — в «Расчёте» только хром и чёрный',
      'На чертеже стекло 10 мм, «Расчёт» считает 8 мм',
    ])
    const b = drawingToRequest({ ...s, model: { value: 'Душевая-уголок', evidence: '' } })
    expect(b.code).toBeNull()
    expect(b.stops[0]).toBe('Модель не распознана — выберите вручную')
  })

  it('подпись без артикула и неизвестная роль в drawn не попадают', () => {
    const s = structuredClone(F.showers[0])
    s.hardware.push({ label: 'Петля Европа FDP-115', role: 'hinge', article: 'FDP-115', evidence: '' })
    s.hardware.push({ label: 'Полотенцесушитель TS-1', role: 'towel', article: 'TS-1', evidence: '' })
    expect(drawingToRequest(s).drawn).toEqual({ hinge: 'FDP-232', handle: 'SD-210' })
  })
})

describe('сопоставление цвета и стекла', () => {
  it.each([
    ['Стекло осветленное матовое 8 мм', 'matte-crystal'], ['Осветлённое', 'crystal'], ['Сатин', 'matte'],
    ['Прозрачное М1', 'clear'], ['Графит', 'graphite'], ['Бронза', 'bronze'], ['тонированное', null],
  ])('стекло «%s» → %s', (t, id) => expect(glassIdOf(t)).toBe(id))
  it.each([
    ['Черный', 'black'], ['Хром', 'chrome'], ['Хром матовый', 'satin'], ['Матовое золото', 'brgold'],
    ['Розовое золото', 'rose'], ['Оружейная сталь', 'gunmetal'], ['', null],
  ])('цвет «%s» → %s', (t, id) => expect(finishIdOf(t)).toBe(id))
})

describe('compareToFixture', () => {
  it('эталон против себя — расхождений нет; подмена размера и артикула видна', () => {
    expect(compareToFixture(F, F)).toEqual([])
    const bad = structuredClone(F)
    bad.showers[1].width_mm.value = 1452
    bad.showers[0].hardware[1].article = 'FDR-76'
    bad.showers[0].hardware[1].label = 'Ручка FDR-76'
    const diff = compareToFixture(bad, F)
    expect(diff).toHaveLength(2)
    expect(diff.join(' ')).toContain('FDR-76')
    expect(diff.join(' ')).toContain('1452')
  })
})
