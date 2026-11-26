import { describe, it, expect } from 'vitest'
import { exVat, type VatRegime } from '@/lib/economics/classification/vat'
import { classify, completeness, directCost, marginalIncome, type CostPolicy } from '@/lib/economics/classification/policy'
import { costModel, payrollMismatch, orderUse, orderLayers, unusedCapacity, cashTarget, coverage, sustainableCost, type ResourceProfile, type Centers, type CostBucket } from '@/lib/economics/valuation/tdabc'
import { requiredHours, machineLoad, poolLoad, type CapacityPlan, type Machine, type StaffScenario } from '@/lib/economics/capacity/capacity'
import type { NormSet } from '@/lib/economics/standards/norms'
import { itemLines } from '@/lib/economics/facts/items'
import { itemWork } from '@/lib/economics/batching/work'
import { OPERATIONS } from '@/lib/economics/facts/operations'
import type { Valued } from '@/lib/economics/values'

// Все числа здесь вымышленные.
const v = (value: number | null): Valued => ({ value, status: value == null ? 'missing' : 'owner', source: 'тест', date: '2026-01-01' })
const none: VatRegime = { kind: 'none', status: 'owner' }
const r22: VatRegime = { kind: 'rate', rate: 22, status: 'owner' }

describe('НДС: диапазон вместо выдуманной ставки', () => {
  it('без НДС вычитать нечего; названная ставка даёт одно число', () => {
    expect(exVat(122, none)).toEqual({ lo: 122, hi: 122 })
    expect(exVat(122, r22)).toEqual({ lo: 100, hi: 100 })
  })
  it('ставка из документа, неизвестный режим и неподтверждённая ставка — диапазон', () => {
    expect(exVat(122, { kind: 'from_document', status: 'owner' })).toEqual({ lo: 100, hi: 122 })
    expect(exVat(122, { kind: 'unknown' })).toEqual({ lo: 100, hi: 122 })
    expect(exVat(105, { kind: 'rate', rate: 5, status: 'hypothesis', needsConfirmation: true })).toEqual({ lo: 100, hi: 105 })
  })
})

const policy: CostPolicy = { id: 't', version: 1, rules: [
  { op: 'material', behaviour: 'direct', vat: r22 },
  { op: 'tempering', behaviour: 'direct', vat: none },
  { op: 'components', label: 'LED|лента', behaviour: 'direct', vat: none },
  { op: 'components', behaviour: 'direct', vat: { kind: 'unknown' } },
  { op: 'frame_metal', behaviour: 'direct', vat: { kind: 'from_document', status: 'owner' } },
  { op: 'frame_cutting', behaviour: 'direct', vat: none },
  { op: 'frame_welding', behaviour: 'own', vat: none },
  { op: 'frame_paint', behaviour: 'direct', vat: none, perPiece: { lo: v(50), hi: v(70) } },
  { op: 'assembly', behaviour: 'own', vat: none },
  { op: 'overhead_allowance', behaviour: 'allowance', vat: none },
] }
const frameMirror = { category: 'изделие', quantity: 2, width: 500, height: 1000, materialName: 'зеркало', costWithVat: 1122, bom: [
  { name: 'Серебро 4 мм', unit: 'м²', qty: 1, total: 122 }, { name: 'LED лента', unit: 'пог.м', qty: 6, total: 100 },
  { name: 'Блок питания', unit: 'шт', qty: 2, total: 122 }, { name: 'Металл на раму', unit: '₽', qty: 1, total: 122 },
  { name: 'Резка / раскрой полос', unit: '₽', qty: 1, total: 100 }, { name: 'Сварка каркаса', unit: '₽', qty: 1, total: 200 },
  { name: 'Покраска порошковая', unit: '₽', qty: 1, total: 80 }, { name: 'Сборка зеркала в раме', unit: '₽', qty: 1, total: 150 },
  { name: 'Накладные производства 10%', unit: '%', qty: 1, total: 126 },
] }
const lines = itemLines(1, 0, frameMirror).map(l => classify(policy, l, 2))

