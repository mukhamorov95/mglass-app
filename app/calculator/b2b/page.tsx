'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { B2BClient, B2BMaterial, B2BService, B2BFilm, computeMarginStatus } from '@/lib/types'
import { calcServiceCost, ProductionSettings, DEFAULT_PRODUCTION_SETTINGS } from '@/lib/calcServiceCost'
import { runCuttingOptimizer, DEFAULT_CUTTING_SETTINGS, type PieceGroup } from '@/lib/cuttingOptimizer'
import { computeProductionSummary } from '@/lib/productionSummary'

const DRAFT_KEY = 'mglass_calc_draft'

const MATERIAL_ORDER = [
  'Прозрачное М1',
  'Осветлённое CrystalVision',
  'Сатинированное бесцветное',
  'CrystalVision Matelux',
  'Тонированное (бронза/графит)',
  'Сатин тонированный',
]

function sortByPriority<T extends { name: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    const ai = MATERIAL_ORDER.indexOf(a.name)
    const bi = MATERIAL_ORDER.indexOf(b.name)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.name.localeCompare(b.name, 'ru')
  })
}

const DEFAULTS: Record<SuperCat, { thickness: number; name: string }> = {
  стекло:  { thickness: 8, name: 'Прозрачное М1' },
  зеркало: { thickness: 4, name: 'Зеркало осветлённое' },
}

function pickDefault(mats: B2BMaterial[], superCat: SuperCat) {
  const d = DEFAULTS[superCat]
  const preferred = mats.find(m => m.thickness === d.thickness && m.name === d.name)
  if (preferred) return preferred
  return sortByPriority(mats)[0] ?? null
}

const SUPER_CATS = [
  { value: 'стекло',  label: 'Стекло',  cats: ['стекло', 'тонированное', 'сатин', 'рифленое', 'декоративное'] },
  { value: 'зеркало', label: 'Зеркало', cats: ['зеркало'] },
] as const
type SuperCat = typeof SUPER_CATS[number]['value']
import {
  calcItem, calcTotals, WASTE_OPTIONS, TEMPERING_COST, VAT,
  type B2BOrderItem, type B2BOrderTotals, type FacetPrice,
} from '@/lib/b2bCalculator'

const fmt  = (n: number) => n.toLocaleString('ru-RU') + ' ₽'
const fmtN = (n: number, d = 3) => n.toLocaleString('ru-RU', { maximumFractionDigits: d })

function marginBadgeClass(m: number): string {
  const s = computeMarginStatus(m, { green_threshold: 35, yellow_threshold: 25, blocked_below: 0 })
  if (s === 'green')  return 'bg-emerald-50 text-emerald-700'
  if (s === 'yellow') return 'bg-amber-50 text-amber-700'
  return 'bg-red-50 text-red-600'
}

function effectiveItemMargin(item: B2BOrderItem, discountPct: number): number {
  const afterDisc = item.saleIncVat * (1 - discountPct / 100)
  const exVat = afterDisc * 100 / (100 + VAT)
  return exVat > 0 ? Math.round((1 - item.costExVat / exVat) * 100) : 0
}

function parseSalePrice(m: B2BMaterial): B2BMaterial {
  try {
    if (m.notes) {
      const n = JSON.parse(m.notes)
      return { ...m, sale_price: n?.sale_price ?? 0, passthrough: n?.passthrough ?? false }
    }
  } catch {}
  return { ...m, sale_price: 0, passthrough: false }
}

