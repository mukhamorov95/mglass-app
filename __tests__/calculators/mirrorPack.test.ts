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
    const q = calcMirrorQuote({ width: 1000, height: 600, shape: 'rect', lightMode: 'none',
      sides: { top: false, bottom: false, left: false, right: false }, voltage: 12,
      control: 'none', frame: 'vetro', glassCost: 0 }, [...comps, frame(6)], {})
    const f = q.lines.find(l => l.role === 'frame')!
    expect(q.perimeterM).toBe(3.2)
    expect(f.qty).toBe(1)
    expect(f.total).toBe(492)        // 6 м × 82 ₽
  })
})

describe('профиль палками по 2 м (фронтальная подсветка)', () => {
  it('свет сверху и снизу зеркала 800×600 = 1,6 м → одна палка', () => {
    const q = calcMirrorQuote({ width: 800, height: 600, shape: 'rect', lightMode: 'front',
      sides: { top: true, bottom: true, left: false, right: false }, voltage: 12,
      control: 'none', frame: 'none', glassCost: 0 }, comps, {})
    const prof = q.lines.find(l => l.role === 'diffuser')!
    expect(q.lightingM).toBe(1.6)
    expect(prof.qty).toBe(1)
    expect(prof.total).toBe(150)          // 2 м × 75 ₽
    console.log(JSON.stringify(q.lines.map(l => `${l.label}: ${l.qty} ${l.unit} = ${l.total} ₽ (${l.note ?? ''})`), null, 1))
  })
  it('периметр 1000×800 по всем сторонам = 3,6 м → две палки', () => {
    const q = calcMirrorQuote({ width: 1000, height: 800, shape: 'rect', lightMode: 'front',
      sides: { top: true, bottom: true, left: true, right: true }, voltage: 12,
      control: 'none', frame: 'none', glassCost: 0 }, comps, {})
    expect(q.lines.find(l => l.role === 'diffuser')!.qty).toBe(2)
  })
})

describe('провод не обязателен', () => {
  it('без позиции «провод» расчёт всё равно считается', () => {
    const q = calcMirrorQuote({ width: 800, height: 600, shape: 'rect', lightMode: 'aura',
      sides: { top: true, bottom: false, left: false, right: false }, voltage: 12,
      control: 'none', frame: 'none', glassCost: 0 }, comps, {})
    expect(q.complete).toBe(true)
    expect(q.missing.map(m => m.role)).not.toContain('wire')
  })
})

describe('три исполнения подсветки', () => {
  const led = (v: number, w: number): MirrorComponent => ({
    id: 100 + v, component_type: 'led_strip', name: `Лента ${v}V ${w}Вт/м`, voltage: v,
    power_per_meter: w, max_power: null, cost_price: 88, unit: 'пог.м', pack_length_m: 5, sort_order: 10,
  })
  const full: MirrorComponent[] = [
    led(12, 9.6),
    { id: 2, component_type: 'diffuser', name: 'Профиль 16x7', voltage: null, power_per_meter: null, max_power: null, cost_price: 75, unit: 'м.п.', pack_length_m: 2, sort_order: 10 },
    { id: 3, component_type: 'sandblast', name: 'Пескоструй полоса', voltage: null, power_per_meter: null, max_power: null, cost_price: 400, unit: 'пог.м', pack_length_m: null, sort_order: 10 },
    { id: 4, component_type: 'power_supply', name: 'БП 48', voltage: 12, power_per_meter: null, max_power: 48, cost_price: 161, unit: 'шт', pack_length_m: null, sort_order: 10 },
    { id: 5, component_type: 'power_supply', name: 'БП 72', voltage: 12, power_per_meter: null, max_power: 72, cost_price: 263, unit: 'шт', pack_length_m: null, sort_order: 11 },
    { id: 6, component_type: 'assembly', name: 'Сборка подсветки', voltage: null, power_per_meter: null, max_power: null, cost_price: 500, unit: 'шт', pack_length_m: null, sort_order: 10 },
  ]
  const base = { width: 800, height: 600, shape: 'rect' as const, sides: { top: true, bottom: false, left: false, right: false }, voltage: 12 as const, control: 'none' as const, frame: 'none' as const, glassCost: 0 }

  it('аура: лента есть, профиля и песочки НЕТ', () => {
    const q = calcMirrorQuote({ ...base, lightMode: 'aura' }, full, {})
    expect(q.lines.some(l => l.role === 'led_strip')).toBe(true)
    expect(q.lines.some(l => l.role === 'diffuser')).toBe(false)
    expect(q.lines.some(l => l.role === 'sandblast')).toBe(false)
    expect(q.complete).toBe(true)
  })
  it('фронт: есть профиль и песочка', () => {
    const q = calcMirrorQuote({ ...base, lightMode: 'front' }, full, {})
    expect(q.lines.some(l => l.role === 'diffuser')).toBe(true)
    expect(q.lines.some(l => l.role === 'sandblast')).toBe(true)
  })
  it('обе: две ленты, мощности складываются, блок усиленный, сборка ×2', () => {
    // свет по всему периметру 2,8 м, два контура: 2 × 2.8 × 9.6 = 53.76 Вт →
    // с запасом 76.8 Вт → 48-ваттный не годится, берётся 72-ваттный
    const q = calcMirrorQuote({ ...base, sides: { top: true, bottom: true, left: true, right: true }, lightMode: 'both' }, full, {})
    const strips = q.lines.filter(l => l.role === 'led_strip')
    expect(strips.length).toBe(2)
    const psu = q.lines.find(l => l.role === 'power_supply')!
    expect(psu.label).toContain('72')
    const asm = q.lines.find(l => l.role === 'assembly')!
    expect(asm.qty).toBe(2)
  })
  it('фронт без песочки в справочнике → missing, не молчаливый ноль', () => {
    const noSand = full.filter(c => c.component_type !== 'sandblast')
    const q = calcMirrorQuote({ ...base, lightMode: 'front' }, noSand, {})
    expect(q.complete).toBe(false)
    expect(q.missing.map(m => m.role)).toContain('sandblast')
  })
})
