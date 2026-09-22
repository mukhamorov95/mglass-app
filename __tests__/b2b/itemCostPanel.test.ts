import { describe, it, expect } from 'vitest'
import { itemCostPanel } from '@/lib/b2b/itemCostPanel'

// Зеркало с подсветкой 1400×1500 из просчёта 22.09.2026: состав сохранён в позиции.
const mirror = {
  bom: [
    { name: 'Зеркало Осветлённое 4 мм', qty: 2.1, unit: 'м²', price: 1900, total: 3990 },
    { name: 'Лента EL-24V-96N', qty: 5.8, unit: 'м', price: 210, total: 1218 },
    { name: 'Блок питания EL-LB2472', qty: 1, unit: 'шт', price: 890, total: 890 },
    { name: 'Профиль каркаса', qty: 5.8, unit: 'м', price: 95, total: 551 },
    { name: 'Сборка зеркала', qty: 1, unit: 'шт', price: 226, total: 226 },
  ],
  costWithVat: 6875, inputVat: 1240, costExVat: 5635,
}

describe('itemCostPanel — изделие', () => {
  it('строки состава показываются как есть и сходятся с себестоимостью с НДС', () => {
    const p = itemCostPanel(mirror)!
    expect(p.kind).toBe('product')
    expect(p.source).toBe('saved')
    expect(p.lines).toHaveLength(5)
    expect(p.sum).toBe(6875)
    expect(p.stored).toBe(6875)
    expect(p.reconciles).toBe(true)
  })

  it('НДС — остаток между строками и колонкой, а не отдельное округление', () => {
    const p = itemCostPanel({ ...mirror, costExVat: 5634 })!
    expect(p.exVat).toBe(5634)
    expect(p.vat).toBe(6875 - 5634)
    expect(p.sum - p.vat).toBe(p.exVat)
  })

  it('расхождение состава с суммой видно, а не прячется', () => {
    const p = itemCostPanel({ ...mirror, costWithVat: 7000 })!
    expect(p.reconciles).toBe(false)
    expect(p.sum).toBe(6875)
    expect(p.stored).toBe(7000)
  })

  it('нулевые строки состава не показываем', () => {
    const p = itemCostPanel({ ...mirror, bom: [...mirror.bom, { name: 'Кнопка', qty: 0, unit: 'шт', total: 0 }] })!
    expect(p.lines.map(l => l.name)).not.toContain('Кнопка')
  })
})

describe('itemCostPanel — обычное стекло', () => {
  const glass = {
    costMaterial: 4200, costTempering: 1500, costFacet: 0, costEdge: 300,
    costTransport: 250, costPackaging: 150, servicesCost: 0,
    costWithVat: 6400, inputVat: 1154, costExVat: 5246,
  }

  it('себестоимость раскрывается по статьям, пустые опущены', () => {
    const p = itemCostPanel(glass)!
    expect(p.kind).toBe('glass')
    expect(p.lines.map(l => l.name)).toEqual(['Материал', 'Закалка', 'Обработка кромки', 'Доставка', 'Упаковка'])
    expect(p.sum).toBe(6400)
    expect(p.reconciles).toBe(true)
  })

  // В позиции сохранена цена ПРОДАЖИ услуг, а в себестоимость вошла закупка.
  // Поэтому строку услуг выводим остатком, а не берём servicesCost.
  it('услуги идут остатком — по себестоимости, а не по цене продажи', () => {
    const p = itemCostPanel({
      ...glass, servicesCost: 800, costWithVat: 6600,   // закупка услуг = 200
      services: [{ name: 'Сверление' }, { name: 'Вырез' }],
    })!
    expect(p.lines[p.lines.length - 1]).toEqual({ name: 'Услуги (себестоимость): Сверление, Вырез', qty: 1, unit: '₽', total: 200 })
    expect(p.sum).toBe(6600)
    expect(p.reconciles).toBe(true)
  })

  it('позиция с услугами больше не зажигает ложное «не сходится»', () => {
    const p = itemCostPanel({ ...glass, servicesCost: 4500, costWithVat: 8900 })!
    expect(p.reconciles).toBe(true)
    expect(p.lines[p.lines.length - 1].name).toBe('Услуги (себестоимость)')
    expect(p.lines[p.lines.length - 1].total).toBe(2500)
  })

  it('триплексация — своя строка', () => {
    const p = itemCostPanel({ ...glass, costTriplex: 900, costWithVat: 7300 })!
    expect(p.lines.map(l => l.name)).toContain('Триплексация')
    expect(p.sum).toBe(7300)
  })

  it('нечего показывать — панели нет', () => {
    expect(itemCostPanel({ costWithVat: 0, costExVat: 0 })).toBeNull()
  })
})
