'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast, sendOrToast } from '@/lib/toast'
import { useAmoLeadFromUrl } from '@/lib/useAmoLead'
import { AmoLeadBanner } from '@/components/AmoLeadBanner'
import { M_MODELS, getModel } from '@/lib/configurator/arrangement'
import { FINISHES, type FinishId } from '@/lib/configurator/catalog'
import { Partition3DView } from '@/components/configurator/Partition3DView'
import type { MDims, GlassTint, HardwareChoice, MVariant } from '@/components/configurator/scene/assembly'
import { ROLE_META, type KitChoices, type RoleId } from '@/lib/configurator/kit'
import { calcFinancialModel, savedProfit } from '@/lib/pricing/financialModel'
import { FINANCE_FALLBACK } from '@/lib/pricing/pickFinance'
import { MirrorPanel, type MirrorModel, type MirrorMaterial } from './MirrorPanel'
import { kpSectionsFromBom, type BomItem } from '@/lib/kp/bomSections'
import { drawingToRequest, type DrawingApply, type ShowerDrawingParse } from '@/lib/calc/drawingParse'
import { targetLight, type TargetLight } from '@/lib/pricing/orderFunds'
import type { LeadOpen } from '@/lib/calc/leadToBuild'

// Вкладка «Расчёт» — два экрана. Экран 1: только выбор модели. Экран 2: слева крупный
// настоящий 3D-визуализатор, справа параметры (габариты → стекло/цвет фурнитуры →
// варианты фурнитуры ЭТОЙ модели из kit.slots) и цена, всё пересчитывается сразу.
// Сцена перестраивается на изменение пропсов; цена считается отдельно (debounce), чтобы
// тяжёлый 3D не дёргался на каждый символ. Фурнитура — реальный BOM, стекло — B2B (роут
// /api/calc/build). Внизу «Добавить ещё изделие» и «Сохранить» → КП.

const THICKNESS = 8
// Владелец: в бюджете пока только хром и чёрный матовый. Белый убран.
const BUDGET_FINISHES = new Set(['chrome', 'black'])
const finishOptions = FINISHES.filter(f => BUDGET_FINISHES.has(f.id))

type GlassType = { id: string; label: string; b2b: string; swatch: string; tint: GlassTint }
// Порядок раскладки владельца (сетка 3 в ряд):
//   прозрачное · осветлённое · графит
//   матовое    · матовое осв. · бронза
// Бронза и графит — одна позиция справочника «Тонированное (бронза/графит)»:
// цвет на цену не влияет, толщина влияет; различается только вид в 3D.
// Матовые — кислотное травление; неосветлённое ходит в справочнике как
// «Сатинированное бесцветное» (имя не по бренду AGC).
const GLASS_TYPES: GlassType[] = [
  { id: 'clear',    label: 'Прозрачное',  b2b: 'Прозрачное М1',            swatch: '#cfe3d3', tint: { color: '#ffffff', attenuation: '#b8d8c4', distance: 3.5 } },
  { id: 'crystal',  label: 'Осветлённое', b2b: 'Осветлённое CrystalVision', swatch: '#dfeaf6', tint: { color: '#ffffff', attenuation: '#cfe4f2', distance: 6.0 } },
  { id: 'graphite', label: 'Графит',      b2b: 'Тонированное (бронза/графит)', swatch: '#7f858b', tint: { color: '#b9bec4', attenuation: '#4f555d', distance: 1.1 } },
  { id: 'matte',    label: 'Матовое',     b2b: 'Сатинированное бесцветное', swatch: '#dfe2dd', tint: { color: '#f2f5f1', attenuation: '#d8e0d8', distance: 2.2, roughness: 0.55 } },
  { id: 'matte-crystal', label: 'Матовое осветл.', b2b: 'CrystalVision Matelux', swatch: '#e6ecef', tint: { color: '#f6f9fa', attenuation: '#e2ecf2', distance: 3.2, roughness: 0.55 } },
  { id: 'bronze',   label: 'Бронза',      b2b: 'Тонированное (бронза/графит)', swatch: '#b0895c', tint: { color: '#d6bd97', attenuation: '#7a5836', distance: 1.2 } },
]

// Фото модели (public/models/<латиница>.jpg) — каталожные рендеры владельца, все девять есть.
const PHOTO = new Set(['М1', 'М2', 'М4', 'М7', 'М8', 'М9', 'М10', 'М11', 'М12'])
const photoSlug = (code: string) => code.replace('М', 'M').toLowerCase()

const RUB = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const numOr = (v: string) => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return isFinite(n) ? n : 0 }
const midV = ([a, b]: [number, number]) => Math.round((a + b) / 200) * 100

type KitLine = {
  role: string; label: string; qty: number; unit: string; unitPrice: number; total: number
  plan?: { len: number; price: number; pieces: number[]; rest: number }[]
  ref?: { supplier: string; base: string; asOf?: string }; chromeFallback?: boolean
}
type GlassLine = { index?: number; label: string; w: number; h: number; areaM2: number; pricePerM2: number; listTotal: number; total: number; minPriceApplied: boolean }
type Price = {
  glassCost: number; hardwareCost: number; sections: number; lines: KitLine[]
  glassLines?: GlassLine[]; glassSource?: string | null; glassThickness?: number; glassDiscountPct?: number
  missing: { label: string; reason: string }[]; complete: boolean
  marginPct?: number; taxPct?: number; marginSource?: 'модель' | 'тариф'
  glassSubstituted?: string | null
  stops?: Stop[]; notes?: Stop[]
  target?: { price: number; amberPrice: number; source: 'модель' | 'план CFO' } | null
}
// Светофор «остаётся с заказа» (Ш1): менеджер видит цвет и цену для цели, разбор фондов — в /cfo.
const LIGHT: Record<TargetLight, { dot: string; text: string }> = {
  green: { dot: 'bg-emerald-500', text: 'в цели' },
  amber: { dot: 'bg-amber-500', text: 'ниже цели' },
  red: { dot: 'bg-red-500', text: 'сильно ниже цели — согласовать' },
}
type Stop = { kind: string; text: string }
// Без чертежа менеджер прикидывает цену: «проверь отверстие на чертеже» ему не к чему.
// Тяжёлая дверь и кусок длиннее хлыста — остановка в любом расчёте.
const ALWAYS_STOP = new Set(['door-weight', 'oversize'])
// marks — янтарные метки на момент расчёта («цена хрома», «стекло подменено»): сумма есть,
// но взята не та цена. Сохраняются с расчётом, чтобы закупка видела их и потом.
// req — параметры душевой, по которым считали: корзина = заказ, общий раскрой профиля и
// трубы на все душевые заказа пересчитывается по ним (у зеркал req нет).
type ShowerReq = { model: string; dims: MDims; finishId: string; choice: Record<string, string>; qtyChoice: Record<string, number>; variant?: MVariant }
// bom — состав душевой названиями (без цен): из него собирается лист 3 КП.
type CartItem = { title: string; cost: number; productPrice: number; install: number; delivery: number; lift: number; total: number; marks?: string[]; stops?: string[]; req?: ShowerReq; bom?: BomItem }
type OrderCut = { saving: number; cuts: { name: string; finishId: string; perItemBars: number; pooledBars: number; saving: number }[] }

