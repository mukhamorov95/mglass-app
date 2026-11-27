import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { referenceStamp, type Param, type Reference } from '@/lib/economics/engine/reference'
import { CENTERS } from '@/lib/economics/engine/rates'
import { labQuote } from '@/lib/economics/lab/quote'
import { priceScenarios } from '@/lib/economics/lab/pricing'
import { applyOverrides } from '@/lib/economics/lab/overrides'
import { DEFAULT_SCENARIO, emptyPosition, projectErrors, edgeMetresPerPart, type LabPosition, type LabProject } from '@/lib/economics/lab/project'
import { legacyModel } from '@/lib/economics/lab/compare'
import { DEFAULT_B2B_RATES } from '@/lib/b2b/rates'
import type { B2BMaterial } from '@/lib/types'

// Все числа здесь выдуманы для проверки формул: настоящие нормы, закупочные цены и ставки
// в публичный репозиторий не попадают (они в справочниках вне git). Контрольные примеры ТЗ
// на настоящем справочнике считает docs/economics/tools/lab-controls.ts.
const num = (lo: number, hi = lo, extra: Partial<Param> = {}): Param =>
  ({ key: '', group: 'g', label: 'l', unit: 'u', lo, hi, status: 'hypothesis', source: 's', date: '2026-11-27', ...extra })
const ref = (id: 'tech' | 'finance', params: Record<string, Param>): Reference =>
  ({ id, version: 1, date: '2026-11-27', author: 'тест', reason: 'тест', changes: [],
    params: Object.entries(params).map(([key, p]) => ({ ...p, key })) })

const TECH = ref('tech', {
  'sheet.areaM2': num(7.2225), 'cut.minPerSheet': num(20), 'cut.partsPerSheet': num(9),
  'zm9.grind.5': num(2.8), 'zm9.polish.5': num(1.8), 'zm9.operators': num(1),
  'jd22.sec.41-60.g1': num(50), 'jd22.sec.41-60.g2': num(65), 'jd22.loadSecPerPart': num(30),
  'jd22.mark.templateSec': num(15), 'jd22.setupMin': num(35), 'jd22.group.5': num(1),
  'jd22.maxDiameter': num(65), 'jd22.wear.41-60': num(15),
  'jym.cut.angle': num(6.5), 'jym.thk.5': num(1), 'jym.setupMin': num(15), 'jym.loadMin': num(2),
  'jym.unloadMin': num(1), 'jym.controlMin': num(1), 'jym.markMin': num(1),
  'pack.minPerPart': num(2), 'glass.kgPerM2PerMm': num(2.5),
  'mat.1.price': num(500, 500, { vat: 22, label: 'Стекло тестовое 5 мм' }), 'mat.1.waste': num(20),
  'temper.price.5': num(300, 300, { vat: 'none' }),
})
const FIN = ref('finance', {
  ...Object.fromEntries(CENTERS.flatMap(id => [
    [`fin.center.${id}.payroll`, num(60000, 60000, { vat: 'none' })], [`fin.center.${id}.hours`, num(100)],
    [`fin.center.${id}.areaM2`, num(20)], [`fin.center.${id}.electricity`, num(1000, 1000, { vat: 'none' })],
    [`fin.center.${id}.repair`, num(0, 0, { vat: 'none' })], [`fin.center.${id}.consumables`, num(0, 0, { vat: 'none' })],
  ])),
  'fin.center.temperingLogistics.payroll': num(10000, 10000, { vat: 'none' }),
  'fin.center.purchasing.payroll': num(10000, 10000, { vat: 'none' }),
  'fin.overhead.waste': num(15000, 15000, { vat: 'none' }),
  'fin.admin.payroll': num(100000, 100000, { vat: 'none' }),
  'fin.payrollTaxes': num(0, 0, { vat: 'none' }), 'fin.rent.rate': num(1000, 1000, { vat: 'none' }),
  'fin.area.current': num(520), 'fin.area.target': num(400), 'fin.machine.practicalHours': num(156),
  'fin.commission.pct': num(0),
})

