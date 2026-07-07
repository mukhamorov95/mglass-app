// Изделия производства в B2B-калькуляторе: зеркало с подсветкой и лофт по
// ЦЕНЕ ПРОИЗВОДСТВА (production stage финмодели V2): себестоимость цеха →
// продажная цена производства = cost / (1 − production_margin − production_tax).
// M-Glass покупает готовое изделие у производства и продаёт/монтирует сам.
// Reuse: calculateMirrorUnified (factory cost) + calcFinancialModel + calculateLoft.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Material, Service, FinancialSettings } from '@/lib/types'
import type { MirrorLightingComponent } from '@/lib/mirrorCalculator'
import { calculateMirrorUnified } from '@/lib/pricing/calculateMirrorUnified'
import { calcFinancialModel } from '@/lib/pricing/financialModel'
import { calcLoftFactory, type LoftRates } from '@/lib/loftFactoryCalculator'
import { getMatrixPrice, getMatrixNames, getAvailableMm, type GlassMatrixRow } from '@/lib/glassMatrix'
import type { B2BOrderItem } from '@/lib/b2bCalculator'

export type PricingCfg = {
  productionTaxPercent: number
  productionMarginPercent: number
  factoryOverheadPercent: number
  scrapReservePercent: number
  packagingCostPerM2: number
}

const CFG_FALLBACK: PricingCfg = {
  productionTaxPercent: 12, productionMarginPercent: 40,
  factoryOverheadPercent: 20, scrapReservePercent: 5, packagingCostPerM2: 120,
}

type RawComponent = {
  id: number; component_type: 'frame' | 'led_strip' | 'power_supply' | 'diffuser'
  name: string; short_name: string | null; voltage: number | null; color_temp: number | null
  power_per_meter: number | null; max_power: number | null; cost_price: number; unit: string; active?: boolean
}

export type FactoryData = {
  retailMaterials: Material[]
  retailServices: Service[]
  finSettings: FinancialSettings | null
  components: RawComponent[]
  matrix: GlassMatrixRow[]
  mirrorCfg: PricingCfg
  loftCfg: PricingCfg
  mirrorNames: string[]
  loftGlasses: Material[]
  loftRates: LoftRates
}

function rowToCfg(r: Record<string, unknown> | null): PricingCfg {
  if (!r) return CFG_FALLBACK
  return {
    productionTaxPercent:    Number(r.production_tax_percent    ?? CFG_FALLBACK.productionTaxPercent),
    productionMarginPercent: Number(r.production_margin_percent ?? CFG_FALLBACK.productionMarginPercent),
    factoryOverheadPercent:  Number(r.factory_overhead_percent  ?? CFG_FALLBACK.factoryOverheadPercent),
    scrapReservePercent:     Number(r.scrap_reserve_percent     ?? CFG_FALLBACK.scrapReservePercent),
    packagingCostPerM2:      Number(r.packaging_cost_per_m2     ?? CFG_FALLBACK.packagingCostPerM2),
  }
}

