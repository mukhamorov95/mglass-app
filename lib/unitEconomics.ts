import { VAT, TEMPERING_COST, PACKAGING_PER_M2, TRANSPORT_PER_PIECE } from './b2bCalculator'

// Единственное определение себестоимости и маржинального вклада B2B-заказа.
// Все экраны, где показывается себестоимость или маржа заказа, берут цифры отсюда.
//
// Правило владельца (14.09.2026): в себестоимость изделия входят только
// переменные расходы — то, что растёт с каждым изделием. Оклады цеха, аренда,
// лизинг, кредит — постоянные: они не делятся на квадратный метр, а
// покрываются суммой вклада за месяц. См. docs/UNIT_ECONOMICS_ROUTE.md.
//
// НДС — входящий минус исходящий. К вычету принимаем НДС, уплаченный за стекло,
// закалку и подрядные услуги. Доставка и упаковка — без входящего НДС.

export type VariableKey = 'material' | 'tempering' | 'services' | 'transport' | 'packaging'

export type ContributionLine = {
  key: VariableKey
  label: string
  how: string          // как посчитано — показывается рядом с суммой
  amount: number       // ₽, как платим (с НДС, если он есть)
  vatIn: number        // ₽ НДС к вычету по этой статье
}

export type OrderContribution = {
  revenue: number          // выручка с НДС (после скидки)
  vatOut: number           // НДС исходящий
  revenueExVat: number
  lines: ContributionLine[]
  variable: number         // переменные, ₽ как платим
  vatIn: number            // НДС к вычету
  vatToPay: number         // исходящий − входящий
  contribution: number     // выручка − переменные − НДС к уплате
  contributionPct: number  // % от выручки без НДС
  pieces: number
  netM2: number
  billedM2: number         // площадь по закупке: нетто + отход по раскрою
}

export type ContributionItem = Record<string, unknown>

const n = (x: unknown) => Number(x) || 0
const vatPart = (sumWithVat: number, rate: number) => sumWithVat * rate / (100 + rate)
const r = (x: number) => Math.round(x)
const ru = (x: number, d = 2) => x.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d })

export function orderContribution(revenueIncVat: number, items: ContributionItem[], vatRate = VAT): OrderContribution {
  let material = 0, tempering = 0, services = 0, transport = 0, packaging = 0
  let pieces = 0, temperedPieces = 0, netM2 = 0, billedM2 = 0, temperedM2 = 0
  const temperThk = new Set<number>()

  for (const it of items) {
    const q = n(it.quantity)
    const net = n(it.totalAreaNet) || n(it.width) * n(it.height) / 1_000_000 * q
    pieces += q
    netM2 += net
    billedM2 += n(it.totalAreaBilled) || net
    material += n(it.costMaterial)
    tempering += n(it.costTempering)
    transport += n(it.costTransport)
    packaging += n(it.costPackaging)
    const svc = Array.isArray(it.services) ? it.services as Record<string, unknown>[] : []
    services += svc.reduce((a, s) => a + n(s.costPrice), 0) + n(it.costFacet) + n(it.costTriplex)
    if (it.hasTempering) {
      temperedPieces += q
      temperedM2 += net
      temperThk.add(n(it.thickness))
    }
  }

  const oneThk = temperThk.size === 1 ? [...temperThk][0] : null
  const temperHow = oneThk != null && TEMPERING_COST[oneThk]
    ? `${TEMPERING_COST[oneThk]} ₽/м² × ${ru(temperedM2)} м² (${oneThk} мм)`
    : `ставка по толщине × ${ru(temperedM2)} м²`

  const all: ContributionLine[] = [
    { key: 'material', label: 'Материал',
      how: `нетто ${ru(netM2)} м² + отход по раскрою = ${ru(billedM2)} м² по цене закупки`,
      amount: material, vatIn: vatPart(material, vatRate) },
    { key: 'tempering', label: 'Закалка (подрядчик)', how: temperHow,
      amount: tempering, vatIn: vatPart(tempering, vatRate) },
    { key: 'services', label: 'Подрядные услуги', how: 'фацет, триплекс, пескоструй — по себестоимости услуги',
      amount: services, vatIn: vatPart(services, vatRate) },
    { key: 'transport', label: 'Доставка на закалку', how: `${TRANSPORT_PER_PIECE} ₽ × ${temperedPieces} дет.`,
      amount: transport, vatIn: 0 },
    { key: 'packaging', label: 'Упаковка', how: `${PACKAGING_PER_M2} ₽/м² × ${ru(netM2)} м²`,
      amount: packaging, vatIn: 0 },
  ]
  // Пустые статьи не показываем, кроме материала — его отсутствие само по себе сигнал.
  const lines = all.filter(l => l.key === 'material' || l.amount > 0)

  // Считаем от округлённых статей: на экране «выручка − переменные − НДС = вклад»
  // обязано сходиться до рубля, иначе расчёту не верят.
  const rounded = lines.map(l => ({ ...l, amount: r(l.amount), vatIn: r(l.vatIn) }))
  const revenue = r(n(revenueIncVat))
  const vatOut = r(vatPart(revenue, vatRate))
  const variable = rounded.reduce((s, l) => s + l.amount, 0)
  const vatIn = rounded.reduce((s, l) => s + l.vatIn, 0)
  const vatToPay = vatOut - vatIn
  const contribution = revenue - variable - vatToPay
  const revenueExVat = revenue - vatOut

  return {
    revenue, vatOut, revenueExVat,
    lines: rounded,
    variable, vatIn, vatToPay,
    contribution,
    contributionPct: revenueExVat > 0 ? Math.round(contribution / revenueExVat * 1000) / 10 : 0,
    pieces, netM2: Math.round(netM2 * 100) / 100, billedM2: Math.round(billedM2 * 100) / 100,
  }
}

export type PortfolioContribution = {
  count: number
  revenue: number
  variable: number
  vatToPay: number
  contribution: number
  contributionPct: number
  revenueExVat: number
}

export function sumContributions(rows: OrderContribution[]): PortfolioContribution {
  const s = rows.reduce((a, x) => ({
    revenue: a.revenue + x.revenue, variable: a.variable + x.variable, vatToPay: a.vatToPay + x.vatToPay,
    contribution: a.contribution + x.contribution, revenueExVat: a.revenueExVat + x.revenueExVat,
  }), { revenue: 0, variable: 0, vatToPay: 0, contribution: 0, revenueExVat: 0 })
  return {
    count: rows.length, ...s,
    contributionPct: s.revenueExVat > 0 ? Math.round(s.contribution / s.revenueExVat * 1000) / 10 : 0,
  }
}

// Рубли и проценты для экранов экономики: минус — типографский «−», дробные — с запятой.
export function rub(x: number): string {
  const v = Math.round(x)
  return (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('ru-RU')
}
export function pct(x: number): string {
  return (x < 0 ? '−' : '') + Math.abs(x).toLocaleString('ru-RU', { maximumFractionDigits: 1 })
}
export function m2(x: number, digits = 1): string {
  return x.toLocaleString('ru-RU', { maximumFractionDigits: digits })
}

// Цвет вклада — пороги проекта: < 25% красный, 25–35% жёлтый, ≥ 35% зелёный.
export function contributionColor(pct: number): 'red' | 'amber' | 'green' {
  return pct < 25 ? 'red' : pct < 35 ? 'amber' : 'green'
}
