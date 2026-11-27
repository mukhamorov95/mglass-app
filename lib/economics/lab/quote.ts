import { plus, point, times, ZERO, type Range } from '../classification/vat'
import { STATUS_LABEL, type Status } from '../values'
import { reader, referenceStamp, type Reference } from '../engine/reference'
import { consumption, minutesByCenter, CENTER_LABEL, MACHINE_LABEL, OP_LABEL, type CenterId, type Missing, type OpLine, type Setup } from '../engine/technology'
import { resourceRates } from '../engine/rates'
import { orderCost, type DirectLine, type OrderCost } from '../engine/cost'
import { labDirect, type MaterialUse } from './material'
import { priceScenarios, type PriceScenario } from './pricing'
import { applyOverrides, unknownOverrideKeys } from './overrides'
import { areaM2, layersOf, perimeterM, edgeMetresPerPart, toSpec, type LabPosition, type LabProject } from './project'
import type { Legacy } from './compare'

// Один расчёт экспериментального проекта. Деньги появляются только при загруженном финансовом
// справочнике: без него считаются материал, операции и минуты, а ставки, границы и цены —
// «нет значения». Нулём ничего не подменяется.
export type LabPositionView = {
  id: string
  label: string
  qty: number
  layers: number
  areaPieceM2: number
  netM2: number
  usedM2: Range | null
  sheets: Range | null
  weightKg: number
  perimeterM: number
  edgeMetresPerPart: number | null
  materialMode: string
  materialNote: string
}

export type CenterMinutes = {
  id: CenterId
  label: string
  machine: string | null
  labourMin: Range
  setupMin: Range
  machineMin: Range
  labourCost: Range | null
  machineCost: Range | null
  labourShare: Range | null
  machineShare: Range | null
}

export type LabMoney = {
  levels: { h0: Range; h1: Range; h2: Range }
  resource: Range
  consumables: Range
  setupCost: Range
  overhead: Range
  admin: Range
  direct: DirectLine[]
  bottleneck: OrderCost['bottleneck']
  prices: PriceScenario[]
  cash: { monthlyGross: Range; monthlyExVat: Range; perPrice: { id: string; md: Range | null; ordersPerMonth: Range | null }[] }
  legacyCompare: ComparisonRow[] | null
}

export type ComparisonRow = { label: string; legacy: number | null; lab: Range | null; note?: string }

const nf = (x: number) => Math.round(x * 100) / 100

export type SeriesRow = {
  qty: number
  batch: Range | null
  perUnit: Range | null
  setupMin: Range
  materialM2: Range | null
  labourMin: Range
  priceB: Range | null
}

export type LabQuote = {
  computedAt: string
  stamps: { tech: string; finance: string | null }
  status: Status
  statusLabel: string
  scenario: LabProject['scenario']
  positions: LabPositionView[]
  operations: (OpLine & { centerLabel: string; opLabel: string })[]
  setups: (Setup & { centerLabel: string; opLabel: string })[]
  minutes: CenterMinutes[]
  totals: { labourMin: Range; machineMin: Range; setupMin: Range }
  money: LabMoney | null
  moneyWhy: string | null
  series: { positionId: string; rows: SeriesRow[] } | null
  missing: Missing[]
  errors: string[]
}

const SERIES_QTY = [1, 5, 10, 20, 50, 100, 200]

