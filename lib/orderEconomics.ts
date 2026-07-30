// Честная экономика B2B-заказа: что система насчитала против того, что заказ
// стоит на самом деле.
//
// Два расхождения, которые владелец просил вскрыть:
//   1. МАТЕРИАЛ. Калькулятор берёт нетто × (1 + ручной_процент). Честно —
//      раскрой реальных деталей (lib/materialUsage): нетто + потеря реза +
//      невозвратный остаток.
//   2. ТРУД. Калькулятор считает только кромку (40 ₽/м), упаковку (120 ₽/м²),
//      закалку и доставку. РЕЗКИ (Бекмурза 160к) и СВЕРЛОВКИ (Адилет 150к) в
//      себестоимости НЕТ вообще — они растворены в марже. Честно — все четыре
//      операции по живым ставкам (зарплата ÷ объём периода, lib/laborModel).

import { computeMaterialUsage, DEFAULT_REUSE_RATE, type UsageItem } from './materialUsage'
import { laborRates, pieceLaborCost, type ShopSalaries, type ShopThroughput } from './laborModel'
import { TEMPERING_COST, EDGE_COST_PER_M, PACKAGING_PER_M2, TRANSPORT_PER_PIECE } from './b2bCalculator'

export type EcoItem = {
  materialName: string
  thickness: number
  category?: string
  width: number
  height: number
  quantity: number
  wastePercent: number
  costPerM2: number          // cost_price материала (с НДС)
  hasTempering?: boolean
  hasHoles?: boolean
  perimeterM?: number        // периметр одной детали, м (если нет — считаем из габаритов)
  sheetWidth?: number
  sheetHeight?: number
  patternDirection?: 'none' | 'along_length' | 'along_width'
}

export type EcoOrder = {
  id: number
  clientName: string
  revenue: number            // total_after_discount (или inc_vat)
  items: EcoItem[]
}

export type OrderEconomics = {
  orderId: number
  clientName: string
  revenue: number
  pieces: number
  netM2: number
  sheets: number             // реальные листы по раскрою
  billedM2: number           // нетто × (1 + ручной процент) — как выдал калькулятор
  // Материал
  systemMaterial: number     // нетто × (1+ручной%) × cost
  honestMaterial: number     // раскрой + reuseRate
  // Труд по операциям (честно, по живым ставкам)
  laborCutting: number
  laborDrilling: number
  laborEdge: number
  laborPackaging: number
  laborTempering: number     // закалка (подрядчик, не оклад)
  laborTransport: number
  honestLabor: number        // резка+сверловка+кромка+упаковка (оклады)
  systemLabor: number        // кромка+упаковка (что калькулятор реально заложил)
  // Итоги
  systemCost: number         // как считает система (материал ручной + текущие строки)
  honestCost: number         // честно (материал раскрой + все операции по ставкам)
  systemMargin: number       // (revenue − systemCost) / revenue, %
  honestMargin: number
  marginGap: number          // systemMargin − honestMargin (насколько система приукрашивает)
  edgeMPerM2: number         // пог.м кромки на м² нетто — «геометрия» заказа
}

function perimeterOf(it: EcoItem): number {
  if (it.perimeterM && it.perimeterM > 0) return it.perimeterM
  return 2 * (it.width + it.height) / 1000
}

