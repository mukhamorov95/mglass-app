import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { reader, referenceErrors, reviseReference, type Reference, type Param } from '@/lib/economics/engine/reference'
import { consumption, drillBand, type PartSpec, type TechProfile } from '@/lib/economics/engine/technology'
import { resourceRates, CENTERS } from '@/lib/economics/engine/rates'
import { orderCost, priceExVat, margin, targetPrice, VAT } from '@/lib/economics/engine/cost'
import { shopLoad, unused } from '@/lib/economics/engine/capacity'
import { point, type Range } from '@/lib/economics/classification/vat'

const num = (lo: number, hi = lo, extra: Partial<Param> = {}): Param =>
  ({ key: '', group: 'g', label: 'l', unit: 'u', lo, hi, status: 'hypothesis', source: 's', date: '2026-11-27', ...extra })
const ref = (params: Record<string, Param>): Reference =>
  ({ id: 'tech', version: 1, date: '2026-11-27', author: 'тест', reason: 'тест', changes: [],
    params: Object.entries(params).map(([key, p]) => ({ ...p, key })) })

const TECH = ref({
  'sheet.areaM2': num(7.2225), 'cut.minPerSheet': num(20), 'cut.partsPerSheet': num(9),
  'zm9.grind.6': num(2.5), 'zm9.polish.6': num(1.8), 'zm9.setupMin': num(10), 'zm9.operators': num(1),
  'jd22.sec.4-12.g1': num(25), 'jd22.sec.4-12.g2': num(30), 'jd22.sec.4-12.g3': num(40),
  'jd22.sec.4-12.g4': num(50), 'jd22.sec.4-12.g5': num(60), 'jd22.sec.13-25.g3': num(50), 'jd22.loadSecPerPart': num(30), 'jd22.mark.templateSec': num(15),
  'jd22.setupMin': num(35), 'jd22.group.6': num(3), 'jd22.maxDiameter': num(65), 'jd22.wear.4-12': num(4),
  'pack.minPerPart': num(2), 'mat.1.price': num(600, 600, { vat: 22 }), 'mat.1.waste': num(20),
  'temper.price.6': num(400, 400, { vat: 'none' }),
})
const FIN = ref({
  ...Object.fromEntries(CENTERS.flatMap(id => [
    [`fin.center.${id}.payroll`, num(60000, 60000, { vat: 'none' })], [`fin.center.${id}.hours`, num(100)],
    [`fin.center.${id}.areaM2`, num(20)], [`fin.center.${id}.electricity`, num(1000, 1000, { vat: 'none' })],
    [`fin.center.${id}.repair`, num(0, 0, { vat: 'none' })], [`fin.center.${id}.consumables`, num(0, 0, { vat: 'none' })],
  ])),
  'fin.center.edge.lease': num(50000, 50000, { vat: 'none', attrs: { lease: 1, endsOn: '2027-02-20' } }),
  'fin.center.temperingLogistics.payroll': num(10000, 10000, { vat: 'none' }),
  'fin.center.purchasing.payroll': num(10000, 10000, { vat: 'none' }),
  'fin.transport.cost.fuel': num(5000, 5000, { vat: 'none' }),
  'fin.overhead.waste': num(15000, 15000, { vat: 'none' }),
  'fin.admin.payroll': num(100000, 100000, { vat: 'none' }),
  'fin.admin.cost.bank': num(10000, 10000, { vat: 'none' }),
  'fin.payrollTaxes': num(0, 0, { vat: 'none' }), 'fin.rent.rate': num(1000, 1000, { vat: 'none' }),
  'fin.area.current': num(520), 'fin.area.target': num(400), 'fin.machine.practicalHours': num(156),
  'fin.commission.pct': num(1),
  'fin.scn.current.shifts': num(1, 1, { attrs: { title: 'Текущий' } }),
})
const R = reader(TECH, FIN)
const rates = resourceRates(R, { area: 'target', leases: 'active' })