// Ленивая загрузка розничных справочников (нужна только при выборе изделия).
export async function loadFactoryData(sb: SupabaseClient): Promise<FactoryData> {
  const [mats, svcs, fins, comps, mx, cfgs, lrs] = await Promise.all([
    sb.from('materials').select('*').eq('active', true),
    sb.from('services').select('*').eq('active', true),
    sb.from('financial_settings').select('*'),
    sb.from('mirror_lighting_components').select('*').eq('active', true),
    sb.from('glass_price_matrix').select('*'),
    sb.from('pricing_model_config_v2').select('*').in('product_category', ['mirror', 'loft']),
    sb.from('loft_rates').select('key, value'),
  ])
  let retailMaterials = (mats.data ?? []) as Material[]
  const finRows = (fins.data ?? []) as FinancialSettings[]
  const matrix = (mx.data ?? []) as GlassMatrixRow[]
  const cfgRows = (cfgs.data ?? []) as Record<string, unknown>[]
  const cfgFor = (cat: string) => rowToCfg(cfgRows.find(r => r.product_category === cat && r.active !== false) ?? null)

  // Стекло для лофта: в розничном справочнике materials стекла нет — синтезируем из
  // glass_price_matrix (COST-строки, 4 мм), как это делает /calculator/loft.
  if (!retailMaterials.some(m => m.category === 'стекло')) {
    const costRows = matrix.filter(r => r.price_type === 'cost' && r.category === 'glass')
    const saleRows = matrix.filter(r => r.price_type === 'sale' && r.category === 'glass')
    const synth: Material[] = []
    costRows.forEach((row, ri) => {
      const c4 = Number((row as unknown as Record<string, unknown>).t4) || 0
      if (c4 > 0) {
        const saleRow = saleRows.find(r => r.name === row.name) as unknown as Record<string, unknown> | undefined
        synth.push({
          id: -(ri * 100 + 4), name: `Стекло ${row.name} 4 мм`, short_name: null,
          category: 'стекло', unit: 'м²', cost_price: c4,
          sale_price: saleRow ? (Number(saleRow.t4) || 0) : 0,
          has_vat: false, vat_rate: 0, active: true, in_stock: true,
          comment: null, image_url: null, created_at: '', updated_at: '',
        } as Material)
      }
    })
    retailMaterials = [...retailMaterials, ...synth]
  }

  return {
    retailMaterials,
    retailServices: (svcs.data ?? []) as Service[],
    finSettings: finRows.find(s => s.product_type === 'loft') ?? finRows.find(s => s.tier === 'standard') ?? finRows[0] ?? null,
    components: (comps.data ?? []) as RawComponent[],
    matrix,
    mirrorCfg: cfgFor('mirror'),
    loftCfg:   cfgFor('loft'),
    mirrorNames: getMatrixNames(matrix, 'cost', 'mirror'),
    loftGlasses: retailMaterials.filter(m => m.category === 'стекло'),
    loftRates: Object.fromEntries(((lrs.data ?? []) as { key: string; value: number }[]).map(r => [r.key, Number(r.value)])),
  }
}

export function mirrorMms(data: FactoryData, name: string): number[] {
  return getAvailableMm(data.matrix, name, 'cost', 'mirror')
}

const toLC = (c: RawComponent): MirrorLightingComponent => ({
  id: c.id, name: c.name, cost_price: c.cost_price, unit: c.unit,
  voltage: c.voltage, color_temp: c.color_temp, power_per_meter: c.power_per_meter, max_power: c.max_power,
})

export type FactoryQuote = {
  label: string          // название позиции
  spec: string           // краткая комплектация для комментария
  areaPiece: number      // м² за штуку
  weightPerPiece: number // кг за штуку
  factoryCostPiece: number   // себестоимость производства за штуку
  prodPricePiece: number     // продажная цена производства за штуку
  marginPercent: number      // производственная маржа из конфига
  shape?: 'rect' | 'curved'  // криволинейный рез → станция «Криволинейка»
  costLines?: { name: string; qty: number; unit: string; total: number }[] // состав себестоимости (для владельца)
}

// Опции комплектации для UI: ленты (температура/вольтаж) и профили из справочника
export const ledOptions = (d: FactoryData) =>
  d.components.filter(c => c.component_type === 'led_strip')
export const frameOptions = (d: FactoryData) =>
  d.components.filter(c => c.component_type === 'frame')

