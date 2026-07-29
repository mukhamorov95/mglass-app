// Автоматический расход материала заказа — вместо ручного waste_percent.
//
// Ручной процент (18–45%, вбивается в справочнике «Стекло») смешивает две
// разные вещи и потому «где-то перекладывает, где-то недокладывает» (слова
// владельца):
//   1. ПОТЕРЯ РЕЗА — узкие полосы у края листа, которые уже ничем не станут.
//      Зависит от геометрии деталей заказа. По июлю: медиана 2.2%, среднее 4.1%,
//      90-й перцентиль 8.5% сверх нетто. Это МОЖНО посчитать раскроем — точно.
//   2. НЕВОЗВРАТНЫЙ ОСТАТОК — крупные куски, которые легли на стеллаж, но со
//      временем не пригодились и ушли в лом. Это уже не геометрия, а дисциплина
//      склада и частота повторных заказов этого материала. Задаётся оценкой.
//
// Наивная автоматика «раскроил заказ → списал целые листы» завышает расход в
// 2–2.5 раза: из 128% «отхода» при раскрое по заказу 96% — это крупные остатки,
// которые физически возвращаются в дело. Поэтому считаем честно:
//
//   расход = целые листы − возвращённый остаток × reuseRate
//          = нетто + потеря_реза + остаток × (1 − reuseRate)
//
//   reuseRate = 1  → расход = нетто + потеря реза (≈ +2–8%), идеальная дисциплина
//   reuseRate = 0  → расход = целые листы (+128%), всё в лом
//   текущий ручной ~30% ≈ reuseRate ≈ 0.75

import {
  runCuttingOptimizer, DEFAULT_CUTTING_SETTINGS,
  type PieceGroup, type CuttingSettings,
} from './cuttingOptimizer'

export const DEFAULT_SHEET = { width: 3210, height: 2250 }
export const SHEET_M2 = (w: number, h: number) => w * h / 1_000_000

// Доля крупного остатка, которая реально возвращается в производство. Пока —
// один осторожный коэффициент на весь цех. Позже можно завести по материалу:
// ходовое стекло (Прозрачное М1, Осветлённое) реюзается почти полностью,
// экзотика и рифлёное направленное — почти нет. Именно это и кодировали
// вручную разные waste_percent (зеркало 18% против рифлёного 45%).
export const DEFAULT_REUSE_RATE = 0.7

export type UsageItem = {
  materialName: string
  thickness: number
  category?: string
  width: number
  height: number
  quantity: number
  costPerM2: number
  sheetWidth?: number
  sheetHeight?: number
  patternDirection?: 'none' | 'along_length' | 'along_width'
}

export type MaterialUsage = {
  materialKey: string
  materialLabel: string
  costPerM2: number
  pieces: number
  netM2: number
  sheets: number
  sheetM2: number       // площадь целых листов
  remnantM2: number      // крупные остатки → на стеллаж
  cutLossM2: number      // безвозвратная потеря реза
  cutLossPct: number     // потеря реза относительно нетто
  reuseRate: number
  // Себестоимость материала при заданном reuseRate (с НДС, как в калькуляторе)
  honestCost: number     // нетто + потеря реза + невозвратный остаток
  fullSheetsCost: number // весь лист в лом (reuseRate=0) — верхняя граница
  netCost: number        // только нетто (reuseRate=1, без потери реза) — нижняя граница
}

function buildGroups(items: UsageItem[]): Map<string, PieceGroup> {
  const groups = new Map<string, PieceGroup>()
  for (const it of items) {
    if (!it.width || !it.height || !it.quantity) continue
    const key = `${it.materialName}|${it.thickness}|${it.category ?? ''}`
    if (!groups.has(key)) groups.set(key, {
      pieces: [],
      materialLabel: `${it.materialName}${it.thickness > 0 ? ' ' + it.thickness + ' мм' : ''}`,
      category: it.category ?? '',
      sheetWidth: it.sheetWidth ?? DEFAULT_SHEET.width,
      sheetHeight: it.sheetHeight ?? DEFAULT_SHEET.height,
      patternDirection: it.patternDirection ?? 'none',
    })
    const g = groups.get(key)!
    for (let i = 0; i < it.quantity; i++) g.pieces.push({
      id: `${key}-${g.pieces.length}`, width: it.width, height: it.height,
      label: `${it.width}×${it.height}`, orderId: 0, orderClientName: '',
      materialKey: key, canRotate: true,
    })
  }
  return groups
}