const part = (p: Partial<PartSpec> = {}): PartSpec => ({
  key: 'p1', materialKey: '1', thicknessMm: 6, widthMm: 1000, heightMm: 500, qty: 1, shape: 'rect',
  edge: 'grind', holes: [], marking: 'template', cutouts: [], tempering: false, sandblast: null, packaging: true, ...p,
})
const run = (specs: PartSpec[], profile: TechProfile = 'detailed') => consumption(specs, reader(TECH, FIN), profile)

describe('справочник', () => {
  it('новая версия хранит прежнее значение, причину и не трогает старую', () => {
    const next = reviseReference(TECH, [{ key: 'cut.minPerSheet', lo: 15, hi: 15, status: 'measured', source: 'хронометраж, 20 листов' }],
      { reason: 'замер', author: 'цех', date: '2026-12-01' })
    expect(next.version).toBe(2)
    expect(next.changes[0].before.lo).toBe(20)
    expect(next.params.find(p => p.key === 'cut.minPerSheet')!.lo).toBe(15)
    expect(TECH.params.find(p => p.key === 'cut.minPerSheet')!.lo).toBe(20)
  })
  it('без причины и по неизвестному ключу не правится', () => {
    expect(() => reviseReference(TECH, [{ key: 'cut.minPerSheet', lo: 1, hi: 1, status: 'owner', source: 's' }], { reason: ' ', author: 'a', date: 'd' })).toThrow()
    expect(() => reviseReference(TECH, [{ key: 'нет.такого', lo: 1, hi: 1, status: 'owner', source: 's' }], { reason: 'r', author: 'a', date: 'd' })).toThrow()
  })
  it('«нет значения» нулём не подменяется, отрицательные и перевёрнутые диапазоны не принимаются', () => {
    expect(referenceErrors(ref({ a: num(0, 0, { status: 'missing' }) }))).toHaveLength(1)
    expect(referenceErrors(ref({ a: { ...num(5, 2) } }))).toHaveLength(1)
    expect(referenceErrors(ref({ a: num(1, 2, { source: '' }) }))).toHaveLength(1)
    expect(referenceErrors(ref({ a: { ...num(null as unknown as number, null as unknown as number), lo: null, hi: null, status: 'missing' } }))).toHaveLength(0)
  })
})

