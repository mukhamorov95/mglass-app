import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { weakest, fingerprint, valuedError, type Valued, type Status } from '@/lib/economics/values'
import { normSetErrors, normSetStamp, type Norm, type NormSet, type NormOp } from '@/lib/economics/standards/norms'
import { itemWork, batches } from '@/lib/economics/batching/work'
import { requiredHours, poolLoad, totalLabourH, type CapacityPlan, type StaffScenario } from '@/lib/economics/capacity/capacity'
import { recommend, approvePrice, displacedRate, type FloorInput } from '@/lib/economics/pricing/shadow'

// Все числа здесь вымышленные.
const v = (value: number | null, status: Status = 'owner'): Valued => ({ value, status: value == null ? 'missing' : status, source: 'тест', date: '2026-01-01' })
const norm = (op: NormOp, setupMin = 10, perPartMin = 2, perUnitMin = 1): Norm =>
  ({ op, setupMin, perPartMin, perUnitMin, machineMinPerUnit: null, status: 'hypothesis', source: 'тест', date: '2026-01-01' })
const set: NormSet = { id: 't', version: 1, date: '2026-01-01', norms: (['cutting', 'edge', 'drilling', 'packaging', 'transport', 'purchasing'] as NormOp[]).map(op => norm(op)) }
const glass = { category: 'стекло', materialId: 1, thickness: 8, width: 500, height: 1000, quantity: 1, totalAreaNet: 0.5, costEdge: 100, costTempering: 100 }

describe('статусы и версии норм', () => {
  it('результат получает самый слабый статус', () => {
    expect(weakest(['document', 'hypothesis', 'measured'])).toBe('hypothesis')
    expect(weakest(['owner', 'missing'])).toBe('missing')
  })
  it('пустое значение — только «нет значения», нулём не заменяется', () => {
    expect(valuedError({ value: 0, status: 'missing', source: 'x', date: 'd' }, 'a')).toBeTruthy()
    expect(valuedError({ value: null, status: 'owner', source: 'x', date: 'd' }, 'a')).toBeTruthy()
    expect(valuedError(v(null), 'a')).toBeNull()
  })
  it('«измерено» без выборки и норма без источника не принимаются', () => {
    expect(normSetErrors(set)).toEqual([])
    expect(normSetErrors({ ...set, norms: [{ ...norm('edge'), status: 'measured' }] })).toHaveLength(1)
    expect(normSetErrors({ ...set, norms: [{ ...norm('edge'), source: '' }] })).toHaveLength(1)
    expect(normSetErrors({ ...set, norms: [{ ...norm('edge'), perUnitMin: null }] })).toHaveLength(1)
  })
  it('уточнение нормы меняет отпечаток, прежний набор остаётся прежним', () => {
    const before = fingerprint(set)
    const next: NormSet = { ...set, version: 2, norms: set.norms.map(n => n.op === 'edge' ? { ...n, perUnitMin: 3, status: 'measured', sample: 20 } : n) }
    expect(normSetStamp(next)).not.toBe(normSetStamp(set))
    expect(fingerprint(set)).toBe(before)
  })
})

describe('объём работ и технологические партии', () => {
  it('триплекс: каждое стекло режется и сверлится, упаковывается изделие', () => {
    const { work } = itemWork(1, 0, { ...glass, quantity: 2, totalAreaNet: 1, hasTriplex: true, holes: [{ d: 12, n: 4 }] })
    expect(work.filter(w => w.op === 'cutting')).toHaveLength(2)
    expect(work.filter(w => w.op === 'drilling').reduce((a, w) => a + w.units, 0)).toBe(16)
    expect(work.filter(w => w.op === 'packaging')).toHaveLength(1)
  })
  it('совместимые разные детали делят наладку, несовместимые — нет', () => {
    const a = itemWork(1, 0, glass).work
    const sameKind = itemWork(1, 1, { ...glass, width: 700 }).work
    const otherThickness = itemWork(1, 2, { ...glass, thickness: 10, materialId: 2 }).work
    const setups = (w: ReturnType<typeof itemWork>['work']) => batches(w).filter(b => b.op === 'cutting').length
    expect(setups([...a, ...sameKind])).toBe(1)
    expect(setups([...a, ...otherThickness])).toBe(2)
  })
  it('серийность даёт экономию только на наладке, а не скидку на штуку', () => {
    const hours = (qty: number) => totalLabourH(requiredHours(itemWork(1, 0, { ...glass, quantity: qty, totalAreaNet: 0.5 * qty }).work, set).hours)
    const setupH = Object.values(requiredHours(itemWork(1, 0, glass).work, set).hours).reduce((s, x) => s + x!.setupH, 0)
    expect(hours(10)).toBeCloseTo(10 * (hours(1) - setupH) + setupH, 6)
  })
  it('чего нет в позиции — пробел, а не догадка', () => {
    expect(itemWork(1, 0, { ...glass, hasHoles: true }).gaps.map(g => g.what)).toContain('отверстия без количества')
    expect(itemWork(1, 0, { category: 'изделие', quantity: 1, bom: [] }).gaps).toHaveLength(1)
  })
  it('операция без нормы названа, машинные часы без машинной нормы — нет значения', () => {
    const r = requiredHours(itemWork(1, 0, { ...glass, shape: 'curved' }).work, set)
    expect(r.noNorm).toEqual(['curved'])
    expect(r.hours.cutting!.machineH).toBeNull()
  })
})