// Зеркало с подсветкой: стандартная комплектация (профиль/лента/БП/рассеиватель — первые
// подходящие из справочника), себестоимость по COST-строке матрицы + factory overhead.
export function calcFactoryMirror(
  p: {
    widthMm: number; heightMm: number; mirrorName: string; mirrorMm: number
    hasLighting: boolean; buttonType: 'none' | 'sensor' | 'wave'
    ledId?: number | null      // лента (температура) из справочника; null = авто
    frameId?: number | null    // каркас (профиль сзади); null = авто; при curved не применяется
    curved?: boolean           // криволинейное — станция «Криволинейка» + форма complex
    underlayCost?: number      // криволинейный каркас: подложка от подрядчика (ЦНЦ), ₽ себестоимость
  },
  d: FactoryData,
): FactoryQuote | null {
  if (p.widthMm <= 0 || p.heightMm <= 0 || !p.mirrorName) return null
  const costRow = getMatrixPrice(d.matrix, p.mirrorName, p.mirrorMm as 4 | 5 | 6 | 8 | 10 | 12, 'cost', 'mirror')
  if (costRow == null || costRow <= 0) return null

  const stub = d.retailMaterials.find(m => m.category === 'зеркало') ?? null
  const led = (p.ledId ? d.components.find(c => c.component_type === 'led_strip' && c.id === p.ledId) : null)
    ?? d.components.find(c => c.component_type === 'led_strip' && c.voltage === 12) ?? null
  const voltage = (led?.voltage === 24 ? 24 : 12) as 12 | 24
  // Каркас: прямоугольное — алюминиевый профиль из справочника;
  // криволинейное — деревянная/ЦНЦ подложка от подрядчика (ввод стоимости), профиль не ставим.
  const frame = p.curved ? null
    : (p.frameId ? d.components.find(c => c.component_type === 'frame' && c.id === p.frameId) : null)
      ?? d.components.find(c => c.component_type === 'frame') ?? null
  const underlay = p.curved ? Math.max(0, p.underlayCost ?? 0) : 0
  const perimeter = 2 * (p.widthMm + p.heightMm) / 1000
  const needW = (led?.power_per_meter ?? 10) * perimeter
  const psus = d.components.filter(c => c.component_type === 'power_supply' && c.voltage === voltage)
  const psu = psus.find(c => (c.max_power ?? 0) >= needW) ?? psus[psus.length - 1] ?? null
  const diffuser = d.components.find(c => c.component_type === 'diffuser') ?? null

  const res = calculateMirrorUnified({
    width: p.widthMm, height: p.heightMm, shape: p.curved ? 'complex' : 'rectangle',
    mirrorMaterial: stub ? { ...stub, name: `${p.mirrorName} ${p.mirrorMm} мм` } : null,
    mirrorCostPriceCostRow: costRow,
    hasLighting: p.hasLighting, voltage,
    frame:       p.hasLighting ? (frame ? toLC(frame) : null) : null,
    ledStrip:    p.hasLighting ? (led ? toLC(led) : null) : null,
    powerSupply: p.hasLighting ? (psu ? toLC(psu) : null) : null,
    diffuser:    p.hasLighting ? (diffuser ? toLC(diffuser) : null) : null,
    buttonType: p.buttonType, hasSandblast: false,
    hasSubstrate: underlay > 0, substratePrice: underlay,
    hasFacet: false, facetTypeMm: null, facetCostPerM: 0,
    hasInstallation: false, hasDelivery: false,
    partnerPercent: 0, discount: 0,
    margin: d.mirrorCfg.productionMarginPercent, standardMargin: d.mirrorCfg.productionMarginPercent,
    tax: d.mirrorCfg.productionTaxPercent, minMargin: 0,
    productionConfig: {
      factoryOverheadPercent: d.mirrorCfg.factoryOverheadPercent,
      scrapReservePercent:    d.mirrorCfg.scrapReservePercent,
      packagingCostPerM2:     d.mirrorCfg.packagingCostPerM2,
    },
  }, d.retailMaterials, d.retailServices)
  if (!res) return null

  const fm = calcFinancialModel({
    directCost: res.directCost,
    marginPercent: d.mirrorCfg.productionMarginPercent,
    taxPercent: d.mirrorCfg.productionTaxPercent,
  })
  if (!fm) return null

  const tempLabel = led?.color_temp ? `${led.color_temp}K` : ''
  const specParts = [`${p.widthMm}×${p.heightMm} мм`]
  if (p.curved) specParts.push(`криволинейное${underlay > 0 ? ` · подложка подрядчика ${Math.round(underlay).toLocaleString('ru-RU')} ₽` : ''}`)
  if (p.hasLighting) {
    specParts.push(`лента: ${led?.short_name ?? led?.name ?? 'LED'}${tempLabel ? ` ${tempLabel}` : ''} ${voltage}V`)
    if (frame) specParts.push(`каркас: ${frame.short_name ?? frame.name}`)
    specParts.push(`БП ${psu?.short_name ?? psu?.name ?? ''}`.trim())
  }
  if (p.buttonType === 'sensor') specParts.push('сенсорная кнопка')
  if (p.buttonType === 'wave')   specParts.push('датчик взмаха')

  return {
    label: `${p.hasLighting ? 'Зеркало с подсветкой' : 'Зеркало'} ${p.mirrorName} ${p.mirrorMm} мм`,
    spec: specParts.join(' · '),
    areaPiece: res.area,
    weightPerPiece: Math.round(res.area * p.mirrorMm * 2.5 * 10) / 10,
    factoryCostPiece: Math.round(res.directCost),
    prodPricePiece: Math.round(fm.basePrice),
    marginPercent: d.mirrorCfg.productionMarginPercent,
    shape: p.curved ? 'curved' : 'rect',
    costLines: res.costLines.map(l => ({ name: l.name, qty: l.qty, unit: l.unit, total: Math.round(l.total) })),
  }
}