describe('подробные нормы', () => {
  it('пример переноса: 100 деталей, одно отверстие 40 с, шаблон = 176,67 мин', () => {
    const u = run([part({ qty: 100, widthMm: null, heightMm: null, edge: 'none', packaging: false, holes: [{ diameterMm: 10, perPart: 1 }] })])
    const drill = u.ops.find(o => o.op === 'drilling')!
    expect(drill.labourMin.lo + u.setups.find(s => s.op === 'drilling')!.labourMin.lo).toBeCloseTo(176.67, 1)
  })
  it('наладка партии начисляется один раз, а не на каждую деталь', () => {
    const one = run([part({ qty: 1, holes: [{ diameterMm: 10, perPart: 1 }] })])
    const many = run([part({ qty: 50, holes: [{ diameterMm: 10, perPart: 1 }] })])
    expect(one.setups.filter(s => s.op === 'drilling')).toHaveLength(1)
    expect(many.setups.filter(s => s.op === 'drilling')).toHaveLength(1)
    const per = (u: typeof one, qty: number) => (u.ops.find(o => o.op === 'drilling')!.labourMin.lo + u.setups.find(s => s.op === 'drilling')!.labourMin.lo) / qty
    expect(per(many, 50)).toBeLessThan(per(one, 1) / 10)
  })
  it('совместимые детали разных позиций делят одну наладку, несовместимые — нет', () => {
    const same = run([part({ key: 'a', holes: [{ diameterMm: 10, perPart: 1 }] }), part({ key: 'b', holes: [{ diameterMm: 10, perPart: 1 }] })])
    const other = run([part({ key: 'a', holes: [{ diameterMm: 10, perPart: 1 }] }), part({ key: 'b', holes: [{ diameterMm: 22, perPart: 1 }] })])
    expect(same.setups.filter(s => s.op === 'drilling')).toHaveLength(1)
    expect(other.setups.filter(s => s.op === 'drilling')).toHaveLength(2)
  })
  it('шлифовка и полировка считаются по своей скорости подачи, неизвестный тип даёт диапазон', () => {
    const g = run([part({ edge: 'grind' })]).ops.find(o => o.op === 'edge')!
    const p = run([part({ edge: 'polish' })]).ops.find(o => o.op === 'edge')!
    const u = run([part({ edge: 'unknown' })]).ops.find(o => o.op === 'edge')!
    expect(p.machineMin.lo).toBeGreaterThan(g.machineMin.lo)
    expect(u.machineMin).toEqual({ lo: g.machineMin.lo, hi: p.machineMin.hi })
  })
  it('время сверления зависит от диаметра и толщины, а не только от числа отверстий', () => {
    expect(drillBand(12)).toBe('4-12'); expect(drillBand(12.5)).toBe('13-25'); expect(drillBand(2)).toBeNull()
    const small = run([part({ holes: [{ diameterMm: 10, perPart: 1 }] })]).ops.find(o => o.op === 'drilling')!
    const unknownThk = run([part({ thicknessMm: null, holes: [{ diameterMm: 10, perPart: 1 }] })]).ops.find(o => o.op === 'drilling')!
    expect(unknownThk.labourMin.hi).toBeGreaterThan(small.labourMin.hi)
  })
  it('отверстие больше паспортного диаметра не считается молча', () => {
    const u = run([part({ holes: [{ diameterMm: 220, perPart: 1 }] })])
    expect(u.ops.some(o => o.op === 'drilling')).toBe(false)
    expect(u.missing.some(m => /паспортного диаметра/.test(m.what))).toBe(true)
  })
  it('машинные минуты не равны человеко-минутам', () => {
    const u = run([part({ holes: [{ diameterMm: 10, perPart: 1 }] })])
    const d = u.ops.find(o => o.op === 'drilling')!
    expect(d.machineMin.lo).toBeLessThan(d.labourMin.lo)
    expect(u.ops.find(o => o.op === 'packaging')!.machineMin).toEqual({ lo: 0, hi: 0 })
  })
  it('пропуски не заменяются нулём, грубый сценарий включается только явно', () => {
    const noSize = run([part({ widthMm: null, heightMm: null })])
    expect(noSize.ops.some(o => o.op === 'cutting')).toBe(false)
    expect(noSize.missing.some(m => /нет размеров/.test(m.what))).toBe(true)
    const uncounted = run([part({ holesUncounted: true })])
    expect(uncounted.missing.some(m => /отверстия отмечены без количества/.test(m.what))).toBe(true)
    const curved = run([part({ shape: 'curved' })])
    expect(curved.ops.some(o => o.op === 'curved')).toBe(false)
    expect(run([part({ shape: 'curved' })], 'with_coarse').missing.some(m => /подробной нормы нет/.test(m.what))).toBe(true)
  })
  it('слои пакета режутся каждый, упаковывается изделие', () => {
    const u = run([part({ layers: 2 })])
    expect(u.ops.find(o => o.op === 'cutting')!.parts).toBe(2)
    expect(u.ops.find(o => o.op === 'packaging')!.parts).toBe(1)
  })
})

