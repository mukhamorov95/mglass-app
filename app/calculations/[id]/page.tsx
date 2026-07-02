'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'
import ProductVisualization from '@/components/ProductVisualization'
import type { MirrorInputs } from '@/lib/mirrorCalculator'
import type { LoftInputs }   from '@/lib/loftCalculator'

type CostLine = { name: string; qty: number; unit: string; price: number; total: number; note?: string }

type Calc = {
  id: number
  created_at: string
  product_type: string
  input_data: Record<string, unknown>
  cost_breakdown: { lines: CostLine[]; totalCost: number }
  financial_breakdown: {
    expensesPercent: number
    expensesAmount: number
    basePrice: number
    partnerAmount: number
    discountAmount: number
    serviceLines: CostLine[]
    servicesTotal: number
  }
  base_price: number
  discount: number
  partner_percent: number
  final_price: number
  margin: number
  profit: number
  status: string
  client_text: string | null
  notes: string | null
  client_name: string | null
  client_phone: string | null
  amo_lead_id: number | null
  order_group_id: string | null
  parent_calc_id: number | null
}

type Change = {
  id: string
  field: string
  old_value: string | null
  new_value: string | null
  reason: string | null
  changed_by: string | null
  created_at: string
}

const PRODUCT_LABELS: Record<string, { label: string; badge: string }> = {
  mirror:          { label: 'Зеркало с подсветкой', badge: 'bg-blue-50 text-blue-700' },
  loft:            { label: 'Лофт-перегородка',     badge: 'bg-orange-50 text-orange-700' },
  shower:          { label: 'Душевая перегородка',  badge: 'bg-cyan-50 text-cyan-700' },
  shower_standard: { label: 'Душевая перегородка',  badge: 'bg-cyan-50 text-cyan-700' },
  shower_budget:   { label: 'Душевая (бюджет)',     badge: 'bg-cyan-50 text-cyan-700' },
}