// Лофт: честная модель по конструктиву цеха (loftFactoryCalculator, ставки из
// loft_rates), продажная цена производства по production-марже конфига (loft).
export function calcFactoryLoft(
  p: { widthMm: number; heightMm: number; doors: 0 | 1 | 2; rowsPerLeaf: number; sections: number; divisions: number; glassId: number | null; tempering: boolean },
  d: FactoryData,
): FactoryQuote | null {
  if (p.widthMm <= 0 || p.heightMm <= 0) return null
  const glass = d.loftGlasses.find(m => m.id === p.glassId) ?? d.loftGlasses[0] ?? null
  if (!glass) return null
  const temperSvc = d.retailServices.find(s => s.name.toLowerCase().includes('закалка'))

  const res = calcLoftFactory({
    widthMm: p.widthMm, heightMm: p.heightMm,
    doors: p.doors, rowsPerLeaf: p.rowsPerLeaf,
    sections: p.sections, divisions: p.divisions,
    glassCostPerM2: glass.cost_price, glassName: glass.name,
    tempering: p.tempering, temperingCostPerM2: temperSvc?.cost_price ?? 0,
  }, d.loftRates)
  if (!res) return null

  const fm = calcFinancialModel({
    directCost: res.totalCost,
    marginPercent: d.loftCfg.productionMarginPercent,
    taxPercent: d.loftCfg.productionTaxPercent,
  })
  if (!fm) return null

  const kind = p.doors > 0 ? 'дверь' : 'перегородка'
  return {
    label: `Лофт-${kind} ${p.widthMm}×${p.heightMm} мм`,
    spec: res.spec,
    areaPiece: res.areaM2,
    weightPerPiece: res.weightKg,
    factoryCostPiece: res.totalCost,
    prodPricePiece: Math.round(fm.basePrice),
    marginPercent: d.loftCfg.productionMarginPercent,
    costLines: res.costLines.map(l => ({ name: l.name, qty: l.qty, unit: l.unit, total: l.total })),
  }
}

// Позиция просчёта из изделия производства. Цена позиции = продажная цена производства.
// НДС считаем как в остальном B2B (22% в цене). Себестоимость = factory cost.
export function factoryQuoteToItem(q: FactoryQuote, quantity: number, comment?: string): Omit<B2BOrderItem, 'localId'> {
  const qty = Math.max(1, quantity)
  const VAT = 22
  const saleIncVat = q.prodPricePiece * qty
  const saleExVat  = Math.round(saleIncVat * 100 / (100 + VAT))
  const costWithVat = q.factoryCostPiece * qty
  const inputVat    = Math.round(costWithVat * VAT / (100 + VAT))
  const costExVat   = costWithVat - inputVat
  const totalAreaNet = Math.round(q.areaPiece * qty * 10000) / 10000
  return {
    materialId: 0, materialName: q.label, category: 'изделие',
    thickness: 0, width: 0, height: 0, quantity: qty, wastePercent: 0,
    hasTempering: false, hasFacet: false, facetTypeMm: null, hasHoles: false, shape: q.shape ?? 'rect',
    services: [],
    areaPiece: q.areaPiece, totalAreaNet, totalAreaBilled: totalAreaNet,
    perimeterM: 0,
    weightPerM2: q.areaPiece > 0 ? Math.round(q.weightPerPiece / q.areaPiece * 10) / 10 : 0,
    totalWeight: Math.round(q.weightPerPiece * qty * 10) / 10,
    costMaterial: costWithVat, costTempering: 0, costFacet: 0, costEdge: 0, costTransport: 0, costPackaging: 0,
    saleFacet: 0,
    costWithVat, inputVat, costExVat,
    pricePerM2: q.areaPiece > 0 ? Math.round(q.prodPricePiece / q.areaPiece) : 0,
    margin: saleExVat > 0 ? Math.round((1 - costExVat / saleExVat) * 100) : 0,
    vatRate: VAT, servicesCost: 0,
    baseSaleExVat: saleExVat, saleExVat, outputVat: saleIncVat - saleExVat, saleIncVat,
    comment: [q.spec, comment].filter(Boolean).join(' · ') || undefined,
  }
}
