'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'

// Раньше здесь был устаревший клиент lib/supabase.ts: он хранит сессию в
// localStorage, а приложение логинится через @supabase/ssr в куки. Из-за этого
// калькулятор ходил в базу как АНОНИМ, а не как залогиненный пользователь —
// и любая RLS-политика «для authenticated» оставила бы его без прайса.
const supabase = createClient()
import type { Material, Service, PartnerType, FinancialSettings } from '@/lib/types'
import {
  SHOWER_MODELS, HARDWARE_COLORS, TIER_CONFIGS, calculateShower,
  type ShowerModelId, type ShowerTier, type ShowerInputs, type ShowerHardwareLine, type ShowerModel,
} from '@/lib/showerCalculator'
import { ShowerModelIcon } from '@/components/ShowerModelIcon'
import {
  resolveShowerGlassCostPerM2, resolveShowerExpensesPercent, resolveBudgetHardwareCost,
} from '@/lib/pricing/showerInputs'
import { saveCalculation } from '@/lib/saveCalculation'
import { useCart } from '@/lib/CartContext'
import CartSection from '@/components/CartSection'
import { useOwnerStrategy } from '@/lib/useOwnerStrategy'

const GLASS_TYPES = [
  'М1 прозрачное',
  'Тонированное (бронза/графит)',
  'Сатинированное бесцветное',
  'Сатин тонированный',
  'Осветлённое CrystalVision',
  'CrystalVision Matelux',
]

// Визуальные свотчи (CSS) — единый стиль, без фото-ассетов. Матовые — светлее/размытее.
const GLASS_SWATCH: Record<string, { bg: string; matte?: boolean }> = {
  'М1 прозрачное':                { bg: 'linear-gradient(135deg,#eef6fc 0%,#cfe4f3 55%,#b6d3e9 100%)' },
  'Осветлённое CrystalVision':    { bg: 'linear-gradient(135deg,#eef8f4 0%,#d2ede3 100%)' },
  'CrystalVision Matelux':        { bg: 'linear-gradient(135deg,#eef3f2 0%,#d8e0dd 100%)', matte: true },
  'Тонированное (бронза/графит)': { bg: 'linear-gradient(135deg,#e7dccb 0%,#a68d6f 100%)' },
  'Сатинированное бесцветное':    { bg: 'linear-gradient(135deg,#f3f4f6 0%,#dfe3e7 100%)', matte: true },
  'Сатин тонированный':           { bg: 'linear-gradient(135deg,#e9e2d6 0%,#c6bba9 100%)', matte: true },
}
const HW_SWATCH: Record<string, string> = {
  chrome: 'linear-gradient(135deg,#f6f8fa 0%,#c3ccd4 42%,#f0f3f6 52%,#a9b4bd 100%)',
  black:  'linear-gradient(135deg,#4a4a4c 0%,#1a1a1c 100%)',
  bronze: 'linear-gradient(135deg,#b98f57 0%,#7a5b34 100%)',
  gold:   'linear-gradient(135deg,#f3d778 0%,#b8942f 100%)',
  white:  'linear-gradient(135deg,#ffffff 0%,#e4e6e8 100%)',
}

type StdShowerType = 'stationary' | 'swing' | 'sliding'
const STD_SHOWER_TYPES: { v: StdShowerType; l: string }[] = [
  { v: 'stationary', l: 'Стационарная' },
  { v: 'swing',      l: 'Распашная'   },
  { v: 'sliding',    l: 'Раздвижная'  },
]

type CatalogItem = {
  id: number; name: string; category: string; manufacturer: string; unit: string
  whip_length: number | null; shower_types: string[]
  has_vat: boolean; photo_url: string; comment: string; active: boolean
  item_role: 'required' | 'optional' | 'addon'
  depends_on_item_id: number | null
  sort_order: number
  min_qty: number
  max_qty: number | null
  hinge_type: 'wall-glass' | 'glass-glass' | null
  track_type: 'open' | 'closed' | null
}
type CatalogPrice = { id?: number; item_id: number; supplier_id: number; color_id: number; cost_price: number }
type HwColor      = { id: number; name: string; sort_order: number; active: boolean }
type HwSupplier   = { id: number; name: string; active: boolean }

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wider mb-1.5">{children}</p>
}

function SField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function Seg<T extends string>({ options, value, onChange, small }: {
  options: { v: T; l: string }[]
  value: T
  onChange: (v: T) => void
  small?: boolean
}) {
  return (
    <div className="inline-flex bg-[#f2f2f7] rounded-[10px] p-[3px] gap-[2px]">
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)}
          className={`px-3 ${small ? 'py-1 text-[12px]' : 'py-1.5 text-[13px]'} rounded-[8px] font-medium transition-all ${
            value === o.v
              ? 'bg-white text-[#1d1d1f] shadow-[0_1px_3px_rgba(0,0,0,0.12)]'
              : 'text-[#6e6e73] hover:text-[#1d1d1f]'
          }`}>
          {o.l}
        </button>
      ))}
    </div>
  )
}

const inp = 'w-full bg-white border border-[#e8e8ed] rounded-[10px] px-3 py-2 text-[14px] text-[#1d1d1f] outline-none focus:border-[#0071e3] transition-colors placeholder:text-[#c7c7cc]'