describe('мощность и штатные сценарии', () => {
  const plan: CapacityPlan = { id: 'c', version: 1, pools: [
    { id: 'cut', label: 'резка', ops: ['cutting'], hours: v(10) },
    { id: 'edge', label: 'кромка', ops: ['edge'], hours: v(10) },
  ] }
  const base: StaffScenario = { id: 'base', label: 'текущий', addHours: [], multiply: null, extraMonthlyCost: v(0) }
  const hours = { cutting: { labourH: 8, setupH: 0, machineH: null }, edge: { labourH: 15, setupH: 0, machineH: null } }
  it('узкое место и выполнимость', () => {
    const r = poolLoad(hours, plan, base)
    expect(r.bottleneck?.id).toBe('edge')
    expect(r.feasible).toBe('no')
  })
  it('второй полировщик добавляет часы только на кромке', () => {
    const r = poolLoad(hours, plan, { ...base, addHours: [{ poolId: 'edge', hours: 10 }] })
    expect(r.pools.map(p => p.availableH)).toEqual([10, 20])
    expect(r.feasible).toBe('yes')
  })
  it('вторая смена: частичная — выбранные участки, полная — все', () => {
    expect(poolLoad(hours, plan, { ...base, multiply: { poolIds: ['edge'], factor: 2 } }).pools.map(p => p.availableH)).toEqual([10, 20])
    expect(poolLoad(hours, plan, { ...base, multiply: { poolIds: 'all', factor: 2 } }).pools.map(p => p.availableH)).toEqual([20, 20])
  })
  it('работа без исполнителя не даёт сказать «помещается»', () => {
    const r = poolLoad({ ...hours, edge: { labourH: 1, setupH: 0, machineH: null }, film: { labourH: 2, setupH: 0, machineH: null } }, plan, base)
    expect(r.feasible).toBe('unknown')
    expect(r.unassigned).toEqual([{ op: 'film', requiredH: 2 }])
  })
})

describe('политика цены', () => {
  const input: FloorInput = {
    variable: v(500), allocatedFixed: v(200), bottleneckHours: 1,
    displacedPerBottleneckHour: v(900, 'hypothesis'), normsStatus: 'hypothesis', gaps: [],
  }
  it('три режима: свободная, нормальная, дефицит', () => {
    const [free, normal, deficit] = (['free', 'normal', 'deficit'] as const).map(m => recommend(m, input, {}))
    expect([free.suggested, free.minForDecision]).toEqual([700, 500])
    expect([normal.suggested, normal.minForDecision]).toEqual([700, 700])
    expect([deficit.suggested, deficit.minForDecision]).toEqual([1400, 1400])
  })
  it('рекомендация никогда не опускается ниже устойчивой границы', () => {
    const r = recommend('deficit', { ...input, displacedPerBottleneckHour: v(0, 'hypothesis') }, {})
    expect(r.suggested).toBe(r.floorSustainable)
  })
  it('без стоимости вытеснения в дефиците цены нет', () => {
    const r = recommend('deficit', { ...input, displacedPerBottleneckHour: v(null) }, {})
    expect([r.suggested, r.status]).toEqual([null, 'missing'])
  })
  it('пропуск во входах не даёт назвать расчёт измеренным', () => {
    const r = recommend('normal', { ...input, normsStatus: 'measured', gaps: ['нет значения: аренда'] }, {})
    expect([r.incomplete, r.status]).toEqual([['нет значения: аренда'], 'hypothesis'])
  })
  it('предварительная рекомендация не становится ценой сама', () => {
    const rec = recommend('normal', input, { norms: 'x' })
    expect(rec.kind).toBe('preliminary')
    const d = { priceExVat: 800, approvedBy: 'Руководитель', approvedAt: '2026-01-02' }
    expect(() => approvePrice(rec, d)).toThrow(/неподтверждённых/)
    expect(() => approvePrice(rec, { ...d, approvedBy: ' ', acknowledgedStatus: 'hypothesis' })).toThrow()
    expect(() => approvePrice(rec, { ...d, priceExVat: 600, acknowledgedStatus: 'hypothesis' })).toThrow(/причина/)
    const ok = approvePrice(rec, { ...d, acknowledgedStatus: 'hypothesis' })
    expect([ok.kind, ok.priceExVat, ok.basis.stamps.norms]).toEqual(['approved', 800, 'x'])
  })
  it('вытесняемый МД на час — перцентиль по заказам на узком месте', () => {
    expect(displacedRate([{ contribution: 100, bottleneckHours: 1 }, { contribution: 300, bottleneckHours: 1 }, { contribution: 200, bottleneckHours: 1 }, { contribution: 9, bottleneckHours: 0 }], 50)).toBe(200)
    expect(displacedRate([], 50)).toBeNull()
  })
})

describe('теневой режим не имеет пути к прайсу', () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []))
  it('модули экономики не ходят в базу и не вызывают расчёт цены', () => {
    for (const f of walk('lib/economics')) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/supabase|\.(insert|upsert|update|delete)\(|\bcalc(Item|Totals|FactoryMirror|FactoryLoft)\(|fetch\(/)
    }
  })
  it('приложение не импортирует модуль цен теневого режима', () => {
    const files = [...walk('app'), ...walk('components'), ...walk('lib').filter(f => !f.startsWith(join('lib', 'economics')))]
    expect(files.filter(f => /economics\/(pricing|capacity|standards|batching)/.test(readFileSync(f, 'utf8')))).toEqual([])
  })
})
