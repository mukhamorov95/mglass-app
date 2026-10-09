import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { pickVetroRow, vetroBase, vetroModelName } from '@/lib/calc/vetroRows'
import { buildCatalog, type CatalogRow } from '@/lib/calc/compositionCatalog'
import { priceComposition } from '@/lib/calc/composition'
import { interpretStep, readStep, stepToDraft } from '@/lib/calc/stepImport'
import { ratesFromRows } from '@/lib/b2b/rates'

// Строки — как лежат в supplier_price_rows (supplier = 'vetro', прайс на 09.10).
const row = (category: string, article: string, name: string, color: string, retail: number): CatalogRow =>
  ({ supplier: 'vetro', category, article, name, color, retail_price: retail, discount_percent: 32, cost_price: null })

const ROWS: CatalogRow[] = [
  row('Петли для душевых', 'Dessau-103/CP.', 'Dessau-103/CP. Петля стекло-стекло 180°', 'Cp (хром полированный)', 6949),
  row('Петли для душевых', 'Dessau-103/CP/Sa', 'Dessau-103/CP/Sa. Петля стекло-стекло 180°', 'Cp (хром полированный)', 7381),
  row('Петли для душевых', 'Dessau-103/Black.', 'Dessau-103/Black. Петля стекло-стекло 180°', 'Black (чёрный матовый)', 8871),
  row('Петли для душевых', 'Dessau-103/Satin', 'Dessau-103/Satin. Петля стекло-стекло 180°', 'Satin Nickel (матовый хром)', 7959),
  row('Ручки', 'DP-70/Cp', 'DP-70/Cp Ручка кноб', 'Cp (хром полированный)', 4725),
  row('Ручки', 'DP-70/Black', 'DP-70/Black Ручка кноб', 'Black (чёрный матовый)', 6379),
  row('Ручки', 'DP-70/Diamond BrGold', 'DP-70/Diamond BrGold. Ручка кноб', 'BrGold (брашированное золото)', 6181),
  row('Уплотнители и пороги ПВХ', 'MS-90/3000/Black', 'MS-90/3000/Black. Уплотнительный профиль магнитный 90˚, для стекла 8 мм,3м (Черный)', 'Black (чёрный матовый)', 3017),
  row('Уплотнители и пороги ПВХ', 'MS-90/3000/Crystal', 'MS-90/3000/Crystal. Уплотнительный профиль магнитный 90˚, для стекла 8 мм,3м (Кристально чистый)', 'Crystal (кристально прозрачный)', 2996),
  row('Крепления для душевой штанги', 'КП-001', 'КП-001/Pss. Крепление стекла к штанге 30х10', 'Pss (полированная нержавеющая сталь)', 872),
  row('Крепления для душевой штанги', 'КП-001/Black', 'КП-001/Black. Крепление стекла к штанге 30х10', 'Black (чёрный матовый)', 872),
  row('Фурнитура межкомнатных дверей/хамам/саун', 'CA-010/Black', 'CA-010/Black/2300x1400. Комплект дверной коробки', 'Black (чёрный матовый)', 9000),
]

describe('vetroBase — модель без сегмента цвета', () => {
  it.each([
    ['Dessau-103/CP.', 'Dessau-103'],
    ['Dessau-103/CP/Sa', 'Dessau-103/Sa'],
    ['Dessau-103/BrRoseGold', 'Dessau-103'],
    ['DP-70/Diamond BrGold', 'DP-70/Diamond'],
    ['DP-70/Diamond Brushed Rose', 'DP-70/Diamond'],
    ['MS-90/3000/Black', 'MS-90/3000'],
    ['Uc-90/180/Black-C', 'Uc-90/180'],
    ['КП-002/black', 'КП-002'],
    ['КП-001', 'КП-001'],
    ['Sh-003/1100/Pss', 'Sh-003/1100'],
    ['Casa d\'acqua-101/Black/L', 'Casa d\'acqua-101/L'],
  ])('%s → %s', (a, want) => expect(vetroBase(a)).toBe(want))
})

describe('pickVetroRow — строка цвета', () => {
  const dessau = ROWS.filter(r => vetroBase(r.article) === 'Dessau-103')
  it('цвет — из поля color: хром, матовый хром, чёрный; нет строки цвета — нет цены', () => {
    expect(pickVetroRow(dessau, 'hardware', 'chrome')?.article).toBe('Dessau-103/CP.')
    expect(pickVetroRow(dessau, 'hardware', 'satin')?.article).toBe('Dessau-103/Satin')
    expect(pickVetroRow(dessau, 'hardware', 'black')?.article).toBe('Dessau-103/Black.')
    expect(pickVetroRow(dessau, 'hardware', 'gold')).toBeNull()
  })
  it('уплотнитель: свой цвет, иначе прозрачный Crystal', () => {
    const ms = ROWS.filter(r => vetroBase(r.article) === 'MS-90/3000')
    expect(pickVetroRow(ms, 'consumable', 'black')?.article).toBe('MS-90/3000/Black')
    expect(pickVetroRow(ms, 'consumable', 'chrome')?.article).toBe('MS-90/3000/Crystal')
    expect(pickVetroRow(ms, 'hardware', 'chrome')).toBeNull()
  })
  it('цвет есть только в названии и поле color (КП-001) — Pss читается как хром', () => {
    const kp = ROWS.filter(r => vetroBase(r.article) === 'КП-001')
    expect(pickVetroRow(kp, 'hardware', 'chrome')?.article).toBe('КП-001')
    expect(pickVetroRow(kp, 'hardware', 'black')?.article).toBe('КП-001/Black')
  })
})

