// M-Glass Three-Tier mirror pricing engine.
//
// Pure-function module. NO Supabase, React, fetch, or imports from product
// calculators. Not wired to live UI — consumed only via preview path.
//
// Pricing chain:
//   Factory Cost
//   → B2B Base Price       = factoryCost / (1 − b2bBaseMargin)
//   → Tier Price            = b2bBasePrice × (1 − tierDiscount)
//                            (Partner Price for external B2B,
//                             Internal Transfer Price for internal B2C)
//   → B2C Product Price    = transferPrice / (1 − b2cCommercial − b2cMargin)   [b2c mode only]
//   → Price with Designer  = b2cProductPrice / (1 − designerPercent)            [grossup]
//   → Final Product Price  = priceWithDesigner × (1 − discountPercent)
//   → Services             = each priced independently:
//                              servicePrice = serviceCost / (1 − serviceMargin)
//   → Final Client Price   = finalProductPrice + Σ servicePrice
//
// CFO invariant baked into the seed defaults:
//   b2b_base_margin ≥ 1 − (1 − max_tier_discount) × (1 − min_b2b_margin)
//   i.e. 38% base → worst case 20% internal_b2c tier still leaves 22.5% factory margin.

// ─── Public types ────────────────────────────────────────────────────────────

export type PricingChannelType =
  | 'external_b2b'
  | 'internal_b2c'
  | 'b2b_base'
  | 'retail_b2c'

export type MirrorThreeTierMode = 'b2b' | 'b2c'

export type PricingTierV2 = {
  code:             string
  name:             string
  channelType:      PricingChannelType
  discountPercent:  number
  // Optional override of config.minimumB2bMarginAfterDiscount.
  minMarginPercent?: number | null
}

export type PricingModelConfigV2 = {
  productCategory:                    'mirror'
  factoryOverheadPercent:             number
  scrapReservePercent:                number
  packagingCostPerM2:                 number
  b2bBaseMarginPercent:               number
  minimumB2bMarginAfterDiscount:      number
  b2cCommercialCostsPercent:          number
  b2cMarginPercent:                   number
  b2cMinMarginPercent:                number
}

export type MirrorFactoryCostInput = {
  // Required raw material cost (substrate glass × billing area, at cost_price).
  materialCost:           number
  // Sum of frame + LED + PSU + diffuser + button cost_price totals.
  lightingComponentsCost?: number
  // Assembly labor cost (minute_rate × minutes), already computed by caller.
  laborCost?:             number
  // Consumables (sealant, wire, mounts), already computed.
  consumablesCost?:       number
  // Billing area in m², multiplied by config.packagingCostPerM2.
  packagingAreaM2?:       number
  // Catch-all for everything else (facet, substrate, sandblast surcharge, …).
  extraFactoryCosts?: Array<{
    name:   string
    amount: number
  }>
}

export type MirrorServiceInput = {
  name:           string
  cost:           number
  marginPercent:  number
}

export type CalculateMirrorThreeTierInput = {
  mode:             MirrorThreeTierMode
  factory:          MirrorFactoryCostInput
  config:           PricingModelConfigV2
  tier:             PricingTierV2
  // B2C-only. Ignored (with warning) in B2B mode.
  designerPercent?:  number
  discountPercent?:  number
  services?:        MirrorServiceInput[]
}

export type MirrorThreeTierWarning = {
  code:     string
  message:  string
  severity: 'info' | 'warning' | 'error'
}

export type MirrorThreeTierFactoryLine = {
  name:    string
  amount:  number
}

export type MirrorThreeTierServiceLine = {
  name:           string
  cost:           number
  price:          number
  profit:         number
  marginPercent:  number
}

