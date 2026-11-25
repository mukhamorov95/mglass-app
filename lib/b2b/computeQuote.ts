import type { B2BMaterial, B2BService } from '../types'
import { calcItem, calcTotals, type FacetPrice, type B2BOrderItem, type B2BOrderTotals } from '../b2bCalculator'
import { surchargeServicesFor, type SurchargeRule } from '../surcharges'
import type { B2BRates } from './rates'
import { holeServices, type HolePrice } from './holePrices'
import { cutoutServices, cutoutTotal, isCutoutService, normalizeCutouts, type CutoutGroup } from './cutouts'

// ЕДИНАЯ точка расчёта B2B-позиции. Её зовут ОБА калькулятора:
//   • менеджерский  app/calculator/b2b/page.tsx
//   • кабинет клиента  app/api/partner/quote/route.ts
// Здесь применяются авто-надбавки за габариты/сложность (b2b_surcharge_rules),
// поэтому цена физически не может разойтись между экранами. Клиент получает тот
// же saleIncVat, что и менеджер для той же позиции. cost/margin наружу не отдаём
// (их вырезает вызывающий API, здесь они считаются как обычно для сохранения).

export type QuoteItemInput = {
  material: B2BMaterial
  width: number
  height: number
  quantity: number
  wastePercent?: number                 // по умолчанию — расход материала из справочника
  hasTempering?: boolean
  resolvedServices?: B2BService[]        // уже разрешённые доп-услуги (тарифы/плёнки), как в менеджерской странице
  hasFacet?: boolean
  facetTypeMm?: number | null
  hasHoles?: boolean                     // сверловка — пока только флаг маршрута, на цену не влияет
  hasSandblast?: boolean                 // песочка — отдельный этап цеха; на цену стекла не влияет
  holes?: { d: number; n: number }[]     // сколько и какого диаметра — для сверловщика, на цену не влияет
  hasCutouts?: boolean                   // вырезы — работа сверловщика, ведёт на ту же станцию
  cutouts?: number                       // сколько вырезов
  cutoutGroups?: CutoutGroup[]           // вид и категория вырезов — цена из справочника cutout_*
  shape?: 'rect' | 'curved'
  hasTriplex?: boolean
  triplexLayers?: number                 // 2 или 3; движок нормализует
  triplexPrice?: { salePerM2: number; costPerM2: number } | null
  triplexExtraGlasses?: B2BMaterial[]
  applyMinPrice?: boolean
  comment?: string
  dismissedSurcharges?: Set<number>      // менеджер может снять надбавку вручную; клиент — никогда (пусто)
}

export type QuoteRefData = {
  facetPrices: FacetPrice[]
  surchargeRules: SurchargeRule[]
  rates: B2BRates        // справочник b2b_rates: оба калькулятора обязаны считать по одной таблице
  cutoutPrices?: B2BService[]   // строки b2b_services с кодом cutout_*; нет — вырезы без цены
  holePrices?: HolePrice[]      // b2b_hole_prices: Ø × толщина; нет — отверстия без цены (кабинет партнёра)
}

export const TG_SHAPE = /т и г образн/i

export function computeQuoteItem(input: QuoteItemInput, ref: QuoteRefData): Omit<B2BOrderItem, 'localId'> {
  const { material: mat, width, height, quantity } = input
  const shape: 'rect' | 'curved' = input.shape === 'curved' ? 'curved' : 'rect'
  const waste = input.wastePercent ?? mat.waste_percent

  // То же, что делает менеджерская страница: надбавки за габариты → синтетические
  // percent-услуги, добавляются к реальным доп-услугам и уходят в движок.
  const surchargeSvcs = surchargeServicesFor(
    { width, height, shape },
    ref.surchargeRules,
    input.dismissedSurcharges ?? new Set<number>(),
  )
  // Вырезы считаются только по группам: строка выреза, пришедшая обычной услугой, — повтор.
  const cutoutGroups = normalizeCutouts(input.cutoutGroups)
  // Отверстия — по диаметру и толщине пакета (триплекс сверлят насквозь).
  const packThickness = mat.thickness + (input.hasTriplex ? (input.triplexExtraGlasses ?? []).reduce((a, g) => a + g.thickness, 0) : 0)
  const holeSvcs = input.hasHoles !== false ? holeServices(input.holes ?? [], packThickness, ref.holePrices ?? []) : []
  // Вырез заменяет наценку «Т и Г образные +50 %» (владелец 25.11.2026): одно и то же дважды не берём.
  const services: B2BService[] = [
    ...(input.resolvedServices ?? []).filter(s => !isCutoutService(s as B2BService & { code?: string })
      && !(cutoutGroups.length > 0 && TG_SHAPE.test(s.name))),
    ...cutoutServices(cutoutGroups, ref.cutoutPrices ?? []),
    ...holeSvcs,
    ...surchargeSvcs,
  ]
  const cutCount = cutoutTotal(cutoutGroups)

  const calc = calcItem(
    mat, width, height, quantity, waste,
    input.hasTempering ?? false,
    services,
    input.hasFacet ?? false,
    input.hasFacet ? (input.facetTypeMm ?? null) : null,
    ref.facetPrices,
    input.hasTriplex ?? false,
    input.triplexLayers ?? 2,
    input.triplexPrice ?? null,
    input.hasTriplex ? (input.triplexExtraGlasses ?? []) : [],
    input.applyMinPrice ?? true,
    ref.rates,
  )

  // А12: материал с индивидуальной ценой клиента помечает позицию — скидка к такой
  // цене больше не применяется (см. effectiveItemTotal). Помечаем здесь, в единой
  // точке расчёта, чтобы менеджер и кабинет клиента вели себя одинаково.
  const clientPriced = (mat as { clientPriced?: boolean }).clientPriced === true

  return {
    ...calc,
    ...(input.comment ? { comment: input.comment } : {}),
    ...(clientPriced ? { clientPriced: true } : {}),
    hasHoles: input.hasHoles ?? false,
    hasSandblast: input.hasSandblast ?? false,
    holes: input.holes ?? [],
    hasCutouts: cutCount > 0 || (input.hasCutouts ?? false),
    cutouts: cutCount > 0 ? cutCount : (input.cutouts ?? 0),
    ...(cutoutGroups.length ? { cutoutGroups } : {}),
    shape,
  }
}

export function computeQuoteTotals(items: B2BOrderItem[], discountPercent: number): B2BOrderTotals {
  return calcTotals(items, discountPercent)
}