const pos = (p: Partial<LabPosition> = {}): LabPosition => ({
  ...emptyPosition('p1'), materialId: 1, thicknessMm: 5, widthMm: 1000, heightMm: 680, qty: 200,
  edge: 'grind', marking: 'template', packaging: false, ...p,
})
const project = (p: Partial<LabProject> = {}): LabProject => ({
  title: 'тест', note: '', scenario: { ...DEFAULT_SCENARIO }, overrides: [], positions: [pos()], ...p,
})
const quote = (p: LabProject, finance: Reference | null = FIN) =>
  labQuote({ project: p, tech: TECH, finance, now: '2026-11-27T00:00:00.000Z' })

describe('расход материала: три режима', () => {
  it('целые листы — по размещению деталей, а не делением площади', () => {
    const q = quote(project({ positions: [pos({ material: { kind: 'sheets', partsPerSheet: 9 } })] }))
    const v = q.positions[0]
    expect(v.netM2).toBeCloseTo(136, 6)
    expect(v.sheets!.lo).toBe(23)                       // 200 ÷ 9 = 22,2 → 23, а не 136 ÷ 7,2225 = 18,8
    expect(v.usedM2!.lo).toBeCloseTo(166.1175, 4)
  })
  it('без размещения деталей расход целыми листами не считается и попадает в неучтённое', () => {
    const q = quote(project({ positions: [pos({ material: { kind: 'sheets', partsPerSheet: null } })] }))
    expect(q.positions[0].usedM2).toBeNull()
    expect(q.missing.some(m => /не задано, сколько деталей размещается/.test(m.what))).toBe(true)
    expect(q.money!.levels.h0.hi).toBe(0)               // материал не посчитан, а не посчитан нулём
  })
  it('коэффициент использования — не надбавка на отход', () => {
    const k = quote(project({ positions: [pos({ material: { kind: 'utilization', coefficient: 0.75 } })] }))
    const w = quote(project({ positions: [pos({ material: { kind: 'utilization', coefficient: null } })] }))
    expect(k.positions[0].usedM2!.lo).toBeCloseTo(136 / 0.75, 4)
    expect(w.positions[0].usedM2!.lo).toBeCloseTo(136 * 1.2, 4)
    expect(w.missing.some(m => /взята надбавка на отход/.test(m.what))).toBe(true)
  })
  it('процент вместо доли в коэффициенте не принимается', () => {
    const e = projectErrors(project({ positions: [pos({ material: { kind: 'utilization', coefficient: 25 } })] }))
    expect(e.some(x => /коэффициент использования/.test(x))).toBe(true)
  })
  it('ручной расход берётся как введён', () => {
    const q = quote(project({ positions: [pos({ material: { kind: 'manual', m2: 150 } })] }))
    expect(q.positions[0].usedM2!.hi).toBe(150)
  })
  it('без права на вычет входной НДС остаётся в стоимости материала', () => {
    const base = project({ positions: [pos({ material: { kind: 'manual', m2: 100 } })] })
    const withVat = quote({ ...base, scenario: { ...base.scenario, deductInputVat: false } })
    const exVat = quote(base)
    expect(withVat.money!.levels.h0.lo).toBeCloseTo(50_000, 2)
    expect(exVat.money!.levels.h0.lo).toBeCloseTo(50_000 / 1.22, 2)
  })
  it('вес партии считается по толщине и количеству', () => {
    const q = quote(project())
    expect(q.positions[0].weightKg).toBeCloseTo(136 * 5 * 2.5, 4)
  })
})

