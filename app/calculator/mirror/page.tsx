'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { Material, Service, FinancialSettings, PartnerType, MirrorFrame, calcFrameCost, FRAME_COLORS } from '@/lib/types'
import { ProductionSettings, DEFAULT_PRODUCTION_SETTINGS } from '@/lib/calcServiceCost'
import PricingBlock from '@/components/PricingBlock'
import {
  calculateMirror, MirrorInputs, MirrorShape, MirrorResult,
  MirrorLightingComponent,
} from '@/lib/mirrorCalculator'
import type { FacetPrice } from '@/lib/b2bCalculator'
import { saveCalculation, updateCalculation } from '@/lib/saveCalculation'
import { useCart } from '@/lib/CartContext'
import CartSection from '@/components/CartSection'
import { useOwnerStrategy } from '@/lib/useOwnerStrategy'
import {
  loadGlassMatrix, loadWasteModifiers, getMatrixPrice, getWastePct,
  getMatrixNames, getAvailableMm, getShapeModifier,
  GlassMatrixRow, WasteModifier, MatrixMm,
} from '@/lib/glassMatrix'

type RawComponent = {
  id: number
  component_type: 'frame' | 'led_strip' | 'power_supply' | 'diffuser'
  name: string
  short_name: string | null
  description: string | null
  voltage: number | null
  color_temp: number | null
  power_per_meter: number | null
  max_power: number | null
  cost_price: number
  sale_price: number | null
  unit: string
  active: boolean
  sort_order: number
}

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }
function dn(c: { name: string; short_name?: string | null }): string {
  return c.short_name?.trim() || c.name
}