export type MirrorThreeTierResult = {
  mode:     MirrorThreeTierMode
  tierCode: string
  factory: {
    lines:        MirrorThreeTierFactoryLine[]
    subtotal:     number
    overhead:     number
    scrapReserve: number
    total:        number
  }
  b2b: {
    basePrice:                  number
    tierPrice:                  number
    profitAfterDiscount:        number
    marginAfterDiscountPercent: number
    minMarginPercent:           number
  }
  b2c?: {
    internalTransferPrice:      number
    commercialCostsAmount:      number
    marginAmount:               number
    productPrice:               number
    designerAmount:             number
    priceWithDesigner:          number
    discountAmount:             number
    finalProductPrice:          number
    profitAfterDiscount:        number
    marginAfterDiscountPercent: number
    minMarginPercent:           number
  }
  services: {
    lines:        MirrorThreeTierServiceLine[]
    totalCost:    number
    totalPrice:   number
    totalProfit:  number
  }
  final: {
    productPrice:  number
    servicesPrice: number
    clientPrice:   number
    groupProfit:   number
  }
  warnings: MirrorThreeTierWarning[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const roundMoney   = (v: number): number => Math.round(v)
const roundPercent = (v: number): number => Math.round(v * 10) / 10

function isFiniteNonNeg(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0
}

// ─── Main function ───────────────────────────────────────────────────────────

export function calculateMirrorThreeTier(
  input: CalculateMirrorThreeTierInput,
): MirrorThreeTierResult | null {
  const warnings: MirrorThreeTierWarning[] = []
  const { mode, factory, config, tier } = input

  // ─── Input validation ──────────────────────────────────────────────────
  if (!isFiniteNonNeg(factory.materialCost)) return null

  const lightingComponentsCost = factory.lightingComponentsCost ?? 0
  const laborCost              = factory.laborCost              ?? 0
  const consumablesCost        = factory.consumablesCost        ?? 0
  const packagingAreaM2        = factory.packagingAreaM2        ?? 0

  if (!isFiniteNonNeg(lightingComponentsCost)) return null
  if (!isFiniteNonNeg(laborCost))              return null
  if (!isFiniteNonNeg(consumablesCost))        return null
  if (!isFiniteNonNeg(packagingAreaM2))        return null

  for (const e of factory.extraFactoryCosts ?? []) {
    if (!isFiniteNonNeg(e.amount)) return null
  }

  const percentFields: Array<keyof PricingModelConfigV2> = [
    'factoryOverheadPercent',
    'scrapReservePercent',
    'b2bBaseMarginPercent',
    'minimumB2bMarginAfterDiscount',
    'b2cCommercialCostsPercent',
    'b2cMarginPercent',
    'b2cMinMarginPercent',
  ]
  for (const k of percentFields) {
    const v = config[k] as number
    if (!isFiniteNonNeg(v) || v >= 100) return null
  }
  if (!isFiniteNonNeg(config.packagingCostPerM2)) return null
  // B2C denom invariant (also enforced by DB CHECK).
  if (config.b2cCommercialCostsPercent + config.b2cMarginPercent >= 100) return null

  if (!isFiniteNonNeg(tier.discountPercent) || tier.discountPercent >= 100) return null
  if (tier.minMarginPercent != null) {
    if (!isFiniteNonNeg(tier.minMarginPercent) || tier.minMarginPercent >= 100) return null
  }

  // ─── 1. Factory Cost ───────────────────────────────────────────────────
  const lines: MirrorThreeTierFactoryLine[] = []
  lines.push({ name: 'Материал', amount: roundMoney(factory.materialCost) })
  if (lightingComponentsCost > 0) {
    lines.push({ name: 'Компоненты подсветки', amount: roundMoney(lightingComponentsCost) })
  }
  if (laborCost > 0) {
    lines.push({ name: 'Работа сборки', amount: roundMoney(laborCost) })
  }
  if (consumablesCost > 0) {
    lines.push({ name: 'Расходники', amount: roundMoney(consumablesCost) })
  }
  const packagingCostRaw = packagingAreaM2 * config.packagingCostPerM2
  if (packagingAreaM2 > 0 && packagingCostRaw > 0) {
    lines.push({ name: 'Упаковка', amount: roundMoney(packagingCostRaw) })
  }
  for (const extra of factory.extraFactoryCosts ?? []) {
    if (extra.amount > 0) {
      lines.push({ name: extra.name, amount: roundMoney(extra.amount) })
    }
  }

  const extraSum = (factory.extraFactoryCosts ?? []).reduce((s, e) => s + e.amount, 0)

  const factorySubtotalRaw =
      factory.materialCost
    + lightingComponentsCost
    + laborCost
    + consumablesCost
    + packagingCostRaw
    + extraSum

  if (factorySubtotalRaw <= 0) return null

  const overheadRaw        = factorySubtotalRaw * (config.factoryOverheadPercent / 100)
  const factoryBeforeScrap = factorySubtotalRaw + overheadRaw
  const scrapReserveRaw    = factoryBeforeScrap * (config.scrapReservePercent / 100)
  const factoryCostRaw     = factoryBeforeScrap + scrapReserveRaw

  // ─── 2. B2B Base Price ─────────────────────────────────────────────────
  const b2bBaseDenom = 1 - config.b2bBaseMarginPercent / 100
  if (b2bBaseDenom <= 0) return null

  const b2bBasePriceRaw = factoryCostRaw / b2bBaseDenom

  // ─── 3. Tier Price (Partner / Internal Transfer) ───────────────────────
  const tierPriceRaw            = b2bBasePriceRaw * (1 - tier.discountPercent / 100)
  const b2bProfitAfterRaw       = tierPriceRaw - factoryCostRaw
  const b2bMarginAfterPercentRaw = tierPriceRaw > 0
    ? (b2bProfitAfterRaw / tierPriceRaw) * 100
    : 0
  const b2bMarginAfterDiscountPercent = roundPercent(b2bMarginAfterPercentRaw)

  const effectiveMinB2bMargin = tier.minMarginPercent ?? config.minimumB2bMarginAfterDiscount

  if (b2bMarginAfterDiscountPercent < effectiveMinB2bMargin) {
    warnings.push({
      code:     'B2B_MARGIN_BELOW_MINIMUM',
      message:  `B2B margin after tier discount ${b2bMarginAfterDiscountPercent}% is below minimum ${effectiveMinB2bMargin}%`,
      severity: 'warning',
    })
  }

  // ─── Mode-specific computation ─────────────────────────────────────────
  let b2cOut: MirrorThreeTierResult['b2c'] | undefined
  let finalProductPriceRaw: number

  if (mode === 'b2b') {
    finalProductPriceRaw = tierPriceRaw

    const designerPct = input.designerPercent ?? 0
    const discountPct = input.discountPercent ?? 0
    if (designerPct > 0) {
      warnings.push({
        code:     'B2B_DESIGNER_IGNORED',
        message:  `designerPercent=${designerPct}% ignored in B2B mode`,
        severity: 'info',
      })
    }
    if (discountPct > 0) {
      warnings.push({
        code:     'B2B_DISCOUNT_IGNORED',
        message:  `discountPercent=${discountPct}% ignored in B2B mode`,
        severity: 'info',
      })
    }
  } else {
    // b2c mode
    const designerPct = input.designerPercent ?? 0
    const discountPct = input.discountPercent ?? 0

    if (!isFiniteNonNeg(designerPct) || designerPct >= 100) return null
    if (!isFiniteNonNeg(discountPct) || discountPct >= 100) return null

    const b2cDenom = 1 - (config.b2cCommercialCostsPercent + config.b2cMarginPercent) / 100
    if (b2cDenom <= 0) return null

    const internalTransferRaw  = tierPriceRaw
    const b2cProductPriceRaw   = internalTransferRaw / b2cDenom
    const commercialCostsRaw   = b2cProductPriceRaw * (config.b2cCommercialCostsPercent / 100)
    const marginAmountRaw      = b2cProductPriceRaw * (config.b2cMarginPercent / 100)

    const priceWithDesignerRaw = designerPct > 0
      ? b2cProductPriceRaw / (1 - designerPct / 100)
      : b2cProductPriceRaw
    const designerAmountRaw    = priceWithDesignerRaw - b2cProductPriceRaw

    finalProductPriceRaw       = priceWithDesignerRaw * (1 - discountPct / 100)
    const discountAmountRaw    = priceWithDesignerRaw - finalProductPriceRaw

    const b2cProfitAfterRaw    = finalProductPriceRaw - internalTransferRaw
    const b2cMarginAfterPctRaw = finalProductPriceRaw > 0
      ? (b2cProfitAfterRaw / finalProductPriceRaw) * 100
      : 0
    const b2cMarginAfterDiscountPercent = roundPercent(b2cMarginAfterPctRaw)

    if (b2cMarginAfterDiscountPercent < config.b2cMinMarginPercent) {
      warnings.push({
        code:     'B2C_MARGIN_BELOW_MINIMUM',
        message:  `B2C margin after discount ${b2cMarginAfterDiscountPercent}% is below minimum ${config.b2cMinMarginPercent}%`,
        severity: 'warning',
      })
    }

    b2cOut = {
      internalTransferPrice:      roundMoney(internalTransferRaw),
      commercialCostsAmount:      roundMoney(commercialCostsRaw),
      marginAmount:               roundMoney(marginAmountRaw),
      productPrice:               roundMoney(b2cProductPriceRaw),
      designerAmount:             roundMoney(designerAmountRaw),
      priceWithDesigner:          roundMoney(priceWithDesignerRaw),
      discountAmount:             roundMoney(discountAmountRaw),
      finalProductPrice:          roundMoney(finalProductPriceRaw),
      profitAfterDiscount:        roundMoney(b2cProfitAfterRaw),
      marginAfterDiscountPercent: b2cMarginAfterDiscountPercent,
      minMarginPercent:           config.b2cMinMarginPercent,
    }
  }

  // ─── Services ──────────────────────────────────────────────────────────
  const serviceLines: MirrorThreeTierServiceLine[] = []
  let totalServiceCostRaw  = 0
  let totalServicePriceRaw = 0

  for (const svc of input.services ?? []) {
    if (!isFiniteNonNeg(svc.cost)) return null
    if (!isFiniteNonNeg(svc.marginPercent) || svc.marginPercent >= 100) {
      warnings.push({
        code:     'SERVICE_INVALID_MARGIN',
        message:  `Service "${svc.name}" margin ${svc.marginPercent}% invalid (must be 0..<100), skipped`,
        severity: 'warning',
      })
      continue
    }
    const svcDenom    = 1 - svc.marginPercent / 100
    const svcPriceRaw = svcDenom > 0 ? svc.cost / svcDenom : svc.cost
    const svcProfitRaw = svcPriceRaw - svc.cost
    const svcMarginPct = svcPriceRaw > 0 ? roundPercent((svcProfitRaw / svcPriceRaw) * 100) : 0
    serviceLines.push({
      name:          svc.name,
      cost:          roundMoney(svc.cost),
      price:         roundMoney(svcPriceRaw),
      profit:        roundMoney(svcProfitRaw),
      marginPercent: svcMarginPct,
    })
    totalServiceCostRaw  += svc.cost
    totalServicePriceRaw += svcPriceRaw
  }

  // ─── Final aggregation ─────────────────────────────────────────────────
  const clientPriceRaw = finalProductPriceRaw + totalServicePriceRaw
  const groupProfitRaw = clientPriceRaw - (factoryCostRaw + totalServiceCostRaw)

  return {
    mode,
    tierCode: tier.code,
    factory: {
      lines,
      subtotal:     roundMoney(factorySubtotalRaw),
      overhead:     roundMoney(overheadRaw),
      scrapReserve: roundMoney(scrapReserveRaw),
      total:        roundMoney(factoryCostRaw),
    },
    b2b: {
      basePrice:                  roundMoney(b2bBasePriceRaw),
      tierPrice:                  roundMoney(tierPriceRaw),
      profitAfterDiscount:        roundMoney(b2bProfitAfterRaw),
      marginAfterDiscountPercent: b2bMarginAfterDiscountPercent,
      minMarginPercent:           effectiveMinB2bMargin,
    },
    ...(b2cOut ? { b2c: b2cOut } : {}),
    services: {
      lines:       serviceLines,
      totalCost:   roundMoney(totalServiceCostRaw),
      totalPrice:  roundMoney(totalServicePriceRaw),
      totalProfit: roundMoney(totalServicePriceRaw - totalServiceCostRaw),
    },
    final: {
      productPrice:  roundMoney(finalProductPriceRaw),
      servicesPrice: roundMoney(totalServicePriceRaw),
      clientPrice:   roundMoney(clientPriceRaw),
      groupProfit:   roundMoney(groupProfitRaw),
    },
    warnings,
  }
}
