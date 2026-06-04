import { createClient } from '@supabase/supabase-js'
import { calculateMirror, type MirrorInputs, type MirrorShape } from './mirrorCalculator'
import {
  calculateShower, SHOWER_MODELS, TIER_CONFIGS, HARDWARE_COLORS,
  type ShowerInputs,
} from './showerCalculator'
import { calculateLoft, type LoftInputs } from './loftCalculator'
import type { Material, Service, FinancialSettings } from './types'
import { getMatrixPrice, type GlassMatrixRow } from './glassMatrix'

export type CalcType = 'mirror' | 'loft' | 'shower'

export type CalcOptions = {
  hasLighting?: boolean
  buttonType?: 'none' | 'sensor' | 'wave'
  hasSandblast?: boolean
  model?: string
  tier?: 'budget' | 'standard'
  hardwareColor?: string
  width2?: number
  sections?: number
  divisions?: number
  systemType?: 'fixed' | 'sliding' | 'swing'
  withMounting?: boolean
  shape?: 'rectangle' | 'circle' | 'oval'
  mirrorType?: 'silver' | 'crystal_vision'
  thicknessMm?: number
  hasSubstrate?: boolean
  substratePrice?: number
}

export type QuickCalcResult = {
  price: number
  finalPrice: number
  description: string
  margin: number
  serviceLines?: Array<{ name: string; total: number }>
  warnings?: string[]
}

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function loadAll() {
  const supabase = db()
  const [{ data: mats }, { data: svcs }, { data: fins }, { data: gm }] = await Promise.all([
    supabase.from('materials').select('*').eq('active', true),
    supabase.from('services').select('*').eq('active', true),
    supabase.from('financial_settings').select('*'),
    supabase.from('glass_price_matrix').select('*').order('name'),
  ])
  return {
    materials:   (mats ?? []) as Material[],
    services:    (svcs ?? []) as Service[],
    settings:    (fins ?? []) as FinancialSettings[],
    glassMatrix: (gm ?? []) as GlassMatrixRow[],
  }
}

function pickSettings(settings: FinancialSettings[], productType?: string): FinancialSettings | null {
  return (
    settings.find(s => s.product_type === productType) ??
    settings.find(s => s.tier === 'standard') ??
    settings[0] ??
    null
  )
}