function toLC(c: RawComponent): MirrorLightingComponent {
  return {
    id: c.id, name: c.name, cost_price: c.cost_price, unit: c.unit,
    voltage: c.voltage, power_per_meter: c.power_per_meter, max_power: c.max_power,
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold text-[#a8a8a3] uppercase tracking-[0.09em] mb-3">{children}</p>
  )
}

function Divider() {
  return <div className="h-px bg-[#f0f0ee] -mx-4" />
}

function CheckBox({ value, onClick }: { value: boolean; onClick: () => void }) {
  return (
    <div onClick={onClick}
      className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 cursor-pointer transition-all
        ${value ? 'bg-[#111110] border-[#111110]' : 'border-[#d0d0cc] hover:border-[#9a9a95]'}`}>
      {value && (
        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </div>
  )
}

function OptionRow({ label, desc, value, onClick }: {
  label: string; desc?: string; value: boolean; onClick: () => void
}) {
  return (
    <div className="flex items-center justify-between cursor-pointer group py-0.5" onClick={onClick}>
      <div className="flex items-center gap-2.5">
        <CheckBox value={value} onClick={onClick} />
        <span className="text-xs text-[#2a2a28] group-hover:text-[#111110] transition-colors">{label}</span>
      </div>
      {desc && <span className="text-[11px] text-[#9a9a95] font-mono">{desc}</span>}
    </div>
  )
}

function PriceLine({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className={`text-xs ${accent ?? 'text-[#6b6b66]'}`}>{label}</span>
      <span className={`text-xs font-mono ${accent ?? 'text-[#4b4b47]'}`}>{value}</span>
    </div>
  )
}

function LightingAccordion({ label, isOpen, onToggle, summary, badge, children }: {
  label: string
  isOpen: boolean
  onToggle: () => void
  summary: string
  badge?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <button onClick={onToggle}
        className="w-full flex items-center justify-between py-2 text-left group transition-colors">
        <span className="text-xs font-medium text-[#4b4b47] group-hover:text-[#111110]">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#9a9a95] max-w-[140px] truncate">{summary}</span>
          {badge && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#f0f0ee] text-[#9a9a95] font-mono">{badge}</span>
          )}
          <svg className={`w-3 h-3 text-[#c4c4be] transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {isOpen && (
        <div className="pb-2">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function MirrorCalculatorPage() {
  const [materials, setMaterials]     = useState<Material[]>([])
  const [services, setServices]       = useState<Service[]>([])
  const [partners, setPartners]       = useState<PartnerType[]>([])
  const [settings, setSettings]       = useState<FinancialSettings | null>(null)
  const [matrix, setMatrix]           = useState<GlassMatrixRow[]>([])
  const [modifiers, setModifiers]     = useState<WasteModifier[]>([])
  const [components, setComponents]   = useState<RawComponent[]>([])
  const [mirrorFrames, setMirrorFrames] = useState<MirrorFrame[]>([])
  const [prodSettings, setProdSettings] = useState<ProductionSettings>(DEFAULT_PRODUCTION_SETTINGS)
  const [loading, setLoading]         = useState(true)

  const [copied, setCopied]           = useState(false)
  const [showCost, setShowCost]       = useState(false)
  const [showPricing, setShowPricing] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [savedId, setSavedId]         = useState<number | null>(null)
  const [addedToCart, setAddedToCart] = useState(false)
  const [clientName, setClientName]   = useState('')
  const [clientPhone, setClientPhone] = useState('')
  // Edit mode: set when opened via "Пересчитать" from a saved calculation
  const [editCalcId, setEditCalcId]               = useState<number | null>(null)
  const [editOrderGroupId, setEditOrderGroupId]   = useState<string | null>(null)
  const { addItem } = useCart()
  const { strategy } = useOwnerStrategy()

  // Accordion state for lighting sub-sections
  const [lightOpen, setLightOpen] = useState<Set<string>>(new Set(['led']))
  function toggleLight(k: string) {
    setLightOpen(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  }

  // Dimensions
  const [width, setWidth]   = useState('1000')
  const [height, setHeight] = useState('1000')

  // Mirror
  const [mirrorName, setMirrorName] = useState<string>('')
  const [mirrorMm, setMirrorMm]     = useState<MatrixMm>(4)
  const [shape, setShape]           = useState<MirrorShape>('rectangle')

  // Lighting
  const [hasLighting, setHasLighting]   = useState(true)
  const [voltage, setVoltage]           = useState<12 | 24>(12)
  const [frameId, setFrameId]           = useState<number | null>(null)
  const [ledStripId, setLedStripId]     = useState<number | null>(null)
  const [psuId, setPsuId]               = useState<number | null>(null)
  const [diffuserId, setDiffuserId]     = useState<number | null>(null)
  const [buttonType, setButtonType]     = useState<'none' | 'sensor' | 'wave'>('none')

  // Decorative frame
  const [hasFrame, setHasFrame]         = useState(false)
  const [mirrorFrameId, setMirrorFrameId] = useState<number | null>(null)

  // Options
  const [hasSandblast, setHasSandblast]     = useState(false)
  const [hasSubstrate, setHasSubstrate]     = useState(false)
  const [substratePrice, setSubstratePrice] = useState('2000')
  const [hasFacet, setHasFacet]             = useState(false)
  const [facetTypeMm, setFacetTypeMm]       = useState<number>(10)
  const [facetPrices, setFacetPrices]       = useState<FacetPrice[]>([])

  // Services
  const [hasInstallation, setHasInstallation] = useState(false)
  const [hasDelivery, setHasDelivery]         = useState(false)
  const [kmFromMkad, setKmFromMkad]           = useState('')
  const [deliveryBase, setDeliveryBase]       = useState(2000)
  const [deliveryPerKm, setDeliveryPerKm]     = useState(50)

  // Commercial
  const [partnerId, setPartnerId] = useState<number | null>(null)
  const [discount, setDiscount]   = useState('0')
  const [margin, setMargin]       = useState('40')

  useEffect(() => { setMargin(String(strategy.target_margin)) }, [strategy.target_margin])

  useEffect(() => {
    async function load() {
      const sb = createClient()
      const [{ data: mats }, { data: svcs }, { data: fins }, { data: pts }, { data: comps }, { data: mframes }, { data: psData }, { data: facetData }, mx, mods, delivRes] = await Promise.all([
        sb.from('materials').select('*').eq('active', true).order('category').order('name'),
        sb.from('services').select('*').eq('active', true),
        sb.from('financial_settings').select('*'),
        sb.from('partner_types').select('*').eq('active', true),
        sb.from('mirror_lighting_components').select('*').eq('active', true).order('sort_order').order('id'),
        sb.from('mirror_frames').select('*').eq('active', true).order('sort_order').order('id'),
        sb.from('production_settings').select('*').eq('id', 1).maybeSingle(),
        sb.from('facet_prices').select('*').eq('active', true).order('type_mm'),
        loadGlassMatrix(),
        loadWasteModifiers(),
        fetch('/api/admin/pricing-formula'),
      ])
      setMaterials(mats ?? [])
      setServices(svcs ?? [])
      setPartners(pts ?? [])
      const rawComps = (comps ?? []) as RawComponent[]
      setComponents(rawComps)
      setMirrorFrames((mframes ?? []) as MirrorFrame[])
      if (psData) setProdSettings(psData as ProductionSettings)
      if (facetData) setFacetPrices((facetData as FacetPrice[]).filter(f => f.active !== false))

      if (delivRes.ok) {
        const formula = await delivRes.json() as { section: string; param_key: string; value: number }[]
        const bp = formula.find(p => p.section === 'delivery' && p.param_key === 'base_price')?.value
        const pk = formula.find(p => p.section === 'delivery' && p.param_key === 'price_per_km')?.value
        if (bp != null) setDeliveryBase(bp)
        if (pk != null) setDeliveryPerKm(pk)
      }
      setMatrix(mx)
      setModifiers(mods)

      const mirrorSettings =
        (fins ?? []).find((s: FinancialSettings) => s.product_type === 'mirror_light') ??
        (fins ?? []).find((s: FinancialSettings) => s.tier === 'standard') ??
        fins?.[0] ?? null
      setSettings(mirrorSettings as FinancialSettings | null)

      const names = getMatrixNames(mx, 'cost', 'mirror')
      if (names.length) {
        setMirrorName(names[0])
        const avail = getAvailableMm(mx, names[0], 'cost', 'mirror')
        setMirrorMm(avail[0] ?? 4 as MatrixMm)
      }

      const frames = rawComps.filter(c => c.component_type === 'frame')
      if (frames.length) setFrameId(frames[0].id)
      const leds12 = rawComps.filter(c => c.component_type === 'led_strip' && c.voltage === 12)
      if (leds12.length) setLedStripId(leds12[0].id)
      const diffs = rawComps.filter(c => c.component_type === 'diffuser')
      if (diffs.length) setDiffuserId(diffs[0].id)

      // Apply prefill from detail page "Пересчитать" button
      try {
        const raw = sessionStorage.getItem('mglass_mirror_prefill')
        if (raw) {
          sessionStorage.removeItem('mglass_mirror_prefill')
          const p = JSON.parse(raw) as Record<string, unknown>
          if (p.width)        setWidth(String(p.width))
          if (p.height)       setHeight(String(p.height))
          if (p.mirrorName)   setMirrorName(p.mirrorName as string)
          if (p.mirrorMm)     setMirrorMm(p.mirrorMm as MatrixMm)
          if (p.shape)        setShape(p.shape as MirrorShape)
          if (p.hasLighting != null) setHasLighting(Boolean(p.hasLighting))
          if (p.voltage)      setVoltage(p.voltage as 12 | 24)
          if (p.frameId)      setFrameId(p.frameId as number)
          if (p.ledStripId)   setLedStripId(p.ledStripId as number)
          if (p.psuId)        setPsuId(p.psuId as number)
          if (p.diffuserId)   setDiffuserId(p.diffuserId as number)
          if (p.buttonType)   setButtonType(p.buttonType as 'none' | 'sensor' | 'wave')
          if (p.hasSandblast != null) setHasSandblast(Boolean(p.hasSandblast))
          if (p.hasSubstrate != null) setHasSubstrate(Boolean(p.hasSubstrate))
          if (p.hasFrame != null)    setHasFrame(Boolean(p.hasFrame))
          if (p.mirrorFrameId)       setMirrorFrameId(p.mirrorFrameId as number)
          if (p.__editCalcId__)    setEditCalcId(p.__editCalcId__ as number)
          if (p.__order_group_id__) setEditOrderGroupId(p.__order_group_id__ as string)
        }
      } catch {}

      setLoading(false)
    }
    load()
  }, [])

  function handleMirrorNameChange(name: string) {
    setMirrorName(name)
    const avail = getAvailableMm(matrix, name, 'cost', 'mirror')
    if (!avail.includes(mirrorMm)) setMirrorMm(avail[0] ?? 4 as MatrixMm)
  }

  useEffect(() => {
    if (components.length === 0) return
    const leds = components.filter(c => c.component_type === 'led_strip' && c.voltage === voltage)
    if (leds.length) setLedStripId(leds[0].id)
    else setLedStripId(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voltage])

  useEffect(() => {
    if (!hasLighting) { setPsuId(null); return }
    const led = components.find(c => c.id === ledStripId)
    if (!led?.power_per_meter) { setPsuId(null); return }
    const perim = (2 * ((Number(width) || 0) + (Number(height) || 0))) / 1000
    const needed = led.power_per_meter * perim / 0.8
    const psus = components
      .filter(c => c.component_type === 'power_supply' && c.voltage === voltage && (c.max_power ?? 0) >= needed)
      .sort((a, b) => (a.max_power ?? 0) - (b.max_power ?? 0))
    if (psus.length) setPsuId(psus[0].id)
    else {
      const fallback = components
        .filter(c => c.component_type === 'power_supply' && c.voltage === voltage)
        .sort((a, b) => (b.max_power ?? 0) - (a.max_power ?? 0))
      setPsuId(fallback[0]?.id ?? null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLighting, ledStripId, voltage, width, height, components])

  // Derived
  const mirrorNames     = getMatrixNames(matrix, 'cost', 'mirror')
  const availMm         = getAvailableMm(matrix, mirrorName, 'cost', 'mirror')
  const mirrorCostPerM2 = getMatrixPrice(matrix, mirrorName, mirrorMm, 'cost', 'mirror')
  const mirrorSalePerM2 = getMatrixPrice(matrix, mirrorName, mirrorMm, 'sale', 'mirror')
  const mirrorWastePct  = getWastePct(matrix, mirrorName, 'mirror')
  const shapeModPct     = shape === 'complex' ? getShapeModifier(modifiers, 'complex') : 0
  const mirrorMatStub   = materials.find(m => m.category === 'зеркало') ?? null

  const frames    = components.filter(c => c.component_type === 'frame')
  const leds      = components.filter(c => c.component_type === 'led_strip' && c.voltage === voltage)
  const psus      = components.filter(c => c.component_type === 'power_supply' && c.voltage === voltage)
  const diffusers = components.filter(c => c.component_type === 'diffuser')

  const selFrame    = components.find(c => c.id === frameId)    ?? null
  const selLed      = components.find(c => c.id === ledStripId) ?? null
  const selPsu      = components.find(c => c.id === psuId)      ?? null
  const selDiffuser = components.find(c => c.id === diffuserId) ?? null

  const perimeterM    = (2 * ((Number(width) || 0) + (Number(height) || 0))) / 1000
  const totalLedWatts = selLed?.power_per_meter ? selLed.power_per_meter * perimeterM : 0
  const psuLoadPct    = selPsu?.max_power && totalLedWatts > 0
    ? Math.round(totalLedWatts / selPsu.max_power * 100) : 0

  const selectedMirrorFrame = hasFrame ? (mirrorFrames.find(f => f.id === mirrorFrameId) ?? null) : null
  const frameMinuteRate = prodSettings.worker_monthly_salary /
    (prodSettings.working_days_per_month * prodSettings.working_hours_per_day * 60)
  const frameSaleMinuteRate = frameMinuteRate *
    (1 + prodSettings.overhead_percent / 100) *
    (1 + prodSettings.default_margin_percent / 100)
  const selectedPartner = partners.find(p => p.id === partnerId) ?? null
  const minMargin       = strategy.min_margin
  const standardMargin  = strategy.target_margin
  const expensesPercent = settings?.tax_percent ?? 12
  const km = Number(kmFromMkad) || 0
  const deliveryCost = hasDelivery && km > 0 ? Math.round(deliveryBase + deliveryPerKm * km) : undefined

  const inputs: MirrorInputs = {
    width: Number(width) || 0, height: Number(height) || 0,
    mirrorMaterial: mirrorMatStub
      ? { ...mirrorMatStub, name: mirrorName ? `${mirrorName} ${mirrorMm} мм` : mirrorMatStub.name }
      : null,
    mirrorCostPerM2: mirrorSalePerM2 ?? mirrorCostPerM2,
    mirrorWastePct, shapeModifierPct: shapeModPct, shape,
    hasLighting, voltage,
    frame:       hasLighting && selFrame    ? toLC(selFrame)    : null,
    ledStrip:    hasLighting && selLed      ? toLC(selLed)      : null,
    powerSupply: hasLighting && selPsu      ? toLC(selPsu)      : null,
    diffuser:    hasLighting && selDiffuser ? toLC(selDiffuser) : null,
    mirrorFrame: selectedMirrorFrame,
    frameAssemblyMinuteRate: frameMinuteRate,
    frameAssemblySaleMinuteRate: frameSaleMinuteRate,
    buttonType, hasSandblast, hasSubstrate,
    substratePrice: Number(substratePrice) || 0,
    hasFacet, facetTypeMm: hasFacet ? facetTypeMm : null,
    facetCostPerM: (() => { const fp = facetPrices.find(f => f.type_mm === facetTypeMm); return fp ? fp.cost_price + fp.transport_cost : 0 })(),
    facetSalePerM: facetPrices.find(f => f.type_mm === facetTypeMm)?.sale_price ?? 0,
    hasInstallation, hasDelivery, deliveryCost,
    partnerPercent: selectedPartner?.percent ?? 0,
    discount: Number(discount) || 0,
    margin: Number(margin) || 40,
    standardMargin, tax: expensesPercent, minMargin,
  }

  const result: MirrorResult | null = useMemo(
    () => calculateMirror(inputs, materials, services),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, height, mirrorName, mirrorMm, mirrorCostPerM2, mirrorSalePerM2, mirrorWastePct, shapeModPct,
     shape, hasLighting, voltage, frameId, ledStripId, psuId, diffuserId,
     buttonType, hasSandblast, hasSubstrate, substratePrice,
     hasFacet, facetTypeMm, facetPrices,
     hasFrame, mirrorFrameId,
     hasInstallation, hasDelivery, kmFromMkad, deliveryCost, partnerId, discount, margin, materials, services],
  )

  const marginNum   = result?.margin ?? 0
  const isGreen     = marginNum >= 35
  const isAmber     = !isGreen && marginNum >= minMargin
  const priceColor  = isGreen ? 'text-emerald-600' : isAmber ? 'text-amber-600' : 'text-red-600'
  const marginBadge = isGreen ? 'bg-emerald-50 text-emerald-600' : isAmber ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'
  const discountExceeded = Number(discount) > strategy.max_manager_discount

  const sensorBtn     = materials.find(m => m.name.toLowerCase().includes('сенсорная кнопка') && m.active)
  const waveBtn       = materials.find(m => m.name.toLowerCase().includes('датчик взмаха')    && m.active)
  const installSvc    = services.find(s => s.name.toLowerCase().includes('монтаж зеркала'))
  const deliverySvc   = services.find(s => s.name.toLowerCase().includes('доставка'))
  const sandblastMat  = materials.find(m => m.name.toLowerCase().includes('пескоструй') && m.active)
  const sandblastPrice = sandblastMat?.cost_price ?? 1200

  function handleAddToCart() {
    if (!result) return
    addItem({
      product_type: 'mirror',
      label: `${mirrorName || 'Зеркало'} ${mirrorMm} мм ${width}×${height} мм`,
      input_data: { width, height, mirrorName, mirrorMm, shape, hasLighting, buttonType, hasSandblast, hasSubstrate },
      cost_breakdown: { lines: result.costLines, totalCost: result.totalCost },
      financial_breakdown: {
        expensesPercent: result.expensesPercent, expensesAmount: result.expensesAmount,
        basePrice: result.basePrice, partnerAmount: result.partnerAmount,
        discountAmount: result.discountAmount, serviceLines: result.serviceLines,
        servicesTotal: result.servicesTotal,
      },
      base_price: result.basePrice, discount: inputs.discount,
      partner_percent: inputs.partnerPercent,
      final_price: result.finalPrice, grand_total: result.grandTotal,
      margin: result.margin, profit: result.profit,
      manager_bonus: result.managerBonus, client_text: result.clientText,
    })
    setMargin('40')
    setAddedToCart(true)
    setTimeout(() => setAddedToCart(false), 2000)
  }

  async function handleSave() {
    if (!result || discountExceeded) return
    setSaving(true)

    const payload = {
      product_type: 'mirror' as const,
      input_data: { width, height, mirrorName, mirrorMm, shape, hasLighting, voltage, frameId, ledStripId, psuId, diffuserId, buttonType, hasSandblast, hasSubstrate, hasFrame, mirrorFrameId },
      cost_breakdown: { lines: result.costLines, totalCost: result.totalCost },
      financial_breakdown: {
        expensesPercent: result.expensesPercent, expensesAmount: result.expensesAmount,
        basePrice: result.basePrice, partnerAmount: result.partnerAmount,
        discountAmount: result.discountAmount, serviceLines: result.serviceLines,
        servicesTotal: result.servicesTotal,
      },
      base_price: result.basePrice, discount: inputs.discount,
      partner_percent: inputs.partnerPercent,
      final_price: result.grandTotal, margin: result.margin,
      profit: result.profit, manager_bonus: result.managerBonus,
      client_text: result.clientText,
      client_name: clientName.trim() || undefined,
      client_phone: clientPhone.trim() || undefined,
    }

    if (editCalcId) {
      // Edit mode: update the existing calculation in place
      const res = await updateCalculation(editCalcId, payload)
      if (res && 'id' in res) {
        setSavedId(res.id ?? null)
        // Return to the calculation detail page after successful update
        setTimeout(() => { window.location.href = `/calculations/${editCalcId}` }, 800)
      }
    } else {
      const saved = await saveCalculation({
        ...payload,
        order_group_id: editOrderGroupId ?? undefined,
      })
      if (saved && 'id' in saved) setSavedId(saved.id ?? null)
    }
    setSaving(false)
  }

  async function handleCopy() {
    if (!result) return
    await navigator.clipboard.writeText(result.clientText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  if (loading) return (
    <div className="min-h-screen bg-[#f7f7f6] flex items-center justify-center">
      <div className="flex items-center gap-2 text-[#9a9a95] text-xs">
        <div className="w-4 h-4 border-2 border-[#d0d0cc] border-t-[#9a9a95] rounded-full animate-spin" />
        Загрузка...
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f7f7f6]">
      <div className="max-w-[1080px] mx-auto px-4 py-4">

        {/* Header */}
        <div className="flex items-center gap-1.5 mb-4">
          <a href="/" className="text-[11px] text-[#9a9a95] hover:text-[#6b6b66] transition-colors">← Главная</a>
          <span className="text-[#ddd]">/</span>
          <h1 className="text-sm font-semibold text-[#111110]">Зеркало с подсветкой</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_304px] gap-3 items-start">

          {/* ── LEFT: Configurator ─────────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-[#e8e8e5] overflow-hidden divide-y divide-[#f2f2f0]">

            {/* ① ИЗДЕЛИЕ */}
            <div className="p-4">
              <SectionLabel>Изделие</SectionLabel>
              <div className="grid grid-cols-[auto_1fr_auto] gap-5 items-start">

                {/* Dimensions */}
                <div>
                  <p className="text-[10px] text-[#a8a8a3] mb-1.5">Размеры, мм</p>
                  <div className="flex items-center gap-1.5">
                    <input type="number" value={width} onChange={e => setWidth(e.target.value)}
                      className="w-[76px] h-8 border border-[#e8e8e5] rounded-lg px-2 text-sm font-mono text-center focus:outline-none focus:border-[#9a9a95] bg-[#fafaf9] transition-colors" />
                    <span className="text-sm text-[#c4c4be]">×</span>
                    <input type="number" value={height} onChange={e => setHeight(e.target.value)}
                      className="w-[76px] h-8 border border-[#e8e8e5] rounded-lg px-2 text-sm font-mono text-center focus:outline-none focus:border-[#9a9a95] bg-[#fafaf9] transition-colors" />
                  </div>
                  {result && (
                    <p className="text-[10px] text-[#a8a8a3] mt-1.5 leading-snug">
                      {result.area} м² · {result.perimeter} пм
                      {result.totalWastePct > 0 && (
                        <> · <span className="text-amber-500">расход {result.totalWastePct}% → {result.billingArea} м²</span></>
                      )}
                    </p>
                  )}
                </div>

                {/* Mirror type */}
                <div>
                  <p className="text-[10px] text-[#a8a8a3] mb-1.5">Тип зеркала</p>
                  <div className="flex flex-wrap gap-1">
                    {mirrorNames.map(name => {
                      const n = name.toLowerCase()
                      const dot = n.includes('серебр') ? 'bg-slate-400' : n.includes('осветл') ? 'bg-sky-400' : 'bg-amber-400'
                      const active = mirrorName === name
                      return (
                        <button key={name} onClick={() => handleMirrorNameChange(name)}
                          className={`flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs font-medium border transition-all ${
                            active ? 'bg-[#111110] text-white border-[#111110]'
                                   : 'border-[#e8e8e5] text-[#4b4b47] hover:border-[#b8b8b4] bg-white'
                          }`}>
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
                          {name}
                        </button>
                      )
                    })}
                  </div>
                  {availMm.length > 1 && (
                    <div className="flex gap-1 mt-1.5">
                      {availMm.map(mm => (
                        <button key={mm} onClick={() => setMirrorMm(mm)}
                          className={`h-6 px-2.5 rounded-md text-[11px] font-medium border transition-all ${
                            mirrorMm === mm ? 'bg-[#111110] text-white border-[#111110]'
                                           : 'border-[#e8e8e5] text-[#6b6b66] hover:border-[#9a9a95]'
                          }`}>
                          {mm} мм
                        </button>
                      ))}
                    </div>
                  )}
                  {mirrorCostPerM2 != null && (
                    <p className="text-[10px] text-[#b8b8b4] mt-1.5">
                      Себест. {mirrorCostPerM2.toLocaleString('ru-RU')} ₽/м²
                      {mirrorSalePerM2 != null && mirrorSalePerM2 !== mirrorCostPerM2 && (
                        <> · продажн. {mirrorSalePerM2.toLocaleString('ru-RU')} ₽/м²</>
                      )}
                    </p>
                  )}
                </div>

                {/* Shape */}
                <div>
                  <p className="text-[10px] text-[#a8a8a3] mb-1.5">Форма</p>
                  <div className="flex flex-col gap-1">
                    {([
                      { v: 'rectangle', l: 'Прямоугольник' },
                      { v: 'complex',   l: 'Сложная форма' },
                    ] as { v: MirrorShape; l: string }[]).map(s => (
                      <button key={s.v} onClick={() => setShape(s.v)}
                        className={`h-7 px-3 rounded-lg text-xs font-medium border transition-all text-left whitespace-nowrap ${
                          shape === s.v ? 'bg-[#111110] text-white border-[#111110]'
                                       : 'border-[#e8e8e5] text-[#6b6b66] hover:border-[#b8b8b4] bg-white'
                        }`}>
                        {s.l}
                        {s.v === 'complex' && shapeModPct > 0 && shape === 'complex' && (
                          <span className="ml-1 opacity-50 text-[10px]">+{shapeModPct}%</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ② ПОДСВЕТКА */}
            <div className="p-4">
              {/* Section header + controls */}
              <div className="flex items-center justify-between mb-3">
                <SectionLabel>Подсветка</SectionLabel>
                <div className="flex items-center gap-2.5 -mt-3">
                  {hasLighting && (
                    <div className="flex bg-[#f2f2f0] rounded-lg p-0.5">
                      {([12, 24] as const).map(v => (
                        <button key={v} onClick={() => setVoltage(v)}
                          className={`px-3 py-0.5 rounded-md text-[11px] font-semibold transition-all ${
                            voltage === v ? 'bg-white text-[#111110] shadow-sm' : 'text-[#9a9a95] hover:text-[#6b6b66]'
                          }`}>
                          {v}V
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={() => setHasLighting(!hasLighting)}
                    className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${hasLighting ? 'bg-[#111110]' : 'bg-[#d0d0cc]'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${hasLighting ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              </div>

              {!hasLighting && (
                <p className="text-xs text-[#a8a8a3]">Зеркало без подсветки</p>
              )}

              {hasLighting && (
                <div className="space-y-0 divide-y divide-[#f5f5f3]">

                  {/* LED strip — most important, default open */}
                  <LightingAccordion
                    label="LED-лента"
                    isOpen={lightOpen.has('led')}
                    onToggle={() => toggleLight('led')}
                    summary={selLed ? dn(selLed) : leds.length === 0 ? 'нет позиций' : 'не выбрана'}
                    badge={totalLedWatts > 0 ? `${totalLedWatts.toFixed(0)} Вт` : undefined}
                  >
                    {leds.length === 0 ? (
                      <p className="text-xs text-[#9a9a95] py-1">
                        Нет лент для {voltage}V.{' '}
                        <a href="/admin/mirror-lighting" className="text-blue-500 hover:underline">Добавить в справочник →</a>
                      </p>
                    ) : (
                      <div className="space-y-px pt-1">
                        {leds.map(l => {
                          const temp = l.color_temp
                          const tempDot = temp === 3000 ? 'bg-amber-400' : temp === 4000 ? 'bg-yellow-200 border border-yellow-400' : 'bg-sky-300'
                          const tempLabel = temp === 3000 ? 'тёплый' : temp === 4000 ? 'нейтральный' : 'холодный'
                          const active = ledStripId === l.id
                          return (
                            <label key={l.id}
                              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${active ? 'bg-[#f4f4f2]' : 'hover:bg-[#fafaf9]'}`}>
                              <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${active ? 'border-[#111110]' : 'border-[#d0d0cc]'}`}>
                                {active && <div className="w-1.5 h-1.5 bg-[#111110] rounded-full" />}
                              </div>
                              <input type="radio" className="hidden" checked={active} onChange={() => setLedStripId(l.id)} />
                              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${tempDot}`} />
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-medium text-[#2a2a28]">{dn(l)}</span>
                                {temp && <span className="text-[10px] text-[#9a9a95] ml-1.5">{tempLabel}</span>}
                              </div>
                              <div className="text-right flex-shrink-0">
                                <p className="text-[11px] font-mono text-[#4b4b47]">{l.cost_price} ₽/м</p>
                                {perimeterM > 0 && l.power_per_meter && (
                                  <p className="text-[10px] text-[#b8b8b4]">{(l.power_per_meter * perimeterM).toFixed(0)} Вт</p>
                                )}
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </LightingAccordion>

                  {/* Frame */}
                  <LightingAccordion
                    label="Каркас (профиль)"
                    isOpen={lightOpen.has('frame')}
                    onToggle={() => toggleLight('frame')}
                    summary={selFrame ? dn(selFrame) : frames.length === 0 ? 'нет позиций' : '—'}
                    badge={selFrame ? `${selFrame.cost_price} ₽/м` : undefined}
                  >
                    {frames.length === 0 ? (
                      <p className="text-xs text-[#9a9a95] py-1">
                        <a href="/admin/mirror-lighting" className="text-blue-500 hover:underline">Добавить в справочник →</a>
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {frames.map(f => (
                          <button key={f.id} onClick={() => setFrameId(f.id)}
                            className={`h-7 px-3 rounded-lg text-[11px] font-medium border transition-all ${
                              frameId === f.id ? 'bg-[#111110] text-white border-[#111110]'
                                             : 'border-[#e8e8e5] text-[#6b6b66] hover:border-[#b8b8b4]'
                            }`}>
                            {dn(f)}
                            <span className={`ml-1.5 text-[10px] ${frameId === f.id ? 'opacity-50' : 'text-[#9a9a95]'}`}>{f.cost_price}₽</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </LightingAccordion>

                  {/* PSU */}
                  <LightingAccordion
                    label="Блок питания"
                    isOpen={lightOpen.has('psu')}
                    onToggle={() => toggleLight('psu')}
                    summary={selPsu ? dn(selPsu) : psus.length === 0 ? `нет для ${voltage}V` : '—'}
                    badge={psuLoadPct > 0 ? `${psuLoadPct}% нагр.` : undefined}
                  >
                    {psus.length === 0 ? (
                      <p className="text-xs text-[#9a9a95] py-1">Нет БП для {voltage}V</p>
                    ) : (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {psus.map(p => (
                          <button key={p.id} onClick={() => setPsuId(p.id)}
                            className={`h-7 px-3 rounded-lg text-[11px] font-medium border transition-all ${
                              psuId === p.id ? 'bg-[#111110] text-white border-[#111110]'
                                           : 'border-[#e8e8e5] text-[#6b6b66] hover:border-[#b8b8b4]'
                            }`}>
                            {p.max_power} Вт
                            <span className={`ml-1.5 text-[10px] ${psuId === p.id ? 'opacity-50' : 'text-[#9a9a95]'}`}>{p.cost_price}₽</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {totalLedWatts > 0 && (
                      <p className="text-[10px] text-[#b8b8b4] mt-1.5">
                        Потребление {totalLedWatts.toFixed(0)} Вт · рекомендован ≥{(totalLedWatts / 0.8).toFixed(0)} Вт
                      </p>
                    )}
                  </LightingAccordion>

                  {/* Diffuser */}
                  <LightingAccordion
                    label="Рассеиватель"
                    isOpen={lightOpen.has('diff')}
                    onToggle={() => toggleLight('diff')}
                    summary={selDiffuser ? dn(selDiffuser) : '—'}
                    badge={selDiffuser?.cost_price ? `${selDiffuser.cost_price} ₽/м` : undefined}
                  >
                    <div className="flex flex-wrap gap-1 pt-1">
                      {diffusers.map(d => (
                        <button key={d.id} onClick={() => setDiffuserId(d.id)}
                          className={`h-7 px-3 rounded-lg text-[11px] font-medium border transition-all ${
                            diffuserId === d.id ? 'bg-[#111110] text-white border-[#111110]'
                                              : 'border-[#e8e8e5] text-[#6b6b66] hover:border-[#b8b8b4]'
                          }`}>
                          {dn(d)}
                        </button>
                      ))}
                    </div>
                  </LightingAccordion>

                  {/* Button */}
                  <LightingAccordion
                    label="Кнопка включения"
                    isOpen={lightOpen.has('btn')}
                    onToggle={() => toggleLight('btn')}
                    summary={buttonType === 'none' ? 'Не нужна' : buttonType === 'sensor' ? 'Сенсорная' : 'Взмах руки'}
                    badge={buttonType !== 'none' ? (buttonType === 'sensor' ? `${sensorBtn?.cost_price ?? 400} ₽` : `${waveBtn?.cost_price ?? 800} ₽`) : undefined}
                  >
                    <div className="flex gap-1 pt-1">
                      {([
                        { v: 'none',   l: 'Не нужна',   p: 0 },
                        { v: 'sensor', l: 'Сенсорная',  p: sensorBtn?.cost_price ?? 400 },
                        { v: 'wave',   l: 'Взмах руки', p: waveBtn?.cost_price ?? 800 },
                      ] as { v: 'none' | 'sensor' | 'wave'; l: string; p: number }[]).map(b => (
                        <button key={b.v} onClick={() => setButtonType(b.v)}
                          className={`flex-1 h-8 rounded-lg text-[11px] font-medium border transition-all ${
                            buttonType === b.v ? 'bg-[#111110] text-white border-[#111110]'
                                              : 'border-[#e8e8e5] text-[#6b6b66] hover:border-[#b8b8b4]'
                          }`}>
                          <span>{b.l}</span>
                          {b.p > 0 && <span className={`ml-1 text-[10px] ${buttonType === b.v ? 'opacity-50' : 'text-[#9a9a95]'}`}>{b.p}₽</span>}
                        </button>
                      ))}
                    </div>
                  </LightingAccordion>

                </div>
              )}
            </div>

            {/* ③ ОПЦИИ */}
            <div className="p-4">
              <SectionLabel>Опции</SectionLabel>
              <div className="space-y-2.5">
                <OptionRow label="Пескоструйный рисунок" desc={`${sandblastPrice.toLocaleString('ru-RU')} ₽/м²`} value={hasSandblast} onClick={() => setHasSandblast(!hasSandblast)} />
                <div className="flex items-center justify-between">
                  <OptionRow label="Подложка" value={hasSubstrate} onClick={() => setHasSubstrate(!hasSubstrate)} />
                  {hasSubstrate && (
                    <div className="flex items-center gap-1">
                      <input type="number" value={substratePrice} onChange={e => setSubstratePrice(e.target.value)}
                        className="w-20 h-7 border border-[#e8e8e5] rounded-lg px-2 text-xs font-mono text-right focus:outline-none focus:border-[#9a9a95] bg-[#fafaf9]" />
                      <span className="text-xs text-[#a8a8a3]">₽</span>
                    </div>
                  )}
                </div>

                {/* Facet */}
                {facetPrices.length > 0 && (
                  <>
                    <OptionRow
                      label="Фацет"
                      desc={hasFacet ? (() => { const fp = facetPrices.find(f => f.type_mm === facetTypeMm); return fp ? `${perimeterM.toFixed(2)} м × ${fp.sale_price} ₽` : '' })() : ''}
                      value={hasFacet}
                      onClick={() => {
                        const next = !hasFacet
                        setHasFacet(next)
                        if (next && facetPrices.length > 0 && !facetPrices.find(f => f.type_mm === facetTypeMm)) {
                          setFacetTypeMm(facetPrices[0].type_mm)
                        }
                      }}
                    />
                    {hasFacet && (
                      <div className="ml-6 flex gap-1 flex-wrap">
                        {facetPrices.map(f => (
                          <button key={f.type_mm} onClick={() => setFacetTypeMm(f.type_mm)}
                            className={`h-7 px-2.5 rounded-lg text-[11px] font-medium border transition-all ${
                              facetTypeMm === f.type_mm
                                ? 'bg-[#111110] text-white border-[#111110]'
                                : 'border-[#e8e8e5] text-[#4b4b47] hover:border-[#b8b8b4] bg-white'
                            }`}>
                            {f.type_mm} мм
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* Decorative frame */}
                <OptionRow
                  label="Декоративная рамка"
                  desc={mirrorFrames.length === 0 ? '' : selectedMirrorFrame ? `+${fmt(calcFrameCost(selectedMirrorFrame, Number(width) || 0, Number(height) || 0, frameMinuteRate, frameSaleMinuteRate).totalSale)}` : ''}
                  value={hasFrame}
                  onClick={() => {
                    const next = !hasFrame
                    setHasFrame(next)
                    if (next && mirrorFrames.length > 0 && !mirrorFrameId) {
                      setMirrorFrameId(mirrorFrames[0].id)
                    }
                  }}
                />
                {hasFrame && (
                  <div className="ml-6 mt-1.5 space-y-2">
                    {mirrorFrames.length === 0 ? (
                      <p className="text-xs text-[#9a9a95]">
                        Нет рамок в справочнике.{' '}
                        <a href="/admin/mirror-frames" className="text-blue-500 hover:underline">Добавить →</a>
                      </p>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-1">
                          {mirrorFrames.map(f => {
                            const colorEntry = FRAME_COLORS.find(c => c.value === f.color)
                            const active = mirrorFrameId === f.id
                            return (
                              <button key={f.id} onClick={() => setMirrorFrameId(f.id)}
                                className={`h-7 px-2.5 rounded-lg text-[11px] font-medium border transition-all text-left ${
                                  active ? 'bg-[#111110] text-white border-[#111110]'
                                         : 'border-[#e8e8e5] text-[#4b4b47] hover:border-[#b8b8b4] bg-white'
                                }`}>
                                {f.name}
                                {colorEntry && (
                                  <span className={`ml-1.5 text-[10px] ${active ? 'opacity-50' : 'text-[#9a9a95]'}`}>
                                    {colorEntry.label.toLowerCase()}
                                  </span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                        {selectedMirrorFrame && (() => {
                          const fc = calcFrameCost(selectedMirrorFrame, Number(width) || 0, Number(height) || 0, frameMinuteRate, frameSaleMinuteRate)
                          return (
                            <div className="text-[10px] text-[#9a9a95] space-y-0.5">
                              <p>Периметр {fc.perimeterM.toFixed(2)} м · профиль {fc.profileNeededM.toFixed(2)} м · {fc.whipsNeeded} хлыст{fc.whipsNeeded > 1 ? 'а' : ''} × {fc.whipLengthM} м</p>
                              <p>Остаток {fc.leftoverM.toFixed(2)} м · сборка {fc.totalMinutes} мин</p>
                              <p className="text-[#6b6b66]">Профиль {fc.profileCost.toLocaleString('ru-RU')} ₽ · сборка {fc.assemblySale.toLocaleString('ru-RU')} ₽ = <span className="font-semibold">{(fc.profileCost + fc.assemblySale).toLocaleString('ru-RU')} ₽</span></p>
                            </div>
                          )
                        })()}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ④ УСЛУГИ */}
            <div className="p-4">
              <SectionLabel>Услуги</SectionLabel>
              <div className="space-y-2.5">
                <OptionRow
                  label="Монтаж"
                  desc={installSvc ? fmt(installSvc.sale_price ?? installSvc.cost_price) : ''}
                  value={hasInstallation} onClick={() => setHasInstallation(!hasInstallation)}
                />
                <div>
                  <OptionRow
                    label="Доставка"
                    desc={km > 0
                      ? fmt(deliveryCost!)
                      : deliverySvc ? fmt(deliverySvc.sale_price ?? deliverySvc.cost_price) + ' · МСК' : ''}
                    value={hasDelivery} onClick={() => setHasDelivery(!hasDelivery)}
                  />
                  {hasDelivery && (
                    <div className="mt-1.5 ml-6 flex items-center gap-2">
                      <span className="text-[11px] text-[#a8a8a3]">км от МКАД</span>
                      <input type="number" min="0" max="200" value={kmFromMkad} onChange={e => setKmFromMkad(e.target.value)} placeholder="0"
                        className="w-14 h-6 border border-[#e8e8e5] rounded-md px-2 text-xs text-center focus:outline-none focus:border-[#9a9a95] bg-[#fafaf9]" />
                      {km > 0 && <span className="text-xs font-mono text-[#6b6b66]">{fmt(deliveryCost!)}</span>}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ⑤ УСЛОВИЯ */}
            {settings && (
              <div className="p-4">
                <SectionLabel>Коммерческие условия</SectionLabel>
                <PricingBlock
                  settings={settings}
                  margin={margin} onMarginChange={setMargin}
                  discount={discount} onDiscountChange={setDiscount}
                  partners={partners} partnerId={partnerId} onPartnerChange={setPartnerId}
                  actualMargin={result?.margin}
                />
              </div>
            )}
          </div>

          {/* ── RIGHT: Sticky results panel ──────────────────────────────── */}
          <div className="lg:sticky lg:top-3 space-y-2 self-start">

            {result ? (
              <>
                {/* ① Price card */}
                <div className="bg-white rounded-xl border border-[#e8e8e5] p-4">

                  {/* Main price */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-[10px] font-medium text-[#a8a8a3] uppercase tracking-[0.08em] mb-1">
                        {result.servicesTotal > 0 ? 'Итого с услугами' : 'Цена клиенту'}
                      </p>
                      <p className={`text-[26px] font-bold font-mono leading-none tracking-tight ${priceColor}`}>
                        {result.grandTotal.toLocaleString('ru-RU')} ₽
                      </p>
                    </div>
                    <div className={`px-2.5 py-1.5 rounded-lg text-sm font-bold flex-shrink-0 ${marginBadge}`}>
                      {result.margin}%
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-2 gap-3 pt-3 border-t border-[#f2f2f0]">
                    <div>
                      <p className="text-[10px] text-[#a8a8a3] mb-0.5">Прибыль</p>
                      <p className="text-sm font-mono font-semibold text-[#111110]">{fmt(result.profit)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-[#a8a8a3] mb-0.5">Себестоимость</p>
                      <p className="text-sm font-mono text-[#6b6b66]">{fmt(result.totalCost)}</p>
                    </div>
                  </div>

                  {result.belowMinMargin && (
                    <div className="mt-3 px-3 py-2 bg-red-50 rounded-lg border border-red-100">
                      <p className="text-xs text-red-600 font-medium">Маржа ниже минимума {minMargin}%</p>
                    </div>
                  )}
                </div>

                {/* ② Pricing breakdown */}
                <div className="bg-white rounded-xl border border-[#e8e8e5] overflow-hidden">
                  <button onClick={() => setShowPricing(!showPricing)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#fafaf9] transition-colors">
                    <p className="text-[10px] font-semibold text-[#a8a8a3] uppercase tracking-[0.08em]">Расчёт цены</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-[#9a9a95]">{fmt(result.basePrice)}</span>
                      <svg className={`w-3 h-3 text-[#c4c4be] transition-transform ${showPricing ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>
                  {showPricing && (
                    <div className="px-4 pb-3 border-t border-[#f5f5f3]">
                      <div className="space-y-1.5 mt-2.5">
                        <PriceLine label="Себестоимость"              value={fmt(result.totalCost)} />
                        <PriceLine label={`Налог ${expensesPercent}%`} value={fmt(result.expensesAmount)} />
                        <PriceLine label={`Маржа ${inputs.margin}%`}  value={fmt(result.marginAmount)} />
                        <div className="flex justify-between items-baseline pt-2 border-t border-[#f0f0ee]">
                          <span className="text-xs font-semibold text-[#2a2a28]">Базовая цена</span>
                          <span className="text-xs font-mono font-bold text-[#111110]">{fmt(result.basePrice)}</span>
                        </div>
                        {result.partnerAmount > 0 && (
                          <PriceLine label={`Партнёрка ${inputs.partnerPercent}%`}
                            value={`+${fmt(result.partnerAmount)}`} accent="text-purple-600" />
                        )}
                        {result.discountAmount > 0 && (
                          <PriceLine label={`Скидка ${inputs.discount}%`}
                            value={`−${fmt(result.discountAmount)}`} accent="text-orange-500" />
                        )}
                        <div className="flex justify-between items-baseline pt-2 border-t border-[#f0f0ee]">
                          <span className="text-xs font-semibold text-[#2a2a28]">Цена изделия</span>
                          <span className="text-xs font-mono font-bold text-[#111110]">{fmt(result.finalPrice)}</span>
                        </div>
                        {result.serviceLines.map((s, i) => (
                          <PriceLine key={i} label={s.name} value={fmt(s.total)} />
                        ))}
                      </div>
                      {/* +10% hint */}
                      {(() => {
                        const nm = inputs.margin + 10
                        const d  = 1 - nm / 100 - inputs.tax / 100
                        if (d <= 0) return null
                        const nb  = result.totalCost / d
                        const nwp = inputs.partnerPercent > 0 ? nb / (1 - inputs.partnerPercent / 100) : nb
                        const nf  = Math.round(nwp * (1 - inputs.discount / 100))
                        return (
                          <button onClick={() => setMargin(String(nm))}
                            className="mt-2.5 w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 hover:bg-emerald-100 transition-colors">
                            <span className="text-[11px] text-emerald-700 font-medium">Продать дороже +10%</span>
                            <div className="text-right">
                              <span className="text-[11px] font-mono font-bold text-emerald-700">{fmt(nf)}</span>
                              <span className="text-[10px] text-emerald-500 ml-1.5">+{fmt(nf - result.finalPrice)}</span>
                            </div>
                          </button>
                        )
                      })()}
                    </div>
                  )}
                </div>

                {/* ③ Cost breakdown */}
                <div className="bg-white rounded-xl border border-[#e8e8e5] overflow-hidden">
                  <button onClick={() => setShowCost(!showCost)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#fafaf9] transition-colors">
                    <p className="text-[10px] font-semibold text-[#a8a8a3] uppercase tracking-[0.08em]">Себестоимость</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-[#9a9a95]">{fmt(result.totalCost)}</span>
                      <svg className={`w-3 h-3 text-[#c4c4be] transition-transform ${showCost ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>
                  {showCost && (
                    <div className="px-4 pb-3 border-t border-[#f5f5f3] divide-y divide-[#f7f7f5]">
                      {result.costLines.map((line, i) => (
                        <div key={i} className="flex items-baseline justify-between py-1.5">
                          <div className="flex-1 min-w-0 pr-2">
                            <p className="text-xs text-[#4b4b47] truncate">{line.name}</p>
                            <p className="text-[10px] text-[#b8b8b4]">{line.qty} {line.unit} × {line.price.toLocaleString('ru-RU')} ₽</p>
                          </div>
                          <span className="text-xs font-mono font-semibold text-[#2a2a28] flex-shrink-0">
                            {line.total.toLocaleString('ru-RU')} ₽
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ④ KP text */}
                <div className="bg-white rounded-xl border border-[#e8e8e5] p-4">
                  <p className="text-[10px] font-semibold text-[#a8a8a3] uppercase tracking-[0.08em] mb-2.5">Текст КП</p>
                  <pre className="text-[11px] text-[#4b4b47] whitespace-pre-wrap font-sans leading-relaxed bg-[#f9f9f8] rounded-lg p-3 mb-3 border border-[#f0f0ee]">
                    {result.clientText}
                  </pre>
                  <button onClick={handleCopy}
                    className={`w-full h-8 rounded-lg text-[11px] font-medium border transition-colors ${
                      copied
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : 'border-[#e8e8e5] text-[#4b4b47] hover:bg-[#fafaf9]'
                    }`}>
                    {copied ? '✓ Скопировано' : 'Копировать КП'}
                  </button>
                </div>

                {/* ⑤ Client */}
                <div className="bg-white rounded-xl border border-[#e8e8e5] p-4">
                  <p className="text-[10px] font-semibold text-[#a8a8a3] uppercase tracking-[0.08em] mb-2.5">Клиент</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" value={clientName} onChange={e => setClientName(e.target.value)}
                      placeholder="Имя"
                      className="h-8 border border-[#e8e8e5] rounded-lg px-2.5 text-xs focus:outline-none focus:border-[#9a9a95] bg-[#fafaf9] transition-colors placeholder:text-[#c4c4be]" />
                    <input type="text" value={clientPhone} onChange={e => setClientPhone(e.target.value)}
                      placeholder="+7 (000) 000-00-00"
                      className="h-8 border border-[#e8e8e5] rounded-lg px-2.5 text-xs focus:outline-none focus:border-[#9a9a95] bg-[#fafaf9] transition-colors placeholder:text-[#c4c4be]" />
                  </div>
                </div>

                {/* ⑥ Actions */}
                <div className="space-y-1.5">
                  <button onClick={handleSave} disabled={saving || discountExceeded}
                    title={discountExceeded ? `Скидка превышает лимит ${strategy.max_manager_discount}%` : undefined}
                    className="w-full h-10 bg-[#111110] text-white rounded-xl text-sm font-semibold hover:bg-[#27272a] active:bg-[#3f3f46] disabled:opacity-40 transition-colors">
                    {saving
                      ? 'Сохранение...'
                      : savedId && editCalcId
                        ? `✓ Расчёт #${savedId} обновлён`
                        : savedId
                          ? `✓ Расчёт #${savedId} сохранён`
                          : editCalcId
                            ? `Обновить расчёт #${editCalcId}`
                            : 'Сохранить расчёт'
                    }
                  </button>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button onClick={handleCopy}
                      className="h-9 border border-[#e8e8e5] rounded-xl text-xs font-medium text-[#4b4b47] hover:bg-[#fafaf9] transition-colors">
                      {copied ? '✓ КП скопировано' : 'Копировать КП'}
                    </button>
                    <button onClick={handleAddToCart}
                      className={`h-9 rounded-xl text-xs font-medium border transition-colors ${
                        addedToCart
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'border-[#e8e8e5] text-[#4b4b47] hover:bg-[#fafaf9]'
                      }`}>
                      {addedToCart ? '✓ В корзине' : '+ В корзину'}
                    </button>
                  </div>
                </div>

                {/* What's Next */}
                {savedId && (
                  <div className="bg-[#f0f7ff] rounded-xl border border-[#c7dcf5] p-3">
                    <p className="text-[10px] font-semibold text-[#0071e3] uppercase tracking-wider mb-2">
                      Расчёт #{savedId} сохранён
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { href: `/calculations/${savedId}/print`, label: '📄 PDF КП', target: '_blank' },
                        { href: `/calculations/${savedId}`,       label: '✏️ Открыть' },
                        { href: '/calculations',                   label: '📋 История' },
                      ].map(l => (
                        <a key={l.href} href={l.href} target={l.target}
                          className="h-8 flex items-center justify-center text-[11px] font-medium bg-white border border-[#dde8f5] rounded-lg text-[#3b3b38] hover:bg-[#f5f9ff] transition-colors">
                          {l.label}
                        </a>
                      ))}
                      <button onClick={() => { setSavedId(null); setClientName(''); setClientPhone(''); window.scrollTo(0, 0) }}
                        className="h-8 flex items-center justify-center text-[11px] font-medium bg-white border border-[#dde8f5] rounded-lg text-[#3b3b38] hover:bg-[#f5f9ff] transition-colors">
                        ➕ Новый
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-white rounded-xl border border-[#e8e8e5] p-8 text-center">
                <p className="text-xs text-[#a8a8a3]">Введите размеры и выберите параметры</p>
              </div>
            )}

            <CartSection />
          </div>

        </div>
      </div>
    </div>
  )
}