const SUPPLIER: Record<string, string> = { av24: 'АВ24', vetro: 'Ветро' }
const dateRu = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`
const metres = (mm: number) => `${(mm / 1000).toLocaleString('ru-RU')} м`

// Раскрой хлыстов строкой: «хлыст 3 м ×1: 916+802+399+399 → остаток 484 мм ≈ 128 ₽».
// Хлысты одной длины — в одну строку; остаток в рублях — доля цены хлыста.
function cutText(plan: NonNullable<KitLine['plan']>): string[] {
  const byLen = new Map<number, typeof plan>()
  for (const b of plan) byLen.set(b.len, [...(byLen.get(b.len) ?? []), b])
  return [...byLen.entries()].map(([len, bars]) => {
    const rest = bars.reduce((s, b) => s + Math.max(0, b.rest), 0)
    const restRub = bars.reduce((s, b) => s + (b.len > 0 ? Math.max(0, b.rest) / b.len * b.price : 0), 0)
    const cuts = bars.map(b => b.pieces.map(Math.round).join('+')).join(' · ')
    return `хлыст ${metres(len)} ×${bars.length}: ${cuts} → остаток ${Math.round(rest)} мм${restRub >= 1 ? ` ≈ ${RUB(restRub)}` : ''}`
  })
}

function priceMarks(p: Price | null): string[] {
  if (!p) return []
  const out = (p.lines ?? []).filter(l => l.chromeFallback).map(l => `цена хрома: ${l.label}`)
  if (p.glassSubstituted) out.push(`стекло подменено: ${p.glassSubstituted}`)
  return out
}

const fld = 'w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110]'
const lbl = 'block text-[11px] font-medium text-[#6e6e73] mb-1'

function defaultsFor(code: string): MDims {
  const c = getModel(code).constraints
  return {
    width: midV(c.width),
    height: Math.min(2000, c.height[1]),
    width2: c.needsWidth2 && c.width2 ? midV(c.width2) : undefined,
    doorWidth: c.doorWidth ? 600 : undefined,
  }
}

export default function BuildCalcPage() {
  const router = useRouter()
  const [screen, setScreen] = useState<'models' | 'detail'>('models')
  const [code, setCode] = useState('М2')
  const [dims, setDims] = useState<MDims>(() => defaultsFor('М2'))
  const [finishId, setFinishId] = useState<FinishId>('chrome')
  const [glassId, setGlassId] = useState('clear')
  const [doorOpen, setDoorOpen] = useState(true)
  const [kitChoices, setKitChoices] = useState<KitChoices | null>(null)
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [qtyChoice, setQtyChoice] = useState<Record<string, number>>({})
  // Расчёт по чертежу (Ч1): размеры панелей и артикулы, как они на чертеже. Пустое поле —
  // берётся из геометрии и комплекта. Расхождения — остановки до закалки, а не другая цена.
  const [byDrawing, setByDrawing] = useState(false)
  const [panelOver, setPanelOver] = useState<Record<number, { w?: string; h?: string }>>({})
  const [drawn, setDrawn] = useState<Record<string, string>>({})
  // ИИ-разбор чертежа (Ч2): какие душевые нашлись и какая применена — с «откуда взято».
  const [drawingOpts, setDrawingOpts] = useState<DrawingApply[]>([])
  const [drawingFrom, setDrawingFrom] = useState<DrawingApply | null>(null)
  const [drawingState, setDrawingState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [drawingErr, setDrawingErr] = useState<string | null>(null)
  const [showEvidence, setShowEvidence] = useState(false)

  const [price, setPrice] = useState<Price | null>(null)
  const [specGlass, setSpecGlass] = useState(false)
  const [specHw, setSpecHw] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  // Ключ параметров, под которые посчитана текущая цена. Пока не совпадает с текущими
  // параметрами — цена «не догнала», кнопки сохранения блокируем (иначе запишется новый
  // размер со старой ценой). Считаем от glass.b2b (а не glassId) — цена зависит от него.
  const [pricedKey, setPricedKey] = useState('')

  // Правая панель — числа владельца. Сброс к умолчаниям на новом изделии.
  // Маржа и налог по умолчанию приходят с ценой из /api/calc/build (financial_settings,
  // душевые «Бюджет»; своя маржа модели — если задана в прайсе душевых). Пока менеджер
  // не правил поле руками, оно следует за настройками — как в MirrorPanel.
  const [margin, setMargin] = useState(String(FINANCE_FALLBACK.marginPct))
  const [tax, setTax] = useState(String(FINANCE_FALLBACK.taxPct))
  const [financeSource, setFinanceSource] = useState<string | null>(null)
  // Ref, а не state: ответ может прийти после ручной правки, и замкнутый в эффекте
  // флаг перезаписал бы число менеджера.
  const marginTouched = useRef(false)
  const taxTouched = useRef(false)
  const [perSection, setPerSection] = useState('6500')
  const [delivery, setDelivery] = useState('5000')
  const [lift, setLift] = useState('')
  const [discount, setDiscount] = useState('0')
  // Заказ через известного партнёра (дизайнера): его доля — в цене для цели. На весь заказ.
  const [viaPartner, setViaPartner] = useState(false)

  const [cart, setCart] = useState<CartItem[]>([])
  const [orderCutAt, setOrderCutAt] = useState<{ key: string; cut: OrderCut } | null>(null)
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [objectAddress, setObjectAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const lastSavedSigRef = useRef('')
  // М1: обвязка профилем — «пол + стена» (по умолчанию) или по всему периметру.
  // Меняет BOM: периметр добавляет верхний профиль и свободную вертикаль.
  const [profileFrame, setProfileFrame] = useState<'partial' | 'perimeter'>('partial')
  // Пришли из карточки сделки (/calculator/build?deal=12) — расчёт кладём именно
  // в неё, а не оставляем на усмотрение авто-привязки по телефону.
  // Какой продукт считаем. Душевые — как было; зеркала строятся по маршруту
  // docs/MIRROR_CALC_ROUTE.md (сейчас готовы З1 подменю и З2 модели); лофт пока
  // ведёт на свой старый калькулятор — врать вкладкой «скоро» не нужно.
  const [product, setProduct] = useState<'shower' | 'mirror'>('shower')
  const [mirrorModels, setMirrorModels] = useState<MirrorModel[] | null>(null)
  const [mirrorMats, setMirrorMats] = useState<MirrorMaterial[]>([])
  const [mirrorPick, setMirrorPick] = useState<MirrorModel | null>(null)
  const [dealId, setDealId] = useState<number | null>(null)
  const [dealTitle, setDealTitle] = useState<string>('')
  // Пришли из заявки 3D-конструктора (/calculator/build?lead=7, Ш3): тот же состав, клиент и сделка.
  const [lead, setLead] = useState<{ id: number; line: string | null; open: LeadOpen } | null>(null)
  // Пустые поля клиента берём из сделки AmoCRM; вписанное руками не перебиваем.
  const amo = useAmoLeadFromUrl(lead => {
    setClientName(v => v || lead.contactName)
    setClientPhone(v => v || lead.phone)
  })
  const amoLeadId = amo.lead?.id ?? null

  const model = getModel(code)
  const isCorner = model.constraints.needsWidth2
  const isWalkin = model.shape === 'walkin'   // М1: вводится размер панели, не проёма
  const finish = FINISHES.find(f => f.id === finishId) ?? FINISHES[0]
  const glass = GLASS_TYPES.find(g => g.id === glassId) ?? GLASS_TYPES[0]
  // glassSpan: 'panel' — в просчёте вводят размер САМОЙ панели. На сайте у walk-in
  // вводят проём и стекло закрывает его часть; менеджер заказывает стекло, не проём.
  const mVariant = useMemo<MVariant>(
    () => (code === 'М1' ? { mount: 'perp90', profileFrame, glassSpan: 'panel' } : {}),
    [code, profileFrame])
  const drawingReq = useMemo(() => {
    if (!byDrawing) return {}
    const n = Math.max(-1, ...Object.keys(panelOver).map(Number)) + 1
    const panels = Array.from({ length: n }, (_, i) => {
      const w = numOr(panelOver[i]?.w ?? ''), h = numOr(panelOver[i]?.h ?? '')
      return w > 0 || h > 0 ? { w, h } : null
    })
    const marked = Object.fromEntries(Object.entries(drawn).map(([r, v]) => [r, v.trim()]).filter(([, v]) => v))
    return { ...(panels.some(Boolean) ? { panels } : {}), ...(Object.keys(marked).length ? { drawn: marked } : {}) }
  }, [byDrawing, panelOver, drawn])
  const orderItems = cart.length + 1
  const paramsKey = useMemo(() => JSON.stringify({ code, dims, finishId, g: glass.b2b, choice, qtyChoice, mVariant, drawingReq, viaPartner, orderItems }), [code, dims, finishId, glass.b2b, choice, qtyChoice, mVariant, drawingReq, viaPartner, orderItems])
  const priceDirty = pricedKey !== paramsKey   // цена ещё не догнала параметры

  function pickModel(c: string) {
    setCode(c); setDims(defaultsFor(c)); setChoice({}); setQtyChoice({}); setKitChoices(null); setPrice(null)
    setByDrawing(false); setPanelOver({}); setDrawn({}); setDrawingFrom(null); setDrawingOpts([])
    marginTouched.current = false; taxTouched.current = false
    setMargin(String(FINANCE_FALLBACK.marginPct)); setTax(String(FINANCE_FALLBACK.taxPct)); setPerSection('6500'); setLift(''); setDiscount('0')
    // Доставка одна на заказ: если она уже есть у изделия в корзине, второй раз не берём.
    setDelivery(cart.some(i => i.delivery > 0) ? '0' : '5000')
    setProfileFrame('partial')
    setScreen('detail')
  }
  const setD = <K extends keyof MDims>(k: K, v: MDims[K]) => setDims(d => ({ ...d, [k]: v }))

  // Прочитанное с чертежа ставится в поля «Расчёта»; цену считает тот же /api/calc/build.
  // Другая модель — как выбор карточки (сброс вариантов и чисел), затем значения чертежа.
  function applyDrawing(a: DrawingApply, all: DrawingApply[]) {
    const c = a.code ?? code
    if (c !== code || screen === 'models') pickModel(c)
    setDims({ ...defaultsFor(c), ...a.dims })
    if (a.finishId && BUDGET_FINISHES.has(a.finishId)) setFinishId(a.finishId as FinishId)
    if (a.glassId && GLASS_TYPES.some(g => g.id === a.glassId)) setGlassId(a.glassId)
    setDrawn(a.drawn); setPanelOver({}); setByDrawing(true)
    setDrawingFrom(a); setDrawingOpts(all); setProduct('shower')
  }
  async function parseDrawing(file: File) {
    setDrawingState('loading'); setDrawingErr(null)
    const fd = new FormData(); fd.append('file', file)
    try {
      const r = await fetch('/api/ai/parse-shower-drawing', { method: 'POST', body: fd })
      const d = await r.json().catch(() => null) as { parsed?: ShowerDrawingParse; detail?: string } | null
      if (!r.ok || !d?.parsed) { setDrawingState('error'); setDrawingErr(d?.detail ?? 'Чертёж не разобран — введите размеры вручную.'); return }
      const all = (d.parsed.showers ?? []).map(drawingToRequest)
      if (!d.parsed.is_shower_drawing || all.length === 0) { setDrawingState('error'); setDrawingErr('На файле не нашлось душевой — введите размеры вручную.'); return }
      setDrawingState('idle')
      applyDrawing(all[0], all)
    } catch { setDrawingState('error'); setDrawingErr('Чертёж не отправлен — проверьте сеть.') }
  }
  const drawingUpload = (
    <label className={`inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[#111110] text-[#111110] cursor-pointer hover:bg-[#f0f0ec] ${drawingState === 'loading' ? 'opacity-50 pointer-events-none' : ''}`}>
      {drawingState === 'loading' ? 'Читаю чертёж…' : 'Загрузить чертёж (PDF/фото)'}
      <input type="file" accept="application/pdf,image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void parseDrawing(f) }} />
    </label>
  )

  useEffect(() => {
    if (product !== 'mirror' || mirrorModels) return
    ;(async () => {
      try {
        const r = await fetch('/api/calc/mirror/models')
        const j = await r.json().catch(() => ({}))
        if (r.ok) { setMirrorModels(j.models ?? []); setMirrorMats(j.materials ?? []) }
        else setMirrorModels([])
      } catch { setMirrorModels([]) }
    })()
  }, [product, mirrorModels])

  // Расчёт «в сделку»: id из адреса, поля клиента — из самой сделки, чтобы КП и
  // привязка шли по её данным, а не переписывались руками.
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('deal')
    const id = Number(raw)
    if (!Number.isFinite(id) || id <= 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDealId(id)
    ;(async () => {
      try {
        const r = await fetch(`/api/deals/${id}`)
        const j = await r.json().catch(() => ({}))
        if (!r.ok || !j.deal) return
        setClientName(j.deal.client_name ?? ''); setClientPhone(j.deal.phone ?? ''); setObjectAddress(j.deal.address ?? '')
        setDealTitle([j.deal.client_name, j.deal.address].filter(Boolean).join(' · ') || `сделка #${id}`)
      } catch { /* ignore */ }
    })()
  }, [])

  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get('lead'))
    if (!Number.isFinite(id) || id <= 0) return
    ;(async () => {
      try {
        const r = await fetch(`/api/deals/site-lead/${id}`)
        const j = await r.json().catch(() => ({})) as {
          lead?: { id: number; name: string; phone: string; line: string | null }
          deal?: { id: number; title: string } | null
          open?: LeadOpen | null
          error?: string
        }
        if (!r.ok || !j.lead) { toast.error(j.error ?? 'Заявка не открылась'); return }
        setClientName(v => v || j.lead!.name); setClientPhone(v => v || j.lead!.phone)
        if (j.deal) { setDealId(j.deal.id); setDealTitle(j.deal.title) }
        const o = j.open
        if (!o) return
        const notes = [...o.notes]
        if (!BUDGET_FINISHES.has(o.finishId)) notes.push(`цвет с сайта «${FINISHES.find(f => f.id === o.finishId)?.label ?? o.finishId}» в «Расчёте» не заведён — стоит хром`)
        if (!GLASS_TYPES.some(g => g.id === o.glassId)) notes.push(`стекла «${o.glassId}» в «Расчёте» нет — стоит прозрачное`)
        setProduct('shower'); setCode(o.code); setDims({ ...defaultsFor(o.code), ...o.dims })
        setFinishId(BUDGET_FINISHES.has(o.finishId) ? o.finishId as FinishId : 'chrome')
        setGlassId(GLASS_TYPES.some(g => g.id === o.glassId) ? o.glassId : 'clear')
        setChoice(o.choice); setQtyChoice(o.qtyChoice); setProfileFrame(o.profileFrame)
        setLead({ id: j.lead.id, line: j.lead.line, open: { ...o, notes } })
        setScreen('detail')
      } catch { toast.error('Заявка не открылась — проверьте сеть') }
    })()
  }, [])

  // Восстановление сохранённого расчёта (история «Открыть» → mglass_build_reopen): владелец
  // просил «расчёт можно открыть и пересчитать». Возвращаем модель, габариты, стекло/цвет,
  // выбор фурнитуры, параметры цены и корзину, открываем экран изделия.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('mglass_build_reopen')
      if (!raw) return
      sessionStorage.removeItem('mglass_build_reopen')
      const p = JSON.parse(raw) as Record<string, unknown>
      const s = (k: string, f: (v: string) => void) => { if (p[k] != null) f(String(p[k])) }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (p.code) setCode(String(p.code))
      if (p.dims && typeof p.dims === 'object') setDims(p.dims as MDims)
      // Белый убран из бюджета: старый сохранённый расчёт на нём не должен воскрешать
      // цвет, которого больше нет в выборе.
      if (p.finishId && BUDGET_FINISHES.has(String(p.finishId))) setFinishId(p.finishId as FinishId)
      if (p.glassId) setGlassId(String(p.glassId))
      if (p.profileFrame === 'partial' || p.profileFrame === 'perimeter') setProfileFrame(p.profileFrame)
      if (p.choice && typeof p.choice === 'object') setChoice(p.choice as Record<string, string>)
      if (p.qtyChoice && typeof p.qtyChoice === 'object') setQtyChoice(p.qtyChoice as Record<string, number>)
      if (p.byDrawing === true) setByDrawing(true)
      if (p.panelOver && typeof p.panelOver === 'object') setPanelOver(p.panelOver as Record<number, { w?: string; h?: string }>)
      if (p.drawn && typeof p.drawn === 'object') setDrawn(p.drawn as Record<string, string>)
      if (p.drawingFrom && typeof p.drawingFrom === 'object') setDrawingFrom(p.drawingFrom as DrawingApply)
      // Сохранённые маржа и налог — решение по этому расчёту: настройки их не перебивают.
      if (p.partner === true) setViaPartner(true)
      if (p.margin != null) marginTouched.current = true
      if (p.tax != null) taxTouched.current = true
      s('margin', setMargin); s('tax', setTax); s('perSection', setPerSection); s('delivery', setDelivery); s('lift', setLift); s('discount', setDiscount)
      s('clientName', setClientName); s('clientPhone', setClientPhone); s('objectAddress', setObjectAddress)
      if (Array.isArray(p.cart)) setCart(p.cart as CartItem[])
      setScreen('detail')
    } catch { /* ignore */ }
  }, [])

  // Варианты фурнитуры ЭТОЙ модели — из комплекта (kit.slots) через /options. Только то,
  // что реально выбирается; набор ролей зависит от геометрии, поэтому дёргаем на смену размеров.
  useEffect(() => {
    if (screen !== 'detail') return
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      fetch('/api/configurator/options', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ model: code, dims, thickness: THICKNESS, tier: 'budget', variant: mVariant }),
      }).then(r => (r.ok ? r.json() : null)).then((d: KitChoices | null) => {
        if (!d) return
        setKitChoices(d)
        setChoice(prev => { const n = { ...prev }; for (const v of d.variants) if (!v.options.some(o => o.itemId === n[v.role])) { const p = v.options.find(o => o.primary) ?? v.options[0]; if (p) n[v.role] = p.itemId } return n })
        setQtyChoice(prev => { const n = { ...prev }; for (const q of d.quantities) if (!q.options.includes(n[q.role])) n[q.role] = q.def; return n })
      }).catch(() => {})
    }, 250)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [screen, code, dims, mVariant])

  // Выбор с сайта, которого нет среди вариантов «Расчёта» (премиум, снятая позиция), заменён ★ — называем.
  const leadMiss = useMemo(() => !lead || !kitChoices || code !== lead.open.code ? [] :
    Object.entries(lead.open.choice).filter(([r, id]) => kitChoices.variants.some(v => v.role === r && !v.options.some(o => o.itemId === id)))
      .map(([r]) => `${ROLE_META[r as RoleId]?.label ?? r}: выбранной на сайте позиции нет в вариантах «Расчёта» — стоит ★`),
  [lead, kitChoices, code])

  // Форма выбранной позиции → 3D (петля/ручка); нет выбора → форма из комплекта модели.
  const hwChoice = useMemo<HardwareChoice>(() => {
    const shapeOf = (role: string) =>
      kitChoices?.variants.find(v => v.role === role)?.options.find(o => o.itemId === choice[role])?.shape
      ?? kitChoices?.forms.find(f => f.role === role)?.shape
    return { hinge: shapeOf('hinge'), handle: shapeOf('handle') }
  }, [kitChoices, choice])

  // Цена — с сервера (/api/calc/build): фурнитура BOM + стекло B2B. Отдельно от сцены,
  // debounce — тяжёлый 3D не дёргается на каждый символ в габаритах.
  useEffect(() => {
    if (screen !== 'detail') return
    const w = numOr(String(dims.width)), h = numOr(String(dims.height))
    const key = paramsKey   // под какие параметры считаем — фиксируем на момент запроса
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      if (w <= 0 || h <= 0) { setPrice(null); setState('idle'); return }
      setState('loading')
      fetch('/api/calc/build', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ model: code, thickness: THICKNESS, finishId, glassType: glass.b2b, dims, choice, qtyChoice, variant: mVariant, ...drawingReq, partner: viaPartner, orderItems }),
      }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((res: { full?: boolean; price?: Price }) => {
          // Только последний запрос доживает (остальные оборваны abort), значит key актуален.
          if (res.full && res.price) {
            const pr = res.price
            if (pr.marginPct != null && !marginTouched.current) setMargin(String(pr.marginPct))
            if (pr.taxPct != null && !taxTouched.current) setTax(String(pr.taxPct))
            if (pr.marginSource) setFinanceSource(pr.marginSource === 'модель' ? 'маржа модели из прайса душевых, налог — финансовые настройки' : 'финансовые настройки, душевые «Бюджет»')
            setPrice(pr); setPricedKey(key); setState('idle')
          }
          else { setPrice(null); setState('error') }
        }).catch((e: unknown) => { if ((e as Error)?.name !== 'AbortError') { setPrice(null); setState('error') } })
    }, 400)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [screen, code, dims, finishId, glass.b2b, choice, qtyChoice, mVariant, drawingReq, viaPartner, orderItems, paramsKey])

  const glassCost = price?.glassCost ?? 0
  const hwCost = price?.hardwareCost ?? 0
  const usable = !!price && price.complete
  // Расчёт сохраняем только с клиентом: без имени и телефона он не заводит сделку,
  // не попадает в воронку и не доходит до КП. Пришли из карточки сделки — клиент
  // уже известен, спрашивать нечего.
  const phoneDigits = clientPhone.replace(/\D/g, '')
  const clientOk = dealId != null || amoLeadId != null || (clientName.trim().length >= 2 && phoneDigits.length >= 10)
  const cost = glassCost + hwCost
  const sections = price?.sections ?? 1
  const m = numOr(margin), tx = numOr(tax)
  const denom = 1 - m / 100 - tx / 100
  const fin = calcFinancialModel({ directCost: cost, marginPercent: m, taxPercent: tx })
  const productPrice = fin ? fin.basePrice : 0
  const install = numOr(perSection) * sections
  const deliveryN = numOr(delivery), liftN = numOr(lift)
  const discPct = Math.min(100, Math.max(0, numOr(discount)))
  const beforeDisc = (usable ? productPrice : 0) + install + deliveryN + liftN
  const grand = Math.round(beforeDisc * (1 - discPct / 100))
  const target = usable && !priceDirty ? price?.target ?? null : null
  const light = target && grand > 0 ? targetLight(grand, target) : null
  // «Поставить цену для цели»: маржа, при которой «К оплате» не ниже цены для цели при тех же
  // монтаже, доставке, подъёме и скидке. Округление вверх до 0,1 — чтобы не недобрать рубль.
  function setTargetPrice() {
    if (!target) return
    const need = target.price / (1 - discPct / 100) - install - deliveryN - liftN
    if (!(need > cost) || !(cost > 0)) return
    const mm = Math.ceil((1 - tx / 100 - cost / need) * 1000) / 10
    if (!(mm > 0 && mm < 100 - tx)) return
    marginTouched.current = true
    setMargin(String(mm))
  }

  const title = () => `${model.code} ${model.name} · ${isCorner ? `${numOr(String(dims.width))}×${numOr(String(dims.width2 ?? 0))}×${numOr(String(dims.height))}` : `${numOr(String(dims.width))}×${numOr(String(dims.height))}`} мм`
  const marks = priceMarks(price)
  const fromDrawing = byDrawing ? drawingFrom : null
  const stops = [
    ...(fromDrawing?.stops ?? []).map(text => ({ kind: 'drawing', text })),
    ...(price?.stops ?? []).filter(x => byDrawing || ALWAYS_STOP.has(x.kind)),
  ]
  const notes = byDrawing ? [...(fromDrawing?.notes ?? []).map(text => ({ kind: 'drawing', text })), ...(price?.notes ?? [])] : []
  // Роли, чей артикул можно сверить с подписью на чертеже, — то, что реально в расчёте.
  const drawnRoles = [...new Set((price?.lines ?? []).map(l => l.role))]
  const currentReq: ShowerReq = { model: code, dims, finishId, choice, qtyChoice, variant: mVariant }
  const currentBom = (): BomItem => ({
    title: title(), glass: `${glass.label.toLowerCase()} ${THICKNESS} мм, закалённое`, finish: finish.label.toLowerCase(),
    panels: price?.glassLines?.length || undefined,
    lines: (price?.lines ?? []).map(l => ({ role: l.role, label: l.label, qty: l.qty, unit: l.unit })),
  })
  const currentItem = (): CartItem => ({ title: title(), cost, productPrice: Math.round(productPrice), install, delivery: deliveryN, lift: liftN, total: grand, ...(marks.length ? { marks } : {}), ...(stops.length ? { stops: stops.map(x => x.text) } : {}), req: currentReq, bom: currentBom() })

  // Корзина = заказ: профиль и труба всех душевых кроятся из общих хлыстов. Экономия —
  // себестоимости, строкой; цену клиенту не меняет (это решает менеджер скидкой).
  const orderReqs = useMemo(() => {
    const list = cart.map(i => i.req).filter((r): r is ShowerReq => !!r)
    if (product === 'shower' && usable && grand > 0 && !priceDirty) list.push(currentReq)
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, product, usable, grand, priceDirty, paramsKey])
  const orderKey = JSON.stringify(orderReqs)
  useEffect(() => {
    if (orderReqs.length < 2) return
    const ctrl = new AbortController()
    fetch('/api/configurator/order-cutting', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ tier: 'budget', items: orderReqs }),
    }).then(r => (r.ok ? r.json() : null))
      .then((d: OrderCut | null) => { if (d) setOrderCutAt({ key: orderKey, cut: { saving: d.saving, cuts: d.cuts } }) })
      .catch(() => {})
    return () => ctrl.abort()
  }, [orderReqs, orderKey])
  // Показываем только раскрой, посчитанный для нынешнего состава заказа.
  const orderCut = orderReqs.length >= 2 && orderCutAt?.key === orderKey ? orderCutAt.cut : null

  function addMore() {
    if (usable && grand > 0) setCart(c => [...c, currentItem()])
    setScreen('models')
  }

  async function save() {
    if (!clientOk) {
      setSaveMsg('Впишите имя и телефон клиента')
      setTimeout(() => setSaveMsg(null), 3000)
      return
    }
    const list = [...cart]
    // Текущее изделие добавляем только в режиме душевых: у зеркала своя кнопка
    // «+ В КП», а цена душевой могла остаться в состоянии от прошлого захода —
    // иначе в КП приезжало бы лишнее изделие, которого менеджер не добавлял.
    if (product === 'shower' && usable && grand > 0) list.push(currentItem())
    if (!list.length) { setSaveMsg('Нечего сохранять'); setTimeout(() => setSaveMsg(null), 2500); return }
    const snapshot = { code, dims, finishId, glassId, profileFrame, choice, qtyChoice, ...(byDrawing ? { byDrawing, panelOver, drawn, ...(drawingFrom ? { drawingFrom } : {}) } : {}), ...(viaPartner ? { partner: true } : {}), margin, tax, perSection, delivery, lift, discount, cart: list, clientName, clientPhone, objectAddress }
    const total = list.reduce((s, i) => s + i.total, 0)
    const sig = JSON.stringify(snapshot) + '|' + total
    if (sig === lastSavedSigRef.current) { setSaveMsg('Уже сохранено ✓'); setTimeout(() => setSaveMsg(null), 2500); return }
    setSaving(true); setSaveMsg(null)
    try {
      const { saveCalculation } = await import('@/lib/saveCalculation')
      const res = await saveCalculation({
        product_type: 'build',
        input_data: snapshot,
        cost_breakdown: { glassCost, hwCost, directCost: cost, productPrice, installTotal: install, delivery: deliveryN, lift: liftN, sections, ...(orderCut ? { orderCutSaving: orderCut.saving } : {}) },
        financial_breakdown: { marginPct: m, taxPct: tx, discountPct: discPct, total },
        base_price: total, discount: 0, partner_percent: 0, final_price: total,
        // Прибыль и маржа — по сохраняемой корзине: итог − её себестоимость − налог (financialModel.ts).
        ...(savedProfit(total, list.reduce((s, i) => s + i.cost, 0), tx) ?? { margin: 0, profit: 0 }),
        client_text: [title(), objectAddress && `Адрес: ${objectAddress}`].filter(Boolean).join(' · '),
        client_name: clientName.trim() || undefined,
        client_phone: clientPhone.trim() || undefined,
        ...(amoLeadId ? { amo_lead_id: amoLeadId } : {}),
      })
      const ok = !!(res && 'id' in res && res.id)
      if (!ok) { setSaveMsg(res && 'error' in res ? res.error! : 'Не удалось сохранить'); return }
      lastSavedSigRef.current = sig
      const newId = (res as { id: number }).id
      // Пришли из сделки → кладём расчёт прямо в неё. Иначе — общее правило:
      // новый телефон заводит сделку сам, совпавший оставляет решение человеку.
      // Сбой привязки не отменяет сохранение, но человек должен знать, где теперь расчёт.
      // Уведомление живёт в корневом layout и переживает переход в КП ниже.
      // Сделка AmoCRM — клиент ведётся там, своей сделки в приложении не заводим.
      if (amoLeadId && !dealId) {
        toast.success(`Расчёт сохранён в сделку AmoCRM №${amoLeadId}`, { detail: 'Он в «Расчётах» и в строке сделки на «Сделки в AmoCRM». Осталось оформить КП — открываю.' })
      } else if (dealId) {
        await sendOrToast('Расчёт сохранён, но не попал в сделку', `/api/deals/${dealId}/attach`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ calc_id: newId }) },
          'Он лежит в «Расчётах» — привяжите его из карточки сделки')
      } else {
        await sendOrToast('Расчёт сохранён, сделка не заведена', '/api/deals/ensure',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ calc_id: newId, client_name: clientName.trim(), phone: clientPhone.trim(), address: objectAddress.trim() }) },
          'Он в «Мой день» → «Расчёты без клиента»')
      }
      // КП из этого расчёта: позиции корзины → префилл /kp.
      const items = list.map(i => ({ name: i.title, qty: 1, price: i.productPrice + i.install + i.delivery + i.lift, sum: i.total }))
      const kpSections = kpSectionsFromBom(list.flatMap(i => (i.bom ? [i.bom] : [])))
      const content = { title: (clientName || 'Коммерческое предложение').toUpperCase(), items, subtotal: total, total, client_name: clientName, client_phone: clientPhone, client_address: objectAddress, ...(kpSections.length ? { sections: kpSections } : {}), ...(amoLeadId ? { amo_lead_id: amoLeadId } : {}) }
      try { sessionStorage.setItem('mglass_kp_prefill', JSON.stringify(content)) } catch {
        toast.error('КП откроется без позиций', { detail: 'Браузер не дал передать данные расчёта. Сам расчёт сохранён в «Расчётах» — откройте его оттуда и нажмите «Сделать КП».' })
      }
      router.push('/kp')
    } finally { setSaving(false); setTimeout(() => setSaveMsg(null), 4000) }
  }

  // ── Экран 1: только выбор модели ─────────────────────────────────────────────
  if (screen === 'models') {
    return (
      <div className="min-h-screen bg-[#f5f5f3] p-6">
        <div className="max-w-4xl mx-auto">
          <AmoLeadBanner state={amo} />
          {dealId && (
            <p className="mb-3 text-[12px] text-[#4b4b47] bg-[#eef3ee] border border-[#cfe0d3] rounded-xl px-3 py-2">
              Расчёт пойдёт в сделку <b className="font-semibold">{dealTitle || `#${dealId}`}</b> — после сохранения он появится в её карточке.
            </p>
          )}
          <div className="mb-5 flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-[18px] font-semibold text-[#111110]">Расчёт{cart.length ? ` · в корзине ${cart.length}` : ''}</h1>
              <p className="text-[12px] text-[#9a9a95] mt-0.5">
                {product === 'shower' ? 'Выберите модель душевой перегородки.' : 'Выберите модель зеркала.'}
              </p>
            </div>
            {product === 'shower' && (
              <div className="flex flex-col items-end gap-1">
                {drawingUpload}
                {drawingState === 'error' && drawingErr && <span className="text-[11px] text-[#c2410c]">{drawingErr}</span>}
              </div>
            )}
            {cart.length > 0 && (
              <button onClick={save} disabled={saving}
                className="text-[13px] font-semibold px-4 py-2 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40">
                {saving ? 'Сохраняю…' : `Сохранить (${cart.length}) → КП`}
              </button>
            )}
          </div>
          {/* Подменю продукта (маршрут З1). Лофт ведёт на свой калькулятор — пока
              он живой, честнее отправить туда, чем рисовать вкладку «скоро». */}
          <div className="flex items-center gap-1 mb-4 bg-white border border-[#e4e4e0] rounded-xl p-1 w-fit">
            {([['shower', 'Душевые'], ['mirror', 'Зеркала']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setProduct(k)}
                className={`text-[13px] font-medium px-4 py-1.5 rounded-lg transition-colors ${product === k ? 'bg-[#111110] text-white' : 'text-[#4b4b47] hover:bg-[#f5f5f3]'}`}>
                {label}
              </button>
            ))}
            <a href="/calculator/loft" className="text-[13px] font-medium px-4 py-1.5 rounded-lg text-[#4b4b47] hover:bg-[#f5f5f3] transition-colors">Лофт ↗</a>
          </div>

          {product === 'mirror' && mirrorPick ? (
            <MirrorPanel
              model={mirrorPick} materials={mirrorMats}
              onBack={() => setMirrorPick(null)}
              onAdd={item => setCart(c => [...c, item])}
              cartCount={cart.length}
              onSave={save} saving={saving}
            />
          ) : product === 'mirror' ? (
            mirrorModels === null ? (
              <p className="text-[13px] text-[#9a9a95]">Загружаю модели…</p>
            ) : mirrorModels.length === 0 ? (
              <p className="text-[13px] text-[#9a9a95]">Моделей зеркал пока нет в справочнике.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {mirrorModels.map(mm => (
                    <button key={mm.code} onClick={() => setMirrorPick(mm)}
                      className={`flex flex-col items-stretch p-2 rounded-xl border bg-white text-left transition-all ${mirrorPick?.code === mm.code ? 'border-[#111110]' : 'border-[#e4e4e0] hover:border-[#111110]'}`}>
                      <div className="rounded-lg mb-2 overflow-hidden aspect-[4/5] bg-[#f5f5f7] flex items-center justify-center">
                        {mm.image_url
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={mm.image_url} alt="" className="w-full h-full object-cover" />
                          : <MirrorThumb lit={mm.has_lighting} shape={mm.shape} />}
                      </div>
                      <span className="text-[13px] font-bold text-[#111110]">{mm.code} · {mm.name}</span>
                      <span className="text-[10px] text-[#86868b] leading-tight">{mm.descr}</span>
                    </button>
                  ))}
                </div>

              </>
            )
          ) : (
          <>
          {/* Экран для выбора модели глазами — карточки портретные и крупные, рендер целиком
              по высоте (object-cover на вертикальной ячейке ≈ соотношение рендера 576×720),
              чтобы видеть конструкцию, а не полоску стекла. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {M_MODELS.map(mm => (
              <button key={mm.code} onClick={() => pickModel(mm.code)}
                className="flex flex-col items-stretch p-2 rounded-xl border border-[#e4e4e0] bg-white text-left hover:border-[#111110] transition-all">
                <div className="rounded-lg mb-2 overflow-hidden aspect-[4/5] bg-[#f5f5f7] flex items-center justify-center">
                  {PHOTO.has(mm.code)
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={`/models/${photoSlug(mm.code)}.jpg`} alt="" className="w-full h-full object-cover" />
                    : <div className="text-[#c4c4be] flex flex-col items-center gap-1"><span className="text-[28px]">🚿</span><span className="text-[11px]">фото скоро</span></div>}
                </div>
                <span className="text-[13px] font-bold text-[#111110]">{mm.code} · {mm.name}</span>
                <span className="text-[10px] text-[#86868b] leading-tight">{mm.desc}</span>
              </button>
            ))}
          </div>
          </>
          )}
        </div>
      </div>
    )
  }

  // ── Экран 2: 3D + параметры + цена ───────────────────────────────────────────
  const c = model.constraints
  return (
    <div className="min-h-screen bg-[#f5f5f3] p-4">
      <div className="max-w-[1400px] mx-auto">
        <AmoLeadBanner state={amo} />
        {dealId && (
            <p className="mb-3 text-[12px] text-[#4b4b47] bg-[#eef3ee] border border-[#cfe0d3] rounded-xl px-3 py-2">
              Расчёт пойдёт в сделку <b className="font-semibold">{dealTitle || `#${dealId}`}</b> — после сохранения он появится в её карточке.
            </p>
          )}
          {lead && (
            <div className="mb-3 text-[12px] text-[#4b4b47] bg-white border border-[#e4e4e0] rounded-xl px-3 py-2 space-y-0.5">
              <p>Заявка с сайта №{lead.id}{lead.line ? <>: <b className="font-semibold">{lead.line}</b></> : null}</p>
              {[...lead.open.notes, ...leadMiss].map(n => <p key={n} className="text-[#9a5a2a]">⚠️ {n}</p>)}
            </div>
          )}
          <div className="mb-3 flex items-center gap-3">
          <button onClick={() => setScreen('models')} className="text-[13px] text-[#6b6b66] hover:text-[#111110]">← Модели</button>
          <h1 className="text-[16px] font-semibold text-[#111110]">{model.code} · {model.name}</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4 items-start">
          {/* Слева — крупный настоящий 3D */}
          <div className="bg-white border border-[#e4e4e0] rounded-2xl overflow-hidden">
            <div className="h-[68vh] min-h-[420px]">
              <Partition3DView model={model} dims={dims} thickness={THICKNESS}
                finishHex={finish.hex} finishId={finish.id} glassTint={glass.tint} doorOpen={doorOpen} choice={hwChoice} variant={mVariant} />
            </div>
            <div className="px-4 py-2 border-t border-[#f0f0ec] flex items-center gap-2">
              <button onClick={() => setDoorOpen(v => !v)} className="text-[12px] text-[#6b6b66] hover:text-[#111110]">{doorOpen ? 'Закрыть дверь' : 'Открыть дверь'}</button>
            </div>
          </div>

          {/* Справа — параметры прокручиваются, низ (К оплате + кнопки) закреплён и всегда виден. */}
          <div className="flex flex-col max-h-[86vh] lg:sticky lg:top-4">
          <div className="space-y-3 overflow-y-auto pr-1 flex-1 min-h-0">
            {/* Габариты */}
            <div className="bg-white border border-[#e4e4e0] rounded-2xl p-4">
              <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-2">
                {isWalkin ? 'Размер стекла, мм' : 'Габариты проёма, мм'}
              </p>
              <div className={`grid gap-2 ${isCorner ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <div><label className={lbl}>{isCorner ? 'Ширина 1' : 'Ширина'}</label>
                  <input type="number" className={fld} value={dims.width} min={c.width[0]} max={c.width[1]} onChange={e => setD('width', Number(e.target.value) || 0)} /></div>
                {isCorner && c.width2 && (
                  <div><label className={lbl}>Ширина 2</label>
                    <input type="number" className={fld} value={dims.width2 ?? 0} min={c.width2[0]} max={c.width2[1]} onChange={e => setD('width2', Number(e.target.value) || 0)} /></div>
                )}
                <div><label className={lbl}>Высота</label>
                  <input type="number" className={fld} value={dims.height} min={c.height[0]} max={c.height[1]} onChange={e => setD('height', Number(e.target.value) || 0)} /></div>
              </div>
              {/* М1: обвязка профилем. Не косметика — периметр добавляет в BOM
                  верхний профиль и свободную вертикаль, цена меняется. */}
              {isWalkin && (
                <div className="mt-3">
                  <label className={lbl}>Обвязка профилем</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([
                      { id: 'partial' as const, label: 'Пол и стена' },
                      { id: 'perimeter' as const, label: 'По периметру' },
                    ]).map(o => (
                      <button key={o.id} onClick={() => setProfileFrame(o.id)}
                        className={`text-[12px] px-2 py-1.5 rounded-lg border-2 transition-colors ${profileFrame === o.id ? 'border-[#111110] text-[#111110] font-semibold' : 'border-[#e4e4e0] text-[#6b6b66] hover:border-[#c4c4be]'}`}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Стекло и цвет фурнитуры */}
            <div className="bg-white border border-[#e4e4e0] rounded-2xl p-4 space-y-3">
              <div>
                <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Стекло</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {GLASS_TYPES.map(g => (
                    <button key={g.id} onClick={() => setGlassId(g.id)} title={g.label}
                      className={`rounded-lg border-2 p-1 ${glassId === g.id ? 'border-[#111110]' : 'border-[#e4e4e0]'}`}>
                      <div className="h-7 rounded" style={{ background: g.swatch }} />
                      <span className="text-[9px] text-[#6b6b66] block mt-0.5 leading-tight">{g.label}</span>
                    </button>
                  ))}
                </div>
                {/* Роут молча падает на прозрачное, если позиции нет в справочнике на эту
                    толщину. Молчать нельзя — цена уедет вдвое. Сверяем, что посчитано именно то. */}
                {!priceDirty && price?.glassSource && price.glassSource !== glass.b2b && (
                  <p className="text-[10px] text-[#c2410c] mt-1">
                    Цена посчитана по «{price.glassSource}»: «{glass.b2b}» на {THICKNESS} мм в справочнике нет.
                  </p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">Цвет фурнитуры</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {finishOptions.map(f => (
                    <button key={f.id} onClick={() => setFinishId(f.id as FinishId)}
                      className={`rounded-lg border-2 p-1 flex items-center gap-1.5 ${finishId === f.id ? 'border-[#111110]' : 'border-[#e4e4e0]'}`}>
                      <span className="w-4 h-4 rounded-full border border-black/10" style={{ background: f.hex }} />
                      <span className="text-[10px] text-[#111110]">{f.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Варианты фурнитуры ЭТОЙ модели (из комплекта) */}
            {kitChoices && (kitChoices.variants.length > 0 || kitChoices.quantities.length > 0) && (
              <div className="bg-white border border-[#e4e4e0] rounded-2xl p-4 space-y-2">
                <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest">Фурнитура модели</p>
                {kitChoices.variants.map(v => (
                  <div key={v.role}>
                    <label className={lbl}>{v.label}</label>
                    <select className={`${fld} font-sans`} value={choice[v.role] ?? ''} onChange={e => setChoice(p => ({ ...p, [v.role]: e.target.value }))}>
                      {v.options.map(o => <option key={o.itemId} value={o.itemId}>{o.name}{o.primary ? ' ★' : ''}</option>)}
                    </select>
                  </div>
                ))}
                {kitChoices.quantities.map(q => (
                  <div key={q.role}>
                    <label className={lbl}>{q.label}</label>
                    <select className={`${fld} font-sans`} value={qtyChoice[q.role] ?? q.def} onChange={e => setQtyChoice(p => ({ ...p, [q.role]: Number(e.target.value) }))}>
                      {q.options.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}

            {/* По чертежу: размеры стекла и подписи артикулов с чертежа клиента/дизайнера.
                Цена фурнитуры остаётся по комплекту; расхождение — остановка до закалки. */}
            {product === 'shower' && (
              <div className="bg-white border border-[#e4e4e0] rounded-2xl p-4 space-y-2">
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest">По чертежу</span>
                  <input type="checkbox" checked={byDrawing} onChange={e => setByDrawing(e.target.checked)} />
                </label>
                {byDrawing && (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      {drawingUpload}
                      {drawingState === 'error' && drawingErr && <span className="text-[11px] text-[#c2410c]">{drawingErr}</span>}
                    </div>
                    {drawingOpts.length > 1 && (
                      <div className="flex flex-wrap gap-1">
                        {drawingOpts.map(o => (
                          <button key={o.sheet} type="button" onClick={() => applyDrawing(o, drawingOpts)}
                            className={`text-[11px] px-2 py-1 rounded-md border ${drawingFrom?.sheet === o.sheet ? 'border-[#111110] bg-[#111110] text-white' : 'border-[#e4e4e0] text-[#4b4b47] hover:bg-[#f5f5f3]'}`}>
                            {o.title}
                          </button>
                        ))}
                      </div>
                    )}
                    {fromDrawing && fromDrawing.evidence.length > 0 && (
                      <div>
                        <button type="button" onClick={() => setShowEvidence(v => !v)} className="text-[11px] text-[#6b6b66]">
                          {showEvidence ? '▾' : '▸'} С чертежа: {fromDrawing.title} — откуда взято ({fromDrawing.evidence.length})
                        </button>
                        {showEvidence && fromDrawing.evidence.map((e, i) => (
                          <div key={i} className="text-[11px] text-[#9a9a95] pl-3">
                            {ROLE_META[e.field as RoleId]?.label ?? e.field}: <span className="text-[#4b4b47]">{e.value}</span> ← {e.evidence}
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-[11px] text-[#9a9a95]">Пустое поле — из габаритов модели. Стекло считается по размерам чертежа.</p>
                    {(price?.glassLines ?? []).map((g, k) => { const i = g.index ?? k; return (
                      <div key={i} className="grid grid-cols-[1fr_5rem_5rem] gap-2 items-center">
                        <span className="text-[12px] text-[#6b6b66]">{g.label}</span>
                        <input type="number" className={fld} placeholder={String(g.w)} value={panelOver[i]?.w ?? ''}
                          onChange={e => setPanelOver(p => ({ ...p, [i]: { ...p[i], w: e.target.value } }))} />
                        <input type="number" className={fld} placeholder={String(g.h)} value={panelOver[i]?.h ?? ''}
                          onChange={e => setPanelOver(p => ({ ...p, [i]: { ...p[i], h: e.target.value } }))} />
                      </div>
                    ) })}
                    <p className="text-[11px] text-[#9a9a95] pt-1">Артикул, как подписан на чертеже:</p>
                    {drawnRoles.map(r => (
                      <div key={r} className="grid grid-cols-[1fr_8rem] gap-2 items-center">
                        <span className="text-[12px] text-[#6b6b66]">{ROLE_META[r as RoleId]?.label ?? r}</span>
                        <input className={fld} placeholder="напр. SD-210" value={drawn[r] ?? ''}
                          onChange={e => setDrawn(p => ({ ...p, [r]: e.target.value }))} />
                      </div>
                    ))}
                  </>
                )}
                {!priceDirty && stops.length > 0 && (
                  <div className="rounded-lg bg-[#fef2f2] border border-[#fecaca] p-2 space-y-1">
                    <p className="text-[11px] font-semibold text-[#b91c1c]">До закалки — остановиться и сверить</p>
                    {stops.map((x, i) => <p key={i} className="text-[12px] text-[#7f1d1d]">• {x.text}</p>)}
                  </div>
                )}
                {!priceDirty && notes.length > 0 && (
                  <div className="text-[11px] text-amber-700 space-y-0.5">
                    {notes.map((x, i) => <div key={i}>{x.text}</div>)}
                  </div>
                )}
              </div>
            )}

            {/* Детали цены — прокручиваются; итог и кнопки закреплены ниже. */}
            <div className="bg-white border border-[#e4e4e0] rounded-2xl p-4 space-y-1.5 text-[12px]">
              <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1">Себестоимость и цена</p>
              {/* Спецификация: менеджер должен видеть, из чего сложилась цифра,
                  а не верить итогу. Свёрнута, чтобы не мешать частому сценарию. */}
              <SpecRow label="Себест. стекло" sum={glassCost} open={specGlass} onToggle={() => setSpecGlass(v => !v)} count={price?.glassLines?.length ?? 0}>
                {price?.glassSubstituted && <p className="text-[11px] text-amber-700 pb-1">Стекло подменено: {price.glassSubstituted}</p>}
                {price?.glassSource && (
                  <p className="text-[11px] text-[#9a9a95] pb-1">
                    {price.glassSource}{price.glassThickness ? `, ${price.glassThickness} мм` : ''}, закалка · цена по прайсу
                    {price.glassDiscountPct ? ` минус ${price.glassDiscountPct}% M GLASS` : ''}
                  </p>
                )}
                {(price?.glassLines ?? []).map((g, i) => (
                  <div key={i} className="flex justify-between gap-2 py-0.5">
                    <span className="text-[#6b6b66] min-w-0">
                      {g.w}×{g.h} мм · {g.areaM2.toFixed(2)} м² × {RUB(g.pricePerM2)}/м²
                      {g.minPriceApplied && <span className="text-amber-700"> · минималка</span>}
                      {g.listTotal !== g.total && <span className="text-[#9a9a95]"> · {RUB(g.listTotal)} −{price?.glassDiscountPct}%</span>}
                    </span>
                    <span className="font-mono whitespace-nowrap">{RUB(g.total)}</span>
                  </div>
                ))}
              </SpecRow>
              <SpecRow label="Себест. фурнитура" sum={hwCost} open={specHw} onToggle={() => setSpecHw(v => !v)} count={price?.lines?.length ?? 0}>
                {(price?.lines ?? []).map((l, i) => (
                  <div key={i} className="py-0.5">
                    <div className="flex justify-between gap-2">
                      <span className="text-[#6b6b66] min-w-0">
                        {l.label} · {l.qty} {l.unit} × {RUB(l.unitPrice)}
                        {l.chromeFallback && <span className="text-amber-700"> · цена хрома</span>}
                      </span>
                      <span className="font-mono whitespace-nowrap">{RUB(l.total)}</span>
                    </div>
                    {/* Что именно заказывать и насколько свежа цена. */}
                    {l.ref && (
                      <div className="text-[11px] text-[#9a9a95]">
                        {SUPPLIER[l.ref.supplier] ?? l.ref.supplier} · {l.ref.base}{l.ref.asOf ? ` · цена от ${dateRu(l.ref.asOf)}` : ''}
                      </div>
                    )}
                    {/* Хлыст режется — показываем куски и остаток, иначе непонятно, за что целая палка. */}
                    {l.plan?.length ? cutText(l.plan).map((t, j) => <div key={j} className="text-[11px] text-[#9a9a95]">{t}</div>) : null}
                  </div>
                ))}
              </SpecRow>
              {marks.length > 0 && (
                <div className="text-[11px] text-amber-700 space-y-0.5">
                  {marks.map((t, i) => <div key={i}>{t}</div>)}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div><label className={lbl}>Маржа, %</label><input type="number" className={fld} value={margin} onChange={e => { marginTouched.current = true; setMargin(e.target.value) }} /></div>
                <div><label className={lbl}>Налог, %</label><input type="number" className={fld} value={tax} onChange={e => { taxTouched.current = true; setTax(e.target.value) }} /></div>
              </div>
              {financeSource && <div className="text-[11px] text-[#9a9a95]">Маржа и налог по умолчанию: {financeSource}</div>}
              {denom > 0 && <div className="flex justify-between"><span className="text-[#6b6b66]">Цена изделия</span><span className="font-mono font-semibold">{RUB(productPrice)}</span></div>}
              <div className="grid grid-cols-2 gap-2">
                <div><label className={lbl}>Монтаж/секц</label><input type="number" className={fld} value={perSection} onChange={e => setPerSection(e.target.value)} /></div>
                <div><label className={lbl}>Секций</label><input type="number" className={fld} value={sections} readOnly /></div>
                <div><label className={lbl}>Доставка</label><input type="number" className={fld} value={delivery} onChange={e => setDelivery(e.target.value)} /></div>
                <div><label className={lbl}>Подъём</label><input type="number" className={fld} value={lift} onChange={e => setLift(e.target.value)} placeholder="0" /></div>
                <div><label className={lbl}>Скидка, %</label><input type="number" className={fld} value={discount} onChange={e => setDiscount(e.target.value)} placeholder="0" /></div>
                <label className="flex items-end gap-2 pb-1.5 text-[12px] text-[#4b4b47] cursor-pointer">
                  <input type="checkbox" checked={viaPartner} onChange={e => setViaPartner(e.target.checked)} />
                  через партнёра (дизайнер)
                </label>
              </div>
              {install > 0 && <div className="flex justify-between text-[#6b6b66]"><span>Монтаж ({sections}×{RUB(numOr(perSection))})</span><span className="font-mono">{RUB(install)}</span></div>}
              {deliveryN > 0 && <div className="flex justify-between text-[#6b6b66]"><span>Доставка</span><span className="font-mono">{RUB(deliveryN)}</span></div>}
              {liftN > 0 && <div className="flex justify-between text-[#6b6b66]"><span>Подъём</span><span className="font-mono">{RUB(liftN)}</span></div>}
              {discPct > 0 && <div className="flex justify-between text-emerald-700"><span>Скидка {discPct}%</span><span className="font-mono">−{RUB(Math.round(beforeDisc * discPct / 100))}</span></div>}
            </div>

            {/* Клиент. Обязателен для сохранения: расчёт без имени и телефона
                не превращается в сделку и теряется — так ушли в никуда все
                просчёты первых дней. Прикидывать цену можно и без него. */}
            <div className="bg-white border border-[#e4e4e0] rounded-2xl p-4 grid grid-cols-1 gap-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] font-semibold text-[#111110]">Кому считаем</span>
                {!dealId && !clientOk && <span className="text-[11px] text-[#9a9a95]">нужно для сохранения</span>}
              </div>
              <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Имя клиента" className={`${fld} font-sans`} />
              <div className="grid grid-cols-2 gap-2">
                <input value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="Телефон" inputMode="tel" className={`${fld} font-sans`} />
                <input value={objectAddress} onChange={e => setObjectAddress(e.target.value)} placeholder="Адрес объекта (необязательно)" className={`${fld} font-sans`} />
              </div>
            </div>
          </div>

          {/* Закреплённый низ — итог и кнопки всегда видны (самое частое действие). */}
          <div className="shrink-0 mt-2 pt-3 border-t border-[#e4e4e0] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-semibold text-[#111110]">К оплате{cart.length ? ` (изделие ${cart.length + 1})` : ''}</span>
              <span className="text-[22px] font-bold font-mono text-[#111110]">{RUB(grand)}</span>
            </div>
            {light && target && (
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className="flex items-center gap-1.5 text-[#111110]">
                  <span className={`inline-block w-2.5 h-2.5 rounded-full ${LIGHT[light].dot}`} />{LIGHT[light].text}
                </span>
                <span className="text-[#6b6b66]">
                  цена для цели <span className="font-mono">{RUB(target.price)}</span>
                  {grand < target.price && <button type="button" onClick={setTargetPrice} className="ml-1.5 underline text-[#111110]">поставить</button>}
                </span>
              </div>
            )}
            {(priceDirty || state === 'loading') && <p className="text-[11px] text-[#9a9a95]">пересчёт цены…</p>}
            {!priceDirty && state !== 'loading' && price && !usable && price.missing.length > 0 && (
              <p className="text-[11px] text-[#c2410c]">Цена не заведена: {price.missing.map(x => x.label).join(', ')}.</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {/* Пока цена не догнала параметры — не сохраняем (иначе новый размер, старая цена). */}
              <button onClick={addMore} disabled={!usable || grand <= 0 || priceDirty || state === 'loading'}
                className="px-4 py-2.5 border border-[#111110] text-[#111110] text-[13px] font-semibold rounded-lg hover:bg-[#f0f0ec] disabled:opacity-40">
                + Ещё изделие
              </button>
              <button onClick={save} disabled={saving || priceDirty || state === 'loading' || (!usable && cart.length === 0) || !clientOk}
                className="px-4 py-2.5 bg-[#111110] text-white text-[13px] font-semibold rounded-lg hover:bg-[#2a2a28] disabled:opacity-40">
                {saving ? 'Сохраняю…' : 'Сохранить → КП'}
              </button>
            </div>
            {!clientOk && (
              <p className="text-[11px] text-[#9a9a95] text-center">
                Впишите имя и телефон — расчёт станет сделкой и попадёт в воронку.
              </p>
            )}
            {saveMsg && <p className={`text-center text-[13px] font-semibold rounded-lg px-3 py-1.5 ${saveMsg.includes('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{saveMsg}</p>}
            {cart.length > 0 && <p className="text-[11px] text-[#9a9a95] text-center">В корзине {cart.length}. «Сохранить» соберёт КП из всех.</p>}
            {orderCut && (
              <div className="text-[11px] text-[#6b6b66] bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 space-y-0.5">
                <div className="flex justify-between gap-2">
                  <span>Общий раскрой на заказ ({orderReqs.length} душ.)</span>
                  <span className="font-mono">{orderCut.saving >= 1 ? `−${RUB(orderCut.saving)}` : '0 ₽'}</span>
                </div>
                {orderCut.cuts.filter(c => c.saving >= 1).map((c, i) => (
                  <div key={i} className="text-[#9a9a95]">{c.name}: хлыстов {c.perItemBars} → {c.pooledBars}</div>
                ))}
                {orderCut.saving < 1 && <div className="text-[#9a9a95]">Общих хлыстов не выходит — кроим по душевым.</div>}
              </div>
            )}
          </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Превью модели зеркала, пока нет фото: силуэт и, если модель с подсветкой,
// свечение по контуру. Схема честнее «фото скоро» — видно, чем модели отличаются.
function MirrorThumb({ lit, shape }: { lit: boolean; shape: string }) {
  const round = shape === 'circle' || shape === 'oval'
  return (
    <svg viewBox="0 0 80 100" className="w-full h-full">
      {lit && (round
        ? <ellipse cx="40" cy="50" rx="30" ry="34" fill="none" stroke="#ffe9a8" strokeWidth="7" opacity="0.85" />
        : <rect x="16" y="16" width="48" height="68" rx="3" fill="none" stroke="#ffe9a8" strokeWidth="7" opacity="0.85" />)}
      {round
        ? <ellipse cx="40" cy="50" rx="26" ry="30" fill="#dfe7ea" stroke="#b9c6cc" strokeWidth="1.5" />
        : <rect x="20" y="20" width="40" height="60" rx="2" fill="#dfe7ea" stroke="#b9c6cc" strokeWidth="1.5" />}
      <path d={round ? 'M26 62 L54 34' : 'M24 70 L56 30'} stroke="#ffffff" strokeWidth="3" opacity="0.7" />
    </svg>
  )
}

// Строка себестоимости с раскрывающейся спецификацией. Свёрнутая выглядит как
// раньше — итог справа; раскрытая показывает, из чего он сложился.
function SpecRow({ label, sum, count, open, onToggle, children }: {
  label: string; sum: number; count: number; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  const can = count > 0
  return (
    <div>
      <button type="button" onClick={can ? onToggle : undefined} disabled={!can}
        className="w-full flex justify-between items-baseline gap-2 text-left disabled:cursor-default">
        <span className="text-[#6b6b66] flex items-center gap-1">
          {label}
          {can && <span className="text-[10px] text-[#9a9a95]">{open ? '▾' : '▸'} {count} поз.</span>}
        </span>
        <span className="font-mono">{RUB(sum)}</span>
      </button>
      {open && can && (
        <div className="mt-1 mb-1.5 pl-2 border-l-2 border-[#e4e4e0] text-[11.5px]">{children}</div>
      )}
    </div>
  )
}
