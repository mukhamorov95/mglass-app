import { describe, it, expect } from 'vitest'
import { orderCostBreakdown } from '@/lib/b2b/orderCostBreakdown'

// Просчёт №05655 (07.10.2026): 4 стекла «Прозрачное М1» 8 мм с закалкой, скидка 10%.
// Владелец видел «к оплате 11 427 · себестоимость 6 439» и не понимал, что в 6 439.
const glass = (w: number, h: number, net: number, billed: number, mat: number, temp: number, edge: number, pack: number, cwv: number, ivat: number, cex: number) => ({
  materialName: 'Прозрачное М1', width: w, height: h, quantity: 1, wastePercent: 30,
  totalAreaNet: net, totalAreaBilled: billed,
  costMaterial: mat, costTempering: temp, costFacet: 0, costEdge: edge, costTransport: 77, costPackaging: pack,
  costWithVat: cwv, inputVat: ivat, costExVat: cex,
})
const order5655 = [
  glass(444, 2196, 0.975, 1.2675, 990, 488, 211, 117, 1883, 340, 1543),
  glass(440, 2189, 0.9632, 1.2522, 978, 482, 210, 116, 1863, 336, 1527),
  glass(490, 2189, 1.0726, 1.3944, 1089, 536, 214, 129, 2045, 369, 1676),
  glass(494, 2196, 1.0848, 1.4102, 1101, 542, 215, 130, 2065, 372, 1693),
]

describe('orderCostBreakdown — №05655', () => {
  const b = orderCostBreakdown(order5655, 11427, 6439)
  const line = (name: string) => b.lines.find(l => l.name === name)?.total

  it('статьи сложены по позициям', () => {
    expect(line('Материал')).toBe(4158)
    expect(line('Закалка')).toBe(2048)
    expect(line('Транспорт на закалку')).toBe(308)
    expect(line('Обработка кромки')).toBe(850)
    expect(line('Упаковка')).toBe(492)
    expect(b.lines.some(l => l.name === 'Не разложено по статьям')).toBe(false)
  })

  it('показанное тождество сходится: статьи → с НДС → минус НДС → без НДС = сохранённая', () => {
    expect(b.lines.reduce((s, l) => s + l.total, 0)).toBe(b.withVat)
    expect(b.withVat).toBe(7856)
    expect(b.vat).toBe(1417)
    expect(b.withVat - b.vat).toBe(b.exVat)
    expect(b.exVat).toBe(6439)
    expect(b.storedDiff).toBe(0)
  })

  it('продажа без НДС и прибыль дают маржу из шапки (31%)', () => {
    expect(b.saleExVat).toBe(9366)
    expect(b.profit).toBe(2927)
    expect(b.saleExVat - b.exVat).toBe(b.profit)
    expect(Math.round(b.profit / b.saleExVat * 100)).toBe(31)
  })

  it('у материала подписаны площадь и отход', () => {
    expect(b.lines.find(l => l.name === 'Материал')?.note).toBe('в расчёте 5,32 м² при чистых 4,10 м² — отход 30% на раскрой')
  })

  it('по позициям: каждая сходится со своей себестоимостью с НДС', () => {
    expect(b.positions).toHaveLength(4)
    for (const p of b.positions) expect(p.lines.reduce((s, l) => s + l.total, 0)).toBe(p.withVat)
    expect(b.positions[0].title).toBe('444×2196 ×1')
  })
})

describe('orderCostBreakdown — расхождения видны, а не прячутся', () => {
  it('изделие — одной строкой в сводке, состав в позиции; недостающее в составе — строкой позиции', () => {
    const b = orderCostBreakdown([{
      materialName: 'Зеркало с подсветкой', width: 1400, height: 1500, quantity: 1,
      bom: [{ name: 'Зеркало', qty: 2.1, unit: 'м²', price: 1900, total: 3990 }, { name: 'Лента', qty: 5.8, unit: 'м', price: 210, total: 1218 }],
      costWithVat: 5300, inputVat: 956, costExVat: 4344,
    }], 9000, 4344)
    expect(b.lines).toEqual([{ name: 'Изделие: Зеркало с подсветкой', total: 5300 }])
    expect(b.positions[0].lines.at(-1)).toEqual({ name: 'Не разложено по статьям', total: 92 })
    expect(b.positions[0].lines.reduce((s, l) => s + l.total, 0)).toBe(5300)
  })

  it('сохранённая в заказе себестоимость, не равная сумме позиций, даёт разницу', () => {
    const b = orderCostBreakdown(order5655, 11427, 6500)
    expect(b.storedDiff).toBe(61)
  })
})