describe('vetroModelName', () => {
  it.each([
    ['Dessau-103/CP. Петля стекло-стекло 180°', 'Dessau-103', 'Петля стекло-стекло 180° Dessau-103'],
    ['DP-70/Cp Ручка кноб', 'DP-70', 'Ручка кноб DP-70'],
    ['MS-90/3000/Black. Уплотнительный профиль магнитный 90˚, для стекла 8 мм,3м (Черный)', 'MS-90/3000', 'Уплотнительный профиль магнитный 90˚, для стекла 8 мм,3м MS-90/3000'],
  ])('%s', (name, base, want) => expect(vetroModelName(name, base)).toBe(want))
})

describe('каталог конструктора с Ветро', () => {
  const cat = buildCatalog(ROWS)
  const m = (base: string) => cat.find(x => x.supplier === 'vetro' && x.base === base)!
  it('модели по разделам Ветро; дверная коробка — не душевой раздел', () => {
    expect(cat.map(x => x.base).sort()).toEqual(['DP-70', 'DP-70/Diamond', 'Dessau-103', 'Dessau-103/Sa', 'MS-90/3000', 'КП-001'].sort())
    expect(m('Dessau-103')).toMatchObject({ group: 'hinge', role: 'hinge', name: 'Петля стекло-стекло 180° Dessau-103', stockMm: null })
    expect(m('MS-90/3000')).toMatchObject({ group: 'seal', role: 'seal', stockMm: 3000 })
    expect(m('КП-001')).toMatchObject({ group: 'stabilizer', role: 'stabilizer' })
  })
  it('закупка по цвету = розница × (1 − 32 %), как в расчёте', () => {
    expect(m('Dessau-103').variants.chrome?.cost).toBe(4725.32)
    expect(m('Dessau-103/Sa').variants.chrome?.cost).toBe(5019.08)
    expect(m('DP-70').variants.chrome?.cost).toBe(3213)
    expect(m('MS-90/3000').variants.chrome?.cost).toBe(2037.28)   // прозрачный к хрому
  })
})

describe('расчёт по составу — строки Ветро', () => {
  const ctx = { glass: null, glassAsked: 'Прозрачное М1 8 мм', rates: ratesFromRows([]).rates, mgDiscount: 0, av24: [], vetro: ROWS }
  it('0828-2 в хроме: петли ×3, кноб, магнит 90° полосой 3 м', () => {
    const r = priceComposition({
      panels: [{ label: 'Дверь', w: 650, h: 2686 }], finishId: 'chrome',
      hardware: [
        { role: 'hinge', label: 'Петля', article: 'Dessau-103', supplier: 'vetro', qty: 3 },
        { role: 'handle', label: 'Ручка', article: 'DP-70', supplier: 'vetro', qty: 1 },
        { role: 'seal-magnet', label: 'Магнит 90°', article: 'MS-90/3000', supplier: 'vetro', pieces_mm: [2686] },
      ],
    }, ctx)
    expect(r.hardware.lines.map(l => [l.article, l.supplier, l.qty, l.total])).toEqual([
      ['Dessau-103/CP.', 'vetro', 3, 14175.96],
      ['DP-70/Cp', 'vetro', 1, 3213],
      ['MS-90/3000/Crystal', 'vetro', 1, 2037.28],
    ])
    expect(r.hardware.costExact).toBe(19426.24)
    expect(r.stops.filter(s => !/Стекла/.test(s))).toEqual([])
  })
  it('нет модели — остановка с именем поставщика; АВ24 без поля supplier — как раньше', () => {
    const r = priceComposition({ panels: [{ label: 'Дверь', w: 650, h: 2000 }], finishId: 'chrome',
      hardware: [{ role: 'hinge', label: 'Петля', article: 'Dessau-999', supplier: 'vetro', qty: 2 }, { role: 'hinge', label: 'Петля АВ24', article: 'FDP-1', qty: 2 }] }, ctx)
    expect(r.stops).toContain('Петля: Dessau-999 нет в справочнике Ветро')
    expect(r.stops).toContain('Петля АВ24: FDP-1 нет в справочнике АВ24')
  })
})

describe('импорт STEP + каталог Ветро', () => {
  it('0828-2: петли и ручка находятся по артикулу в названии детали', () => {
    const imp = interpretStep(readStep(readFileSync('__tests__/fixtures/step/0828-2.STEP', 'utf8')))
    let n = 0
    const d = stepToDraft(imp, buildCatalog(ROWS), () => `v${++n}`)
    expect(d.hardware.map(h => [h.base, h.supplier, h.qty, h.at?.[0].pos])).toEqual([
      ['Dessau-103', 'vetro', '3', [227, 1986, 2436]],
      ['DP-70', 'vetro', '1', [972]],
    ])
    expect(d.pending.map(p => p.name).sort()).toEqual(['Держатель штанга A-B-ST-4201 - хром', 'Держатель штанга A-B-ST-4207', 'Труба (штанга) 30×10', 'магнит 90 град большой'].sort())
  })
})
