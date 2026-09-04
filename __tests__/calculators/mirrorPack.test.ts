import { describe, it, expect } from 'vitest'
import { calcMirrorQuote, type MirrorComponent } from '@/lib/mirror/mirrorQuote'

const comps: MirrorComponent[] = [
  { id: 1, component_type: 'led_strip', name: 'Лента 2835', voltage: 12, power_per_meter: 9.6, max_power: null, cost_price: 88, unit: 'пог.м', pack_length_m: 5, sort_order: 10 },
  { id: 2, component_type: 'diffuser', name: 'Профиль 16x7', voltage: null, power_per_meter: null, max_power: null, cost_price: 75, unit: 'м.п.', pack_length_m: 2, sort_order: 10 },
  { id: 3, component_type: 'power_supply', name: 'БП 100', voltage: 12, power_per_meter: null, max_power: 100, cost_price: 439, unit: 'шт', pack_length_m: null, sort_order: 12 },
]

describe('профиль палками по 2 м', () => {
  it('свет сверху и снизу зеркала 800×600 = 1,6 м → одна палка', () => {
    const q = calcMirrorQuote({ width: 800, height: 600, shape: 'rect', lighting: true,
      sides: { top: true, bottom: true, left: false, right: false }, voltage: 12,
      control: 'none', frame: 'none', glassCost: 0 }, comps, {})
    const prof = q.lines.find(l => l.role === 'diffuser')!
    expect(q.lightingM).toBe(1.6)
    expect(prof.qty).toBe(1)
    expect(prof.total).toBe(150)          // 2 м × 75 ₽
    console.log(JSON.stringify(q.lines.map(l => `${l.label}: ${l.qty} ${l.unit} = ${l.total} ₽ (${l.note ?? ''})`), null, 1))
  })
  it('периметр 1000×800 по всем сторонам = 3,6 м → две палки', () => {
    const q = calcMirrorQuote({ width: 1000, height: 800, shape: 'rect', lighting: true,
      sides: { top: true, bottom: true, left: true, right: true }, voltage: 12,
      control: 'none', frame: 'none', glassCost: 0 }, comps, {})
    expect(q.lightingM).toBe(3.6)
    expect(q.lines.find(l => l.role === 'diffuser')!.qty).toBe(2)
  })
})