export default function ShowerCalculatorPage() {
  const [materials, setMaterials]         = useState<Material[]>([])
  const [services, setServices]           = useState<Service[]>([])
  const [partners, setPartners]           = useState<PartnerType[]>([])
  const [allSettings, setAllSettings]     = useState<FinancialSettings[]>([])
  const [catalogItems, setCatalogItems]   = useState<CatalogItem[]>([])
  const [catalogPrices, setCatalogPrices] = useState<CatalogPrice[]>([])
  const [hwColors, setHwColors]           = useState<HwColor[]>([])
  const [hwSuppliers, setHwSuppliers]     = useState<HwSupplier[]>([])
  const [budgetManualPrices, setBudgetManualPrices] = useState<{ model_id: string; color_id: number; price: number }[]>([])
  // Фото моделей из админки (/admin/shower-images → shower_model_images). Если фото
  // загружено — показываем его, иначе единую SVG-иллюстрацию ShowerModelIcon.
  const [modelPhotos, setModelPhotos] = useState<Record<string, string>>({})
  // Модели душевых из БД (shower_models). Фолбэк на константу SHOWER_MODELS —
  // калькулятор работает и без применённой миграции (безопасно).
  const [showerModels, setShowerModels] = useState<ShowerModel[]>(SHOWER_MODELS)
  // glass_price_matrix sale rows: name → { t4, t6, t8, t10, t12, … }
  const [glassMatrix, setGlassMatrix]     = useState<Record<string, Record<string, number | null>>>({})
  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [copied, setCopied]       = useState(false)
  const [saving, setSaving]       = useState(false)
  const [savedId, setSavedId]     = useState<number | null>(null)
  const [addedToCart, setAddedToCart] = useState(false)
  const [clientName, setClientName]   = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [editCalcId, setEditCalcId]             = useState<number | null>(null)
  const [editOrderGroupId, setEditOrderGroupId] = useState<string | null>(null)
  const [editCalcOldPrice, setEditCalcOldPrice] = useState<number | null>(null)
  const { addItem } = useCart()
  const { strategy } = useOwnerStrategy()
  const supplierManuallySet = useRef(false)

  const [hwSelection, setHwSelection]     = useState<Record<number, { qty: number }>>({})
  const [stdColorId, setStdColorId]       = useState<number | null>(null)
  const [stdSupplierId, setStdSupplierId] = useState<number | null>(null)
  const [stdShowerType, setStdShowerType] = useState<StdShowerType>('swing')
  const [stdGlassCount, setStdGlassCount] = useState('2')
  const [stdIsCorner, setStdIsCorner]     = useState(false)
  const [hingeType, setHingeType] = useState<'wall-glass' | 'glass-glass'>('wall-glass')
  const [trackType, setTrackType] = useState<'open' | 'closed'>('open')

  const [tier, setTier]       = useState<ShowerTier>('standard')
  const [modelId, setModelId] = useState<string>('M2')
  const [width, setWidth]     = useState('900')
  const [width2, setWidth2]   = useState('900')
  const [height, setHeight]   = useState('2000')
  const [glassType, setGlassType]       = useState(GLASS_TYPES[0])
  const thickness = 8
  const [hwColor, setHwColor]           = useState('chrome')
  const [withMounting, setWithMounting] = useState(false)
  const [withDelivery, setWithDelivery] = useState(false)
  const [kmFromMkad, setKmFromMkad]   = useState('')
  const [deliveryBase, setDeliveryBase]   = useState(2000)
  const [deliveryPerKm, setDeliveryPerKm] = useState(50)
  const [floors, setFloors]     = useState('0')
  const [discount, setDiscount] = useState('0')
  const [margin, setMargin]     = useState('40')
  // Клиентский вид: прячем себестоимость/маржу, показываем чистую карточку для клиента.
  const [clientView, setClientView] = useState(false)
  const [partnerId, setPartnerId] = useState<number | null>(null)

  useEffect(() => {
    async function load() {
      setLoadError(false)
      try {
      const [
        { data: mats }, { data: svcs }, { data: pts }, { data: fins },
        { data: items }, { data: prices }, { data: colors }, { data: sups },
        { data: glassRows }, delivRes,
      ] = await Promise.all([
        supabase.from('materials').select('*').eq('active', true),
        supabase.from('services').select('*'),
        supabase.from('partner_types').select('*').eq('active', true),
        supabase.from('financial_settings').select('*'),
        supabase.from('shower_catalog_items').select('*').eq('active', true).order('category').order('sort_order').order('name'),
        supabase.from('shower_catalog_prices').select('id,item_id,supplier_id,color_id,cost_price'),
        supabase.from('shower_hw_colors').select('*').eq('active', true).order('sort_order'),
        supabase.from('shower_hw_suppliers').select('*').eq('active', true).order('name'),
        supabase.from('glass_price_matrix').select('name,t4,t5,t6,t8,t10,t12').eq('price_type', 'sale').eq('category', 'glass'),
        fetch('/api/admin/pricing-formula'),
      ])
      setMaterials(mats ?? [])
      setServices(svcs ?? [])
      setPartners(pts ?? [])
      setAllSettings((fins ?? []) as FinancialSettings[])
      setCatalogItems((items ?? []) as CatalogItem[])
      setCatalogPrices((prices ?? []) as CatalogPrice[])
      const cols = (colors ?? []) as HwColor[]
      const sup  = (sups  ?? []) as HwSupplier[]
      setHwColors(cols)
      setHwSuppliers(sup)
      // Build glass matrix: name → thickness prices
      const matrix: Record<string, Record<string, number | null>> = {}
      for (const row of (glassRows ?? []) as { name: string; t4: number|null; t5: number|null; t6: number|null; t8: number|null; t10: number|null; t12: number|null }[]) {
        matrix[row.name] = { t4: row.t4, t5: row.t5, t6: row.t6, t8: row.t8, t10: row.t10, t12: row.t12 }
      }
      setGlassMatrix(matrix)
      if (cols.length > 0) setStdColorId(cols[0].id)
      if (sup.length  > 0) setStdSupplierId(sup[0].id)
      if (delivRes.ok) {
        const formula = await delivRes.json() as { section: string; param_key: string; value: number }[]
        const bp = formula.find(p => p.section === 'delivery' && p.param_key === 'base_price')?.value
        const pk = formula.find(p => p.section === 'delivery' && p.param_key === 'price_per_km')?.value
        if (bp != null) setDeliveryBase(bp)
        if (pk != null) setDeliveryPerKm(pk)
      }
      const stdSettings =
        (fins ?? []).find((s: FinancialSettings) => s.product_type === 'shower_standard') ??
        (fins ?? []).find((s: FinancialSettings) => s.tier === 'standard') ??
        fins?.[0] ?? null
      // Apply prefill from detail page "Пересчитать" button
      try {
        const raw = sessionStorage.getItem('mglass_shower_prefill')
        if (raw) {
          sessionStorage.removeItem('mglass_shower_prefill')
          const p = JSON.parse(raw) as Record<string, unknown>
          // М2: клиент из карточки сделки — чтобы расчёт не потерял телефон
          if (p.clientName)  setClientName(String(p.clientName))
          if (p.clientPhone) setClientPhone(String(p.clientPhone))
          if (p.tier)      setTier(p.tier as ShowerTier)
          if (p.modelId)   setModelId(p.modelId as string)
          if (p.width)     setWidth(String(p.width))
          if (p.width2)    setWidth2(String(p.width2))
          if (p.height)    setHeight(String(p.height))
          if (p.glassType) setGlassType(p.glassType as string)
          if (p.hwColor)   setHwColor(p.hwColor as string)
          if (p.__editCalcId__)      setEditCalcId(p.__editCalcId__ as number)
          if (p.__order_group_id__)  setEditOrderGroupId(p.__order_group_id__ as string)
          if (p.__old_final_price__) setEditCalcOldPrice(p.__old_final_price__ as number)
        }
      } catch {}
      } catch (e) {
        console.error(e)
        setLoadError(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMargin(String(strategy.target_margin))
  }, [tier, strategy.target_margin])

  const tierCfg         = TIER_CONFIGS.find(t => t.value === tier)!
  const availableColors = HARDWARE_COLORS.filter(c => tierCfg.colors.includes(c.value))
  const budgetModel     = showerModels.find(m => m.id === modelId) ?? showerModels[1] ?? SHOWER_MODELS[1]
  const colorObj        = availableColors.find(c => c.value === hwColor) ?? availableColors[0]
  const selectedPartner = partners.find(p => p.id === partnerId) ?? null

  const stdModel: ShowerModel = useMemo(() => ({
    id:           'M1' as ShowerModelId,
    label:        STD_SHOWER_TYPES.find(t => t.v === stdShowerType)?.l ?? stdShowerType,
    desc:         STD_SHOWER_TYPES.find(t => t.v === stdShowerType)?.l ?? '',
    glassCount:   Math.max(1, Number(stdGlassCount) || 1),
    dimType:      stdIsCorner ? 'corner' : 'single',
    hardwareBase: 0,
    hardwareType: stdShowerType,
  }), [stdShowerType, stdGlassCount, stdIsCorner])

  const model = tier === 'standard' ? stdModel : budgetModel

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!tierCfg.colors.includes(hwColor)) setHwColor(tierCfg.colors[0])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setHwSelection({}) }, [tier, stdShowerType, hingeType, trackType])

  // Load manual hardware prices for budget tier when model changes
  useEffect(() => {
    if (tier !== 'budget') return
    supabase.from('shower_budget_manual_prices')
      .select('model_id,color_id,price')
      .eq('model_id', modelId)
      .then(({ data }) => setBudgetManualPrices((data ?? []) as { model_id: string; color_id: number; price: number }[]))
  }, [tier, modelId])

  // Фото моделей из админки (загруженные в /admin/shower-images). GET открыт.
  useEffect(() => {
    fetch('/api/admin/shower-images')
      .then(r => r.ok ? r.json() : [])
      .then((rows: { model_id: string; image_url: string }[]) => {
        const map: Record<string, string> = {}
        for (const row of (rows ?? [])) if (row.image_url) map[row.model_id] = row.image_url
        setModelPhotos(map)
      })
      .catch(() => {})
  }, [])

  // Модели душевых из БД (админ-редактируемые); при отсутствии таблицы — код-фолбэк.
  useEffect(() => {
    supabase.from('shower_models').select('*').eq('active', true).order('sort_order')
      .then(({ data }) => {
        if (data && data.length) {
          setShowerModels(data.map(r => ({
            id: r.code as ShowerModel['id'], label: r.title, desc: r.description,
            glassCount: r.glass_count, dimType: r.dim_type as ShowerModel['dimType'],
            hardwareBase: r.hardware_base, hardwareType: r.hardware_type as ShowerModel['hardwareType'],
          })))
        }
      })
  }, [])

  const filteredCatalogItems = useMemo(() =>
    catalogItems.filter(item => {
      if (!item.shower_types.includes(stdShowerType) && !item.shower_types.includes('universal')) return false
      if (stdShowerType === 'swing'    && item.hinge_type !== null) return item.hinge_type === hingeType
      if (stdShowerType === 'sliding'  && item.track_type !== null) return item.track_type === trackType
      return true
    }),
  [catalogItems, stdShowerType, hingeType, trackType])

  const catalogByCategory = useMemo(() => {
    const map: Record<string, CatalogItem[]> = {}
    for (const item of filteredCatalogItems) {
      if (!map[item.category]) map[item.category] = []
      map[item.category].push(item)
    }
    return map
  }, [filteredCatalogItems])

  const getPriceForItem = useMemo(() => {
    const pm = new Map<string, number>()
    for (const p of catalogPrices) pm.set(`${p.item_id}:${p.supplier_id}:${p.color_id}`, p.cost_price)
    return (itemId: number) =>
      stdSupplierId !== null && stdColorId !== null
        ? (pm.get(`${itemId}:${stdSupplierId}:${stdColorId}`) ?? 0)
        : 0
  }, [catalogPrices, stdSupplierId, stdColorId])

  const supplierCoverage = useMemo(() => {
    const covered = new Set<string>()
    for (const p of catalogPrices) {
      if (stdColorId !== null && p.color_id === stdColorId) covered.add(`${p.item_id}:${p.supplier_id}`)
    }
    return hwSuppliers.map(sup => ({
      ...sup,
      count: filteredCatalogItems.filter(item => covered.has(`${item.id}:${sup.id}`)).length,
    }))
  }, [catalogPrices, stdColorId, hwSuppliers, filteredCatalogItems])

  // Авто-выбор поставщика с максимальным покрытием (только если не выбран вручную)
  useEffect(() => {
    if (supplierManuallySet.current) return
    if (supplierCoverage.length === 0) return
    const best = [...supplierCoverage].sort((a, b) => b.count - a.count)[0]
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (best) setStdSupplierId(best.id)
  }, [supplierCoverage])

  const selectedHardwareLines = useMemo((): ShowerHardwareLine[] => {
    const colorName = hwColors.find(c => c.id === stdColorId)?.name ?? ''
    return filteredCatalogItems
      .filter(item => {
        if (item.item_role === 'required') return true
        if (!hwSelection[item.id]) return false
        if (item.item_role === 'addon' && item.depends_on_item_id && !hwSelection[item.depends_on_item_id]) return false
        return true
      })
      .map(item => {
        const qty = item.item_role === 'required' ? (item.min_qty ?? 1) : hwSelection[item.id].qty
        const unitCost = getPriceForItem(item.id)
        return { name: item.name, qty, unit: item.unit, color: colorName, unitCost, total: Math.round(unitCost * qty) }
      })
  }, [filteredCatalogItems, hwSelection, getPriceForItem, hwColors, stdColorId])

  // Себестоимость фурнитуры бюджета — из shower_budget_manual_prices (единый резолвер).
  const budgetManualCost = tier === 'budget'
    ? resolveBudgetHardwareCost(budgetManualPrices, hwColors, modelId, hwColor)
    : undefined

  const customHardwareCost = tier === 'standard' && selectedHardwareLines.length > 0
    ? selectedHardwareLines.reduce((s, l) => s + l.total, 0)
    : budgetManualCost

  const glassCostPerM2 = useMemo(
    () => resolveShowerGlassCostPerM2(glassMatrix, glassType, thickness, materials),
    [glassMatrix, materials, glassType, thickness],
  )

  const km = Number(kmFromMkad) || 0
  const deliveryCost = withDelivery && km > 0 ? Math.round(deliveryBase + deliveryPerKm * km) : undefined

  const inputs: ShowerInputs = {
    tier, model,
    width: Number(width) || 0, width2: Number(width2) || 0, height: Number(height) || 0,
    glassCostPerM2, glassName: glassType, thickness,
    hardwareColor: colorObj.value, hardwareColorMultiplier: colorObj.multiplier,
    withMounting, withDelivery, deliveryCost, kmFromMkad: km > 0 ? km : undefined, floors: Number(floors) || 0,
    discount: Number(discount) || 0, partnerPercent: selectedPartner?.percent ?? 0,
    margin: Number(margin) || 40,
    expensesPercent: resolveShowerExpensesPercent(allSettings, tier),
    hwTierMultiplier: tierCfg.hwMultiplier,
    customHardwareCost,
    customHardwareLines: customHardwareCost !== undefined ? selectedHardwareLines : undefined,
    minMargin: strategy.min_margin,
    standardMargin: strategy.target_margin,
  }

  const showerBlocked = inputs.expensesPercent + (Number(margin) || 0) >= 100

  const result = useMemo(() => calculateShower(inputs, services),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [tier, modelId, stdShowerType, stdGlassCount, stdIsCorner, width, width2, height, glassType,
   thickness, hwColor, withMounting, withDelivery, kmFromMkad, deliveryCost, floors, discount, margin, partnerId,
   materials, services, hwSelection, stdColorId, stdSupplierId])

  function handleAddToCart() {
    if (!result) return
    const dimStr = model.dimType === 'corner' ? `${width}×${width2}×${height}` : `${width}×${height}`
    addItem({
      product_type: 'shower',
      label: `${model.label} ${dimStr} мм [${tierCfg.label}]`,
      input_data: {
        tier, modelId, width, width2, height, dimStr, glassType, thickness, hwColor,
        stdShowerType, stdGlassCount, stdIsCorner,
        withMounting, withDelivery, kmFromMkad: Number(kmFromMkad) || 0,
        partnerId, discount: Number(discount) || 0, margin: Number(margin) || 40,
      },
      cost_breakdown: { lines: result.costLines, totalCost: result.totalCost },
      financial_breakdown: { expensesPercent: result.expensesPercent, expensesAmount: result.expensesAmount, basePrice: result.basePrice, partnerAmount: result.partnerAmount, discountAmount: result.discountAmount, serviceLines: result.serviceLines, servicesTotal: result.servicesTotal },
      base_price: result.basePrice, discount: inputs.discount, partner_percent: inputs.partnerPercent,
      // INV-1: grandTotal = product + services (что клиент реально платит)
      final_price: result.grandTotal, grand_total: result.grandTotal,
      margin: result.margin, profit: result.profit, manager_bonus: result.managerBonus, client_text: result.clientText,
    })
    setAddedToCart(true)
    setTimeout(() => setAddedToCart(false), 2000)
  }

  async function handleSave() {
    if (!result) return
    if (discountExceeded) return
    setSaving(true)
    const dimStr = model.dimType === 'corner' ? `${width}×${width2}×${height}` : `${width}×${height}`

    const payload = {
      product_type: 'shower' as const,
      input_data: {
        tier, modelId, width, width2, height, dimStr, glassType, thickness, hwColor,
        stdShowerType, stdGlassCount, stdIsCorner,
        withMounting, withDelivery, kmFromMkad: Number(kmFromMkad) || 0,
        partnerId, discount: Number(discount) || 0, margin: Number(margin) || 40,
        ...(tier === 'budget' ? { model: budgetModel.label } : {}),
      },
      cost_breakdown: { lines: result.costLines, totalCost: result.totalCost },
      financial_breakdown: { expensesPercent: result.expensesPercent, expensesAmount: result.expensesAmount, basePrice: result.basePrice, partnerAmount: result.partnerAmount, discountAmount: result.discountAmount, serviceLines: result.serviceLines, servicesTotal: result.servicesTotal },
      base_price: result.basePrice, discount: inputs.discount, partner_percent: inputs.partnerPercent,
      final_price: result.grandTotal, margin: result.margin, profit: result.profit, client_text: result.clientText,
      client_name: clientName.trim() || undefined,
      client_phone: clientPhone.trim() || undefined,
    }

    // INV-3: edit mode НИКОГДА не перезаписывает оригинал — всегда новый расчёт с parent_calc_id
    const saved = await saveCalculation({
      ...payload,
      order_group_id: editOrderGroupId ?? undefined,
      parent_calc_id: editCalcId ?? undefined,
    })
    if (saved && 'id' in saved) {
      setSavedId(saved.id ?? null)
      if (editCalcId) {
        setTimeout(() => { window.location.href = `/calculations/${saved.id}` }, 1200)
      }
    }
    setSaving(false)
  }

  async function handleCopy() {
    if (!result) return
    await navigator.clipboard.writeText(result.clientText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const marginOk    = result.margin >= 35
  const marginWarn  = !marginOk && result.margin >= strategy.min_margin
  const marginColor = marginOk ? '#34c759' : marginWarn ? '#ff9f0a' : '#ff3b30'

  const showerSettings = useMemo(() => {
    const pt = tier === 'budget' ? 'shower_budget' : 'shower_standard'
    const s = allSettings.find(s => s.product_type === pt) ?? allSettings.find(s => s.tier === tier)
    return s ?? null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSettings, tier])

  const discountExceeded = Number(discount) > strategy.max_manager_discount


  if (loadError) return (
    <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center p-6">
      <div className="text-center">
        <p className="text-[14px] text-[#86868b] mb-3">Не удалось загрузить калькулятор.</p>
        <button onClick={() => location.reload()} className="px-4 py-2 bg-[#111110] text-white text-[13px] font-medium rounded-lg">Повторить</button>
      </div>
    </div>
  )
  if (loading) return (
    <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center">
      <p className="text-[14px] text-[#86868b]">Загрузка...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f5f5f7]" style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif' }}>
      <div className="max-w-[960px] mx-auto px-5 py-6">

        {/* ── Header ────────────────────────────────────────── */}
        {editCalcId && (
          <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
            <span className="text-amber-500 text-lg flex-shrink-0">⚡</span>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-amber-800">Режим пересчёта — расчёт #{editCalcId}</p>
              <p className="text-[11px] text-amber-700 mt-0.5">
                Оригинал останется нетронутым. Результат сохранится как новый расчёт.
                {editCalcOldPrice ? ` Было: ${editCalcOldPrice.toLocaleString('ru-RU')} ₽` : ''}
              </p>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <Link href="/" className="text-[13px] text-[#0071e3] hover:underline">Главная</Link>
            <span className="text-[#c7c7cc]">/</span>
            <h1 className="text-[17px] font-semibold text-[#1d1d1f] tracking-tight">Душевая перегородка</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setClientView(v => !v)}
              title="Скрыть себестоимость и маржу — показать клиенту"
              className={`px-3 py-1.5 text-[13px] rounded-[10px] border transition-colors ${clientView ? 'bg-[#0071e3] text-white border-[#0071e3]' : 'bg-white text-[#1d1d1f] border-[#e8e8ed] hover:bg-[#f5f5f7]'}`}>
              {clientView ? '✓ Клиентский вид' : 'Клиентский вид'}
            </button>
            <button onClick={handleCopy} disabled={showerBlocked}
              className="px-3 py-1.5 text-[13px] text-[#1d1d1f] bg-white border border-[#e8e8ed] rounded-[10px] hover:bg-[#f5f5f7] disabled:opacity-40 transition-colors">
              {copied ? '✓ Скопировано' : 'Копировать КП'}
            </button>
            <button onClick={handleAddToCart} disabled={showerBlocked}
              className="px-3 py-1.5 text-[13px] text-[#1d1d1f] bg-white border border-[#e8e8ed] rounded-[10px] hover:bg-[#f5f5f7] disabled:opacity-40 transition-colors">
              {addedToCart ? '✓ Добавлено' : '+ В заказ'}
            </button>
            <button onClick={handleSave} disabled={saving || showerBlocked || discountExceeded}
              title={discountExceeded ? `Скидка превышает лимит ${strategy.max_manager_discount}%` : undefined}
              className="px-3 py-1.5 text-[13px] text-[#1d1d1f] bg-white border border-[#e8e8ed] rounded-[10px] hover:bg-[#f5f5f7] disabled:opacity-40 transition-colors">
              {saving ? 'Сохранение...' : savedId ? `#${savedId} ✓` : editCalcId ? 'Сохранить как новый расчёт' : 'Сохранить расчёт'}
            </button>
            {savedId && (
              <a href={`/calculations/${savedId}`}
                className="px-3 py-1.5 text-[13px] text-[#0071e3] bg-white border border-[#e8e8ed] rounded-[10px] hover:bg-[#f5f5f7] transition-colors">
                → История
              </a>
            )}
          </div>
        </div>


        {/* ── Конфигуратор ──────────────────────────────────── */}
        <section className="bg-white rounded-2xl border border-[#e8e8ed] p-4 mb-4">
          <div className="space-y-4">

            {/* Шаг 1: Класс + Тип системы */}
            <div className="flex items-start gap-8">
              <div>
                <Label>Класс</Label>
                <Seg
                  options={[{ v: 'standard' as ShowerTier, l: 'Стандарт' }, { v: 'budget' as ShowerTier, l: 'Бюджет' }]}
                  value={tier}
                  onChange={setTier}
                />
              </div>
              {tier === 'standard' && (
                <div>
                  <Label>Тип перегородки</Label>
                  <Seg options={STD_SHOWER_TYPES} value={stdShowerType} onChange={setStdShowerType} />
                </div>
              )}
            </div>

            {/* Шаг 2: Подтип петель (распашная) */}
            {tier === 'standard' && stdShowerType === 'swing' && (
              <div className="border-t border-[#f2f2f7] pt-4">
                <Label>Тип петель</Label>
                <Seg
                  options={[
                    { v: 'wall-glass' as const, l: 'Стена — стекло' },
                    { v: 'glass-glass' as const, l: 'Стекло — стекло' },
                  ]}
                  value={hingeType}
                  onChange={setHingeType}
                />
                <p className="mt-1.5 text-[11px] text-[#86868b]">
                  {hingeType === 'wall-glass'
                    ? 'Одна сторона крепится к стене, вторая к стеклу'
                    : 'Обе стороны крепятся к стеклянным элементам'}
                </p>
              </div>
            )}

            {/* Шаг 2: Подтип трека (раздвижная) */}
            {tier === 'standard' && stdShowerType === 'sliding' && (
              <div className="border-t border-[#f2f2f7] pt-4">
                <Label>Тип трека</Label>
                <Seg
                  options={[
                    { v: 'open' as const, l: 'Открытый' },
                    { v: 'closed' as const, l: 'Закрытый' },
                  ]}
                  value={trackType}
                  onChange={setTrackType}
                />
                <p className="mt-1.5 text-[11px] text-[#86868b]">
                  {trackType === 'open'
                    ? 'Ролик снаружи, профиль виден — стандартное решение'
                    : 'Ролик внутри профиля — аккуратный вид, сложнее монтаж'}
                </p>
              </div>
            )}

          </div>
        </section>

        {/* ── Main grid ─────────────────────────────────────── */}
        <div className="grid grid-cols-[1fr_300px] gap-4">

          {/* LEFT */}
          <div className="space-y-3">

            {/* Budget: model grid */}
            {tier === 'budget' && (
              <section className="bg-white rounded-2xl border border-[#e8e8ed] p-4">
                <Label>Модель перегородки</Label>
                <div className="grid grid-cols-4 gap-1.5">
                  {showerModels.map(m => {
                    const active = modelId === m.id
                    return (
                      <button key={m.id} onClick={() => setModelId(m.id)}
                        className={`flex flex-col items-stretch p-2 rounded-xl border text-left transition-all ${
                          active ? 'border-[#0071e3] bg-[#f0f7ff]' : 'border-[#e8e8ed] hover:border-[#c7c7cc]'
                        }`}>
                        <div className={`rounded-lg mb-1.5 overflow-hidden flex items-center justify-center h-[96px] ${active ? 'bg-white' : 'bg-[#f5f5f7]'}`}>
                          {modelPhotos[m.id] ? (
                            <img src={modelPhotos[m.id]} alt={m.label}
                              className="w-full h-full object-contain" />
                          ) : (
                            <ShowerModelIcon modelId={m.id as ShowerModelId} active={active} />
                          )}
                        </div>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className={`text-[12px] font-bold ${active ? 'text-[#0071e3]' : 'text-[#1d1d1f]'}`}>{m.label}</span>
                          <span className={`text-[9px] font-semibold rounded px-1 ${active ? 'bg-[#ddeeff] text-[#0071e3]' : 'bg-[#f2f2f7] text-[#86868b]'}`}>{m.glassCount}ст</span>
                        </div>
                        <span className="text-[9px] text-[#86868b] leading-tight">{m.desc}</span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Dimensions */}
            <section className="bg-white rounded-2xl border border-[#e8e8ed] p-4">
              <Label>Размеры, мм</Label>

              {tier === 'standard' && (
                <div className="flex items-center gap-4 mb-3">
                  <label className="flex items-center gap-2 cursor-pointer text-[13px] text-[#1d1d1f]">
                    <input type="checkbox" checked={stdIsCorner} onChange={e => setStdIsCorner(e.target.checked)}
                      className="w-4 h-4 rounded accent-[#0071e3]"/>
                    Угловая конструкция
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-[#86868b]">Элементов:</span>
                    <input type="number" min="1" max="6" value={stdGlassCount} onChange={e => setStdGlassCount(e.target.value)}
                      className="w-12 border border-[#e8e8ed] rounded-[8px] px-2 py-1 text-[13px] text-center outline-none focus:border-[#0071e3]"/>
                  </div>
                </div>
              )}

              <div className={`grid gap-3 ${(tier === 'standard' ? stdIsCorner : budgetModel.dimType === 'corner') ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <SField label={(tier === 'standard' ? stdIsCorner : budgetModel.dimType === 'corner') ? 'Ширина 1' : 'Ширина'}>
                  <input type="number" value={width} onChange={e => setWidth(e.target.value)} className={inp}/>
                </SField>
                {(tier === 'standard' ? stdIsCorner : budgetModel.dimType === 'corner') && (
                  <SField label="Ширина 2">
                    <input type="number" value={width2} onChange={e => setWidth2(e.target.value)} className={inp}/>
                  </SField>
                )}
                <SField label="Высота">
                  <input type="number" value={height} onChange={e => setHeight(e.target.value)} className={inp}/>
                </SField>
              </div>
              <p className="mt-2 text-[11px] text-[#86868b]">
                {result.glassArea.toFixed(2)} м² · {model.glassCount} {model.glassCount === 1 ? 'элемент' : model.glassCount < 5 ? 'элемента' : 'элементов'}
              </p>
            </section>

            {/* Glass */}
            <section className="bg-white rounded-2xl border border-[#e8e8ed] p-4">
              {tier === 'standard' ? (
                <div>
                  <Label>Стекло</Label>
                  <select value={glassType} onChange={e => setGlassType(e.target.value)} className={inp}>
                    {GLASS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {glassCostPerM2 > 0 && (
                    <p className="mt-1.5 text-[11px] text-[#86868b]">
                      Закалённое {thickness} мм · {glassCostPerM2.toLocaleString('ru-RU')} ₽/м²
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <Label>Тип стекла</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {GLASS_TYPES.map(t => {
                        const on = glassType === t
                        const sw = GLASS_SWATCH[t]
                        return (
                          <button key={t} type="button" onClick={() => setGlassType(t)}
                            className={`rounded-xl border p-1.5 text-left transition-all ${on ? 'border-[#0071e3] ring-2 ring-[#0071e3]/20' : 'border-[#e8e8ed] hover:border-[#c7c7cc]'}`}>
                            <div className="h-11 rounded-lg mb-1 border border-black/5 relative overflow-hidden" style={{ background: sw?.bg ?? '#e8eef4' }}>
                              {sw?.matte && <div className="absolute inset-0 bg-white/30 backdrop-blur-[1px]" />}
                            </div>
                            <span className={`text-[10.5px] leading-tight block ${on ? 'text-[#0071e3] font-semibold' : 'text-[#1d1d1f]'}`}>{t}</span>
                          </button>
                        )
                      })}
                    </div>
                    {glassCostPerM2 > 0 && (
                      <p className="mt-1.5 text-[11px] text-[#86868b]">Закалённое {thickness} мм · {glassCostPerM2.toLocaleString('ru-RU')} ₽/м²</p>
                    )}
                  </div>
                  <div>
                    <Label>Цвет фурнитуры</Label>
                    <div className="grid grid-cols-4 gap-2">
                      {availableColors.map(c => {
                        const on = hwColor === c.value
                        return (
                          <button key={c.value} type="button" onClick={() => setHwColor(c.value)}
                            className={`rounded-xl border p-1.5 transition-all ${on ? 'border-[#0071e3] ring-2 ring-[#0071e3]/20' : 'border-[#e8e8ed] hover:border-[#c7c7cc]'}`}>
                            <div className="h-9 rounded-lg mb-1 border border-black/10" style={{ background: HW_SWATCH[c.value] ?? '#ccc' }} />
                            <span className={`text-[10px] leading-tight block text-center ${on ? 'text-[#0071e3] font-semibold' : 'text-[#1d1d1f]'}`}>
                              {c.label}{c.multiplier > 1 ? ` +${Math.round((c.multiplier - 1) * 100)}%` : ''}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Hardware items list (standard only) */}
            {tier === 'standard' && (
              <section className="bg-white rounded-2xl border border-[#e8e8ed] p-4">

                {/* Цвет + Поставщик — шапка секции */}
                <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b border-[#f2f2f7]">
                  <div>
                    <Label>Цвет фурнитуры</Label>
                    <select value={stdColorId ?? ''} onChange={e => setStdColorId(e.target.value ? Number(e.target.value) : null)} className={inp}>
                      <option value="">— не выбран</option>
                      {hwColors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label>Поставщик</Label>
                    <div className="flex gap-1.5 flex-wrap">
                      {supplierCoverage.map(s => (
                        <button key={s.id} onClick={() => { supplierManuallySet.current = true; setStdSupplierId(s.id) }}
                          className={`py-1.5 px-3 rounded-[10px] text-[12px] font-medium border transition-all ${
                            stdSupplierId === s.id
                              ? 'bg-[#0071e3] text-white border-[#0071e3]'
                              : 'bg-white border-[#e8e8ed] text-[#1d1d1f] hover:border-[#c7c7cc]'
                          }`}>
                          {s.name}
                          <span className={`ml-1.5 text-[10px] ${stdSupplierId === s.id ? 'text-blue-200' : 'text-[#86868b]'}`}>
                            ({s.count})
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between mb-3">
                  <Label>Комплект фурнитуры</Label>
                  {customHardwareCost !== undefined && (
                    <span className="text-[13px] font-semibold text-[#0071e3] font-mono">
                      {customHardwareCost.toLocaleString('ru-RU')} ₽
                    </span>
                  )}
                </div>

                {Object.keys(catalogByCategory).length === 0 ? (
                  <p className="text-[13px] text-[#86868b]">Нет позиций для этого типа</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(catalogByCategory).map(([cat, items]) => (
                      <div key={cat}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[11px] font-bold text-[#86868b] uppercase tracking-widest">{cat}</span>
                          <div className="flex-1 h-px bg-[#e8e8ed]"/>
                        </div>
                        <div className="space-y-1">
                          {items.map(item => {
                            const isRequired = item.item_role === 'required'
                            const isAddon    = item.item_role === 'addon'
                            const parentOk   = isAddon && item.depends_on_item_id
                              ? !!hwSelection[item.depends_on_item_id]
                              : true
                            if (isAddon && !parentOk) return null

                            const minQty   = item.min_qty ?? 1
                            const maxQty   = item.max_qty ?? undefined
                            const sel      = isRequired ? { qty: minQty } : hwSelection[item.id]
                            const selected = isRequired || !!hwSelection[item.id]
                            const price    = getPriceForItem(item.id)
                            return (
                              <label key={item.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                                isRequired
                                  ? 'border-[#34c759] bg-[#f0fff4] cursor-default'
                                  : selected
                                  ? 'border-[#0071e3] bg-[#f0f7ff] cursor-pointer'
                                  : price === 0
                                  ? 'border-[#f2f2f7] bg-[#fafafa] opacity-60 cursor-pointer'
                                  : 'border-[#e8e8ed] bg-white hover:border-[#c7c7cc] cursor-pointer'
                              }`}>
                                <input type="checkbox" checked={selected} disabled={isRequired}
                                  onChange={e => setHwSelection(prev => {
                                    const next = { ...prev }
                                    e.target.checked ? next[item.id] = { qty: minQty } : delete next[item.id]
                                    return next
                                  })}
                                  className="w-4 h-4 flex-shrink-0 accent-[#0071e3]"/>
                                <span className={`flex-1 text-[13px] font-medium leading-tight ${isRequired ? 'text-[#1d7a3a]' : 'text-[#1d1d1f]'}`}>
                                  {item.name}
                                  {isRequired && <span className="ml-1.5 text-[9px] font-bold text-[#34c759] uppercase tracking-wide">обяз.</span>}
                                  {isAddon    && <span className="ml-1.5 text-[9px] text-[#86868b] uppercase tracking-wide">доп.</span>}
                                </span>
                                <span className={`text-[12px] whitespace-nowrap ${price > 0 ? 'text-[#86868b]' : 'text-[#c7c7cc] italic'}`}>
                                  {price > 0 ? `${price.toLocaleString('ru-RU')} ₽/${item.unit}` : 'нет у поставщика'}
                                </span>
                                {selected && sel && (
                                  <>
                                    {isRequired ? (
                                      <span className="w-12 text-[13px] text-center text-[#1d7a3a] font-medium">{sel.qty}</span>
                                    ) : (
                                      <input type="number" min={minQty} max={maxQty} value={sel.qty}
                                        onClick={e => e.preventDefault()}
                                        onChange={e => setHwSelection(prev => ({
                                          ...prev,
                                          [item.id]: { qty: Math.min(maxQty ?? 9999, Math.max(minQty, Number(e.target.value) || minQty)) },
                                        }))}
                                        className="w-12 border border-[#c7c7cc] rounded-[8px] px-2 py-1 text-[13px] text-center outline-none focus:border-[#0071e3] bg-white"/>
                                    )}
                                    <span className="text-[13px] font-semibold font-mono text-[#0071e3] w-[72px] text-right whitespace-nowrap">
                                      {price > 0 ? `${(price * sel.qty).toLocaleString('ru-RU')} ₽` : '—'}
                                    </span>
                                  </>
                                )}
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Services */}
            <section className="bg-white rounded-2xl border border-[#e8e8ed] p-4">
              <Label>Услуги</Label>
              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={withMounting} onChange={e => setWithMounting(e.target.checked)}
                    className="w-4 h-4 accent-[#0071e3]"/>
                  <span className="text-[13px] text-[#1d1d1f]">Монтаж</span>
                  {(() => {
                    const svc = services.find(s => s.name === 'Монтаж душевой перегородки')
                    const price = tierCfg.mountingPerElement ?? svc?.sale_price ?? svc?.cost_price ?? 3000
                    return (
                      <span className="text-[12px] text-[#86868b] ml-auto font-mono">
                        {model.glassCount} × {price.toLocaleString('ru-RU')} = {(price * model.glassCount).toLocaleString('ru-RU')} ₽
                      </span>
                    )
                  })()}
                </label>
                {withMounting && (
                  <div className="ml-7 flex items-center gap-2">
                    <span className="text-[12px] text-[#86868b]">Подъём, этажей:</span>
                    <input type="number" min="0" value={floors} onChange={e => setFloors(e.target.value)}
                      className="w-14 border border-[#e8e8ed] rounded-[8px] px-2 py-1 text-[13px] text-center outline-none focus:border-[#0071e3]"/>
                  </div>
                )}
                <div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={withDelivery} onChange={e => setWithDelivery(e.target.checked)}
                      className="w-4 h-4 accent-[#0071e3]"/>
                    <span className="text-[13px] text-[#1d1d1f]">Доставка</span>
                    <span className="text-[12px] text-[#86868b] ml-auto font-mono">
                      {km > 0
                        ? `${(deliveryCost!).toLocaleString('ru-RU')} ₽ (${km} км за МКАД)`
                        : `${((services.find(s => s.name === 'Доставка Москва')?.sale_price ?? services.find(s => s.name === 'Доставка Москва')?.cost_price ?? 3500)).toLocaleString('ru-RU')} ₽`}
                    </span>
                  </label>
                  {withDelivery && (
                    <div className="mt-1.5 ml-7 flex items-center gap-2">
                      <span className="text-[12px] text-[#86868b]">км от МКАД:</span>
                      <input
                        type="number" min="0" max="200" placeholder="0"
                        value={kmFromMkad}
                        onChange={e => setKmFromMkad(e.target.value)}
                        className="w-16 border border-[#e8e8ed] rounded-[8px] px-2 py-1 text-[13px] text-center outline-none focus:border-[#0071e3]"
                      />
                      {km > 0 && (
                        <span className="text-[12px] text-[#86868b]">
                          {deliveryBase.toLocaleString('ru-RU')} + {km} × {deliveryPerKm} ₽
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Financial params */}
            <section className="bg-white rounded-2xl border border-[#e8e8ed] p-4">
              <Label>Параметры расчёта</Label>
              <div className="grid grid-cols-3 gap-3">
                <SField label="Маржа, %">
                  <input type="number" value={margin} onChange={e => setMargin(e.target.value)} className={inp}/>
                </SField>
                <SField label="Скидка, %">
                  <input type="number" value={discount} onChange={e => setDiscount(e.target.value)} className={inp}/>
                </SField>
                <SField label="Партнёр">
                  <select value={partnerId ?? ''} onChange={e => setPartnerId(e.target.value ? Number(e.target.value) : null)} className={inp}>
                    <option value="">Нет</option>
                    {partners.map(p => <option key={p.id} value={p.id}>{p.name} ({p.percent}%)</option>)}
                  </select>
                </SField>
              </div>
            </section>

          </div>

          {/* RIGHT — summary */}
          <div className="space-y-3">

            {showerBlocked && (
              <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
                <p className="text-xs font-semibold text-red-700">Сумма маржи и расходов не может быть ≥ 100%</p>
              </div>
            )}

            {/* Клиентская карточка — чистая презентация для клиента (по мотивам berusteklo) */}
            {(() => {
              const dimStr = model.dimType === 'corner'
                ? `${width || '—'}×${width2 || '—'}×${height || '—'}`
                : `${width || '—'}×${height || '—'}`
              const hwLabel = HARDWARE_COLORS.find(c => c.value === hwColor)?.label ?? ''
              const priceNoDisc = result.finalPrice + result.discountAmount
              return (
                <section className="bg-white rounded-2xl border border-[#e8e8ed] p-4">
                  <p className="text-[15px] font-semibold text-[#1d1d1f] leading-tight">{model.desc}</p>
                  <p className="text-[12px] text-[#86868b] mt-0.5">{dimStr} мм · модель {model.label}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    <span className="text-[10px] font-medium px-2 py-1 rounded-lg bg-[#eef4ff] text-[#0071e3]">Стекло {thickness} мм закалённое</span>
                    {hwLabel && <span className="text-[10px] font-medium px-2 py-1 rounded-lg bg-[#f2f2f7] text-[#1d1d1f]">Фурнитура {hwLabel}</span>}
                    <span className="text-[10px] font-medium px-2 py-1 rounded-lg bg-[#f0fdf4] text-[#1a7f37]">Гарантия 2 года</span>
                  </div>
                  <div className="mt-3 pt-3 border-t border-[#f2f2f7] space-y-1 text-[13px]">
                    {result.discountAmount > 0 && (<>
                      <div className="flex justify-between text-[#86868b]"><span>Без скидки</span><span className="font-mono line-through">{fmt(priceNoDisc)}</span></div>
                      <div className="flex justify-between text-[#1a7f37]"><span>Скидка {discount}%</span><span className="font-mono">−{fmt(result.discountAmount)}</span></div>
                    </>)}
                    <div className="flex justify-between text-[#1d1d1f]"><span>Изделие</span><span className="font-mono">{fmt(result.finalPrice)}</span></div>
                    {result.serviceLines.map((s, i) => (
                      <div key={i} className="flex justify-between text-[#6e6e73]"><span>{s.name}</span><span className="font-mono">{fmt(s.total)}</span></div>
                    ))}
                  </div>
                  <div className="mt-2.5 flex items-baseline justify-between rounded-xl bg-[#eef4ff] px-3 py-2.5">
                    <span className="text-[12px] font-semibold text-[#1d1d1f]">Итого к оплате</span>
                    <span className="text-[22px] font-bold font-mono text-[#0071e3]">{fmt(result.grandTotal)}</span>
                  </div>
                </section>
              )
            })()}

            {!clientView && (<>
            {/* Cost breakdown */}
            <section className="bg-white rounded-2xl border border-[#e8e8ed] p-4">
              <p className="text-[11px] font-bold text-[#86868b] uppercase tracking-widest mb-3">Себестоимость</p>
              <div className="space-y-1.5">
                {result.costLines.map((l, i) => (
                  <div key={i} className="flex justify-between items-start gap-2">
                    <span className="text-[12px] text-[#6e6e73] leading-tight flex-1">{l.name}</span>
                    <span className="text-[12px] font-mono text-[#1d1d1f] whitespace-nowrap">{l.total.toLocaleString('ru-RU')} ₽</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2.5 pt-2.5 border-t border-[#f2f2f7] font-semibold">
                <span className="text-[13px] text-[#1d1d1f]">Итого</span>
                <span className="text-[13px] font-mono text-[#1d1d1f]">{result.totalCost.toLocaleString('ru-RU')} ₽</span>
              </div>
            </section>

            {/* Price calc */}
            <section className="bg-white rounded-2xl border border-[#e8e8ed] p-4">
              <p className="text-[11px] font-bold text-[#86868b] uppercase tracking-widest mb-3">Ценообразование</p>
              <div className="space-y-1.5 text-[13px]">
                {[
                  { l: 'Себестоимость',            v: fmt(result.totalCost) },
                  { l: `Налог ${result.expensesPercent}%`, v: fmt(result.expensesAmount) },
                ].map(r => (
                  <div key={r.l} className="flex justify-between text-[#6e6e73]">
                    <span>{r.l}</span><span className="font-mono">{r.v}</span>
                  </div>
                ))}
                <div className="flex justify-between font-semibold text-[#1d1d1f] pt-1 border-t border-[#f2f2f7]">
                  <span>Цена без услуг</span><span className="font-mono">{fmt(result.basePrice)}</span>
                </div>
                {result.partnerAmount > 0 && (
                  <div className="flex justify-between text-[#6e6e73]">
                    <span>Партнёр</span><span className="font-mono">+{fmt(result.partnerAmount)}</span>
                  </div>
                )}
                {result.discountAmount > 0 && (
                  <div className="flex justify-between text-[#6e6e73]">
                    <span>Скидка</span><span className="font-mono">−{fmt(result.discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-[#1d1d1f] pt-1 border-t border-[#f2f2f7]">
                  <span>Цена клиенту</span><span className="font-mono">{fmt(result.finalPrice)}</span>
                </div>
              </div>

              {/* +10% hint */}
              {(() => {
                const nm = inputs.margin + 10
                const d  = 1 - nm / 100 - result.expensesPercent / 100
                if (d <= 0) return null
                const nf = Math.round((result.totalCost / d / (inputs.partnerPercent > 0 ? (1 - inputs.partnerPercent/100) : 1)) * (1 - inputs.discount/100))
                return (
                  <button onClick={() => setMargin(String(nm))}
                    className="mt-2 w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#f5fff8] border border-[#c6f0d4] hover:bg-[#ecfcf2] transition-colors text-left">
                    <span className="text-[11px] text-[#1a7f37] font-medium">+10% к марже</span>
                    <div className="text-right">
                      <span className="text-[12px] font-mono font-bold text-[#1a7f37]">{nf.toLocaleString('ru-RU')} ₽</span>
                      <span className="text-[10px] text-[#57a86d] ml-1.5">+{(nf-result.finalPrice).toLocaleString('ru-RU')}</span>
                    </div>
                  </button>
                )
              })()}
            </section>

            {/* Services */}
            {result.serviceLines.length > 0 && (
              <section className="bg-white rounded-2xl border border-[#e8e8ed] p-4">
                <p className="text-[11px] font-bold text-[#86868b] uppercase tracking-widest mb-2">Услуги</p>
                <div className="space-y-1.5">
                  {result.serviceLines.map((s, i) => (
                    <div key={i} className="flex justify-between text-[13px]">
                      <span className="text-[#6e6e73]">{s.name} ({s.qty} {s.unit})</span>
                      <span className="font-mono text-[#1d1d1f]">{fmt(s.total)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Margin + total */}
            <section className="bg-white rounded-2xl border border-[#e8e8ed] p-4">
              <div className="flex justify-between items-center mb-3">
                <span className="text-[13px] text-[#6e6e73]">Маржа</span>
                <span className="text-[20px] font-bold font-mono" style={{ color: marginColor }}>{result.margin}%</span>
              </div>
              <div className="flex justify-between items-center mb-3">
                <span className="text-[13px] text-[#6e6e73]">Прибыль</span>
                <span className="text-[14px] font-mono font-semibold text-[#1d1d1f]">{fmt(result.profit)}</span>
              </div>
              <div className="h-px bg-[#f2f2f7] mb-3"/>

              {/* Разбивка итога */}
              <div className="space-y-1.5 mb-3">
                <div className="flex justify-between items-baseline">
                  <span className="text-[13px] text-[#6e6e73]">Изделие</span>
                  <span className="text-[13px] font-mono text-[#1d1d1f]">{fmt(result.finalPrice)}</span>
                </div>
                {result.serviceLines.map((s, i) => {
                  const isDeliveryMkad = s.name === 'Доставка за МКАД'
                  const isMoscow = s.name === 'Доставка'
                  const label = isDeliveryMkad
                    ? `Доставка МСК + ${km} км`
                    : isMoscow
                    ? 'Доставка по Москве'
                    : s.name
                  return (
                    <div key={i} className="flex justify-between items-baseline">
                      <span className="text-[13px] text-[#6e6e73]">{label}</span>
                      <span className="text-[13px] font-mono text-[#1d1d1f]">{fmt(s.total)}</span>
                    </div>
                  )
                })}
              </div>

              <div className="h-px bg-[#f2f2f7] mb-3"/>
              <div className="flex justify-between items-baseline">
                <span className="text-[13px] font-semibold text-[#1d1d1f]">ИТОГО</span>
                <span className="text-[24px] font-bold font-mono text-[#1d1d1f]">{fmt(result.grandTotal)}</span>
              </div>
            </section>
            </>)}

            {/* Client info */}
            <section className="bg-white rounded-2xl border border-[#e8e8ed] p-4">
              <p className="text-[11px] font-bold text-[#86868b] uppercase tracking-widest mb-2">Клиент (необязательно)</p>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={clientName}
                  onChange={e => setClientName(e.target.value)}
                  placeholder="Имя клиента"
                  className="border border-[#e8e8ed] rounded-[10px] px-3 py-2 text-[13px] outline-none focus:border-[#0071e3] transition-colors"
                />
                <input
                  type="text"
                  value={clientPhone}
                  onChange={e => setClientPhone(e.target.value)}
                  placeholder="+7 000 000-00-00"
                  className="border border-[#e8e8ed] rounded-[10px] px-3 py-2 text-[13px] outline-none focus:border-[#0071e3] transition-colors"
                />
              </div>
            </section>

            {/* КП text */}
            <section className="bg-white rounded-2xl border border-[#e8e8ed] p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-bold text-[#86868b] uppercase tracking-widest">Текст КП</p>
                <button onClick={handleCopy} className="text-[12px] text-[#0071e3] hover:underline">
                  {copied ? 'Скопировано' : 'Копировать'}
                </button>
              </div>
              <pre className="text-[11px] text-[#4b4b47] whitespace-pre-wrap leading-relaxed font-sans">
                {result.clientText}
              </pre>
            </section>

            {/* What's Next — appears after save */}
            {savedId && (
              <section className="bg-[#f0f7ff] rounded-2xl border border-[#bdd9ff] p-4">
                <p className="text-[11px] font-bold text-[#0071e3] uppercase tracking-wider mb-3">
                  ✓ Расчёт #{savedId} сохранён — что дальше?
                </p>
                <button onClick={handleCopy}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-[#0071e3] text-white rounded-xl text-[13px] font-semibold hover:bg-[#0062c4] transition-colors mb-2">
                  📋 Скопировать текст клиенту
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <a href={`/calculations/${savedId}/print`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-[#e8e8ed] rounded-xl text-[12px] font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors">
                    📄 PDF КП
                  </a>
                  <a href={`/calculations/${savedId}`}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-[#e8e8ed] rounded-xl text-[12px] font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors">
                    ✏️ Открыть расчёт
                  </a>
                  <Link href="/calculations"
                    className="flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-[#e8e8ed] rounded-xl text-[12px] font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors">
                    📋 История
                  </Link>
                  <button onClick={() => { setSavedId(null); setClientName(''); setClientPhone(''); window.scrollTo(0, 0); }}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-[#e8e8ed] rounded-xl text-[12px] font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors">
                    ➕ Новый расчёт
                  </button>
                </div>
              </section>
            )}

          </div>
        </div>

        <CartSection />
      </div>

    </div>
  )
}