describe('операции идут по тем же листам и той же длине обработки', () => {
  it('резка считается по листам режима расхода', () => {
    const q = quote(project({ positions: [pos({ material: { kind: 'sheets', partsPerSheet: 9 } })] }))
    const cut = q.operations.find(o => o.op === 'cutting')!
    expect(cut.labourMin.lo).toBeCloseTo(460, 6)       // 23 листа × 20 мин
    expect(cut.labourMin.hi).toBeCloseTo(460, 6)
  })
  it('кромка — по скорости подачи на заданную длину', () => {
    const q = quote(project())
    const edge = q.operations.find(o => o.op === 'edge')!
    expect(edge.qty).toBeCloseTo(672, 6)               // периметр 3,36 м × 200
    expect(edge.labourMin.lo).toBeCloseTo(240, 6)      // 672 ÷ 2,8 м/мин
  })
  it('число сторон и прямая длина обработки меняют метры', () => {
    expect(edgeMetresPerPart(pos({ edgeSides: 4 }))).toBeCloseTo(3.36, 6)
    expect(edgeMetresPerPart(pos({ edgeSides: 2 }))).toBeCloseTo(1.68, 6)
    expect(edgeMetresPerPart(pos({ edgeSides: 1 }))).toBeCloseTo(1, 6)
    expect(edgeMetresPerPart(pos({ edgeSides: 2, edgeLengthM: 0.5 }))).toBe(0.5)
    const q = quote(project({ positions: [pos({ edgeSides: 2 })] }))
    expect(q.operations.find(o => o.op === 'edge')!.labourMin.lo).toBeCloseTo(336 / 2.8, 6)
  })
  it('наладка партии одна на все детали', () => {
    const q = quote(project({ positions: [pos({ holes: [{ diameterMm: 60, perPart: 1 }] })] }))
    expect(q.setups.filter(s => s.op === 'drilling')).toHaveLength(1)
    expect(q.totals.setupMin.lo).toBe(35)
  })
})

describe('вырезы: оборудование названо явно', () => {
  const cut = (equipment: 'jym' | 'manual' | 'unknown') =>
    quote(project({ positions: [pos({ qty: 10, edge: 'none', cutouts: [{ type: 'angle', perPart: 1, equipment }] })] }))
  it('ручной инструмент станко-минут не занимает, станок занимает, неизвестное даёт диапазон', () => {
    const manual = cut('manual').operations.find(o => o.op === 'cutout')!
    const jym = cut('jym').operations.find(o => o.op === 'cutout')!
    const unknown = cut('unknown').operations.find(o => o.op === 'cutout')!
    expect(manual.machineMin.hi).toBeCloseTo(jym.machineMin.hi - 65, 6)   // без времени самих вырезов
    expect(unknown.machineMin.lo).toBeLessThan(unknown.machineMin.hi)
    expect(cut('unknown').missing.some(m => /какие вырезы делает JYM-1/.test(m.what))).toBe(true)
    expect(cut('manual').missing.some(m => /какие вырезы делает JYM-1/.test(m.what))).toBe(false)
  })
})