export function computeOrderEconomics(
  order: EcoOrder,
  salaries: ShopSalaries,
  throughput: ShopThroughput,
  reuseRate = DEFAULT_REUSE_RATE,
  // Быстрый режим для списков (без раскроя): честный материал = системному.
  // Для просчётов после #167 системный уже с авторасходом, так что разница между
  // «система» и «честно» приходит из недостающего труда (резка/сверловка). Экран
  // одного заказа считает полный раскрой (skipNesting=false).
  opts: { skipNesting?: boolean } = {},
): OrderEconomics {
  const rates = laborRates(salaries, throughput)

  // ── Материал: раскрой реальных деталей (или пропуск для быстрого списка) ────
  let honestMaterial = 0, sheets = 0, netM2 = 0
  if (opts.skipNesting) {
    honestMaterial = -1  // проставим после пробега по позициям (= systemMaterial)
  } else {
    const usageItems: UsageItem[] = order.items
      .filter(it => it.width > 0 && it.height > 0 && it.quantity > 0)
      .map(it => ({
        materialName: it.materialName, thickness: it.thickness, category: it.category,
        width: it.width, height: it.height, quantity: it.quantity, costPerM2: it.costPerM2,
        sheetWidth: it.sheetWidth, sheetHeight: it.sheetHeight, patternDirection: it.patternDirection,
      }))
    const usage = computeMaterialUsage(usageItems, reuseRate)
    honestMaterial = usage.reduce((s, u) => s + u.honestCost, 0)
    sheets = usage.reduce((s, u) => s + u.sheets, 0)
    netM2 = usage.reduce((s, u) => s + u.netM2, 0)
  }

  // ── Пробег по позициям: система-материал, закалка, доставка, кромочный метраж ─
  let systemMaterial = 0, billedM2 = 0, pieces = 0
  let laborTempering = 0, laborTransport = 0
  let edgeM = 0, drilledPcs = 0, netM2Sys = 0
  for (const it of order.items) {
    const q = it.quantity || 0
    const net = it.width * it.height / 1_000_000 * q
    const billed = net * (1 + (it.wastePercent || 0) / 100)
    systemMaterial += billed * it.costPerM2
    billedM2 += billed
    netM2Sys += net
    pieces += q
    edgeM += perimeterOf(it) * q
    if (it.hasHoles) drilledPcs += q
    if (it.hasTempering) {
      laborTempering += net * (TEMPERING_COST[it.thickness] ?? 0)
      laborTransport += q * TRANSPORT_PER_PIECE
    }
  }

  // Быстрый режим: честный материал = системному (см. opts.skipNesting), листы/нетто из пробега.
  if (opts.skipNesting) { honestMaterial = systemMaterial; netM2 = netM2Sys }

  // ── Труд по живым ставкам ─────────────────────────────────────────────────
  const labor = pieceLaborCost(rates, { netM2: netM2Sys, edgeM, drilledPcs, pcs: pieces })

  // Что калькулятор РЕАЛЬНО закладывает в себестоимость сейчас:
  //   кромка EDGE_COST_PER_M, упаковка PACKAGING_PER_M2, закалка, доставка.
  //   Резки и сверловки в себестоимости нет.
  const systemEdge = Math.round(edgeM * EDGE_COST_PER_M)
  const systemPack = Math.round(netM2Sys * PACKAGING_PER_M2)
  const systemLabor = systemEdge + systemPack + laborTempering + laborTransport
  const honestLabor = labor.cutting + labor.drilling + labor.edge + labor.packaging + laborTempering + laborTransport

  const systemCost = Math.round(systemMaterial + systemLabor)
  const honestCost = Math.round(honestMaterial + honestLabor)
  const rev = order.revenue || 0
  const systemMargin = rev > 0 ? (rev - systemCost) / rev * 100 : 0
  const honestMargin = rev > 0 ? (rev - honestCost) / rev * 100 : 0

  return {
    orderId: order.id, clientName: order.clientName, revenue: rev, pieces,
    netM2: r1(netM2 || netM2Sys), sheets, billedM2: r1(billedM2),
    systemMaterial: Math.round(systemMaterial), honestMaterial: Math.round(honestMaterial),
    laborCutting: labor.cutting, laborDrilling: labor.drilling, laborEdge: labor.edge,
    laborPackaging: labor.packaging, laborTempering: Math.round(laborTempering), laborTransport: Math.round(laborTransport),
    honestLabor: Math.round(honestLabor), systemLabor: Math.round(systemLabor),
    systemCost, honestCost,
    systemMargin: r1(systemMargin), honestMargin: r1(honestMargin), marginGap: r1(systemMargin - honestMargin),
    edgeMPerM2: netM2Sys > 0 ? r1(edgeM / netM2Sys) : 0,
  }
}

export type PortfolioEconomics = {
  orders: OrderEconomics[]
  count: number
  revenue: number
  systemCost: number
  honestCost: number
  systemMaterial: number
  honestMaterial: number
  systemLabor: number
  honestLabor: number
  netM2: number
  sheets: number
  systemMargin: number
  honestMargin: number
  laborBreakdown: { cutting: number; drilling: number; edge: number; packaging: number; tempering: number; transport: number }
}

export function summarizeEconomics(rows: OrderEconomics[]): PortfolioEconomics {
  const s = rows.reduce((a, r) => ({
    revenue: a.revenue + r.revenue,
    systemCost: a.systemCost + r.systemCost, honestCost: a.honestCost + r.honestCost,
    systemMaterial: a.systemMaterial + r.systemMaterial, honestMaterial: a.honestMaterial + r.honestMaterial,
    systemLabor: a.systemLabor + r.systemLabor, honestLabor: a.honestLabor + r.honestLabor,
    netM2: a.netM2 + r.netM2, sheets: a.sheets + r.sheets,
    cutting: a.cutting + r.laborCutting, drilling: a.drilling + r.laborDrilling,
    edge: a.edge + r.laborEdge, packaging: a.packaging + r.laborPackaging,
    tempering: a.tempering + r.laborTempering, transport: a.transport + r.laborTransport,
  }), { revenue: 0, systemCost: 0, honestCost: 0, systemMaterial: 0, honestMaterial: 0, systemLabor: 0, honestLabor: 0, netM2: 0, sheets: 0, cutting: 0, drilling: 0, edge: 0, packaging: 0, tempering: 0, transport: 0 })
  return {
    orders: rows, count: rows.length,
    revenue: s.revenue, systemCost: s.systemCost, honestCost: s.honestCost,
    systemMaterial: s.systemMaterial, honestMaterial: s.honestMaterial,
    systemLabor: s.systemLabor, honestLabor: s.honestLabor,
    netM2: r1(s.netM2), sheets: s.sheets,
    systemMargin: s.revenue > 0 ? r1((s.revenue - s.systemCost) / s.revenue * 100) : 0,
    honestMargin: s.revenue > 0 ? r1((s.revenue - s.honestCost) / s.revenue * 100) : 0,
    laborBreakdown: { cutting: s.cutting, drilling: s.drilling, edge: s.edge, packaging: s.packaging, tempering: s.tempering, transport: s.transport },
  }
}

function r1(n: number): number { return Math.round(n * 10) / 10 }