describe('ставки ресурсов', () => {
  it('сумма статей сходится с платёжной нагрузкой, а лизинг снимается по сценариям', () => {
    const a = resourceRates(reader(TECH, FIN), { area: 'target', leases: 'active' })
    const after = resourceRates(reader(TECH, FIN), { area: 'target', leases: 'afterEnd' })
    const none = resourceRates(reader(TECH, FIN), { area: 'target', leases: 'none' })
    expect(a.grossTotal.lo).toBeCloseTo(a.total.lo, 6)
    expect(after.total.lo).toBeCloseTo(a.total.lo - 50000, 6)
    expect(none.total.lo).toBeCloseTo(a.total.lo - 50000, 6)
  })
  it('участок со станком несёт площадь в станко-минуту, без станка — в человеко-минуту', () => {
    const edge = rates.centers.find(c => c.id === 'edge')!, pack = rates.centers.find(c => c.id === 'packaging')!
    expect(edge.machineRate!.lo).toBeGreaterThan(0)
    expect(pack.machineRate).toBeNull()
    expect(pack.labourRate.lo).toBeCloseTo((pack.labourMonth.lo + pack.siteMonth.lo) / pack.labourPracticalMin, 6)
    expect(edge.labourRate.lo).toBeCloseTo(edge.labourMonth.lo / edge.labourPracticalMin, 6)
  })
  it('неподтверждённая ставка НДС даёт диапазон, а не одно число', () => {
    const vague = ref({ ...Object.fromEntries(FIN.params.map(p => [p.key, p])), 'fin.overhead.waste': num(12200, 12200, { vat: 22, vatConfirmed: false }) })
    const r = resourceRates(reader(TECH, vague), { area: 'target', leases: 'active' })
    expect(r.total.hi - r.total.lo).toBeCloseTo(12200 - 10000, 0)
  })
})

describe('себестоимость и цена', () => {
  const cost = (specs: PartSpec[], direct: { label: string; cost: Range }[] = []) =>
    orderCost({ consumption: run(specs), direct, rates, commission: point(0.01) })
  it('переменные, ресурсы, расходники и слои не накладываются друг на друга', () => {
    const c = cost([part()], [{ label: 'стекло', cost: point(1000) }])
    expect(c.full.lo).toBeCloseTo(c.variable.lo + c.resource.lo + c.consumables.lo + c.overhead.lo, 6)
    expect(c.sustainable.lo).toBeCloseTo(c.full.lo + c.admin.lo, 6)
  })
  it('расходник по драйверу начисляется на операцию и не сидит в ставке участка', () => {
    const byDriver = ref({ ...Object.fromEntries(FIN.params.map(p => [p.key, p])),
      'fin.center.drilling.consumables': num(4000, 4000, { vat: 'none', attrs: { byDriver: 1 } }) })
    const r = resourceRates(reader(TECH, byDriver), { area: 'target', leases: 'active' })
    const plain = resourceRates(reader(TECH, ref({ ...Object.fromEntries(FIN.params.map(p => [p.key, p])),
      'fin.center.drilling.consumables': num(4000, 4000, { vat: 'none' }) })), { area: 'target', leases: 'active' })
    const site = (x: typeof r) => x.centers.find(c => c.id === 'drilling')!.siteMonth.lo
    expect(site(plain) - site(r)).toBeCloseTo(4000, 6)
    expect(r.total.lo).toBeCloseTo(plain.total.lo, 6)   // статья осталась в расходах месяца
    const c = orderCost({ consumption: run([part({ qty: 10, holes: [{ diameterMm: 10, perPart: 2 }] })]), direct: [], rates: r, commission: point(0) })
    expect(c.consumables.lo).toBeCloseTo(20 * 4, 6)
  })
  it('комиссия входит в цену делением, а не наценкой', () => {
    const p = priceExVat(point(1000), point(0.01)).lo
    expect(p * (1 + VAT / 100) * 0.01).toBeCloseTo(p - 1000, 6)
  })
  it('МД считается от переменных, не от полной себестоимости; на час узкого места показан, когда часы есть', () => {
    const c = cost([part()], [{ label: 'стекло', cost: point(1000) }])
    const m = margin(c, 10000, point(0.01))
    expect(m.md.hi).toBeCloseTo(10000 - 1000 - 10000 * 1.22 * 0.01, 6)
    expect(m.mdPerBottleneckH!.hi).toBeGreaterThan(0)
  })
  it('рекомендованная цена появляется только с целью владельца по МД на час', () => {
    const c = cost([part()], [{ label: 'стекло', cost: point(1000) }])
    expect(targetPrice(c, 0, point(0.01))).toBeNull()
    expect(targetPrice(c, 3000, point(0.01))!.lo).toBeGreaterThan(c.floors.variable.lo)
  })
  it('серия дешевле штуки, но граница цены партии не ниже переменных', () => {
    const one = cost([part({ qty: 1, holes: [{ diameterMm: 10, perPart: 1 }] })], [{ label: 'м', cost: point(100) }])
    const fifty = cost([part({ qty: 50, holes: [{ diameterMm: 10, perPart: 1 }] })], [{ label: 'м', cost: point(5000) }])
    expect(fifty.floors.production.lo / 50).toBeLessThan(one.floors.production.lo)
    expect(fifty.floors.production.lo).toBeGreaterThan(fifty.variable.lo)
  })
})