export async function quickCalc(
  type: CalcType,
  width: number,
  height: number,
  options: CalcOptions = {},
): Promise<QuickCalcResult | null> {
  const { materials, services, settings, glassMatrix } = await loadAll()

  if (type === 'mirror') {
    const cfg = pickSettings(settings, 'mirror_light')
    const allMirrorMats = materials.filter(m => m.category === 'зеркало')
    const mirrorMaterial = options.mirrorType === 'crystal_vision'
      ? (allMirrorMats.find(m => m.name.toLowerCase().includes('осветлённое') || m.name.toLowerCase().includes('crystal')) ?? allMirrorMats[0] ?? null)
      : (allMirrorMats.find(m => m.name.toLowerCase().includes('silver') && !m.name.toLowerCase().includes('6 мм') && !m.name.toLowerCase().includes('6мм')) ?? allMirrorMats.find(m => !m.name.toLowerCase().includes('6 мм')) ?? allMirrorMats[0] ?? null)

    // Resolve price from glass_price_matrix — primary source, same as /calculator/mirror.
    // getMatrixPrice is a pure function; no browser client involved.
    const mirrorMatrixName = options.mirrorType === 'crystal_vision' ? 'Осветлённое' : 'Серебро'
    const thicknessMm = options.thicknessMm ?? 4
    const matrixSale = getMatrixPrice(glassMatrix, mirrorMatrixName, thicknessMm, 'sale', 'mirror')
    const matrixCost = getMatrixPrice(glassMatrix, mirrorMatrixName, thicknessMm, 'cost', 'mirror')
    const mirrorCostPerM2: number | null = matrixSale ?? matrixCost ?? null

    const mirrorWarnings: string[] = []

    if (mirrorCostPerM2 == null) {
      // No matrix price — fall back to public.materials; need mirrorMaterial as price source
      if (!mirrorMaterial) return null
      mirrorWarnings.push(
        'Mirror price was calculated using public.materials fallback because glass_price_matrix price was not found.',
      )
    }
    // If mirrorCostPerM2 is set, mirrorMaterial may be null (calculateMirror handles it)

    // Web calculator maps round shapes to 'complex' + substrate (bounding-box area, +1500 form, +2000 substrate)
    const isRound = options.shape === 'circle' || options.shape === 'oval'
    const calcShape: MirrorShape = isRound ? 'complex' : (options.shape as MirrorShape) ?? 'rectangle'

    const inputs: MirrorInputs = {
      width,
      height,
      mirrorMaterial,
      mirrorCostPerM2: mirrorCostPerM2 ?? undefined,
      shape: calcShape,
      hasLighting: Boolean(options.hasLighting),
      buttonType: options.buttonType ?? 'none',
      hasSandblast: Boolean(options.hasSandblast),
      hasSubstrate: isRound || Boolean(options.hasSubstrate),
      substratePrice: options.substratePrice ?? 2000,
      hasInstallation: Boolean(options.withMounting),
      hasDelivery: false,
      partnerPercent: 0,
      discount: 0,
      margin: cfg?.default_margin ?? 40,
      standardMargin: cfg?.default_margin ?? 40,
      tax: cfg?.tax_percent ?? 11,
      minMargin: cfg?.min_margin ?? 25,
      hasFacet: false,
      facetTypeMm: null,
      facetCostPerM: 0,
      facetSalePerM: 0,
    }
    const result = calculateMirror(inputs, materials, services)
    if (!result) return null
    return {
      price:        result.grandTotal,
      finalPrice:   result.finalPrice,
      description:  result.clientText,
      margin:       result.margin,
      serviceLines: result.serviceLines,
      warnings:     mirrorWarnings.length > 0 ? mirrorWarnings : undefined,
    }
  }

  if (type === 'shower') {
    const cfg = pickSettings(settings)
    const modelId = options.model ?? 'M2'
    const model = SHOWER_MODELS.find(m => m.id === modelId) ?? SHOWER_MODELS.find(m => m.id === 'M2')!
    const tier = options.tier ?? 'standard'
    const tierCfg = TIER_CONFIGS.find(t => t.value === tier)!
    const colorValue = options.hardwareColor ?? 'chrome'
    const colorCfg = HARDWARE_COLORS.find(c => c.value === colorValue) ?? HARDWARE_COLORS[0]

    const glassMat = materials.find(m => m.category === 'стекло') ?? null
    const glassCostPerM2 = glassMat?.cost_price ?? 3000

    const inputs: ShowerInputs = {
      tier,
      model,
      width,
      width2: options.width2 ?? width,
      height,
      glassCostPerM2,
      glassName: glassMat?.name ?? 'Стекло закалённое',
      thickness: 8,
      hardwareColor: colorValue,
      hardwareColorMultiplier: colorCfg.multiplier,
      withMounting: Boolean(options.withMounting),
      withDelivery: false,
      floors: 0,
      discount: 0,
      partnerPercent: 0,
      margin: cfg?.default_margin ?? 40,
      expensesPercent: tierCfg.expensesPercent,
      hwTierMultiplier: tierCfg.hwMultiplier,
    }
    const result = calculateShower(inputs, services)
    return { price: result.grandTotal, finalPrice: result.finalPrice, description: result.clientText, margin: result.margin, serviceLines: result.serviceLines }
  }

  if (type === 'loft') {
    const cfg = pickSettings(settings)
    if (!cfg) return null
    const glassMat = materials.find(m => m.category === 'стекло') ?? null

    const inputs: LoftInputs = {
      width,
      height,
      sections: options.sections ?? 1,
      divisions: options.divisions ?? 0,
      systemType: options.systemType ?? 'fixed',
      glassMaterial: glassMat,
      glassWastePct: 0,
      withTempering: true,
      withMirrorFilm: false,
      withPainting: false,
      hasInstallation: Boolean(options.withMounting),
      hasDelivery: false,
      hardware: [],
      hardwareQty: {},
      partnerPercent: 0,
      discount: 0,
      margin: cfg.default_margin ?? 40,
    }
    const result = calculateLoft(inputs, materials, services, cfg)
    if (!result) return null
    return { price: result.grandTotal, finalPrice: result.finalPrice, description: result.clientText, margin: result.margin, serviceLines: result.serviceLines }
  }

  return null
}
