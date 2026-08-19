'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import {
  computeRailing, STANDARD_STEP,
  type RailingSegment, type RailingShape, type RailingFixing,
} from '@/lib/railingCalculator'
import { loadGlassMatrix, getMatrixNames, getAvailableMm, getMatrixPrice, type GlassMatrixRow } from '@/lib/glassMatrix'
import { loadRailingRates, rate, type RailingRatesMap } from '@/lib/railingRates'
import { suggestHardware, priceRailing } from '@/lib/railingPricing'
import { useCart } from '@/lib/CartContext'
import CartSection from '@/components/CartSection'
import { saveCalculation } from '@/lib/saveCalculation'

const supabase = createClient()
const TAX_PERCENT = 12  // канонический налог для всех продуктов (PROJECT_RULES)

const fmt  = (n: number) => n.toLocaleString('ru-RU') + ' ₽'
const fmt2 = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

type SegRow = { id: number; name: string; span: string; shape: RailingShape }

type Saved = {
  rows?: SegRow[]; height?: string; fixing?: RailingFixing; maxPanel?: string
  tread?: string; riser?: string; sheetW?: string; sheetH?: string; margin?: string
  material?: string; mm?: number; withMount?: boolean; withDelivery?: boolean; km?: string
  hwQty?: string; clientName?: string; clientPhone?: string
}
function loadSaved(): Saved {
  try { return JSON.parse(localStorage.getItem('mglass_railing') ?? 'null') ?? {} } catch { return {} }
}

const DEFAULT_ROWS: SegRow[] = [
  { id: 1, name: 'Пролёт 1', span: '3000', shape: 'raked' },
]

const fixingLabel: Record<RailingFixing, string> = { points: 'На точках', posts: 'На стойках', profile: 'Зажимной профиль' }

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-[11px] text-[#9a9a95] mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-[#9a9a95] mt-0.5">{hint}</span>}
    </label>
  )
}

const inputCls = 'w-full h-9 px-2.5 rounded-lg border border-[#e4e4e0] bg-white text-sm text-[#111110] focus:border-[#111110] outline-none'