describe('металлическая рама: пять разных затрат', () => {
  const by = (op: string) => lines.filter(l => l.line.op === op)
  it('металл, сторонний раскрой и покраска — переменные; сварка и сборка — свои', () => {
    expect(['frame_metal', 'frame_cutting', 'frame_paint'].map(o => by(o)[0].rule.behaviour)).toEqual(['direct', 'direct', 'direct'])
    expect(['frame_welding', 'assembly'].map(o => by(o)[0].cost)).toEqual([{ lo: 0, hi: 0 }, { lo: 0, hi: 0 }])
    expect(OPERATIONS.frame_cutting.nature).toBe('external')
  })
  it('на раскрой металла своих часов нет, на сварку и сборку есть', () => {
    const ops = itemWork(1, 0, frameMirror).work.map(w => w.op)
    expect(ops).not.toContain('frame_cutting')
    expect(ops).toEqual(expect.arrayContaining(['frame_welding', 'assembly']))
  })
  it('ориентир покраски — диапазон за штуку, сохранённая сумма видна отдельно', () => {
    expect(by('frame_paint')[0]).toMatchObject({ stored: 80, cost: { lo: 100, hi: 140 }, replaced: true })
  })
  it('лента без НДС, блок питания с неизвестным режимом', () => {
    expect(by('components').map(l => l.cost)).toEqual([{ lo: 100, hi: 100 }, { lo: 100, hi: 122 }])
  })
  it('МД и полнота', () => {
    expect(directCost(lines)).toEqual({ lo: 100 + 100 + 100 + 100 + 100 + 100, hi: 100 + 100 + 122 + 122 + 100 + 140 })
    expect(marginalIncome(1000, directCost(lines), { lo: 10, hi: 10 })).toEqual({ lo: 306, hi: 390 })
    expect(completeness(lines)).toMatchObject({ vatUnconfirmed: 244, replaced: 80 })
  })
  it('операция без правила не пропадает: «не определено» даёт диапазон', () => {
    const c = classify({ ...policy, rules: [] }, lines[0].line, 2)
    expect([c.rule.behaviour, c.cost]).toEqual(['undefined', { lo: 0, hi: 122 }])
  })
})

