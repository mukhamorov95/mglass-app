import { createClient } from '@supabase/supabase-js'
import { calculateMirror, type MirrorInputs, type MirrorShape, type MirrorLightingComponent } from './mirrorCalculator'
import {
  calculateShower, SHOWER_MODELS, TIER_CONFIGS, HARDWARE_COLORS,
  type ShowerInputs, type ShowerModel,
} from './showerCalculator'
import { calculateLoft, type LoftInputs } from './loftCalculator'
import type { Material, Service, FinancialSettings } from './types'
import { getMatrixPrice, getWastePct, type GlassMatrixRow } from './glassMatrix'
import {
  resolveShowerGlassCostPerM2, resolveShowerExpensesPercent, resolveBudgetHardwareCost,
  DEFAULT_SHOWER_GLASS, type GlassMatrixMap, type BudgetManualPrice, type HwColorRow,
} from './pricing/showerInputs'

// Raw row from public.mirror_lighting_components (server-side read)
type LightingRow = {
  id:              number
  component_type:  string
  name:            string
  short_name:      string | null
  voltage:         number | null
  color_temp:      number | null
  power_per_meter: number | null
  max_power:       number | null
  cost_price:      number
  unit:            string
  active:          boolean
  sort_order:      number
}

function toLightingComponent(row: LightingRow): MirrorLightingComponent {
  return {
    id:              row.id,
    name:            row.name,
    short_name:      row.short_name,
    cost_price:      row.cost_price,
    unit:            row.unit,
    voltage:         row.voltage,
    color_temp:      row.color_temp,
    power_per_meter: row.power_per_meter,
    max_power:       row.max_power,
  }
}

export type CalcType = 'mirror' | 'loft' | 'shower'

