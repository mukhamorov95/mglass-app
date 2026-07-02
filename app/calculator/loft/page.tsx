'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { Material, Service, HardwareItem, FinancialSettings, PartnerType } from '@/lib/types'
import PricingBlock from '@/components/PricingBlock'
import { calculateLoft, LoftInputs, LoftSystemType, LoftResult } from '@/lib/loftCalculator'
import { useCart } from '@/lib/CartContext'
import CartSection from '@/components/CartSection'
import { saveCalculation } from '@/lib/saveCalculation'
import { useOwnerStrategy } from '@/lib/useOwnerStrategy'
import ProductVisualization from '@/components/ProductVisualization'

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

function loadSaved(): Record<string, unknown> {
  try { return JSON.parse(localStorage.getItem('mglass_loft') ?? 'null') ?? {} } catch { return {} }
}

function Check({ value, onClick }: { value: boolean; onClick: () => void }) {
  return (
    <div onClick={onClick}
      className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors ${value ? 'bg-blue-600 border-blue-600' : 'border-faint hover:border-blue-400'}`}>
      {value && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
    </div>
  )
}

function Toggle({ value, onClick, label, desc }: { value: boolean; onClick: () => void; label: string; desc?: string }) {
  return (
    <div className="flex items-start gap-2 cursor-pointer" onClick={onClick}>
      <Check value={value} onClick={onClick} />
      <div className="min-w-0">
        <p className="text-xs text-ink leading-tight">{label}</p>
        {desc && <p className="text-[10px] text-muted leading-tight mt-0.5">{desc}</p>}
      </div>
    </div>
  )
}

// Allowed glass thicknesses for loft partitions — change here to add more options
const LOFT_GLASS_MM = [4]

// Extract thickness (mm) from glass name like "Стекло М1 прозрачное 4 мм"
function glassNameToMm(name: string): number | null {
  const m = name.match(/^Стекло\s+.+?\s+(\d+)\s*мм\s*$/i)
  return m ? parseInt(m[1]) : null
}

export default function LoftCalculatorPage() {
  const [materials, setMaterials]   = useState<Material[]>([])
  const [services, setServices]     = useState<Service[]>([])
  const [allHardware, setAllHardware] = useState<HardwareItem[]>([])
  const [allSettings, setAllSettings] = useState<FinancialSettings[]>([])
  const [partners, setPartners]     = useState<PartnerType[]>([])
  const [loading, setLoading]       = useState(true)
  const [role, setRole]             = useState<string | null>(null)
  const [copied, setCopied]         = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [addedToCart, setAddedToCart] = useState(false)
  const [saving, setSaving]         = useState(false)
  const [savedId, setSavedId]       = useState<number | null>(null)
  const [clientName, setClientName]   = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [editCalcId]        = useState<number | null>(() => (loadSaved().__editCalcId__ as number) ?? null)
  const [editOrderGroupId]  = useState<string | null>(() => (loadSaved().__order_group_id__ as string) ?? null)
  const [editCalcOldPrice]  = useState<number | null>(() => (loadSaved().__old_final_price__ as number) ?? null)
  const { addItem } = useCart()
  const { strategy } = useOwnerStrategy()

  const [calcTier, setCalcTier]     = useState<'standard' | 'b2b'>(() => (loadSaved().calcTier as 'standard' | 'b2b') ?? 'standard')
  const [width, setWidth]           = useState(() => (loadSaved().width as string) ?? '2000')
  const [height, setHeight]         = useState(() => (loadSaved().height as string) ?? '2400')
  const [sections, setSections]     = useState(() => (loadSaved().sections as string) ?? '3')
  const [divisions, setDivisions]   = useState(() => (loadSaved().divisions as string) ?? '2')
  const [systemType, setSystemType] = useState<LoftSystemType>(() => (loadSaved().systemType as LoftSystemType) ?? 'fixed')
  const [glassId, setGlassId]       = useState<number | null>(() => (loadSaved().glassId as number) ?? null)
  const [glassWastePct, setGlassWastePct]   = useState<number>(0)
  const [glassCalcPrice, setGlassCalcPrice] = useState<number | undefined>(undefined)
  const withTempering = true
  const [withMirrorFilm, setWithMirrorFilm]   = useState(() => (loadSaved().withMirrorFilm as boolean) ?? false)
  const [withPainting, setWithPainting]       = useState(() => (loadSaved().withPainting as boolean) ?? false)
  const [hasInstallation, setHasInstallation] = useState(() => (loadSaved().hasInstallation as boolean) ?? false)
  const [hasDelivery, setHasDelivery]         = useState(() => (loadSaved().hasDelivery as boolean) ?? false)
  const [kmFromMkad, setKmFromMkad]           = useState('')
  const [deliveryBase, setDeliveryBase]       = useState(2000)
  const [deliveryPerKm, setDeliveryPerKm]     = useState(50)
  const [selectedHwIds, setSelectedHwIds]     = useState<Set<number>>(() => new Set((loadSaved().selectedHwIds as number[]) ?? []))
  const [hwQty, setHwQty]           = useState<Record<number, number>>(() => (loadSaved().hwQty as Record<number, number>) ?? {})
  const [partnerId, setPartnerId]   = useState<number | null>(() => (loadSaved().partnerId as number) ?? null)
  const [discount, setDiscount]     = useState(() => (loadSaved().discount as string) ?? '0')
  const [margin, setMargin]         = useState(() => (loadSaved().margin as string) ?? '40')
  const [b2bDiscount, setB2bDiscount] = useState<number>(() => (loadSaved().b2bDiscount as number) ?? 20)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: prof } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
        setRole((prof as { role?: string } | null)?.role ?? null)
      }
      const [{ data: mats }, { data: svcs }, { data: hw }, { data: fins }, { data: pts }, delivRes] = await Promise.all([
        supabase.from('materials').select('*').eq('active', true).order('category').order('name'),
        supabase.from('services').select('*').eq('active', true),
        supabase.from('hardware_items').select('*').eq('active', true).order('system_type'),
        supabase.from('financial_settings').select('*'),
        supabase.from('partner_types').select('*').eq('active', true),
        fetch('/api/admin/pricing-formula'),
      ])
      setServices(svcs ?? [])
      setAllHardware(hw ?? [])
      setAllSettings((fins ?? []) as FinancialSettings[])
      setPartners(pts ?? [])
      if (delivRes.ok) {
        const formula = await delivRes.json() as { section: string; param_key: string; value: number }[]
        const bp = formula.find(p => p.section === 'delivery' && p.param_key === 'base_price')?.value
        const pk = formula.find(p => p.section === 'delivery' && p.param_key === 'price_per_km')?.value
        if (bp != null) setDeliveryBase(bp)
        if (pk != null) setDeliveryPerKm(pk)
      }

      // Build glass list: prefer materials table, fallback to glass_price_matrix
      const realMats = (mats ?? []) as Material[]
      let allMats = realMats
      const hasGlassInMaterials = realMats.some(m => m.category === 'стекло')
      if (!hasGlassInMaterials) {
        const { data: matrix } = await supabase
          .from('glass_price_matrix')
          .select('name,price_type,t4,t5,t6,t8,t10,t12,waste_pct')
          .eq('category', 'glass')
          .order('name')
        const THICKNESSES = ([4, 5, 6, 8, 10, 12] as const).filter(mm => LOFT_GLASS_MM.includes(mm))
        const costRows = (matrix ?? []).filter(r => r.price_type === 'cost')
        const saleRows = (matrix ?? []).filter(r => r.price_type === 'sale')
        const synth: Material[] = []
        costRows.forEach((row, ri) => {
          THICKNESSES.forEach(mm => {
            const tKey = `t${mm}` as keyof typeof row
            if (row[tKey] != null && Number(row[tKey]) > 0) {
              const saleRow = saleRows.find(r => r.name === row.name)
              const salePrice = saleRow ? (Number((saleRow as Record<string, unknown>)[`t${mm}`]) || 0) : 0
              synth.push({
                id: -(ri * 100 + mm),
                name: `Стекло ${row.name} ${mm} мм`,
                short_name: null,
                category: 'стекло',
                unit: 'м²',
                cost_price: Number(row[tKey]) || 0,
                sale_price: salePrice,
                has_vat: false,
                vat_rate: 0,
                active: true,
                in_stock: true,
                comment: null,
                image_url: null,
                created_at: '',
                updated_at: '',
              } as Material)
            }
          })
        })
        allMats = [...realMats, ...synth]
      }
      setMaterials(allMats)

      const saved = loadSaved()
      const glasses = allMats.filter(m => m.category === 'стекло')
      if (!saved.glassId && glasses.length) setGlassId(glasses[0].id)
      const loftSettings =
        (fins ?? []).find((s: FinancialSettings) => s.product_type === 'loft') ??
        (fins ?? []).find((s: FinancialSettings) => s.tier === 'standard') ??
        fins?.[0] ?? null
      if (!saved.margin && loftSettings) setMargin(String((loftSettings as FinancialSettings).default_margin))
      setLoading(false)
    }
    load()
  }, [])

  const settings =
    allSettings.find(s => s.product_type === 'loft') ??
    allSettings.find(s => s.tier === 'standard') ??
    allSettings[0] ?? null

  useEffect(() => {
    const s = allSettings.find(s => s.product_type === 'loft') ?? allSettings.find(s => s.tier === 'standard')
    if (s) setMargin(String(s.default_margin))
  }, [allSettings])

  useEffect(() => {
    try {
      localStorage.setItem('mglass_loft', JSON.stringify({
        calcTier, width, height, sections, divisions, systemType, glassId,
        withMirrorFilm, withPainting, hasInstallation, hasDelivery,
        discount, margin, partnerId, selectedHwIds: [...selectedHwIds], hwQty, b2bDiscount,
      }))
    } catch {}
  }, [calcTier, width, height, sections, divisions, systemType, glassId,
      withMirrorFilm, withPainting, hasInstallation, hasDelivery,
      discount, margin, partnerId, selectedHwIds, hwQty, b2bDiscount])

  const glassMaterials  = materials.filter(m => {
    if (m.category !== 'стекло') return false
    const mm = glassNameToMm(m.name)
    return mm === null || LOFT_GLASS_MM.includes(mm)
  })
  const selectedGlass   = glassMaterials.find(m => m.id === glassId) ?? null

  // Load waste_pct (cost row) and sale price (sale row) from glass_price_matrix when glass changes
  useEffect(() => {
    if (!selectedGlass) { setGlassWastePct(0); setGlassCalcPrice(undefined); return }

    // Parse: "Стекло М1 прозрачное 4 мм" → typeName="М1 прозрачное", mm=4
    const nameMatch = selectedGlass.name.match(/^Стекло\s+(.+?)\s+(\d+)\s*мм\s*$/i)
    const typeName  = nameMatch?.[1]?.trim() ?? selectedGlass.name
    const mm        = nameMatch ? parseInt(nameMatch[2]) : 4
    const tKey      = `t${mm}` as 't4' | 't5' | 't6' | 't8' | 't10' | 't12'

    Promise.all([
      supabase.from('glass_price_matrix').select('waste_pct').eq('price_type', 'cost').eq('category', 'glass').eq('name', typeName).maybeSingle(),
      supabase.from('glass_price_matrix').select('t4,t5,t6,t8,t10,t12').eq('price_type', 'sale').eq('category', 'glass').eq('name', typeName).maybeSingle(),
    ]).then(([costRes, saleRes]) => {
      setGlassWastePct(costRes.data?.waste_pct ?? 0)
      const salePrice = (saleRes.data as Record<string, number | null> | null)?.[tKey] ?? null
      setGlassCalcPrice(salePrice ?? undefined)
    })
  }, [selectedGlass?.id])
  const selectedPartner = partners.find(p => p.id === partnerId) ?? null
  const minMargin       = strategy.min_margin
  const loftExpensesPercent = settings?.tax_percent ?? 0
  const installSvc      = services.find(s => s.name.toLowerCase().includes('монтаж лофт') || s.name.toLowerCase().includes('монтаж перегородки'))
  const deliverySvc     = services.find(s => s.name.toLowerCase().includes('доставка'))
  const SWING_EXCLUDED = new Set(['Замок-защёлка', 'Петля угловая', 'Ручка-скоба'])
  const relevantHardware = allHardware.filter(hw =>
    (hw.system_type === 'universal' || hw.system_type === systemType) &&
    !(systemType === 'swing' && SWING_EXCLUDED.has(hw.name))
  )

  function toggleHw(id: number) {
    setSelectedHwIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else { next.add(id); setHwQty(q => ({ ...q, [id]: q[id] ?? 1 })) }
      return next
    })
  }

  const km = Number(kmFromMkad) || 0
  const deliveryCost = hasDelivery && km > 0 ? Math.round(deliveryBase + deliveryPerKm * km) : undefined

  const inputs: LoftInputs = {
    width: Number(width) || 0, height: Number(height) || 0,
    sections: Number(sections) || 1, divisions: Number(divisions) || 0,
    systemType, glassMaterial: selectedGlass, glassWastePct, glassCalcPrice,
    withTempering, withMirrorFilm, withPainting, hasInstallation, hasDelivery,
    deliveryCost,
    hardware: relevantHardware.filter(h => selectedHwIds.has(h.id)),
    hardwareQty: hwQty,
    partnerPercent: selectedPartner?.percent ?? 0,
    discount: Number(discount) || 0,
    margin: Number(margin) || 40,
  }

  const result: LoftResult | null = useMemo(() => {
    if (!settings) return null
    return calculateLoft(inputs, materials, services, settings)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, sections, divisions, systemType, glassId, withTempering, withMirrorFilm, withPainting,
      hasInstallation, hasDelivery, kmFromMkad, deliveryCost, selectedHwIds, hwQty, partnerId, discount, margin, materials, services, settings])

  const marginNum   = result?.margin ?? 0
  const marginColor = marginNum >= 35 ? 'text-emerald-600' : marginNum >= minMargin ? 'text-amber-600' : 'text-red-600'
  const marginBg    = marginNum >= 35 ? 'bg-emerald-50 border-emerald-200' : marginNum >= minMargin ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'

  const isB2B       = calcTier === 'b2b'
  const b2bPrice    = result ? Math.round(result.finalPrice * (1 - b2bDiscount / 100)) : 0
  const b2bMargin   = result && b2bPrice > 0 ? ((b2bPrice - result.totalCost - result.expensesAmount) / b2bPrice) * 100 : 0
  const b2bMarginColor = b2bMargin >= 35 ? 'text-emerald-600' : b2bMargin >= minMargin ? 'text-amber-600' : 'text-red-600'
  const b2bExpensesAmount = result ? Math.round(b2bPrice * (result.expensesPercent / 100)) : 0
  const b2bProfit = result ? Math.round(b2bPrice - result.totalCost - b2bExpensesAmount) : 0

  function handleAddToCart() {
    if (!result) return
    addItem({
      product_type: 'loft',
      label: `Лофт ${systemType} ${width}×${height} мм`,
      input_data: {
        width, height, sections, divisions, systemType,
        glassId, glassName: selectedGlass?.name ?? null,
        glassThickness: selectedGlass ? glassNameToMm(selectedGlass.name) : null,
        withTempering, withMirrorFilm, withPainting,
        hasInstallation, hasDelivery, kmFromMkad: Number(kmFromMkad) || 0,
        partnerId, discount: Number(discount) || 0, margin: Number(margin) || 40,
      },
      cost_breakdown: { lines: result.costLines, totalCost: result.totalCost },
      financial_breakdown: {
        expensesPercent: result.expensesPercent, expensesAmount: result.expensesAmount,
        basePrice: result.basePrice, partnerAmount: result.partnerAmount,
        discountAmount: result.discountAmount, serviceLines: result.serviceLines, servicesTotal: result.servicesTotal,
      },
      base_price: result.basePrice, discount: inputs.discount, partner_percent: inputs.partnerPercent,
      // INV-1: grandTotal = product + services (что клиент реально платит)
      final_price: result.grandTotal, grand_total: result.grandTotal,
      margin: result.margin, profit: result.profit, manager_bonus: 0, client_text: result.clientText,
    })
    setMargin(String(settings?.default_margin ?? 40))
    setAddedToCart(true)
    setTimeout(() => setAddedToCart(false), 2000)
  }

  const discountExceeded = Number(discount) > strategy.max_manager_discount

  async function handleSave() {
    if (!result) return
    if (discountExceeded) return
    setSaving(true)

    const payload = {
      product_type: 'loft' as const,
      input_data: {
        width, height, sections, divisions, systemType,
        glassId, glassName: selectedGlass?.name ?? null,
        glassThickness: selectedGlass ? glassNameToMm(selectedGlass.name) : null,
        withTempering, withMirrorFilm, withPainting,
        hasInstallation, hasDelivery, kmFromMkad: Number(kmFromMkad) || 0,
        partnerId, discount: Number(discount) || 0, margin: Number(margin) || 40,
      },
      cost_breakdown: { lines: result.costLines, totalCost: result.totalCost },
      financial_breakdown: {
        expensesPercent: result.expensesPercent, expensesAmount: result.expensesAmount,
        basePrice: result.basePrice, partnerAmount: result.partnerAmount,
        discountAmount: result.discountAmount, serviceLines: result.serviceLines, servicesTotal: result.servicesTotal,
      },
      base_price: result.basePrice, discount: inputs.discount, partner_percent: inputs.partnerPercent,
      final_price: result.grandTotal, margin: result.margin, profit: result.profit,
      manager_bonus: 0, client_text: result.clientText,
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


  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-muted text-sm">Загрузка...</div>
  )

  const installPrice = installSvc ? (installSvc.sale_price ?? installSvc.cost_price) : 0
  const deliveryPrice = deliverySvc ? (deliverySvc.sale_price ?? deliverySvc.cost_price) : 0

  return (
    <div className="bg-canvas min-h-screen">
      <div className="max-w-[1100px] mx-auto px-4 py-4">

        {/* Шапка */}
        {editCalcId && (
          <div className="mb-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
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
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <a href="/" className="text-muted hover:text-ink-soft text-xs">← Главная</a>
            <span className="text-faint">/</span>
            <h1 className="text-sm font-semibold text-ink">Лофт-перегородка</h1>
          </div>
          <div className="flex gap-1 p-1 bg-line-soft rounded-lg">
            {(['standard', 'b2b'] as const).map(t => (
              <button key={t} onClick={() => setCalcTier(t)}
                className={`px-3 py-1 rounded-md text-[12px] font-medium transition-all ${
                  calcTier === t
                    ? t === 'b2b' ? 'bg-orange-500 text-white shadow-sm' : 'bg-surface text-ink shadow-sm'
                    : 'text-ink-soft hover:text-ink'
                }`}>
                {t === 'standard' ? 'Стандартная' : `B2B −${b2bDiscount}%`}
              </button>
            ))}
          </div>
        </div>

        {/* ── Quick presets ─────────────────────────────────── */}
        <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
          <span className="text-[11px] font-semibold text-muted flex-shrink-0 whitespace-nowrap">Быстрый старт:</span>
          {([
            { l: 'Глухая 200×240 / 3 секц.',    action: () => { setSystemType('fixed');   setWidth('2000'); setHeight('2400'); setSections('3'); setDivisions('2'); setSelectedHwIds(new Set()); } },
            { l: 'Раздвижная 150×240 / 2 секц.', action: () => { setSystemType('sliding'); setWidth('1500'); setHeight('2400'); setSections('2'); setDivisions('1'); setSelectedHwIds(new Set()); } },
            { l: 'Распашная 100×240 / дверь',    action: () => { setSystemType('swing');   setWidth('1000'); setHeight('2400'); setSections('1'); setDivisions('2'); setSelectedHwIds(new Set()); } },
            { l: 'Офис 400×270 раздвижная',      action: () => { setSystemType('sliding'); setWidth('4000'); setHeight('2700'); setSections('5'); setDivisions('2'); setSelectedHwIds(new Set()); } },
          ] as { l: string; action: () => void }[]).map(p => (
            <button key={p.l} onClick={p.action}
              className="px-3 py-1.5 text-[12px] font-medium bg-surface border border-line rounded-[10px] hover:border-blue-400 hover:text-blue-600 whitespace-nowrap flex-shrink-0 transition-colors">
              {p.l}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-3">

          {/* ── Левая колонка ── */}
          <div className="space-y-2">

            {/* Карточка 1: Конфигурация */}
            <div className="bg-surface rounded-lg border border-line p-3">
              <div className="grid grid-cols-[auto_auto_1fr] gap-x-5 items-start">

                {/* Размеры */}
                <div>
                  <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">Размеры (мм)</p>
                  <div className="flex gap-2">
                    <div>
                      <p className="text-[10px] text-muted mb-1">Ширина</p>
                      <input type="number" value={width} onChange={e => setWidth(e.target.value)}
                        className="w-24 border border-line rounded-md px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-400" />
                    </div>
                    <div>
                      <p className="text-[10px] text-muted mb-1">Высота</p>
                      <input type="number" value={height} onChange={e => setHeight(e.target.value)}
                        className="w-24 border border-line rounded-md px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-400" />
                    </div>
                  </div>
                  {result && (
                    <p className="text-[10px] text-muted mt-1.5">
                      {result.area} м² · проф. {result.metalLength} пог.м · стекло {result.glassAreaNet} м²
                      {result.glassWastePct > 0 && (
                        <span className="text-[#b45309]"> +{result.glassWastePct}% расход = {result.glassArea} м²</span>
                      )}
                    </p>
                  )}
                </div>

                {/* Структура + визуализация */}
                <div>
                  <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">Структура</p>
                  <div className="flex gap-2 items-end">
                    <div>
                      <p className="text-[10px] text-muted mb-1">Секции</p>
                      <input type="number" min="1" max="20" value={sections} onChange={e => setSections(e.target.value)}
                        className="w-14 border border-line rounded-md px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-400" />
                    </div>
                    <div>
                      <p className="text-[10px] text-muted mb-1">Деления</p>
                      <input type="number" min="0" max="10" value={divisions} onChange={e => setDivisions(e.target.value)}
                        className="w-14 border border-line rounded-md px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-400" />
                    </div>
                    {Number(sections) > 0 && (
                      <div className="border-2 border-muted rounded flex-shrink-0"
                        style={{ display: 'grid', gridTemplateColumns: `repeat(${Number(sections)}, 1fr)`, width: 56, height: 44 }}>
                        {Array.from({ length: Number(sections) }).map((_, si) => (
                          <div key={si} className={si > 0 ? 'border-l-2 border-muted' : ''}
                            style={{ display: 'grid', gridTemplateRows: `repeat(${Number(divisions) + 1}, 1fr)` }}>
                            {Array.from({ length: Number(divisions) + 1 }).map((_, di) => (
                              <div key={di} className={`bg-blue-50 ${di > 0 ? 'border-t-2 border-muted' : ''}`} />
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Тип системы */}
                <div>
                  <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">Тип системы</p>
                  <div className="flex gap-1">
                    {([
                      { value: 'fixed', label: 'Глухая' },
                      { value: 'sliding', label: 'Раздвижная' },
                      { value: 'swing', label: 'Распашная' },
                    ] as const).map(s => (
                      <button key={s.value}
                        onClick={() => { setSystemType(s.value); setSelectedHwIds(new Set()) }}
                        className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium border transition-colors ${systemType === s.value ? 'bg-ink text-white border-ink' : 'bg-surface text-ink-soft border-line hover:bg-subtle'}`}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Карточка 2: Всё остальное */}
            <div className="bg-surface rounded-lg border border-line p-3 space-y-3">

              {/* Стекло */}
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-[10px] text-muted mb-1">Стекло · закалка включена</p>
                  <select value={glassId ?? ''} onChange={e => setGlassId(Number(e.target.value))}
                    className="w-full border border-line rounded-md px-2 py-1.5 text-xs bg-surface focus:outline-none focus:border-blue-400">
                    {glassMaterials.length === 0 && <option value="">— нет стекла в справочнике —</option>}
                    {glassMaterials.map(m => {
                      const price = m.id === glassId && glassCalcPrice
                        ? glassCalcPrice
                        : (m.sale_price || m.cost_price)
                      return (
                        <option key={m.id} value={m.id}>
                          {m.name} — {price.toLocaleString('ru-RU')} ₽/м²
                        </option>
                      )
                    })}
                  </select>
                </div>
              </div>

              {/* Опции — 2 колонки */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                <Toggle value={withPainting}    onClick={() => setWithPainting(!withPainting)}       label="Покраска"          desc="1 200 ₽/м², мин. 10 000 ₽" />
                <Toggle value={withMirrorFilm}  onClick={() => setWithMirrorFilm(!withMirrorFilm)}   label="Зеркальная плёнка" desc="2 500 ₽/м² · доп. услуга" />
                <Toggle value={hasInstallation} onClick={() => setHasInstallation(!hasInstallation)} label="Монтаж"
                  desc={installSvc ? `${fmt(installPrice)} × ${sections} секц. = ${fmt(installPrice * Number(sections))}` : undefined} />
                <div className="col-span-2">
                  <Toggle value={hasDelivery} onClick={() => setHasDelivery(!hasDelivery)} label="Доставка"
                    desc={km > 0 ? `${fmt(deliveryCost!)} · ${deliveryBase.toLocaleString('ru-RU')} + ${km} км × ${deliveryPerKm} ₽` : deliverySvc ? `${fmt(deliveryPrice)} · по Москве` : undefined} />
                  {hasDelivery && (
                    <div className="mt-1.5 ml-6 flex items-center gap-2">
                      <span className="text-[11px] text-muted whitespace-nowrap">км от МКАД:</span>
                      <input
                        type="number" min="0" max="200" placeholder="0"
                        value={kmFromMkad}
                        onChange={e => setKmFromMkad(e.target.value)}
                        className="w-16 border border-line rounded-lg px-2 py-1 text-[12px] text-center outline-none focus:border-[#0071e3]"
                      />
                      {km > 0 && <span className="text-[11px] text-ink-soft">{fmt(deliveryCost!)}</span>}
                    </div>
                  )}
                </div>
              </div>

              {/* Фурнитура */}
              {systemType !== 'fixed' && relevantHardware.length > 0 && (
                <div className="pt-2 border-t border-line-soft">
                  <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">Фурнитура</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {relevantHardware.map(hw => (
                      <div key={hw.id} className="flex items-center gap-2">
                        <Check value={selectedHwIds.has(hw.id)} onClick={() => toggleHw(hw.id)} />
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleHw(hw.id)}>
                          <p className="text-xs text-ink leading-tight">{hw.name}</p>
                          <p className="text-[10px] text-muted">{(hw.cost_price ?? 0) > 0 ? `${(hw.cost_price ?? 0).toLocaleString('ru-RU')} ₽/${hw.unit}` : '—'}</p>
                        </div>
                        {selectedHwIds.has(hw.id) && (
                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            <button onClick={() => setHwQty(q => ({ ...q, [hw.id]: Math.max(1, (q[hw.id] ?? 1) - 1) }))}
                              className="w-5 h-5 rounded border border-line text-ink-soft hover:bg-canvas flex items-center justify-center text-sm">−</button>
                            <span className="w-5 text-center text-xs font-mono">{hwQty[hw.id] ?? 1}</span>
                            <button onClick={() => setHwQty(q => ({ ...q, [hw.id]: (q[hw.id] ?? 1) + 1 }))}
                              className="w-5 h-5 rounded border border-line text-ink-soft hover:bg-canvas flex items-center justify-center text-sm">+</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Коммерческие условия */}
              {settings && (
                <div className="pt-2 border-t border-line-soft">
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
          </div>

          {/* ── Правая колонка ── */}
          <div className="space-y-2">
            {result ? (
              <>
                {result.belowMinMargin && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    <p className="text-xs font-semibold text-red-700">Маржа ниже минимума ({minMargin}%)</p>
                  </div>
                )}

                {/* Итог */}
                <div className={`rounded-lg border p-3 ${marginBg}`}>
                  <div className="flex items-start justify-between mb-3">
                    <span className="text-xs font-semibold pt-1" style={{ color: isB2B ? '#ea580c' : '#6b6b66' }}>
                      {isB2B ? 'B2B · без монтажа' : result.servicesTotal > 0 ? 'Итого с услугами' : 'Цена клиенту'}
                    </span>
                    <div className="text-right">
                      <p className={`text-2xl font-semibold font-mono leading-none ${isB2B ? 'text-orange-500' : marginColor}`}>
                        {fmt(isB2B ? b2bPrice : result.grandTotal)}
                      </p>
                      {result.area > 0 && (
                        <p className="text-[10px] text-muted mt-1">
                          {Math.round((isB2B ? b2bPrice : result.grandTotal) / result.area).toLocaleString('ru-RU')} ₽/м²
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-black/5">
                    <div className="text-center">
                      <p className="text-[10px] text-muted">Маржа</p>
                      <p className={`text-sm font-semibold ${isB2B ? b2bMarginColor : marginColor}`}>
                        {isB2B ? b2bMargin.toFixed(1) : result.margin}%
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-muted">Прибыль</p>
                      <p className="text-sm font-semibold text-ink">
                        {fmt(isB2B ? b2bProfit : result.profit)}
                      </p>
                    </div>
                  </div>
                  {isB2B && (
                    <div className="mt-2 pt-2 border-t border-black/5 flex items-center justify-between">
                      <p className="text-[10px] text-muted">Скидка B2B</p>
                      <div className="flex gap-1">
                        {[20, 25, 30].map(d => (
                          <button key={d} onClick={() => setB2bDiscount(d)}
                            className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${b2bDiscount === d ? 'bg-orange-500 text-white border-orange-500' : 'bg-surface text-ink-soft border-line hover:bg-subtle'}`}>
                            {d}%
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {!isB2B && (
                    <div className="mt-2 pt-2 border-t border-black/5 flex items-center justify-between">
                      <p className="text-[10px] text-muted">B2B −{b2bDiscount}%</p>
                      <p className="text-[11px] font-mono text-muted">{fmt(b2bPrice)}</p>
                    </div>
                  )}
                </div>


                {/* Детали расчёта — раскрывающийся */}
                <div className="bg-surface rounded-lg border border-line overflow-hidden">
                  <button onClick={() => setShowDetails(!showDetails)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-subtle transition-colors">
                    <p className="text-[10px] font-semibold text-muted uppercase tracking-widest">Детали расчёта</p>
                    <svg className={`w-3 h-3 text-muted transition-transform ${showDetails ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showDetails && (
                    <div className="border-t border-line-soft px-3 py-2.5 space-y-3">

                      {/* Себестоимость */}
                      <div>
                        <p className="text-[10px] text-muted mb-1.5">Себестоимость</p>
                        {result.costLines.map((line, i) => (
                          <div key={i} className="flex items-baseline justify-between py-0.5">
                            <div className="flex-1 min-w-0 pr-2">
                              <span className="text-[11px] text-ink-soft">{line.name}</span>
                              <span className="text-[10px] text-faint ml-1">{line.qty} {line.unit}</span>
                            </div>
                            <span className="text-[11px] font-mono text-ink flex-shrink-0">{line.total.toLocaleString('ru-RU')} ₽</span>
                          </div>
                        ))}
                        <div className="flex justify-between pt-1.5 mt-1 border-t border-line-soft">
                          <span className="text-xs font-semibold text-ink-soft">Итого себест.</span>
                          <span className="text-xs font-mono font-semibold text-ink">{fmt(result.totalCost)}</span>
                        </div>
                      </div>

                      {/* Финмодель */}
                      <div className="pt-1 border-t border-line-soft">
                        <p className="text-[10px] text-muted mb-1.5">Ценообразование</p>
                        {(() => {
                          const priceBase = isB2B ? b2bPrice : result.basePrice
                          const expAmt    = isB2B ? b2bExpensesAmount : result.expensesAmount
                          const profit    = isB2B ? b2bProfit : Math.round(result.finalPrice - result.totalCost - result.expensesAmount)
                          return (
                            <>
                              <div className="flex justify-between py-0.5">
                                <span className="text-[11px] text-muted">Себестоимость</span>
                                <span className="text-[11px] font-mono text-ink-soft">{fmt(result.totalCost)}</span>
                              </div>
                              <div className="flex justify-between py-0.5">
                                <span className="text-[11px] text-muted">Налог {result.expensesPercent}%</span>
                                <span className="text-[11px] font-mono text-ink-soft">{fmt(expAmt)}</span>
                              </div>
                              <div className="flex justify-between py-0.5">
                                <span className="text-[11px] text-ink-soft">{isB2B ? 'Прибыль' : `Маржа ${inputs.margin}%`}</span>
                                <span className="text-[11px] font-mono text-ink">{fmt(profit)}</span>
                              </div>
                            </>
                          )
                        })()}
                        <div className="flex justify-between py-0.5 pt-1.5 border-t border-line-soft mt-1">
                          <span className="text-[11px] font-semibold text-ink-soft">Цена изделия</span>
                          <span className="text-[11px] font-mono font-semibold text-ink">{fmt(result.finalPrice)}</span>
                        </div>
                        {result.partnerAmount > 0 && (
                          <div className="flex justify-between py-0.5">
                            <span className="text-[11px] text-purple-600">Партнёрка {inputs.partnerPercent}%</span>
                            <span className="text-[11px] font-mono text-purple-600">+{fmt(result.partnerAmount)}</span>
                          </div>
                        )}
                        {result.discountAmount > 0 && (
                          <div className="flex justify-between py-0.5">
                            <span className="text-[11px] text-orange-600">Скидка {inputs.discount}%</span>
                            <span className="text-[11px] font-mono text-orange-600">−{fmt(result.discountAmount)}</span>
                          </div>
                        )}
                        {result.serviceLines.map((s, i) => (
                          <div key={i} className="flex justify-between py-0.5">
                            <span className="text-[11px] text-ink-soft">{s.name}</span>
                            <span className="text-[11px] font-mono text-ink">{fmt(s.total)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Действия */}
                <div className="flex gap-1.5">
                  <button onClick={handleAddToCart}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${addedToCart ? 'bg-emerald-600 text-white' : 'bg-ink text-white hover:bg-[#2a2a28]'}`}>
                    {addedToCart ? '✓ В корзине' : '+ В корзину'}
                  </button>
                  <button onClick={handleSave} disabled={saving || discountExceeded}
                    title={discountExceeded ? `Скидка превышает лимит ${strategy.max_manager_discount}%` : undefined}
                    className="px-3 py-2 rounded-lg text-xs font-medium border border-line bg-surface text-ink-soft hover:bg-subtle disabled:opacity-50 whitespace-nowrap">
                    {saving ? '...' : savedId ? `#${savedId} ✓` : editCalcId ? 'Сохранить как новый расчёт' : 'Сохранить расчёт'}
                  </button>
                  <button onClick={handleCopy}
                    className="px-3 py-2 rounded-lg text-xs font-medium border border-line bg-surface text-ink-soft hover:bg-subtle whitespace-nowrap">
                    {copied ? '✓ КП' : 'Копировать КП'}
                  </button>
                </div>

                {/* Клиент */}
                <div className="bg-surface rounded-lg border border-line p-3">
                  <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">Клиент (необязательно)</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" value={clientName} onChange={e => setClientName(e.target.value)}
                      placeholder="Имя клиента"
                      className="border border-line rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-blue-400 transition-colors" />
                    <input type="text" value={clientPhone} onChange={e => setClientPhone(e.target.value)}
                      placeholder="+7 000 000-00-00"
                      className="border border-line rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-blue-400 transition-colors" />
                  </div>
                </div>

                {/* Клиентский текст */}
                <div className="bg-surface rounded-lg border border-line p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-semibold text-muted uppercase tracking-widest">Текст КП</p>
                    <button onClick={handleCopy} className="text-[11px] text-blue-600 hover:underline">
                      {copied ? 'Скопировано' : 'Копировать'}
                    </button>
                  </div>
                  <pre className="text-xs text-ink-soft whitespace-pre-wrap font-sans leading-relaxed bg-subtle rounded p-2">
                    {result.clientText}
                  </pre>
                </div>

                {/* What's Next */}
                {savedId && (
                  <div className="bg-[#f0f7ff] rounded-lg border border-[#bdd9ff] p-3">
                    <p className="text-[10px] font-semibold text-[#0071e3] uppercase tracking-wider mb-2.5">
                      ✓ Расчёт #{savedId} сохранён — что дальше?
                    </p>
                    <button onClick={handleCopy}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#0071e3] text-white rounded-lg text-xs font-semibold hover:bg-[#0062c4] transition-colors mb-2">
                      📋 Скопировать текст клиенту
                    </button>
                    <div className="grid grid-cols-2 gap-1.5">
                      <a href={`/calculations/${savedId}/print`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1 px-2 py-1.5 bg-surface border border-line rounded-lg text-xs font-medium text-ink-soft hover:bg-subtle transition-colors">
                        📄 PDF КП
                      </a>
                      <a href={`/calculations/${savedId}`}
                        className="flex items-center justify-center gap-1 px-2 py-1.5 bg-surface border border-line rounded-lg text-xs font-medium text-ink-soft hover:bg-subtle transition-colors">
                        ✏️ Открыть расчёт
                      </a>
                      <a href="/calculations"
                        className="flex items-center justify-center gap-1 px-2 py-1.5 bg-surface border border-line rounded-lg text-xs font-medium text-ink-soft hover:bg-subtle transition-colors">
                        📋 История
                      </a>
                      <button onClick={() => { setSavedId(null); setClientName(''); setClientPhone(''); window.scrollTo(0, 0); }}
                        className="flex items-center justify-center gap-1 px-2 py-1.5 bg-surface border border-line rounded-lg text-xs font-medium text-ink-soft hover:bg-subtle transition-colors">
                        ➕ Новый расчёт
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className={`rounded-lg border p-8 text-center text-xs ${loftExpensesPercent + Number(margin) >= 100 ? 'bg-red-50 border-red-200 text-red-700 font-semibold' : 'bg-surface border-line text-muted'}`}>
                {loftExpensesPercent + Number(margin) >= 100
                  ? 'Сумма маржи и расходов не может быть ≥ 100%'
                  : 'Введите размеры и выберите параметры'}
              </div>
            )}

            <ProductVisualization type="loft" inputs={inputs} role={role} />

            <CartSection />
          </div>
        </div>
      </div>

    </div>
  )
}
