import { describe, it, expect } from 'vitest'
import { buildCatalog, modelName, type CatalogRow } from '@/lib/calc/compositionCatalog'
import { priceComposition } from '@/lib/calc/composition'
import { ratesFromRows } from '@/lib/b2b/rates'

// Строки в том виде, в каком лежат в supplier_price_rows (названия и цены из прайса АВ24 на 09.10).
const row = (category: string, article: string, name: string, retail: number, extra: Partial<CatalogRow> = {}): CatalogRow =>
  ({ category, article, name, color: null, retail_price: retail, discount_percent: 25, cost_price: null, ...extra })

const ROWS: CatalogRow[] = [
  row('Стандартные петли для душевых', 'FDP-10 SUS304/PSS', 'Петля Альфа α FDP-10 стена-стекло с бок. креплением, нержавейка/полированный', 1450, { image_url: 'https://av24.su/p/10-pss.jpg' }),
  row('Стандартные петли для душевых', 'FDP-10 SUS304/BL', 'Петля Альфа α FDP-10 стена-стекло с бок. креплением, нержавейка/черный', 1500, { image_url: 'https://av24.su/p/10-bl.jpg', url: 'https://av24.su/fdp-10-bl/' }),
  row('Стандартные петли для душевых', 'FDP-10 ZN/CR', 'Петля Альфа α FDP-10 стена-стекло с бок. креплением, цинк/хром', 770),
  row('Уцененные петли для душевых', 'FDP-10 SUS304/PSS-DEF', 'Петля FDP-10 с дефектом покрытия', 500),
  row('Трубы 30х10 для душевых', 'FDT-353 SUS304/PSS16K', 'Труба FDT-353, 30х10х1.5 мм, 3 м, нержавейка/полированный16K', 3900),
  row('Трубы 30х10 для душевых', 'FDT-353 SUS304/BL', 'Труба FDT-353, 30х10х1.5 мм, 3 м, нержавейка/черный', 3600),
  row('Соединители и держатели труб 30х10 мм', 'FDC-30 SUS304/BL', 'Крепление FDC-30 трубы 30х10 к стене, нержавейка/черный FDC-30 SUS304/BL', 520),
  row('Акриловые порожки', 'FDPP-16.1 PVC/CL', 'Порог акриловый для душевой 16х8 мм, 1 м прозрачный FDPP-16.1', 420),
  row('Порожки алюминиевые Ступенька', 'FDPA-43.15 AL/SSS', 'Порог алюминиевый FDPA-43.15 для душевой 1.5 м, алюминий/матовый', 1000),
  row('Порожки алюминиевые Ступенька', 'TUB 2.2', 'Тубус картонный упаковочный, длина 2,2 м', 360),
  row('Уплотнители 2.2 м премиум для стекла 8 мм', 'FDPP-402.8 PVC/CL', 'Уплотнитель ПРЕМИУМ Ч-образный прозрачный 2.2 м, ус 18 мм под стекло 8 мм FDPP-402.8', 250),
  row('Алюминиевый профиль для стекла 8 мм', 'FDPA-81.3 AL/SSS', 'Профиль H-образный FDPA-81.3 для стекла 8 мм, длина 3 м, алюминий/матовый', 0),
  row('Алюминиевый профиль для стекла 8 мм', 'FDPA-500.1 AL/PSS', 'Заглушка верхняя FDPA-500.1, 19х13х2мм, 1 м, для п-образного профиля FDPA-50, FDPA-51, FDPA-55, стекло 8 мм, алюминий/полированный', 210),
  row('Алюминиевый профиль для стекла 8 мм', 'FDPA-501 AL/PSS', 'Заглушка торцевая FDPA-501 для п-образного профиля 19х13х2, алюминий/полированный', 190),
  row('Фурнитура для саун, бань и хамам', 'FDP-230 BR/SSS', 'Петля Афродита FDP-230 стена-стекло 90° с крышками, латунь/матовый', 4300),
  row('Фурнитура для саун, бань и хамам', 'FDR-719 SUS304/SSS', 'Ручка для сауны FDR-719, 20х450х550 мм, нержавейка/матовый', 3000),
  row('Фурнитура для зеркал и держателей стекла', 'FDA-50 ZN/CR', 'Держатель зеркала FDA-50, цинк/хром', 300),
]

describe('modelName — модель без хвоста «материал/цвет»', () => {
  it.each([
    ['Ручка кноб Эхо FDR-121, нержавейка/черный', 'Ручка кноб Эхо FDR-121'],
    ['Крепление FDC-30 трубы 30х10 к стене, нержавейка/черный FDC-30 SUS304/BL', 'Крепление FDC-30 трубы 30х10 к стене'],
    ['Труба FDT-352, 30х10х1.5 мм 2 м, нержавейка/полированный16K', 'Труба FDT-352, 30х10х1.5 мм 2 м'],
    ['Тубус картонный упаковочный, длина 2,2 м', 'Тубус картонный упаковочный, длина 2,2 м'],
  ])('%s', (name, want) => expect(modelName(name)).toBe(want))
})

