'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { normalizeHoles, totalHoles, type HoleGroup } from '@/lib/production/holes'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { B2BClient, B2BMaterial, B2BService, B2BFilm, computeMarginStatus } from '@/lib/types'
import { calcServiceCost, ProductionSettings, DEFAULT_PRODUCTION_SETTINGS } from '@/lib/calcServiceCost'
import { applicableSurcharges, type SurchargeRule } from '@/lib/surcharges'
import { applyClientPrices, loadClientPrices } from '@/lib/b2b/clientPrices'
import { computeQuoteItem } from '@/lib/b2b/computeQuote'
import { checkQuoteBom, summarizeIssues, type BomCheckItem } from '@/lib/b2b/bomCheck'
import { runCuttingOptimizer, DEFAULT_CUTTING_SETTINGS, type PieceGroup } from '@/lib/cuttingOptimizer'
import { computeProductionSummary } from '@/lib/productionSummary'
import type { UserPermissions } from '@/lib/permissions'
import { isMGlassClient, isMGlassOnlyUser, isAllClientsScope, hasB2BSalesScope, MGLASS_CLIENT_IDS, MGLASS_SCOPE_ERROR } from '@/lib/b2bScope'
import { useOwnerStrategy } from '@/lib/useOwnerStrategy'
import { loadFactoryData, calcFactoryMirror, calcFactoryLoft, factoryQuoteToItem, mirrorMms, ledOptions, frameOptions, lightingLengthM, ALL_SIDES, type FactoryData, type LightSides } from '@/lib/b2bFactoryProducts'

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
  calcItem, calcTotals, effectiveItemTotal, TEMPERING_COST, VAT,
  type B2BOrderItem, type B2BOrderTotals, type FacetPrice, type MinPriceReason,
} from '@/lib/b2bCalculator'
import { applyAutoWasteToItems } from '@/lib/autoWasteApply'

const fmt  = (n: number) => n.toLocaleString('ru-RU') + ' ₽'
const fmtN = (n: number, d = 3) => n.toLocaleString('ru-RU', { maximumFractionDigits: d })

function marginBadgeClass(m: number): string {
  const s = computeMarginStatus(m, { green_threshold: 35, yellow_threshold: 25, blocked_below: 0 })
  if (s === 'green')  return 'bg-emerald-50 text-emerald-700'
  if (s === 'yellow') return 'bg-amber-50 text-amber-700'
  return 'bg-red-50 text-red-600'
}

function effectiveItemMargin(item: B2BOrderItem, discountPct: number): number {
  // Ручная договорная цена (manualTotal) участвует в марже как конечная сумма
  const afterDisc = effectiveItemTotal(item, discountPct)
  const exVat = afterDisc * 100 / (100 + VAT)
  return exVat > 0 ? Math.round((1 - item.costExVat / exVat) * 100) : 0
}

// Сопоставление распознанной с чертежа детали (толщина + тип стекла словами) с
// материалом из справочника b2b_materials. Best-effort: сначала по толщине, затем
// по категории/названию; фолбэк — первый материал нужной толщины. Менеджер правит.
type ParsedDrawingItem = {
  label?: string; width_mm?: number; height_mm?: number; thickness_mm?: number
  shape?: string; cut_width_mm?: number; cut_height_mm?: number
  material?: string; is_mirror?: boolean; quantity?: number; holes?: number; cutouts?: number
  tempering?: boolean; notes?: string
}
function matchDrawingMaterial(mats: B2BMaterial[], thickness: number, matStr: string, isMirror?: boolean): B2BMaterial | null {
  if (!mats.length) return null
  const th = thickness > 0 ? thickness : 8
  let pool = mats.filter(m => m.thickness === th)
  if (!pool.length) pool = mats
  // Тип детали: зеркало vs стекло — сначала сужаем пул, чтобы не подставить стекло вместо зеркала.
  const isMir = (m: B2BMaterial) => /зеркал/i.test(m.category + ' ' + m.name)
  if (isMirror === true) { const mp = pool.filter(isMir); if (mp.length) pool = mp }
  else if (isMirror === false) { const gp = pool.filter(m => !isMir(m)); if (gp.length) pool = gp }
  const s = (matStr || '').toLowerCase()
  const has = (...kw: string[]) => kw.some(k => s.includes(k))
  const nm = (m: B2BMaterial) => (m.category + ' ' + m.name).toLowerCase()
  const byName = (...kw: string[]) => pool.find(m => kw.some(k => nm(m).includes(k))) ?? null
  if (has('зеркал', 'mirror'))                     return byName('зеркал') ?? pool[0]
  if (has('бронз', 'графит'))                      return byName('бронз', 'графит', 'тонир') ?? pool[0]
  if (has('сатин', 'матов', 'matt', 'frost'))      return byName('сатин', 'матов') ?? pool[0]
  if (has('тонир', 'tint'))                        return byName('тонир', 'бронз') ?? pool[0]
  if (has('осветл', 'crystal', 'ультра', 'опти'))  return byName('осветл', 'crystal') ?? pool[0]
  if (has('рифл', 'узор', 'декор', 'мору'))         return byName('рифл', 'декор', 'мору') ?? pool[0]
  // «прозрачное» или материал не указан → простое прозрачное (без рифления/декора/тонировки)
  const plain = (m: B2BMaterial) => !/рифл|декор|сатин|матов|бронз|тонир|мору|зеркал/i.test(nm(m))
  return pool.find(m => /прозрачн|clear|м1/i.test(nm(m)) && plain(m))
      ?? pool.find(plain)
      ?? pool[0] ?? mats[0] ?? null
}