const STATUS_LIST = [
  { value: 'draft',       label: 'Черновик',     color: 'bg-gray-100 text-gray-600',       dot: 'bg-gray-400' },
  { value: 'sent',        label: 'Отправлено',   color: 'bg-blue-100 text-blue-700',       dot: 'bg-blue-500' },
  { value: 'thinking',    label: 'Думает',       color: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-500' },
  { value: 'approved',    label: 'Согласовано',  color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  { value: 'measurement', label: 'Замер',        color: 'bg-sky-100 text-sky-700',         dot: 'bg-sky-500' },
  { value: 'in_work',     label: 'В работе',     color: 'bg-indigo-100 text-indigo-700',   dot: 'bg-indigo-500' },
  { value: 'production',  label: 'Производство', color: 'bg-violet-100 text-violet-700',   dot: 'bg-violet-500' },
  { value: 'install',     label: 'Монтаж',       color: 'bg-orange-100 text-orange-700',   dot: 'bg-orange-500' },
  { value: 'done',        label: 'Завершено',    color: 'bg-green-100 text-green-700',     dot: 'bg-green-500' },
  { value: 'launched',    label: 'Запущено',     color: 'bg-purple-100 text-purple-700',   dot: 'bg-purple-500' },
  { value: 'rejected',    label: 'Отказ',        color: 'bg-red-100 text-red-600',         dot: 'bg-red-400' },
  { value: 'archive',     label: 'Архив',        color: 'bg-slate-100 text-slate-600',     dot: 'bg-slate-400' },
]

const FIELD_LABELS: Record<string, string> = {
  final_price:  'Цена',
  discount:     'Скидка',
  status:       'Статус',
  notes:        'Заметки',
  client_name:  'Имя клиента',
  client_phone: 'Телефон',
  amo_lead_id:  'AMO сделка',
}

function getStatusMeta(status: string) {
  return STATUS_LIST.find(s => s.value === status) ?? STATUS_LIST[0]
}

function buildParams(calc: Calc): { label: string; value: string }[] {
  const d = calc.input_data
  if (calc.product_type === 'mirror') {
    const shape = d.shape === 'circle' ? 'Круглое' : d.shape === 'oval' ? 'Овальное' : 'Прямоугольное'
    const dims = d.shape === 'circle' ? `Ø${d.width} мм` : `${d.width}×${d.height} мм`
    return [
      { label: 'Форма', value: shape },
      { label: 'Размер', value: dims },
      ...(d.glassType ? [{ label: 'Стекло', value: d.glassType as string }] : []),
      ...(d.ledType ? [{ label: 'Подсветка', value: d.ledType as string }] : []),
    ]
  }
  if (calc.product_type === 'loft') {
    const sys = d.systemType === 'sliding' ? 'Раздвижная' : d.systemType === 'swing' ? 'Распашная' : ''
    return [
      { label: 'Размер', value: `${d.width}×${d.height} мм` },
      ...(d.sections ? [{ label: 'Секций', value: `${d.sections}` }] : []),
      ...(sys ? [{ label: 'Система', value: sys }] : []),
      ...(d.glassType ? [{ label: 'Стекло', value: d.glassType as string }] : []),
    ]
  }
  if (calc.product_type.startsWith('shower')) {
    const dims = (d.dimStr as string) || `${d.width}×${d.height} мм`
    const tier = d.tier === 'budget' ? 'Бюджет' : 'Стандарт'
    const colorMap: Record<string, string> = { chrome: 'Хром', black: 'Чёрный', bronze: 'Бронза', gold: 'Золото', white: 'Белый' }
    const hwColorRu = colorMap[d.hwColor as string] || (d.hwColor as string) || ''
    return [
      { label: 'Размер', value: dims },
      { label: 'Серия', value: tier },
      ...(d.model ? [{ label: 'Модель', value: d.model as string }] : []),
      ...(d.thickness ? [{ label: 'Толщина стекла', value: `${d.thickness} мм` }] : []),
      ...((d.glassType || d.glass) ? [{ label: 'Стекло', value: (d.glassType || d.glass) as string }] : []),
      ...(hwColorRu ? [{ label: 'Фурнитура', value: hwColorRu }] : []),
    ]
  }
  return []
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function fmtPhone(raw: string) {
  const d = raw.replace(/\D/g, '')
  if (d.length === 11) return `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`
  return raw
}

function openInCalculator(calc: Calc) {
  const d = calc.input_data
  const pt = calc.product_type
  // __editCalcId__: tells the calculator this is a "recalculate" mode — saves as NEW calc with parent_calc_id
  // __old_final_price__: shown as "Было X ₽" in the before/after diff
  const meta = {
    __editCalcId__: calc.id,
    __order_group_id__: calc.order_group_id ?? undefined,
    __old_final_price__: calc.final_price,
  }
  if (pt === 'mirror') {
    sessionStorage.setItem('mglass_mirror_prefill', JSON.stringify({ ...d, ...meta }))
    window.location.href = '/calculator/mirror'
  } else if (pt === 'loft') {
    localStorage.setItem('mglass_loft', JSON.stringify({ ...d, ...meta }))
    window.location.href = '/calculator/loft'
  } else if (pt.startsWith('shower')) {
    sessionStorage.setItem('mglass_shower_prefill', JSON.stringify({ ...d, ...meta }))
    window.location.href = '/calculator/shower'
  }
}

export default function CalculationDetailPage() {
  const { id } = useParams()
  const [calc, setCalc] = useState<Calc | null>(null)
  const [changes, setChanges] = useState<Change[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveOk, setSaveOk] = useState(false)
  const [copied, setCopied] = useState(false)
  const [userEmail, setUserEmail] = useState<string>('')
  const [role, setRole] = useState<string | null>(null)
  const [childCalcs, setChildCalcs] = useState<{ id: number; created_at: string; final_price: number }[]>([])
  const [showRecalcModal, setShowRecalcModal] = useState(false)

  // Editable fields
  const [editPrice, setEditPrice] = useState('')
  const [editDiscount, setEditDiscount] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editClientText, setEditClientText] = useState('')
  const [editClientName, setEditClientName] = useState('')
  const [editClientPhone, setEditClientPhone] = useState('')
  const [editAmoLeadId, setEditAmoLeadId] = useState('')

  // Track what's been changed since last save
  const origRef = useRef<Calc | null>(null)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        setUserEmail(session.user.email ?? session.user.id)
        const { data: prof } = await supabase.from('users').select('role').eq('id', session.user.id).maybeSingle()
        setRole((prof as { role?: string } | null)?.role ?? null)
      }

      const [{ data: calcData }, { data: changesData }, { data: childData }] = await Promise.all([
        supabase.from('calculations').select('*').eq('id', id).single(),
        supabase.from('calculation_changes')
          .select('*')
          .eq('calculation_id', id)
          .order('created_at', { ascending: false })
          .limit(50),
        // Load newer versions of this calculation (if any)
        supabase.from('calculations')
          .select('id, created_at, final_price')
          .eq('parent_calc_id', id)
          .order('created_at', { ascending: true }),
      ])

      if (calcData) {
        setCalc(calcData)
        origRef.current = calcData
        setEditPrice(String(calcData.final_price ?? 0))
        setEditDiscount(String(calcData.discount ?? 0))
        setEditNotes(calcData.notes ?? '')
        setEditClientText(calcData.client_text ?? '')
        setEditClientName(calcData.client_name ?? '')
        setEditClientPhone(calcData.client_phone ?? '')
        setEditAmoLeadId(calcData.amo_lead_id ? String(calcData.amo_lead_id) : '')
      }
      setChanges((changesData as Change[]) ?? [])
      setChildCalcs((childData ?? []) as { id: number; created_at: string; final_price: number }[])
      setLoading(false)
    }
    load()
  }, [id])

  // ── Price ↔ Discount sync ─────────────────────────────────────────────────
  function handlePriceChange(val: string) {
    setEditPrice(val)
    if (!calc) return
    const price = parseFloat(val)
    if (!isNaN(price) && price > 0) {
      const fb = calc.financial_breakdown
      const priceWithPartner = calc.base_price + (fb.partnerAmount ?? 0)
      const disc = priceWithPartner > 0
        ? Math.max(0, Math.round((1 - price / priceWithPartner) * 100 * 10) / 10)
        : 0
      setEditDiscount(String(disc))
    }
  }

  function handleDiscountChange(val: string) {
    setEditDiscount(val)
    if (!calc) return
    const disc = parseFloat(val)
    if (!isNaN(disc)) {
      const fb = calc.financial_breakdown
      const priceWithPartner = calc.base_price + (fb.partnerAmount ?? 0)
      const newPrice = Math.round(priceWithPartner * (1 - disc / 100))
      setEditPrice(String(newPrice))
    }
  }

  // ── Preview calculations ─────────────────────────────────────────────────
  function getPreview() {
    if (!calc) return { finalPrice: 0, profit: 0, margin: 0, discount: 0 }
    const finalPrice = parseInt(editPrice) || calc.final_price
    const discount = parseFloat(editDiscount) || 0

    // When price/discount are unchanged from the stored snapshot, use stored profit/margin
    // (recalculating would be wrong if services are included in final_price but not in expensesAmount)
    if (finalPrice === calc.final_price && Math.abs(discount - calc.discount) < 0.01) {
      return { finalPrice, profit: calc.profit, margin: calc.margin, discount }
    }

    // Only recalculate when user explicitly edits price or discount
    const fb = calc.financial_breakdown
    const cb = calc.cost_breakdown
    const servicesTotal = fb.servicesTotal ?? 0
    const productPrice = finalPrice - servicesTotal
    const taxDecimal = (fb.expensesPercent ?? 12) / 100
    const taxOnProduct = Math.round(productPrice * taxDecimal)
    const profit = Math.round(productPrice - cb.totalCost - taxOnProduct)
    const margin = finalPrice > 0 ? Number(((profit / finalPrice) * 100).toFixed(1)) : 0
    return { finalPrice, profit, margin, discount }
  }

  // ── Record changes helper ────────────────────────────────────────────────
  async function recordChanges(
    supabase: ReturnType<typeof createClient>,
    orig: Calc,
    updates: Record<string, unknown>,
    preview: ReturnType<typeof getPreview>,
  ) {
    const rows: { calculation_id: number; field: string; old_value: string | null; new_value: string | null; changed_by: string | null }[] = []
    const check = (field: string, oldVal: unknown, newVal: unknown) => {
      const o = String(oldVal ?? '')
      const n = String(newVal ?? '')
      if (o !== n) rows.push({ calculation_id: calc!.id, field, old_value: o || null, new_value: n || null, changed_by: userEmail || null })
    }

    if ('final_price' in updates) check('final_price', orig.final_price, preview.finalPrice)
    if ('discount' in updates)    check('discount', orig.discount, preview.discount)
    if ('status' in updates)      check('status', orig.status, updates.status)
    if ('notes' in updates)       check('notes', orig.notes, updates.notes)
    if ('client_name' in updates) check('client_name', orig.client_name, updates.client_name)
    if ('client_phone' in updates) check('client_phone', orig.client_phone, updates.client_phone)
    if ('amo_lead_id' in updates) check('amo_lead_id', orig.amo_lead_id, updates.amo_lead_id)

    if (rows.length > 0) {
      const { data } = await supabase.from('calculation_changes').insert(rows).select()
      if (data) setChanges(prev => [...(data as Change[]), ...prev])
    }
  }

  // ── Save price / discount / client fields ─────────────────────────────────
  async function saveAll() {
    if (!calc || !origRef.current) return
    setSaving(true)
    setSaveError('')
    setSaveOk(false)
    try {
      const { finalPrice, profit, margin, discount } = getPreview()

      // Core fields — always exist in the table
      const coreUpdates = {
        final_price:  finalPrice,
        discount:     discount,
        profit:       profit,
        margin:       margin,
        notes:        editNotes,
        client_text:  editClientText,
        client_name:  editClientName || null,
        client_phone: editClientPhone || null,
      }

      const supabase = createClient()
      const { error: coreErr } = await supabase.from('calculations').update(coreUpdates).eq('id', id)
      if (coreErr) throw new Error(coreErr.message)

      // amo_lead_id requires migration — try separately, ignore if column missing
      const newAmoId = editAmoLeadId ? parseInt(editAmoLeadId) : null
      if (newAmoId !== calc.amo_lead_id) {
        await supabase.from('calculations').update({ amo_lead_id: newAmoId }).eq('id', id)
      }

      const allUpdates = { ...coreUpdates, amo_lead_id: newAmoId }
      await recordChanges(supabase, origRef.current, allUpdates, getPreview())

      const updated = { ...calc, ...allUpdates, financial_breakdown: { ...calc.financial_breakdown } }
      setCalc(updated as Calc)
      origRef.current = updated as Calc
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 2000)
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  // ── Update status ─────────────────────────────────────────────────────────
  async function updateStatus(status: string) {
    if (!calc || !origRef.current) return
    const supabase = createClient()
    const { error } = await supabase.from('calculations').update({ status }).eq('id', id)
    if (error) { setSaveError(error.message); return }
    await recordChanges(supabase, origRef.current, { status }, getPreview())
    const updated = { ...calc, status }
    setCalc(updated)
    origRef.current = updated
  }

  // ── Auto-save notes on blur ───────────────────────────────────────────────
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function handleNotesChange(val: string) {
    setEditNotes(val)
    if (notesTimer.current) clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(async () => {
      if (!calc || !origRef.current || val === origRef.current.notes) return
      const supabase = createClient()
      await supabase.from('calculations').update({ notes: val }).eq('id', id)
      await recordChanges(supabase, origRef.current, { notes: val }, getPreview())
      const updated = { ...calc, notes: val }
      setCalc(updated)
      origRef.current = updated
    }, 1500)
  }

  // ── Visualization inputs reconstruction — must be before early returns ──────
  const vizInputs = useMemo(() => {
    if (!calc) return null
    const d = calc.input_data
    if (calc.product_type === 'mirror') {
      return {
        type: 'mirror' as const,
        inputs: {
          width:  Number(d.width)  || 800,
          height: Number(d.height) || 800,
          shape:  (d.shape as string) || 'rectangle',
          hasLighting: Boolean(d.hasLighting),
          hasSandblast: Boolean(d.hasSandblast),
          hasFacet: Boolean(d.hasFacet ?? false),
          facetTypeMm: (d.facetTypeMm as number) ?? null,
          mirrorFrame: null,
          mirrorMaterial: d.mirrorName
            ? { name: `${d.mirrorName} ${d.mirrorMm ?? 4} мм` } as MirrorInputs['mirrorMaterial']
            : null,
          buttonType: (d.buttonType as string) || 'none',
          hasSubstrate: false,
          substratePrice: 0,
          hasInstallation: false,
          hasDelivery: false,
          facetCostPerM: 0, facetSalePerM: 0,
          partnerPercent: 0, discount: 0, margin: 40, standardMargin: 40, tax: 12, minMargin: 20,
        } as unknown as MirrorInputs,
      }
    }
    if (calc.product_type === 'loft') {
      return {
        type: 'loft' as const,
        inputs: {
          width:    Number(d.width)    || 2000,
          height:   Number(d.height)   || 2400,
          sections: Number(d.sections) || 3,
          divisions: Number(d.divisions) || 2,
          systemType: (d.systemType as string) || 'fixed',
          glassMaterial: d.glassId ? { name: String(d.glassName ?? '') } as LoftInputs['glassMaterial'] : null,
          glassWastePct: 0,
          withTempering: true,
          withMirrorFilm: false,
          withPainting: false,
          hasInstallation: false,
          hasDelivery: false,
          hardware: [],
          hardwareQty: {},
          partnerPercent: 0,
          discount: 0,
          margin: 40,
        } as unknown as LoftInputs,
      }
    }
    return null
  }, [calc])

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Загрузка...</div>
  if (!calc)   return <div className="min-h-screen flex items-center justify-center text-gray-400">Расчёт не найден</div>

  const fb = calc.financial_breakdown
  const cb = calc.cost_breakdown
  const { finalPrice, profit, margin, discount } = getPreview()
  const priceWithPartner = calc.base_price + (fb.partnerAmount ?? 0)

  const marginColor = margin >= 45 ? 'text-emerald-600' : margin >= 30 ? 'text-amber-600' : 'text-red-600'
  const marginBg    = margin >= 45 ? 'bg-emerald-50 border-emerald-200' : margin >= 30 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'

  const productInfo = PRODUCT_LABELS[calc.product_type] ?? { label: calc.product_type, badge: 'bg-gray-100 text-gray-600' }
  const statusMeta = getStatusMeta(calc.status)
  const params = buildParams(calc)

  const hasChanges =
    parseInt(editPrice) !== calc.final_price ||
    parseFloat(editDiscount) !== calc.discount ||
    editClientName  !== (calc.client_name ?? '') ||
    editClientPhone !== (calc.client_phone ?? '') ||
    editAmoLeadId   !== (calc.amo_lead_id ? String(calc.amo_lead_id) : '') ||
    editClientText  !== (calc.client_text ?? '')

  return (
    <div className="min-h-screen bg-[#f5f5f7] py-6 px-4">
      <div className="max-w-5xl mx-auto space-y-4">

        {/* ── Recalculate confirmation modal ─────────────────────────────── */}
        {showRecalcModal && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
            <div className="bg-surface rounded-2xl shadow-2xl max-w-md w-full p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-amber-600 text-lg">⚠</span>
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-[#1d1d1f] mb-1">Пересчёт по актуальным ценам</h3>
                  <p className="text-[13px] text-[#6e6e73] leading-relaxed">
                    Откроется калькулятор с текущими ценами из справочников.
                    Цены материалов и комплектующих могут отличаться от тех, что были на момент расчёта.
                  </p>
                  <div className="mt-3 px-3 py-2 bg-emerald-50 rounded-lg border border-emerald-200">
                    <p className="text-[12px] text-emerald-700 font-medium">
                      Оригинал расчёта #{calc.id} ({calc.final_price.toLocaleString('ru-RU')} ₽) останется нетронутым.
                      Результат сохранится как новый расчёт.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setShowRecalcModal(false)}
                  className="px-4 py-2 text-[13px] text-[#6e6e73] border border-[#e8e8ed] rounded-xl hover:bg-[#f5f5f7] transition-colors">
                  Отмена
                </button>
                <button onClick={() => { setShowRecalcModal(false); openInCalculator(calc) }}
                  className="px-4 py-2 text-[13px] font-semibold bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors">
                  Открыть калькулятор
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Version chain banners ───────────────────────────────────────── */}
        {calc.parent_calc_id && (
          <div className="px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-2 text-[13px]">
            <span className="text-blue-500">↩</span>
            <span className="text-blue-700">Это пересчёт расчёта</span>
            <Link href={`/calculations/${calc.parent_calc_id}`}
              className="text-blue-600 font-semibold hover:underline">
              #{calc.parent_calc_id}
            </Link>
          </div>
        )}
        {childCalcs.length > 0 && (
          <div className="px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-[13px]">
            <span className="text-amber-700 font-medium">Пересчитан: </span>
            {childCalcs.map((ch, i) => (
              <span key={ch.id}>
                {i > 0 && <span className="text-[#c7c7cc] mx-1">·</span>}
                <Link href={`/calculations/${ch.id}`}
                  className="text-amber-700 font-semibold hover:underline">
                  #{ch.id}
                </Link>
                <span className="text-amber-600 ml-1">
                  ({ch.final_price.toLocaleString('ru-RU')} ₽ · {new Date(ch.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })})
                </span>
              </span>
            ))}
          </div>
        )}

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <Link href="/calculations" className="text-[13px] text-[#6e6e73] hover:text-[#1d1d1f]">← Расчёты</Link>
            <span className="text-[#c7c7cc]">/</span>
            <h1 className="text-[20px] font-semibold text-[#1d1d1f]">Расчёт #{calc.id}</h1>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${productInfo.badge}`}>
              {productInfo.label}
            </span>
            <span className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-medium ${statusMeta.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />
              {statusMeta.label}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Status dropdown */}
            <select value={calc.status} onChange={e => updateStatus(e.target.value)}
              className="text-[13px] border border-[#e8e8ed] rounded-xl px-3 py-2 bg-surface focus:outline-none focus:ring-2 focus:ring-[#0071e3]">
              {STATUS_LIST.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>

            {/* WhatsApp */}
            {(editClientPhone || calc.client_phone) && (
              <a href={`https://wa.me/${(editClientPhone || calc.client_phone || '').replace(/\D/g, '')}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 text-emerald-700 text-[13px] font-medium rounded-xl hover:bg-emerald-100 transition-colors">
                WhatsApp
              </a>
            )}

            {/* AMO link */}
            {(editAmoLeadId || calc.amo_lead_id) && (
              <a href={`https://mglass.amocrm.ru/leads/detail/${editAmoLeadId || calc.amo_lead_id}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 text-blue-700 text-[13px] font-medium rounded-xl hover:bg-blue-100 transition-colors">
                AMO →
              </a>
            )}

            {/* Recalculate — opens modal first, then redirects to calculator */}
            <button onClick={() => setShowRecalcModal(true)}
              className="px-3 py-2 bg-amber-50 border border-amber-200 text-amber-800 text-[13px] font-medium rounded-xl hover:bg-amber-100 transition-colors">
              Пересчитать по актуальным ценам
            </button>

            {/* PDF */}
            <button onClick={() => window.open(`/calculations/${calc.id}/print`, '_blank')}
              className="px-3 py-2 bg-surface border border-[#e8e8ed] text-[#1d1d1f] text-[13px] font-medium rounded-xl hover:bg-[#f5f5f7] transition-colors">
              PDF
            </button>

            {/* Save button */}
            {hasChanges && (
              <button onClick={saveAll} disabled={saving}
                className="px-4 py-2 bg-[#0071e3] text-white text-[13px] font-semibold rounded-xl hover:bg-[#0077ed] disabled:opacity-50 transition-colors">
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* ── Left column ──────────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">

            {/* Client block */}
            <div className="bg-surface rounded-2xl border border-[#e8e8ed] p-5">
              <h2 className="text-[12px] font-semibold text-[#aeaeb2] uppercase tracking-wide mb-4">Клиент</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] text-[#aeaeb2] mb-1 block">Имя</label>
                  <input
                    type="text"
                    className="w-full border border-[#e8e8ed] rounded-xl px-3 py-2 text-[14px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
                    placeholder="Имя клиента"
                    value={editClientName}
                    onChange={e => setEditClientName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#aeaeb2] mb-1 block">Телефон</label>
                  <input
                    type="tel"
                    className="w-full border border-[#e8e8ed] rounded-xl px-3 py-2 text-[14px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
                    placeholder="+7 (___) ___-__-__"
                    value={editClientPhone}
                    onChange={e => setEditClientPhone(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#aeaeb2] mb-1 block">Сделка AMO</label>
                  <input
                    type="text"
                    className="w-full border border-[#e8e8ed] rounded-xl px-3 py-2 text-[14px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
                    placeholder="ID сделки"
                    value={editAmoLeadId}
                    onChange={e => setEditAmoLeadId(e.target.value.replace(/\D/g, ''))}
                  />
                </div>
              </div>
            </div>

            {/* Financial block */}
            <div className={`rounded-2xl border p-5 ${marginBg}`}>
              <h2 className="text-[12px] font-semibold text-[#aeaeb2] uppercase tracking-wide mb-4">Цена сделки</h2>
              <div className="flex items-end gap-4 flex-wrap mb-4">
                <div className="flex-1 min-w-[140px]">
                  <label className="text-[11px] text-[#6e6e73] mb-1 block">Цена для клиента</label>
                  <div className="relative">
                    <input
                      type="number"
                      className="w-full border border-[#e8e8ed] bg-surface rounded-xl px-3 py-2.5 text-[18px] font-semibold font-mono tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
                      value={editPrice}
                      onChange={e => handlePriceChange(e.target.value)}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#aeaeb2] text-[14px]">₽</span>
                  </div>
                  {parseInt(editPrice) !== calc.final_price && (
                    <p className="text-[11px] text-[#6e6e73] mt-1">было: {calc.final_price.toLocaleString('ru-RU')} ₽</p>
                  )}
                </div>
                <div className="w-[100px]">
                  <label className="text-[11px] text-[#6e6e73] mb-1 block">Скидка %</label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0" max="80" step="1"
                      className="w-full border border-[#e8e8ed] bg-surface rounded-xl px-3 py-2.5 text-[16px] font-semibold font-mono tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
                      value={editDiscount}
                      onChange={e => handleDiscountChange(e.target.value)}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#aeaeb2] text-[12px]">%</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-surface bg-opacity-60 rounded-xl p-3 text-center">
                  <p className="text-[11px] text-[#6e6e73] mb-1">Маржа</p>
                  <p className={`text-[20px] font-semibold ${marginColor}`}>{margin}%</p>
                </div>
                <div className="bg-surface bg-opacity-60 rounded-xl p-3 text-center">
                  <p className="text-[11px] text-[#6e6e73] mb-1">Прибыль</p>
                  <p className="text-[20px] font-semibold text-[#1d1d1f]">{profit.toLocaleString('ru-RU')} ₽</p>
                </div>
                <div className="bg-surface bg-opacity-60 rounded-xl p-3 text-center">
                  <p className="text-[11px] text-[#6e6e73] mb-1">Базовая</p>
                  <p className="text-[15px] font-semibold text-[#6e6e73]">{priceWithPartner.toLocaleString('ru-RU')} ₽</p>
                </div>
              </div>
            </div>

            {/* Cost breakdown */}
            <div className="bg-surface rounded-2xl border border-[#e8e8ed] p-5">
              <h2 className="text-[12px] font-semibold text-[#aeaeb2] uppercase tracking-wide mb-3">Себестоимость</h2>
              <div className="space-y-0.5">
                {cb.lines.map((l, i) => (
                  <div key={i} className="flex justify-between text-[13px] py-1.5 border-b border-[#f5f5f7] last:border-0">
                    <span className="text-[#1d1d1f]">
                      {l.name}
                      <span className="text-[#aeaeb2] ml-1">{l.qty} {l.unit}</span>
                    </span>
                    <span className="font-mono tabular-nums text-[#1d1d1f] font-medium">{l.total.toLocaleString('ru-RU')} ₽</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between pt-2.5 mt-2 border-t border-[#e8e8ed] text-[14px] font-semibold">
                <span className="text-[#1d1d1f]">Итого себестоимость</span>
                <span className="font-mono tabular-nums">{cb.totalCost.toLocaleString('ru-RU')} ₽</span>
              </div>
            </div>

            {/* Financial model */}
            <div className="bg-surface rounded-2xl border border-[#e8e8ed] p-5">
              <h2 className="text-[12px] font-semibold text-[#aeaeb2] uppercase tracking-wide mb-3">Финансовая модель</h2>
              <div className="space-y-2">
                {[
                  { label: 'Себестоимость',                  value: cb.totalCost, bold: false },
                  { label: `Расходы (${fb.expensesPercent}%)`, value: fb.expensesAmount, bold: false },
                  { label: 'Базовая цена',                   value: fb.basePrice, bold: true },
                  ...(fb.partnerAmount > 0 ? [{ label: `Партнёрка (${calc.partner_percent}%)`, value: fb.partnerAmount, bold: false }] : []),
                  ...(discount > 0 ? [{ label: `Скидка (${discount}%)`, value: -(priceWithPartner - finalPrice), bold: false }] : []),
                  ...((fb.serviceLines ?? []).map(l => ({ label: `${l.name}${l.qty > 1 ? ` ${l.qty} ${l.unit}` : ''}`.trim(), value: l.total, bold: false }))),
                  { label: 'Итого клиенту', value: finalPrice, bold: true },
                  { label: 'Прибыль',       value: profit, bold: true },
                ].map((row, i) => (
                  <div key={i} className={`flex justify-between text-[13px] ${row.bold ? 'font-semibold border-t border-[#e8e8ed] pt-2 mt-1' : ''}`}>
                    <span className="text-[#6e6e73]">{row.label}</span>
                    <span className={`font-mono tabular-nums ${row.bold ? 'text-[#1d1d1f]' : 'text-[#6e6e73]'}`}>
                      {row.value < 0 ? '−' : ''}{Math.abs(row.value).toLocaleString('ru-RU')} ₽
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Client text */}
            <div className="bg-surface rounded-2xl border border-[#e8e8ed] p-5">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-[12px] font-semibold text-[#aeaeb2] uppercase tracking-wide">Текст для клиента</h2>
                <button onClick={async () => {
                  await navigator.clipboard.writeText(editClientText)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }} className="text-[12px] px-3 py-1.5 bg-[#f5f5f7] hover:bg-[#e8e8ed] rounded-lg text-[#6e6e73] transition-colors">
                  {copied ? 'Скопировано ✓' : 'Копировать'}
                </button>
              </div>
              <textarea
                className="w-full border border-[#e8e8ed] rounded-xl px-3 py-2.5 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-[#0071e3] font-sans leading-relaxed"
                rows={8}
                value={editClientText}
                onChange={e => setEditClientText(e.target.value)}
              />
            </div>

          </div>

          {/* ── Right column ─────────────────────────────────────────────── */}
          <div className="space-y-4">

            {/* Product params */}
            <div className="bg-surface rounded-2xl border border-[#e8e8ed] p-5">
              <h2 className="text-[12px] font-semibold text-[#aeaeb2] uppercase tracking-wide mb-3">Параметры</h2>
              {params.length > 0 ? (
                <div className="space-y-2">
                  {params.map(p => (
                    <div key={p.label} className="flex justify-between text-[13px]">
                      <span className="text-[#aeaeb2]">{p.label}</span>
                      <span className="font-medium text-[#1d1d1f]">{p.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-[#aeaeb2]">Нет данных</p>
              )}
              <div className="mt-3 pt-3 border-t border-[#f5f5f7]">
                <span className="text-[11px] text-[#aeaeb2]">
                  {new Date(calc.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>

            {/* Visualization */}
            {vizInputs && (
              vizInputs.type === 'mirror'
                ? <ProductVisualization type="mirror" inputs={vizInputs.inputs} role={role} />
                : <ProductVisualization type="loft"   inputs={vizInputs.inputs} role={role} />
            )}

            {/* Notes */}
            <div className="bg-surface rounded-2xl border border-[#e8e8ed] p-5">
              <h2 className="text-[12px] font-semibold text-[#aeaeb2] uppercase tracking-wide mb-3">Заметки</h2>
              <textarea
                className="w-full border border-[#e8e8ed] rounded-xl px-3 py-2.5 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-[#0071e3] leading-relaxed"
                rows={5}
                placeholder="Пожелания клиента, адрес, детали..."
                value={editNotes}
                onChange={e => handleNotesChange(e.target.value)}
              />
              <p className="text-[11px] text-[#aeaeb2] mt-1.5">Сохраняется автоматически</p>
            </div>

            {/* Change history */}
            <div className="bg-surface rounded-2xl border border-[#e8e8ed] p-5">
              <h2 className="text-[12px] font-semibold text-[#aeaeb2] uppercase tracking-wide mb-3">История изменений</h2>
              {changes.length === 0 ? (
                <p className="text-[13px] text-[#aeaeb2]">Нет изменений</p>
              ) : (
                <div className="space-y-3">
                  {changes.slice(0, 20).map(ch => (
                    <div key={ch.id} className="relative pl-4 border-l-2 border-[#f2f2f7]">
                      <p className="text-[12px] font-medium text-[#1d1d1f]">
                        {FIELD_LABELS[ch.field] ?? ch.field}
                      </p>
                      <div className="flex items-center gap-1.5 text-[11px] text-[#aeaeb2] mt-0.5">
                        {ch.old_value !== null && (
                          <>
                            <span className="line-through">{ch.old_value}</span>
                            <span>→</span>
                          </>
                        )}
                        <span className="text-[#1d1d1f] font-medium">{ch.new_value ?? '—'}</span>
                      </div>
                      <p className="text-[11px] text-[#c7c7cc] mt-0.5">
                        {fmtTime(ch.created_at)}
                        {ch.changed_by && ` · ${ch.changed_by.split('@')[0]}`}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Floating save bar */}
        {(hasChanges || saveError || saveOk) && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
            <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl ${
              saveError ? 'bg-red-600 text-white' : saveOk ? 'bg-emerald-600 text-white' : 'bg-[#1d1d1f] text-white'
            }`}>
              {saveError ? (
                <>
                  <span className="text-[13px]">Ошибка: {saveError}</span>
                  <button onClick={() => setSaveError('')} className="text-[12px] opacity-70 hover:opacity-100">✕</button>
                </>
              ) : saveOk ? (
                <span className="text-[13px] font-medium">Сохранено ✓</span>
              ) : (
                <>
                  <span className="text-[13px]">Есть несохранённые изменения</span>
                  <button onClick={saveAll} disabled={saving}
                    className="px-4 py-1.5 bg-[#0071e3] text-white text-[13px] font-semibold rounded-xl hover:bg-[#0077ed] disabled:opacity-50 transition-colors">
                    {saving ? '...' : 'Сохранить'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