describe('buildCatalog', () => {
  const cat = buildCatalog(ROWS)
  const by = (base: string) => cat.find(m => m.base === base)

  it('модель = база артикула с материалом; брак и чужие разделы не попадают', () => {
    expect(cat.map(m => m.base)).not.toContain('FDA-50 ZN')
    expect(by('FDP-10 SUS304')).toBeTruthy()
    expect(by('FDP-10 ZN')).toBeTruthy()
    expect(cat.filter(m => m.base.startsWith('FDP-10'))).toHaveLength(2)
  })

  it('из раздела саун — только петли: Афродита душевая, ручка для сауны — нет', () => {
    expect(by('FDP-230 BR')).toMatchObject({ group: 'hinge', role: 'hinge', variants: { satin: { cost: 3225 } } })
    expect(by('FDR-719 SUS304')).toBeUndefined()
  })

  it('закупка по цвету — та же строка, что в расчёте; фото строки цвета', () => {
    const m = by('FDP-10 SUS304')!
    expect(m.group).toBe('hinge')
    expect(m.role).toBe('hinge')
    expect(m.variants.chrome).toEqual({ cost: 1087.5, image: 'https://av24.su/p/10-pss.jpg' })
    expect(m.variants.black).toEqual({ cost: 1125, image: 'https://av24.su/p/10-bl.jpg' })
    expect(m.variants.gold).toBeUndefined()
    expect(m.link).toBe('https://av24.su/fdp-10-bl/')
  })

  it('погонное — по длине в названии: труба и алюминиевый порог как профиль, акриловый — как расходник', () => {
    expect(by('FDT-353 SUS304')).toMatchObject({ group: 'stabilizer', role: 'profile', stockMm: 3000 })
    expect(by('FDC-30 SUS304')).toMatchObject({ group: 'stabilizer', role: 'stabilizer', stockMm: null })
    expect(by('FDPA-43.15 AL')).toMatchObject({ group: 'threshold', role: 'profile', stockMm: 1500 })
    expect(by('FDPP-16.1 PVC')).toMatchObject({ group: 'threshold', role: 'threshold', stockMm: 1000 })
    expect(by('FDPP-402.8 PVC')).toMatchObject({ group: 'seal', role: 'seal', stockMm: 2200 })
  })

  it('прозрачный расходник — к любому цвету; позиция без кода цвета — одна цена на все', () => {
    expect(Object.keys(by('FDPP-402.8 PVC')!.variants)).toHaveLength(10)
    const tub = by('TUB 2.2')!
    expect(tub).toMatchObject({ role: 'other', stockMm: null })   // длина в названии, но это тубус
    expect(new Set(Object.values(tub.variants).map(v => v!.cost))).toEqual(new Set([270]))
  })

  it('верхняя заглушка профиля — погонная (режется по двери), торцевая — штучная', () => {
    expect(by('FDPA-500.1 AL')).toMatchObject({ role: 'profile', stockMm: 1000 })
    expect(by('FDPA-501 AL')).toMatchObject({ role: 'other', stockMm: null })
  })

  it('нулевая цена в прайсе — модель видна, но без цен', () => {
    expect(by('FDPA-81.3 AL')!.variants).toEqual({})
  })
})

describe('priceComposition — роли конструктора', () => {
  const ctx = { glass: null, glassAsked: '—', rates: ratesFromRows([]).rates, mgDiscount: 20, av24: ROWS }

  it('труба — погонная, цвет как у фурнитуры: чёрная строка, куски по полосам 3 м', () => {
    const r = priceComposition({ finishId: 'black', panels: [], hardware: [
      { role: 'profile', label: 'Труба 30х10', article: 'FDT-353 SUS304', pieces_mm: [1900, 900] },
      { role: 'stabilizer', label: 'Крепление трубы', article: 'FDC-30 SUS304', qty: 2 },
      { role: 'other', label: 'Тубус', article: 'TUB 2.2', qty: 1 },
    ] }, ctx)
    expect(r.hardware.lines.map(l => [l.article, l.qty, l.total])).toEqual([
      ['FDT-353 SUS304/BL', 1, 2700],
      ['FDC-30 SUS304/BL', 2, 780],
      ['TUB 2.2', 1, 270],
    ])
  })

  it('уплотнитель конструктора — расходник: к чёрной фурнитуре прозрачный', () => {
    const r = priceComposition({ finishId: 'black', panels: [], hardware: [
      { role: 'seal', label: 'Уплотнитель', article: 'FDPP-402.8', pieces_mm: [2004] },
    ] }, ctx)
    expect(r.hardware.lines[0]).toMatchObject({ article: 'FDPP-402.8 PVC/CL', qty: 1, total: 187.5 })
  })
})