export type CalcOptions = {
  hasLighting?: boolean
  buttonType?: 'none' | 'sensor' | 'wave'
  hasSandblast?: boolean
  model?: string
  tier?: 'budget' | 'standard'
  hardwareColor?: string
  glassType?: string
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
  const [{ data: mats }, { data: svcs }, { data: fins }, { data: gm }, { data: lc }] = await Promise.all([
    supabase.from('materials').select('*').eq('active', true),
    supabase.from('services').select('*').eq('active', true),
    supabase.from('financial_settings').select('*'),
    supabase.from('glass_price_matrix').select('*').order('name'),
    supabase.from('mirror_lighting_components').select('*').eq('active', true).order('sort_order').order('id'),
  ])
  return {
    materials:          (mats ?? []) as Material[],
    services:           (svcs ?? []) as Service[],
    settings:           (fins ?? []) as FinancialSettings[],
    glassMatrix:        (gm ?? []) as GlassMatrixRow[],
    lightingComponents: (lc ?? []) as LightingRow[],
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

// glass_price_matrix rows → { name: { t8, … } } (только продажные строки стекла) —
// та же форма, что грузит UI душевой; используется резолвером цены стекла.
function buildGlassMatrixMap(rows: GlassMatrixRow[]): GlassMatrixMap {
  const map: GlassMatrixMap = {}
  for (const r of rows) {
    if (r.price_type === 'sale' && r.category === 'glass') {
      map[r.name] = r as unknown as Record<string, number | null>
    }
  }
  return map
}

type ShowerModelRow = {
  code: string; title: string; description: string
  glass_count: number; dim_type: string; hardware_base: number; hardware_type: string
}

// Данные душевой из БД — те же источники, что и UI-калькулятор (детерминизм цены).
async function loadShowerExtra() {
  const supabase = db()
  const [{ data: os }, { data: sm }, { data: bmp }, { data: hc }] = await Promise.all([
    supabase.from('owner_strategy').select('key,value'),
    supabase.from('shower_models').select('*').eq('active', true).order('sort_order'),
    supabase.from('shower_budget_manual_prices').select('model_id,color_id,price'),
    supabase.from('shower_hw_colors').select('id,name').eq('active', true).order('id'),
  ])
  const strat = (os ?? []) as { key: string; value: string }[]
  const num = (k: string, def: number) => {
    const v = strat.find(r => r.key === k)?.value
    const n = v != null ? Number(v) : NaN
    return Number.isFinite(n) ? n : def
  }
  const models = ((sm ?? []) as ShowerModelRow[]).map(r => ({
    id: r.code as ShowerModel['id'], label: r.title, desc: r.description,
    glassCount: r.glass_count, dimType: r.dim_type as ShowerModel['dimType'],
    hardwareBase: r.hardware_base, hardwareType: r.hardware_type as ShowerModel['hardwareType'],
  }))
  return {
    targetMargin: num('target_margin', 40),
    minMargin:    num('min_margin', 25),
    showerModels: models,
    budgetManualPrices: (bmp ?? []) as BudgetManualPrice[],
    hwColors: (hc ?? []) as HwColorRow[],
  }
}

export async function quickCalc(
  type: CalcType,
  width: number,
  height: number,
  options: CalcOptions = {},
): Promise<QuickCalcResult | null> {
  const { materials, services, settings, glassMatrix, lightingComponents } = await loadAll()

  if (type === 'mirror') {
    // Always use 'mirror' financial_settings (margin=40) regardless of hasLighting —
    // matches /calculator/mirror which reads margin from owner_strategy.target_margin=40,
    // not from mirror_light (margin=50). hasLighting affects components and label only.
    const mirrorSettingsType = 'mirror'
    const cfg = pickSettings(settings, mirrorSettingsType)

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

    // Resolve waste % from glass_price_matrix — same source as /calculator/mirror.
    const mirrorWastePct = getWastePct(glassMatrix, mirrorMatrixName, 'mirror')

    const mirrorWarnings: string[] = []

    if (mirrorCostPerM2 == null) {
      // No matrix price — fall back to public.materials; need mirrorMaterial as price source
      if (!mirrorMaterial) return null
      mirrorWarnings.push(
        'Mirror price was calculated using public.materials fallback because glass_price_matrix price was not found.',
      )
    }
    // If mirrorCostPerM2 is set, mirrorMaterial may be null (calculateMirror handles it)

    // Warn if glass_price_matrix row lacks waste_pct (getWastePct defaults to 0)
    const hasWastePctInMatrix = glassMatrix.some(
      r => r.name === mirrorMatrixName && r.price_type === 'cost' && r.category === 'mirror' && r.waste_pct != null,
    )
    if (!hasWastePctInMatrix) {
      mirrorWarnings.push(
        `mirrorWastePct не найден в glass_price_matrix для "${mirrorMatrixName}". Используется 0%.`,
      )
    }

    // Warn if exact financial_settings record not found for this mirror type
    const hasExactFinancialSettings = settings.some(s => s.product_type === mirrorSettingsType)
    if (!hasExactFinancialSettings) {
      mirrorWarnings.push(
        `financial_settings для "${mirrorSettingsType}" не найден. ` +
        `Используются настройки по умолчанию. Проверьте margin и tax вручную.`,
      )
    }

    // Select default lighting components when hasLighting=true — same defaults as /calculator/mirror.
    // Mirrors the auto-select logic at calculator page initialisation (first by sort_order/id).
    let selFrame:       MirrorLightingComponent | null = null
    let selLedStrip:    MirrorLightingComponent | null = null
    let selPowerSupply: MirrorLightingComponent | null = null
    let selDiffuser:    MirrorLightingComponent | null = null

    if (options.hasLighting) {
      const lcFrame = lightingComponents.find(c => c.component_type === 'frame')
      if (lcFrame) selFrame = toLightingComponent(lcFrame)

      const lcLed = lightingComponents.find(c => c.component_type === 'led_strip' && c.voltage === 12)
                 ?? lightingComponents.find(c => c.component_type === 'led_strip')
      if (lcLed) selLedStrip = toLightingComponent(lcLed)

      const lcDiff = lightingComponents.find(c => c.component_type === 'diffuser')
      if (lcDiff) selDiffuser = toLightingComponent(lcDiff)

      // Auto-PSU: minimum PSU 12V with max_power >= needed (same formula as calculator)
      const psus12 = lightingComponents.filter(c => c.component_type === 'power_supply' && (c.voltage ?? 12) === 12)
      if (selLedStrip?.power_per_meter) {
        const perimM = 2 * (width + height) / 1000
        const needed = selLedStrip.power_per_meter * perimM / 0.8
        const fitPsu = psus12
          .filter(c => (c.max_power ?? 0) >= needed)
          .sort((a, b) => (a.max_power ?? 0) - (b.max_power ?? 0))
        const lcPsu = fitPsu[0]
          ?? psus12.sort((a, b) => (b.max_power ?? 0) - (a.max_power ?? 0))[0]
          ?? null
        if (lcPsu) selPowerSupply = toLightingComponent(lcPsu)
      } else {
        // No power_per_meter — fallback to first 12V PSU
        const lcPsu = psus12[0] ?? null
        if (lcPsu) selPowerSupply = toLightingComponent(lcPsu)
      }

      // Warn about missing individual components
      if (!selLedStrip)    mirrorWarnings.push('LED-лента не найдена в mirror_lighting_components. Стоимость подсветки может быть занижена.')
      if (!selFrame)       mirrorWarnings.push('Профиль подсветки не найден в mirror_lighting_components.')
      if (!selPowerSupply) mirrorWarnings.push('Блок питания не найден в mirror_lighting_components. Проверьте мощность LED и наличие БП.')
      if (!selDiffuser)    mirrorWarnings.push('Рассеиватель не найден в mirror_lighting_components.')

      // Always add standard-kit warning so the manager knows to review
      mirrorWarnings.push(
        'Подсветка рассчитана по стандартной комплектации: профиль, LED 12V, автоматический блок питания и рассеиватель. ' +
        'Проверьте состав вручную перед отправкой клиенту.',
      )
    }

    // Web calculator maps round shapes to 'complex' + substrate (bounding-box area, +1500 form, +2000 substrate)
    const isRound = options.shape === 'circle' || options.shape === 'oval'
    const calcShape: MirrorShape = isRound ? 'complex' : (options.shape as MirrorShape) ?? 'rectangle'

    const inputs: MirrorInputs = {
      width,
      height,
      mirrorMaterial,
      mirrorCostPerM2: mirrorCostPerM2 ?? undefined,
      mirrorWastePct,
      shape: calcShape,
      hasLighting: Boolean(options.hasLighting),
      frame:       options.hasLighting ? selFrame       : null,
      ledStrip:    options.hasLighting ? selLedStrip    : null,
      powerSupply: options.hasLighting ? selPowerSupply : null,
      diffuser:    options.hasLighting ? selDiffuser    : null,
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
      tax: cfg?.tax_percent ?? 12,
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
    // Детерминизм: те же источники, что и UI-калькулятор душевой (см. lib/pricing/showerInputs).
    // Иначе цена AI-менеджера (Иван) расходится с ценой живого менеджера.
    const shower = await loadShowerExtra()
    const tier = options.tier ?? 'standard'
    const tierCfg = TIER_CONFIGS.find(t => t.value === tier)!
    const modelId = options.model ?? 'M2'
    const model =
      shower.showerModels.find(m => m.id === modelId) ??
      SHOWER_MODELS.find(m => m.id === modelId) ??
      SHOWER_MODELS.find(m => m.id === 'M2')!
    const colorValue = options.hardwareColor ?? 'chrome'
    const colorCfg = HARDWARE_COLORS.find(c => c.value === colorValue) ?? HARDWARE_COLORS[0]

    const glassType = options.glassType ?? DEFAULT_SHOWER_GLASS
    const thickness = 8
    const glassMatrixMap = buildGlassMatrixMap(glassMatrix)
    const glassCostPerM2 = resolveShowerGlassCostPerM2(glassMatrixMap, glassType, thickness, materials)
    const expensesPercent = resolveShowerExpensesPercent(settings, tier)
    const customHardwareCost = tier === 'budget'
      ? resolveBudgetHardwareCost(shower.budgetManualPrices, shower.hwColors, model.id, colorValue)
      : undefined

    const inputs: ShowerInputs = {
      tier,
      model,
      width,
      width2: options.width2 ?? width,
      height,
      glassCostPerM2,
      glassName: glassType,
      thickness,
      hardwareColor: colorValue,
      hardwareColorMultiplier: colorCfg.multiplier,
      withMounting: Boolean(options.withMounting),
      withDelivery: false,
      floors: 0,
      discount: 0,
      partnerPercent: 0,
      margin: shower.targetMargin,
      expensesPercent,
      hwTierMultiplier: tierCfg.hwMultiplier,
      customHardwareCost,
      minMargin: shower.minMargin,
      standardMargin: shower.targetMargin,
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