describe('уровни себестоимости и цены', () => {
  it('H0 < H1 < H2 и ни один слой не повторяется', () => {
    const q = quote(project())
    const m = q.money!
    expect(m.levels.h0.lo).toBeLessThan(m.levels.h1.lo)
    expect(m.levels.h1.lo).toBeLessThan(m.levels.h2.lo)
    expect(m.levels.h1.lo).toBeCloseTo(m.levels.h0.lo + m.resource.lo + m.consumables.lo + m.overhead.lo, 6)
    expect(m.levels.h2.lo).toBeCloseTo(m.levels.h1.lo + m.admin.lo, 6)
  })
  it('цена сценария А покрывает переменные, Б — полную, и обе делятся на положительный знаменатель', () => {
    const s = priceScenarios({ variable: { lo: 100, hi: 100 }, full: { lo: 200, hi: 200 }, vatRatePct: 22, commissionPct: 0, targetMarginPct: null, targetMdPerHour: null, bottleneck: null })
    expect(s.find(x => x.id === 'A')!.incVat!.lo).toBeCloseTo(122, 6)
    expect(s.find(x => x.id === 'B')!.incVat!.lo).toBeCloseTo(244, 6)
    expect(s.find(x => x.id === 'A')!.exVat!.lo).toBeCloseTo(100, 6)
  })
  it('комиссия входит в знаменатель, а не вычитается после', () => {
    const s = priceScenarios({ variable: { lo: 100, hi: 100 }, full: { lo: 100, hi: 100 }, vatRatePct: 22, commissionPct: 10, targetMarginPct: null, targetMdPerHour: null, bottleneck: null })
    const p = s.find(x => x.id === 'A')!.incVat!.lo
    expect(p).toBeCloseTo(100 / (1 / 1.22 - 0.1), 6)
    expect(p / 1.22 - p * 0.1).toBeCloseTo(100, 6)      // выручка без НДС минус комиссия = переменные
  })
  it('невозможная комиссия и маржа дают «нет решения», а не отрицательную цену', () => {
    const s = priceScenarios({ variable: { lo: 100, hi: 100 }, full: { lo: 100, hi: 100 }, vatRatePct: 22, commissionPct: 90, targetMarginPct: 95, targetMdPerHour: null, bottleneck: null })
    expect(s.find(x => x.id === 'A')!.incVat).toBeNull()
    expect(s.find(x => x.id === 'A')!.why).toMatch(/знаменатель/)
  })
  it('без цели владельца сценарии В и Г цены не дают', () => {
    const q = quote(project())
    const s = q.money!.prices
    expect(s.find(x => x.id === 'C')!.why).toMatch(/целевая доля/)
    expect(s.find(x => x.id === 'D')!.why).toMatch(/целевой МД на час/)
  })
  it('с целью по МД на час цена сценария Г выше переменной границы', () => {
    const p = project()
    const q = quote({ ...p, scenario: { ...p.scenario, targetMdPerHour: 5000 } })
    const d = q.money!.prices.find(x => x.id === 'D')!
    expect(d.incVat!.lo).toBeGreaterThan(q.money!.prices.find(x => x.id === 'A')!.incVat!.lo)
    expect(d.formula).toMatch(/ресурс/)
  })
})

describe('без финансового справочника деньги не выдумываются', () => {
  it('минуты есть, денег нет, и сказано почему', () => {
    const q = quote(project(), null)
    expect(q.money).toBeNull()
    expect(q.moneyWhy).toMatch(/финансовый справочник/)
    expect(q.totals.labourMin.lo).toBeGreaterThan(0)
    expect(q.positions[0].netM2).toBeCloseTo(136, 6)
  })
})

describe('правка норматива внутри проекта', () => {
  it('меняет отпечаток и статус, не затрагивая справочник', () => {
    const applied = applyOverrides(TECH, [{ key: 'cut.minPerSheet', lo: 30, hi: 30, note: 'мелкие детали' }])
    expect(referenceStamp(applied.ref)).not.toBe(referenceStamp(TECH))
    expect(applied.ref.params.find(p => p.key === 'cut.minPerSheet')!.status).toBe('owner')
    expect(TECH.params.find(p => p.key === 'cut.minPerSheet')!.lo).toBe(20)
  })
  it('правка влияет на расчёт, а неизвестный ключ — на ошибки', () => {
    const base = quote(project({ positions: [pos({ material: { kind: 'sheets', partsPerSheet: 9 } })] }))
    const p = project({ positions: [pos({ material: { kind: 'sheets', partsPerSheet: 9 } })], overrides: [{ key: 'cut.minPerSheet', lo: 30, hi: 30, note: 'мелкие' }] })
    const changed = quote(p)
    expect(changed.operations.find(o => o.op === 'cutting')!.labourMin.lo).toBeCloseTo(690, 6)
    expect(base.operations.find(o => o.op === 'cutting')!.labourMin.lo).toBeCloseTo(460, 6)
    expect(quote(project({ overrides: [{ key: 'нет.такого', lo: 1, hi: 1, note: '' }] })).errors.some(e => /нет параметра/.test(e))).toBe(true)
  })
})

describe('серийность', () => {
  it('себестоимость единицы падает с количеством, наладка начисляется один раз', () => {
    const q = quote(project({ positions: [pos({ qty: 1, holes: [{ diameterMm: 60, perPart: 1 }] })] }))
    const rows = q.series!.rows
    const one = rows.find(r => r.qty === 1)!, many = rows.find(r => r.qty === 200)!
    expect(one.perUnit!.lo).toBeGreaterThan(many.perUnit!.lo)
    expect(one.setupMin.lo).toBe(many.setupMin.lo)
    expect(many.batch!.lo).toBeGreaterThan(one.batch!.lo)
    expect(rows.map(r => r.qty)).toEqual([1, 5, 10, 20, 50, 100, 200])
  })
})

