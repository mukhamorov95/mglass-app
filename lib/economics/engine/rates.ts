import { exVat, plus, times, ZERO, type Range } from '../classification/vat'
import type { CenterId } from './technology'
import { CENTER_LABEL, MACHINE_LABEL } from './technology'
import type { Param, Reader } from './reference'

// Ставка ресурса = месячная стоимость ресурса ÷ нормальная практическая мощность. Человек и
// станок — разные ресурсы: оплата труда идёт в человеко-минуту, участок со станком (лизинг,
// энергия, ремонт, расходники, площадь) — в станко-минуту. Участок без станка несёт свою
// площадь на человеко-минуту. Лизинг здесь платёж (денежная база), а не амортизация и проценты.
export type AreaScenario = 'current' | 'target'
// afterEnd — после последнего платежа по договорам с датой окончания в attrs.endsOn до границы
// сценария; none — без всех производственных лизингов (выкуп и остатки не учитываются).
export type LeaseScenario = 'active' | 'afterEnd' | 'none'
export type RateScenario = { area: AreaScenario; leases: LeaseScenario }

export const AFTER_END = '2027-12-31'

export const CENTERS: CenterId[] = ['cutting', 'edge', 'drilling', 'curved', 'sandblast', 'packaging', 'assembly', 'welding']
export const LOGISTICS = ['temperingLogistics', 'purchasing'] as const

export type Center = {
  id: CenterId
  label: string
  machine: string | null
  labourMonth: Range
  siteMonth: Range
  labourPracticalMin: number
  machinePracticalMin: number | null
  labourRate: Range
  machineRate: Range | null
}

export type Rates = {
  scenario: RateScenario
  consumablesByDriver: { id: CenterId; monthly: Range }[]
  centers: Center[]
  logistics: Range
  overhead: Range
  admin: Range
  total: Range
  grossTotal: Range     // как платим: для сверки с нагрузкой владельца
}

const vatOf = (p: Param | null, gross: Range): Range => {
  const vat = p?.vat ?? 'unknown'
  const regime = vat === 'none' ? { kind: 'none' as const, status: p!.status }
    : vat === 'unknown' ? { kind: 'unknown' as const }
    : { kind: 'rate' as const, rate: vat, status: p!.status, needsConfirmation: p?.vatConfirmed === false }
  return { lo: exVat(gross.lo, regime).lo, hi: exVat(gross.hi, regime).hi }
}

export function resourceRates(ref: Reader, scenario: RateScenario): Rates {
  const gross: Range[] = []
  // Платёжная сумма статьи: в сверку идёт с НДС, в стоимость — без вычитаемого.
  const money = (key: string): Range => {
    const g = ref.get(key)
    if (!g) return ZERO
    gross.push(g)
    return vatOf(ref.param(key), g)
  }

  const shopPayroll = plus(...[...CENTERS, ...LOGISTICS].map(id => ref.get(`fin.center.${id}.payroll`) ?? ZERO))
  const adminPayroll = ref.get('fin.admin.payroll') ?? ZERO
  const taxes = ref.get('fin.payrollTaxes') ?? ZERO
  gross.push(taxes)
  const allPayroll = shopPayroll.lo + adminPayroll.lo
  // Взносы не разделены между цехом и администрацией: пропорция окладам — гипотеза.
  const taxShare = allPayroll ? taxes.lo / allPayroll : 0
  const withTax = (key: string) => times(money(key), 1 + taxShare)
  const paid = (key: string): Range => {
    const a = ref.param(key)?.attrs
    if (a?.lease && scenario.leases === 'none') return ZERO
    if (a?.endsOn && scenario.leases === 'afterEnd' && String(a.endsOn) <= AFTER_END) return ZERO
    return money(key)
  }

  const rentRate = ref.need('fin.rent.rate')
  const rentParam = ref.param('fin.rent.rate')
  const rentGross = (m2: number): Range => times(rentRate, m2)
  const rent = (m2: number): Range => { const g = rentGross(m2); gross.push(g); return vatOf(rentParam, g) }

  const machineH = ref.need('fin.machine.practicalHours').lo
  const centers = CENTERS.map((id): Center => {
    const labourMonth = withTax(`fin.center.${id}.payroll`)
    const leaseCost = paid(`fin.center.${id}.lease`)
    const siteMonth = plus(
      rent(ref.get(`fin.center.${id}.areaM2`)?.lo ?? 0),
      money(`fin.center.${id}.electricity`), money(`fin.center.${id}.repair`),
      // Расходники, считаемые по драйверу (износ сверла, абразив), в ставку не входят:
      // иначе они легли бы на заказ дважды.
      ref.param(`fin.center.${id}.consumables`)?.attrs?.byDriver ? ZERO : money(`fin.center.${id}.consumables`),
      leaseCost,
    )
    const labourPracticalMin = (ref.get(`fin.center.${id}.hours`)?.lo ?? 0) * 60
    const machine = MACHINE_LABEL[id] ?? null
    const machinePracticalMin = machine ? machineH * 60 : null
    const per = (x: Range, min: number): Range => (min ? times(x, 1 / min) : ZERO)
    return {
      id, label: CENTER_LABEL[id], machine, labourMonth, siteMonth, labourPracticalMin, machinePracticalMin,
      labourRate: per(machine ? labourMonth : plus(labourMonth, siteMonth), labourPracticalMin),
      machineRate: machinePracticalMin ? per(siteMonth, machinePracticalMin) : null,
    }
  })

  const logistics = plus(
    ...LOGISTICS.map(id => withTax(`fin.center.${id}.payroll`)),
    ...ref.keys('fin.transport.cost.').map(paid),
  )

  const areaTotal = ref.need(`fin.area.${scenario.area}`).lo
  const centersArea = CENTERS.reduce((a, id) => a + (ref.get(`fin.center.${id}.areaM2`)?.lo ?? 0), 0)
  // Склад, общая площадь и всё, что сверх участков (в том числе лишние метры действующей аренды).
  const overhead = plus(rent(areaTotal - centersArea), ...ref.keys('fin.overhead.').map(money))
  const admin = plus(withTax('fin.admin.payroll'), ...ref.keys('fin.admin.cost.').map(money))

  // Месячная сумма «расходников по драйверу» остаётся расходом периода: что не начислено на
  // заказы, то не отнесено, как и неиспользованная мощность.
  const consumablesByDriver = CENTERS.filter(id => ref.param(`fin.center.${id}.consumables`)?.attrs?.byDriver)
    .map(id => ({ id, monthly: money(`fin.center.${id}.consumables`) }))
  const total = plus(...centers.map(c => plus(c.labourMonth, c.siteMonth)), logistics, overhead, admin,
    ...consumablesByDriver.map(c => c.monthly))
  return { scenario, consumablesByDriver, centers, logistics, overhead, admin, total, grossTotal: plus(...gross) }
}