export function labQuote(args: {
  project: LabProject
  tech: Reference
  finance: Reference | null
  legacy?: Legacy | null
  now?: string
  withSeries?: boolean
}): LabQuote {
  const { project } = args
  const errors = unknownOverrideKeys([args.tech, ...(args.finance ? [args.finance] : [])], project.overrides)
    .map(k => `правка проекта: в справочниках нет параметра ${k}`)

  const techApplied = applyOverrides(args.tech, project.overrides)
  const finApplied = args.finance ? applyOverrides(args.finance, project.overrides) : null
  errors.push(...techApplied.errors, ...(finApplied?.errors ?? []))

  const tech = techApplied.ref
  const fin = finApplied?.ref ?? null
  const ref = reader(...[tech, ...(fin ? [fin] : [])])

  const { lines, missing: directMissing, uses } = labDirect(project.positions, ref, { deductInputVat: project.scenario.deductInputVat })
  const specs = project.positions.map(p => toSpec(p, uses.find(u => u.positionId === p.id)?.sheets ?? null))
  const u = consumption(specs, ref, project.scenario.profile)

  const mins = minutesByCenter(u)
  const rates = fin ? resourceRates(ref, { area: project.scenario.area, leases: project.scenario.leases }) : null
  const cost = rates ? orderCost({
    consumption: u, direct: lines, directMissing, rates,
    commission: point(project.scenario.commissionPct / 100), shifts: project.scenario.shifts,
  }) : null

  const minutes: CenterMinutes[] = (Object.keys(mins) as CenterId[]).map(id => {
    const m = mins[id]!
    const use = cost?.uses.find(x => x.id === id) ?? null
    return {
      id, label: CENTER_LABEL[id], machine: MACHINE_LABEL[id] ?? null,
      labourMin: m.labour, setupMin: m.setupLabour, machineMin: MACHINE_LABEL[id] ? m.machine : ZERO,
      labourCost: use?.labourCost ?? null, machineCost: use?.machineCost ?? null,
      labourShare: use?.labourShare ?? null, machineShare: use?.machineShare ?? null,
    }
  })

  const positions: LabPositionView[] = project.positions.map(p => {
    const mu = uses.find(x => x.positionId === p.id) as MaterialUse | undefined
    return {
      id: p.id, label: positionLabel(p), qty: p.qty, layers: layersOf(p),
      areaPieceM2: areaM2(p), netM2: mu?.netM2 ?? 0, usedM2: mu?.usedM2 ?? null, sheets: mu?.sheets ?? null,
      weightKg: mu?.weightKg ?? 0, perimeterM: perimeterM(p), edgeMetresPerPart: edgeMetresPerPart(p),
      materialMode: mu?.mode ?? 'не посчитан', materialNote: mu?.note ?? '',
    }
  })

  const prices = cost ? priceScenarios({
    variable: cost.variable, full: cost.full,
    vatRatePct: project.scenario.vatRatePct, commissionPct: project.scenario.commissionPct,
    targetMarginPct: project.scenario.targetMarginPct, targetMdPerHour: project.scenario.targetMdPerHour,
    bottleneck: cost.bottleneck,
  }) : []
  const priceB = prices.find(x => x.id === 'B')?.incVat ?? null

  const money: LabMoney | null = cost && rates ? {
    levels: { h0: cost.variable, h1: cost.full, h2: cost.sustainable },
    resource: cost.resource, consumables: cost.consumables, setupCost: cost.setupCost,
    overhead: cost.overhead, admin: cost.admin, direct: cost.direct, bottleneck: cost.bottleneck,
    prices,
    cash: cashBlock(cost, rates, project, prices),
    legacyCompare: args.legacy ? comparison(args.legacy, cost, project, priceB) : null,
  } : null

  const total = (f: (x: CenterMinutes) => Range) => plus(...minutes.map(f))
  return {
    computedAt: args.now ?? new Date().toISOString(),
    stamps: { tech: referenceStamp(tech), finance: fin ? referenceStamp(fin) : null },
    status: ref.status(), statusLabel: STATUS_LABEL[ref.status()],
    scenario: project.scenario,
    positions,
    operations: u.ops.map(o => ({ ...o, centerLabel: CENTER_LABEL[o.center], opLabel: OP_LABEL[o.op] })),
    setups: u.setups.map(s => ({ ...s, centerLabel: CENTER_LABEL[s.center], opLabel: OP_LABEL[s.op] })),
    minutes,
    totals: { labourMin: total(x => x.labourMin), machineMin: total(x => x.machineMin), setupMin: total(x => x.setupMin) },
    money,
    moneyWhy: cost ? null : 'финансовый справочник не загружен: ставки ресурсов, границы себестоимости и цены не считаются',
    series: args.withSeries !== false && project.positions.length ? series(args, project.positions[0]) : null,
    missing: [...directMissing, ...u.missing],
    errors,
  }
}

function positionLabel(p: LabPosition) {
  const size = p.widthMm && p.heightMm ? `${p.widthMm}×${p.heightMm}` : 'размер не задан'
  return `${p.materialLabel ?? (p.materialId == null ? 'материал не выбран' : `материал ${p.materialId}`)}, ${p.thicknessMm ?? '?'} мм, ${size}, ${p.qty} шт.`
}

function cashBlock(cost: OrderCost, rates: ReturnType<typeof resourceRates>, project: LabProject, prices: PriceScenario[]) {
  const k = project.scenario.commissionPct / 100
  const perPrice = prices.map(s => {
    if (!s.incVat || !s.exVat) return { id: s.id, md: null, ordersPerMonth: null }
    // МД = выручка без НДС − переменные − комиссия (комиссия берётся с суммы с НДС).
    const md: Range = { lo: s.exVat.lo - cost.variable.hi - s.incVat.hi * k, hi: s.exVat.hi - cost.variable.lo - s.incVat.lo * k }
    const need = rates.grossTotal
    return {
      id: s.id, md,
      ordersPerMonth: md.lo > 0 ? { lo: need.lo / md.hi, hi: need.hi / md.lo } : null,
    }
  })
  return { monthlyGross: rates.grossTotal, monthlyExVat: rates.total, perPrice }
}