describe('сравнение с действующей моделью', () => {
  const material: B2BMaterial = {
    id: 1, name: 'Стекло тестовое', category: 'стекло', thickness: 5, cost_price: 500, sale_price: 1200,
    vat_rate: 22, waste_percent: 20, active: true, passthrough: false, notes: null, created_at: '',
    sheet_width: 3210, sheet_height: 2250, pattern_direction: 'any' as never,
  }
  it('действующий калькулятор считает по своим ставкам, отсутствующее не становится нулём', () => {
    const legacy = legacyModel([pos()], [material], DEFAULT_B2B_RATES)
    expect(legacy.positions[0].ok).toBe(true)
    expect(legacy.totals.costMaterial).toBeGreaterThan(0)
    expect(legacy.absent.some(a => /Резка/.test(a))).toBe(true)
    const q = labQuote({ project: project(), tech: TECH, finance: FIN, legacy, now: '2026-11-27T00:00:00.000Z' })
    const rows = q.money!.legacyCompare!
    expect(rows.find(r => r.label === 'Резка')!.legacy).toBeNull()
    expect(rows.find(r => /Материалы/.test(r.label))!.legacy).toBeGreaterThan(0)
    expect(rows.find(r => /Материалы/.test(r.label))!.lab!.lo).toBeGreaterThan(0)
  })
  it('материал не из справочника не считается нулём', () => {
    const legacy = legacyModel([pos({ materialId: 999 })], [material], DEFAULT_B2B_RATES)
    expect(legacy.positions[0].ok).toBe(false)
    expect(legacy.positions[0].why).toMatch(/материал/)
  })
})

describe('отпечаток справочника', () => {
  it('не зависит от порядка ключей: файл и json из базы дают один отпечаток', () => {
    // jsonb базы возвращает объект с другим порядком ключей — воспроизводим его сортировкой.
    const sortKeys = (x: unknown): unknown => Array.isArray(x) ? x.map(sortKeys)
      : x && typeof x === 'object'
        ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? 1 : -1)).map(([k, v]) => [k, sortKeys(v)]))
        : x
    expect(referenceStamp(sortKeys(TECH) as Reference)).toBe(referenceStamp(TECH))
    const reordered: Reference = { ...TECH, params: TECH.params.map(x => ({ unit: x.unit, hi: x.hi, key: x.key, lo: x.lo, status: x.status, group: x.group, label: x.label, source: x.source, date: x.date, ...(x.vat !== undefined ? { vat: x.vat } : {}) })) }
    expect(referenceStamp(reordered)).toBe(referenceStamp(TECH))
  })
  it('изменение значения отпечаток меняет', () => {
    const changed: Reference = { ...TECH, params: TECH.params.map(x => (x.key === 'cut.minPerSheet' ? { ...x, lo: 21 } : x)) }
    expect(referenceStamp(changed)).not.toBe(referenceStamp(TECH))
  })
})

describe('границы лаборатории', () => {
  const read = (p: string) => readFileSync(p, 'utf8')
  const files = ['project.ts', 'material.ts', 'pricing.ts', 'quote.ts', 'overrides.ts', 'compare.ts']
    .map(f => read(`lib/economics/lab/${f}`)).join('\n')
  it('расчёт не трогает CRM, заказы и базу', () => {
    expect(files).not.toMatch(/amocrm|supabase|b2b_orders|insert\(|update\(/)
  })
  it('в репозитории нет справочников с нормами и закупочными ценами', () => {
    expect(() => read('lib/economics/reference/tech.v2.json')).toThrow()
  })
  it('в коде лаборатории нет окладов и имён', () => {
    expect(files).not.toMatch(/payroll['"]?\s*[:=]\s*\d{5,}/)
  })
})