function minPriceReasonLabel(reason: MinPriceReason): string {
  if (reason === 'glass_tempering')     return 'мин. цена (стекло+закалка)'
  if (reason === 'tinted_tempering')    return 'мин. цена (тонировка+закалка)'
  if (reason === 'mirror_no_tempering') return 'мин. цена (зеркало)'
  return 'мин. цена (узкая деталь)'
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
  // А12: базовый прайс из справочника и индивидуальный прайс выбранного клиента.
  // materials — то, что видит калькулятор: база с наложенными ценами клиента.
  const [baseMaterials, setMaterials] = useState<B2BMaterial[]>([])
  const [clientPrices, setClientPrices] = useState<Map<number, number>>(new Map())
  const materials = useMemo(() => applyClientPrices(baseMaterials, clientPrices), [baseMaterials, clientPrices])
  const [services, setServices]         = useState<B2BService[]>([])
  const [films, setFilms]               = useState<B2BFilm[]>([])
  const [prodSettings, setProdSettings] = useState<ProductionSettings>(DEFAULT_PRODUCTION_SETTINGS)
  const [fTierSel, setFTierSel]         = useState<Record<number, number>>({})
  const [eTierSel, setETierSel]         = useState<Record<number, number>>({})
  const [fFilmSel, setFFilmSel]         = useState<Record<number, number>>({})
  const [eFilmSel, setEFilmSel]         = useState<Record<number, number>>({})
  const [loading, setLoading]           = useState(true)
  const [loadError, setLoadError]       = useState<string | null>(null)
  const [isBuyer, setIsBuyer]           = useState(false)
  const [saving, setSaving]       = useState(false)
  const [savedOrderId, setSavedOrderId] = useState<number | null>(null)
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null)   // ?orderId= → редактируем ту же строку
  const editOrigNotesRef = useRef<Record<string, unknown>>({})                 // исходные notes для merge (не терять status/history/оплату)
  const [savedAsPending, setSavedAsPending] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [managerEmail, setManagerEmail] = useState<string | null>(null)
  const [managerId, setManagerId]       = useState<string | null>(null)
  const [managerCode, setManagerCode]   = useState<number | null>(null)
  const [managerName, setManagerName]   = useState<string | null>(null)
  const [mglassOnly, setMglassOnly]     = useState(false)
  const [isAdmin, setIsAdmin]           = useState(false)
  const [maxDiscount, setMaxDiscount]   = useState<number>(100)
  const { strategy } = useOwnerStrategy()

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
  // Инлайн-редактирование «Итого» позиции (договорная цена): localId редактируемой строки
  const [editTotalId, setEditTotalId] = useState<string | null>(null)
  // Мультивыбор позиций + массовая смена материала/толщины/типа.
  const [selIds, setSelIds]           = useState<Set<string>>(new Set())
  const [bulkMatId, setBulkMatId]     = useState<number | null>(null)
  const [bulkQty, setBulkQty]         = useState('')   // массовое количество: поставить всем одно число

  const [fSuperCat, setFSuperCat]     = useState<SuperCat>('стекло')

  // Изделия производства (зеркало с подсветкой / лофт) — цена производства из финмодели V2.
  const [fKind, setFKind] = useState<'material' | 'fmirror' | 'floft'>('material')
  const [factoryData, setFactoryData] = useState<FactoryData | null>(null)
  const [factoryLoading, setFactoryLoading] = useState(false)
  const [fmName, setFmName]       = useState('')
  const [fmMm, setFmMm]           = useState<number>(4)
  const [fmW, setFmW]             = useState('')
  const [fmH, setFmH]             = useState('')
  const [fmQty, setFmQty]         = useState('1')
  const [fmLighting, setFmLighting] = useState(true)
  const [fmFrame, setFmFrame]     = useState(false)
  const [fmButton, setFmButton]   = useState<'none' | 'sensor' | 'wave'>('none')
  // Стороны подсветки: по умолчанию весь периметр. Лента, профиль, рассеиватель и
  // мощность блока считаются от выбранных сторон.
  const [fmSides, setFmSides] = useState<LightSides>({ ...ALL_SIDES })
  // Фацет и пескоструй — разные обработки, каждая со своей себестоимостью.
  const [fmSandblast, setFmSandblast] = useState(false)
  const [fmFacetMm, setFmFacetMm]     = useState<number | null>(null)
  const [fmLedId, setFmLedId]     = useState<number | null>(null)
  const [fmFrameId, setFmFrameId] = useState<number | null>(null)
  const [fmCurved, setFmCurved]   = useState(false)
  const [fmUnderlay, setFmUnderlay] = useState('')
  const [showCostLines, setShowCostLines] = useState(false)
  const [flW, setFlW]             = useState('')
  const [flH, setFlH]             = useState('')
  const [flQty, setFlQty]         = useState('1')
  const [flConstruction, setFlConstruction] = useState<'fixed' | 'swing' | 'sliding'>('swing')
  const [flDoors, setFlDoors]     = useState('2')
  const [flFixed, setFlFixed]     = useState('0')
  const [flRows, setFlRows]       = useState('3')
  const [flHandle, setFlHandle]   = useState<'corner' | 'push'>('corner')
  const [flSoftClose, setFlSoftClose] = useState(false)
  const [flTempering, setFlTempering] = useState(false)
  const [flGlassId, setFlGlassId] = useState<number | null>(null)
  // Стекло в лофте опционально: цех продаёт и голый каркас, а стекло тогда
  // считается отдельной позицией просчёта.
  const [flWithGlass, setFlWithGlass] = useState(true)
  const [flParsing, setFlParsing] = useState(false)
  const [flParseNote, setFlParseNote] = useState<string | null>(null)
  const [fThickness, setFThickness]   = useState<number | null>(null)
  const [fMatId, setFMatId]           = useState<number | null>(null)
  const [fWidth, setFWidth]           = useState('')
  const [fHeight, setFHeight]         = useState('')
  const [fQty, setFQty]               = useState('1')
  const [fWaste, setFWaste]           = useState(15)
  const [fTempering, setFTempering]   = useState(true)
  const [fFacet, setFFacet]           = useState(false)
  const [fFacetMm, setFFacetMm]       = useState<number>(10)
  const [fHoles, setFHoles]           = useState(false)
  const [fHoleGroups, setFHoleGroups] = useState<HoleGroup[]>([])
  const [fCurved, setFCurved]         = useState(false)
  const [fSandblast, setFSandblast]   = useState(false)
  const [fMinPrice, setFMinPrice]     = useState(true)
  // А19: распознавание файла клиента
  type ParsedItem = { id: string; width: number | null; height: number | null; quantity: number; label: string; comment: string; confidence: string; needsReview: boolean }
  const [parsed, setParsed] = useState<ParsedItem[]>([])
  const [parseBusy, setParseBusy] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [fTriplex, setFTriplex]       = useState(false)
  const [fTriplexLayers, setFTriplexLayers] = useState<2 | 3>(2)
  const [fTriplexMat2, setFTriplexMat2] = useState<number | null>(null)  // null = как основное
  const [fTriplexMat3, setFTriplexMat3] = useState<number | null>(null)
  const [fServiceIds, setFServiceIds] = useState<number[]>([])
  const [fComment, setFComment]       = useState('')
  const [facetPrices, setFacetPrices] = useState<FacetPrice[]>([])
  // материалы, привязанные к прайсу поставщика — для мягкого предупреждения в проверке спецификации
  const [pricedMaterials, setPricedMaterials] = useState<Set<string> | null>(null)
  const widthRef = useRef<HTMLInputElement>(null)
  const heightRef = useRef<HTMLInputElement>(null)
  const qtyRef = useRef<HTMLInputElement>(null)
  const [attachFile, setAttachFile]   = useState<File | null>(null)
  const attachInputRef = useRef<HTMLInputElement>(null)
  const [parsingDrawing, setParsingDrawing] = useState(false)
  const [drawingInfo, setDrawingInfo] = useState<{ added: number; skipped: number; holes: number; cutouts: number; shaped?: number; warnings: string[] } | null>(null)

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
  const [eHoles, setEHoles]           = useState(false)
  const [eHoleGroups, setEHoleGroups] = useState<HoleGroup[]>([])
  const [eCurved, setECurved]         = useState(false)
  const [eSandblast, setESandblast]   = useState(false)
  const [eMinPrice, setEMinPrice]     = useState(true)
  const [eTriplex, setETriplex]       = useState(false)
  const [eTriplexLayers, setETriplexLayers] = useState<2 | 3>(2)
  const [eTriplexMat2, setETriplexMat2] = useState<number | null>(null)
  const [eTriplexMat3, setETriplexMat3] = useState<number | null>(null)
  const [eServiceIds, setEServiceIds] = useState<number[]>([])

  // Авто-надбавки за габариты/сложность. Снятые вручную правила — в dismissed-сете.
  const [surchargeRules, setSurchargeRules] = useState<SurchargeRule[]>([])
  const [fDismissedSurcharges, setFDismissedSurcharges] = useState<Set<number>>(new Set())
  const [eDismissedSurcharges, setEDismissedSurcharges] = useState<Set<number>>(new Set())

  useEffect(() => {
    async function load() {
      try {
        const sb = createClient()

        // Auth + role check first — lightweight, before the heavy 8-query Promise.all.
        // getUser() иногда виснет (гонка token-refresh при многих открытых вкладках
        // приложения) — ограничиваем по времени и падаем на локальный getSession (без сети).
        const authRes = await Promise.race([
          sb.auth.getUser(),
          new Promise<null>(res => setTimeout(() => res(null), 6000)),
        ])
        let user = authRes?.data?.user ?? null
        if (!user) {
          const { data: { session } } = await sb.auth.getSession()
          user = session?.user ?? null
        }
        if (user?.email) setManagerEmail(user.email)
        if (user?.id) setManagerId(user.id)

        let userIsAdmin = false
        let userCanSeeAllClients = false
        let userManagerCode: number | null = null
        let userMGlassOnly = false
        if (user?.id) {
          const { data: profile } = await sb.from('users').select('role,name,manager_code,max_discount_percent,can_view_all_clients,permissions').eq('id', user.id).single()
          userIsAdmin = profile?.role === 'admin' || profile?.role === 'ceo'
          const perms = (profile?.permissions ?? null) as UserPermissions | null
          // owners are never scope-restricted, even if the JSON says so
          userMGlassOnly = !userIsAdmin && isMGlassOnlyUser(perms)
          // Buyers are normally blocked from the B2B calculator (procurement
          // doesn't sell). Exception: a buyer with an explicit b2b_client_scope
          // (mglass_only — locked to M GLASS; all_clients — quotes for everyone)
          // gets through. Без скоупа закупщик в калькулятор не пускается.
          if (profile?.role === 'buyer' && !hasB2BSalesScope(perms)) {
            setIsBuyer(true)
            return
          }
          userManagerCode = profile?.manager_code ?? null
          if (!userIsAdmin) setMaxDiscount(profile?.max_discount_percent ?? 5)
          userCanSeeAllClients = userIsAdmin || (profile?.can_view_all_clients === true) || isAllClientsScope(perms)
          setManagerName((profile?.name as string) || user.email || null)
        }
        setIsAdmin(userIsAdmin)
        setManagerCode(userManagerCode)
        setMglassOnly(userMGlassOnly)

        const [{ data: cls }, { data: mats }, { data: svcs }, { data: orders }, { data: glassMatrix }, { data: psData }, { data: filmsData }, { data: facetData }, { data: surchargeData }, { data: sheetVariants }] = await Promise.all([
          sb.from('b2b_clients').select('id,name,contact,phone,discount_percent,active,notes,created_at,manager_id,manager_code').eq('active', true).order('name'),
          sb.from('b2b_materials').select('*').eq('active', true).order('category').order('name'),
          sb.from('b2b_services').select('*').eq('active', true).order('sort_order').order('name'),
          sb.from('b2b_orders').select('client_id,total_after_discount').gte('created_at', '2026-01-01'),
          sb.from('glass_price_matrix').select('name,category,price_type,t4,t5,t6,t8,t10,waste_pct'),
          sb.from('production_settings').select('*').eq('id', 1).maybeSingle(),
          sb.from('b2b_films').select('*').eq('active', true).order('sort_order').order('name'),
          sb.from('facet_prices').select('*').eq('active', true).order('type_mm'),
          sb.from('b2b_surcharge_rules').select('*').eq('active', true).order('sort_order'),
          sb.from('b2b_material_sheet_variants').select('material_id, sheet_width, sheet_height, is_default, sort_order').eq('active', true).order('material_id').order('is_default', { ascending: false }).order('sort_order'),
        ])
        // Форматы листов по материалу (для раскроя): дефолт первым.
        const formatsByMat = new Map<number, { width: number; height: number }[]>()
        for (const v of (sheetVariants ?? []) as { material_id: number; sheet_width: number; sheet_height: number }[]) {
          if (!(v.sheet_width > 0) || !(v.sheet_height > 0)) continue
          const arr = formatsByMat.get(v.material_id) ?? []
          arr.push({ width: v.sheet_width, height: v.sheet_height })
          formatsByMat.set(v.material_id, arr)
        }
        if (psData) setProdSettings(psData as ProductionSettings)
        setFilms((filmsData ?? []) as B2BFilm[])
        setFacetPrices((facetData ?? []) as FacetPrice[])
        setSurchargeRules((surchargeData ?? []) as SurchargeRule[])

        const totals = new Map<number, number>()
        for (const o of orders ?? []) {
          totals.set(o.client_id, (totals.get(o.client_id) ?? 0) + o.total_after_discount)
        }
        // Non-admin managers without can_view_all_clients see only their own clients.
        // mglass_only managers see only the M GLASS client (and only that one is selectable).
        const allClients = (cls ?? []) as B2BClient[]
        let visibleClients: B2BClient[]
        if (userMGlassOnly) {
          visibleClients = allClients.filter(c => isMGlassClient(c))
        } else if (userCanSeeAllClients) {
          visibleClients = allClients
        } else {
          visibleClients = allClients.filter(c => c.manager_id === user?.id)
        }
        const sorted = visibleClients.slice().sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0))
        setClients(sorted)
        // For mglass_only users, pre-select the M GLASS client so the calculator opens ready.
        if (userMGlassOnly && sorted.length > 0) setClientId(sorted[0].id)

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
          const fmts = formatsByMat.get(m.id)
          return {
            ...base,
            ...(matrixPrice != null && matrixPrice > 0 ? { sale_price: matrixPrice } : {}),
            // Справочник — первоисточник: его waste_pct всегда победает, passthrough снимается
            ...(matrixWaste != null && matrixWaste > 0 ? { waste_percent: matrixWaste, passthrough: false } : {}),
            ...(fmts && fmts.length ? { sheet_formats: fmts } : {}),
          }
        })
        // Дедуп: одна запись на (name|category|thickness). Защита от дублей в
        // выпадающем списке, если в справочнике случайно оказались два материала
        // с одинаковым именем/толщиной. Приоритет — с продажной ценой.
        const dedup = new Map<string, (typeof parsed)[number]>()
        for (const m of parsed) {
          const k = `${m.name}|${m.category}|${m.thickness}`
          const prev = dedup.get(k)
          if (!prev || (m.sale_price ?? 0) > (prev.sale_price ?? 0)) dedup.set(k, m)
        }
        const deduped = [...dedup.values()]
        setMaterials(deduped)
        setServices(svcs ?? [])
        if (deduped.length > 0) {
          const sc = SUPER_CATS[0]
          setFSuperCat(sc.value)
          const superMats = deduped.filter(m => (sc.cats as readonly string[]).includes(m.category))
          const mat = pickDefault(superMats, sc.value)
          if (mat) { setFThickness(mat.thickness); setFMatId(mat.id); setFWaste(mat.waste_percent) }
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Ошибка загрузки данных')
      } finally {
        setLoading(false)
      }
    }
    // Страховочный таймаут: если что-то в load() зависло (сетевой вызов без
    // рекавери) — не крутим «Загрузка…» вечно, а показываем ошибку с «Повторить».
    let finished = false
    load().catch(() => setLoading(false)).finally(() => { finished = true })
    const guard = setTimeout(() => {
      if (finished) return
      setLoadError('Не удалось загрузить данные — превышено время ожидания. Проверьте связь и нажмите «Повторить». Если повторяется — закройте лишние вкладки приложения или перезайдите в аккаунт.')
      setLoading(false)
    }, 12000)
    return () => clearTimeout(guard)
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
        const { data } = await sb.from('b2b_orders').select('client_id,items,custom_number,client_order_number,notes').eq('id', orderIdParam).single()
        if (data) {
          setEditingOrderId(Number(orderIdParam))
          if (data.client_id) setClientId(data.client_id)
          const loadedItems = (Array.isArray(data.items) ? data.items : []) as B2BOrderItem[]
          setItems(loadedItems.map(i => ({ ...i, localId: (i as B2BOrderItem & { localId?: string }).localId || crypto.randomUUID() })))
          if (data.custom_number) setOurOrderNumber(data.custom_number)
          if (data.client_order_number) setClientOrderNumber(data.client_order_number)
          const on = typeof data.notes === 'string'
            ? (() => { try { return JSON.parse(data.notes) } catch { return {} } })()
            : (data.notes ?? {})
          editOrigNotesRef.current = on
          if (typeof on.production_days === 'number') setFProductionDays(on.production_days)
          if (typeof on.user_notes === 'string') setNotes(on.user_notes)
        }
      })()
      return
    }
    if (clientIdParam) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setClientId(Number(clientIdParam))
    }
    if (!draftRestoredRef.current) {
      draftRestoredRef.current = true
      // (mglass_only override happens in a separate effect below)
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

  // Defence in depth: if mglass_only and someone (URL param, loaded order,
  // restored draft) sets clientId to a non-M-GLASS client, snap it back.
  useEffect(() => {
    if (!mglassOnly || clients.length === 0) return
    const current = clients.find(c => c.id === clientId)
    if (current && isMGlassClient(current)) return
    const mg = clients.find(c => isMGlassClient(c))
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (mg) setClientId(mg.id)
  }, [mglassOnly, clientId, clients])

  // А12: прайс клиента подтягиваем при смене клиента. Уже набранные позиции
  // пересчитываем — иначе цена зависела бы от того, в каком порядке менеджер
  // выбрал клиента и добавил стекло.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const sb = createClient()
      const map = await loadClientPrices(sb, clientId)
      if (cancelled) return
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setClientPrices(map)
    })()
    return () => { cancelled = true }
  }, [clientId])

  useEffect(() => {
    if (items.length === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(prev => prev.map(i => recomputeItem(i, null)))
  // Пересчёт только при смене прайса клиента: зависимость от items зациклила бы эффект.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientPrices])

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
  // Триплекс не показываем в списке доп-услуг — он ставится отдельной кнопкой
  // сверху. Но сам per_m2-ряд остаётся активным как источник цены триплексации
  // (см. triplexPrice), поэтому прячем его только из рендера списка.
  const visibleServices = services.filter(s => !(s.type === 'per_m2' && /триплекс/i.test(s.name)))

  function handleMaterialChange(id: number) {
    const mat = materials.find(m => m.id === id)
    setFMatId(id)
    if (mat) setFWaste(mat.passthrough ? 10 : mat.waste_percent)
  }

  function toggleService(id: number) {
    setFServiceIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  // Цена триплексации из справочника услуг (per_m2 «Триплекс»): продажа = value, себестоимость = cost_price.
  const triplexPrice = useMemo(() => {
    const s = services.find(s => s.type === 'per_m2' && /триплекс/i.test(s.name))
    return s ? { salePerM2: s.value, costPerM2: s.cost_price ?? 0 } : null
  }, [services])

  // Привязки материалов к прайсу поставщика — только для предупреждения «цена не обновится».
  // Ошибку глотаем: без привязок проверка спецификации просто не покажет этот мягкий пункт.
  useEffect(() => {
    let alive = true
    fetch('/api/admin/glass-price-mappings')
      .then(r => r.ok ? r.json() : null)
      .then((d: { mappings?: { matrix_name: string; matrix_category: string; enabled: boolean }[] } | null) => {
        if (!alive || !d?.mappings) return
        setPricedMaterials(new Set(d.mappings.filter(m => m.enabled).map(m => `${m.matrix_name.trim()}|${m.matrix_category}`)))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // Проверка спецификации: где позиция не сходится со справочником — там себестоимость
  // считается от нуля, и изделие может уйти клиенту дешевле, чем обошлось нам.
  const bomIssues = useMemo(() => {
    if (items.length === 0) return []
    // Изделия производства (зеркало с подсветкой, лофт) в справочник листовых
    // материалов не входят: у них materialId = 0, а себестоимость собственная —
    // полная стоимость изделия из цеха. Раньше они не находились в baseMaterials
    // и попадали в ветку fallback с жёстко проставленным active: false — то есть
    // КАЖДОЕ изделие производства получало «материал выключен в справочнике» и
    // «не привязан к прайсу поставщика», хотя с ним всё в порядке. Предупреждение,
    // которое срабатывает всегда, перестают читать — и оно не сработает тогда,
    // когда себестоимость действительно нулевая.
    // Индексы исходных позиций: сообщение печатает «Поз. N», и после отсева
    // изделий нумерация обязана остаться той, что видит менеджер в списке.
    const sourceIdx: number[] = []
    const bomItems: BomCheckItem[] = items.flatMap((it, i) => {
      if (!(it.materialId > 0)) return []
      sourceIdx.push(i)
      const mat = baseMaterials.find(m => m.id === it.materialId)
      return [{
        material: mat
          ? { name: mat.name, category: mat.category, thickness: mat.thickness, cost_price: mat.cost_price, active: mat.active }
          : { name: it.materialName, category: it.category, thickness: it.thickness, cost_price: it.costMaterial > 0 ? it.costMaterial : 0, active: false },
        hasTempering: it.hasTempering,
        hasFacet: it.hasFacet,
        facetTypeMm: it.facetTypeMm,
        hasTriplex: it.hasTriplex ?? false,
        triplexPrice: it.hasTriplex ? { salePerM2: it.saleTriplex ?? 0, costPerM2: it.costTriplex ?? 0 } : null,
        services: it.services.map(s => ({ name: s.name, type: s.type, value: s.value, cost_price: s.costPrice })),
      }]
    })
    const issues = checkQuoteBom(bomItems, { facetPrices, ...(pricedMaterials ? { pricedMaterials } : {}) })
    return issues.map(iss => ({ ...iss, itemIndex: sourceIdx[iss.itemIndex] ?? iss.itemIndex }))
  }, [items, baseMaterials, facetPrices, pricedMaterials])

  const bomSummary = useMemo(() => summarizeIssues(bomIssues), [bomIssues])

  // Переключение на изделие производства: лениво грузим розничные справочники + финмодель.
  async function switchKind(kind: 'material' | 'fmirror' | 'floft') {
    setFKind(kind)
    if (kind === 'material' || factoryData || factoryLoading) return
    setFactoryLoading(true)
    try {
      const data = await loadFactoryData(createClient())
      setFactoryData(data)
      if (data.mirrorNames.length) {
        setFmName(data.mirrorNames[0])
        const mms = mirrorMms(data, data.mirrorNames[0])
        if (mms.length) setFmMm(mms[0])
      }
      if (data.loftGlasses.length) setFlGlassId(data.loftGlasses[0].id)
    } finally { setFactoryLoading(false) }
  }

  // Живой расчёт изделия: себестоимость производства + продажная цена производства.
  const factoryQuote = (() => {
    if (!factoryData) return null
    if (fKind === 'fmirror') {
      return calcFactoryMirror({
        widthMm: Number(fmW) || 0, heightMm: Number(fmH) || 0,
        mirrorName: fmName, mirrorMm: fmMm, hasLighting: fmLighting, buttonType: fmButton,
        ledId: fmLedId, frameId: fmFrameId, curved: fmCurved,
        underlayCost: Number(fmUnderlay) || 0, metalFrame: fmFrame,
        lightSides: fmSides,
        sandblast: fmSandblast,
        facetTypeMm: fmFacetMm,
        facetCostPerM: (() => {
          const f = facetPrices.find(x => x.type_mm === fmFacetMm && x.active !== false)
          return f ? Number(f.cost_price) + Number(f.transport_cost ?? 0) : 0
        })(),
      }, factoryData)
    }
    if (fKind === 'floft') {
      return calcFactoryLoft({
        widthMm: Number(flW) || 0, heightMm: Number(flH) || 0,
        construction: flConstruction,
        doors: Number(flDoors) || 0, fixedParts: Number(flFixed) || 0,
        rows: Number(flRows) || 1,
        handle: flHandle, softClose: flSoftClose,
        glassId: flGlassId, tempering: flTempering, withGlass: flWithGlass,
      }, factoryData)
    }
    return null
  })()

  // Чертёж лофта (PDF/фото) → AI снимает проём, тип конструкции, створки, стёкла.
  // Разбор чертежа под активный тип позиции:
  // стекло/зеркало — КАЖДАЯ деталь отдельной позицией (на чертеже их может быть много);
  // зеркало+свет и лофт — один проём/изделие в поля формы (комплектация выбирается вручную).
  async function parseItemDrawing(file: File) {
    setFlParsing(true); setFlParseNote(null)
    try {
      // Стекло / зеркало → многодетальный разбор, добавляем все позиции.
      if (fKind === 'material') {
        const r = await parseDrawingMulti(file)
        if (r.added > 0) {
          const extra = [r.holes ? `отв: ${r.holes}` : '', r.cutouts ? `вырезы: ${r.cutouts}` : '', r.skipped ? `пропущено: ${r.skipped}` : '']
            .filter(Boolean).join(', ')
          setFlParseNote(`✓ добавлено позиций: ${r.added}${extra ? ` (${extra})` : ''}`)
        } else {
          setFlParseNote(r.warnings[0] || 'детали не распознаны — введи вручную')
        }
        return
      }

      // Зеркало+свет / лофт → один разбор в поля.
      const readB64 = (f: Blob) => new Promise<string>((res, rej) => {
        const rd = new FileReader()
        rd.onload = () => res(String(rd.result).split(',')[1] || '')
        rd.onerror = rej
        rd.readAsDataURL(f)
      })
      const base = file.type === 'application/pdf'
        ? { pdf: await readB64(file) }
        : { image: await readB64(file), image_type: file.type }
      const r = await fetch('/api/ai/parse-item-drawing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, kind: fKind }),
      }).then(x => x.json())
      const d = r.drawing
      if (!d) { setFlParseNote('не распознал — введи вручную'); return }
      if (fKind === 'floft') {
        if (d.width_mm) setFlW(String(d.width_mm))
        if (d.height_mm) setFlH(String(d.height_mm))
        if (d.construction === 'fixed' || d.construction === 'swing' || d.construction === 'sliding') setFlConstruction(d.construction)
        if (d.doors != null) setFlDoors(String(d.doors))
        if (d.fixed_parts != null) setFlFixed(String(d.fixed_parts))
        if (d.rows != null) setFlRows(String(d.rows))
        if (d.tempering != null) setFlTempering(!!d.tempering)
      } else {
        // fmirror — зеркало+свет
        if (d.width_mm) setFmW(String(d.width_mm))
        if (d.height_mm) setFmH(String(d.height_mm))
        if (d.quantity) setFmQty(String(d.quantity))
      }
      setFlParseNote(`✓ снял: ${d.width_mm}×${d.height_mm}${d.note ? ` · ${String(d.note).slice(0, 80)}` : ''}`)
    } catch { setFlParseNote('ошибка чтения файла') } finally { setFlParsing(false) }
  }

  function handleAddFactoryItem() {
    if (!factoryQuote) return
    // Без габаритов изделие молча выпадает из раскроя, загрузки станций и
    // потребности в материале, а в КП уходит «0 × 0» — не пускаем (как в
    // handleAddItem для листовых материалов).
    if (!(factoryQuote.widthMm > 0) || !(factoryQuote.heightMm > 0)) return
    const qty = Number(fKind === 'fmirror' ? fmQty : flQty) || 1
    const item = factoryQuoteToItem(factoryQuote, qty, fComment || undefined)
    setItems(prev => [...prev, { ...item, localId: crypto.randomUUID() }])
    setFComment('')
    if (fKind === 'fmirror') { setFmW(''); setFmH(''); setFmQty('1') }
    else { setFlW(''); setFlH(''); setFlQty('1') }
    setSavedOrderId(null)
  }

  // Доп. слои пакета триплекса (слой 2, слой 3): выбранный материал или основной.
  function triplexExtras(main: B2BMaterial | null, layers: 2 | 3, mat2: number | null, mat3: number | null): B2BMaterial[] {
    if (!main) return []
    const g2 = materials.find(m => m.id === mat2) ?? main
    if (layers === 2) return [g2]
    const g3 = materials.find(m => m.id === mat3) ?? main
    return [g2, g3]
  }

  // А19: разбор файла клиента (PDF/фото чертежа) в позиции. Движок разбора уже был
  // (/api/b2b/parse-pdf), но его никто не вызывал из интерфейса. Модель только
  // распознаёт размеры — цену считает калькулятор, как и для ручного ввода.
  async function parseClientFile(file: File) {
    setParseBusy(true); setParseError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('/api/b2b/parse-pdf', { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setParseError(j.error || 'Не удалось разобрать файл'); return }
      const items = (j.items ?? []) as ParsedItem[]
      if (items.length === 0) { setParseError('В файле не нашлось размеров'); return }
      setParsed(items.filter(i => i.width && i.height))
    } catch {
      setParseError('Ошибка сети при разборе файла')
    } finally { setParseBusy(false) }
  }

  // Добавляем распознанное текущим материалом и текущими настройками позиции —
  // размеры от модели, всё остальное решает менеджер.
  function addParsedItems() {
    if (!selectedMaterial || parsed.length === 0) return
    const added = parsed.map(p => {
      const calc = computeQuoteItem({
        material: selectedMaterial,
        width: Number(p.width) || 0, height: Number(p.height) || 0,
        quantity: Math.max(1, Number(p.quantity) || 1),
        wastePercent: fWaste, hasTempering: fTempering,
        resolvedServices: resolveSvcs(selectedServices, fTierSel, fFilmSel),
        hasFacet: fFacet, facetTypeMm: fFacet ? fFacetMm : null,
        // Признаки изделия -> маршрут цеха. Раньше здесь было зашито shape: 'rect',
        // и криволинейное зеркало уходило в цех как прямое — без этапа криволинейки.
        hasHoles: false,
        shape: fKind === 'fmirror' && fmCurved ? 'curved' : 'rect',
        hasSandblast: fKind === 'fmirror' && fmSandblast,
        hasTriplex: false, triplexLayers: 2, triplexPrice, triplexExtraGlasses: [],
        applyMinPrice: fMinPrice,
        comment: [p.label, p.comment, p.needsReview ? 'проверить размер' : ''].filter(Boolean).join(' · ') || undefined,
        dismissedSurcharges: new Set<number>(),
      }, { facetPrices, surchargeRules })
      return { ...calc, localId: crypto.randomUUID() }
    })
    setItems(prev => [...prev, ...added])
    setParsed([])
  }

  function handleAddItem() {
    if (!selectedMaterial) return
    const w = Number(fWidth) || 0
    const h = Number(fHeight) || 0
    const q = Number(fQty) || 1
    if (w <= 0 || h <= 0) return

    const calc = computeQuoteItem({
      material: selectedMaterial, width: w, height: h, quantity: q,
      wastePercent: fWaste, hasTempering: fTempering,
      resolvedServices: resolveSvcs(selectedServices, fTierSel, fFilmSel),
      hasFacet: fFacet, facetTypeMm: fFacet ? fFacetMm : null,
      hasHoles: fHoles, holes: fHoles ? normalizeHoles(fHoleGroups) : [], shape: fCurved ? 'curved' : 'rect', hasSandblast: fSandblast,
      hasTriplex: fTriplex, triplexLayers: fTriplexLayers, triplexPrice,
      triplexExtraGlasses: fTriplex ? triplexExtras(selectedMaterial, fTriplexLayers, fTriplexMat2, fTriplexMat3) : [],
      applyMinPrice: fMinPrice, comment: fComment || undefined,
      dismissedSurcharges: fDismissedSurcharges,
    }, { facetPrices, surchargeRules })
    setItems(prev => [...prev, { ...calc, localId: crypto.randomUUID() }])
    setFWidth('')
    setFHeight('')
    setFQty('1')
    setFComment('')
    setFHoles(false)
    setFCurved(false)
    setFMinPrice(true)
    setFTriplex(false)
    setFTriplexMat2(null)
    setFTriplexMat3(null)
    setFDismissedSurcharges(new Set())
    setSavedOrderId(null)   // изменили состав — можно снова сохранить
    widthRef.current?.focus()
  }

  // Многодетальный разбор чертежа (PDF/фото) → добавляет КАЖДУЮ деталь позицией.
  // Для стекла/зеркала: на одном чертеже может быть несколько стёкол → все в список.
  async function parseDrawingMulti(file: File): Promise<{ added: number; skipped: number; holes: number; cutouts: number; shaped: number; warnings: string[] }> {
    const empty = { added: 0, skipped: 0, holes: 0, cutouts: 0, shaped: 0, warnings: [] as string[] }
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/ai/parse-drawing', { method: 'POST', body: fd })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.parsed) return { ...empty, warnings: [json.detail || json.error || 'Не удалось распознать файл'] }
    const p = json.parsed as { is_drawing?: boolean; items?: ParsedDrawingItem[]; warnings?: string[] }
    const warnings = [...(p.warnings ?? [])]
    if (p.is_drawing === false || !(p.items ?? []).length) {
      return { ...empty, warnings: warnings.length ? warnings : ['Файл не распознан как чертёж деталей с размерами.'] }
    }
    const newItems: B2BOrderItem[] = []
    let holes = 0, cutouts = 0, skipped = 0, shaped = 0
    for (const it of (p.items ?? [])) {
      const w = Number(it.width_mm) || 0
      const h = Number(it.height_mm) || 0
      if (w <= 0 || h <= 0) { skipped++; warnings.push(`«${it.label ?? 'деталь'}»: размер не распознан — добавьте вручную`); continue }
      const drawTh = Number(it.thickness_mm) || 0
      const ocrMat = (it.material && it.material.trim()) ? it.material.trim() : ''
      const th = drawTh > 0 ? drawTh : (selectedMaterial?.thickness || Number(fThickness) || 8)
      let mat: B2BMaterial | null
      if (ocrMat) {
        // Чертёж ЯВНО назвал материал (напр. «сатин», «бронза») — матчим по нему.
        mat = matchDrawingMaterial(materials, th, ocrMat, it.is_mirror) ?? selectedMaterial
      } else if (selectedMaterial) {
        // Материал на чертеже не указан → берём ВЫБРАННЫЙ менеджером в форме (а не
        // угадываем «Прозрачное М1»). Если чертёж дал другую толщину и есть строка
        // того же материала на этой толщине — берём её, иначе выбранный как есть.
        mat = (drawTh > 0 && drawTh !== selectedMaterial.thickness
          ? materials.find(m => m.name === selectedMaterial.name && m.thickness === drawTh)
          : null) ?? selectedMaterial
      } else {
        mat = matchDrawingMaterial(materials, th, '', it.is_mirror)
      }
      if (!mat) { skipped++; warnings.push(`«${it.label ?? 'деталь'}»: материал не найден — добавьте вручную`); continue }
      const cutW = Math.max(w, Number(it.cut_width_mm) || 0)
      const cutH = Math.max(h, Number(it.cut_height_mm) || 0)
      const isShaped = (!!it.shape && it.shape !== 'rectangle') || cutW > w + 1 || cutH > h + 1
      if (isShaped) shaped++
      const q = Math.max(1, Number(it.quantity) || 1)
      const temp = !!it.tempering
      const waste = mat.passthrough ? 10 : mat.waste_percent
      const calc = calcItem(mat, cutW, cutH, q, waste, temp, resolveSvcs([], fTierSel, fFilmSel), false, null, facetPrices)
      const hh = Number(it.holes) || 0
      const cc = Number(it.cutouts) || 0
      holes += hh * q
      cutouts += cc * q
      const shapeNote = isShaped ? `${it.shape ?? 'скошенная'}, готовая ${w}×${h}` : ''
      const cparts = [it.label, shapeNote, it.notes, hh ? `отв: ${hh}` : '', cc ? `вырезы: ${cc}` : ''].filter(Boolean)
      newItems.push({ ...calc, localId: crypto.randomUUID(), comment: cparts.join(' · ') || undefined, hasHoles: hh > 0, shape: 'rect' })
    }
    if (newItems.length) { setItems(prev => [...prev, ...newItems]); setSavedOrderId(null) }
    return { added: newItems.length, skipped, holes, cutouts, shaped, warnings }
  }

  // Нижняя кнопка «Чертёж / файл клиента» — многодетальный разбор с полным отчётом.
  async function parseDrawing() {
    if (!attachFile) return
    setParsingDrawing(true)
    setDrawingInfo(null)
    try {
      const r = await parseDrawingMulti(attachFile)
      setDrawingInfo({ added: r.added, skipped: r.skipped, holes: r.holes, cutouts: r.cutouts, shaped: r.shaped, warnings: r.warnings })
    } catch (e) {
      setDrawingInfo({ added: 0, skipped: 0, holes: 0, cutouts: 0, warnings: ['Ошибка: ' + (e instanceof Error ? e.message : String(e))] })
    } finally {
      setParsingDrawing(false)
    }
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
    setSelIds(prev => { if (!prev.has(localId)) return prev; const n = new Set(prev); n.delete(localId); return n })
    setSavedOrderId(null)
  }

  function copyItem(localId: string) {
    setItems(prev => {
      const item = prev.find(i => i.localId === localId)
      if (!item) return prev
      return [...prev, { ...item, localId: crypto.randomUUID() }]
    })
    setSavedOrderId(null)
  }

  // ── Мультивыбор + массовая смена материала ──────────────────────────────────
  // Один список, сгруппированный по толщине (<optgroup>), а не два селекта:
  // требовать выбрать толщину прежде материала — лишний шаг, из-за которого
  // функция выглядела отсутствующей. Группы сохраняют навигацию по длинному
  // списку, но не заставляют отвечать на вопрос про толщину заранее.
  const bulkMaterialGroups = useMemo(
    () => [...new Set(materials.map(m => m.thickness))]
      .sort((a, b) => a - b)
      .map(thickness => ({ thickness, materials: sortByPriority(materials.filter(m => m.thickness === thickness)) }))
      .filter(g => g.materials.length > 0),
    [materials])

  function toggleSel(localId: string) {
    setSelIds(prev => {
      const next = new Set(prev)
      if (next.has(localId)) next.delete(localId); else next.add(localId)
      return next
    })
  }
  function toggleSelAll() {
    setSelIds(prev => prev.size === items.length ? new Set() : new Set(items.map(i => i.localId)))
  }
  function clearSel() { setSelIds(new Set()) }

  // Пересчёт позиции под новый материал — сохраняем геометрию, кол-во, услуги, флаги.
  // Пересчёт позиции: под новый материал (mat) и/или с оверрайдами флагов
  // (закалка). Геометрия, кол-во, услуги, фацет, триплекс, договорная цена — как у
  // исходной позиции. mat=null → берём текущий материал позиции (для смены только флага).
  function recomputeItem(item: B2BOrderItem, mat: B2BMaterial | null, over?: { hasTempering?: boolean }): B2BOrderItem {
    const m = mat ?? materials.find(x => x.id === item.materialId)
    if (!m) return item
    const layers = item.triplexLayers === 3 ? 3 : 2
    // Услуги позиции хранятся резолвнутыми (ItemService) — восстанавливаем исходные
    // B2BService из справочника по id, чтобы пересчитать.
    const svcIds = new Set(item.services.filter(s => s.id > 0).map(s => s.id))
    const rawSvcs = services.filter(s => svcIds.has(s.id))
    const calc = computeQuoteItem({
      material: m, width: item.width, height: item.height, quantity: item.quantity,
      wastePercent: m.passthrough ? 10 : m.waste_percent, hasTempering: over?.hasTempering ?? item.hasTempering,
      resolvedServices: resolveSvcs(rawSvcs, fTierSel, fFilmSel),
      hasFacet: item.hasFacet ?? false, facetTypeMm: item.hasFacet ? (item.facetTypeMm ?? 10) : null,
      hasHoles: item.hasHoles ?? false, shape: item.shape === 'curved' ? 'curved' : 'rect',
      hasTriplex: item.hasTriplex ?? false, triplexLayers: layers, triplexPrice,
      triplexExtraGlasses: item.hasTriplex
        ? triplexExtras(m, layers, item.triplexGlasses?.[0]?.materialId ?? null, item.triplexGlasses?.[1]?.materialId ?? null)
        : [],
      applyMinPrice: item.applyMinPrice !== false, comment: item.comment || undefined,
      dismissedSurcharges: new Set<number>(),
    }, { facetPrices, surchargeRules })
    return { ...calc, localId: item.localId, manualTotal: item.manualTotal ?? null }
  }

  function applyBulkMaterial() {
    const mat = materials.find(m => m.id === bulkMatId)
    if (!mat || selIds.size === 0) return
    setItems(prev => prev.map(i => selIds.has(i.localId) ? recomputeItem(i, mat) : i))
    setSavedOrderId(null)
    // Селекцию НЕ сбрасываем — владелец правит выбранные итеративно (как с количеством).
  }
  // Массовое переключение закалки у выбранных (зеркало закалку не поддерживает — пропускаем).
  function applyBulkTempering(on: boolean) {
    if (selIds.size === 0) return
    setItems(prev => prev.map(i =>
      selIds.has(i.localId) && i.category !== 'зеркало' && i.category !== 'изделие'
        ? recomputeItem(i, null, { hasTempering: on })
        : i))
    setSavedOrderId(null)
  }
  function bulkDelete() {
    if (selIds.size === 0) return
    setItems(prev => prev.filter(i => !selIds.has(i.localId)))
    setSavedOrderId(null)
    clearSel()
  }

  // Массовая правка количества у выбранных. Пересчёт — через тот же recomputeItem,
  // что и смена материала: вторую ветку пересчёта не заводим. Количество не может
  // стать 0 или отрицательным (иначе позиция молча выпадет из раскроя и уедет в КП
  // как «0 шт»), поэтому всегда clamp'им к минимуму 1.
  function applyBulkQty() {
    const n = Math.floor(Number(bulkQty))
    if (selIds.size === 0 || !Number.isFinite(n) || n < 1) return
    setItems(prev => prev.map(i => selIds.has(i.localId) ? recomputeItem({ ...i, quantity: n }, null) : i))
    setSavedOrderId(null)
  }
  // Относительная правка (+1 / −1): у позиций количества разные, обнулять нельзя —
  // сдвигаем от текущего, не ниже 1.
  function bumpBulkQty(delta: number) {
    if (selIds.size === 0) return
    setItems(prev => prev.map(i =>
      selIds.has(i.localId)
        ? recomputeItem({ ...i, quantity: Math.max(1, (Number(i.quantity) || 1) + delta) }, null)
        : i))
    setSavedOrderId(null)
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
    setEMinPrice(item.applyMinPrice !== false)
    setEFacet(item.hasFacet ?? false)
    setEFacetMm(item.facetTypeMm ?? 10)
    setEHoles(item.hasHoles ?? false)
    setEHoleGroups(normalizeHoles(item.holes))
    setESandblast(item.hasSandblast ?? false)
    setECurved(item.shape === 'curved')
    setETriplex(item.hasTriplex ?? false)
    setETriplexLayers(item.triplexLayers === 3 ? 3 : 2)
    setETriplexMat2(item.triplexGlasses?.[0]?.materialId ?? null)
    setETriplexMat3(item.triplexGlasses?.[1]?.materialId ?? null)
    // Только реальные услуги (id > 0). Надбавки (синтетические отрицательные id)
    // не чекбоксы — они пересчитываются заново от габаритов при сохранении.
    setEServiceIds(item.services.filter(s => s.id > 0).map(s => s.id))
    setEDismissedSurcharges(new Set())
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
    const calc = computeQuoteItem({
      material: mat, width: w, height: h, quantity: q,
      wastePercent: eWaste, hasTempering: eTempering,
      resolvedServices: resolveSvcs(svcs, eTierSel, eFilmSel),
      hasFacet: eFacet, facetTypeMm: eFacet ? eFacetMm : null,
      hasHoles: eHoles, holes: eHoles ? normalizeHoles(eHoleGroups) : [], shape: eCurved ? 'curved' : 'rect', hasSandblast: eSandblast,
      hasTriplex: eTriplex, triplexLayers: eTriplexLayers, triplexPrice,
      triplexExtraGlasses: eTriplex ? triplexExtras(mat, eTriplexLayers, eTriplexMat2, eTriplexMat3) : [],
      applyMinPrice: eMinPrice, comment: eComment || undefined,
      dismissedSurcharges: eDismissedSurcharges,
    }, { facetPrices, surchargeRules })
    setItems(prev => prev.map(i => i.localId === editingLocalId
      ? { ...calc, localId: editingLocalId }
      : i))
    setEditingLocalId(null)
    setSavedOrderId(null)
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

  // Себестоимость и маржа — по АВТОМАТИЧЕСКОМУ расходу из раскроя, а не по
  // ручному проценту. Пересчитывается на каждое изменение состава заказа (расход
  // одного материала зависит от всех его деталей). Цена клиента не меняется.
  const itemsAuto = useMemo(() => applyAutoWasteToItems(items, materials), [items, materials])

  const totals: B2BOrderTotals | null = useMemo(() => {
    if (itemsAuto.length === 0) return null
    return calcTotals(itemsAuto, discount)
  }, [itemsAuto, discount])

  const totalMinPriceDelta = useMemo(
    () => items.reduce((s, i) => s + (i.minPriceDelta ?? 0), 0),
    [items],
  )

  const totalMinLinePrice = useMemo(
    () => items.reduce((sum, i) => sum + Number(i.minLinePrice ?? 0), 0),
    [items],
  )

  const totalAfterDiscountWouldBreakMin = useMemo(
    () => totalMinLinePrice > 0 && !!totals && totals.totalAfterDiscount < totalMinLinePrice,
    [totalMinLinePrice, totals],
  )

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
          sheetWidth:  mat?.sheet_width  ?? 3210,
          sheetHeight: mat?.sheet_height ?? 2250,
          sheetFormats: mat?.sheet_formats,
          patternDirection: (mat?.pattern_direction ?? 'none') as 'none' | 'along_length' | 'along_width',
        })
      }
      const g = groups.get(key)!
      for (let i = 0; i < qty; i++) {
        g.pieces.push({ id: `item-${item.materialId}-${i}`, width: item.width, height: item.height, label: `${item.width}×${item.height}`, orderId: 0, orderClientName: '', materialKey: key, canRotate: true })
      }
    }
    const optimal = runCuttingOptimizer(groups, DEFAULT_CUTTING_SETTINGS)
    // База для сравнения: тот же раскрой на ОДНОМ дефолтном формате (как было до
    // выбора формата). Экономия = насколько выбор оптимального формата уменьшил
    // число листов. Считаем только если у материала есть >1 формата.
    const baseGroups = new Map([...groups].map(([k, g]) => [k, { ...g, sheetFormats: undefined }]))
    const baseByKey = new Map(runCuttingOptimizer(baseGroups, DEFAULT_CUTTING_SETTINGS).map(r => [r.materialKey, r]))
    return optimal.map(r => {
      const b = baseByKey.get(r.materialKey)
      const multiFormat = (groups.get(r.materialKey)?.sheetFormats?.length ?? 0) > 1
      const chosenNonDefault = !!b && (b.sheetWidth !== r.sheetWidth || b.sheetHeight !== r.sheetHeight)
      const savedSheets = b ? Math.max(0, b.sheetsNeeded - r.sheetsNeeded) : 0
      // Сверка со складом: остаток листов материала и сколько докупить (как на /b2b-cutting).
      const [nm, th] = r.materialKey.split('|')
      const stockSheets = Math.max(0, Math.round(Number(matLookup.get(`${nm}|${th}`)?.stock_sheets ?? 0)))
      const toBuy = Math.max(0, r.sheetsNeeded - stockSheets)
      return { ...r, baseSheetWidth: b?.sheetWidth, baseSheetHeight: b?.sheetHeight, multiFormat, chosenNonDefault, savedSheets, stockSheets, toBuy }
    })
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
      const price = effectiveItemTotal(item, discount)
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
    // Scope guard: mglass_only managers cannot create quotes for any other client.
    // Owners/admins/ceo are never scope-restricted (see load() above).
    if (mglassOnly && !isMGlassClient(selectedClient)) {
      setSaveError(MGLASS_SCOPE_ERROR)
      return
    }
    setSaving(true)
    setSaveError(null)
    setSavedAsPending(false)
    const sb = createClient()
    const t = totals!
    // Маржа заказа — взвешенная по выручке и с учётом скидки/договорных цен, а не
    // простое среднее по позициям: крупная низкомаржинальная позиция должна тянуть
    // общую маржу вниз сильнее мелкой. Из margin_percent её читают крон-аномалии,
    // /commercial/money и AI — среднее по позициям врало (мелкая дорогая маскировала
    // крупную дешёвую, скидка вообще не учитывалась). Считаем как реальную:
    // (выручка_безНДС_после_скидки − себестоимость_безНДС) / выручка_безНДС.
    const revExVatAfter = itemsAuto.reduce((s, i) => s + effectiveItemTotal(i, discount) * 100 / (100 + VAT), 0)
    const costExVatSum  = itemsAuto.reduce((s, i) => s + i.costExVat, 0)
    const avgMargin = revExVatAfter > 0 ? Math.round((1 - costExVatSum / revExVatAfter) * 100) : 0
    const authorName = managerName ?? managerEmail ?? null
    const editing = editingOrderId != null
    const baseNotes = editing ? { ...editOrigNotesRef.current } : {}
    const orderNotes = JSON.stringify({
      ...baseNotes,   // при редактировании сохраняем status/status_history/payment_status/launched_at и т.д.
      status: editing ? (baseNotes.status === 'pending_approval' ? 'quote' : (baseNotes.status ?? 'quote')) : 'quote',
      quote_date: editing ? (baseNotes.quote_date ?? new Date().toISOString()) : new Date().toISOString(),
      production_days: fProductionDays,
      user_notes: notes || null,
      manager_name: editing ? (baseNotes.manager_name ?? authorName) : authorName,
    })

    const commonFields = {
      client_id: clientId,
      client_name: selectedClient.name,
      discount_percent: discount,
      margin_percent: avgMargin,
      items: itemsAuto,
      total_area: t.totalAreaNet,
      total_weight: t.totalWeight,
      total_cost_net: t.totalCostExVat,
      total_cost_vat: t.totalInputVat,
      total_sale_inc_vat: t.totalSaleIncVat,
      total_after_discount: t.totalAfterDiscount,
      notes: orderNotes,
      custom_number: ourOrderNumber.trim() || null,
      client_order_number: clientOrderNumber.trim() || null,
    }

    let savedId: number | null = null
    if (editing) {
      // Редактирование той же строки: НЕ трогаем created_by (сохраняем автора), фиксируем правку.
      const { error } = await sb.from('b2b_orders').update({
        ...commonFields,
        updated_by_user_id: managerId ?? null,
        updated_by_name: authorName,
        updated_at: new Date().toISOString(),
      }).eq('id', editingOrderId)
      if (error) { console.error('B2B update error:', error); setSaveError(error.message); setSaving(false); return }
      savedId = editingOrderId
    } else {
      const { data: saved, error } = await sb.from('b2b_orders').insert({
        ...commonFields,
        created_by: managerId ?? null,
        created_by_name: authorName,   // авторство — 20260630_b2b_orders_authorship.sql
      }).select('id').single()
      if (error) { console.error('B2B save error:', error); setSaveError(error.message); setSaving(false); return }
      savedId = saved?.id ?? null
    }

    if (savedId) {
      try { localStorage.removeItem(DRAFT_KEY) } catch {}
      if (attachFile) {
        const safeName = attachFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `${savedId}/${Date.now()}_${safeName}`
        const { error: uploadErr } = await sb.storage.from('b2b-attachments').upload(path, attachFile)
        if (!uploadErr) {
          // Bucket приватный — храним ПУТЬ; отдаётся через /api/b2b/attachments/[id] (signed URL).
          await sb.from('b2b_calculation_attachments').insert({
            order_id: savedId,
            file_name: attachFile.name,
            file_url: path,
            file_type: attachFile.type || attachFile.name.split('.').pop() || '',
            file_size: attachFile.size,
          })
        }
      }
      setSavedOrderId(savedId)
      setSavedAsPending(false)
    }
    setSaving(false)
  }

  if (isBuyer) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <p className="text-[15px] font-medium text-[#111110]">У вас нет доступа к B2B-калькулятору</p>
        <a href="/admin/procurement"
          className="inline-block bg-[#1d1d1f] text-white text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-black transition-colors">
          Открыть закупки
        </a>
      </div>
    </div>
  )

  if (loadError) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-3">
        <p className="text-[14px] text-red-600">{loadError}</p>
        <button onClick={() => window.location.reload()}
          className="text-[13px] font-medium px-4 py-2 bg-[#f0f0ec] rounded-lg hover:bg-[#e8e8e4] text-[#111110]">
          Повторить
        </button>
      </div>
    </div>
  )

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка...</div>
  )

  return (
    <>
    <div className="apple-calc min-h-screen">
      <style>{`
        .apple-calc{background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;color:#1d1d1f}
        .apple-calc input:not([type=checkbox]):not([type=file]),.apple-calc select{height:44px;border-radius:12px;border:1px solid #d9d9df!important;background:#fff!important;color:#1d1d1f;font-size:14px;transition:box-shadow .15s,border-color .15s}
        .apple-calc input:not([type=checkbox]):not([type=file]):focus,.apple-calc select:focus{outline:none;border-color:#0071e3!important;box-shadow:0 0 0 3.5px rgba(0,113,227,.18)}
        .apple-calc input::placeholder{color:#b0b0b8}
        .apple-calc h1{letter-spacing:-.02em}
        .ac-card{background:#fff;border:1px solid #ececf0;border-radius:20px;box-shadow:0 1px 3px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.04)}
      `}</style>
      <div className="max-w-[1400px] mx-auto px-5 py-6">

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

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-[28px] font-bold text-[#1d1d1f]">Просчёт заказа</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6 items-start">

          {/* ══ ЛЕВАЯ КОЛОНКА ══ */}
          <div className="ac-card p-6 space-y-4 lg:sticky lg:top-6">

            {/* Клиент */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[13px] font-medium text-[#6e6e73]">Клиент</label>
                {!mglassOnly && (
                  <button
                    onClick={() => setShowNewClient(true)}
                    className="text-[10px] font-semibold text-orange-600 hover:text-orange-800 transition-colors">
                    + Новый клиент
                  </button>
                )}
              </div>
              {mglassOnly ? (
                <div className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] font-semibold flex items-center justify-between">
                  <span>{selectedClient?.name ?? 'M GLASS'}</span>
                  <span className="text-[12px] text-[#86868b]">фиксировано</span>
                </div>
              ) : (
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
              )}
            </div>

            {/* Номера заказа */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">
                  Наш номер <span className="text-[11px] font-normal text-[#9a9a95]">— пусто = авто (05xxx)</span>
                </label>
                <input
                  type="text"
                  placeholder="авто при запуске"
                  className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all placeholder:text-[#c4c4be]"
                  value={ourOrderNumber}
                  onChange={e => setOurOrderNumber(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">№ клиента</label>
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
              <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Срок производства, дней</label>
              <input type="number" min="1" max="90"
                className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
                value={fProductionDays}
                onChange={e => setFProductionDays(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>

            <div className="h-px bg-[#f0f0ec]" />

            {/* Тип позиции: сырьё (стекло/зеркало) или готовое изделие производства */}
            <div>
              <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Тип позиции</label>
              <div className="flex gap-1.5">
                {([['material', 'Стекло / зеркало'], ['fmirror', 'Зеркало+свет/рама'], ['floft', 'Лофт']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => switchKind(k)}
                    className={`flex-1 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${fKind === k ? 'bg-[#1d1d1f] text-white' : 'bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4]'}`}>
                    {l}
                  </button>
                ))}
              </div>
              {fKind !== 'material' && (
                <p className="mt-1 text-[10px] text-[#9a9a95]">Готовое изделие по цене производства (себестоимость цеха + маржа производства)</p>
              )}
            </div>

            {/* Чертёж — универсально для всех типов, сразу под выбором типа */}
            <div className="flex items-center gap-2 flex-wrap border border-dashed border-[#d8d8d3] rounded-lg px-2.5 py-2 bg-[#fafaf9]">
              <span className="text-[11px] text-[#6b6b66]">Есть чертёж? Прикрепи — {fKind === 'floft' ? 'сниму проём, тип и створки' : fKind === 'fmirror' ? 'сниму размеры зеркала' : 'добавлю каждое стекло отдельной позицией'}:</span>
              <label className={`px-2.5 py-1 bg-white border border-[#e4e4e0] text-[#6b6b66] text-[11px] font-medium rounded-lg hover:bg-[#f5f5f3] ${flParsing ? 'opacity-50 cursor-default' : 'cursor-pointer'}`}>
                {flParsing ? 'Читаю…' : 'Чертёж (PDF/фото)'}
                <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" disabled={flParsing}
                  onChange={e => { const f = e.target.files?.[0]; if (f) parseItemDrawing(f); e.target.value = '' }} />
              </label>
              {flParseNote && <span className="text-[11px] text-emerald-700">{flParseNote}</span>}
            </div>

            {fKind !== 'material' && (
              <div className="space-y-3">
                {factoryLoading && <p className="text-[12px] text-[#9a9a95]">Загружаю справочники производства…</p>}
                {!factoryLoading && factoryData && fKind === 'fmirror' && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Зеркало</label>
                        <select value={fmName} onChange={e => { setFmName(e.target.value); const mms = mirrorMms(factoryData, e.target.value); if (mms.length) setFmMm(mms[0]) }}
                          className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] outline-none focus:border-[#111110]">
                          {factoryData.mirrorNames.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Толщина</label>
                        <select value={fmMm} onChange={e => setFmMm(Number(e.target.value))}
                          className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] font-mono outline-none focus:border-[#111110]">
                          {mirrorMms(factoryData, fmName).map(m => <option key={m} value={m}>{m} мм</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Размеры и количество</label>
                      <div className="grid grid-cols-3 gap-2">
                        <input type="number" placeholder="Ш, мм" value={fmW} onChange={e => setFmW(e.target.value)}
                          className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] font-mono outline-none focus:border-[#111110]" />
                        <input type="number" placeholder="В, мм" value={fmH} onChange={e => setFmH(e.target.value)}
                          className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] font-mono outline-none focus:border-[#111110]" />
                        <input type="number" placeholder="Шт" value={fmQty} onChange={e => setFmQty(e.target.value)}
                          className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] font-mono outline-none focus:border-[#111110]" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Форма</label>
                      <div className="grid grid-cols-2 gap-2">
                        {([[false, 'Прямоугольное'], [true, 'Криволинейное']] as const).map(([v, label]) => (
                          <button key={label} onClick={() => setFmCurved(v)}
                            className={`h-[34px] rounded-lg text-[13px] font-medium border ${fmCurved === v ? 'bg-[#1d1d1f] text-white border-[#111110]' : 'bg-white border-[#e4e4e0] text-[#6b6b66] hover:border-[#c4c4be]'}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className={`flex items-center gap-2 h-[34px] px-3 border rounded-lg cursor-pointer ${fmLighting ? 'border-amber-300 bg-amber-50' : 'border-[#e4e4e0]'}`}>
                        <input type="checkbox" checked={fmLighting} onChange={e => setFmLighting(e.target.checked)} className="w-3.5 h-3.5 rounded accent-[#111110]" />
                        <span className={`text-[13px] font-medium ${fmLighting ? 'text-amber-700' : 'text-[#111110]'}`}>Подсветка LED</span>
                      </label>
                    {fmLighting && (
                      <div className="mt-2 rounded-lg border border-[#e4e4e0] bg-[#faf9f7] p-3">
                        <p className="text-[11px] font-medium text-[#6e6e73] mb-2">Где подсветка — нажми на стороны</p>
                        <div className="flex items-start gap-3">
                          <div className="relative w-[104px] h-[128px] shrink-0">
                            <div className="absolute inset-[9px] rounded border border-[#d4d4ce] bg-white" />
                            <button type="button" aria-pressed={fmSides.top} title="Сверху"
                              onClick={() => setFmSides(v => ({ ...v, top: !v.top }))}
                              className={`absolute left-[9px] right-[9px] top-0 h-[9px] rounded-sm transition-colors ${fmSides.top ? 'bg-amber-400' : 'bg-[#e4e4e0] hover:bg-[#d0d0ca]'}`} />
                            <button type="button" aria-pressed={fmSides.bottom} title="Снизу"
                              onClick={() => setFmSides(v => ({ ...v, bottom: !v.bottom }))}
                              className={`absolute left-[9px] right-[9px] bottom-0 h-[9px] rounded-sm transition-colors ${fmSides.bottom ? 'bg-amber-400' : 'bg-[#e4e4e0] hover:bg-[#d0d0ca]'}`} />
                            <button type="button" aria-pressed={fmSides.left} title="Слева"
                              onClick={() => setFmSides(v => ({ ...v, left: !v.left }))}
                              className={`absolute top-[9px] bottom-[9px] left-0 w-[9px] rounded-sm transition-colors ${fmSides.left ? 'bg-amber-400' : 'bg-[#e4e4e0] hover:bg-[#d0d0ca]'}`} />
                            <button type="button" aria-pressed={fmSides.right} title="Справа"
                              onClick={() => setFmSides(v => ({ ...v, right: !v.right }))}
                              className={`absolute top-[9px] bottom-[9px] right-0 w-[9px] rounded-sm transition-colors ${fmSides.right ? 'bg-amber-400' : 'bg-[#e4e4e0] hover:bg-[#d0d0ca]'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap gap-1.5 mb-2">
                              <button type="button" onClick={() => setFmSides({ ...ALL_SIDES })}
                                className="text-[11px] px-2 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110]">Периметр</button>
                              <button type="button" onClick={() => setFmSides({ top: false, bottom: false, left: true, right: true })}
                                className="text-[11px] px-2 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110]">Бока</button>
                              <button type="button" onClick={() => setFmSides({ top: true, bottom: true, left: false, right: false })}
                                className="text-[11px] px-2 py-1 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110]">Верх и низ</button>
                            </div>
                            {(() => {
                              const w = Number(fmW) || 0, h = Number(fmH) || 0
                              const m = lightingLengthM(w, h, fmSides)
                              const none = !fmSides.top && !fmSides.bottom && !fmSides.left && !fmSides.right
                              if (none) return <p className="text-[11px] text-red-600">Не выбрана ни одна сторона — подсветку считать не из чего.</p>
                              return <p className="text-[11px] text-[#6b6b66]">Лента, профиль и рассеиватель: <span className="font-mono text-[#111110]">{m > 0 ? m.toFixed(2) : '—'}</span> пог.м{w > 0 && h > 0 ? '' : ' (укажи размеры)'}</p>
                            })()}
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Обработки зеркала. Фацет и пескоструй — РАЗНЫЕ работы, не одна
                        «декоративка»: у фацета своя ставка за пог.м, у пескоструя — своя
                        за м². Если себестоимость не заведена в справочнике, говорим прямо:
                        иначе маржа посчитается от нуля и изделие уйдёт дешевле, чем обошлось. */}
                    <div className="mt-2 rounded-lg border border-[#e4e4e0] bg-[#faf9f7] p-3 space-y-2">
                      <p className="text-[11px] font-medium text-[#6e6e73]">Обработка</p>

                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-2 text-[12px] text-[#6b6b66] cursor-pointer">
                          <input type="checkbox" checked={fmSandblast} onChange={e => setFmSandblast(e.target.checked)} className="w-3.5 h-3.5 rounded accent-[#111110]" />
                          Пескоструй
                        </label>
                        <span className="w-px h-4 bg-[#e4e4e0]" />
                        <span className="text-[12px] text-[#6b6b66]">Фацет:</span>
                        <select value={fmFacetMm ?? ''} onChange={e => setFmFacetMm(e.target.value ? Number(e.target.value) : null)}
                          className="bg-white border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] outline-none focus:border-[#111110]">
                          <option value="">без фацета</option>
                          {facetPrices.filter(f => f.active !== false).map(f => (
                            <option key={f.type_mm} value={f.type_mm}>{f.type_mm} мм</option>
                          ))}
                        </select>
                      </div>

                      {(() => {
                        const warn: string[] = []
                        if (fmSandblast) {
                          const sb = factoryData?.retailMaterials.find(m => m.name.toLowerCase().includes('пескоструй'))
                          if (!sb) warn.push('Пескоструй: позиции нет в справочнике материалов')
                          else if (!(Number(sb.cost_price) > 0)) warn.push('Пескоструй: себестоимость не заведена')
                        }
                        if (fmFacetMm != null) {
                          const f = facetPrices.find(x => x.type_mm === fmFacetMm && x.active !== false)
                          const c = f ? Number(f.cost_price) + Number(f.transport_cost ?? 0) : 0
                          if (!(c > 0)) warn.push(`Фацет ${fmFacetMm} мм: себестоимость не заведена`)
                        }
                        if (warn.length === 0) return null
                        return (
                          <div className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2">
                            {warn.map((w, i) => <p key={i} className="text-[11px] text-red-700">{w}</p>)}
                            <p className="text-[11px] text-red-700 font-medium mt-1">Маржа по этой обработке считается от нуля — заведи цену в справочнике до отправки клиенту.</p>
                          </div>
                        )
                      })()}
                    </div>
                      <select value={fmButton} onChange={e => setFmButton(e.target.value as 'none' | 'sensor' | 'wave')}
                        className="bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] outline-none focus:border-[#111110]">
                        <option value="none">Без кнопки</option>
                        <option value="sensor">Сенсорная кнопка</option>
                        <option value="wave">Датчик взмаха</option>
                      </select>
                    </div>
                    <label className={`flex items-center gap-2 h-[38px] px-3 border rounded-lg cursor-pointer ${fmFrame ? 'border-slate-400 bg-slate-100' : 'border-[#e4e4e0]'}`}>
                      <input type="checkbox" checked={fmFrame} onChange={e => setFmFrame(e.target.checked)} className="w-3.5 h-3.5 rounded accent-[#111110]" />
                      <span className={`text-[13px] font-medium ${fmFrame ? 'text-slate-800' : 'text-[#111110]'}`}>Металлическая рама (сварной каркас, покраска)</span>
                    </label>
                    {fmLighting && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Лента · температура</label>
                          <select value={fmLedId ?? ''} onChange={e => setFmLedId(e.target.value ? Number(e.target.value) : null)}
                            className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] outline-none focus:border-[#111110]">
                            <option value="">Авто (стандарт)</option>
                            {ledOptions(factoryData).map(c => (
                              <option key={c.id} value={c.id}>
                                {(c.short_name ?? c.name)}{c.color_temp ? ` · ${c.color_temp}K` : ''}{c.voltage ? ` · ${c.voltage}V` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Каркас (сзади)</label>
                          {fmCurved ? (
                            <div>
                              <input type="number" placeholder="Подложка, ₽" value={fmUnderlay} onChange={e => setFmUnderlay(e.target.value)}
                                className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] font-mono outline-none focus:border-[#111110]" />
                              <p className="text-[10px] text-[#9a9a95] mt-0.5">криволинейный — подложка от подрядчика (ЦНЦ), себестоимость ₽</p>
                            </div>
                          ) : (
                            <select value={fmFrameId ?? ''} onChange={e => setFmFrameId(e.target.value ? Number(e.target.value) : null)}
                              className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] outline-none focus:border-[#111110]">
                              <option value="">Авто (первый из справочника)</option>
                              {frameOptions(factoryData).map(c => (
                                <option key={c.id} value={c.id}>{c.short_name ?? c.name}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
                {!factoryLoading && factoryData && fKind === 'floft' && (
                  <>
                    <div>
                      <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Размеры и количество</label>
                      <div className="grid grid-cols-3 gap-2">
                        <input type="number" placeholder="Ш, мм" value={flW} onChange={e => setFlW(e.target.value)}
                          className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] font-mono outline-none focus:border-[#111110]" />
                        <input type="number" placeholder="В, мм" value={flH} onChange={e => setFlH(e.target.value)}
                          className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] font-mono outline-none focus:border-[#111110]" />
                        <input type="number" placeholder="Шт" value={flQty} onChange={e => setFlQty(e.target.value)}
                          className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] font-mono outline-none focus:border-[#111110]" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Конструкция</label>
                      <div className="flex bg-[#efefec] rounded-lg p-[3px] gap-[2px]">
                        {([['fixed', 'Стационарная'], ['swing', 'Распашная'], ['sliding', 'Раздвижная']] as const).map(([v, l]) => (
                          <button key={v} onClick={() => setFlConstruction(v)}
                            className={`flex-1 text-[12px] font-medium rounded-md py-1.5 ${flConstruction === v ? 'bg-white shadow-sm text-[#111110]' : 'text-[#9a9a95]'}`}>{l}</button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {flConstruction !== 'fixed' && (
                        <div>
                          <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">{flConstruction === 'swing' ? 'Дверей' : 'Раздв. створок'}</label>
                          <input type="number" min={1} value={flDoors} onChange={e => setFlDoors(e.target.value)}
                            className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] font-mono outline-none focus:border-[#111110]" />
                        </div>
                      )}
                      <div>
                        <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">{flConstruction === 'fixed' ? 'Секций' : 'Глухих частей'}</label>
                        <input type="number" min={0} value={flFixed} onChange={e => setFlFixed(e.target.value)}
                          className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] font-mono outline-none focus:border-[#111110]" />
                      </div>
                      <div>
                        <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Стёкол в створке (по высоте)</label>
                        <input type="number" min={1} value={flRows} onChange={e => setFlRows(e.target.value)}
                          className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] font-mono outline-none focus:border-[#111110]" />
                      </div>
                    </div>
                    <p className="text-[11px] text-[#9a9a95] leading-snug">
                      Лофт-сетка: горизонтальные перемычки делят каждую створку на N стёкол по высоте
                      (напр. 4 стекла = 3 перемычки). «Глухая часть» — секция, которая не открывается.
                    </p>
                    <div className="flex items-center gap-4 flex-wrap">
                      {flConstruction === 'swing' && (
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-[#6e6e73]">Ручка</span>
                          <div className="flex bg-[#efefec] rounded-lg p-[2px] gap-[2px]">
                            {([['corner', 'Уголок'], ['push', 'Нажимная с замком']] as const).map(([v, l]) => (
                              <button key={v} onClick={() => setFlHandle(v)}
                                className={`text-[11px] font-medium rounded-md px-2.5 py-1 ${flHandle === v ? 'bg-white shadow-sm text-[#111110]' : 'text-[#9a9a95]'}`}>{l}</button>
                            ))}
                          </div>
                        </div>
                      )}
                      {flConstruction === 'sliding' && (
                        <label className="flex items-center gap-2 text-[12px] text-[#6b6b66] cursor-pointer">
                          <input type="checkbox" checked={flSoftClose} onChange={e => setFlSoftClose(e.target.checked)} className="accent-[#111110]" />
                          Доводчик
                        </label>
                      )}
                      <label className="flex items-center gap-2 text-[12px] text-[#6b6b66] cursor-pointer">
                        <input type="checkbox" checked={flTempering} onChange={e => setFlTempering(e.target.checked)} className="accent-[#111110]" />
                        Закалка
                      </label>
                    </div>
                    <div>
                      <label className="flex items-center gap-2 text-[13px] font-medium text-[#6e6e73] mb-1 cursor-pointer">
                        <input type="checkbox" checked={flWithGlass} onChange={e => setFlWithGlass(e.target.checked)} className="accent-[#111110]" />
                        Стекло в изделии
                      </label>
                      {flWithGlass ? (
                        <select value={flGlassId ?? ''} onChange={e => setFlGlassId(Number(e.target.value))}
                          className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] outline-none focus:border-[#111110]">
                          {factoryData.loftGlasses.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                      ) : (
                        <p className="text-[11px] text-[#6b6b66] leading-snug">
                          Считаем только каркас: без стекла, закалки и остекления.
                          Стекло добавь отдельной позицией просчёта.
                        </p>
                      )}
                    </div>
                  </>
                )}
                {factoryQuote && (
                  <div className="rounded-lg border border-[#e4e4e0] bg-[#f8f8f7] px-3 py-2.5 space-y-1">
                    {/* Экономика ПРОИЗВОДСТВА (только цех): себестоимость → наценка → две цены
                        продажи цеха (внутренняя M-Glass и внешним компаниям). Перепродажу
                        M-Glass своим клиентам здесь НЕ показываем — это её розница/быстрый
                        расчёт, отдельный уровень; иначе путаница уровней и цен. */}
                    <div className="flex justify-between text-[12px]">
                      <span className="text-[#6b6b66]">Себестоимость производства</span>
                      <span className="font-mono text-[#111110]">{factoryQuote.factoryCostPiece.toLocaleString('ru-RU')} ₽/шт</span>
                    </div>
                    <div className="flex justify-between text-[12px]">
                      <span className="text-[#6b6b66]">Наценка производства <span className="text-[10px] text-[#9a9a95]">(маржа {factoryQuote.marginPercent}% от цены, налог включён)</span></span>
                      <span className="font-mono text-[#111110]">+{(factoryQuote.prodPricePiece - factoryQuote.factoryCostPiece).toLocaleString('ru-RU')} ₽/шт</span>
                    </div>
                    <div className="flex justify-between text-[13px] font-semibold border-t border-[#f0f0ec] pt-1">
                      <span className="text-blue-700">Цена для M-Glass <span className="text-[10px] text-[#9a9a95] font-normal">(внутренняя · себест. +{Math.round((factoryQuote.transferPricePiece / factoryQuote.factoryCostPiece - 1) * 100)}%)</span></span>
                      <span className="font-mono text-blue-700">{factoryQuote.transferPricePiece.toLocaleString('ru-RU')} ₽/шт</span>
                    </div>
                    <div className="flex justify-between text-[13px] font-semibold">
                      <span className="text-[#111110]">Цена для сторонних компаний <span className="text-[10px] text-[#9a9a95] font-normal">(внешний B2B)</span></span>
                      <span className="font-mono text-emerald-700">{factoryQuote.prodPricePiece.toLocaleString('ru-RU')} ₽/шт</span>
                    </div>
                    <p className="text-[10px] text-[#9a9a95]">{factoryQuote.spec}</p>
                    {isAdmin && !!factoryQuote.costLines?.length && (
                      <div className="pt-1 border-t border-[#f0f0ec]">
                        <button onClick={() => setShowCostLines(v => !v)}
                          className="text-[11px] font-semibold text-[#6b6b66] hover:text-[#111110]">
                          {showCostLines ? '▾' : '▸'} Состав себестоимости ({factoryQuote.costLines.length} строк)
                        </button>
                        {showCostLines && (
                          <div className="mt-1 space-y-0.5">
                            {factoryQuote.costLines.map((l, i) => (
                              <div key={i} className="flex justify-between text-[11px]">
                                <span className="text-[#6b6b66] truncate mr-2">
                                  {l.name}
                                  {l.price != null && l.price > 0 && !(l.qty === 1 && l.unit === '₽')
                                    ? <span className="text-[#b0b0aa]"> · {l.qty} {l.unit} × {Math.round(l.price).toLocaleString('ru-RU')} ₽</span>
                                    : (l.qty > 1 ? ` × ${l.qty} ${l.unit}` : '')}
                                </span>
                                <span className="font-mono text-[#111110] shrink-0">{l.total.toLocaleString('ru-RU')} ₽</span>
                              </div>
                            ))}
                            <div className="flex justify-between text-[11px] font-bold border-t border-[#f0f0ec] pt-0.5">
                              <span>Итого себестоимость</span>
                              <span className="font-mono">{factoryQuote.factoryCostPiece.toLocaleString('ru-RU')} ₽</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <input type="text" maxLength={120}
                  className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-[#111110] placeholder:text-[#c4c4be]"
                  value={fComment} onChange={e => setFComment(e.target.value)}
                  placeholder="Комментарий к позиции (опционально)" />
                <button onClick={handleAddFactoryItem} disabled={!factoryQuote}
                  className="w-full bg-[#1d1d1f] text-white text-[14px] font-semibold py-2.5 rounded-lg hover:bg-black disabled:opacity-40 transition-colors">
                  + Добавить изделие
                </button>
              </div>
            )}

            {fKind === 'material' && (<>
            {/* Стекло / Зеркало — табы */}
            <div>
              <label className="block text-[13px] font-medium text-[#6e6e73] mb-1.5">Материал</label>
              <div className="flex bg-[#f0f0f2] rounded-[10px] p-[3px] gap-[2px]">
                {SUPER_CATS.filter(s => materials.some(m => (s.cats as readonly string[]).includes(m.category))).map(s => (
                  <button key={s.value} onClick={() => handleSuperCatChange(s.value)}
                    className={`flex-1 py-1.5 rounded-[8px] text-[13px] font-medium transition-all ${fSuperCat === s.value ? 'bg-white shadow-sm text-[#1d1d1f]' : 'text-[#6e6e73] hover:text-[#1d1d1f]'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Толщина + Тип */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Толщина</label>
                <select
                  className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
                  value={fThickness ?? ''}
                  onChange={e => handleThicknessChange(Number(e.target.value))}>
                  {availableThickness.map(t => <option key={t} value={t}>{t} мм</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Тип</label>
                <select
                  className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] text-[#111110] outline-none focus:border-[#111110] transition-all"
                  value={fMatId ?? ''}
                  onChange={e => handleMaterialChange(Number(e.target.value))}>
                  {thicknessMaterials.map(m => <option key={m.id} value={m.id}>{m.supplier_material_name ? `${m.name} (${m.supplier_material_name})` : m.name}</option>)}
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
              <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Размеры и количество</label>
              <div className="grid grid-cols-3 gap-2">
                <div className="relative">
                  <input ref={widthRef} type="number" min="1"
                    className="w-full bg-white border border-[#e4e4e0] rounded-lg pl-3 pr-9 py-1.5 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
                    value={fWidth} onChange={e => setFWidth(e.target.value)} onKeyDown={handleWidthKeyDown} placeholder="Ширина" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#86868b] pointer-events-none">мм</span>
                </div>
                <div className="relative">
                  <input ref={heightRef} type="number" min="1"
                    className="w-full bg-white border border-[#e4e4e0] rounded-lg pl-3 pr-9 py-1.5 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
                    value={fHeight} onChange={e => setFHeight(e.target.value)} onKeyDown={handleHeightKeyDown} placeholder="Высота" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#86868b] pointer-events-none">мм</span>
                </div>
                <div className="relative">
                  <input ref={qtyRef} type="number" min="1"
                    className="w-full bg-white border border-[#e4e4e0] rounded-lg pl-3 pr-9 py-1.5 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
                    value={fQty} onChange={e => setFQty(e.target.value)} onKeyDown={handleQtyKeyDown} placeholder="Кол-во" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#86868b] pointer-events-none">шт</span>
                </div>
              </div>
            </div>

            {/* Отход + Закалка */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">
                  Отход
                  {selectedMaterial?.passthrough
                    ? <span className="ml-1 text-orange-500 normal-case font-normal text-[10px]">фикс.</span>
                    : <span className="ml-1 normal-case font-normal text-emerald-600 text-[10px]">по раскрою</span>}
                </label>
                {selectedMaterial?.passthrough ? (
                  <div className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] text-orange-600 font-semibold">
                    10% — проходной
                  </div>
                ) : (
                  // Расход считается автоматически из раскроя деталей заказа (по
                  // материалу). Ручной ввод убран — он «перекладывал» в одних местах
                  // и «недокладывал» в других. Число видно в позициях после добавления.
                  <div className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] text-[#6e6e73]">
                    авто по раскрою
                  </div>
                )}
              </div>
              {fSuperCat === 'стекло' && (
                <div>
                  <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Закалка</label>
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
                  <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Фацет</label>
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
              <div>
                <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Сверловка</label>
                <label className={`flex items-center gap-2 h-[34px] px-3 border rounded-lg cursor-pointer transition-all ${fHoles ? 'border-blue-300 bg-blue-50' : 'border-[#e4e4e0] hover:border-[#c4c4be]'}`}>
                  <input type="checkbox" checked={fHoles} onChange={e => setFHoles(e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-[#111110]" />
                  <span className={`text-[13px] font-medium ${fHoles ? 'text-blue-700' : 'text-[#111110]'}`}>
                    {fHoles ? 'Есть отверстия' : 'Без отверстий'}
                  </span>
                </label>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Криволинейка</label>
                <label className={`flex items-center gap-2 h-[34px] px-3 border rounded-lg cursor-pointer transition-all ${fCurved ? 'border-teal-300 bg-teal-50' : 'border-[#e4e4e0] hover:border-[#c4c4be]'}`}>
                  <input type="checkbox" checked={fCurved} onChange={e => setFCurved(e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-[#111110]" />
                  <span className={`text-[13px] font-medium ${fCurved ? 'text-teal-700' : 'text-[#111110]'}`}>
                    {fCurved ? 'Криволинейный рез' : 'Прямой рез'}
                  </span>
                </label>
              </div>
              {/* Сколько отверстий и какого диаметра. Признак «есть отверстия» верно
                  направляет деталь к сверловщику, но не говорит ЧТО сверлить — до сих пор
                  он узнавал это голосом или из чертежа, которого у большинства заказов нет.
                  Групп бывает несколько: четыре ⌀12 под петли и два ⌀20 под ручку. */}
              {fHoles && (
                <div className="col-span-2 md:col-span-3 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-medium text-blue-900">
                      Отверстия{fHoleGroups.length > 0 ? ` · всего ${totalHoles(normalizeHoles(fHoleGroups))}` : ''}
                    </p>
                    <button type="button" onClick={() => setFHoleGroups(prev => [...prev, { d: 0, n: 1 }])}
                      className="text-[11px] px-2 py-1 rounded-lg border border-blue-300 text-blue-800 hover:bg-blue-100">+ группа</button>
                  </div>
                  {fHoleGroups.length === 0 ? (
                    <p className="text-[11px] text-blue-800">Добавь группу: сколько отверстий и какого диаметра. Без этого сверловщик получит деталь без размеров.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {fHoleGroups.map((g, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input type="number" min="1" value={g.n || ''} placeholder="шт"
                            onChange={e => setFHoleGroups(prev => prev.map((x, j) => j === i ? { ...x, n: Number(e.target.value) || 0 } : x))}
                            className="w-16 bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-[#111110]" />
                          <span className="text-[12px] text-[#6b6b66]">шт · ⌀</span>
                          <input type="number" min="1" value={g.d || ''} placeholder="мм"
                            onChange={e => setFHoleGroups(prev => prev.map((x, j) => j === i ? { ...x, d: Number(e.target.value) || 0 } : x))}
                            className="w-20 bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-[#111110]" />
                          <span className="text-[12px] text-[#6b6b66]">мм</span>
                          <button type="button" onClick={() => setFHoleGroups(prev => prev.filter((_, j) => j !== i))}
                            className="ml-auto text-[12px] text-[#9a9a95] hover:text-red-600 px-2 py-1">удалить</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div>
                {/* Песочка — отдельный этап цеха со своей оснасткой (макет → оракал →
                    наклейка → пескоструй). Нажали здесь — деталь пойдёт через него;
                    не нажали — не пойдёт. Маршрут строится из просчёта, а не угадывается. */}
                <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Песочка</label>
                <label className={`flex items-center gap-2 h-[34px] px-3 border rounded-lg cursor-pointer transition-all ${fSandblast ? 'border-violet-300 bg-violet-50' : 'border-[#e4e4e0] hover:border-[#c4c4be]'}`}>
                  <input type="checkbox" checked={fSandblast} onChange={e => setFSandblast(e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-[#111110]" />
                  <span className={`text-[13px] font-medium ${fSandblast ? 'text-violet-700' : 'text-[#111110]'}`}>
                    {fSandblast ? 'С песочкой' : 'Без песочки'}
                  </span>
                </label>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Мин. цена</label>
                <label className={`flex items-center gap-2 h-[34px] px-3 border rounded-lg cursor-pointer transition-all ${fMinPrice ? 'border-emerald-300 bg-emerald-50' : 'border-[#e4e4e0] hover:border-[#c4c4be]'}`}>
                  <input type="checkbox" checked={fMinPrice} onChange={e => setFMinPrice(e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-[#111110]" />
                  <span className={`text-[13px] font-medium ${fMinPrice ? 'text-emerald-700' : 'text-[#111110]'}`}>
                    {fMinPrice ? 'Учитывать мин.' : 'Чистый расчёт'}
                  </span>
                </label>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Триплекс</label>
                <label className={`flex items-center gap-2 h-[34px] px-3 border rounded-lg cursor-pointer transition-all ${fTriplex ? 'border-indigo-300 bg-indigo-50' : 'border-[#e4e4e0] hover:border-[#c4c4be]'}`}>
                  <input type="checkbox" checked={fTriplex} onChange={e => setFTriplex(e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-[#111110]" />
                  <span className={`text-[13px] font-medium ${fTriplex ? 'text-indigo-700' : 'text-[#111110]'}`}>
                    {fTriplex ? `Триплекс` : 'Без триплекса'}
                  </span>
                </label>
                {fTriplex && (() => {
                  const glassCats = SUPER_CATS[0].cats as readonly string[]
                  const glassOpts = materials.filter(m => glassCats.includes(m.category) && (m.sale_price ?? 0) > 0)
                    .sort((a, b) => a.thickness - b.thickness || a.name.localeCompare(b.name))
                  const layerSelect = (val: number | null, set: (v: number | null) => void, label: string) => (
                    <select
                      className="mt-1.5 w-full bg-white border border-indigo-200 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-indigo-400"
                      value={val ?? ''} onChange={e => set(e.target.value === '' ? null : Number(e.target.value))}>
                      <option value="">{label}: как основное</option>
                      {glassOpts.map(m => <option key={m.id} value={m.id}>{label}: {m.name} {m.thickness} мм</option>)}
                    </select>
                  )
                  return (
                    <>
                      <select
                        className="mt-1.5 w-full bg-white border border-indigo-200 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-indigo-400"
                        value={fTriplexLayers} onChange={e => setFTriplexLayers(Number(e.target.value) === 3 ? 3 : 2)}>
                        <option value={2}>2 стекла</option>
                        <option value={3}>3 стекла</option>
                      </select>
                      {layerSelect(fTriplexMat2, setFTriplexMat2, 'Стекло 2')}
                      {fTriplexLayers === 3 && layerSelect(fTriplexMat3, setFTriplexMat3, 'Стекло 3')}
                      {!triplexPrice && (
                        <p className="mt-1 text-[10px] text-amber-600">⚠ В справочнике услуг нет «Триплекс» (₽/м²) — склейка посчитается по 0 ₽</p>
                      )}
                    </>
                  )
                })()}
              </div>
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
              className="w-full bg-[#1d1d1f] text-white text-[14px] font-semibold py-2.5 rounded-lg hover:bg-black disabled:opacity-40 transition-colors">
              + Добавить позицию
            </button>

            {/* А19: файл клиента → позиции */}
            <div className="space-y-1.5">
              <label className={`block text-center text-[12px] font-medium py-2 rounded-lg border border-dashed cursor-pointer transition-colors ${
                parseBusy ? 'border-[#e4e4e0] text-[#c4c4be]' : 'border-[#d4d4cf] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110]'}`}>
                {parseBusy ? 'Распознаю…' : '📎 Файл клиента (PDF/фото) → позиции'}
                <input type="file" accept="application/pdf,image/png,image/jpeg" className="hidden"
                  disabled={parseBusy}
                  onChange={e => { const f = e.target.files?.[0]; if (f) parseClientFile(f); e.target.value = '' }} />
              </label>
              {parseError && <p className="text-[11px] text-red-600">{parseError}</p>}
              {parsed.length > 0 && (
                <div className="border border-[#e4e4e0] rounded-lg bg-white overflow-hidden">
                  <div className="px-3 py-1.5 bg-[#fafaf9] border-b border-[#f0f0ec] flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-[#111110]">Распознано: {parsed.length}</span>
                    <button onClick={() => setParsed([])} className="text-[11px] text-[#9a9a95] hover:text-[#111110]">Отменить</button>
                  </div>
                  <div className="max-h-44 overflow-y-auto divide-y divide-[#f8f8f7]">
                    {parsed.map((p, i) => (
                      <div key={p.id} className="px-3 py-1.5 flex items-center gap-2 text-[11px]">
                        <span className="text-[#c4c4be] w-4">{i + 1}</span>
                        <span className="font-mono text-[#111110]">{p.width}×{p.height}</span>
                        <span className="text-[#6b6b66]">×{p.quantity}</span>
                        <span className="text-[#9a9a95] truncate flex-1">{p.label || p.comment}</span>
                        {p.needsReview && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 whitespace-nowrap">проверить</span>}
                        <button onClick={() => setParsed(prev => prev.filter(x => x.id !== p.id))}
                          className="text-[#c4c4be] hover:text-red-500">✕</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={addParsedItems} disabled={!selectedMaterial}
                    className="w-full text-[12px] font-semibold py-2 bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
                    Добавить {parsed.length} поз. материалом «{selectedMaterial?.name ?? '—'}»
                  </button>
                  <p className="px-3 py-1.5 text-[10px] text-[#9a9a95]">
                    Модель распознаёт только размеры. Цену считает калькулятор — как при ручном вводе.
                  </p>
                </div>
              )}
            </div>

            {/* Доп. услуги */}
            {services.length > 0 && (
              <details className="group">
                <summary className="flex items-center justify-between px-3 py-2 rounded-lg border border-[#e4e4e0] cursor-pointer select-none list-none hover:bg-[#fafaf9] transition-colors">
                  <span className="text-[11px] font-medium text-[#8a8a85]">Доп. услуги</span>
                  <div className="flex items-center gap-2">
                    {fServiceIds.length > 0 && (
                      <span className="text-[10px] font-semibold bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">{fServiceIds.length}</span>
                    )}
                    <span className="text-[#c4c4be] text-[10px] group-open:rotate-180 transition-transform inline-block">▼</span>
                  </div>
                </summary>
                <div className="mt-1 border border-[#e4e4e0] rounded-lg overflow-hidden">
                  {visibleServices.map(s => {
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

            {/* Авто-надбавки за габариты/сложность — применяются к цене изделия */}
            {(() => {
              const applicable = applicableSurcharges({ width: Number(fWidth) || 0, height: Number(fHeight) || 0, shape: fCurved ? 'curved' : 'rect' }, surchargeRules)
              if (applicable.length === 0) return null
              return (
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 space-y-1">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[11px] font-semibold text-amber-800">⚙️ Надбавки за габариты</span>
                    <span className="text-[10px] text-amber-600">снимаются галочкой · строка в КП</span>
                  </div>
                  {applicable.map(r => {
                    const on = !fDismissedSurcharges.has(r.id)
                    return (
                      <label key={r.id} className="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" checked={on}
                          onChange={() => setFDismissedSurcharges(prev => { const n = new Set(prev); if (on) n.add(r.id); else n.delete(r.id); return n })}
                          className="w-3 h-3 rounded accent-amber-600 flex-shrink-0" />
                        <span className="text-[12px] text-[#111110] flex-1 leading-tight">{r.label}</span>
                        <span className="text-[11px] font-mono font-semibold text-amber-700 flex-shrink-0">+{r.surcharge_percent}%</span>
                      </label>
                    )
                  })}
                </div>
              )
            })()}

            {/* Чертёж / файл */}
            <div>
              <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">
                Чертёж / файл клиента
              </label>
              {attachFile ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 px-3 py-2 border border-[#e4e4e0] rounded-lg bg-[#f8f8f7]">
                    <span className="text-[11px] text-[#111110] flex-1 truncate font-medium">{attachFile.name}</span>
                    <span className="text-[10px] text-[#9a9a95] flex-shrink-0">
                      {attachFile.size < 1024 * 1024
                        ? `${(attachFile.size / 1024).toFixed(0)} КБ`
                        : `${(attachFile.size / (1024 * 1024)).toFixed(1)} МБ`}
                    </span>
                    <button onClick={() => { setAttachFile(null); setDrawingInfo(null) }}
                      className="text-[#9a9a95] hover:text-red-500 transition-colors leading-none text-sm flex-shrink-0">✕</button>
                  </div>
                  <button onClick={parseDrawing} disabled={parsingDrawing}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#1d1d1f] text-white text-[12px] font-semibold hover:bg-black disabled:opacity-50 transition-colors">
                    {parsingDrawing ? 'Распознаю чертёж…' : '🔍 Распознать чертёж → позиции'}
                  </button>
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

              {drawingInfo && (
                <div className={`mt-2 rounded-lg border px-3 py-2 text-[11px] ${drawingInfo.added > 0 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                  {drawingInfo.added > 0
                    ? <p className="font-semibold text-emerald-800">✓ Добавлено позиций: {drawingInfo.added}{drawingInfo.skipped > 0 ? ` · пропущено: ${drawingInfo.skipped}` : ''}</p>
                    : <p className="font-semibold text-amber-800">Позиции не добавлены</p>}
                  {(drawingInfo.holes > 0 || drawingInfo.cutouts > 0) && (
                    <p className="mt-1 text-[#6b6b66]">
                      Сложность: {drawingInfo.holes > 0 && `${drawingInfo.holes} отв.`} {drawingInfo.cutouts > 0 && `· ${drawingInfo.cutouts} слож. вырез(ов)`}
                      {drawingInfo.cutouts > 0 && <span className="text-amber-700"> — трудоёмко, заложите наценку</span>}
                      <span className="text-[#9a9a95]"> (точный тариф по операциям — с прайс-листом)</span>
                    </p>
                  )}
                  {(drawingInfo.shaped ?? 0) > 0 && (
                    <p className="mt-1 text-[#6b6b66]">
                      Скошенных деталей: {drawingInfo.shaped} — раскрой по габаритному прямоугольнику (расход больше номинала учтён в размерах позиции).
                    </p>
                  )}
                  {drawingInfo.warnings.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-[#8a6d3b] list-disc list-inside">
                      {drawingInfo.warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>
            </>)}

            {/* Примечание к заказу */}
            <details className="group">
              <summary className="flex items-center gap-1.5 text-[11px] font-medium text-[#9a9a95] cursor-pointer select-none list-none hover:text-[#6b6b66] transition-colors">
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
            <div className="ac-card overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#f0f0ec] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-medium text-[#8a8a85]">
                    Позиции {items.length > 0 && `— ${items.length} шт.`}
                  </span>
                  {selectedClient && (
                    <span className="text-[12px] text-[#6b6b66]">{selectedClient.name}</span>
                  )}
                  {discount > 0 && (
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${discount > maxDiscount ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      скидка {discount}%{discount > maxDiscount ? ` — превышает ваш лимит ${maxDiscount}%` : ''}
                    </span>
                  )}
                </div>
                {items.length > 0 && (
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-[#9a9a95] hidden sm:inline">✎ нажмите на позицию, чтобы изменить</span>
                    <button onClick={() => { setItems([]); clearSel() }} className="text-[11px] text-red-400 hover:text-red-600 transition-colors">
                      Очистить всё
                    </button>
                  </div>
                )}
              </div>

              {selIds.size > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-2 px-3 py-2 bg-[#f0f4ff] border border-[#d6e0ff] rounded-lg">
                  <span className="text-[12px] font-semibold text-[#111110]">Выбрано: {selIds.size}</span>
                  <span className="text-[11px] text-[#6b6b66]">Сменить материал →</span>
                  <select
                    className="bg-white border border-[#c9d4f0] rounded-lg px-2 py-1 text-[12px] text-[#111110] outline-none min-w-[200px] disabled:opacity-40"
                    value={bulkMatId ?? ''}
                    disabled={bulkMaterialGroups.length === 0}
                    onChange={e => setBulkMatId(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">{bulkMaterialGroups.length === 0 ? 'справочник материалов пуст' : 'выберите материал'}</option>
                    {bulkMaterialGroups.map(g => (
                      <optgroup key={g.thickness} label={`${g.thickness} мм`}>
                        {g.materials.map(m => (
                          <option key={m.id} value={m.id}>{m.supplier_material_name ? `${m.name} (${m.supplier_material_name})` : m.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button onClick={applyBulkMaterial} disabled={bulkMatId === null}
                    className="px-3 py-1 rounded-lg bg-[#111110] text-white text-[12px] font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#2a2a28] transition-colors">
                    Применить
                  </button>
                  <span className="w-px h-4 bg-[#c9d4f0]" />
                  <span className="text-[11px] text-[#6b6b66]">Закалка:</span>
                  <button onClick={() => applyBulkTempering(true)}
                    className="px-2.5 py-1 rounded-lg text-[12px] text-orange-600 border border-orange-200 hover:bg-orange-50 transition-colors">
                    вкл
                  </button>
                  <button onClick={() => applyBulkTempering(false)}
                    className="px-2.5 py-1 rounded-lg text-[12px] text-[#6b6b66] border border-[#e4e4e0] hover:bg-white transition-colors">
                    выкл
                  </button>
                  <span className="w-px h-4 bg-[#c9d4f0]" />
                  <span className="text-[11px] text-[#6b6b66]">Кол-во:</span>
                  <button onClick={() => bumpBulkQty(-1)}
                    title="Уменьшить на 1 у выбранных (не ниже 1)"
                    className="px-2 py-1 rounded-lg text-[12px] font-mono text-[#6b6b66] border border-[#e4e4e0] hover:bg-white transition-colors">
                    −1
                  </button>
                  <button onClick={() => bumpBulkQty(1)}
                    title="Увеличить на 1 у выбранных"
                    className="px-2 py-1 rounded-lg text-[12px] font-mono text-[#6b6b66] border border-[#e4e4e0] hover:bg-white transition-colors">
                    +1
                  </button>
                  <input
                    type="number" min="1" step="1" placeholder="напр. 2"
                    value={bulkQty}
                    onChange={e => setBulkQty(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') applyBulkQty() }}
                    className="w-16 bg-white border border-[#c9d4f0] rounded-lg px-2 py-1 text-[12px] font-mono text-center outline-none" />
                  <button onClick={applyBulkQty}
                    disabled={Math.floor(Number(bulkQty)) < 1 || !Number.isFinite(Number(bulkQty)) || bulkQty.trim() === ''}
                    title="Поставить всем выбранным это количество"
                    className="px-3 py-1 rounded-lg bg-[#111110] text-white text-[12px] font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#2a2a28] transition-colors">
                    Задать
                  </button>
                  <span className="w-px h-4 bg-[#c9d4f0]" />
                  <button onClick={bulkDelete}
                    className="px-2.5 py-1 rounded-lg text-[12px] text-red-500 hover:bg-red-50 transition-colors">
                    Удалить выбранные
                  </button>
                  <button onClick={clearSel}
                    className="px-2.5 py-1 rounded-lg text-[12px] text-[#6b6b66] hover:bg-white transition-colors ml-auto">
                    Снять выбор
                  </button>
                </div>
              )}

              {items.length === 0 ? (
                <div className="py-16 text-center text-[13px] text-[#c4c4be]">Добавьте первую позицию</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-[#f0f0ec] bg-[#fafaf9] text-[13px] font-medium text-[#6e6e73] whitespace-nowrap">
                        <th className="pl-3 pr-1 py-2.5 text-center w-6">
                          <input type="checkbox" title="Выбрать все"
                            checked={items.length > 0 && selIds.size === items.length}
                            ref={el => { if (el) el.indeterminate = selIds.size > 0 && selIds.size < items.length }}
                            onChange={toggleSelAll}
                            className="align-middle cursor-pointer accent-[#111110]" />
                        </th>
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
                      {itemsAuto.map((item, idx) => {
                        const itemAfterDiscount = Math.round(item.saleIncVat * (1 - discount / 100))
                        const em = effectiveItemMargin(item, discount)
                        return (
                          <tr key={item.localId} onClick={() => openEdit(item)}
                            title="Нажмите, чтобы изменить позицию"
                            className={`transition-colors cursor-pointer ${selIds.has(item.localId) ? 'bg-[#f0f4ff] hover:bg-[#e7eeff]' : 'hover:bg-[#f0f0ec]'}`}>
                            <td className="pl-3 pr-1 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                              <input type="checkbox" checked={selIds.has(item.localId)}
                                onChange={() => toggleSel(item.localId)}
                                className="align-middle cursor-pointer accent-[#111110]" />
                            </td>
                            <td className="px-3 py-2.5 text-center text-[10px] font-bold text-[#c4c4be]">{idx + 1}</td>
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-[#111110]">{item.materialName}</div>
                              {(item.hasTempering || item.hasFacet || item.hasTriplex || item.services.length > 0 || item.minPriceApplied) && (
                                <div className="flex gap-1 mt-0.5 flex-wrap">
                                  {item.hasTempering && (
                                    <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-orange-50 text-orange-600">закалка</span>
                                  )}
                                  {item.hasTriplex && (
                                    <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-indigo-50 text-indigo-600">
                                      триплекс {item.triplexGlasses?.length
                                        ? [item.thickness, ...item.triplexGlasses.map(g => g.thickness)].join('+')
                                        : `${item.triplexLayers ?? 2} ст.`}
                                    </span>
                                  )}
                                  {item.hasFacet && (
                                    <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-purple-50 text-purple-600">фацет {item.facetTypeMm}мм</span>
                                  )}
                                  {item.services.map(s => (
                                    <span key={s.id} className="text-[9px] font-medium px-1 py-0.5 rounded bg-blue-50 text-blue-600">{s.name}</span>
                                  ))}
                                  {item.minPriceApplied && item.minPriceReason && (
                                    <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-amber-50 text-amber-700">{minPriceReasonLabel(item.minPriceReason)}</span>
                                  )}
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
                            <td onClick={e => { e.stopPropagation(); setEditTotalId(item.localId) }}
                              title="Клик — вписать договорную цену позиции (пусто = вернуть расчёт)"
                              className="px-3 py-2.5 text-right font-mono font-semibold text-[#111110] whitespace-nowrap cursor-text hover:bg-amber-50/60">
                              {editTotalId === item.localId ? (
                                <input type="number" autoFocus
                                  defaultValue={item.manualTotal ?? itemAfterDiscount}
                                  onClick={e => e.stopPropagation()}
                                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditTotalId(null) }}
                                  onBlur={e => {
                                    const raw = e.target.value.trim()
                                    const v = raw === '' ? null : Math.round(Number(raw))
                                    setItems(prev => prev.map(x => x.localId === item.localId
                                      ? { ...x, manualTotal: v != null && isFinite(v) && v > 0 ? v : null }
                                      : x))
                                    setEditTotalId(null)
                                  }}
                                  className="w-24 border border-amber-400 rounded-lg px-2 py-1 text-right font-mono text-[12px] outline-none bg-white" />
                              ) : item.manualTotal != null ? (
                                <>
                                  <span className="line-through text-[10px] text-[#c4c4be] block leading-tight">
                                    {itemAfterDiscount.toLocaleString('ru-RU')} ₽
                                  </span>
                                  <span className="text-amber-700">{item.manualTotal.toLocaleString('ru-RU')} ₽ ✏️</span>
                                </>
                              ) : item.minPriceApplied && item.originalLinePrice !== undefined
                                ? (
                                  <>
                                    <span className="line-through text-[10px] text-[#c4c4be] block leading-tight">
                                      {item.originalLinePrice.toLocaleString('ru-RU')} ₽
                                    </span>
                                    {item.saleIncVat.toLocaleString('ru-RU')} ₽
                                  </>
                                )
                                : <>{itemAfterDiscount.toLocaleString('ru-RU')} ₽</>
                              }
                            </td>
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
                                <button onClick={(e) => { e.stopPropagation(); openEdit(item) }} title="Редактировать"
                                  className="text-[11px] text-[#c4c4be] hover:text-[#111110] transition-colors px-1.5 py-0.5 rounded hover:bg-[#f0f0ec] leading-none">
                                  ✎
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); copyItem(item.localId) }} title="Дублировать строку"
                                  className="text-[11px] text-[#c4c4be] hover:text-blue-500 transition-colors px-1.5 py-0.5 rounded hover:bg-blue-50 leading-none">
                                  ⧉
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); removeItem(item.localId) }}
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
                          <td></td>
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
                              const avg = Math.round(itemsAuto.reduce((s, i) => s + effectiveItemMargin(i, discount), 0) / itemsAuto.length)
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
              <details id="b2b-kp" className="ac-card overflow-hidden group">
                <summary className="px-5 py-3 border-b border-[#f0f0ec] flex items-center gap-2 cursor-pointer select-none list-none hover:bg-[#fafaf9] transition-colors">
                  <span className="text-[10px] text-[#9a9a95] group-open:rotate-90 transition-transform inline-block">▶</span>
                  <span className="text-[11px] font-medium text-[#8a8a85]">Клиентский расчёт (КП)</span>
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
              <div className="ac-card p-6 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    {discount > 0 && (
                      <p className="text-[12px] text-[#9a9a95] line-through mb-0.5">{fmt(totals.totalSaleIncVat)}</p>
                    )}
                    <p className="text-[38px] font-bold text-[#1d1d1f] leading-none tracking-[-0.02em]">{fmt(totals.totalAfterDiscount)}</p>
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
                    {(() => {
                      const billed = items.reduce((s, i) => s + i.totalAreaBilled, 0)
                      return billed > 0 ? (
                        <p className="font-mono text-[11px] font-semibold text-[#6b6b66] pt-0.5 border-t border-[#f0f0ec] mt-0.5">
                          {fmt(Math.round(totals.totalAfterDiscount / billed))}/м²
                        </p>
                      ) : null
                    })()}
                  </div>
                </div>

                {/* Маржа и прибыль — итоговая строка */}
                {(() => {
                  const avgEm = Math.round(itemsAuto.reduce((s, i) => s + effectiveItemMargin(i, discount), 0) / itemsAuto.length)
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

                {/* Рекомендация по цене — рыночная аналитика для менеджера */}
                {(() => {
                  const target = strategy.target_margin || 40
                  const minM   = strategy.min_margin || 25
                  const avgEm  = Math.round(itemsAuto.reduce((s, i) => s + effectiveItemMargin(i, discount), 0) / itemsAuto.length)
                  const price  = totals.totalAfterDiscount
                  // Цена при целевой марже m (тот же расход): множитель по марже.
                  const priceAt = (m: number) => (avgEm >= 100 || m >= 100) ? price : Math.round(price * (100 - avgEm) / (100 - m))
                  type Rec = { tone: 'danger' | 'up' | 'room' | 'ok' | 'info'; head: string; text: string }
                  const recs: Rec[] = []
                  if (avgEm < minM) {
                    recs.push({ tone: 'danger', head: 'Ниже минимума', text: `Маржа ${avgEm}% ниже вашего минимума ${minM}% — работаете почти в ноль. Поднимите до ≈ ${fmt(priceAt(target))} (маржа ${target}%).` })
                  } else if (avgEm < target) {
                    recs.push({ tone: 'up', head: 'Можно дороже', text: `Маржа ${avgEm}% ниже целевой ${target}%. Есть смысл поднять до ≈ ${fmt(priceAt(target))} — рынок обычно принимает это при вашем сервисе.` })
                  } else if (avgEm > target + 12) {
                    recs.push({ tone: 'room', head: 'Есть запас для торга', text: `Маржа ${avgEm}% выше целевой — цена уверенная. Комфортно уступить до ≈ ${fmt(priceAt(target))} (${target}%), крайний предел ≈ ${fmt(priceAt(minM))} (${minM}%). Ниже не уходите — выигрываете сервисом, не демпингом.` })
                  } else {
                    recs.push({ tone: 'ok', head: 'В цель', text: `Маржа ${avgEm}% — здоровая, в целевом коридоре. Цена конкурентная и прибыльная. Предел торга ≈ ${fmt(priceAt(minM))} (${minM}%).` })
                  }
                  if (items.length > 1) {
                    const perPos = itemsAuto.map((i, idx) => ({ idx: idx + 1, m: effectiveItemMargin(i, discount), name: i.materialName }))
                    const worst = perPos.reduce((a, b) => b.m < a.m ? b : a)
                    if (worst.m < avgEm - 8) recs.push({ tone: 'info', head: `Позиция ${worst.idx}`, text: `${worst.name}: маржа ${worst.m}% — заметно ниже средней. Проверьте размер/скидку по ней.` })
                  }
                  if (totals.totalWeight > 150) recs.push({ tone: 'info', head: 'Крупный заказ', text: `${Math.round(totals.totalWeight)} кг — заложите логистику/подъём. Ради объёма такой заказ можно взять с чуть меньшей маржой.` })
                  const toneCls = (t: Rec['tone']) =>
                    t === 'danger' ? 'bg-red-50 text-red-700'
                    : t === 'up'   ? 'bg-amber-50 text-amber-800'
                    : t === 'room' || t === 'ok' ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-[#f5f5f4] text-[#6b6b66]'
                  return (
                    <div className="rounded-2xl border border-[#f6e4c4] bg-[#fff8ee] p-4 space-y-1.5">
                      <span className="text-[13px] font-semibold text-[#8a6d3b]">Рекомендация по цене</span>
                      {recs.slice(0, 3).map((r, i) => (
                        <div key={i} className={`text-[12px] leading-snug rounded-lg px-2.5 py-1.5 ${toneCls(r.tone)}`}>
                          <span className="font-semibold">{r.head}. </span>{r.text}
                        </div>
                      ))}
                      <p className="text-[10px] text-[#b0b0aa]">Ориентир — ваши целевые маржи; сравнение с ценами конкурентов добавим по их прайс-листу.</p>
                    </div>
                  )
                })()}

                <details className="group">
                  <summary className="text-[11px] font-medium text-[#9a9a95] cursor-pointer select-none list-none flex items-center gap-1.5">
                    <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                    Аналитика (только для менеджера)
                  </summary>
                  <div className="mt-3 space-y-1.5 border-t border-[#f0f0ec] pt-3 text-[13px]">
                    {/* Разбор себестоимости: из чего складывается (компоненты с НДС из calcItem) */}
                    {(() => {
                      const sum = (f: (i: B2BOrderItem) => number | undefined) => Math.round(items.reduce((s, i) => s + (f(i) ?? 0), 0))
                      const rows: [string, number][] = [
                        ['Материал (с отходом на раскрой)', sum(i => i.costMaterial)],
                        ['Закалка', sum(i => i.costTempering)],
                        ['Транспорт на закалку', sum(i => i.costTransport)],
                        ['Кромка / обработка', sum(i => i.costEdge)],
                        ['Фацет', sum(i => i.costFacet)],
                        ['Триплекс', sum(i => i.costTriplex)],
                        ['Упаковка', sum(i => i.costPackaging)],
                      ]
                      return (
                        <div className="rounded-lg bg-[#fafaf9] border border-[#f0f0ec] px-3 py-2 mb-2">
                          <p className="text-[10px] font-medium text-[#9a9a95] mb-1.5">Из чего складывается себестоимость</p>
                          {rows.filter(([, v]) => v > 0).map(([label, v]) => (
                            <div key={label} className="flex justify-between text-[12px] py-0.5">
                              <span className="text-[#6b6b66]">{label}</span>
                              <span className="font-mono text-[#111110]">{fmt(v)}</span>
                            </div>
                          ))}
                          <div className="flex justify-between text-[12px] py-0.5 border-t border-[#ecece8] mt-1 pt-1 font-semibold">
                            <span className="text-[#111110]">Итого себестоимость (с НДС)</span>
                            <span className="font-mono text-[#111110]">{fmt(totals.totalCostWithVat)}</span>
                          </div>
                          <div className="flex justify-between text-[12px] py-0.5">
                            <span className="text-[#9a9a95]">в т.ч. входной НДС (к вычету)</span>
                            <span className="font-mono text-[#9a9a95]">−{fmt(totals.totalInputVat)}</span>
                          </div>
                          {items.length > 1 && (
                            <details className="mt-1.5">
                              <summary className="text-[11px] text-[#9a9a95] cursor-pointer select-none">по позициям ▾</summary>
                              <div className="mt-1 space-y-1">
                                {items.map((i, idx) => {
                                  const parts: [string, number | undefined][] = [
                                    ['материал', i.costMaterial], ['закалка', i.costTempering], ['трансп.', i.costTransport],
                                    ['кромка', i.costEdge], ['фацет', i.costFacet], ['триплекс', i.costTriplex], ['упак.', i.costPackaging],
                                  ]
                                  const line = parts.filter(([, v]) => (v ?? 0) > 0).map(([n, v]) => `${n} ${fmt(v!)}`).join(' + ')
                                  return (
                                    <p key={i.localId} className="text-[11px] text-[#6b6b66]">
                                      <span className="font-semibold text-[#111110]">Поз. {idx + 1}</span> · {i.width}×{i.height} ×{i.quantity} · отход {i.wastePercent}%: {line} = <span className="font-mono text-[#111110]">{fmt(i.costWithVat)}</span>
                                    </p>
                                  )
                                })}
                              </div>
                            </details>
                          )}
                        </div>
                      )
                    })()}
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

                {totalMinPriceDelta > 0 && (
                  <div className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-amber-50 border border-amber-100">
                    <span className="text-[12px] text-amber-700">{items.filter(i => i.minPriceApplied).length} поз. с мин. ценой</span>
                    <span className="ml-auto text-[12px] font-semibold font-mono text-amber-800">+{fmt(totalMinPriceDelta)}</span>
                    <span className="text-[11px] text-amber-600">доп. выручка</span>
                  </div>
                )}

                {discount > maxDiscount && !isAdmin && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[12px] text-amber-700 font-medium">
                    ⚠️ Скидка клиента {discount}% превышает ваш ориентир {maxDiscount}%. Просчёт сохранится и сразу готов к запуску.
                  </div>
                )}

                {totalAfterDiscountWouldBreakMin && !isAdmin && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[12px] text-amber-700 font-medium">
                    ⚠️ Скидка снижает итог ниже минимальной стоимости позиций. Просчёт сохранится и сразу готов к запуску.
                  </div>
                )}
                {bomIssues.length > 0 && (
                  <div className={`rounded-lg px-3 py-2.5 text-[12px] border ${bomSummary.blocking > 0 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                    <p className="font-semibold mb-1">
                      {bomSummary.blocking > 0
                        ? `Нет в справочнике: ${bomSummary.blocking} ${bomSummary.blocking === 1 ? 'позиция' : 'позиций'} без себестоимости`
                        : 'Спецификация: есть замечания'}
                    </p>
                    <ul className="space-y-0.5">
                      {bomIssues.slice(0, 8).map((iss, n) => (
                        <li key={n} className={iss.severity === 'warn' ? 'opacity-75' : ''}>
                          Поз. {iss.itemIndex + 1}: {iss.detail}
                        </li>
                      ))}
                    </ul>
                    {bomIssues.length > 8 && <p className="mt-1 opacity-75">…и ещё {bomIssues.length - 8}</p>}
                    {bomSummary.blocking > 0 && (
                      <p className="mt-1.5 font-medium">Проверь позиции в справочнике до отправки клиенту — маржа по ним считается от нуля.</p>
                    )}
                  </div>
                )}

                {editingOrderId != null && (
                  <p className="text-[11px] text-[#9a9a95] text-center">Редактируется просчёт{ourOrderNumber ? ` №${ourOrderNumber}` : ''} — сохранится в ту же запись</p>
                )}
                <div className="flex gap-2">
                  <button type="button" disabled={!kpText}
                    onClick={() => { const el = document.getElementById('b2b-kp') as HTMLDetailsElement | null; if (el) { el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'center' }) } }}
                    className="flex-1 bg-white border border-[#d9d9df] text-[#1d1d1f] text-[14px] font-semibold py-3 rounded-xl hover:bg-[#f5f5f4] disabled:opacity-40 transition-colors">
                    Клиентский расчёт (КП)
                  </button>
                  <button onClick={handleSave} disabled={saving || !clientId || items.length === 0 || savedOrderId != null}
                    className="flex-1 bg-[#1d1d1f] text-white text-[14px] font-semibold py-3 rounded-xl hover:bg-black disabled:opacity-40 transition-colors">
                    {saving ? 'Сохранение...'
                      : savedOrderId != null ? (editingOrderId != null ? 'Обновлено ✓' : 'Сохранено ✓')
                      : !clientId ? 'Выберите клиента'
                      : editingOrderId != null ? 'Обновить просчёт' : 'Сохранить просчёт'}
                  </button>
                </div>

                {saveError && (
                  <div className="border border-red-200 bg-red-50 rounded-xl px-3 py-2.5 text-[12px] text-red-700">
                    <p className="font-semibold mb-0.5">Ошибка сохранения:</p>
                    <p className="font-mono break-all">{saveError}</p>
                  </div>
                )}

                {savedOrderId && (
                  <div className="border border-emerald-200 bg-emerald-50 rounded-xl p-3 flex flex-col gap-2">
                    <p className="text-[12px] font-semibold text-emerald-800">
                      {savedAsPending ? 'Просчёт сохранён и отправлен на согласование ✓' : 'Расчёт сохранён ✓'}
                    </p>
                    <p className="text-[11px] text-emerald-700">
                      Коммерческое предложение (PDF) скачивается в разделе «Просчёты» — там же хранится вся история расчётов.
                    </p>
                    <button
                      onClick={() => router.push('/b2b-quotes')}
                      className="w-full text-[12px] font-medium py-2 rounded-lg bg-[#1d1d1f] text-white hover:bg-black transition-colors">
                      Перейти к просчётам →
                    </button>
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
                      <summary className="text-[11px] font-medium text-[#9a9a95] cursor-pointer select-none list-none flex items-center gap-1.5">
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
                    <summary className="text-[11px] font-medium text-[#9a9a95] cursor-pointer select-none list-none flex items-center gap-1.5">
                      <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                      ✂️ Раскрой листов
                    </summary>
                    <div className="mt-3 space-y-2">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="border-b border-[#f0f0ec]">
                            <th className="text-left py-1.5 text-[#9a9a95] font-medium">Материал</th>
                            <th className="text-center py-1.5 text-[#9a9a95] font-medium w-20">Листов</th>
                            <th className="text-center py-1.5 text-[#9a9a95] font-medium w-28">Склад</th>
                            <th className="text-center py-1.5 text-[#9a9a95] font-medium w-24">Лист</th>
                            <th className="text-center py-1.5 text-[#9a9a95] font-medium w-16">КПД</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cuttingResults.map(r => (
                            <tr key={r.materialKey} className="border-b border-[#f0f0ec] last:border-0">
                              <td className="py-2 font-semibold text-[#111110]">
                                {r.materialLabel}
                                {r.patternDirection !== 'none' && (
                                  <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold align-middle">
                                    рисунок вдоль {r.patternDirection === 'along_length' ? 'длины' : 'ширины'}
                                  </span>
                                )}
                                {r.savedSheets > 0 && (
                                  <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-semibold align-middle"
                                    title={`Оптимальный формат сэкономил ${r.savedSheets} лист(ов) против ${r.baseSheetWidth}×${r.baseSheetHeight}`}>
                                    −{r.savedSheets} {r.savedSheets === 1 ? 'лист' : r.savedSheets < 5 ? 'листа' : 'листов'} vs {r.baseSheetWidth}×{r.baseSheetHeight}
                                  </span>
                                )}
                                {r.savedSheets === 0 && r.chosenNonDefault && (
                                  <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-[#eef0ee] text-[#6b6b66] text-[10px] font-medium align-middle">
                                    оптимальный формат
                                  </span>
                                )}
                              </td>
                              <td className="py-2 text-center font-bold text-blue-700">{r.sheetsNeeded}</td>
                              <td className="py-2 text-center">
                                {r.stockSheets <= 0 ? (
                                  <span className="text-[#c4c4be] text-[11px]" title="Остаток на складе не задан в справочнике">—</span>
                                ) : r.toBuy > 0 ? (
                                  <span className="inline-block px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-semibold"
                                    title={`На складе ${r.stockSheets}, нужно ${r.sheetsNeeded} — докупить ${r.toBuy}`}>
                                    докупить {r.toBuy} <span className="font-normal">(склад {r.stockSheets})</span>
                                  </span>
                                ) : (
                                  <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-medium"
                                    title={`На складе ${r.stockSheets} — хватает на ${r.sheetsNeeded}`}>
                                    склад {r.stockSheets} ✓
                                  </span>
                                )}
                              </td>
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
                      {cuttingResults.reduce((s, r) => s + (r.stockSheets > 0 ? r.toBuy : 0), 0) > 0 && (
                        <p className="text-[11px] text-red-600 font-medium">
                          Не хватает на складе: докупить {cuttingResults.reduce((s, r) => s + (r.stockSheets > 0 ? r.toBuy : 0), 0)} лист(ов) по материалам с дефицитом.
                        </p>
                      )}
                      {cuttingResults.reduce((s, r) => s + r.savedSheets, 0) > 0 && (
                        <p className="text-[11px] text-emerald-700 font-medium">
                          Экономия за счёт выбора формата листа: −{cuttingResults.reduce((s, r) => s + r.savedSheets, 0)} лист(ов) против дефолтного формата.
                        </p>
                      )}
                      <p className="text-[11px] text-[#9a9a95]">
                        Зазор 2 мм · Кромка 2 мм
                        {cuttingResults.some(r => r.patternDirection !== 'none')
                          ? ' · ⚠ У фактурных листов поворот детали запрещён (рисунок направлен)'
                          : ' · Поворот разрешён'}
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
      // Живой пересчёт: сумма позиции обновляется по мере изменения полей.
      const ePreviewItem   = eCanSave
        ? { ...computeQuoteItem({
            material: eSelectedMat!, width: Number(eWidth), height: Number(eHeight), quantity: Number(eQty) || 1,
            wastePercent: eWaste, hasTempering: eTempering,
            resolvedServices: resolveSvcs(services.filter(s => eServiceIds.includes(s.id)), eTierSel, eFilmSel),
            hasFacet: eFacet, facetTypeMm: eFacet ? eFacetMm : null,
            hasHoles: eHoles, shape: eCurved ? 'curved' : 'rect', hasSandblast: eSandblast,
            hasTriplex: eTriplex, triplexLayers: eTriplexLayers, triplexPrice,
            triplexExtraGlasses: eTriplex ? triplexExtras(eSelectedMat, eTriplexLayers, eTriplexMat2, eTriplexMat3) : [],
            applyMinPrice: eMinPrice,
            dismissedSurcharges: eDismissedSurcharges,
          }, { facetPrices, surchargeRules }), localId: '' }
        : null
      const ePreviewTotal  = ePreviewItem ? Math.round(ePreviewItem.saleIncVat * (1 - discount / 100)) : null
      const ePreviewMargin = ePreviewItem ? effectiveItemMargin(ePreviewItem, discount) : null

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
                <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Материал</label>
                <div className="flex gap-1.5">
                  {SUPER_CATS.filter(s => materials.some(m => (s.cats as readonly string[]).includes(m.category))).map(s => (
                    <button key={s.value} onClick={() => handleEditSuperCatChange(s.value)}
                      className={`flex-1 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${eSuperCat === s.value ? 'bg-[#1d1d1f] text-white' : 'bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4]'}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Толщина + Тип */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Толщина</label>
                  <select
                    className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110]"
                    value={eThickness ?? ''}
                    onChange={e => handleEditThicknessChange(Number(e.target.value))}>
                    {eAvailThick.map(t => <option key={t} value={t}>{t} мм</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Тип</label>
                  <select
                    className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] text-[#111110] outline-none focus:border-[#111110]"
                    value={eMatId ?? ''}
                    onChange={e => handleEditMatChange(Number(e.target.value))}>
                    {eThickMats.map(m => <option key={m.id} value={m.id}>{m.supplier_material_name ? `${m.name} (${m.supplier_material_name})` : m.name}</option>)}
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
                <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Размеры и количество</label>
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
                  <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">
                    Отход
                    <span className="ml-1 normal-case font-normal text-emerald-600 text-[10px]">
                      {eSelectedMat?.passthrough ? 'фикс.' : 'по раскрою'}
                    </span>
                  </label>
                  {eSelectedMat?.passthrough ? (
                    <div className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] text-orange-600 font-semibold">
                      10% — проходной
                    </div>
                  ) : (
                    <div className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] text-[#6e6e73]">
                      авто по раскрою
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Опции</label>
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
                    <label className={`flex items-center gap-2 h-[34px] px-3 border rounded-lg cursor-pointer transition-all ${eHoles ? 'border-blue-300 bg-blue-50' : 'border-[#e4e4e0] hover:border-[#c4c4be]'}`}>
                      <input type="checkbox" checked={eHoles} onChange={e => setEHoles(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-[#111110]" />
                      <span className={`text-[13px] ${eHoles ? 'text-blue-700 font-medium' : 'text-[#111110]'}`}>Сверловка</span>
                    </label>
                    <label className={`flex items-center gap-2 h-[34px] px-3 border rounded-lg cursor-pointer transition-all ${eCurved ? 'border-teal-300 bg-teal-50' : 'border-[#e4e4e0] hover:border-[#c4c4be]'}`}>
                      <input type="checkbox" checked={eCurved} onChange={e => setECurved(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-[#111110]" />
                      <span className={`text-[13px] ${eCurved ? 'text-teal-700 font-medium' : 'text-[#111110]'}`}>Криволинейка</span>
                    </label>
                    <label className={`flex items-center gap-2 h-[34px] px-3 border rounded-lg cursor-pointer transition-all ${eSandblast ? 'border-violet-300 bg-violet-50' : 'border-[#e4e4e0] hover:border-[#c4c4be]'}`}>
                      <input type="checkbox" checked={eSandblast} onChange={e => setESandblast(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-[#111110]" />
                      <span className={`text-[13px] ${eSandblast ? 'text-violet-700 font-medium' : 'text-[#111110]'}`}>Песочка</span>
                    </label>
                    <label className={`flex items-center gap-2 h-[34px] px-3 border rounded-lg cursor-pointer transition-all ${eMinPrice ? 'border-emerald-300 bg-emerald-50' : 'border-[#e4e4e0] hover:border-[#c4c4be]'}`}>
                      <input type="checkbox" checked={eMinPrice} onChange={e => setEMinPrice(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-[#111110]" />
                      <span className={`text-[13px] ${eMinPrice ? 'text-emerald-700 font-medium' : 'text-[#111110]'}`}>{eMinPrice ? 'Мин. цена' : 'Без мин.'}</span>
                    </label>
                  </div>
                </div>
                <div className="mt-2">
                  <div className="flex items-center gap-2">
                    <label className={`flex items-center gap-2 flex-1 h-[34px] px-3 border rounded-lg cursor-pointer transition-all ${eTriplex ? 'border-indigo-300 bg-indigo-50' : 'border-[#e4e4e0]'}`}>
                      <input type="checkbox" checked={eTriplex} onChange={e => setETriplex(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-[#111110]" />
                      <span className={`text-[13px] ${eTriplex ? 'text-indigo-700 font-medium' : 'text-[#111110]'}`}>Триплекс</span>
                    </label>
                    {eTriplex && (
                      <select
                        className="h-[34px] bg-white border border-indigo-200 rounded-lg px-2 text-[12px] outline-none focus:border-indigo-400"
                        value={eTriplexLayers} onChange={e => setETriplexLayers(Number(e.target.value) === 3 ? 3 : 2)}>
                        <option value={2}>2 стекла</option>
                        <option value={3}>3 стекла</option>
                      </select>
                    )}
                  </div>
                  {eTriplex && (() => {
                    const glassCats = SUPER_CATS[0].cats as readonly string[]
                    const glassOpts = materials.filter(m => glassCats.includes(m.category) && (m.sale_price ?? 0) > 0)
                      .sort((a, b) => a.thickness - b.thickness || a.name.localeCompare(b.name))
                    const layerSelect = (val: number | null, set: (v: number | null) => void, label: string) => (
                      <select
                        className="mt-1.5 w-full bg-white border border-indigo-200 rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-indigo-400"
                        value={val ?? ''} onChange={e => set(e.target.value === '' ? null : Number(e.target.value))}>
                        <option value="">{label}: как основное</option>
                        {glassOpts.map(m => <option key={m.id} value={m.id}>{label}: {m.name} {m.thickness} мм</option>)}
                      </select>
                    )
                    return (
                      <>
                        {layerSelect(eTriplexMat2, setETriplexMat2, 'Стекло 2')}
                        {eTriplexLayers === 3 && layerSelect(eTriplexMat3, setETriplexMat3, 'Стекло 3')}
                      </>
                    )
                  })()}
                </div>
              </div>

              {/* Доп. услуги */}
              {services.length > 0 && (
                <div>
                  <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Доп. услуги</label>
                  <div className="border border-[#e4e4e0] rounded-lg overflow-hidden">
                    {visibleServices.map(s => {
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

              {/* Авто-надбавки за габариты/сложность */}
              {(() => {
                const applicable = applicableSurcharges({ width: Number(eWidth) || 0, height: Number(eHeight) || 0, shape: eCurved ? 'curved' : 'rect' }, surchargeRules)
                if (applicable.length === 0) return null
                return (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 space-y-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[11px] font-semibold text-amber-800">⚙️ Надбавки за габариты</span>
                    </div>
                    {applicable.map(r => {
                      const on = !eDismissedSurcharges.has(r.id)
                      return (
                        <label key={r.id} className="flex items-center gap-2 cursor-pointer select-none">
                          <input type="checkbox" checked={on}
                            onChange={() => setEDismissedSurcharges(prev => { const n = new Set(prev); if (on) n.add(r.id); else n.delete(r.id); return n })}
                            className="w-3 h-3 rounded accent-amber-600 flex-shrink-0" />
                          <span className="text-[12px] text-[#111110] flex-1 leading-tight">{r.label}</span>
                          <span className="text-[11px] font-mono font-semibold text-amber-700 flex-shrink-0">+{r.surcharge_percent}%</span>
                        </label>
                      )
                    })}
                  </div>
                )
              })()}

              {/* Комментарий */}
              <div>
                <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Комментарий</label>
                <input type="text" maxLength={120}
                  className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[12px] text-[#111110] outline-none focus:border-[#111110]"
                  value={eComment} onChange={e => setEComment(e.target.value)}
                  placeholder="Комментарий к позиции..." />
              </div>

              {/* Живой пересчёт суммы позиции */}
              {ePreviewTotal !== null && (
                <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-[#f8f8f7] border border-[#e8e8e4]">
                  <span className="text-[10px] font-medium text-[#8a8a85]">Итого позиции{discount > 0 ? ` (−${discount}%)` : ''}</span>
                  <span className="flex items-center gap-2">
                    <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${marginBadgeClass(ePreviewMargin!)}`}>{ePreviewMargin}%</span>
                    <span className="text-[16px] font-bold font-mono text-[#111110]">{ePreviewTotal.toLocaleString('ru-RU')} ₽</span>
                  </span>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={() => { const id = editingLocalId; cancelEdit(); if (id) removeItem(id) }}
                  title="Удалить позицию"
                  className="py-2.5 px-3 rounded-lg border border-red-200 text-[13px] font-medium text-red-500 hover:bg-red-50 transition-colors">
                  Удалить
                </button>
                <button onClick={cancelEdit}
                  className="flex-1 py-2.5 rounded-lg border border-[#e4e4e0] text-[13px] font-medium text-[#6b6b66] hover:bg-[#f8f8f7] transition-colors">
                  Отмена
                </button>
                <button onClick={saveEdit} disabled={!eCanSave}
                  className="flex-1 py-2.5 rounded-lg bg-[#1d1d1f] text-white text-[13px] font-semibold hover:bg-black disabled:opacity-40 transition-colors">
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
                <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Название компании *</label>
                <input
                  type="text" placeholder="ООО Ромашка"
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]"
                  value={ncName} onChange={e => setNcName(e.target.value)} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Контактное лицо</label>
                <input
                  type="text" placeholder="Иван Иванов"
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]"
                  value={ncContact} onChange={e => setNcContact(e.target.value)} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Телефон</label>
                <input
                  type="text" placeholder="+7 999 000 00 00"
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]"
                  value={ncPhone} onChange={e => setNcPhone(e.target.value)} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Скидка %</label>
                <input
                  type="number" min="0" max="50" step="1"
                  className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]"
                  value={ncDiscount} onChange={e => setNcDiscount(Number(e.target.value))} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#6e6e73] mb-1">Комментарий</label>
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