export default function B2BCalculatorPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [clients, setClients]     = useState<B2BClient[]>([])
  const [materials, setMaterials] = useState<B2BMaterial[]>([])
  const [services, setServices]         = useState<B2BService[]>([])
  const [films, setFilms]               = useState<B2BFilm[]>([])
  const [prodSettings, setProdSettings] = useState<ProductionSettings>(DEFAULT_PRODUCTION_SETTINGS)
  const [fTierSel, setFTierSel]         = useState<Record<number, number>>({})
  const [eTierSel, setETierSel]         = useState<Record<number, number>>({})
  const [fFilmSel, setFFilmSel]         = useState<Record<number, number>>({})
  const [eFilmSel, setEFilmSel]         = useState<Record<number, number>>({})
  const [loading, setLoading]           = useState(true)
  const [saving, setSaving]       = useState(false)
  const [savedOrderId, setSavedOrderId] = useState<number | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [managerEmail, setManagerEmail] = useState<string | null>(null)
  const [managerId, setManagerId]       = useState<string | null>(null)
  const [managerCode, setManagerCode]   = useState<number | null>(null)
  const [isAdmin, setIsAdmin]           = useState(false)

  // New client modal
  const [showNewClient, setShowNewClient] = useState(false)
  const [ncName, setNcName]     = useState('')
  const [ncContact, setNcContact] = useState('')
  const [ncPhone, setNcPhone]   = useState('')
  const [ncDiscount, setNcDiscount] = useState(0)
  const [ncNotes, setNcNotes]   = useState('')
  const [ncSaving, setNcSaving] = useState(false)
  const [ncError, setNcError]   = useState<string | null>(null)

  type DraftData = { clientId: number | null; items: B2BOrderItem[]; notes: string; productionDays: number; savedAt: string }
  const [draftToast, setDraftToast] = useState<DraftData | null>(null)
  const draftRestoredRef = useRef(false)

  const [clientId, setClientId]         = useState<number | null>(null)
  const [ourOrderNumber, setOurOrderNumber]       = useState('')
  const [clientOrderNumber, setClientOrderNumber] = useState('')
  const [notes, setNotes]           = useState('')
  const [fProductionDays, setFProductionDays] = useState(7)
  const [items, setItems]           = useState<B2BOrderItem[]>([])

  const [fSuperCat, setFSuperCat]     = useState<SuperCat>('стекло')
  const [fThickness, setFThickness]   = useState<number | null>(null)
  const [fMatId, setFMatId]           = useState<number | null>(null)
  const [fWidth, setFWidth]           = useState('')
  const [fHeight, setFHeight]         = useState('')
  const [fQty, setFQty]               = useState('1')
  const [fWaste, setFWaste]           = useState(15)
  const [fTempering, setFTempering]   = useState(true)
  const [fFacet, setFFacet]           = useState(false)
  const [fFacetMm, setFFacetMm]       = useState<number>(10)
  const [fServiceIds, setFServiceIds] = useState<number[]>([])
  const [fComment, setFComment]       = useState('')
  const [facetPrices, setFacetPrices] = useState<FacetPrice[]>([])
  const widthRef = useRef<HTMLInputElement>(null)
  const heightRef = useRef<HTMLInputElement>(null)
  const qtyRef = useRef<HTMLInputElement>(null)
  const [attachFile, setAttachFile]   = useState<File | null>(null)
  const attachInputRef = useRef<HTMLInputElement>(null)

  // Edit modal state
  const [editingLocalId, setEditingLocalId] = useState<string | null>(null)
  const [eSuperCat, setESuperCat]     = useState<SuperCat>('стекло')
  const [eThickness, setEThickness]   = useState<number | null>(null)
  const [eMatId, setEMatId]           = useState<number | null>(null)
  const [eWidth, setEWidth]           = useState('')
  const [eHeight, setEHeight]         = useState('')
  const [eQty, setEQty]               = useState('1')
  const [eWaste, setEWaste]           = useState(15)
  const [eTempering, setETempering]   = useState(false)
  const [eFacet, setEFacet]           = useState(false)
  const [eFacetMm, setEFacetMm]       = useState<number>(10)
  const [eServiceIds, setEServiceIds] = useState<number[]>([])

  useEffect(() => {
    async function load() {
      const sb = createClient()
      const [{ data: cls }, { data: mats }, { data: svcs }, { data: orders }, { data: glassMatrix }, { data: { user } }, { data: psData }, { data: filmsData }, { data: facetData }] = await Promise.all([
        sb.from('b2b_clients').select('id,name,contact,phone,discount_percent,active,notes,created_at,manager_id,manager_code').eq('active', true).order('name'),
        sb.from('b2b_materials').select('*').eq('active', true).order('category').order('name'),
        sb.from('b2b_services').select('*').eq('active', true).order('sort_order').order('name'),
        sb.from('b2b_orders').select('client_id,total_after_discount').gte('created_at', '2026-01-01'),
        sb.from('glass_price_matrix').select('name,category,price_type,t4,t5,t6,t8,t10,waste_pct'),
        sb.auth.getUser(),
        sb.from('production_settings').select('*').eq('id', 1).maybeSingle(),
        sb.from('b2b_films').select('*').eq('active', true).order('sort_order').order('name'),
        sb.from('facet_prices').select('*').eq('active', true).order('type_mm'),
      ])
      if (psData) setProdSettings(psData as ProductionSettings)
      setFilms((filmsData ?? []) as B2BFilm[])
      setFacetPrices((facetData ?? []) as FacetPrice[])
      if (user?.email) setManagerEmail(user.email)
      if (user?.id) setManagerId(user.id)

      // Load role + manager_code
      let userIsAdmin = false
      let userManagerCode: number | null = null
      if (user?.id) {
        const { data: profile } = await sb.from('users').select('role,manager_code').eq('id', user.id).single()
        userIsAdmin = profile?.role === 'admin' || profile?.role === 'ceo'
        userManagerCode = profile?.manager_code ?? null
      }
      setIsAdmin(userIsAdmin)
      setManagerCode(userManagerCode)

      const totals = new Map<number, number>()
      for (const o of orders ?? []) {
        totals.set(o.client_id, (totals.get(o.client_id) ?? 0) + o.total_after_discount)
      }
      // Non-admin managers see only their own clients
      const allClients = (cls ?? []) as B2BClient[]
      const visibleClients = userIsAdmin
        ? allClients
        : allClients.filter(c => c.manager_id === user?.id)
      const sorted = visibleClients.slice().sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0))
      setClients(sorted)

      // Override sale_price from glass_price_matrix where available
      const matrix = glassMatrix ?? []
      const parsed = (mats ?? []).map(m => {
        const base = parseSalePrice(m)
        const mm = Math.round(m.thickness)
        const cat = ['зеркало'].includes(m.category) ? 'mirror' : 'glass'
        const matrixSale = matrix.find(r => r.name === m.name && r.category === cat && r.price_type === 'sale')
        const matrixCost = matrix.find(r => r.name === m.name && r.category === cat && r.price_type === 'cost')
        const matrixPrice = matrixSale ? (matrixSale as Record<string, unknown>)[`t${mm}`] as number | null : null
        // waste_pct lives on cost rows — single source of truth
        const matrixWaste = (matrixCost as Record<string, unknown> | undefined)?.waste_pct as number | null ?? null
        return {
          ...base,
          ...(matrixPrice != null && matrixPrice > 0 ? { sale_price: matrixPrice } : {}),
          // Справочник — первоисточник: его waste_pct всегда победает, passthrough снимается
          ...(matrixWaste != null && matrixWaste > 0 ? { waste_percent: matrixWaste, passthrough: false } : {}),
        }
      })
      setMaterials(parsed)
      setServices(svcs ?? [])
      if (parsed.length > 0) {
        const sc = SUPER_CATS[0]
        setFSuperCat(sc.value)
        const superMats = parsed.filter(m => (sc.cats as readonly string[]).includes(m.category))
        const mat = pickDefault(superMats, sc.value)
        if (mat) { setFThickness(mat.thickness); setFMatId(mat.id); setFWaste(mat.waste_percent) }
      }
      setLoading(false)
    }
    load()
  }, [])

  // ── Check draft / orderId after data loads ──
  useEffect(() => {
    if (loading) return
    const orderIdParam  = searchParams.get('orderId')
    const clientIdParam = searchParams.get('client')

    if (orderIdParam) {
      // Load an existing order into the calculator
      ;(async () => {
        const sb = createClient()
        const { data } = await sb.from('b2b_orders').select('client_id,items').eq('id', orderIdParam).single()
        if (data) {
          if (data.client_id) setClientId(data.client_id)
          const loadedItems = (Array.isArray(data.items) ? data.items : []) as B2BOrderItem[]
          setItems(loadedItems.map(i => ({ ...i, localId: (i as B2BOrderItem & { localId?: string }).localId || crypto.randomUUID() })))
        }
      })()
      return
    }
    if (clientIdParam) {
      setClientId(Number(clientIdParam))
    }
    if (!draftRestoredRef.current) {
      draftRestoredRef.current = true
      try {
        const raw = localStorage.getItem(DRAFT_KEY)
        if (raw) {
          const draft = JSON.parse(raw) as DraftData
          if (draft.items?.length > 0) setDraftToast(draft)
        }
      } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // ── Autosave draft to localStorage ──
  useEffect(() => {
    if (loading) return
    if (items.length > 0 || notes) {
      const draft: DraftData = { clientId, items, notes, productionDays: fProductionDays, savedAt: new Date().toISOString() }
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)) } catch {}
    }
  }, [clientId, items, notes, fProductionDays, loading])

  const superCatDef      = SUPER_CATS.find(s => s.value === fSuperCat) ?? SUPER_CATS[0]
  const categoryMaterials  = useMemo(() => materials.filter(m => (superCatDef.cats as readonly string[]).includes(m.category)), [materials, fSuperCat])
  const availableThickness = useMemo(() => [...new Set(categoryMaterials.map(m => m.thickness))].sort((a, b) => a - b), [categoryMaterials])
  const thicknessMaterials = useMemo(() => sortByPriority(categoryMaterials.filter(m => m.thickness === fThickness)), [categoryMaterials, fThickness])

  function handleSuperCatChange(sc: SuperCat) {
    setFSuperCat(sc)
    setFTempering(sc === 'стекло')
    const scDef = SUPER_CATS.find(s => s.value === sc)!
    const mats = materials.filter(m => (scDef.cats as readonly string[]).includes(m.category))
    const mat = pickDefault(mats, sc)
    if (mat) { setFThickness(mat.thickness); setFMatId(mat.id); setFWaste(mat.waste_percent) }
    else { setFThickness(null); setFMatId(null) }
  }

  function handleThicknessChange(t: number) {
    setFThickness(t)
    const mat = categoryMaterials.find(m => m.thickness === t)
    if (mat) { setFMatId(mat.id); setFWaste(mat.waste_percent) }
    else { setFMatId(null) }
  }

  // Превращает calculated/film-услуги в fixed/per_m2 перед передачей в calcItem
  function resolveSvcs(svcs: B2BService[], tierSel: Record<number, number>, filmSel: Record<number, number>): B2BService[] {
    return svcs.map(s => {
      if (s.type === 'calculated') {
        const result = calcServiceCost(
          { time_minutes: s.time_minutes ?? 0, equipment_depr_rub: s.equipment_depr_rub ?? 0,
            consumables_cost_rub: s.consumables_cost_rub ?? 0,
            overhead_override_pct: s.overhead_override_pct, margin_override_pct: s.margin_override_pct,
            sale_price_override: s.sale_price_override, size_tiers: s.size_tiers },
          prodSettings, tierSel[s.id],
        )
        return { ...s, type: 'fixed' as const, value: result.sale_price, cost_price: result.cost_price }
      }
      if (s.type === 'film') {
        const film = films.find(f => f.id === filmSel[s.id])
        if (!film) return { ...s, type: 'per_m2' as const, value: 0, cost_price: 0 }
        return {
          ...s, type: 'per_m2' as const,
          value:      film.sale_price_per_m2 + (film.work_sale_per_m2 ?? 0),
          cost_price: film.cost_price_per_m2 + (film.work_cost_per_m2 ?? 0),
        }
      }
      return s
    })
  }

  const selectedClient   = clients.find(c => c.id === clientId) ?? null
  const discount         = selectedClient?.discount_percent ?? 0
  const selectedMaterial = materials.find(m => m.id === fMatId) ?? null
  const selectedServices = services.filter(s => fServiceIds.includes(s.id))

  function handleMaterialChange(id: number) {
    const mat = materials.find(m => m.id === id)
    setFMatId(id)
    if (mat) setFWaste(mat.passthrough ? 10 : mat.waste_percent)
  }

  function toggleService(id: number) {
    setFServiceIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function handleAddItem() {
    if (!selectedMaterial) return
    const w = Number(fWidth) || 0
    const h = Number(fHeight) || 0
    const q = Number(fQty) || 1
    if (w <= 0 || h <= 0) return

    const calc = calcItem(selectedMaterial, w, h, q, fWaste, fTempering, resolveSvcs(selectedServices, fTierSel, fFilmSel), fFacet, fFacet ? fFacetMm : null, facetPrices)
    setItems(prev => [...prev, { ...calc, localId: crypto.randomUUID(), comment: fComment || undefined }])
    setFWidth('')
    setFHeight('')
    setFQty('1')
    setFComment('')
    widthRef.current?.focus()
  }

  function handleWidthKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); heightRef.current?.focus() }
  }
  function handleHeightKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); qtyRef.current?.focus() }
  }
  function handleQtyKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleAddItem()
  }
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleAddItem()
  }

  function removeItem(localId: string) {
    setItems(prev => prev.filter(i => i.localId !== localId))
  }

  function copyItem(localId: string) {
    setItems(prev => {
      const item = prev.find(i => i.localId === localId)
      if (!item) return prev
      return [...prev, { ...item, localId: crypto.randomUUID() }]
    })
  }

  const [eComment, setEComment] = useState('')

  function openEdit(item: B2BOrderItem) {
    const sc: SuperCat = item.category === 'зеркало' ? 'зеркало' : 'стекло'
    setESuperCat(sc)
    setEThickness(item.thickness)
    setEMatId(item.materialId)
    setEWidth(String(item.width))
    setEHeight(String(item.height))
    setEQty(String(item.quantity))
    setEWaste(item.wastePercent)
    setETempering(item.hasTempering)
    setEFacet(item.hasFacet ?? false)
    setEFacetMm(item.facetTypeMm ?? 10)
    setEServiceIds(item.services.map(s => s.id))
    setEComment(item.comment ?? '')
    setEditingLocalId(item.localId)
  }

  function cancelEdit() { setEditingLocalId(null) }

  function saveEdit() {
    if (!editingLocalId) return
    const mat = materials.find(m => m.id === eMatId)
    if (!mat) return
    const w = Number(eWidth)
    const h = Number(eHeight)
    const q = Number(eQty) || 1
    if (w <= 0 || h <= 0) return
    const svcs = services.filter(s => eServiceIds.includes(s.id))
    const calc = calcItem(mat, w, h, q, eWaste, eTempering, resolveSvcs(svcs, eTierSel, eFilmSel), eFacet, eFacet ? eFacetMm : null, facetPrices)
    setItems(prev => prev.map(i => i.localId === editingLocalId
      ? { ...calc, localId: editingLocalId, comment: eComment || undefined }
      : i))
    setEditingLocalId(null)
  }

  function handleEditSuperCatChange(sc: SuperCat) {
    setESuperCat(sc)
    if (sc === 'зеркало') setETempering(false)
    const scDef = SUPER_CATS.find(s => s.value === sc)!
    const mats = materials.filter(m => (scDef.cats as readonly string[]).includes(m.category))
    const mat = pickDefault(mats, sc)
    if (mat) { setEThickness(mat.thickness); setEMatId(mat.id); setEWaste(mat.waste_percent) }
    else { setEThickness(null); setEMatId(null) }
  }

  function handleEditThicknessChange(t: number) {
    setEThickness(t)
    const scDef = SUPER_CATS.find(s => s.value === eSuperCat) ?? SUPER_CATS[0]
    const mats = sortByPriority(materials.filter(m => (scDef.cats as readonly string[]).includes(m.category) && m.thickness === t))
    if (mats.length > 0) { setEMatId(mats[0].id); setEWaste(mats[0].waste_percent) }
    else setEMatId(null)
  }

  function handleEditMatChange(id: number) {
    const mat = materials.find(m => m.id === id)
    setEMatId(id)
    if (mat) setEWaste(mat.passthrough ? 10 : mat.waste_percent)
  }

  function toggleEditService(id: number) {
    setEServiceIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function restoreDraft(draft: DraftData) {
    if (draft.clientId) setClientId(draft.clientId)
    setItems(draft.items)
    setNotes(draft.notes)
    setFProductionDays(draft.productionDays)
    setDraftToast(null)
    try { localStorage.removeItem(DRAFT_KEY) } catch {}
  }

  function dismissDraft() {
    setDraftToast(null)
    try { localStorage.removeItem(DRAFT_KEY) } catch {}
  }

  const totals: B2BOrderTotals | null = useMemo(() => {
    if (items.length === 0) return null
    return calcTotals(items, discount)
  }, [items, discount])

  // Cutting analysis — computed from current items + material sheet sizes
  const cuttingResults = useMemo(() => {
    if (items.length === 0) return null
    const matLookup = new Map(materials.map(m => [`${m.name}|${m.thickness}`, m]))
    const groups = new Map<string, PieceGroup>()
    for (const item of items) {
      if (!item.width || !item.height) continue
      const qty = item.quantity
      const key = `${item.materialName}|${item.thickness}|${item.category}`
      const mat = matLookup.get(`${item.materialName}|${item.thickness}`)
      if (!groups.has(key)) {
        groups.set(key, {
          pieces: [],
          materialLabel: `${item.materialName} ${item.thickness} мм`,
          category: item.category,
          sheetWidth:  (mat as (B2BMaterial & { sheet_width?: number }) | undefined)?.sheet_width  ?? 3210,
          sheetHeight: (mat as (B2BMaterial & { sheet_height?: number }) | undefined)?.sheet_height ?? 2250,
          patternDirection: ((mat as (B2BMaterial & { pattern_direction?: string }) | undefined)?.pattern_direction ?? 'none') as 'none' | 'along_length' | 'along_width',
        })
      }
      const g = groups.get(key)!
      for (let i = 0; i < qty; i++) {
        g.pieces.push({ id: `item-${item.materialId}-${i}`, width: item.width, height: item.height, label: `${item.width}×${item.height}`, orderId: 0, orderClientName: '', materialKey: key, canRotate: true })
      }
    }
    return runCuttingOptimizer(groups, DEFAULT_CUTTING_SETTINGS)
  }, [items, materials])

  const kpText = useMemo(() => {
    if (items.length === 0) return ''
    const clientName = clients.find(c => c.id === clientId)?.name
    const header = clientName ? `Расчёт для ${clientName}:\n` : 'Расчёт:\n'
    const lines = items.map((item, i) => {
      const facetDesc = item.hasFacet && item.facetTypeMm ? `, фацет ${item.facetTypeMm}мм` : ''
      const matDesc = item.hasTempering
        ? `${item.materialName} ${item.thickness}мм, закалённое${facetDesc}`
        : `${item.materialName} ${item.thickness}мм${facetDesc}`
      const price = Math.round(item.saleIncVat * (1 - discount / 100))
      const svcNames = item.services.filter(s => s.cost > 0).map(s => s.name)
      const parts = [
        `${i + 1}. ${matDesc}`,
        `   Размер: ${item.width} × ${item.height} мм`,
        `   Количество: ${item.quantity} шт.`,
        `   Площадь: ${fmtN(item.totalAreaNet)} м²`,
      ]
      if (svcNames.length > 0) parts.push(`   Обработка: ${svcNames.join(', ')}`)
      parts.push(`   Стоимость: ${price.toLocaleString('ru-RU')} ₽`)
      return parts.join('\n')
    })
    const totalSum = totals ? totals.totalAfterDiscount : 0
    const area = totals ? fmtN(totals.totalAreaNet) : '0'
    const weight = totals ? fmtN(totals.totalWeight, 1) : '0'
    return [
      header,
      lines.join('\n\n'),
      '',
      '──────────────────────────',
      `Итого: ${totalSum.toLocaleString('ru-RU')} ₽`,
      `Площадь: ${area} м²  /  Вес: ${weight} кг`,
      '',
      'Срок изготовления: уточняется после согласования.',
      'Отгрузка: г. Мытищи. Доставка — отдельно.',
    ].join('\n')
  }, [items, totals, discount, clientId, clients])

  async function handleCreateClient() {
    if (!ncName.trim()) { setNcError('Введите название компании'); return }
    setNcSaving(true)
    setNcError(null)
    const sb = createClient()

    // Duplicate check by name
    const { data: existing } = await sb
      .from('b2b_clients')
      .select('id,name,manager_id')
      .ilike('name', ncName.trim())
      .eq('active', true)
      .limit(1)
    if (existing && existing.length > 0) {
      const dup = existing[0] as { id: number; name: string; manager_id: string | null }
      const isOwn = dup.manager_id === managerId
      if (isOwn) {
        setNcError(`Клиент "${dup.name}" уже существует в вашей базе — выберите его в списке.`)
      } else {
        setNcError('Похожий клиент уже существует. Обратитесь к администратору или выберите существующего клиента.')
      }
      setNcSaving(false)
      return
    }

    const { data: created, error } = await sb
      .from('b2b_clients')
      .insert({
        name: ncName.trim(),
        contact: ncContact.trim() || null,
        phone: ncPhone.trim() || null,
        discount_percent: ncDiscount,
        notes: ncNotes.trim() || null,
        active: true,
        manager_id: managerId,
        manager_code: managerCode,
      })
      .select('id,name,contact,phone,discount_percent,active,notes,created_at,manager_id,manager_code')
      .single()

    if (error || !created) {
      setNcError(error?.message ?? 'Ошибка при создании клиента')
      setNcSaving(false)
      return
    }

    setClients(prev => [created as B2BClient, ...prev])
    setClientId((created as B2BClient).id)
    setShowNewClient(false)
    setNcName(''); setNcContact(''); setNcPhone(''); setNcDiscount(0); setNcNotes('')
    setNcSaving(false)
  }

  async function handleSave() {
    if (items.length === 0 || !selectedClient) return
    setSaving(true)
    setSaveError(null)
    const sb = createClient()
    const t = totals!
    const avgMargin = items.length > 0
      ? Math.round(items.reduce((s, i) => s + i.margin, 0) / items.length)
      : 0
    const orderNotes = JSON.stringify({
      status: 'quote',
      quote_date: new Date().toISOString(),
      production_days: fProductionDays,
      user_notes: notes || null,
      manager_name: managerEmail ?? null,
    })
    const { data: saved, error } = await sb.from('b2b_orders').insert({
      client_id: clientId,
      client_name: selectedClient.name,
      discount_percent: discount,
      margin_percent: avgMargin,
      items: items,
      total_area: t.totalAreaNet,
      total_weight: t.totalWeight,
      total_cost_net: t.totalCostExVat,
      total_cost_vat: t.totalInputVat,
      total_sale_inc_vat: t.totalSaleIncVat,
      total_after_discount: t.totalAfterDiscount,
      notes: orderNotes,
      custom_number: ourOrderNumber.trim() || null,
      client_order_number: clientOrderNumber.trim() || null,
      created_by: managerId ?? null,
    }).select('id').single()

    if (error) {
      console.error('B2B save error:', error)
      setSaveError(error.message)
      setSaving(false)
      return
    }

    if (saved) {
      try { localStorage.removeItem(DRAFT_KEY) } catch {}
      if (attachFile) {
        const safeName = attachFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `${saved.id}/${Date.now()}_${safeName}`
        const { error: uploadErr } = await sb.storage.from('b2b-attachments').upload(path, attachFile)
        if (!uploadErr) {
          const { data: urlData } = sb.storage.from('b2b-attachments').getPublicUrl(path)
          await sb.from('b2b_calculation_attachments').insert({
            order_id: saved.id,
            file_name: attachFile.name,
            file_url: urlData.publicUrl,
            file_type: attachFile.type || attachFile.name.split('.').pop() || '',
            file_size: attachFile.size,
          })
        }
      }
      setSavedOrderId(saved.id)
    }
    setSaving(false)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка...</div>
  )

  return (
    <>
    <div className="min-h-screen bg-[#f8f8f7]">
      <div className="max-w-[1400px] mx-auto px-4 py-4">

        {draftToast && (
          <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <span className="text-amber-600 text-[13px] flex-1">
              Найден черновик от {new Date(draftToast.savedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} ({draftToast.items.length} поз.)
            </span>
            <button onClick={() => restoreDraft(draftToast)}
              className="text-[12px] font-semibold bg-amber-500 text-white px-3 py-1 rounded-lg hover:bg-amber-600 transition-colors">
              Восстановить
            </button>
            <button onClick={dismissDraft}
              className="text-[12px] text-amber-600 hover:text-amber-800 transition-colors px-2">
              ✕
            </button>
          </div>
        )}

        <div className="flex items-center justify-between mb-4">
          <h1 className="text-[16px] font-semibold text-[#111110] tracking-tight">B2B Просчёт</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">

          {/* ══ ЛЕВАЯ КОЛОНКА ══ */}
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 space-y-3 lg:sticky lg:top-4">

            {/* Клиент */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Клиент</label>
                <button
                  onClick={() => setShowNewClient(true)}
                  className="text-[10px] font-semibold text-orange-600 hover:text-orange-800 transition-colors">
                  + Новый клиент
                </button>
              </div>
              <select
                className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110] transition-all"
                value={clientId ?? ''}
                onChange={e => setClientId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">— Выберите клиента —</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.discount_percent > 0 ? ` (−${c.discount_percent}%)` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Номера заказа */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Наш номер</label>
                <input
                  type="text"
                  placeholder="МГ-001"
                  className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
                  value={ourOrderNumber}
                  onChange={e => setOurOrderNumber(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">№ клиента</label>
                <input
                  type="text"
                  placeholder="необязательно"
                  className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all placeholder:text-[#c4c4be]"
                  value={clientOrderNumber}
                  onChange={e => setClientOrderNumber(e.target.value)}
                />
              </div>
            </div>

            {/* Дней производства */}
            <div>
              <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Срок производства, дней</label>
              <input type="number" min="1" max="90"
                className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
                value={fProductionDays}
                onChange={e => setFProductionDays(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>

            <div className="h-px bg-[#f0f0ec]" />

            {/* Стекло / Зеркало — табы */}
            <div>
              <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Материал</label>
              <div className="flex gap-1.5">
                {SUPER_CATS.filter(s => materials.some(m => (s.cats as readonly string[]).includes(m.category))).map(s => (
                  <button key={s.value} onClick={() => handleSuperCatChange(s.value)}
                    className={`flex-1 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${fSuperCat === s.value ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4]'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Толщина + Тип */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Толщина</label>
                <select
                  className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
                  value={fThickness ?? ''}
                  onChange={e => handleThicknessChange(Number(e.target.value))}>
                  {availableThickness.map(t => <option key={t} value={t}>{t} мм</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Тип</label>
                <select
                  className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] text-[#111110] outline-none focus:border-[#111110] transition-all"
                  value={fMatId ?? ''}
                  onChange={e => handleMaterialChange(Number(e.target.value))}>
                  {thicknessMaterials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            </div>

            {selectedMaterial && (selectedMaterial.sale_price ?? 0) === 0 && (
              <div className="px-3 py-1.5 bg-orange-50 rounded-lg text-[12px] text-orange-600 font-medium">
                Цена не задана — добавьте цену в справочнике стекла
              </div>
            )}

            <div className="h-px bg-[#f0f0ec]" />

            {/* Размеры */}
            <div>
              <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Размеры и количество</label>
              <div className="grid grid-cols-3 gap-2">
                <input ref={widthRef} type="number" min="1"
                  className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
                  value={fWidth} onChange={e => setFWidth(e.target.value)} onKeyDown={handleWidthKeyDown} placeholder="Ш, мм" />
                <input ref={heightRef} type="number" min="1"
                  className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
                  value={fHeight} onChange={e => setFHeight(e.target.value)} onKeyDown={handleHeightKeyDown} placeholder="В, мм" />
                <input ref={qtyRef} type="number" min="1"
                  className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
                  value={fQty} onChange={e => setFQty(e.target.value)} onKeyDown={handleQtyKeyDown} placeholder="Шт" />
              </div>
            </div>

            {/* Отход + Закалка */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">
                  Отход
                  {selectedMaterial && !selectedMaterial.passthrough && fWaste === selectedMaterial.waste_percent && (
                    <span className="ml-1 normal-case font-normal text-emerald-600 text-[10px]">авто</span>
                  )}
                  {selectedMaterial?.passthrough && <span className="ml-1 text-orange-500 normal-case font-normal text-[10px]">фикс.</span>}
                </label>
                {selectedMaterial?.passthrough ? (
                  <div className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] text-orange-600 font-semibold">
                    10% — проходной
                  </div>
                ) : (
                  <select
                    className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] text-[#111110] outline-none focus:border-[#111110] transition-all"
                    value={fWaste} onChange={e => setFWaste(Number(e.target.value))}>
                    {WASTE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
              </div>
              {fSuperCat === 'стекло' && (
                <div>
                  <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Закалка</label>
                  <label className={`flex items-center gap-2 h-[34px] px-3 border rounded-lg cursor-pointer transition-all ${fTempering ? 'border-orange-300 bg-orange-50' : 'border-[#e4e4e0] hover:border-[#c4c4be]'}`}>
                    <input type="checkbox" checked={fTempering} onChange={e => setFTempering(e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-[#111110]" />
                    <span className={`text-[13px] font-medium ${fTempering ? 'text-orange-700' : 'text-[#111110]'}`}>
                      {fTempering ? 'Закалённое' : 'Без закалки'}
                    </span>
                  </label>
                </div>
              )}
              {facetPrices.length > 0 && (
                <div>
                  <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Фацет</label>
                  <label className={`flex items-center gap-2 h-[34px] px-3 border rounded-lg cursor-pointer transition-all ${fFacet ? 'border-purple-300 bg-purple-50' : 'border-[#e4e4e0] hover:border-[#c4c4be]'}`}>
                    <input type="checkbox" checked={fFacet} onChange={e => setFFacet(e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-[#111110]" />
                    <span className={`text-[13px] font-medium ${fFacet ? 'text-purple-700' : 'text-[#111110]'}`}>
                      {fFacet ? 'Фацет' : 'Без фацета'}
                    </span>
                  </label>
                  {fFacet && (
                    <select
                      className="mt-1 w-full bg-white border border-purple-300 rounded-lg px-2 py-1.5 text-[12px] text-[#111110] outline-none focus:border-purple-500"
                      value={fFacetMm} onChange={e => setFFacetMm(Number(e.target.value))}>
                      {facetPrices.map(f => (
                        <option key={f.type_mm} value={f.type_mm}>{f.type_mm} мм — {f.sale_price} ₽/м.п.</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>

            {/* Комментарий к позиции */}
            <div>
              <input type="text" maxLength={120}
                className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[12px] text-[#111110] outline-none focus:border-[#111110] transition-all placeholder:text-[#c4c4be]"
                value={fComment} onChange={e => setFComment(e.target.value)} onKeyDown={handleKeyDown}
                placeholder="Комментарий к позиции (опционально)" />
            </div>

            {/* Кнопка добавить */}
            <button
              onClick={handleAddItem}
              disabled={!selectedMaterial || !fWidth || !fHeight || (selectedMaterial?.sale_price ?? 0) === 0}
              className="w-full bg-[#111110] text-white text-[14px] font-semibold py-2.5 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
              + Добавить позицию
            </button>

            {/* Доп. услуги */}
            {services.length > 0 && (
              <details className="group">
                <summary className="flex items-center justify-between px-3 py-2 rounded-lg border border-[#e4e4e0] cursor-pointer select-none list-none hover:bg-[#fafaf9] transition-colors">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85]">Доп. услуги</span>
                  <div className="flex items-center gap-2">
                    {fServiceIds.length > 0 && (
                      <span className="text-[10px] font-semibold bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">{fServiceIds.length}</span>
                    )}
                    <span className="text-[#c4c4be] text-[10px] group-open:rotate-180 transition-transform inline-block">▼</span>
                  </div>
                </summary>
                <div className="mt-1 border border-[#e4e4e0] rounded-lg overflow-hidden">
                  {services.map(s => {
                    const checked = fServiceIds.includes(s.id)
                    const tiers = s.size_tiers ?? []
                    const tierIdx = fTierSel[s.id] ?? 0
                    const selectedFilmId = fFilmSel[s.id]
                    const selectedFilm = films.find(f => f.id === selectedFilmId)
                    const displayPrice = s.type === 'calculated'
                      ? calcServiceCost({ time_minutes: s.time_minutes ?? 0, equipment_depr_rub: s.equipment_depr_rub ?? 0, consumables_cost_rub: s.consumables_cost_rub ?? 0, overhead_override_pct: s.overhead_override_pct, margin_override_pct: s.margin_override_pct, sale_price_override: s.sale_price_override, size_tiers: s.size_tiers }, prodSettings, tiers.length > 0 ? tierIdx : undefined).sale_price
                      : s.type === 'film'
                        ? (selectedFilm ? selectedFilm.sale_price_per_m2 + (selectedFilm.work_sale_per_m2 ?? 0) : null)
                        : null
                    return (
                      <div key={s.id} className={`border-b border-[#f8f8f7] last:border-0 ${checked ? 'bg-blue-50' : 'hover:bg-[#fafaf9]'}`}>
                        <label className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none transition-colors">
                          <input type="checkbox" checked={checked} onChange={() => toggleService(s.id)}
                            className="w-3 h-3 rounded accent-[#111110] flex-shrink-0" />
                          <span className="text-[12px] text-[#111110] flex-1 leading-tight">{s.name}</span>
                          <span className="text-[11px] text-[#9a9a95] flex-shrink-0 font-mono">
                            {s.type === 'percent' ? `${s.value}%`
                              : s.type === 'film' ? (selectedFilm ? `${selectedFilm.sale_price_per_m2.toLocaleString('ru-RU')} ₽/м²` : '—')
                              : `${(displayPrice ?? s.value).toLocaleString('ru-RU')} ₽`}
                          </span>
                        </label>
                        {checked && s.type === 'film' && (
                          <div className="px-3 pb-1.5 flex items-center gap-2">
                            <span className="text-[10px] text-[#9a9a95] flex-shrink-0">Плёнка:</span>
                            {films.length === 0 ? (
                              <span className="text-[10px] text-orange-500">Нет плёнок в справочнике</span>
                            ) : (
                              <select
                                value={selectedFilmId ?? ''}
                                onChange={e => setFFilmSel(prev => ({ ...prev, [s.id]: Number(e.target.value) }))}
                                className="flex-1 text-[11px] border border-[#e4e4e0] rounded-md px-1.5 py-0.5 bg-white outline-none focus:border-[#111110]">
                                <option value="">— выберите плёнку —</option>
                                {films.map(f => {
                                  const total = f.sale_price_per_m2 + (f.work_sale_per_m2 ?? 0)
                                  const label = f.work_sale_per_m2
                                    ? `${f.name} — ${total.toLocaleString('ru-RU')} ₽/м² (${f.sale_price_per_m2.toLocaleString('ru-RU')} + ${(f.work_sale_per_m2).toLocaleString('ru-RU')} работа)`
                                    : `${f.name} — ${total.toLocaleString('ru-RU')} ₽/м²`
                                  return <option key={f.id} value={f.id}>{label}</option>
                                })}
                              </select>
                            )}
                          </div>
                        )}
                        {checked && tiers.length > 0 && s.type !== 'film' && (
                          <div className="px-3 pb-1.5 flex items-center gap-2">
                            <span className="text-[10px] text-[#9a9a95]">Размер:</span>
                            <select
                              value={tierIdx}
                              onChange={e => setFTierSel(prev => ({ ...prev, [s.id]: Number(e.target.value) }))}
                              className="text-[11px] border border-[#e4e4e0] rounded-md px-1.5 py-0.5 bg-white outline-none focus:border-[#111110]">
                              {tiers.map((t, i) => (
                                <option key={i} value={i}>{t.label}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </details>
            )}

            {/* Чертёж / файл */}
            <div>
              <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">
                Чертёж / файл клиента
              </label>
              {attachFile ? (
                <div className="flex items-center gap-2 px-3 py-2 border border-[#e4e4e0] rounded-lg bg-[#f8f8f7]">
                  <span className="text-[11px] text-[#111110] flex-1 truncate font-medium">{attachFile.name}</span>
                  <span className="text-[10px] text-[#9a9a95] flex-shrink-0">
                    {attachFile.size < 1024 * 1024
                      ? `${(attachFile.size / 1024).toFixed(0)} КБ`
                      : `${(attachFile.size / (1024 * 1024)).toFixed(1)} МБ`}
                  </span>
                  <button onClick={() => setAttachFile(null)}
                    className="text-[#9a9a95] hover:text-red-500 transition-colors leading-none text-sm flex-shrink-0">✕</button>
                </div>
              ) : (
                <button onClick={() => attachInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-[#d4d4ce] rounded-lg text-[12px] text-[#9a9a95] hover:border-[#9a9a95] hover:text-[#6b6b66] transition-colors">
                  📎 Прикрепить файл
                </button>
              )}
              <input ref={attachInputRef} type="file"
                accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.doc,.docx,.xls,.xlsx"
                className="hidden"
                onChange={e => setAttachFile(e.target.files?.[0] ?? null)} />
            </div>

            {/* Примечание к заказу */}
            <details className="group">
              <summary className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] cursor-pointer select-none list-none hover:text-[#6b6b66] transition-colors">
                <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                Примечание к заказу
              </summary>
              <textarea
                className="mt-2 w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110] transition-all resize-none"
                rows={2} value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Общий комментарий к заказу..."
              />
            </details>
          </div>

          {/* ══ ПРАВАЯ КОЛОНКА ══ */}
          <div className="space-y-4">

            {/* Таблица позиций */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#f0f0ec] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85]">
                    Позиции {items.length > 0 && `— ${items.length} шт.`}
                  </span>
                  {selectedClient && (
                    <span className="text-[12px] text-[#6b6b66]">{selectedClient.name}</span>
                  )}
                  {discount > 0 && (
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">скидка {discount}%</span>
                  )}
                </div>
                {items.length > 0 && (
                  <button onClick={() => setItems([])} className="text-[11px] text-red-400 hover:text-red-600 transition-colors">
                    Очистить всё
                  </button>
                )}
              </div>

              {items.length === 0 ? (
                <div className="py-16 text-center text-[13px] text-[#c4c4be]">Добавьте первую позицию</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-[#f0f0ec] bg-[#fafaf9] text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest whitespace-nowrap">
                        <th className="px-3 py-2.5 text-center w-8">#</th>
                        <th className="px-3 py-2.5 text-left min-w-[140px]">Материал</th>
                        <th className="px-3 py-2.5 text-left min-w-[80px]">Тип</th>
                        <th className="px-3 py-2.5 text-right w-14">Толщ.</th>
                        <th className="px-3 py-2.5 text-right w-16">Ш, мм</th>
                        <th className="px-3 py-2.5 text-right w-16">В, мм</th>
                        <th className="px-3 py-2.5 text-right w-12">Кол.</th>
                        <th className="px-3 py-2.5 text-right w-16">Кв.м</th>
                        <th className="px-3 py-2.5 text-right w-16">Вес, кг</th>
                        <th className="px-3 py-2.5 text-right w-20">Цена/м²</th>
                        <th className="px-3 py-2.5 text-right w-14">Скид.%</th>
                        <th className="px-3 py-2.5 text-right w-24 text-[#111110]">Итого</th>
                        <th className="px-3 py-2.5 text-right w-24 text-[#9a9a95]">Себест.</th>
                        <th className="px-3 py-2.5 text-right w-16">Маржа</th>
                        <th className="px-3 py-2.5 text-left min-w-[80px]">Комм.</th>
                        <th className="w-20"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f8f8f7]">
                      {items.map((item, idx) => {
                        const itemAfterDiscount = Math.round(item.saleIncVat * (1 - discount / 100))
                        const em = effectiveItemMargin(item, discount)
                        return (
                          <tr key={item.localId} className="hover:bg-[#fafaf9] transition-colors">
                            <td className="px-3 py-2.5 text-center text-[10px] font-bold text-[#c4c4be]">{idx + 1}</td>
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-[#111110]">{item.materialName}</div>
                              {(item.hasTempering || item.hasFacet || item.services.length > 0) && (
                                <div className="flex gap-1 mt-0.5 flex-wrap">
                                  {item.hasTempering && (
                                    <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-orange-50 text-orange-600">закалка</span>
                                  )}
                                  {item.hasFacet && (
                                    <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-purple-50 text-purple-600">фацет {item.facetTypeMm}мм</span>
                                  )}
                                  {item.services.map(s => (
                                    <span key={s.id} className="text-[9px] font-medium px-1 py-0.5 rounded bg-blue-50 text-blue-600">{s.name}</span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-[#6b6b66] whitespace-nowrap">{item.category}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-[#111110]">{item.thickness}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-[#111110]">{item.width}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-[#111110]">{item.height}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-[#111110]">{item.quantity}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-[#111110]">{fmtN(item.totalAreaNet)}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-[#6b6b66]">{fmtN(item.totalWeight, 1)}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-[#111110]">{item.pricePerM2.toLocaleString('ru-RU')}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-[#6b6b66]">{discount > 0 ? `${discount}%` : '—'}</td>
                            <td className="px-3 py-2.5 text-right font-mono font-semibold text-[#111110] whitespace-nowrap">{itemAfterDiscount.toLocaleString('ru-RU')} ₽</td>
                            <td className="px-3 py-2.5 text-right font-mono text-[#9a9a95] whitespace-nowrap">{item.costExVat.toLocaleString('ru-RU')} ₽</td>
                            <td className="px-3 py-2.5 text-right">
                              <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${marginBadgeClass(em)}`}>
                                {em}%
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-[11px] text-[#9a9a95] max-w-[100px] truncate">
                              {item.comment || ''}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1 justify-center">
                                <button onClick={() => openEdit(item)} title="Редактировать"
                                  className="text-[11px] text-[#c4c4be] hover:text-[#111110] transition-colors px-1.5 py-0.5 rounded hover:bg-[#f0f0ec] leading-none">
                                  ✎
                                </button>
                                <button onClick={() => copyItem(item.localId)} title="Дублировать строку"
                                  className="text-[11px] text-[#c4c4be] hover:text-blue-500 transition-colors px-1.5 py-0.5 rounded hover:bg-blue-50 leading-none">
                                  ⧉
                                </button>
                                <button onClick={() => removeItem(item.localId)}
                                  className="text-[#c4c4be] hover:text-red-400 transition-colors text-lg leading-none">×</button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    {totals && (
                      <tfoot>
                        <tr className="border-t-2 border-[#e4e4e0] bg-[#fafaf9] font-semibold text-[#111110]">
                          <td className="px-3 py-2.5 text-center text-[10px] font-bold text-[#9a9a95]">∑</td>
                          <td className="px-3 py-2.5 text-[11px] text-[#6b6b66]">{items.length} позиций</td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td className="px-3 py-2.5 text-right font-mono">{items.reduce((s, i) => s + i.quantity, 0)}</td>
                          <td className="px-3 py-2.5 text-right font-mono">{fmtN(totals.totalAreaNet)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-[#6b6b66]">{fmtN(totals.totalWeight, 1)}</td>
                          <td></td>
                          <td></td>
                          <td className="px-3 py-2.5 text-right font-mono font-bold whitespace-nowrap">{fmt(totals.totalAfterDiscount)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-[#9a9a95] whitespace-nowrap">{totals.totalCostExVat.toLocaleString('ru-RU')} ₽</td>
                          <td className="px-3 py-2.5 text-right">
                            {items.length > 0 && (() => {
                              const avg = Math.round(items.reduce((s, i) => s + effectiveItemMargin(i, discount), 0) / items.length)
                              return <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${marginBadgeClass(avg)}`}>{avg}%</span>
                            })()}
                          </td>
                          <td></td>
                          <td></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>

            {/* КП для клиента */}
            {kpText && (
              <details className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden group">
                <summary className="px-5 py-3 border-b border-[#f0f0ec] flex items-center gap-2 cursor-pointer select-none list-none hover:bg-[#fafaf9] transition-colors">
                  <span className="text-[10px] text-[#9a9a95] group-open:rotate-90 transition-transform inline-block">▶</span>
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85]">Клиентский расчёт (КП)</span>
                  <span className="text-[11px] text-[#c4c4be] ml-auto">нажмите чтобы раскрыть</span>
                </summary>
                <div className="p-5">
                  <pre className="text-[12px] font-mono leading-relaxed whitespace-pre-wrap text-[#111110] bg-[#f8f8f7] rounded-xl px-4 py-3 mb-3 border border-[#e8e8e4]">{kpText}</pre>
                  <button
                    onClick={() => navigator.clipboard?.writeText(kpText)}
                    className="text-[12px] font-medium px-4 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f4] transition-colors">
                    Скопировать текст
                  </button>
                </div>
              </details>
            )}

            {/* Итоговый блок + кнопка сохранить */}
            {totals && (
              <div className="bg-white border border-[#e4e4e0] rounded-xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    {discount > 0 && (
                      <p className="text-[12px] text-[#9a9a95] line-through mb-0.5">{fmt(totals.totalSaleIncVat)}</p>
                    )}
                    <p className="text-[24px] font-bold text-[#111110] font-mono leading-none">{fmt(totals.totalAfterDiscount)}</p>
                    {discount > 0 && (
                      <p className="text-[11px] text-emerald-600 mt-0.5">скидка {discount}%</p>
                    )}
                  </div>
                  <div className="text-right text-[12px] text-[#8a8a85] space-y-0.5">
                    <p className="font-mono">{fmtN(totals.totalAreaNet)} м²</p>
                    <p className="font-mono">{fmtN(totals.totalWeight, 1)} кг</p>
                    <p className="font-mono text-[11px]">
                      расч. {fmtN(items.reduce((s, i) => s + i.totalAreaBilled, 0))} м²
                    </p>
                  </div>
                </div>

                {/* Маржа и прибыль — итоговая строка */}
                {(() => {
                  const avgEm = Math.round(items.reduce((s, i) => s + effectiveItemMargin(i, discount), 0) / items.length)
                  return (
                    <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-[#f8f8f7] border border-[#f0f0ec]">
                      <span className={`text-[12px] font-bold px-2 py-0.5 rounded ${marginBadgeClass(avgEm)}`}>{avgEm}%</span>
                      <span className="text-[12px] text-[#6b6b66]">средняя маржа</span>
                      <span className="ml-auto text-[12px] font-semibold font-mono text-[#111110]">
                        {totals.profit > 0 ? '+' : ''}{fmt(totals.profit)}
                      </span>
                      <span className="text-[11px] text-[#9a9a95]">прибыль</span>
                    </div>
                  )
                })()}

                <details className="group">
                  <summary className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] cursor-pointer select-none list-none flex items-center gap-1.5">
                    <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                    Аналитика (только для менеджера)
                  </summary>
                  <div className="mt-3 space-y-1.5 border-t border-[#f0f0ec] pt-3 text-[13px]">
                    <div className="flex justify-between">
                      <span className="text-[#6b6b66]">Себестоимость без НДС</span>
                      <span className="font-mono text-[#111110]">{fmt(totals.totalCostExVat)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#6b6b66]">Продажа без НДС</span>
                      <span className="font-mono text-[#111110]">{fmt(totals.totalSaleExVat)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#6b6b66]">НДС к уплате в бюджет</span>
                      <span className="font-mono text-[#111110]">{fmt(totals.vatToState)}</span>
                    </div>
                    <div className="flex justify-between font-semibold border-t border-[#f0f0ec] pt-1.5 mt-1.5">
                      <span className="text-[#111110]">Прибыль (ориент.)</span>
                      <span className={`font-mono ${totals.profit > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmt(totals.profit)}</span>
                    </div>
                  </div>
                </details>

                <button onClick={handleSave} disabled={saving || !clientId || items.length === 0}
                  className="w-full bg-[#111110] text-white text-[14px] font-semibold py-3 rounded-xl hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
                  {saving ? 'Сохранение...' : !clientId ? 'Выберите клиента' : 'Сохранить просчёт'}
                </button>

                {saveError && (
                  <div className="border border-red-200 bg-red-50 rounded-xl px-3 py-2.5 text-[12px] text-red-700">
                    <p className="font-semibold mb-0.5">Ошибка сохранения:</p>
                    <p className="font-mono break-all">{saveError}</p>
                  </div>
                )}

                {savedOrderId && (
                  <div className="border border-emerald-200 bg-emerald-50 rounded-xl p-3 flex flex-col gap-2">
                    <p className="text-[12px] font-semibold text-emerald-800">Расчёт сохранён ✓</p>
                    <div className="flex gap-2">
                      <a
                        href={`/api/quotes/${savedOrderId}/pdf`}
                        target="_blank"
                        download
                        className="flex-1 text-center bg-[#111110] text-white text-[12px] font-medium py-2 rounded-lg hover:bg-[#2a2a28] transition-colors">
                        📄 Скачать КП (PDF)
                      </a>
                      <button
                        onClick={() => router.push('/b2b-quotes')}
                        className="flex-1 text-[12px] font-medium py-2 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-white transition-colors">
                        К списку →
                      </button>
                    </div>
                  </div>
                )}

                {/* Предварительная закупка */}
                {items.length > 0 && (() => {
                  const summary = computeProductionSummary(
                    items.map(i => ({
                      materialName: i.materialName,
                      thickness: i.thickness,
                      totalAreaNet: i.totalAreaNet,
                      totalAreaBilled: i.totalAreaBilled,
                      hasTempering: i.hasTempering,
                      wastePercent: i.wastePercent,
                    })),
                    materials,
                  )
                  if (!summary.totalSheets) return null
                  const fmtRub = (n: number) => n.toLocaleString('ru-RU') + ' ₽'
                  return (
                    <details className="group border-t border-[#f0f0ec] pt-3">
                      <summary className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] cursor-pointer select-none list-none flex items-center gap-1.5">
                        <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                        📦 Предварительная закупка
                      </summary>
                      <div className="mt-3 space-y-1.5">
                        {summary.rows.map(row => (
                          <div key={row.matKey} className="flex items-center justify-between text-[12px] py-1 border-b border-[#f8f8f7] last:border-0">
                            <div>
                              <span className="font-semibold text-[#111110]">{row.matLabel}</span>
                              <span className="ml-2 text-blue-700 font-bold">≈ {row.sheetsNeeded} л.</span>
                              <span className="text-[#9a9a95] ml-1 text-[11px]">({row.sheetW}×{row.sheetH})</span>
                            </div>
                            <div className="text-right">
                              <span className="font-mono text-[#111110]">{fmtRub(row.sheetCost)}</span>
                              {row.temperingCost > 0 && (
                                <span className="text-amber-600 ml-1.5 text-[11px]">+{fmtRub(row.temperingCost)} закалка</span>
                              )}
                            </div>
                          </div>
                        ))}
                        <div className="flex justify-between text-[12px] pt-1.5 font-semibold">
                          <span className="text-[#6b6b66]">Итого листов: {summary.totalSheets} шт</span>
                          <span className="font-mono text-[#111110]">{fmtRub(summary.grandTotal)}</span>
                        </div>
                      </div>
                    </details>
                  )
                })()}

                {/* Раскрой */}
                {cuttingResults && cuttingResults.length > 0 && (
                  <details className="group border-t border-[#f0f0ec] pt-3">
                    <summary className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] cursor-pointer select-none list-none flex items-center gap-1.5">
                      <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                      ✂️ Раскрой листов
                    </summary>
                    <div className="mt-3 space-y-2">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="border-b border-[#f0f0ec]">
                            <th className="text-left py-1.5 text-[#9a9a95] font-medium">Материал</th>
                            <th className="text-center py-1.5 text-[#9a9a95] font-medium w-20">Листов</th>
                            <th className="text-center py-1.5 text-[#9a9a95] font-medium w-24">Лист</th>
                            <th className="text-center py-1.5 text-[#9a9a95] font-medium w-16">КПД</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cuttingResults.map(r => (
                            <tr key={r.materialKey} className="border-b border-[#f0f0ec] last:border-0">
                              <td className="py-2 font-semibold text-[#111110]">{r.materialLabel}</td>
                              <td className="py-2 text-center font-bold text-blue-700">{r.sheetsNeeded}</td>
                              <td className="py-2 text-center text-[#6b6b66] font-mono text-[11px]">{r.sheetWidth}×{r.sheetHeight}</td>
                              <td className="py-2 text-center">
                                <span className={`text-[11px] font-semibold ${r.avgEfficiency >= 70 ? 'text-emerald-600' : r.avgEfficiency >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                                  {r.avgEfficiency}%
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-[11px] text-[#9a9a95]">
                        Зазор 2 мм · Кромка 2 мм · Поворот разрешён
                        {cuttingResults.some(r => r.patternDirection !== 'none') && ' · ⚠ Рифлёное — поворот запрещён'}
                      </p>
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* ══ EDIT MODAL ══ */}
    {editingLocalId !== null && (() => {
      const eSuperCatDef   = SUPER_CATS.find(s => s.value === eSuperCat) ?? SUPER_CATS[0]
      const eCatMats       = materials.filter(m => (eSuperCatDef.cats as readonly string[]).includes(m.category))
      const eAvailThick    = [...new Set(eCatMats.map(m => m.thickness))].sort((a, b) => a - b)
      const eThickMats     = sortByPriority(eCatMats.filter(m => m.thickness === eThickness))
      const eSelectedMat   = materials.find(m => m.id === eMatId) ?? null
      const eCanSave       = !!eSelectedMat && Number(eWidth) > 0 && Number(eHeight) > 0 && (eSelectedMat.sale_price ?? 0) > 0

      return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto shadow-2xl">

            <div className="px-5 py-4 border-b border-[#f0f0ec] flex items-center justify-between sticky top-0 bg-white z-10">
              <h2 className="text-[15px] font-semibold text-[#111110]">Редактировать позицию</h2>
              <button onClick={cancelEdit} className="text-[#9a9a95] hover:text-[#111110] transition-colors text-lg leading-none">✕</button>
            </div>

            <div className="p-5 space-y-3">

              {/* Стекло / Зеркало */}
              <div>
                <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Материал</label>
                <div className="flex gap-1.5">
                  {SUPER_CATS.filter(s => materials.some(m => (s.cats as readonly string[]).includes(m.category))).map(s => (
                    <button key={s.value} onClick={() => handleEditSuperCatChange(s.value)}
                      className={`flex-1 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${eSuperCat === s.value ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4]'}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Толщина + Тип */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Толщина</label>
                  <select
                    className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110]"
                    value={eThickness ?? ''}
                    onChange={e => handleEditThicknessChange(Number(e.target.value))}>
                    {eAvailThick.map(t => <option key={t} value={t}>{t} мм</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Тип</label>
                  <select
                    className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] text-[#111110] outline-none focus:border-[#111110]"
                    value={eMatId ?? ''}
                    onChange={e => handleEditMatChange(Number(e.target.value))}>
                    {eThickMats.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Цена материала */}
              {eSelectedMat && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[#f8f8f7] rounded-lg text-[12px]">
                  {eSelectedMat.sale_price > 0
                    ? <span className="font-semibold text-[#111110] font-mono">{eSelectedMat.sale_price.toLocaleString('ru-RU')} ₽/м²</span>
                    : <span className="text-orange-500 font-medium">цена не задана</span>}
                  <span className="text-[#d4d4ce]">·</span>
                  <span className="text-[#8a8a85]">отход {eWaste}%</span>
                </div>
              )}

              {/* Размеры + количество */}
              <div>
                <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Размеры и количество</label>
                <div className="grid grid-cols-3 gap-2">
                  <input type="number" min="1"
                    className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110]"
                    value={eWidth} onChange={e => setEWidth(e.target.value)} placeholder="Ш, мм" />
                  <input type="number" min="1"
                    className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110]"
                    value={eHeight} onChange={e => setEHeight(e.target.value)} placeholder="В, мм" />
                  <input type="number" min="1"
                    className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110]"
                    value={eQty} onChange={e => setEQty(e.target.value)} placeholder="Шт" />
                </div>
              </div>

              {/* Отход + Закалка */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Отход</label>
                  {eSelectedMat?.passthrough ? (
                    <div className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] text-orange-600 font-semibold">
                      10% — проходной
                    </div>
                  ) : (
                    <select
                      className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] text-[#111110] outline-none focus:border-[#111110]"
                      value={eWaste} onChange={e => setEWaste(Number(e.target.value))}>
                      {WASTE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Опции</label>
                  <div className="space-y-1">
                    {eSuperCat === 'стекло' && (
                      <label className="flex items-center gap-2 h-[34px] px-3 border border-[#e4e4e0] rounded-lg cursor-pointer hover:border-[#c4c4be] transition-all">
                        <input type="checkbox" checked={eTempering} onChange={e => setETempering(e.target.checked)}
                          className="w-3.5 h-3.5 rounded accent-[#111110]" />
                        <span className="text-[13px] text-[#111110]">Закалка</span>
                      </label>
                    )}
                    {facetPrices.length > 0 && (
                      <>
                        <label className={`flex items-center gap-2 h-[34px] px-3 border rounded-lg cursor-pointer transition-all ${eFacet ? 'border-purple-300 bg-purple-50' : 'border-[#e4e4e0] hover:border-[#c4c4be]'}`}>
                          <input type="checkbox" checked={eFacet} onChange={e => setEFacet(e.target.checked)}
                            className="w-3.5 h-3.5 rounded accent-[#111110]" />
                          <span className={`text-[13px] ${eFacet ? 'text-purple-700 font-medium' : 'text-[#111110]'}`}>Фацет</span>
                        </label>
                        {eFacet && (
                          <select
                            className="w-full bg-white border border-purple-300 rounded-lg px-2 py-1.5 text-[12px] text-[#111110] outline-none focus:border-purple-500"
                            value={eFacetMm} onChange={e => setEFacetMm(Number(e.target.value))}>
                            {facetPrices.map(f => (
                              <option key={f.type_mm} value={f.type_mm}>{f.type_mm} мм — {f.sale_price} ₽/м.п.</option>
                            ))}
                          </select>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Доп. услуги */}
              {services.length > 0 && (
                <div>
                  <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Доп. услуги</label>
                  <div className="border border-[#e4e4e0] rounded-lg overflow-hidden">
                    {services.map(s => {
                      const checked = eServiceIds.includes(s.id)
                      const tiers = s.size_tiers ?? []
                      const tierIdx = eTierSel[s.id] ?? 0
                      const selectedFilmId = eFilmSel[s.id]
                      const selectedFilm = films.find(f => f.id === selectedFilmId)
                      const displayPrice = s.type === 'calculated'
                        ? calcServiceCost({ time_minutes: s.time_minutes ?? 0, equipment_depr_rub: s.equipment_depr_rub ?? 0, consumables_cost_rub: s.consumables_cost_rub ?? 0, overhead_override_pct: s.overhead_override_pct, margin_override_pct: s.margin_override_pct, sale_price_override: s.sale_price_override, size_tiers: s.size_tiers }, prodSettings, tiers.length > 0 ? tierIdx : undefined).sale_price
                        : s.type === 'film'
                          ? (selectedFilm ? selectedFilm.sale_price_per_m2 + (selectedFilm.work_sale_per_m2 ?? 0) : null)
                          : null
                      return (
                        <div key={s.id} className={`border-b border-[#f8f8f7] last:border-0 ${checked ? 'bg-blue-50' : 'hover:bg-[#fafaf9]'}`}>
                          <label className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none transition-colors">
                            <input type="checkbox" checked={checked} onChange={() => toggleEditService(s.id)}
                              className="w-3 h-3 rounded accent-[#111110] flex-shrink-0" />
                            <span className="text-[12px] text-[#111110] flex-1 leading-tight">{s.name}</span>
                            <span className="text-[11px] text-[#9a9a95] flex-shrink-0 font-mono">
                              {s.type === 'percent' ? `${s.value}%`
                                : s.type === 'film' ? (selectedFilm ? `${selectedFilm.sale_price_per_m2.toLocaleString('ru-RU')} ₽/м²` : '—')
                                : `${(displayPrice ?? s.value).toLocaleString('ru-RU')} ₽`}
                            </span>
                          </label>
                          {checked && s.type === 'film' && (
                            <div className="px-3 pb-1.5 flex items-center gap-2">
                              <span className="text-[10px] text-[#9a9a95] flex-shrink-0">Плёнка:</span>
                              {films.length === 0 ? (
                                <span className="text-[10px] text-orange-500">Нет плёнок в справочнике</span>
                              ) : (
                                <select
                                  value={selectedFilmId ?? ''}
                                  onChange={e => setEFilmSel(prev => ({ ...prev, [s.id]: Number(e.target.value) }))}
                                  className="flex-1 text-[11px] border border-[#e4e4e0] rounded-md px-1.5 py-0.5 bg-white outline-none focus:border-[#111110]">
                                  <option value="">— выберите плёнку —</option>
                                  {films.map(f => {
                                    const total = f.sale_price_per_m2 + (f.work_sale_per_m2 ?? 0)
                                    const label = f.work_sale_per_m2
                                      ? `${f.name} — ${total.toLocaleString('ru-RU')} ₽/м² (${f.sale_price_per_m2.toLocaleString('ru-RU')} + ${(f.work_sale_per_m2).toLocaleString('ru-RU')} работа)`
                                      : `${f.name} — ${total.toLocaleString('ru-RU')} ₽/м²`
                                    return <option key={f.id} value={f.id}>{label}</option>
                                  })}
                                </select>
                              )}
                            </div>
                          )}
                          {checked && tiers.length > 0 && s.type !== 'film' && (
                            <div className="px-3 pb-1.5 flex items-center gap-2">
                              <span className="text-[10px] text-[#9a9a95]">Размер:</span>
                              <select
                                value={tierIdx}
                                onChange={e => setETierSel(prev => ({ ...prev, [s.id]: Number(e.target.value) }))}
                                className="text-[11px] border border-[#e4e4e0] rounded-md px-1.5 py-0.5 bg-white outline-none focus:border-[#111110]">
                                {tiers.map((t, i) => (
                                  <option key={i} value={i}>{t.label}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Комментарий */}
              <div>
                <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Комментарий</label>
                <input type="text" maxLength={120}
                  className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[12px] text-[#111110] outline-none focus:border-[#111110]"
                  value={eComment} onChange={e => setEComment(e.target.value)}
                  placeholder="Комментарий к позиции..." />
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={cancelEdit}
                  className="flex-1 py-2.5 rounded-lg border border-[#e4e4e0] text-[13px] font-medium text-[#6b6b66] hover:bg-[#f8f8f7] transition-colors">
                  Отмена
                </button>
                <button onClick={saveEdit} disabled={!eCanSave}
                  className="flex-1 py-2.5 rounded-lg bg-[#111110] text-white text-[13px] font-semibold hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        </div>
      )
    })()}
      {/* ══ Модалка: Новый клиент ══ */}
      {showNewClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold text-[#111110]">Новый B2B клиент</h2>
              <button onClick={() => { setShowNewClient(false); setNcError(null) }}
                className="text-[#9a9a95] hover:text-[#111110] text-lg transition-colors">✕</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Название компании *</label>
                <input
                  type="text" placeholder="ООО Ромашка"
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]"
                  value={ncName} onChange={e => setNcName(e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Контактное лицо</label>
                <input
                  type="text" placeholder="Иван Иванов"
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]"
                  value={ncContact} onChange={e => setNcContact(e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Телефон</label>
                <input
                  type="text" placeholder="+7 999 000 00 00"
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]"
                  value={ncPhone} onChange={e => setNcPhone(e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Скидка %</label>
                <input
                  type="number" min="0" max="50" step="1"
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]"
                  value={ncDiscount} onChange={e => setNcDiscount(Number(e.target.value))} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Комментарий</label>
                <textarea
                  rows={2} placeholder="Дополнительная информация..."
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] resize-none"
                  value={ncNotes} onChange={e => setNcNotes(e.target.value)} />
              </div>

              {ncError && <p className="text-[12px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{ncError}</p>}

              <div className="flex gap-2 pt-1">
                <button onClick={() => { setShowNewClient(false); setNcError(null) }}
                  className="flex-1 py-2.5 rounded-lg border border-[#e4e4e0] text-[13px] font-medium text-[#6b6b66] hover:bg-[#f8f8f7] transition-colors">
                  Отмена
                </button>
                <button onClick={handleCreateClient} disabled={ncSaving || !ncName.trim()}
                  className="flex-1 py-2.5 rounded-lg bg-orange-500 text-white text-[13px] font-semibold hover:bg-orange-600 disabled:opacity-40 transition-colors">
                  {ncSaving ? 'Создаём...' : 'Создать клиента'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
