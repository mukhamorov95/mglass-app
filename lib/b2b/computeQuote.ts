import type { B2BMaterial, B2BService } from '../types'
import { calcItem, calcTotals, type FacetPrice, type B2BOrderItem, type B2BOrderTotals } from '../b2bCalculator'
import { surchargeServicesFor, type SurchargeRule } from '../surcharges'

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
}

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
  const services: B2BService[] = [...(input.resolvedServices ?? []), ...surchargeSvcs]

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
  )

  return {
    ...calc,
    ...(input.comment ? { comment: input.comment } : {}),
    hasHoles: input.hasHoles ?? false,
    shape,
  }
}

export function computeQuoteTotals(items: B2BOrderItem[], discountPercent: number): B2BOrderTotals {
  return calcTotals(items, discountPercent)
}
