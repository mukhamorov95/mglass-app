import { describe, it, expect } from 'vitest'
import { auditOrder, buildMarginAudit, marginColor, type AuditOrderInput, type MarginThresholds } from '@/lib/b2b/marginAudit'
import { VAT } from '@/lib/b2bCalculator'

const T: MarginThresholds = { target: 40, green: 35, yellow: 25 }
const inc = (net: number) => Math.round(net * (100 + VAT) / 100)   // без НДС → с НДС

// Просчёт с заданной маржой по прайсу и скидкой. costNet фиксируем, цену подбираем.
function order(over: Partial<AuditOrderInput> & { costNet: number; listMargin: number; discount: number }): AuditOrderInput {
  const listNet = over.costNet / (1 - over.listMargin / 100)
  const listInc = inc(listNet)
  const afterInc = Math.round(listInc * (1 - over.discount / 100))
  return {
    id: over.id ?? 1, createdAt: over.createdAt ?? '2026-08-10', clientId: over.clientId ?? 1,
    clientName: over.clientName ?? 'Клиент', managerName: over.managerName ?? 'Яна',
    discountPercent: over.discount, totalCostNet: over.costNet,
    totalSaleIncVat: listInc, totalAfterDiscount: afterInc, items: over.items,
  }
}

describe('marginColor', () => {
  it('red < 25, amber 25–35, green ≥ 35', () => {
    expect(marginColor(24, T)).toBe('red')
    expect(marginColor(25, T)).toBe('amber')
    expect(marginColor(34.9, T)).toBe('amber')
    expect(marginColor(35, T)).toBe('green')
    expect(marginColor(null, T)).toBe('unknown')
  })
})

describe('auditOrder — маржа как при сохранении', () => {
  it('маржа считается по выручке без НДС, совпадает с прайсовой при нулевой скидке', () => {
    const o = auditOrder(order({ costNet: 6000, listMargin: 40, discount: 0 }), T)
    expect(o.marginList).toBe(40)
    expect(o.marginActual).toBe(40)
    expect(o.cause).toBe('ok')
    expect(o.undersoldNet).toBe(0)
  })

  it('скидка утащила маржу ниже цели → причина «скидка менеджера»', () => {
    const o = auditOrder(order({ costNet: 6000, listMargin: 40, discount: 20 }), T)
    expect(o.marginList).toBe(40)
    expect(o.marginActual! < 40).toBe(true)
    expect(o.cause).toBe('manager_discount')
    expect(o.gapFromDiscountPts).toBeGreaterThan(o.gapFromPricePts)
    expect(o.undersoldNet).toBeGreaterThan(0)
  })

  it('цена изначально ниже цели без скидки → «низкая цена продажи»', () => {
    const o = auditOrder(order({ costNet: 6000, listMargin: 20, discount: 0 }), T)
    expect(o.cause).toBe('low_list_price')
    expect(o.gapFromPricePts).toBeGreaterThan(0)
    expect(o.gapFromDiscountPts).toBe(0)
  })

  it('позиции без себестоимости перекрывают прочие причины (A7)', () => {
    const o = auditOrder(order({
      costNet: 6000, listMargin: 20, discount: 15,
      items: [{ materialName: 'Стекло', thickness: 6, costWithVat: 0, saleIncVat: 5000 }],
    }), T)
    expect(o.cause).toBe('missing_cost')
    expect(o.missingCostPositions).toBe(1)
  })

  it('undersoldNet — сколько добрать до целевой выручки без НДС', () => {
    const o = auditOrder(order({ costNet: 6000, listMargin: 30, discount: 0 }), T)
    // цель 40%: нужная выручка = 6000/0.6 = 10000; фактическая = 6000/0.7 ≈ 8571 → ~1429
    expect(o.undersoldNet).toBeGreaterThan(1300)
    expect(o.undersoldNet).toBeLessThan(1550)
  })

  it('маржа выше цели — не в отчёте, недозаработка нет', () => {
    const o = auditOrder(order({ costNet: 6000, listMargin: 45, discount: 0 }), T)
    expect(o.marginActual! >= 40).toBe(true)
    expect(o.cause).toBe('ok')
    expect(o.undersoldNet).toBe(0)
  })
})

describe('buildMarginAudit', () => {
  const inputs: AuditOrderInput[] = [
    order({ id: 1, costNet: 6000, listMargin: 40, discount: 25, managerName: 'Яна',   clientName: 'ААА', clientId: 1 }), // discount
    order({ id: 2, costNet: 9000, listMargin: 18, discount: 0,  managerName: 'Алина', clientName: 'БББ', clientId: 2 }), // low price, big cost
    order({ id: 3, costNet: 3000, listMargin: 42, discount: 0,  managerName: 'Яна',   clientName: 'ААА', clientId: 1 }), // ok
    order({ id: 4, costNet: 5000, listMargin: 40, discount: 30, managerName: 'Яна',   clientName: 'ВВВ', clientId: 3 }), // discount
  ]

  it('в отчёт попадают только просчёты ниже цели, отсортированы по деньгам', () => {
    const r = buildMarginAudit(inputs, T)
    expect(r.scanned).toBe(4)
    expect(r.belowTarget).toBe(3)                       // #3 в норме
    expect(r.orders.map(o => o.id)).not.toContain(3)
    // сортировка по недозаработку убывающе
    const money = r.orders.map(o => o.undersoldNet)
    expect(money).toEqual([...money].sort((a, b) => b - a))
    expect(r.totalUndersoldNet).toBe(r.orders.reduce((s, o) => s + o.undersoldNet, 0))
  })

  it('разбор по причинам в рублях', () => {
    const r = buildMarginAudit(inputs, T)
    const causes = Object.fromEntries(r.byCause.map(c => [c.cause, c.count]))
    expect(causes['manager_discount']).toBe(2)
    expect(causes['low_list_price']).toBe(1)
  })

  it('менеджеры: систематичность считается по всем просчётам, деньги по недобору', () => {
    const r = buildMarginAudit(inputs, T)
    const yana = r.byManager.find(m => m.managerName === 'Яна')!
    expect(yana.total).toBe(3)      // все три Яны учтены в total
    expect(yana.belowTarget).toBe(2)
    expect(r.byManager[0].undersoldNet).toBeGreaterThanOrEqual(r.byManager[r.byManager.length - 1].undersoldNet)
  })

  it('клиенты: агрегируются только просчёты ниже цели', () => {
    const r = buildMarginAudit(inputs, T)
    const bbb = r.byClient.find(c => c.clientName === 'БББ')!
    expect(bbb.belowTarget).toBe(1)
    expect(bbb.undersoldNet).toBeGreaterThan(0)
  })
})
