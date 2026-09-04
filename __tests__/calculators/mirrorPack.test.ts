import { describe, it, expect } from 'vitest'
import { calcMirrorQuote, type MirrorComponent } from '@/lib/mirror/mirrorQuote'

const comps: MirrorComponent[] = [
  { id: 1, component_type: 'led_strip', name: 'Лента 2835', voltage: 12, power_per_meter: 9.6, max_power: null, cost_price: 88, unit: 'пог.м', pack_length_m: 5, sort_order: 10 },
  { id: 2, component_type: 'diffuser', name: 'Профиль 16x7', voltage: null, power_per_meter: null, max_power: null, cost_price: 75, unit: 'м.п.', pack_length_m: 2, sort_order: 10 },
  { id: 3, component_type: 'power_supply', name: 'БП 100', voltage: 12, power_per_meter: null, max_power: 100, cost_price: 439, unit: 'шт', pack_length_m: null, sort_order: 12 },
]

const frame = (pack: number | null): MirrorComponent => ({
  id: 9, component_type: 'frame', name: 'Бокс 20×20 АД31Т1', voltage: null,
  power_per_meter: null, max_power: null, cost_price: 82, unit: 'м.п.', pack_length_m: pack, sort_order: 10,
})

describe('рамка Ветро хлыстами по 6 м', () => {
  it('периметр 3,2 м → один хлыст 6 м, а не 3,2 погонных метра', () => {
    const q = calcMirrorQuote({ width: 1000, height: 600, shape: 'rect', lighting: false,
      sides: { top: false, bottom: false, left: false, right: false }, voltage: 12,
      control: 'none', frame: 'vetro', glassCost: 0 }, [...comps, frame(6)], {})
    const f = q.lines.find(l => l.role === 'frame')!
    expect(q.perimeterM).toBe(3.2)
    expect(f.qty).toBe(1)
    expect(f.total).toBe(492)        // 6 м × 82 ₽
  })
})

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

describe('провод не обязателен', () => {
  it('без позиции «провод» расчёт всё равно считается', () => {
    const q = calcMirrorQuote({ width: 800, height: 600, shape: 'rect', lighting: true,
      sides: { top: true, bottom: false, left: false, right: false }, voltage: 12,
      control: 'none', frame: 'none', glassCost: 0 }, comps, {})
    expect(q.complete).toBe(true)
    expect(q.missing.map(m => m.role)).not.toContain('wire')
  })
})
