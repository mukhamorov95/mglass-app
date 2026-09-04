import { describe, it, expect } from 'vitest'
import { mirrorGeometry, lightingLength, packs, pickPsu, calcMirrorQuote, PSU_LOAD, type MirrorComponent } from '@/lib/mirror/mirrorQuote'

const strip = (over: Partial<MirrorComponent> = {}): MirrorComponent => ({
  id: 1, component_type: 'led_strip', name: 'Лента 24V', voltage: 24,
  power_per_meter: 9.6, max_power: null, cost_price: 80, unit: 'пог.м', pack_length_m: 5, ...over,
})
const psu = (max: number, cost: number, volt = 24): MirrorComponent => ({
  id: max, component_type: 'power_supply', name: `БП ${max}W`, voltage: volt,
  power_per_meter: null, max_power: max, cost_price: cost, unit: 'шт', pack_length_m: null,
})

describe('зеркало: геометрия и длина подсветки', () => {
  it('прямоугольник — площадь и периметр', () => {
    const g = mirrorGeometry(800, 600, 'rect')
    expect(g.areaM2).toBe(0.48)
    expect(g.perimeterM).toBe(2.8)
  })
  it('свет только сверху — длина равна ширине, а не периметру', () => {
    expect(lightingLength(800, 600, 'rect', { top: true, bottom: false, left: false, right: false })).toBe(0.8)
  })
})

describe('зеркало: кратность упаковок', () => {
  it('3 м ленты — целая бухта 5 м', () => expect(packs(3, 5)).toEqual({ qty: 1, byPack: true }))
  it('7 м ленты — две бухты', () => expect(packs(7, 5)).toEqual({ qty: 2, byPack: true }))
  it('без длины упаковки — погонно', () => expect(packs(3.4, null)).toEqual({ qty: 3.4, byPack: false }))
})

describe('зеркало: подбор блока питания', () => {
  it('берёт БП с запасом 30%, а не впритык', () => {
    const { psu: got, targetW, enough } = pickPsu([psu(48, 157), psu(72, 237), psu(100, 386)], 24, 48)
    expect(targetW).toBeCloseTo(48 / PSU_LOAD, 1)
    expect(got?.max_power).toBe(72)
    expect(enough).toBe(true)
  })
  it('когда мощности не хватает — сообщает', () => {
    expect(pickPsu([psu(48, 157)], 24, 96).enough).toBe(false)
  })
})

describe('зеркало: спецификация', () => {
  const comps = [strip(), psu(48, 157), psu(72, 237)]
  it('лента бухтой, сумма сходится со строками', () => {
    const q = calcMirrorQuote({
      width: 800, height: 600, shape: 'rect', lighting: true,
      sides: { top: true, bottom: false, left: false, right: false },
      voltage: 24, control: 'none', frame: 'none', glassCost: 1000,
    }, comps, {})
    const led = q.lines.find(l => l.role === 'led_strip')!
    expect(led.unit).toBe('бухта')
    expect(led.qty).toBe(1)
    expect(led.total).toBe(400)
    expect(q.hardwareCost).toBe(q.lines.reduce((s, l) => s + l.total, 0))
    expect(q.directCost).toBe(q.hardwareCost + 1000)
  })
  it('пустой справочник не обнуляет цену молча', () => {
    const q = calcMirrorQuote({
      width: 800, height: 600, shape: 'rect', lighting: true,
      sides: { top: true, bottom: false, left: false, right: false },
      voltage: 24, control: 'sensor', frame: 'none', glassCost: 0,
    }, comps, {})
    expect(q.complete).toBe(false)
    expect(q.missing.map(m => m.role)).toContain('sensor')
  })
})

describe('зеркало: что берём по умолчанию', () => {
  it('берёт первую по порядку справочника, а не самую дешёвую', () => {
    const comps: MirrorComponent[] = [
      { id: 1, component_type: 'led_strip', name: 'Рабочая 2835 9,6 Вт/м', voltage: 12, power_per_meter: 9.6, max_power: null, cost_price: 88, unit: 'пог.м', pack_length_m: 5, sort_order: 10 },
      { id: 2, component_type: 'led_strip', name: 'Дешёвая 5050 14,4 Вт/м', voltage: 12, power_per_meter: 14.4, max_power: null, cost_price: 58, unit: 'пог.м', pack_length_m: 5, sort_order: 13 },
      psu(100, 439, 12),
    ]
    const q = calcMirrorQuote({
      width: 800, height: 600, shape: 'rect', lighting: true,
      sides: { top: true, bottom: false, left: false, right: false },
      voltage: 12, control: 'none', frame: 'none', glassCost: 0,
    }, comps, {})
    expect(q.lines.find(l => l.role === 'led_strip')!.label).toContain('Рабочая')
  })
})
