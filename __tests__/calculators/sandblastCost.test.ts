import { describe, it, expect } from 'vitest'
import { sandblastCost, filmPerM2, sandPerM2, equipmentPerM2 } from '@/lib/pricing/sandblastCost'

// Известное от владельца 22.09.2026: рулон оракала 50 м стоит ≈8 000 ₽.
const FILM = { rollPrice: 8000, rollLengthM: 50, rollWidthM: 1, layers: 1, wastePct: 0 }
// Минутная ставка из production_settings прода: 160 000 ₽ / (20 дн × 8 ч × 60) = 16,67 ₽/мин.
const MINUTE_RATE = 160000 / (20 * 8 * 60)

describe('filmPerM2', () => {
  it('рулон 50 × 1 м за 8 000 ₽ — это 160 ₽ за м² в один слой', () => {
    expect(filmPerM2(FILM)).toBeCloseTo(160, 2)
  })
  it('два слоя (лицо под трафарет + защита обратной стороны) — вдвое', () => {
    expect(filmPerM2({ ...FILM, layers: 2 })).toBeCloseTo(320, 2)
  })
  it('обрезки закладываются процентом', () => {
    expect(filmPerM2({ ...FILM, wastePct: 20 })).toBeCloseTo(192, 2)
  })
  it('широкий рулон дешевле за м²', () => {
    expect(filmPerM2({ ...FILM, rollWidthM: 1.26 })).toBeCloseTo(126.98, 1)
  })
  it('без цены или размеров рулона — ноль, а не выдуманное число', () => {
    expect(filmPerM2({ ...FILM, rollPrice: 0 })).toBe(0)
    expect(filmPerM2({ ...FILM, rollWidthM: 0 })).toBe(0)
  })
})

describe('sandPerM2', () => {
  it('мешок 25 кг за 500 ₽ при расходе 2 кг/м² — 40 ₽/м²', () => {
    expect(sandPerM2({ bagPrice: 500, bagKg: 25, kgPerM2: 2 })).toBeCloseTo(40, 2)
  })
  it('без веса мешка считать нечего', () => {
    expect(sandPerM2({ bagPrice: 500, bagKg: 0, kgPerM2: 2 })).toBe(0)
  })
})

describe('equipmentPerM2', () => {
  it('300 000 ₽ на 5 лет при 100 м²/мес — 50 ₽/м²', () => {
    expect(equipmentPerM2({ price: 300000, lifeYears: 5, m2PerMonth: 100 })).toBeCloseTo(50, 2)
  })
  it('без объёма работы амортизацию не размазать', () => {
    expect(equipmentPerM2({ price: 300000, lifeYears: 5, m2PerMonth: 0 })).toBe(0)
  })
})

describe('sandblastCost', () => {
  const full = {
    film: FILM,
    sand: { bagPrice: 500, bagKg: 25, kgPerM2: 2 },
    minutesPerM2: 20,
    minuteRate: MINUTE_RATE,
    equipment: { price: 300000, lifeYears: 5, m2PerMonth: 100 },
    overheadPct: 20,
  }

  it('итог складывается ровно из показанных строк', () => {
    const r = sandblastCost(full)
    expect(r.lines).toHaveLength(4)
    const sum = r.lines.reduce((s, l) => s + l.rubPerM2, 0)
    expect(r.directPerM2).toBeCloseTo(sum, 2)
    expect(r.costPerM2).toBeCloseTo(r.directPerM2 + r.overheadPerM2, 2)
    expect(r.missing).toEqual([])
  })

  it('на известных числах: 160 плёнка + 40 песок + 333,33 работа + 50 амортизация', () => {
    const r = sandblastCost(full)
    const by = (n: string) => r.lines.find(l => l.name.startsWith(n))!.rubPerM2
    expect(by('Плёнка')).toBeCloseTo(160, 1)
    expect(by('Песок')).toBeCloseTo(40, 1)
    expect(by('Работа')).toBeCloseTo(333.33, 1)
    expect(by('Амортизация')).toBeCloseTo(50, 1)
    expect(r.directPerM2).toBeCloseTo(583.33, 1)
    expect(r.overheadPerM2).toBeCloseTo(116.67, 1)
    expect(r.costPerM2).toBeCloseTo(700, 1)
  })

  it('чего не назвали — то названо в missing и в сумму не вошло', () => {
    const r = sandblastCost({ ...full, sand: null, equipment: null })
    expect(r.lines.map(l => l.name)).toEqual(['Плёнка (оракал)', 'Работа оператора'])
    expect(r.missing).toHaveLength(2)
    expect(r.missing[0]).toContain('песок')
    expect(r.missing[1]).toContain('оборудование')
  })

  it('пустые входные данные — ноль и полный список того, что нужно спросить', () => {
    const r = sandblastCost({ film: null, sand: null, minutesPerM2: null, minuteRate: MINUTE_RATE, equipment: null, overheadPct: 20 })
    expect(r.costPerM2).toBe(0)
    expect(r.missing).toHaveLength(4)
  })
})