export default function RailingCalculatorPage() {
  const s = typeof window !== 'undefined' ? loadSaved() : {}
  const { addItem } = useCart()

  const [rows, setRows]         = useState<SegRow[]>(s.rows?.length ? s.rows : DEFAULT_ROWS)
  const [height, setHeight]     = useState(s.height ?? '1100')
  const [fixing, setFixing]     = useState<RailingFixing>(s.fixing ?? 'points')
  const [maxPanel, setMaxPanel] = useState(s.maxPanel ?? '1200')
  const [tread, setTread]       = useState(s.tread ?? String(STANDARD_STEP.tread))
  const [riser, setRiser]       = useState(s.riser ?? String(STANDARD_STEP.riser))
  const [sheetW, setSheetW]     = useState(s.sheetW ?? '3210')
  const [sheetH, setSheetH]     = useState(s.sheetH ?? '2250')
  const [margin, setMargin]     = useState(s.margin ?? '40')

  const [matrix, setMatrix]     = useState<GlassMatrixRow[]>([])
  const [material, setMaterial] = useState<string>(s.material ?? '')
  const [mm, setMm]             = useState<number>(s.mm ?? 10)

  const [rates, setRates]       = useState<RailingRatesMap>({})
  const [withMount, setWithMount]       = useState<boolean>(s.withMount ?? true)
  const [withDelivery, setWithDelivery] = useState<boolean>(s.withDelivery ?? false)
  const [km, setKm]             = useState(s.km ?? '')
  const [deliveryBase, setDeliveryBase]   = useState(5000)
  const [deliveryPerKm, setDeliveryPerKm] = useState(50)

  const [hwQty, setHwQty]       = useState(s.hwQty ?? '')   // '' = авто по правилу
  const [clientName, setClientName]   = useState(s.clientName ?? '')
  const [clientPhone, setClientPhone] = useState(s.clientPhone ?? '')

  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showCost, setShowCost]         = useState(false)
  const [copied, setCopied]     = useState(false)
  const [saving, setSaving]     = useState(false)
  const [savedId, setSavedId]   = useState<number | null>(null)
  const [addedToCart, setAddedToCart] = useState(false)

  useEffect(() => {
    loadGlassMatrix().then(rowsM => {
      setMatrix(rowsM)
      const names = getMatrixNames(rowsM, 'cost', 'glass')
      setMaterial(prev => prev || names[0] || '')
    }).catch(() => {})
    loadRailingRates(supabase).then(setRates).catch(() => {})
    supabase.from('financial_settings').select('*').then(({ data }) => {
      const list = (data ?? []) as Array<{ product_type?: string; tier?: string; default_margin?: number }>
      const row = list.find(x => x.product_type === 'railing') ?? list.find(x => x.tier === 'standard') ?? list[0]
      if (row?.default_margin != null && !s.margin) setMargin(String(row.default_margin))
    })
    fetch('/api/admin/pricing-formula').then(r => r.ok ? r.json() : []).then((f: Array<{ section: string; param_key: string; value: number }>) => {
      const bp = f.find(p => p.section === 'delivery' && p.param_key === 'base_price')?.value
      const pk = f.find(p => p.section === 'delivery' && p.param_key === 'price_per_km')?.value
      if (bp != null) setDeliveryBase(bp)
      if (pk != null) setDeliveryPerKm(pk)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('mglass_railing', JSON.stringify({
        rows, height, fixing, maxPanel, tread, riser, sheetW, sheetH, margin, material, mm,
        withMount, withDelivery, km, hwQty, clientName, clientPhone,
      }))
    } catch {}
  }, [rows, height, fixing, maxPanel, tread, riser, sheetW, sheetH, margin, material, mm, withMount, withDelivery, km, hwQty, clientName, clientPhone])

  const materialNames = getMatrixNames(matrix, 'cost', 'glass')
  const availableMm   = material ? getAvailableMm(matrix, material, 'cost', 'glass') : []
  const costPerM2     = material ? (getMatrixPrice(matrix, material, mm, 'cost', 'glass') ?? 0) : 0

  const num = (v: string, min = 0) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) && n >= min ? n : 0 }

  const geometry = useMemo(() => {
    const segments: RailingSegment[] = rows
      .filter(r => num(r.span) > 0)
      .map(r => ({ name: r.name || 'Пролёт', spanMm: num(r.span), shape: r.shape }))
    if (!segments.length) return null
    return computeRailing(segments, {
      heightMm: num(height, 1) || 1100,
      thicknessMm: mm,
      materialName: material || 'Стекло',
      fixing,
      maxPanelWidthMm: num(maxPanel, 1) || 1200,
      step: { tread: num(tread, 1) || STANDARD_STEP.tread, riser: num(riser, 1) || STANDARD_STEP.riser },
      sheet: { width: num(sheetW, 1) || 3210, height: num(sheetH, 1) || 2250 },
      costPerM2,
    })
  }, [rows, height, mm, material, fixing, maxPanel, tread, riser, sheetW, sheetH, costPerM2])

  const hwSuggestion = geometry ? suggestHardware(fixing, rates, geometry.alongSlopeTotalM) : null
  const hwQtyEff = hwQty !== '' ? num(hwQty) : (hwSuggestion?.qty ?? 0)
  const deliveryCost = withDelivery ? deliveryBase + deliveryPerKm * num(km) : 0

  const price = useMemo(() => {
    if (!geometry || !hwSuggestion) return null
    return priceRailing({
      geometry, fixing,
      glassCostPerM2: costPerM2,
      hardwareQty: hwQtyEff,
      hardwareUnitCost: hwSuggestion.unitCost,
      hardwareLabel: hwSuggestion.label,
      hardwareUnit: hwSuggestion.unit,
      withMount, mountPerM: rate(rates, 'mount_per_m'),
      withDelivery, deliveryCost,
      marginPercent: num(margin), taxPercent: TAX_PERCENT,
    })
  }, [geometry, fixing, costPerM2, hwQtyEff, hwSuggestion, withMount, rates, withDelivery, deliveryCost, margin])

  function addRow() {
    setRows(r => [...r, { id: Math.max(0, ...r.map(x => x.id)) + 1, name: `Пролёт ${r.length + 1}`, span: '', shape: 'raked' }])
  }
  function delRow(id: number) { setRows(r => r.filter(x => x.id !== id)) }
  function patchRow(id: number, patch: Partial<SegRow>) { setRows(r => r.map(x => x.id === id ? { ...x, ...patch } : x)) }

  function buildClientText(): string {
    if (!geometry || !price) return ''
    const L: string[] = ['Стеклянное ограждение']
    L.push(`Стекло: ${mm} мм ${material}, крепление ${fixingLabel[fixing].toLowerCase()}, высота ${height} мм`)
    L.push(`Пролётов: ${geometry.segments.length}, погонаж ${geometry.alongSlopeTotalM} пог.м`)
    L.push('')
    L.push(`Изделие: ${fmt(price.productPrice)}`)
    if (price.mountPrice > 0)    L.push(`Монтаж: ${fmt(price.mountPrice)}`)
    if (price.deliveryPrice > 0) L.push(`Доставка: ${fmt(price.deliveryPrice)}`)
    L.push(`Итого: ${fmt(price.grandTotal)}`)
    return L.join('\n')
  }

  function buildInputData(): Record<string, unknown> {
    if (!geometry) return {}
    return {
      segments: geometry.segments.map(x => ({ name: x.name, spanMm: x.spanMm, shape: x.shape, steps: x.steps, panelCount: x.panelCount })),
      segCount: geometry.segments.length,
      spanTotalM: geometry.spanTotalM,
      alongSlopeTotalM: geometry.alongSlopeTotalM,
      netM2: geometry.netM2, blankM2: geometry.blankM2, sheetsNeeded: geometry.sheetsNeeded,
      heightMm: num(height, 1), glass: material, thickness: mm, fixing,
      hardware: hwSuggestion ? { label: hwSuggestion.label, qty: hwQtyEff, unit: hwSuggestion.unit } : null,
      withMount, withDelivery,
    }
  }

  function buildPayload() {
    if (!geometry || !price) return null
    const servicesTotal = price.mountPrice + price.deliveryPrice
    return {
      product_type: 'railing' as const,
      input_data: buildInputData(),
      cost_breakdown: { lines: price.costLines, totalCost: price.productCost + price.mountCost + (withDelivery ? deliveryCost : 0) },
      financial_breakdown: {
        serviceLines: price.serviceLines, servicesTotal, basePrice: price.productPrice,
        hardware: hwSuggestion ? { label: hwSuggestion.label, qty: hwQtyEff, unit: hwSuggestion.unit, unitCost: hwSuggestion.unitCost } : null,
      },
      base_price: price.productPrice,
      discount: 0,
      partner_percent: 0,
      final_price: price.grandTotal,
      grand_total: price.grandTotal,
      margin: price.margin,
      profit: price.profit,
      manager_bonus: 0,
      client_text: buildClientText(),
    }
  }

  async function handleSave() {
    const p = buildPayload()
    if (!p) return
    setSaving(true)
    const res = await saveCalculation({ ...p, client_name: clientName.trim() || undefined, client_phone: clientPhone.trim() || undefined })
    setSaving(false)
    if (res && 'id' in res && res.id) setSavedId(res.id)
    else alert(res && 'error' in res ? res.error : 'Ошибка сохранения')
  }

  function handleAddToCart() {
    const p = buildPayload()
    if (!p || !geometry) return
    addItem({
      product_type: 'railing',
      label: `Ограждение · ${geometry.segments.length} прол. · ${geometry.alongSlopeTotalM} пог.м`,
      input_data: p.input_data,
      cost_breakdown: p.cost_breakdown,
      financial_breakdown: p.financial_breakdown,
      base_price: p.base_price,
      discount: 0,
      partner_percent: 0,
      final_price: price!.productPrice,
      grand_total: price!.grandTotal,
      margin: price!.margin,
      profit: price!.profit,
      manager_bonus: 0,
      client_text: p.client_text,
    })
    setAddedToCart(true); setTimeout(() => setAddedToCart(false), 1500)
  }

  function copySummary() {
    const t = buildClientText()
    if (!t) return
    navigator.clipboard?.writeText(t).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  return (
    <div className="min-h-screen bg-[#f5f5f3] text-[#111110]">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <Link href="/calculations" className="text-xs text-[#9a9a95] hover:text-[#111110]">← Калькуляторы</Link>
            <h1 className="text-xl font-semibold mt-1">Лестничное ограждение</h1>
          </div>
          <button onClick={copySummary} disabled={!price}
            className="h-9 px-3 rounded-lg border border-[#e4e4e0] bg-white text-sm hover:border-[#111110] disabled:opacity-40">
            {copied ? '✓ Скопировано' : 'Копировать'}
          </button>
        </div>

        <div className="grid lg:grid-cols-[1fr_380px] gap-4 items-start">
          {/* ЛЕВО — ввод */}
          <div className="space-y-4">
            {/* ① Пролёты */}
            <div className="rounded-2xl border border-[#e4e4e0] bg-white p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium"><span className="text-[#9a9a95]">①</span> Пролёты</h2>
                <button onClick={addRow} className="h-8 px-3 rounded-lg bg-[#111110] text-white text-xs hover:opacity-90">+ Пролёт</button>
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_100px_130px_80px_32px] gap-2 text-[10px] text-[#9a9a95] px-1">
                  <span>Название</span><span>Длина, мм</span><span>Тип</span><span>Ступеней</span><span></span>
                </div>
                {rows.map(r => {
                  const span = num(r.span)
                  const steps = span > 0 ? Math.max(1, Math.round(span / (num(tread, 1) || STANDARD_STEP.tread))) : 0
                  return (
                    <div key={r.id} className="grid grid-cols-[1fr_100px_130px_80px_32px] gap-2 items-center">
                      <input value={r.name} onChange={e => patchRow(r.id, { name: e.target.value })} className={inputCls} placeholder="Пролёт" />
                      <input value={r.span} onChange={e => patchRow(r.id, { span: e.target.value })} className={inputCls} inputMode="numeric" placeholder="3000" />
                      <select value={r.shape} onChange={e => patchRow(r.id, { shape: e.target.value as RailingShape })} className={inputCls}>
                        <option value="raked">Наклонное</option>
                        <option value="rectangular">Прямое</option>
                      </select>
                      <span className="text-sm text-[#9a9a95] text-center tabular-nums">{steps || '—'}</span>
                      <button onClick={() => delRow(r.id)} className="h-9 w-8 rounded-lg border border-[#e4e4e0] text-[#9a9a95] hover:border-red-300 hover:text-red-500">×</button>
                    </div>
                  )
                })}
              </div>
              <p className="text-[10px] text-[#9a9a95] mt-2">Длина пролёта — по полу (горизонтальная проекция). Ступени считаются автоматически.</p>
            </div>

            {/* ② Изделие */}
            <div className="rounded-2xl border border-[#e4e4e0] bg-white p-4 space-y-3">
              <h2 className="text-sm font-medium"><span className="text-[#9a9a95]">②</span> Изделие</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Стекло">
                  <select value={material} onChange={e => setMaterial(e.target.value)} className={inputCls}>
                    {materialNames.length === 0 && <option value="">— загрузка —</option>}
                    {materialNames.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Толщина, мм">
                    <select value={mm} onChange={e => setMm(parseInt(e.target.value))} className={inputCls}>
                      {(availableMm.length ? availableMm : [mm]).map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </Field>
                  <Field label="Высота, мм">
                    <select value={height} onChange={e => setHeight(e.target.value)} className={inputCls}>
                      {['900', '1000', '1100', '1200'].map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </Field>
                </div>
              </div>
              <Field label="Крепление">
                <div className="grid grid-cols-3 gap-2">
                  {(['points', 'posts', 'profile'] as RailingFixing[]).map(f => (
                    <button key={f} onClick={() => { setFixing(f); setHwQty('') }}
                      className={`h-9 rounded-lg border text-xs transition-colors ${fixing === f ? 'border-[#111110] bg-[#111110] text-white' : 'border-[#e4e4e0] bg-white hover:border-[#111110]'}`}>
                      {fixingLabel[f]}
                    </button>
                  ))}
                </div>
              </Field>
            </div>

            {/* ③ Крепёж и работы */}
            {hwSuggestion && (
              <div className="rounded-2xl border border-[#e4e4e0] bg-white p-4 space-y-3">
                <h2 className="text-sm font-medium"><span className="text-[#9a9a95]">③</span> Крепёж и работы</h2>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label={`${hwSuggestion.label} (${hwSuggestion.unit})`} hint={hwQty !== '' ? `по правилу: ${hwSuggestion.qty} ${hwSuggestion.unit}` : `авто с запасом · ${fmt(hwSuggestion.unitCost)}/${hwSuggestion.unit}`}>
                    <div className="flex gap-1.5">
                      <input value={hwQty} onChange={e => setHwQty(e.target.value)} className={inputCls} inputMode="numeric" placeholder={String(hwSuggestion.qty)} />
                      {hwQty !== '' && <button onClick={() => setHwQty('')} className="h-9 px-2 rounded-lg border border-[#e4e4e0] text-[11px] text-[#9a9a95] hover:border-[#111110]">↺ авто</button>}
                    </div>
                  </Field>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer h-9 px-2.5 rounded-lg border border-[#e4e4e0] bg-white">
                      <input type="checkbox" checked={withMount} onChange={e => setWithMount(e.target.checked)} />
                      <span className="text-sm">Монтаж <span className="text-[#9a9a95]">({fmt(rate(rates, 'mount_per_m'))}/пог.м себест.)</span></span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer h-9 px-2.5 rounded-lg border border-[#e4e4e0] bg-white">
                      <input type="checkbox" checked={withDelivery} onChange={e => setWithDelivery(e.target.checked)} />
                      <span className="text-sm">Доставка</span>
                    </label>
                  </div>
                </div>
                {withDelivery && (
                  <Field label="Км от МКАД" hint={`${fmt(deliveryBase)} + ${fmt(deliveryPerKm)}/км`}>
                    <input value={km} onChange={e => setKm(e.target.value)} className={inputCls} inputMode="numeric" placeholder="0" />
                  </Field>
                )}
                <p className="text-[10px] text-[#9a9a95]">Количество крепежа — с запасом по правилу из справочника, можно поправить вручную. В КП клиенту количество не печатается.</p>
              </div>
            )}

            {/* Расширенные */}
            <div className="rounded-2xl border border-[#e4e4e0] bg-white p-4">
              <button onClick={() => setShowAdvanced(v => !v)} className="w-full flex items-center justify-between text-sm font-medium">
                <span>Расширенные параметры</span>
                <span className="text-[#9a9a95]">{showAdvanced ? '−' : '+'}</span>
              </button>
              {showAdvanced && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                  <Field label="Проступь, мм"><input value={tread} onChange={e => setTread(e.target.value)} className={inputCls} inputMode="numeric" /></Field>
                  <Field label="Подступёнок, мм"><input value={riser} onChange={e => setRiser(e.target.value)} className={inputCls} inputMode="numeric" /></Field>
                  <Field label="Макс. ширина полотна"><input value={maxPanel} onChange={e => setMaxPanel(e.target.value)} className={inputCls} inputMode="numeric" /></Field>
                  <Field label="Лист, ширина"><input value={sheetW} onChange={e => setSheetW(e.target.value)} className={inputCls} inputMode="numeric" /></Field>
                  <Field label="Лист, высота"><input value={sheetH} onChange={e => setSheetH(e.target.value)} className={inputCls} inputMode="numeric" /></Field>
                </div>
              )}
            </div>

            {/* Раскрой */}
            {geometry && (
              <div className="rounded-2xl border border-[#e4e4e0] bg-white p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-medium">Раскрой</h2>
                  <span className="text-[11px] text-[#9a9a95]">скат {geometry.slope.angleDeg}° · {geometry.sheetsNeeded} лист(ов) {geometry.sheet.width}×{geometry.sheet.height}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] text-[#9a9a95] border-b border-[#e4e4e0]">
                        <th className="text-left font-normal py-1.5">Пролёт</th>
                        <th className="text-right font-normal">Ступ.</th>
                        <th className="text-right font-normal">Полотен</th>
                        <th className="text-right font-normal">Нетто, м²</th>
                        <th className="text-right font-normal">Заготовки, м²</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {geometry.segments.map((sg, i) => (
                        <tr key={i} className="border-b border-[#f0f0ee]">
                          <td className="py-1.5">{sg.name}</td>
                          <td className="text-right">{sg.steps}</td>
                          <td className="text-right">{sg.panelCount} × {Math.round(sg.panelWidthMm)}</td>
                          <td className="text-right">{fmt2(sg.netM2)}</td>
                          <td className="text-right">{fmt2(sg.blankM2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                  <Stat label="Погонаж (по скату)" value={`${geometry.alongSlopeTotalM} м`} />
                  <Stat label="Чистое стекло" value={`${fmt2(geometry.netM2)} м²`} />
                  <Stat label="Заготовки" value={`${fmt2(geometry.blankM2)} м²`} />
                  <Stat label="Ступеней на пог.м" value={String(geometry.perMeter.stepsPerM)} />
                </div>
              </div>
            )}

            <CartSection />
          </div>

          {/* ПРАВО — клиент + цена */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-[#e4e4e0] bg-white p-4 space-y-3">
              <h2 className="text-sm font-medium"><span className="text-[#9a9a95]">④</span> Клиент</h2>
              <Field label="Имя (необязательно)"><input value={clientName} onChange={e => setClientName(e.target.value)} className={inputCls} placeholder="Клиент" /></Field>
              <Field label="Телефон (необязательно)"><input value={clientPhone} onChange={e => setClientPhone(e.target.value)} className={inputCls} placeholder="+7" /></Field>
            </div>

            <div className="rounded-2xl border border-[#e4e4e0] bg-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Стоимость</h2>
                <Field label=""><div className="flex items-center gap-1.5"><span className="text-[11px] text-[#9a9a95]">Маржа</span><input value={margin} onChange={e => setMargin(e.target.value)} className="w-14 h-8 px-2 rounded-lg border border-[#e4e4e0] text-sm text-center" inputMode="numeric" /><span className="text-[11px] text-[#9a9a95]">%</span></div></Field>
              </div>

              {price ? (
                <div className="space-y-1.5">
                  <Row label="Изделие (стекло + крепёж)" value={fmt(price.productPrice)} />
                  {price.mountPrice > 0    && <Row label="Монтаж" value={fmt(price.mountPrice)} />}
                  {price.deliveryPrice > 0 && <Row label="Доставка" value={fmt(price.deliveryPrice)} />}
                  <div className="flex justify-between items-center pt-2 border-t border-[#e4e4e0]">
                    <span className="text-sm font-medium">Цена клиенту</span>
                    <span className="text-lg font-semibold">{fmt(price.grandTotal)}</span>
                  </div>

                  <button onClick={() => setShowCost(v => !v)} className="text-[11px] text-[#9a9a95] hover:text-[#111110] pt-1">
                    {showCost ? '− скрыть себестоимость' : '+ себестоимость (для менеджера)'}
                  </button>
                  {showCost && (
                    <div className="space-y-1 pt-1 text-[12px]">
                      <Row label="Стекло" value={fmt(price.glassCost)} muted />
                      <Row label={`${hwSuggestion?.label} (${hwQtyEff} ${hwSuggestion?.unit})`} value={fmt(price.hardwareCost)} muted />
                      {price.mountCost > 0 && <Row label={`Монтаж (${geometry?.alongSlopeTotalM} пог.м)`} value={fmt(price.mountCost)} muted />}
                      <Row label="Себестоимость всего" value={fmt(price.productCost + price.mountCost + deliveryCost)} muted />
                      <Row label="Прибыль" value={`${fmt(price.profit)} · ${price.margin}%`} muted />
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-[#9a9a95]">Заполните пролёты, чтобы увидеть цену.</p>
              )}

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button onClick={handleAddToCart} disabled={!price}
                  className="h-10 rounded-lg border border-[#e4e4e0] bg-white text-sm hover:border-[#111110] disabled:opacity-40">
                  {addedToCart ? '✓ В заказе' : '+ В заказ'}
                </button>
                <button onClick={handleSave} disabled={!price || saving}
                  className="h-10 rounded-lg bg-[#111110] text-white text-sm hover:opacity-90 disabled:opacity-40">
                  {saving ? '…' : 'Сохранить'}
                </button>
              </div>

              {savedId && (
                <div className="rounded-xl bg-[#f5f5f3] p-3 text-sm space-y-1">
                  <p className="text-[#9a9a95] text-[11px]">Расчёт сохранён</p>
                  <div className="flex gap-3">
                    <Link href={`/calculations/${savedId}/print`} target="_blank" className="text-[#111110] underline">КП (PDF)</Link>
                    <Link href={`/calculations/${savedId}`} className="text-[#111110] underline">Открыть</Link>
                  </div>
                </div>
              )}
              <p className="text-[10px] text-[#9a9a95]">Цена = себестоимость / (1 − маржа − налог {TAX_PERCENT}%). Ставки крепежа/монтажа — из справочника «Ограждение — ставки».</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#f5f5f3] px-3 py-2">
      <p className="text-[10px] text-[#9a9a95] leading-tight">{label}</p>
      <p className="text-sm font-medium mt-0.5 tabular-nums">{value}</p>
    </div>
  )
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className={muted ? 'text-[#9a9a95]' : ''}>{label}</span>
      <span className={`tabular-nums ${muted ? 'text-[#9a9a95]' : ''}`}>{value}</span>
    </div>
  )
}
