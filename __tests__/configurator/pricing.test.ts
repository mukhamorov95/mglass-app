import { describe, it, expect } from 'vitest'
import { computeQuantities, computePrice, DEFAULT_UNIT_PRICES, DEFAULT_FINANCE } from '@/lib/configurator/pricing'
import { buildFromModel } from '@/components/configurator/scene/assembly'
import { getModel } from '@/lib/configurator/arrangement'

describe('pricing', () => {
  it('количества берутся из геометрии: секции = полотна, м² > 0, фурнитура посчитана', () => {
    const a = buildFromModel(getModel('М7'), { width: 1100, height: 2000, width2: 900, doorWidth: 600 }, 8)
    const q = computeQuantities(a, 8)
    expect(q.sections).toBe(a.glass.length)
    expect(q.sections).toBeGreaterThanOrEqual(3)     // угловая: боковой фикс + фронт фикс + дверь
    expect(q.glassM2).toBeGreaterThan(0)
    expect(q.hardware.balge).toBeGreaterThanOrEqual(2) // петли на двери
    expect(q.hardware.sd210).toBe(1)                   // ручка
  })

  it('цена по формуле Быстрого расчёта: Цена = Себест/(1−маржа−налог) + монтаж×секции + доставка', () => {
    const a = buildFromModel(getModel('М1'), { width: 1000, height: 2000 }, 8)
    const q = computeQuantities(a, 8)
    const p = computePrice(q, DEFAULT_UNIT_PRICES, DEFAULT_FINANCE)
    // Цена изделия = материалы / (1 − 0.40 − 0.12) = материалы / 0.48
    expect(p.itemPrice).toBe(Math.round(p.materialsCost / 0.48))
    // Монтаж = 6500 × секции
    expect(p.installCost).toBe(6500 * q.sections)
    // Доставка Москва по умолчанию 5000
    expect(p.deliveryCost).toBe(5000)
    // Сумма = цена изделия + монтаж + доставка
    expect(p.total).toBe(p.itemPrice + p.installCost + p.deliveryCost)
    expect(p.materialsCost).toBe(p.glassCost + p.hardwareCost + p.profileCost + p.tubeCost)
  })

  it('без доставки монтаж и цена изделия остаются, доставка 0', () => {
    const a = buildFromModel(getModel('М10'), { width: 1400, height: 2000 }, 10)
    const q = computeQuantities(a, 10)
    const p = computePrice(q, DEFAULT_UNIT_PRICES, DEFAULT_FINANCE, { withDelivery: false })
    expect(p.deliveryCost).toBe(0)
    expect(p.total).toBe(p.itemPrice + p.installCost)
  })

  it('толще стекло (10 vs 8) — дороже стекло и итог', () => {
    const a = buildFromModel(getModel('М1'), { width: 1000, height: 2000 }, 8)
    const p8 = computePrice(computeQuantities(a, 8))
    const p10 = computePrice(computeQuantities(a, 10))
    expect(p10.glassCost).toBeGreaterThan(p8.glassCost)
    expect(p10.total).toBeGreaterThan(p8.total)
  })
})