describe('мощность', () => {
  const uses = [orderCost({ consumption: run([part({ qty: 200 })]), direct: [], rates, commission: point(0) }).uses]
  it('люди и станки загружаются раздельно, смены удваивают оба фонда', () => {
    const one = shopLoad(uses, rates, { id: 'a', label: 'a', shifts: 1, labourHours: {}, extraMonthly: null })
    const two = shopLoad(uses, rates, { id: 'b', label: 'b', shifts: 2, labourHours: {}, extraMonthly: null })
    const at = (l: typeof one, id: string, kind: string) => l.loads.find(x => x.id === id && x.kind === kind)!
    expect(at(one, 'edge', 'labour').availableH).toBe(100)
    expect(at(two, 'edge', 'machine').availableH).toBe(312)
    expect(at(two, 'edge', 'labour').utilization!.hi).toBeCloseTo(at(one, 'edge', 'labour').utilization!.hi / 2, 6)
  })
  it('добавленный человек не добавляет станко-часов', () => {
    const base = shopLoad(uses, rates, { id: 'a', label: 'a', shifts: 1, labourHours: {}, extraMonthly: null })
    const more = shopLoad(uses, rates, { id: 'b', label: 'b', shifts: 1, labourHours: { edge: 300 }, extraMonthly: null })
    const m = (l: typeof base) => l.loads.find(x => x.id === 'edge' && x.kind === 'machine')!.availableH
    expect(m(more)).toBe(m(base))
    expect(more.loads.find(x => x.id === 'edge' && x.kind === 'labour')!.availableH).toBe(300)
  })
  it('неиспользованная мощность = стоимость участков минус отнесённое', () => {
    const u = unused(uses, rates)
    const edge = u.find(x => x.id === 'edge')!
    expect(edge.unused.hi).toBeCloseTo(edge.cost.hi - edge.used.lo, 6)
    expect(u.find(x => x.id === 'welding')!.used).toEqual({ lo: 0, hi: 0 })
  })
})

describe('границы данных', () => {
  const read = (p: string) => readFileSync(p, 'utf8')
  it('окладов и закрытых сумм нет ни в коде движка, ни в открытом справочнике', () => {
    const files = readdirSync('lib/economics/engine').map(f => read(`lib/economics/engine/${f}`)).join('\n') + read('docs/economics/reference/tech.v1.json')
    expect(files).not.toMatch(/\b(130000|160000|140000|700000|225000|110000)\b/)
    expect(files).not.toMatch(/Эльзат|Адилет|Никита|Слава|Сергей|Вера|Нуржан|Дмитрий/)
  })
  it('движок не ходит в базу и не считает цену клиенту', () => {
    const files = readdirSync('lib/economics/engine').map(f => read(`lib/economics/engine/${f}`)).join('\n')
    expect(files).not.toMatch(/supabase|createClient|fetch\(|calcItem|computeQuoteItem/)
  })
  it('закрытый справочник не лежит в открытой папке и не добавлен в git', () => {
    // В открытой папке лежат только версии технического справочника: финансовый — в private/.
    expect(readdirSync('docs/economics/reference').filter(f => !/^tech\.v\d+\.json$/.test(f))).toEqual([])
    expect(read('.gitignore')).toMatch(/docs\/economics/)
  })
})
