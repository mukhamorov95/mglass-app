import { describe, it, expect } from 'vitest'
import { tokens, similarity, isDefect } from '@/lib/supplier/similar'

describe('сопоставление позиций поставщиков', () => {
  it('значимые слова: размеры и слова от трёх букв, без служебных', () => {
    expect(tokens('Крепление FDC-30 трубы 30х10 к стене, нержавейка/полированный')).toEqual(['крепление', 'fdc', '30'])
  })

  it('похожесть считается по доле совпавших слов', () => {
    const wall = 'Крепление FDC-30 трубы 30х10 к стене'
    expect(similarity(wall, 'Крепление FDC-31 трубы 30х10 к стене')).toBeGreaterThan(0.7)
    expect(similarity(wall, 'Уплотнитель магнитный 90° прозрачный 2.2 м')).toBeLessThan(0.2)
  })

  it('крепление к стене не считается заменой крепления к стеклу', () => {
    const wall = 'Крепление FDC-30 трубы 30х10 к стене нержавейка'
    const glass = 'Крепление FDC-34 трубы 30х10 к стеклу нержавейка'
    expect(similarity(wall, glass)).toBeLessThan(0.9)
  })

  it('брак и уценка не идут в сравнение — иначе автоподбор выберет дефект', () => {
    expect(isDefect('Профиль FDPA-50.3-DEF с дефектом для стекла')).toBe(true)
    expect(isDefect('Труба FDT-351E, 30х10х1.5 мм 1 м, ЭКОНОМ')).toBe(true)
    expect(isDefect('Профиль для стекла FDPA-51.22, длина 2,2 м')).toBe(false)
  })
})
