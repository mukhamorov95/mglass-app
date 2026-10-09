import { describe, it, expect } from 'vitest'
import { alternativesOf, kindOf, sameKind } from '@/lib/calc/catalogKinds'
import type { CatalogModel } from '@/lib/calc/compositionCatalog'

// Названия — живые строки каталога АВ24 и Ветро (09.10).
const m = (base: string, group: CatalogModel['group'], name: string, cost: number, opt: Partial<CatalogModel> = {}): CatalogModel => ({
  base, supplier: /^FD|^FK/.test(base) ? 'av24' : 'vetro', group, category: '', role: 'other', name, stockMm: null,
  image: `https://x/${base}.jpg`, link: null, variants: { chrome: { cost } }, ...opt,
})

describe('kindOf — разновидность детали из названия', () => {
  const label = (g: CatalogModel['group'], name: string) => kindOf(m('X', g, name, 1)).label
  it('петли: крепление и угол; подъём и сторона отдельно', () => {
    expect(label('hinge', 'Петля стекло-стекло 180° Dessau-103')).toBe('стекло-стекло 180°')
    expect(label('hinge', 'Петля Аврора FDP-180 стена-стекло 90° с крышками')).toBe('стена-стекло 90°')
    expect(label('hinge', 'Петля стекло-стекло 135°-180° Balge-004/Sa')).toBe('стекло-стекло 135–180°')
    expect(label('hinge', 'Петля с подъемным механизмом стекло-стекло 180°. Правая Galle-110/R')).toBe('стекло-стекло 180° · с подъёмом · правая')
    expect(label('hinge', 'Петля Омега ω FDP-100L стена-стекло левая, с подъемным механизмом')).toBe('стена-стекло · с подъёмом · левая')
    expect(label('hinge', 'Петля Афина FDP-130 стена-стекло с бок.креплением')).toBe('стена-стекло')
  })
  it('коннекторы: угол «135С» и без знака; число артикула — не угол', () => {
    expect(label('connector', 'Коннектор стекло-стекло 135С КС-005/2-Cp')).toBe('стекло-стекло 135°')
    expect(label('connector', 'Коннектор стекло-стена 90, с декоративными крышками Bsp-10')).toBe('стена-стекло 90°')
    expect(label('connector', 'Регулируемый коннектор стекло-стекло Bs-180')).toBe('стекло-стекло')
    expect(label('connector', 'Стеклодержатель FKK-44, 10х20 мм Ø50 мм М10x1.5 для стекла')).toBe('стеклодержатель')
  })
  it('ручки: кноб, скоба, купе, сауна, полотенцесушитель', () => {
    expect(label('handle', 'Ручка кноб DP-70')).toBe('кноб')
    expect(label('handle', 'Ручка-кноб КН-010')).toBe('кноб')
    expect(label('handle', 'Ручка скоба FDR-88, 25х10х300х1.0 мм')).toBe('скоба')
    expect(label('handle', 'Ручка скоба (регулируемая) SD-410/wood')).toBe('скоба')
    expect(label('handle', 'Ручка-купе. Black КУ-002')).toBe('купе')
    expect(label('handle', 'Ручка для сауны деревянная SD-50-1000/Орех')).toBe('для сауны')
    expect(label('handle', 'Ручка полотенцесушитель FDR-97, 20х10х440х1.0 мм')).toBe('полотенцесушитель')
  })
  it('уплотнители: магнитный с углом; толщина стекла из названия', () => {
    const k = kindOf(m('MS-90/3000', 'seal', 'Уплотнительный профиль магнитный 90˚, для стекла 8 мм,3м MS-90/3000', 1))
    expect(k.label).toBe('магнитный 90°')
    expect(k.glass).toEqual([8, 8])
    expect(kindOf(m('X', 'seal', 'Уплотнитель ПРЕМИУМ А-образный прозрачный 2.2 м под стекло 8 мм FDPP-404.8', 1)).label).toBe('боковой')
  })
})

describe('sameKind и alternativesOf — чем заменить', () => {
  it('угол без указания — кандидат; другой угол или толщина стекла — нет', () => {
    const k = (name: string) => kindOf(m('X', 'hinge', name, 1))
    expect(sameKind(k('Петля стена-стекло 90° Bremen-201'), k('Петля Афина FDP-131 стена-стекло центр. крепление'))).toBe(true)
    expect(sameKind(k('Петля стекло-стекло 180° Dessau-103'), k('Петля стекло-стекло 90° Dallas-104'))).toBe(false)
    expect(sameKind(k('Петля стена-стекло 90° Bremen-201'), k('Петля стекло-стекло 90° Hagen-102'))).toBe(false)
    const s = (name: string) => kindOf(m('X', 'seal', name, 1))
    expect(sameKind(s('Уплотнитель для стекла 8 мм'), s('Уплотнитель для стекла 10 мм'))).toBe(false)
    expect(sameKind(s('Уплотнитель для стекла 8-10 мм'), s('Уплотнитель для стекла 10 мм'))).toBe(true)
  })
  it('кноб → кнобы в цвете изделия: с фото первыми, ближе по цене выше; сама деталь и скобы — нет', () => {
    const cur = m('DP-70', 'handle', 'Ручка кноб DP-70', 3213)
    const list = [
      cur,
      m('DP-34', 'handle', 'Ручка кноб DP-34', 3199),
      m('FDR-58 SUS304', 'handle', 'Ручка кноб FDR-58', 900),
      m('DP-99', 'handle', 'Ручка кноб DP-99', 3200, { image: null }),
      m('DP-50', 'handle', 'Ручка кноб DP-50', 3100, { variants: { black: { cost: 3100 } } }),
      m('SD-25/457', 'handle', 'Ручка скоба SD-25/457', 3300),
    ]
    expect(alternativesOf(cur, list, 'chrome').map(x => x.base)).toEqual(['DP-34', 'FDR-58 SUS304', 'DP-99'])
  })
  it('погонная деталь меняется только на погонную', () => {
    const cur = m('MS-90/3000', 'seal', 'Уплотнительный профиль магнитный 90˚, для стекла 8 мм,3м MS-90/3000', 2037, { stockMm: 3000 })
    const list = [cur,
      m('FDPP-522.8 PVC', 'seal', 'Уплотнитель магнитный 90° для стекла 8 мм 2.5 м', 2025, { stockMm: 2500 }),
      m('KIT', 'seal', 'Уплотнитель магнитный 90° для стекла 8 мм, комплект', 2000)]
    expect(alternativesOf(cur, list, 'chrome').map(x => x.base)).toEqual(['FDPP-522.8 PVC'])
  })
})
