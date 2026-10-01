import { describe, it, expect } from 'vitest'
import { buildStops, loadPer2, articleOf, type StopInput } from '@/lib/calc/buildStops'
import { pickSpecs } from '@/lib/supplier/enrichParse'

const HINGE = { role: 'hinge', label: 'Петля Афродита FDP-232 стекло-стекло 180° с крышкой', ref: { base: 'FDP-232 BR' }, qty: 2 }
const HANDLE = { role: 'handle', label: 'Ручка скоба FDR-76, 20х10х200 мм', ref: { base: 'FDR-76 SUS304' }, qty: 1 }
const base = (over: Partial<StopInput> = {}): StopInput => ({
  lines: [HINGE, HANDLE], missing: [], doors: [{ w: 650, h: 2310 }],
  thicknessMm: 8, swingDoors: 1, heightMm: 2000, heightRange: [1800, 2200], ...over,
})

describe('pickSpecs — пары характеристик АВ24', () => {
  it('берёт «имя — значение» из блоков product-features', () => {
    const html = `
      <div class="product-features__item"><div class="product-features__name js-x">Межосевое расстояние:</div>
      <div class="product-features__value">200</div></div>
      <div class="product-features__name">Нагрузка:</div><div class="product-features__value">до 35 кг на 2 петли</div>
      <div class="product-features__name">Диаметр выреза:</div><div class="product-features__value">2x &#8709;10</div>`
    const s = pickSpecs(html, 'Ручка скоба FDR-76')
    expect(s['Межосевое расстояние']).toBe('200')
    expect(s['Нагрузка']).toBe('до 35 кг на 2 петли')
    expect(s['Диаметр выреза']).toMatch(/2x .10/)
  })
})

describe('articleOf / loadPer2', () => {
  it('артикул без цвета и материала', () => {
    expect(articleOf('FDPP-503.8 PVC')).toBe('FDPP-503.8')
    expect(articleOf('Ручка скоба FDR-76, 20х10х200')).toBe('FDR-76')
    expect(articleOf('сд 210')).toBe('')
  })
  it('нагрузка: паспорт важнее карточки, карточка — «N кг на M петли»', () => {
    expect(loadPer2(HINGE.label)).toBe(35)
    expect(loadPer2('Петля FDP-115', { 'Нагрузка': 'до 45 кг на 3 петли' })).toBe(30)
    expect(loadPer2('Петля FDP-115', { 'Нагрузка': 'до 40 кг' })).toBe(40)
    expect(loadPer2('Петля FDP-115')).toBeNull()
  })
})

describe('buildStops', () => {
  it('заказ 0245 на 2310: дверь 30 кг держат 2 петли FDP-232 — остановок нет', () => {
    const r = buildStops(base({ heightMm: 2310, heightRange: [1800, 2200] }))
    expect(r.stops).toEqual([])
    expect(r.notes.map(n => n.kind)).toEqual(['nonstandard'])
  })

  it('на чертеже SD-210, в расчёте FDR-76 — аналог под сверление: стоп с отверстиями из карточки', () => {
    const lines = [HINGE, { ...HANDLE, specs: { 'Диаметр выреза': '2x ∅10' } }]
    const r = buildStops(base({ lines, drawn: { handle: 'SD-210' } }))
    expect(r.stops).toHaveLength(1)
    expect(r.stops[0].kind).toBe('analog')
    expect(r.stops[0].text).toContain('SD-210')
    expect(r.stops[0].text).toContain('FDR-76')
    expect(r.stops[0].text).toContain('2x ∅10')
  })

  it('совпадение артикула без цвета — не стоп; не под сверление — пометка, не стоп', () => {
    const seal = { role: 'seal-bottom', label: 'Уплотнитель Ч-образный', ref: { base: 'FDPP-402.8 PVC' }, qty: 1 }
    const r = buildStops(base({ lines: [HINGE, HANDLE, seal], drawn: { hinge: 'FDP-232', 'seal-bottom': 'FDPP-405.8' } }))
    expect(r.stops).toEqual([])
    expect(r.notes.find(n => n.kind === 'analog')?.text).toContain('FDPP-405.8')
  })

  it('крепление трубы к стеклу — отверстие в полотне', () => {
    const fdc34 = { role: 'mount-glass', label: 'Крепление FDC-34 трубы 30х10 к стеклу', ref: { base: 'FDC-34 SUS304' }, qty: 1, specs: { 'Диаметр выреза': '∅12' } }
    const r = buildStops(base({ lines: [HINGE, HANDLE, fdc34] }))
    expect(r.stops.map(s => s.kind)).toEqual(['hole'])
    expect(r.stops[0].text).toContain('∅12')
    expect(r.stops[0].text).toContain('FDC-34')
  })

  it('держатель стекла сверлит полотно, угловой соединитель труба-труба — нет', () => {
    const holder = { role: 'mount-glass', label: 'Держатель стекла FDC-35 сквозной 30х10', ref: { base: 'FDC-35 SUS304' }, qty: 1 }
    const tubeCorner = { role: 'mount-corner', label: 'Соединитель FDC-32 трубы 30х10 угловой 90°', ref: { base: 'FDC-32 SUS304' }, qty: 1 }
    const r = buildStops(base({ lines: [HINGE, HANDLE, holder, tubeCorner] }))
    expect(r.stops.map(s => s.text)).toEqual([expect.stringContaining('FDC-35')])
  })

  it('дверь тяжелее паспорта при двух петлях — стоп; при трёх — пометка о запасе', () => {
    const heavy = { doors: [{ w: 900, h: 2000 }] }       // 36 кг
    expect(buildStops(base(heavy)).stops.map(s => s.kind)).toEqual(['door-weight'])
    const three = buildStops(base({ ...heavy, lines: [{ ...HINGE, qty: 3 }, HANDLE] }))
    expect(three.stops).toEqual([])
    expect(three.notes.map(n => n.kind)).toEqual(['hinge-reserve'])
  })

  it('петля без паспорта и без нагрузки в карточке — пометка, а не молчаливое «ок»', () => {
    const hinge = { role: 'hinge', label: 'Петля Европа FDP-115', ref: { base: 'FDP-115 SUS304' }, qty: 2 }
    const r = buildStops(base({ lines: [hinge, HANDLE] }))
    expect(r.stops).toEqual([])
    expect(r.notes.map(n => n.kind)).toEqual(['no-passport'])
  })

  it('уплотнитель длиннее хлыста — пометка о стыке, не стоп', () => {
    const r = buildStops(base({ spliced: [{ label: 'Уплотнитель магнитный 180°', piece: 2310, stock: 2200 }] }))
    expect(r.stops).toEqual([])
    expect(r.notes[0]).toEqual({ kind: 'splice', text: 'Уплотнитель магнитный 180°: кусок 2310 длиннее хлыста 2200 — набран со стыком' })
  })

  it('одинаковые стыки сворачиваются в одну строку', () => {
    const x = { label: 'Уплотнитель нижний', piece: 2310, stock: 2200 }
    expect(buildStops(base({ spliced: [x, x] })).notes.map(n => n.text)).toEqual(['Уплотнитель нижний: кусок 2310 длиннее хлыста 2200 — набран со стыком (×2)'])
  })

  it('нет цены цвета и кусок длиннее хлыста — стопы', () => {
    const r = buildStops(base({
      lines: [{ ...HINGE, chromeFallback: true }, HANDLE],
      missing: [{ role: 'profile', label: 'Профиль', reason: 'кусок длиннее хлыста' }],
    }))
    expect(r.stops.map(s => s.kind)).toEqual(['no-colour-price', 'oversize'])
  })
})
