'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { Material, Service, FinancialSettings, PartnerType } from '@/lib/types'
import PricingBlock from '@/components/PricingBlock'
import { calculateMirror, MirrorInputs, MirrorShape, MirrorResult } from '@/lib/mirrorCalculator'
import { saveCalculation } from '@/lib/saveCalculation'
import { useCart } from '@/lib/CartContext'
import CartSection from '@/components/CartSection'

const SHAPES: { value: MirrorShape; label: string }[] = [
  { value: 'rectangle', label: 'Прямоугольник' },
  { value: 'complex',   label: 'Сложная форма' },
]

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

export default function MirrorCalculatorPage() {
  const [materials, setMaterials]   = useState<Material[]>([])
  const [services, setServices]     = useState<Service[]>([])
  const [partners, setPartners]     = useState<PartnerType[]>([])
  const [settings, setSettings]     = useState<FinancialSettings | null>(null)
  const [loading, setLoading]       = useState(true)
  const [copied, setCopied]         = useState(false)
  const [showCost, setShowCost]     = useState(false)
  const [saving, setSaving]         = useState(false)
  const [savedId, setSavedId]       = useState<number | null>(null)
  const [addedToCart, setAddedToCart] = useState(false)
  const { addItem } = useCart()

  const [width, setWidth]   = useState('1000')
  const [height, setHeight] = useState('1200')
  const [mirrorId, setMirrorId] = useState<number | null>(null)
  const [shape, setShape] = useState<MirrorShape>('rectangle')

  const [hasLighting,     setHasLighting]     = useState(true)
  const [buttonType,      setButtonType]      = useState<'none' | 'sensor' | 'wave'>('none')
  const [hasSandblast,    setHasSandblast]    = useState(false)
  const [hasSubstrate,    setHasSubstrate]    = useState(false)
  const [substratePrice,  setSubstratePrice]  = useState('2000')
  const [hasInstallation, setHasInstallation] = useState(false)
  const [hasDelivery,     setHasDelivery]     = useState(false)

  const [partnerId, setPartnerId] = useState<number | null>(null)
  const [discount, setDiscount] = useState('0')
  const [margin, setMargin] = useState('40')

  useEffect(() => {
    async function load() {
      const sb = createClient()
      const [{ data: mats }, { data: svcs }, { data: fins }, { data: pts }] = await Promise.all([
        sb.from('materials').select('*').eq('active', true).order('category').order('name'),
        sb.from('services').select('*').eq('active', true),
        sb.from('financial_settings').select('*'),
        sb.from('partner_types').select('*').eq('active', true),
      ])
      setMaterials(mats ?? [])
      setServices(svcs ?? [])
      setPartners(pts ?? [])
      const mirrorSettings =
        (fins ?? []).find((s: FinancialSettings) => s.product_type === 'mirror_light') ??
        (fins ?? []).find((s: FinancialSettings) => s.tier === 'standard') ??
        fins?.[0] ?? null
      setSettings(mirrorSettings as FinancialSettings | null)
      if (mirrorSettings) setMargin(String((mirrorSettings as FinancialSettings).default_margin))
      const mirrors = (mats ?? []).filter((m: Material) => m.category === 'зеркало')
      if (mirrors.length) setMirrorId(mirrors[0].id)
      setLoading(false)
    }
    load()
  }, [])

  const mirrorMaterials = materials.filter(m => {
    if (m.category !== 'зеркало') return false
    const n = m.name.toLowerCase()
    if (n.includes('6 мм') || n.includes('6мм')) return false
    return n.includes('silver') || n.includes('siver') || n.includes('осветл')
  })
  const selectedMirror  = mirrorMaterials.find(m => m.id === mirrorId) ?? null
  const selectedPartner = partners.find(p => p.id === partnerId) ?? null
  const minMargin      = settings?.min_margin     ?? 25
  const standardMargin = settings?.default_margin ?? 40

  const expensesPercent = settings?.tax_percent ?? 12

  const inputs: MirrorInputs = {
    width: Number(width) || 0, height: Number(height) || 0,
    mirrorMaterial: selectedMirror, shape,
    hasLighting, buttonType, hasSandblast, hasSubstrate,
    substratePrice: Number(substratePrice) || 0,
    hasInstallation, hasDelivery,
    partnerPercent: selectedPartner?.percent ?? 0,
    discount: Number(discount) || 0,
    margin:         Number(margin) || 40,
    standardMargin,
    tax:            expensesPercent,
    minMargin,
  }

  const result: MirrorResult | null = useMemo(
    () => calculateMirror(inputs, materials, services),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, height, mirrorId, shape, hasLighting, buttonType, hasSandblast, hasSubstrate,
     substratePrice, hasInstallation, hasDelivery, partnerId, discount, margin, materials, services],
  )

  const marginNum   = result?.margin ?? 0
  const marginColor = marginNum >= 35 ? 'text-emerald-600' : marginNum >= minMargin ? 'text-amber-600' : 'text-red-600'
  const marginBg    = marginNum >= 35 ? 'bg-emerald-50 border-emerald-200' : marginNum >= minMargin ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'

  function handleAddToCart() {
    if (!result) return
    addItem({
      product_type: 'mirror',
      label: `${selectedMirror?.name ?? 'Зеркало'} ${width}×${height} мм`,
      input_data: { width, height, mirrorId, shape, hasLighting, buttonType, hasSandblast, hasSubstrate },
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
      manager_bonus: result.managerBonus,
      client_text: result.clientText,
    })
    setMargin('40')
    setAddedToCart(true)
    setTimeout(() => setAddedToCart(false), 2000)
  }

  const discountExceeded = Number(discount) > (settings?.max_discount_percent ?? 30)

  async function handleSave() {
    if (!result) return
    if (discountExceeded) return
    setSaving(true)
    const saved = await saveCalculation({
      product_type: 'mirror',
      input_data: { width, height, mirrorId, shape, hasLighting, buttonType, hasSandblast, hasSubstrate },
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
    })
    if (saved && 'id' in saved) setSavedId(saved.id ?? null)
    setSaving(false)
  }

  async function handleCopy() {
    if (!result) return
    await navigator.clipboard.writeText(result.clientText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }


  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">Загрузка...</div>
  )

  const sensorBtn   = materials.find(m => m.name.toLowerCase().includes('сенсорная кнопка') && m.active)
  const waveBtn     = materials.find(m => m.name.toLowerCase().includes('датчик взмаха')    && m.active)
  const installSvc  = services.find(s => s.name.toLowerCase().includes('монтаж зеркала'))
  const deliverySvc = services.find(s => s.name.toLowerCase().includes('доставка'))

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[1100px] mx-auto px-4 py-4">

        {/* Шапка */}
        <div className="flex items-center gap-2 mb-3">
          <a href="/" className="text-[#9a9a95] hover:text-[#6b6b66] text-xs">← Главная</a>
          <span className="text-[#d4d4d0]">/</span>
          <h1 className="text-sm font-semibold text-[#111110]">Зеркало с подсветкой</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-3">

          {/* Левая колонка */}
          <div className="space-y-2">

            {/* Размеры + тип + форма — в одном ряду */}
            <div className="bg-white rounded-lg border border-[#e4e4e0] p-3">
              <div className="grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-3 items-start">

                {/* Размеры */}
                <div>
                  <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1.5">Размеры (мм)</p>
                  <div className="flex gap-2">
                    <div>
                      <p className="text-[10px] text-[#9a9a95] mb-1">Ширина</p>
                      <input type="number"
                        className="w-24 border border-[#e4e4e0] rounded-md px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-400"
                        value={width} onChange={e => setWidth(e.target.value)} />
                    </div>
                    <div>
                      <p className="text-[10px] text-[#9a9a95] mb-1">Высота</p>
                      <input type="number"
                        className="w-24 border border-[#e4e4e0] rounded-md px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-400"
                        value={height} onChange={e => setHeight(e.target.value)} />
                    </div>
                  </div>
                  {result && (
                    <p className="text-[10px] text-[#9a9a95] mt-1">
                      {result.area} м² · {result.perimeter} пог.м
                      {Number(height) > 2800 && <span className="text-orange-500 ml-1">↑×1.2</span>}
                    </p>
                  )}
                </div>

                {/* Тип зеркала */}
                <div>
                  <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1.5">Тип зеркала</p>
                  <div className="space-y-1">
                    {mirrorMaterials.map(m => {
                      const n = m.name.toLowerCase()
                      const swatch = n.includes('silver') || n.includes('siver') ? 'bg-green-400' : n.includes('осветл') ? 'bg-sky-300' : 'bg-gray-300'
                      return (
                        <label key={m.id}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-md border cursor-pointer transition-colors ${mirrorId === m.id ? 'border-blue-400 bg-blue-50' : 'border-[#e4e4e0] hover:bg-[#fafaf9]'}`}>
                          <input type="radio" className="w-3 h-3 flex-shrink-0" checked={mirrorId === m.id} onChange={() => setMirrorId(m.id)} />
                          <div className={`w-3 h-3 rounded-sm flex-shrink-0 ${swatch}`} />
                          <span className="text-xs font-medium text-[#111110]">{m.name}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>

                {/* Форма */}
                <div>
                  <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1.5">Форма</p>
                  <div className="space-y-1">
                    {SHAPES.map(s => (
                      <button key={s.value} onClick={() => setShape(s.value)}
                        className={`w-full py-1.5 px-2 rounded-md text-xs font-medium border transition-colors text-left ${shape === s.value ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0] hover:bg-[#fafaf9]'}`}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Параметры */}
            <div className="bg-white rounded-lg border border-[#e4e4e0] p-3">
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2.5">Параметры</p>

              {/* 1. Подсветка */}
              <Toggle label="Подсветка по периметру" desc="LED + профиль + рассеиватель + блок питания" value={hasLighting} set={setHasLighting} />

              {/* 2. Кнопка — только если подсветка включена */}
              {hasLighting && (
                <div className="flex items-center gap-2 mt-1.5 ml-6">
                  <span className="text-[10px] text-[#9a9a95] whitespace-nowrap">Кнопка включения</span>
                  <select value={buttonType} onChange={e => setButtonType(e.target.value as 'none' | 'sensor' | 'wave')}
                    className="flex-1 border border-[#e4e4e0] rounded px-1.5 py-0.5 text-xs bg-white focus:outline-none focus:border-blue-400">
                    <option value="none">Не нужна — 0 ₽</option>
                    <option value="sensor">Сенсорная — {(sensorBtn?.cost_price ?? 400).toLocaleString('ru-RU')} ₽</option>
                    <option value="wave">Взмах руки — {(waveBtn?.cost_price ?? 800).toLocaleString('ru-RU')} ₽</option>
                  </select>
                </div>
              )}

              <div className="h-px bg-[#f0f0ec] my-2.5" />

              {/* 3. Пескоструй */}
              <Toggle label="Пескоструйный рисунок" desc="1 200 ₽/м²" value={hasSandblast} set={setHasSandblast} />

              {/* 4. Подложка */}
              <div className="flex items-center gap-2 mt-1.5">
                <Check value={hasSubstrate} onClick={() => setHasSubstrate(!hasSubstrate)} />
                <span className="text-xs text-[#111110] cursor-pointer flex-1" onClick={() => setHasSubstrate(!hasSubstrate)}>Подложка</span>
                {hasSubstrate ? (
                  <div className="flex items-center gap-1">
                    <input type="number"
                      className="w-20 border border-[#e4e4e0] rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:border-blue-400"
                      value={substratePrice} onChange={e => setSubstratePrice(e.target.value)} />
                    <span className="text-[10px] text-[#9a9a95]">₽</span>
                  </div>
                ) : (
                  <span className="text-[10px] text-[#9a9a95]">2 000 ₽</span>
                )}
              </div>

              <div className="h-px bg-[#f0f0ec] my-2.5" />

              {/* 5. Монтаж */}
              <Toggle
                label="Монтаж"
                desc={installSvc ? fmt(installSvc.sale_price ?? installSvc.cost_price) : ''}
                value={hasInstallation} set={setHasInstallation}
              />

              {/* 6. Доставка */}
              <div className="mt-1.5">
                <Toggle
                  label="Доставка"
                  desc={deliverySvc ? fmt(deliverySvc.sale_price ?? deliverySvc.cost_price) + ' · один рейс на весь заказ' : ''}
                  value={hasDelivery} set={setHasDelivery}
                />
              </div>
            </div>

            {/* Коммерческие условия */}
            {settings && (
              <div className="bg-white rounded-lg border border-[#e4e4e0] p-3">
                <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2.5">Коммерческие условия</p>
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

          {/* Правая колонка — результат */}
          <div className="space-y-2">
            {result ? (
              <>
                {result.belowMinMargin && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    <p className="text-xs font-semibold text-red-700">Маржа ниже минимума ({minMargin}%)</p>
                  </div>
                )}

                {/* Итог — главный блок */}
                <div className={`rounded-lg border p-3 ${marginBg}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-[#6b6b66]">
                      {result.servicesTotal > 0 ? 'Итого с услугами' : 'Цена клиенту'}
                    </span>
                    <span className={`text-xl font-bold font-mono ${marginColor}`}>
                      {fmt(result.grandTotal)}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-black/5">
                    <div className="text-center">
                      <p className="text-[10px] text-[#9a9a95]">Маржа</p>
                      <p className={`text-sm font-bold ${marginColor}`}>{result.margin}%</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-[#9a9a95]">Прибыль</p>
                      <p className="text-sm font-bold text-[#111110]">{fmt(result.profit)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-[#9a9a95]">Себестоимость</p>
                      <p className="text-sm font-bold text-[#111110]">{fmt(result.totalCost)}</p>
                    </div>
                  </div>
                </div>

                {/* Себестоимость — раскрывающийся */}
                <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
                  <button onClick={() => setShowCost(!showCost)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#fafaf9] transition-colors">
                    <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Себестоимость</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-semibold text-[#111110]">{fmt(result.totalCost)}</span>
                      <svg className={`w-3 h-3 text-[#9a9a95] transition-transform ${showCost ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>
                  {showCost && (
                    <div className="px-3 pb-3 border-t border-[#f0f0ec]">
                      <div className="space-y-0.5 mt-2">
                        {result.costLines.map((line, i) => (
                          <div key={i} className="flex items-center justify-between py-1 border-b border-[#f5f5f3] last:border-0">
                            <div className="flex-1 min-w-0">
                              <span className="text-xs text-[#4b4b47]">{line.name}</span>
                              <span className="text-[10px] text-[#9a9a95] ml-1.5">{line.qty} {line.unit} × {line.price.toLocaleString('ru-RU')} ₽</span>
                            </div>
                            <span className="text-xs font-mono font-semibold text-[#111110] ml-2 flex-shrink-0">
                              {line.total.toLocaleString('ru-RU')} ₽
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Финмодель */}
                <div className="bg-white rounded-lg border border-[#e4e4e0] p-3">
                  <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2">Расчёт цены</p>
                  <div className="space-y-1">
                    {[
                      { label: 'Себестоимость',                   value: result.totalCost },
                      { label: `Налог ${expensesPercent}%`,       value: result.expensesAmount },
                      { label: `Маржа ${inputs.margin}%`,         value: result.marginAmount },
                    ].map(row => (
                      <div key={row.label} className="flex justify-between">
                        <span className="text-xs text-[#6b6b66]">{row.label}</span>
                        <span className="text-xs font-mono text-[#111110]">{fmt(Math.round(row.value))}</span>
                      </div>
                    ))}
                    <div className="flex justify-between pt-1.5 border-t border-[#f0f0ec]">
                      <span className="text-xs font-semibold text-[#4b4b47]">Базовая цена</span>
                      <span className="text-xs font-mono font-bold text-[#111110]">{fmt(result.basePrice)}</span>
                    </div>
                    {result.partnerAmount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-xs text-purple-600">Партнёрка {inputs.partnerPercent}%</span>
                        <span className="text-xs font-mono text-purple-600">+{fmt(result.partnerAmount)}</span>
                      </div>
                    )}
                    {result.discountAmount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-xs text-orange-600">Скидка {inputs.discount}%</span>
                        <span className="text-xs font-mono text-orange-600">−{fmt(result.discountAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-1.5 border-t border-[#f0f0ec]">
                      <span className="text-xs font-semibold text-[#4b4b47]">Цена изделия</span>
                      <span className="text-xs font-mono font-bold text-[#111110]">{fmt(result.finalPrice)}</span>
                    </div>

                    {/* Рекомендация +10% к марже */}
                    {(() => {
                      const newMargin = inputs.margin + 10
                      const denom = 1 - newMargin / 100 - inputs.tax / 100
                      if (denom <= 0) return null
                      const newBase        = result.totalCost / denom
                      const newWithPartner = inputs.partnerPercent > 0 ? newBase / (1 - inputs.partnerPercent / 100) : newBase
                      const newFinal       = Math.round(newWithPartner * (1 - inputs.discount / 100))
                      return (
                        <button onClick={() => setMargin(String(newMargin))}
                          className="mt-1.5 w-full flex items-start justify-between gap-3 px-2.5 py-2 rounded-md border border-dashed border-emerald-200 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-400 transition-colors text-left">
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-semibold text-emerald-700">Продать дороже +10% к марже</p>
                            <p className="text-[10px] text-emerald-500 mt-0.5">нажми чтобы применить</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs font-mono font-bold text-emerald-700">{fmt(newFinal)}</p>
                            <p className="text-[10px] text-emerald-500">+{fmt(newFinal - result.finalPrice)}</p>
                          </div>
                        </button>
                      )
                    })()}

                    {result.serviceLines.map((s, i) => (
                      <div key={i} className="flex justify-between">
                        <span className="text-xs text-[#6b6b66]">{s.name}</span>
                        <span className="text-xs font-mono text-[#111110]">{fmt(s.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>


                {/* Действия */}
                <div className="flex gap-1.5">
                  <button onClick={handleAddToCart}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${addedToCart ? 'bg-emerald-600 text-white' : 'bg-[#111110] text-white hover:bg-[#2a2a28]'}`}>
                    {addedToCart ? '✓ В корзине' : '+ В корзину'}
                  </button>
                  <button onClick={handleSave} disabled={saving || discountExceeded}
                    title={discountExceeded ? `Скидка превышает лимит ${settings?.max_discount_percent}%` : undefined}
                    className="px-3 py-2 rounded-lg text-xs font-medium border border-[#e4e4e0] bg-white text-[#4b4b47] hover:bg-[#fafaf9] disabled:opacity-50 whitespace-nowrap">
                    {saving ? '...' : savedId ? `#${savedId} ✓` : 'Сохранить расчёт'}
                  </button>
                  <button onClick={handleCopy}
                    className="px-3 py-2 rounded-lg text-xs font-medium border border-[#e4e4e0] bg-white text-[#4b4b47] hover:bg-[#fafaf9] whitespace-nowrap">
                    {copied ? '✓ КП' : 'Копировать КП'}
                  </button>
                </div>
                {savedId && (
                  <a href={`/calculations/${savedId}`}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium border border-[#e4e4e0] bg-[#fafaf9] text-[#4b4b47] hover:bg-[#f0f0ec] transition-colors">
                    → История расчётов #{savedId}
                  </a>
                )}

                {/* Клиентский текст */}
                <div className="bg-white rounded-lg border border-[#e4e4e0] p-3">
                  <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2">Текст для клиента</p>
                  <pre className="text-xs text-[#4b4b47] whitespace-pre-wrap font-sans leading-relaxed bg-[#fafaf9] rounded p-2">
                    {result.clientText}
                  </pre>
                </div>
              </>
            ) : (
              <div className={`rounded-lg border p-6 text-center text-xs ${expensesPercent + Number(margin) >= 100 ? 'bg-red-50 border-red-200 text-red-700 font-semibold' : 'bg-white border-[#e4e4e0] text-[#9a9a95]'}`}>
                {expensesPercent + Number(margin) >= 100
                  ? 'Сумма маржи и расходов не может быть ≥ 100%'
                  : 'Введите размеры и выберите параметры'}
              </div>
            )}

            {/* Корзина — прямо в правой колонке */}
            <CartSection />
          </div>
        </div>
      </div>

    </div>
  )
}

function Check({ value, onClick }: { value: boolean; onClick: () => void }) {
  return (
    <div onClick={onClick}
      className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors ${value ? 'bg-blue-600 border-blue-600' : 'border-[#c4c4be] hover:border-blue-400'}`}>
      {value && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
    </div>
  )
}

function Toggle({ label, desc, value, set }: { label: string; desc: string; value: boolean; set: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Check value={value} onClick={() => set(!value)} />
      <div className="cursor-pointer" onClick={() => set(!value)}>
        <p className="text-xs text-[#111110] leading-tight">{label}</p>
        {desc && <p className="text-[10px] text-[#9a9a95]">{desc}</p>}
      </div>
    </div>
  )
}