// Сравнение двух моделей на ОДНОЙ налоговой базе (§14 ТЗ): если входной НДС к вычету, обе
// стороны без НДС. Что действующая модель не считает — «отсутствует», а не ноль; что она
// считает прямой строкой, а экспериментальная разносит в ресурсы, помечается именно так.
function comparison(legacy: Legacy, cost: OrderCost, project: LabProject, priceB: Range | null): ComparisonRow[] {
  const t = legacy.totals
  const deduct = project.scenario.deductInputVat
  const vat = 1 + project.scenario.vatRatePct / 100
  const base = deduct ? 'без НДС' : 'с НДС'
  const toBase = (gross: number | null) => (gross == null ? null : deduct ? gross / vat : gross)
  const any = (f: (p: LabPosition) => boolean) => project.positions.some(f)
  const labLine = (re: RegExp): Range | null => {
    const found = cost.direct.filter(d => re.test(d.label))
    return found.length ? plus(...found.map(d => d.cost)) : null
  }
  const inResources = (what: string): ComparisonRow['note'] =>
    `экспериментальная модель не ставит ${what} прямой строкой: ${what} входит в стоимость ресурсов участка`

  const rows: ComparisonRow[] = [
    { label: `Материалы (${base})`, legacy: toBase(t.costMaterial), lab: labLine(/^Материал/),
      note: `действующая считает по биллинговой площади ${nf(legacy.positions.reduce((a, x) => a + x.billedM2, 0))} м², экспериментальная — по выбранному режиму расхода` },
  ]
  if (any(p => p.tempering)) {
    rows.push({ label: 'Закалка', legacy: toBase(t.costTempering), lab: labLine(/^Закалка/), note: 'сторонняя услуга, обе модели берут закупочную цену' })
  }
  rows.push(
    { label: `Кромка (${base})`, legacy: toBase(t.costEdge), lab: null, note: inResources('кромку') },
    { label: `Упаковка (${base})`, legacy: toBase(t.costPackaging), lab: null, note: `${inResources('упаковку')}; материалы упаковки не заданы` },
    { label: `Доставка на закалку (${base})`, legacy: toBase(t.costTransport), lab: null, note: 'экспериментальная: в логистическом слое, разносится вместе с накладными' },
  )
  if (any(p => p.facet)) rows.push({ label: 'Фацет', legacy: toBase(t.costFacet), lab: null, note: 'экспериментальная: сторонняя услуга, цена не задана' })
  rows.push(
    { label: 'Резка', legacy: null, lab: null, note: 'действующая считает резку выбранной услугой, а не нормой времени; экспериментальная — время станка, см. раздел 3' },
    { label: 'Сверление и вырезы', legacy: null, lab: null, note: 'то же: услуга против нормы времени' },
    { label: 'Себестоимость без НДС', legacy: t.costExVat || null, lab: cost.full,
      note: 'слева переменная себестоимость действующей модели, справа H1 с ресурсами и накладными — это разные по составу величины' },
  )

  // Цена и МД: сравнимы только при цене из прайса. Нет цены — «нет значения», а не ноль.
  const sale = t.saleIncVat > 0 ? t.saleIncVat : null
  const saleEx = t.saleExVat > 0 ? t.saleExVat : null
  rows.push({ label: 'Продажная цена с НДС', legacy: sale, lab: priceB,
    note: sale == null ? 'в прайсе нет продажной цены этого материала' : 'справа — сценарий Б (покрытие полной себестоимости), а не предложение заменить прайс' })
  if (saleEx != null) {
    const k = project.scenario.commissionPct / 100
    const com = saleEx * vat * k
    rows.push(
      { label: 'Маржинальный доход при цене прайса', legacy: saleEx - t.costExVat,
        lab: { lo: saleEx - cost.variable.hi - com, hi: saleEx - cost.variable.lo - com },
        note: 'одна и та же цена, два определения переменных затрат' },
      { label: 'Маржинальность при цене прайса, %', legacy: (saleEx - t.costExVat) / saleEx * 100,
        lab: { lo: (saleEx - cost.variable.hi - com) / saleEx * 100, hi: (saleEx - cost.variable.lo - com) / saleEx * 100 },
        note: 'проценты от выручки без НДС' },
    )
  } else {
    rows.push({ label: 'Маржинальный доход при цене прайса', legacy: null, lab: null, note: 'без цены из прайса сравнивать нечего' })
  }
  return rows
}

function series(args: Parameters<typeof labQuote>[0], base: LabPosition): { positionId: string; rows: SeriesRow[] } {
  const rows = SERIES_QTY.map((qty): SeriesRow => {
    const project: LabProject = { ...args.project, positions: [{ ...base, qty }] }
    const q = labQuote({ ...args, project, legacy: null, withSeries: false })
    const batch = q.money ? q.money.levels.h1 : null
    return {
      qty,
      batch,
      perUnit: batch ? times(batch, 1 / qty) : null,
      setupMin: q.totals.setupMin,
      materialM2: q.positions[0]?.usedM2 ?? null,
      labourMin: q.totals.labourMin,
      priceB: q.money?.prices.find(p => p.id === 'B')?.incVat ?? null,
    }
  })
  return { positionId: base.id, rows }
}