describe('ресурсные центры TDABC', () => {
  const plan: CapacityPlan = { id: 'p', version: 1, pools: [
    { id: 'cutting', label: 'резка', ops: ['cutting'], hours: v(100) },
    { id: 'edge', label: 'кромка', ops: ['edge'], hours: v(100) },
    { id: 'logistics', label: 'закалка', ops: ['transport'], hours: v(60) },
    { id: 'purchasing', label: 'закупка', ops: ['purchasing'], hours: v(40) },
  ] }
  const labour: Centers = { id: 'c', version: 1, byPool: { cutting: 1000, edge: 3000, logistics: 300, purchasing: 200 } }
  const line = (name: string, value: number | null, bucket: CostBucket, vat: VatRegime = none) => ({ name, amount: v(value), bucket, vat })
  const profile: ResourceProfile = { id: 'e', kind: 'current', version: 1, areaM2: 10, lines: [
    line('труд цеха', 4500, 'payroll_centers'), line('машины', 1000, 'logistics'), line('станки', 1220, 'overhead', { kind: 'unknown' }),
    line('офис', 700, 'admin'), line('взносы', 300, 'overhead_or_admin'), line('аренда', null, 'overhead_or_admin'),
  ] }
  const model = costModel(profile, labour, plan)
  const rate = (id: string) => model.centers.find(c => c.id === id)!.rate!

  it('оплата труда разнесена по участкам без потерь и повторов', () => expect(payrollMismatch(labour, profile)).toBe(0))
  it('каждая статья входит в полную сумму ровно один раз', () => {
    expect(model.total).toEqual({ lo: 4500 + 1000 + 1000 + 700 + 300, hi: 4500 + 1000 + 1220 + 700 + 300 })
    expect(model.missing).toEqual(['аренда', 'склад: расходы отдельно не выделены'])
  })
  it('транспорт идёт только в центры логистики, по их часам', () => {
    expect(rate('logistics').lo).toBeCloseTo((300 + 600) / 60, 9)
    expect(rate('purchasing').lo).toBeCloseTo((200 + 400) / 40, 9)
    expect(rate('cutting')).toEqual({ lo: 10, hi: 10 })
  })
  const hours = { cutting: { labourH: 2, setupH: 0, machineH: 1 }, edge: { labourH: 1, setupH: 0, machineH: 3 }, film: { labourH: 1, setupH: 0, machineH: 0 } }
  it('у каждого участка своя ставка; без исполнителя — от дешёвой до дорогой', () => {
    expect(orderUse(hours, plan, model).map(u => [u.centerId, u.cost])).toEqual([
      ['cutting', { lo: 20, hi: 20 }], ['edge', { lo: 30, hi: 30 }], [null, { lo: 10, hi: 30 }]])
  })
  const full = { cutting: { labourH: 100, setupH: 0, machineH: 0 }, edge: { labourH: 100, setupH: 0, machineH: 0 }, transport: { labourH: 60, setupH: 0, machineH: 0 }, purchasing: { labourH: 40, setupH: 0, machineH: 0 } }
  it.each(['resource_cost', 'labour_minutes'] as const)('при практической мощности всё распределяется один раз (%s)', driver => {
    const use = orderUse(full, plan, model)
    const total = sustainableCost({ lo: 0, hi: 0 }, orderLayers(use, model, driver))
    expect(total.lo).toBeCloseTo(model.total.lo, 6)
    expect(total.hi).toBeCloseTo(model.total.hi, 6)
    expect(unusedCapacity([use], model).every(c => Math.abs(c.unusedCost!.lo) < 1e-6)).toBe(true)
  })
  it('неиспользованная мощность: отнесено + остаток = стоимость центра; перегрузка видна минусом', () => {
    const use = orderUse({ ...hours, edge: { labourH: 150, setupH: 0, machineH: 0 } }, plan, model)
    for (const c of unusedCapacity([use], model)) expect(c.usedCost.lo + c.unusedCost!.lo).toBeCloseTo(c.cost!.lo, 9)
    expect(unusedCapacity([use], model).find(c => c.id === 'edge')!.unusedCost!.lo).toBeLessThan(0)
  })

  it('машинные часы считаются по своей норме, не из человеко-часов', () => {
    const set: NormSet = { id: 'n', version: 1, date: 'd', norms: [{ op: 'edge', setupMin: 60, perPartMin: 60, perUnitMin: 60, machineSetupMin: 30, machineMinPerUnit: 6, status: 'hypothesis', source: 'тест', date: 'd' }] }
    const r = requiredHours([{ orderId: 1, item: 0, op: 'edge', parts: 2, units: 10, batchKey: 'a' }], set).hours.edge!
    expect([r.labourH, r.machineH]).toEqual([13, 1.5])
  })
  const machine: Machine = { id: 'm', label: 'станок', ops: ['edge'], count: 1, calendarHPerShift: v(200) }
  it('второй человек не добавляет часов единственному станку, вторая смена добавляет', () => {
    const h = { edge: { labourH: 150, setupH: 0, machineH: 300 } }
    const hire: StaffScenario = { id: 'h', label: 'найм', setHours: { edge: 400 }, addHours: [], multiply: null, extraMonthlyCost: v(1) }
    expect(poolLoad(h, plan, hire).pools.find(p => p.id === 'edge')!.utilization).toBeLessThan(1)
    expect(machineLoad(h, machine, 1).utilization).toBe(1.5)
    expect(machineLoad(h, machine, 2).utilization).toBe(0.75)
  })
  it('без машинной нормы или числа станков — нет значения, а не ноль', () => {
    expect(machineLoad({ edge: { labourH: 1, setupH: 0, machineH: null } }, machine, 1).requiredH).toBeNull()
    expect(machineLoad({ edge: { labourH: 1, setupH: 0, machineH: 1 } }, { ...machine, count: null }, 1).utilization).toBeNull()
  })

  it.each([0, 500, 1234])('цель по денежному остатку %i — настраиваемая', target => {
    const r = cashTarget({ lo: 800, hi: 1000 }, { lo: 900, hi: 1100 }, target)
    expect(r.surplus).toEqual({ lo: -300, hi: 100 })
    expect(r.required).toEqual({ lo: 900 + target, hi: 1100 + target })
    expect(r.volumeFactor).toEqual({ lo: (900 + target) / 1000, hi: (1100 + target) / 800 })
  })
  it('покрытие: наверняка, возможно, покрыто', () => {
    expect([9, 15, 20].map(x => coverage(x, { lo: 10, hi: 20 }))).toEqual(['certain', 'possible', 'covered'])
  })
})