/**
 * Автоматический расход по каждому материалу заказа. Раскраивает реальные детали
 * и раскладывает площадь листов на нетто / потерю реза / возвратный остаток.
 */
export function computeMaterialUsage(
  items: UsageItem[],
  reuseRate = DEFAULT_REUSE_RATE,
  settings: CuttingSettings = DEFAULT_CUTTING_SETTINGS,
): MaterialUsage[] {
  const groups = buildGroups(items)
  const costByKey = new Map<string, number>()
  for (const it of items) costByKey.set(`${it.materialName}|${it.thickness}|${it.category ?? ''}`, it.costPerM2)

  const results = runCuttingOptimizer(groups, settings)
  const out: MaterialUsage[] = []

  for (const r of results) {
    const sheetM2One = SHEET_M2(r.sheetWidth, r.sheetHeight)
    const netM2 = r.totalUsedArea / 1_000_000
    const sheetM2 = r.sheetsNeeded * sheetM2One
    const freeM2 = Math.max(0, sheetM2 - netM2)
    // Крупные остатки — то, что оптимизатор пометил как значимые прямоугольники.
    const remnantM2 = r.sheets.reduce((s, sh) =>
      s + sh.remnants.reduce((a, rm) => a + rm.w * rm.h / 1_000_000, 0), 0)
    const cutLossM2 = Math.max(0, freeM2 - remnantM2)
    const costPerM2 = costByKey.get(r.materialKey) ?? 0

    const reusableCredit = remnantM2 * reuseRate
    const honestM2 = netM2 + cutLossM2 + (remnantM2 - reusableCredit)

    out.push({
      materialKey: r.materialKey,
      materialLabel: r.materialLabel,
      costPerM2,
      pieces: r.totalPieces,
      netM2: round(netM2),
      sheets: r.sheetsNeeded,
      sheetM2: round(sheetM2),
      remnantM2: round(remnantM2),
      cutLossM2: round(cutLossM2),
      cutLossPct: netM2 > 0 ? round(cutLossM2 / netM2 * 100) : 0,
      reuseRate,
      honestCost: Math.round(honestM2 * costPerM2),
      fullSheetsCost: Math.round(sheetM2 * costPerM2),
      netCost: Math.round(netM2 * costPerM2),
    })
  }
  return out.sort((a, b) => b.honestCost - a.honestCost)
}

export type UsageTotals = {
  netM2: number; sheets: number; sheetM2: number
  cutLossM2: number; remnantM2: number
  honestCost: number; fullSheetsCost: number; netCost: number
  effectiveWastePct: number  // (honest / netCost − 1)×100 — во что превращается ручной процент
}

export function sumUsage(rows: MaterialUsage[]): UsageTotals {
  const t = rows.reduce((a, r) => ({
    netM2: a.netM2 + r.netM2, sheets: a.sheets + r.sheets, sheetM2: a.sheetM2 + r.sheetM2,
    cutLossM2: a.cutLossM2 + r.cutLossM2, remnantM2: a.remnantM2 + r.remnantM2,
    honestCost: a.honestCost + r.honestCost, fullSheetsCost: a.fullSheetsCost + r.fullSheetsCost,
    netCost: a.netCost + r.netCost,
  }), { netM2: 0, sheets: 0, sheetM2: 0, cutLossM2: 0, remnantM2: 0, honestCost: 0, fullSheetsCost: 0, netCost: 0 })
  return {
    ...t,
    netM2: round(t.netM2), sheetM2: round(t.sheetM2), cutLossM2: round(t.cutLossM2), remnantM2: round(t.remnantM2),
    effectiveWastePct: t.netCost > 0 ? round((t.honestCost / t.netCost - 1) * 100) : 0,
  }
}

function round(n: number): number { return Math.round(n * 10) / 10 }
