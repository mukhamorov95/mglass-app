import { describe, it, expect } from 'vitest'
import { rowFinish, pricesByFinish, splitAv24Article, articleBase, rowCost, colorAxisOfRole } from '@/lib/supplier/colorCode'
import av24 from '../fixtures/configurator/av24-0245-rows.json'

type Row = { article: string; color: string | null; name: string; retail: number; discount: number; cost: number }
const ROWS = (av24 as { rows: Row[] }).rows.map(r => ({ ...r, retail_price: r.retail, discount_percent: r.discount, cost_price: r.cost }))
const ofBase = (base: string) => ROWS.filter(r => articleBase('av24', r.article) === base)

describe('Код цвета АВ24 — из артикула', () => {
  it('разбор артикула: база с материалом, код, запасная партия', () => {
    expect(splitAv24Article('FDP-232 BR/BL')).toEqual({ base: 'FDP-232 BR', code: 'BL', alt: false })
    expect(splitAv24Article('FDC-30 SUS304/BTP/L')).toEqual({ base: 'FDC-30 SUS304', code: 'BTP', alt: true })
    expect(splitAv24Article('FDC-50/L SUS304/BTP')).toEqual({ base: 'FDC-50/L SUS304', code: 'BTP', alt: false })
    expect(splitAv24Article('FDPP-102.8 PVC/BL(US18)')).toEqual({ base: 'FDPP-102.8 PVC', code: 'BL', alt: true })
    expect(splitAv24Article('FDA-196/B3')).toBeNull()
  })

  it('каждая строка «…/BL» — чёрный, на какой бы оси ни стояла', () => {
    const black = ROWS.filter(r => /\/BL$/.test(r.article))
    expect(black.length).toBeGreaterThanOrEqual(20)
    const axis = (a: string) => (/^FDPP-/.test(a) ? 'consumable' : 'hardware')
    expect(black.filter(r => rowFinish('av24', r, axis(r.article)) !== 'black').map(r => r.article)).toEqual([])
  })

  it('код без слова в поле цвета распознаётся: BL, TP, BZ, PSS', () => {
    expect(rowFinish('av24', { article: 'FDC-30 SUS304/BL', color: 'BL' })).toBe('black')
    expect(rowFinish('av24', { article: 'FDR-30 SUS304/TP', color: 'TP' })).toBe('gold')
    expect(rowFinish('av24', { article: 'FDP-115 SUS304/BZ', color: 'BZ' })).toBe('bronze')
    expect(rowFinish('av24', { article: 'FDC-35 SUS304/PSS', color: 'PSS' })).toBe('chrome')
    expect(rowFinish('av24', { article: 'FDT-352 SUS304/PSS16K', color: 'полированный16K' })).toBe('chrome')
  })

  it('уплотнитель: CL — прозрачный к любой фурнитуре, GG — серый, а не оружейная сталь', () => {
    expect(rowFinish('av24', { article: 'FDPP-402.8 PVC/CL', color: 'CL' }, 'consumable')).toBe('clear')
    expect(rowFinish('av24', { article: 'FDPP-410.8 PVC/GG', color: 'GG' }, 'consumable')).toBeNull()
    expect(rowFinish('av24', { article: 'FDP-232 BR/GG', color: 'оружейная сталь' }, 'hardware')).toBe('gunmetal')
    expect(colorAxisOfRole('seal-magnet')).toBe('consumable')
    expect(colorAxisOfRole('hinge')).toBe('hardware')
  })

  it('незнакомый код не угадывается по слову: «матовое золото» (MG) — не «золото»', () => {
    expect(rowFinish('av24', { article: 'FDC-30 SUS304/MG', color: 'матовое золото' })).toBeNull()
    const p = pricesByFinish('av24', ofBase('FDC-30 SUS304'))
    expect(p.gold).toBe(465)
  })

  it('двухцветное исполнение не выдаётся за чёрное', () => {
    expect(rowFinish('av24', { article: 'DSK-190.1.1 AL/BL-MW', color: 'черный с белой крышкой' })).toBeNull()
    expect(rowFinish('vetro', { article: 'X', color: 'черный с белой крышкой' })).toBeNull()
  })

  it('Ветро по-прежнему читается по слову', () => {
    expect(rowFinish('vetro', { article: 'A-001/Black', color: 'Black (чёрный матовый)' })).toBe('black')
    expect(rowFinish('vetro', { article: 'A-001/CP', color: 'Cp (хром полированный)' })).toBe('chrome')
  })
})

describe('Цены по цветам из строк одной позиции', () => {
  it('себестоимость = розница × (1 − 25 %) с копейками', () => {
    expect(rowCost({ article: 'FDC-38 SUS304/BL', retail_price: 950, discount_percent: 25, cost_price: 712 })).toBe(712.5)
  })

  it('FDC-30: чёрный есть (раньше шёл по хрому), «светлее» не перебивает основной цвет', () => {
    const p = pricesByFinish('av24', ofBase('FDC-30 SUS304'))
    expect(p.black).toBe(390)
    expect(p.chrome).toBe(352.5)
    expect(p.brgold).toBe(442.5)
  })

  it('материал — часть позиции: FDP-115 нержавейка и латунь не смешиваются', () => {
    expect(pricesByFinish('av24', ofBase('FDP-115 SUS304')).black).toBe(1162.5)
    expect(pricesByFinish('av24', ofBase('FDP-115 BR')).black).toBe(675)
  })

  it('магнитный 180°: чёрный — чёрная строка, остальные цвета — прозрачная', () => {
    const p = pricesByFinish('av24', ofBase('FDPP-503.8 PVC'), 'consumable')
    expect(p.black).toBe(1275)
    expect(p.chrome).toBe(1275)
    expect(p.gold).toBe(1275)
  })

  it('нулевая цена поставщика не становится ценой цвета', () => {
    const p = pricesByFinish('av24', ofBase('FDP-231 BR'))
    expect(p.white).toBeUndefined()
    expect(p.black).toBe(4425)
  })

  it('уценка с дефектом не попадает в цену', () => {
    const p = pricesByFinish('av24', [
      { article: 'FDPA-55.22-DEF AL/BL', name: 'Профиль с дефектом', retail_price: 150, discount_percent: 25 },
      { article: 'FDPA-55.22 AL/BL', name: 'Профиль 2,2 м', retail_price: 850, discount_percent: 25 },
    ])
    expect(p.black).toBe(637.5)
  })
})
