'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FINISHES, type FinishId } from '@/lib/configurator/catalog'
import { calcFinancialModel } from '@/lib/pricing/financialModel'
import { FINANCE_FALLBACK, type Finance } from '@/lib/pricing/pickFinance'
import type { BomItem } from '@/lib/kp/bomSections'
import { SUPPLIER_RU, type CompositionResult, type CompositionRole } from '@/lib/calc/composition'
import type { CatalogGroupId, CatalogModel } from '@/lib/calc/compositionCatalog'
import { COMPOSE_TEMPLATES, applyTemplate, resolvePieces, type ComposeTemplate } from '@/lib/calc/composeTemplates'
import { DRAFT_KEY, DRAFT_KEY_V1, migrateDraft, type Draft, type Edge, type HwRow, type PanelKind, type PanelRow, type Shape, type Spot } from '@/lib/calc/composeDraft'
import { composeLayout, effectiveSpots, sameSpot } from '@/lib/calc/composeLayout'
import { composeAssembly, rowOfKey } from '@/lib/calc/composeAssembly'
import { hwRowOf, interpretStep, readStep, stepToDraft, type StepImport } from '@/lib/calc/stepImport'
import { confirmDialog } from '@/lib/dialog'
import { getModel } from '@/lib/configurator/arrangement'
import { Partition3DView } from '@/components/configurator/Partition3DView'
import type { GlassTint } from '@/components/configurator/scene/assembly'
import { alternativesOf, kindOf, sameKind, type Kind } from '@/lib/calc/catalogKinds'
import { ComposeScheme } from './ComposeScheme'
import { Thumb } from './ComposeThumb'
import { Variants } from './ComposeVariants'

// Конструктор «Из деталей» (docs/configurator/CONSTRUCTOR_ROUTE.md, К1–К3): душевая, которой нет
// среди моделей, собирается из стёкол и фурнитуры каталогов АВ24 и Ветро (К5). Себестоимость
// считает сервер (/api/calc/composition — тот же расчёт по составу, что для чертежа),
// цена клиенту — той же формулой, что у моделей. Корзина общая с родителем.
// Черновик живёт в localStorage до «+ В КП» или явной очистки: собранное руками не теряется.
// Схема (К3) и 3D (К4) рисуют состав и привязку деталей к кромкам; в цену они не входят.
// Чертёж SolidWorks (STEP, К8) раскладывается в тот же черновик: стёкла, форма, места деталей.

export type ComposeCartItem = {
  title: string; cost: number; productPrice: number; install: number
  delivery: number; lift: number; total: number; stops?: string[]; bom: BomItem
}

type Catalog = { groups: { id: CatalogGroupId; label: string }[]; models: CatalogModel[] }
type Priced = CompositionResult & { finance?: Finance }

const SHAPES: { id: Shape; label: string }[] = [{ id: 'niche', label: 'В нишу' }, { id: 'corner', label: 'Угловая' }, { id: 'walkin', label: 'Открытая' }]
const KINDS: { id: PanelKind; label: string }[] = [{ id: 'fixed', label: 'Неподвижное' }, { id: 'door', label: 'Дверь' }, { id: 'slide', label: 'Раздвижная' }]
const EDGE_RU: Record<Edge, string> = { left: 'левая кромка', right: 'правая кромка', top: 'верх', bottom: 'низ' }
// Те же id и тон для 3D, что GLASS_TYPES в page.tsx; имя материала B2B — на сервере (compositionServer.ts).
const GLASS: { id: string; label: string; swatch: string; tint: GlassTint }[] = [
  { id: 'clear', label: 'Прозрачное', swatch: '#cfe3d3', tint: { color: '#ffffff', attenuation: '#b8d8c4', distance: 3.5 } },
  { id: 'crystal', label: 'Осветлённое', swatch: '#dfeaf6', tint: { color: '#ffffff', attenuation: '#cfe4f2', distance: 6.0 } },
  { id: 'graphite', label: 'Графит', swatch: '#7f858b', tint: { color: '#b9bec4', attenuation: '#4f555d', distance: 1.1 } },
  { id: 'matte', label: 'Матовое', swatch: '#dfe2dd', tint: { color: '#f2f5f1', attenuation: '#d8e0d8', distance: 2.2, roughness: 0.55 } },
  { id: 'matte-crystal', label: 'Матовое осветл.', swatch: '#e6ecef', tint: { color: '#f6f9fa', attenuation: '#e2ecf2', distance: 3.2, roughness: 0.55 } },
  { id: 'bronze', label: 'Бронза', swatch: '#b0895c', tint: { color: '#d6bd97', attenuation: '#7a5836', distance: 1.2 } },
]
// Сцене нужна модель только для ключа «кадр сел»: сборку конструктор отдаёт готовой.
const SCENE_MODEL = getModel('М2')
const THICKNESSES = [6, 8, 10]
const MATERIAL: Record<string, string> = { SUS304: 'нерж.', SUS316: 'нерж. 316', BR: 'латунь', ZN: 'цинк', AL: 'алюминий', PVC: 'ПВХ' }
const DEFAULT_QTY: Partial<Record<CompositionRole, number>> = { hinge: 2, connector: 2 }
const GROUP_OF: Partial<Record<CompositionRole, CatalogGroupId>> = { 'seal-hinge': 'seal', 'seal-magnet': 'seal', 'seal-bottom': 'seal' }
// Строка «ждёт подбора» на схеме и в 3D; без двоеточия — ключ детали сцены режет id по нему.
const PENDING = 'pend_'
// Модель каталога — поставщик + база: у АВ24 и Ветро базы могли бы совпасть.
const keyOf = (supplier: string | undefined, base: string) => `${supplier ?? 'av24'}|${base}`
const rowKeyOf = (h: HwRow) => keyOf(h.supplier, h.base)

const RUB = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const RUBk = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`
// Закупка в панели детали — с копейками, чтобы «цена × количество = сумма» сходилось на экране.
const RUB2 = (n: number) => `${n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`
const numOr = (v: string) => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return isFinite(n) ? n : 0 }
const pieceList = (s: string) => s.split(/[^\d]+/).map(Number).filter(n => n > 0)
const uid = () => Math.random().toString(36).slice(2, 10)
const materialOf = (base: string) => MATERIAL[base.split(/\s+/)[1] ?? ''] ?? ''
const fld = 'w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-2 text-[14px] font-mono text-[#111110] outline-none focus:border-[#111110]'
const lbl = 'block text-[11px] font-medium text-[#6e6e73] mb-1'
// Не через fld: его w-full перебивает ширину, и поле количества растягивалось на всю строку.
const qtyFld = 'w-16 bg-white border border-[#e4e4e0] rounded-lg px-2 py-2 text-[14px] font-mono text-center text-[#111110] outline-none focus:border-[#111110]'
const miniChip = (on: boolean) => `px-2 py-1 rounded-md border text-[12px] transition-colors ${on ? 'border-[#111110] bg-[#111110] text-white' : 'border-[#e4e4e0] bg-white text-[#6b6b66] hover:border-[#111110]'}`

const emptyDraft = (): Draft => ({ v: 2, glassId: 'clear', thickness: 8, finishId: 'chrome', shape: 'niche', panels: [{ id: uid(), label: 'Стекло 1', w: '', h: '', kind: 'fixed' }], hardware: [] })

// Сначала v2; нет — переводим черновик v1 (его ключ не трогаем: старая вкладка его не затрёт).
function readDraft(): Draft | null {
  for (const key of [DRAFT_KEY, DRAFT_KEY_V1]) {
    try {
      const d = migrateDraft(JSON.parse(localStorage.getItem(key) ?? 'null'))
      if (d) return d
    } catch { /* битый черновик — пробуем следующий */ }
  }
  return null
}

export function ComposePanel({ onAdd, cartCount, onSave, saving, deliveryTaken, clientSlot, noteSlot, clientOk = true }: {
  onAdd: (item: ComposeCartItem) => void
  cartCount: number
  onSave: () => void
  saving: boolean
  deliveryTaken: boolean          // доставка уже есть у изделия в корзине — второй раз не берём
  clientSlot: ReactNode           // «Кому считаем» родителя: без клиента «Сохранить» откажет
  noteSlot?: ReactNode            // ответ «Сохранить» — на виду, даже когда «Кому считаем» свёрнут
  clientOk?: boolean
}) {
  // Черновик читаем после монтирования: на сервере localStorage нет, и разметка разошлась бы.
  // Пишем только после чтения — иначе пустой состав первого рендера затёр бы сохранённый.
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const d = readDraft()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- чтение внешнего хранилища после монтирования
    if (d) setDraft(d)
    setLoaded(true)
  }, [])
  useEffect(() => {
    if (!loaded) return
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)) } catch { /* черновик не сохранится — расчёт работает */ }
  }, [draft, loaded])
  const { glassId, thickness, finishId, shape, panels, hardware } = draft
  const pending = useMemo(() => draft.step?.pending ?? [], [draft.step])
  const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }))
  const setPanel = (id: string, patch: Partial<PanelRow>) => setDraft(d => ({ ...d, panels: d.panels.map(p => (p.id === id ? { ...p, ...patch } : p)) }))
  const setHw = (id: string, patch: Partial<HwRow>) => setDraft(d => ({ ...d, hardware: d.hardware.map(h => (h.id === id ? { ...h, ...patch } : h)) }))

  // Схема: раскладка из того же черновика. Выбранная строка подсвечена на схеме, а касание
  // кромки ставит её деталь туда или убирает — привязка пишется в строку явно.
  const layout = useMemo(() => composeLayout(
    shape,
    panels.map(p => ({ id: p.id, label: p.label || 'Стекло', w: numOr(p.w), h: numOr(p.h), run: p.run, kind: p.kind, hinge: p.hinge })),
    [
      ...hardware.map(h => ({ id: h.id, role: h.role, stockMm: h.stockMm, qty: numOr(h.qty), at: h.at, auto: h.auto })),
      // Детали чертежа без позиции каталога — на схеме и в 3D на своих местах, в цене их нет.
      ...pending.map(p => ({ id: PENDING + p.id, role: p.role, stockMm: p.pieces?.length ? Math.max(...p.pieces) : null, qty: p.qty, at: p.at })),
    ],
  ), [shape, panels, hardware, pending])
  const [picked, setPicked] = useState<string | null>(null)
  const selected = hardware.some(h => h.id === picked) ? picked : null
  const selRow = hardware.find(h => h.id === selected) ?? null
  const spotsOf = (h: HwRow) => effectiveSpots({ ...h, qty: numOr(h.qty) }, layout.elevation.panels)
  const selSpots = selRow ? spotsOf(selRow) : []
  const schemeRef = useRef<HTMLElement>(null)
  function toggleSpot(s: Spot) {
    if (!selRow) return
    const cur = spotsOf(selRow)
    setHw(selRow.id, { at: cur.some(x => sameSpot(x, s)) ? cur.filter(x => !sameSpot(x, s)) : [...cur, s] })
  }
  const [pendFocus, setPendFocus] = useState<string | null>(null)
  const unplacedHw = layout.elevation.unplaced.filter(id => !id.startsWith(PENDING))
  function pickRow(id: string, scroll: 'scheme' | 'row' | 'card' | null) {
    if (id.startsWith(PENDING)) {
      const pid = id.slice(PENDING.length)
      setPicked(null); setPendFocus(pid)
      document.getElementById(`pend-${pid}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setPendFocus(null)
    setPicked(id)
    if (scroll === 'scheme') schemeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (scroll === 'row') document.getElementById(`hw-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // Карточка появляется после перерисовки — прокрутка следом за ней.
    if (scroll === 'card') setTimeout(() => document.getElementById('sel-card')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50)
  }
  // 3D из той же раскладки: касание детали на сцене выбирает её строку, как на схеме.
  const [view, setView] = useState<'scheme' | '3d'>('scheme')
  const [doorOpen, setDoorOpen] = useState(true)
  const asm = useMemo(() => composeAssembly(shape, layout.elevation, [
    ...hardware.map(h => ({ id: h.id, role: h.role, label: h.label, stockMm: h.stockMm })),
    ...pending.map(p => ({ id: PENDING + p.id, role: p.role, label: p.name, stockMm: p.pieces?.length ? Math.max(...p.pieces) : null })),
  ], thickness, doorOpen),
    [shape, layout, hardware, pending, thickness, doorOpen])
  const sceneDims = useMemo(() => ({ width: Math.round(asm.bounds.w * 1000), height: Math.round(asm.bounds.h * 1000) }), [asm])
  const panelName = (id: string) => layout.elevation.panels.find(p => p.id === id)?.label ?? 'стекло'
  const whereText = (h: HwRow) => spotsOf(h).map(s => `${panelName(s.panelId)} — ${EDGE_RU[s.edge]}`).join('; ')

  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [catalogErr, setCatalogErr] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/calc/composition/catalog')
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? String(r.status)); return j as Catalog })
      .then(setCatalog)
      .catch((e: Error) => setCatalogErr(`Каталог фурнитуры не загрузился: ${e.message}`))
  }, [])
  const byBase = useMemo(() => new Map((catalog?.models ?? []).map(m => [keyOf(m.supplier, m.base), m])), [catalog])
  const [picker, setPicker] = useState(false)

  const [margin, setMargin] = useState(String(FINANCE_FALLBACK.marginPct))
  const [tax, setTax] = useState(String(FINANCE_FALLBACK.taxPct))
  const [financeSource, setFinanceSource] = useState(FINANCE_FALLBACK.source)
  const marginTouched = useRef(false)
  const taxTouched = useRef(false)
  const [perSection, setPerSection] = useState('6500')
  const [sectionsOver, setSectionsOver] = useState('')
  const [delivery, setDelivery] = useState(deliveryTaken ? '0' : '5000')
  const [lift, setLift] = useState('')
  const [discount, setDiscount] = useState('0')

  // В запрос — только готовое: стекло с обоими размерами, фурнитура с количеством или длинами.
  // Недописанное подсвечивается в строке, а не превращается в остановку расчёта.
  const okPanels = panels.filter(p => numOr(p.w) >= 50 && numOr(p.h) >= 50)
  const isLinear = (h: HwRow) => h.stockMm != null
  const sizes = panels.map(p => ({ id: p.id, w: numOr(p.w), h: numOr(p.h), run: p.run }))
  const piecesOf = (h: HwRow) => (h.auto ? resolvePieces(h.auto, sizes) : pieceList(h.pieces))
  const okHw = hardware.filter(h => (isLinear(h) ? piecesOf(h).length > 0 : numOr(h.qty) > 0))
  const bodyKey = JSON.stringify({
    glassId, thickness, finishId,
    panels: okPanels.map(p => ({ label: p.label || 'Стекло', w: numOr(p.w), h: numOr(p.h) })),
    hardware: okHw.map(h => ({ role: h.role, label: h.label, article: h.base, ...(h.supplier === 'vetro' ? { supplier: 'vetro' } : {}), ...(isLinear(h) ? { pieces_mm: piecesOf(h) } : { qty: numOr(h.qty) }) })),
  })
  const hasPanels = okPanels.length > 0

  const [priced, setPriced] = useState<{ key: string; res: Priced } | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!hasPanels) return
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      setState('loading'); setErr(null)
      fetch('/api/calc/composition', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal, body: bodyKey })
        .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? String(r.status)); return j as Priced })
        .then(res => {
          if (res.finance) {
            if (!marginTouched.current) setMargin(String(res.finance.marginPct))
            if (!taxTouched.current) setTax(String(res.finance.taxPct))
            setFinanceSource(res.finance.source)
          }
          setPriced({ key: bodyKey, res }); setState('idle')
        })
        .catch((e: Error) => { if (e.name !== 'AbortError') { setState('error'); setErr(e.message) } })
    }, 400)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [hasPanels, bodyKey])

  const fresh = priced?.key === bodyKey ? priced.res : null
  const dirty = !fresh || state === 'loading'
  const hwLineOf = (id: string) => { const i = okHw.findIndex(h => h.id === id); return i >= 0 ? fresh?.hardware.lines[i] ?? null : null }

  const glassCost = fresh?.glass.cost ?? 0
  const hwCost = fresh?.hardware.cost ?? 0
  const cost = glassCost + hwCost
  // Недописанная строка не входит в запрос, значит и в цену: пока она есть, цена занижена.
  // Деталь чертежа без позиции каталога — тоже недописанная строка: без неё цена занижена.
  const halfDone = okPanels.length < panels.length || okHw.length < hardware.length || pending.length > 0
  const usable = !!fresh && fresh.complete && !halfDone
  const sections = numOr(sectionsOver) > 0 ? numOr(sectionsOver) : okPanels.length || 1
  const m = numOr(margin), tx = numOr(tax)
  const fin = calcFinancialModel({ directCost: cost, marginPercent: m, taxPercent: tx })
  const productPrice = fin ? fin.basePrice : 0
  const install = numOr(perSection) * sections
  const deliveryN = numOr(delivery), liftN = numOr(lift)
  const discPct = Math.min(100, Math.max(0, numOr(discount)))
  const beforeDisc = (usable ? productPrice : 0) + install + deliveryN + liftN
  const grand = Math.round(beforeDisc * (1 - discPct / 100))

  const glassLabel = GLASS.find(g => g.id === glassId)?.label ?? glassId
  const finish = FINISHES.find(f => f.id === finishId) ?? FINISHES[0]
  const title = () => `${draft.kind ?? 'Душевая по составу'} · ${okPanels.map(p => `${numOr(p.w)}×${numOr(p.h)}`).join(' + ')} мм`

  // Подтверждение живёт, пока состав тот же: правка состава — уже другое изделие.
  const [addedAt, setAddedAt] = useState<{ key: string; text: string } | null>(null)
  const added = addedAt?.key === bodyKey ? addedAt.text : null
  function add() {
    if (!usable || grand <= 0 || dirty) return
    onAdd({
      title: title(), cost, productPrice: Math.round(productPrice), install, delivery: deliveryN, lift: liftN, total: grand,
      bom: {
        title: title(), glass: `${glassLabel.toLowerCase()} ${thickness} мм, закалённое`, finish: finish.label.toLowerCase(), panels: okPanels.length,
        lines: okHw.map((h, i) => ({ role: h.role, label: h.label, qty: fresh!.hardware.lines[i]?.qty ?? 0, unit: isLinear(h) ? 'хлыст' : 'шт' })),
      },
    })
    // Состав не стираем: частый ход — тот же набор с другим стеклом или цветом вторым вариантом.
    setDelivery('0')
    setAddedAt({ key: bodyKey, text: `В корзине ${cartCount + 1} — «Сохранить» сделает расчёт и КП. Состав оставлен: можно поменять и добавить ещё вариант.` })
  }

  async function clearAll() {
    const ok = await confirmDialog({ title: 'Очистить состав?', text: 'Стёкла и фурнитура этого изделия будут удалены.', confirmLabel: 'Очистить', danger: true })
    if (!ok) return
    setDraft(d => ({ ...emptyDraft(), glassId: d.glassId, thickness: d.thickness, finishId: d.finishId }))
    setTplMissing([])
    setStepMsg(null)
  }

  // Шаблон заменяет стёкла и фурнитуру; стекло, толщина и цвет остаются выбранными.
  const [tplMissing, setTplMissing] = useState<string[]>([])
  async function pickTemplate(t: ComposeTemplate) {
    const filled = hardware.length > 0 || panels.some(p => p.w || p.h)
    if (filled && !(await confirmDialog({ title: `Заменить состав шаблоном «${t.label}»?`, text: 'Стёкла и фурнитура этого изделия будут заменены.', confirmLabel: 'Заменить' }))) return
    const a = applyTemplate(t, uid)
    const missing: string[] = []
    const rows: HwRow[] = []
    for (const h of a.hardware) {
      const m = byBase.get(keyOf('av24', h.base))
      if (!m) { missing.push(h.base); continue }
      // В каталоге позиция штучная, а в шаблоне куски — считаем кусками-штуками, а не теряем.
      const linear = m.stockMm != null
      rows.push({ id: uid(), base: m.base, role: m.role, label: m.name, stockMm: m.stockMm, qty: String(h.qty ?? h.auto?.length ?? 1), pieces: '', ...(linear && h.auto ? { auto: h.auto } : {}), at: h.at })
    }
    setDraft(d => ({ ...d, shape: a.shape, panels: a.panels, hardware: rows, kind: t.label, step: undefined }))
    setTplMissing(missing)
    setPicked(null)
    setStepMsg(null)
  }

  // Чертёж SolidWorks: состав и места деталей из файла. Что есть в каталоге — строкой с ценой,
  // остальное ждёт подбора (pending) и в расчёт не идёт. Разбор в браузере, файл никуда не уходит.
  const fileRef = useRef<HTMLInputElement>(null)
  const [stepMsg, setStepMsg] = useState<{ ok: boolean; text: string; notes: string[] } | null>(null)
  async function importStep(file: File) {
    if (!catalog) return
    if (file.size > 40 * 1024 * 1024) { setStepMsg({ ok: false, text: `«${file.name}» больше 40 МБ — выгрузите сборку душевой без лишних деталей.`, notes: [] }); return }
    let imp: StepImport
    try { imp = interpretStep(readStep(await file.text())) } catch (e) {
      setStepMsg({ ok: false, text: `Не прочитал «${file.name}»: ${(e as Error).message}`, notes: [] }); return
    }
    if (!imp.panels.length) { setStepMsg({ ok: false, text: `В «${file.name}» не нашёл стёкол — это сборка душевой в STEP?`, notes: imp.notes }); return }
    const filled = hardware.length > 0 || panels.some(p => p.w || p.h)
    if (filled && !(await confirmDialog({ title: `Заменить состав чертежом «${file.name}»?`, text: 'Стёкла и фурнитура этого изделия будут заменены.', confirmLabel: 'Заменить' }))) return
    const d = stepToDraft(imp, catalog.models, uid)
    const tOk = THICKNESSES.includes(d.thickness)
    setDraft(cur => ({
      ...cur, shape: d.shape, thickness: tOk ? d.thickness : cur.thickness, finishId: d.finishId ?? cur.finishId,
      panels: d.panels, hardware: d.hardware, kind: d.kind, step: { file: file.name, pending: d.pending },
    }))
    setTplMissing([]); setPicked(null); setPendFocus(null)
    const notes = [...imp.notes]
    if (!tOk) notes.push(`Стекло в чертеже ${d.thickness} мм — такой толщины в расчёте нет, оставлена выбранная.`)
    setStepMsg({ ok: true, text: `«${file.name}»: стёкол ${d.panels.length}, из каталога ${d.hardware.length}, ждут подбора ${d.pending.length}.`, notes })
  }

  const [pickFor, setPickFor] = useState<string | null>(null)
  const pickForRow = pending.find(p => p.id === pickFor) ?? null
  function resolvePending(mdl: CatalogModel) {
    const p = pickForRow
    if (!p) return
    setDraft(d => (d.step ? { ...d, hardware: [...d.hardware, hwRowOf(p, mdl, uid())], step: { ...d.step, pending: d.step.pending.filter(x => x.id !== p.id) } } : d))
    setPicker(false); setPickFor(null); setPendFocus(null)
  }
  const dropPending = (id: string) => setDraft(d => (d.step ? { ...d, step: { ...d.step, pending: d.step.pending.filter(x => x.id !== id) } } : d))
  const spotText = (s: Spot) => `${panelName(s.panelId)} — ${EDGE_RU[s.edge]}${s.pos?.length ? `: ${s.pos.join(' / ')} мм` : ''}`

  function addModel(mdl: CatalogModel) {
    setDraft(d => {
      const have = d.hardware.find(h => rowKeyOf(h) === keyOf(mdl.supplier, mdl.base))
      if (have && mdl.stockMm == null) return { ...d, hardware: d.hardware.map(h => (h.id === have.id ? { ...h, qty: String(numOr(h.qty) + 1) } : h)) }
      if (have || d.hardware.length >= 30) return d
      return { ...d, hardware: [...d.hardware, { id: uid(), base: mdl.base, role: mdl.role, label: mdl.name, stockMm: mdl.stockMm, qty: String(DEFAULT_QTY[mdl.role] ?? 1), pieces: '', ...(mdl.supplier === 'vetro' ? { supplier: 'vetro' as const } : {}) }] }
    })
  }
  // Замена детали вариантом той же разновидности: количество, длины и места строки остаются.
  // Модель, которая уже есть другой строкой, не берём — вышел бы дубль строки состава.
  const inUseElsewhere = (rowId: string) => (m: CatalogModel) => hardware.some(h => h.id !== rowId && rowKeyOf(h) === keyOf(m.supplier, m.base))
  function swapRow(rowId: string, mdl: CatalogModel) {
    setDraft(d => (d.hardware.some(h => h.id !== rowId && rowKeyOf(h) === keyOf(mdl.supplier, mdl.base)) ? d : {
      ...d,
      hardware: d.hardware.map(h => (h.id === rowId
        ? { ...h, base: mdl.base, role: mdl.role, label: mdl.name, stockMm: mdl.stockMm, supplier: mdl.supplier === 'vetro' ? 'vetro' as const : undefined }
        : h)),
    }))
  }
  // Сменили цвет — часть деталей в нём не продаётся: строка подсвечена, а одной кнопкой каждая
  // меняется на ближайший вариант той же разновидности, который в этом цвете есть.
  const noFinish = hardware.filter(h => { const m = byBase.get(rowKeyOf(h)); return !!m && !m.variants[finishId] })
  const finishSwaps = (() => {
    const taken = new Set(hardware.map(rowKeyOf))
    const out: { id: string; to: CatalogModel }[] = []
    for (const h of noFinish) {
      const m = byBase.get(rowKeyOf(h))
      const alt = m && alternativesOf(m, catalog?.models ?? [], finishId).find(a => !taken.has(keyOf(a.supplier, a.base)))
      if (!alt) continue
      taken.add(keyOf(alt.supplier, alt.base))
      out.push({ id: h.id, to: alt })
    }
    return out
  })()
  const [replaceFor, setReplaceFor] = useState<string | null>(null)
  const replaceRow = hardware.find(h => h.id === replaceFor) ?? null
  const replaceKind = useMemo(() => {
    const mdl = replaceRow ? byBase.get(rowKeyOf(replaceRow)) : undefined
    return mdl ? kindOf(mdl) : undefined
  }, [replaceRow, byBase])
  const [pickerGroup, setPickerGroup] = useState<CatalogGroupId | null>(null)
  const closePicker = () => { setPicker(false); setPickFor(null); setReplaceFor(null); setPickerGroup(null) }
  const countIn = (m: CatalogModel) => { const h = hardware.find(x => rowKeyOf(x) === keyOf(m.supplier, m.base)); return h ? (h.stockMm == null ? numOr(h.qty) : 1) : 0 }
  // Подсказки длин — размеры стёкол: уплотнитель по высоте двери, порог по ширине.
  const dimChips = [...new Set(okPanels.flatMap(p => [numOr(p.h), numOr(p.w)]))].sort((a, b) => b - a)

  // Один экран (К9 В2, по образцу NextCAD): сверху строка настроек, в центре вид, справа панель —
  // выбранная деталь с вариантами или состав группами; итог и кнопки всегда на виду. Длинное
  // (шаблоны, стёкла, условия цены) свёрнуто, пока не нужно.
  const empty = !hardware.length && !pending.length && !panels.some(p => p.w || p.h)
  const [tplOpen, setTplOpen] = useState<boolean | null>(null)
  const showTpl = tplOpen ?? empty
  const allSized = panels.every(p => numOr(p.w) >= 50 && numOr(p.h) >= 50)
  const [glassOpen, setGlassOpen] = useState<boolean | null>(null)
  const showGlass = glassOpen ?? !allSized
  const [termsOpen, setTermsOpen] = useState(false)
  const [shut, setShut] = useState<Set<string>>(() => new Set())
  const groupLabel = new Map((catalog?.groups ?? []).map(g => [g.id, g.label] as const))
  const groupOfRow = (h: HwRow): CatalogGroupId => byBase.get(rowKeyOf(h))?.group ?? GROUP_OF[h.role] ?? (catalog?.groups.some(g => g.id === h.role) ? h.role as CatalogGroupId : 'other')
  const grouped = (catalog?.groups ?? [{ id: 'other' as CatalogGroupId, label: 'Детали' }])
    .map(g => ({ ...g, rows: hardware.filter(h => groupOfRow(h) === g.id) }))
    .filter(g => g.rows.length)
  const glassSummary = okPanels.map(p => {
    const lp = layout.elevation.panels.find(x => x.id === p.id)
    return `${p.label || 'Стекло'} ${numOr(p.w)}×${numOr(p.h)}${p.kind === 'door' ? ' · дверь' : p.kind === 'slide' ? ' · раздвижная' : ''}${shape === 'corner' && (lp?.run ?? p.run) === 'side' ? ' · сбоку' : ''}`
  }).join(' · ')
  const openPickerAt = (g: CatalogGroupId) => { setPickerGroup(g); setPicker(true) }
  // Лицо раздела в строке «Добавить» — фото детали самой частой разновидности в цвете изделия.
  const typeFace = useMemo(() => {
    const out = new Map<CatalogGroupId, string>()
    const tally = new Map<string, number>()
    for (const m of catalog?.models ?? []) { const k = `${m.group}|${kindOf(m).label}`; tally.set(k, (tally.get(k) ?? 0) + 1) }
    const best = new Map<CatalogGroupId, { n: number; img: string }>()
    for (const m of catalog?.models ?? []) {
      const img = m.variants[finishId]?.image
      if (!img) continue
      const n = tally.get(`${m.group}|${kindOf(m).label}`) ?? 0
      const cur = best.get(m.group)
      if (!cur || n > cur.n) best.set(m.group, { n, img })
    }
    for (const [g, v] of best) out.set(g, v.img)
    return out
  }, [catalog, finishId])

  const seg = (on: boolean) => `px-2.5 py-1.5 text-[12.5px] rounded-md transition-colors ${on ? 'bg-white text-[#111110] shadow-sm font-semibold' : 'text-[#6b6b66] hover:text-[#111110]'}`
  const segWrap = 'flex rounded-lg border border-[#e4e4e0] p-0.5 bg-[#f5f5f3]'
  const dot = (on: boolean) => `w-7 h-7 rounded-full border-2 transition-all ${on ? 'border-[#111110] scale-105' : 'border-white ring-1 ring-[#e4e4e0] hover:ring-[#111110]'}`

  const inspector = selRow && (() => {
    const num = hardware.findIndex(h => h.id === selRow.id) + 1
    const mdl = byBase.get(rowKeyOf(selRow))
    const lin = selRow.stockMm != null
    const line = hwLineOf(selRow.id)
    const waiting = lin ? !piecesOf(selRow).length : !(numOr(selRow.qty) > 0)
    const alts = mdl ? alternativesOf(mdl, catalog?.models ?? [], finishId) : []
    const unbind = (pieces: string) => setHw(selRow.id, { pieces, auto: undefined, ...(selRow.at === undefined ? { at: spotsOf(selRow) } : {}) })
    return (
      <div id="sel-card" className="space-y-2 scroll-mt-4">
        <div className="flex items-start gap-2.5">
          <Thumb src={mdl?.variants[finishId]?.image ?? mdl?.image} alt={selRow.label} size="w-14 h-14" />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-[#9a9a95]">{num}. {groupLabel.get(groupOfRow(selRow)) ?? 'Деталь'}{mdl ? ` · ${kindOf(mdl).label}` : ''}</div>
            <div className="text-[13.5px] font-semibold text-[#111110] leading-snug">{selRow.label}</div>
            <div className="text-[11px] text-[#9a9a95] font-mono truncate">{line?.article ?? selRow.base}<span className="font-sans"> · {SUPPLIER_RU[selRow.supplier ?? 'av24']}{materialOf(selRow.base) && ` · ${materialOf(selRow.base)}`}{lin && ` · полоса ${(selRow.stockMm! / 1000).toLocaleString('ru-RU')} м`}</span></div>
          </div>
          <button onClick={() => setPicked(null)} className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[12px] font-semibold shrink-0">Готово</button>
        </div>
        {lin ? (
          <div className="space-y-1.5">
            <input className={fld} value={selRow.auto ? piecesOf(selRow).join(', ') : selRow.pieces} onChange={e => unbind(e.target.value)} placeholder="куски, мм: 2004, 2004" />
            {selRow.auto && <p className="text-[11px] text-[#9a9a95]">Длины от размеров стёкол — меняются вместе с ними. Правка руками отвяжет.</p>}
            {!!dimChips.length && (
              <div className="flex flex-wrap gap-1.5">
                {dimChips.map(v => <button key={v} onClick={() => unbind([...piecesOf(selRow), v].join(', '))} className="px-2 py-0.5 rounded-md border border-[#e4e4e0] text-[12px] font-mono text-[#4b4b47] hover:border-[#111110]">+{v}</button>)}
              </div>
            )}
          </div>
        ) : null}
        <div className="flex items-center gap-1.5 flex-wrap">
          {!lin && (
            <>
              <button onClick={() => setHw(selRow.id, { qty: String(Math.max(0, numOr(selRow.qty) - 1)) })} className="w-8 h-8 rounded-lg border border-[#e4e4e0] bg-white text-[16px]">−</button>
              <input inputMode="numeric" className={qtyFld} value={selRow.qty} onChange={e => setHw(selRow.id, { qty: e.target.value })} />
              <button onClick={() => setHw(selRow.id, { qty: String(numOr(selRow.qty) + 1) })} className="w-8 h-8 rounded-lg border border-[#e4e4e0] bg-white text-[16px]">+</button>
              <span className="text-[12px] text-[#9a9a95] mr-1">шт</span>
            </>
          )}
          <span className="text-[12px] ml-auto text-right">
            {waiting ? <span className="text-[#c2410c]">{lin ? 'Впишите длины кусков или нажмите размер' : 'Укажите количество'}</span>
              : line?.total != null ? (
                <span className="text-[#4b4b47]">
                  {RUB2(line.unit!)} × {line.qty}{lin ? ` ${line.qty === 1 ? 'полоса' : 'полосы'}` : ''} = <b className="font-mono">{RUB2(line.total)}</b>
                  {lin && line.layout && <span className="block text-[#9a9a95]">раскрой {line.layout.map(s => s.join('+')).join(' | ')}</span>}
                </span>
              ) : fresh ? <span className="text-[#c2410c]">не посчитано — см. итог</span> : <span className="text-[#9a9a95]">считаю…</span>}
          </span>
        </div>
        <div className="text-[12px] text-[#4b4b47] rounded-lg bg-[#f5f8ff] border border-[#dfe6f5] px-2.5 py-1.5">
          <span className="text-[#111110]">{selSpots.length ? whereText(selRow) : 'На схеме её нет.'}</span>
          {selRow.at === undefined && selSpots.length > 0 && <span className="text-[#9a9a95]"> · по умолчанию</span>}
          <span className="block text-[11px] text-[#6b6b66]">Касание кромки на схеме ставит или убирает деталь.{selRow.at !== undefined && <> <button onClick={() => setHw(selRow.id, { at: undefined })} className="text-[#2563eb] hover:underline">Как по умолчанию</button></>}</span>
        </div>
        {mdl && !mdl.variants[finishId] && (
          <p className="text-[12px] text-[#c2410c]">В цвете «{finish.label}» этой детали нет — выберите замену: варианты ниже в этом цвете есть.</p>
        )}
        {mdl && alts.length > 0 && (
          <Variants current={mdl} alts={alts} finishId={finishId} kindLabel={kindOf(mdl).label} cols="grid-cols-4 md:grid-cols-8 lg:grid-cols-4"
            inUse={inUseElsewhere(selRow.id)} onSwap={m => swapRow(selRow.id, m)}
            onAll={() => { setReplaceFor(selRow.id); setPicker(true) }} />
        )}
        <button onClick={() => { set({ hardware: hardware.filter(x => x.id !== selRow.id) }); setPicked(null) }} className="text-[12px] text-[#9a9a95] hover:text-[#c2410c]">Убрать из состава</button>
      </div>
    )
  })()

  const composition = (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-[#111110]">Состав{hardware.length ? ` · ${hardware.length}` : ''}</h2>
        <button onClick={() => setPicker(true)} disabled={!catalog} className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[12.5px] font-semibold hover:bg-[#2a2a28] disabled:opacity-40">+ Из каталога</button>
      </div>
      {catalogErr && <p className="text-[12px] text-[#c2410c]">{catalogErr}</p>}
      {noFinish.length > 0 && (
        <div className="rounded-xl border border-[#f1d3bf] bg-[#fdf6f1] p-2.5 space-y-1.5">
          <p className="text-[12px] text-[#c2410c]">В цвете «{finish.label}» нет: {noFinish.map(h => h.base).join(', ')}. Цена без них не считается.</p>
          {finishSwaps.length > 0
            ? <>
                <button onClick={() => finishSwaps.forEach(x => swapRow(x.id, x.to))} className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[12px] font-semibold">
                  Заменить {finishSwaps.length === noFinish.length ? '' : `${finishSwaps.length} из ${noFinish.length} `}на похожие в этом цвете
                </button>
                <p className="text-[11px] text-[#9a9a95]">Та же разновидность, ближе по цене; не подойдёт — коснитесь строки и выберите другую.</p>
              </>
            : <p className="text-[11px] text-[#9a9a95]">Похожих в этом цвете в каталоге нет — верните цвет или подберите деталь вручную.</p>}
        </div>
      )}
      {pending.length > 0 && (
        <div className="rounded-xl border border-[#f1d3bf] bg-[#fdf6f1] p-2.5 space-y-1">
          <p className="text-[12px] text-[#c2410c]"><b>Из чертежа{draft.step?.file ? ` «${draft.step.file}»` : ''} — нет в каталоге · {pending.length}.</b> На схеме стоят, в цену не вошли.</p>
          {pending.map((p, j) => (
            <div key={p.id} id={`pend-${p.id}`} className={`flex items-start gap-2 rounded-lg p-1.5 -mx-1 scroll-mt-24 ${pendFocus === p.id ? 'bg-white ring-1 ring-[#f1d3bf]' : ''}`}>
              <span className="min-w-[20px] h-5 px-1 mt-0.5 rounded-full border border-[#c2410c] text-[11px] font-semibold text-[#c2410c] grid place-items-center shrink-0">{hardware.length + j + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] text-[#111110] leading-snug">{p.name}</div>
                <div className="text-[11px] text-[#6b6b66]">{p.pieces?.length ? `куски ${p.pieces.join(', ')} мм` : `${p.qty} шт`}{p.at.length ? ` · ${p.at.map(spotText).join('; ')}` : ' · место в чертеже не нашёл'}</div>
                <button onClick={() => { setPickFor(p.id); setPicker(true) }} disabled={!catalog} className="text-[12px] text-[#2563eb] hover:underline disabled:opacity-40">Подобрать из каталога</button>
              </div>
              <button onClick={() => dropPending(p.id)} className="text-[#9a9a95] hover:text-[#c2410c] px-1" aria-label="Убрать">✕</button>
            </div>
          ))}
        </div>
      )}
      {!hardware.length && !pending.length && <p className="text-[12.5px] text-[#9a9a95]">Петли, ручки, коннекторы, уплотнители — из каталогов АВ24 и Ветро, цена в выбранном цвете. Добавьте кнопкой выше или типом под видом.</p>}
      {grouped.map(g => {
        const open = !shut.has(g.id)
        const sum = g.rows.reduce((s, h) => s + (hwLineOf(h.id)?.total ?? 0), 0)
        return (
          <div key={g.id} className="border-t border-[#efefeb] first:border-t-0">
            <button onClick={() => setShut(s => { const n = new Set(s); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n })}
              className="w-full flex items-center justify-between gap-2 py-1.5 text-left">
              <span className="text-[12.5px] font-semibold text-[#111110]">{g.label} <span className="font-normal text-[#9a9a95]">· {g.rows.length}</span></span>
              <span className="text-[12px] font-mono text-[#4b4b47]">{!open && sum > 0 && RUB(sum)} <span className="text-[#9a9a95] font-sans">{open ? '▾' : '▸'}</span></span>
            </button>
            {open && g.rows.map(h => {
              const idx = hardware.indexOf(h)
              const mdl = byBase.get(rowKeyOf(h))
              const line = hwLineOf(h.id)
              const lin = isLinear(h)
              const waiting = lin ? !piecesOf(h).length : !(numOr(h.qty) > 0)
              const placed = spotsOf(h).length > 0
              const absent = !!mdl && !mdl.variants[finishId]
              return (
                <button key={h.id} id={`hw-${h.id}`} onClick={() => pickRow(h.id, 'card')}
                  className="w-full flex items-center gap-2 py-1.5 px-1 -mx-1 rounded-lg text-left hover:bg-[#f5f5f3] scroll-mt-24">
                  <span className="relative shrink-0">
                    <Thumb src={mdl?.variants[finishId]?.image ?? mdl?.image} alt={h.label} size="w-10 h-10" />
                    <span className="absolute -top-1 -left-1 min-w-[18px] h-[18px] px-1 rounded-full border border-[#111110] bg-white text-[10px] font-semibold text-[#111110] grid place-items-center">{idx + 1}</span>
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12.5px] text-[#111110] leading-tight truncate">{h.label}</span>
                    <span className={`block text-[11px] truncate ${waiting || absent ? 'text-[#c2410c]' : 'text-[#9a9a95]'}`}>
                      {absent ? `нет в цвете «${finish.label}» — замените`
                        : <>{waiting ? (lin ? 'впишите длины' : 'укажите количество') : lin ? `${piecesOf(h).join(' + ')} мм` : `${numOr(h.qty)} шт`}
                          {' · '}{SUPPLIER_RU[h.supplier ?? 'av24']}{!placed && ' · нет на схеме'}</>}
                    </span>
                  </span>
                  <span className="text-[12px] font-mono text-[#111110] shrink-0">{line?.total != null ? RUB(line.total) : ''}</span>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_auto_1fr] lg:items-start pb-28 lg:pb-0">
      <section className="order-1 lg:col-start-1 lg:row-start-1 bg-white border border-[#e4e4e0] rounded-2xl px-3 py-2.5 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setTplOpen(!showTpl)} disabled={!catalog}
            className={`px-3 py-1.5 rounded-lg border text-[12.5px] disabled:opacity-40 ${showTpl ? 'border-[#111110] bg-[#f5f5f3]' : 'border-[#e4e4e0] hover:border-[#111110]'}`}>
            Шаблон{draft.kind ? `: ${draft.kind}` : ''} <span className="text-[#9a9a95]">{showTpl ? '▴' : '▾'}</span>
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={!catalog} title="Сборка душевой из SolidWorks: стёкла, форма и места петель, ручки, держателей — как начерчено"
            className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12.5px] text-[#111110] hover:border-[#111110] disabled:opacity-40">
            Из SolidWorks (STEP)
          </button>
          <input ref={fileRef} type="file" accept=".step,.stp" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importStep(f) }} />
          <div className={segWrap}>{SHAPES.map(s => <button key={s.id} onClick={() => set({ shape: s.id })} className={seg(shape === s.id)}>{s.label}</button>)}</div>
          <div className={segWrap}>{THICKNESSES.map(t => <button key={t} onClick={() => set({ thickness: t })} className={seg(thickness === t)}>{t} мм</button>)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[11.5px] text-[#6e6e73] w-12">Стекло</span>
            {GLASS.map(g => <button key={g.id} onClick={() => set({ glassId: g.id })} title={g.label} aria-label={g.label} className={dot(glassId === g.id)} style={{ background: g.swatch }} />)}
            <span className="text-[12px] text-[#111110] ml-1">{glassLabel}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11.5px] text-[#6e6e73]">Фурнитура</span>
            {FINISHES.map(f => <button key={f.id} onClick={() => set({ finishId: f.id })} title={f.label} aria-label={f.label} className={dot(finishId === f.id)} style={{ background: f.hex }} />)}
            <span className="text-[12px] text-[#111110] ml-1">{finish.label}</span>
          </div>
          <button onClick={clearAll} className="ml-auto text-[12px] text-[#9a9a95] hover:text-[#c2410c]">Очистить состав</button>
        </div>
        {showTpl && (
          <div className="space-y-1.5 pt-1">
            <p className="text-[11px] text-[#9a9a95]">Типовые душевые по 961 монтажу 2022–2026: стёкла и фурнитура одним касанием, дальше впишите размеры. Доля — среди всех установленных душевых.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {COMPOSE_TEMPLATES.map(t => (
                <button key={t.id} onClick={() => { pickTemplate(t); setTplOpen(false) }} disabled={!catalog}
                  className={`text-left rounded-xl border px-2.5 py-2 transition-colors disabled:opacity-40 ${draft.kind === t.label ? 'border-[#111110] bg-[#f5f5f3]' : 'border-[#e4e4e0] bg-white hover:border-[#111110]'}`}>
                  <span className="block text-[12.5px] font-semibold text-[#111110] leading-snug">{t.label}</span>
                  <span className="block text-[11px] text-[#6b6b66]">{t.share} · {t.source}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {tplMissing.length > 0 && <p className="text-[12px] text-[#c2410c]">Нет в каталоге АВ24, строка не добавлена: {tplMissing.join(', ')}.</p>}
        {stepMsg && (
          <div className={`text-[12px] ${stepMsg.ok ? 'text-[#4b4b47]' : 'text-[#c2410c]'}`}>
            {stepMsg.text}
            {stepMsg.notes.length > 0 && <ul className="list-disc pl-4 mt-0.5 text-[#6b6b66]">{stepMsg.notes.map(n => <li key={n}>{n}</li>)}</ul>}
          </div>
        )}
        {shape === 'corner' && !panels.some(p => p.run === 'side') && (
          <p className="text-[11px] text-[#c2410c]">Угловая: отметьте у бокового стекла «сбоку» в «Стёклах» — иначе схема покажет все стёкла в один ряд.</p>
        )}
      </section>

      <section ref={schemeRef} className="order-2 lg:col-start-1 lg:row-start-2 bg-white border border-[#e4e4e0] rounded-2xl p-3 space-y-2 scroll-mt-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <div className={segWrap}>
              {([['scheme', 'Схема'], ['3d', '3D']] as const).map(([id, name]) => <button key={id} onClick={() => setView(id)} className={seg(view === id)}>{name}</button>)}
            </div>
            {view === '3d' && layout.elevation.panels.some(p => p.kind !== 'fixed') && (
              <button onClick={() => setDoorOpen(o => !o)} className={miniChip(false)}>{doorOpen ? 'Закрыть двери' : 'Открыть двери'}</button>
            )}
          </div>
          {layout.elevation.panels.length > 0 && !selRow && (
            <span className="text-[11px] text-[#9a9a95] text-right">
              {view === '3d' ? 'крутите пальцем или мышью · касание детали — её варианты' : 'коснитесь детали — откроются её варианты'}
            </span>
          )}
        </div>
        {!layout.elevation.panels.length
          ? <p className="text-[13px] text-[#9a9a95] py-6 text-center">Выберите шаблон или впишите размеры стёкол — здесь появится вид снаружи и план сверху.</p>
          : view === '3d'
            ? (
              <div className="space-y-1">
                <div className="[&>div]:!h-[360px] md:[&>div]:!h-[400px] lg:[&>div]:!h-[320px]" title="Уплотнители на сцене не показаны; место детали меняется на схеме">
                  <Partition3DView model={SCENE_MODEL} dims={sceneDims} thickness={thickness} assembly={asm}
                    finishHex={finish.hex} finishId={finish.id} glassTint={GLASS.find(g => g.id === glassId)?.tint ?? GLASS[0].tint} doorOpen={doorOpen}
                    onPick={n => { const id = rowOfKey(n.key); if (id) pickRow(id, 'card') }} pickedPrefix={selected ? `row:${selected}:` : null} />
                </div>
                <p className="text-[11px] text-[#9a9a95] lg:hidden">Уплотнители на сцене не показаны; место детали меняется на схеме.</p>
              </div>
            )
            : <ComposeScheme elevation={layout.elevation} plan={layout.plan} selected={selected} activeSpots={selSpots}
                onSelect={id => pickRow(id, 'card')} onEdge={toggleSpot}
                glassSwatch={GLASS.find(g => g.id === glassId)?.swatch ?? '#dfeaf6'} finishHex={finish.hex} />}
        {/* На ноутбуке это видно в составе справа («нет на схеме») — строка здесь съела бы экран. */}
        {unplacedHw.length > 0 && !selRow && (
          <p className="text-[12px] text-[#6b6b66] lg:hidden">
            Не на схеме:{' '}
            {unplacedHw.map((id, i) => {
              const h = hardware.find(x => x.id === id)!
              return <span key={id}>{i > 0 && ', '}<button onClick={() => pickRow(id, 'card')} className="text-[#2563eb] hover:underline">{hardware.indexOf(h) + 1}. {h.label}</button></span>
            })}
            <span className="text-[#9a9a95]"> — выберите и коснитесь кромки.</span>
          </p>
        )}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-1 -mx-1 px-1 border-t border-[#efefeb]">
          <span className="text-[11.5px] text-[#6e6e73] shrink-0 pr-0.5">Добавить:</span>
          {(catalog?.groups ?? []).map(g => (
            <button key={g.id} onClick={() => openPickerAt(g.id)} className="shrink-0 flex items-center gap-1.5 whitespace-nowrap pl-1 pr-2.5 py-1 rounded-lg bg-[#f5f5f3] text-[12px] text-[#4b4b47] hover:bg-[#ebebe7] hover:text-[#111110]">
              <Thumb src={typeFace.get(g.id)} alt={g.label} size="w-7 h-7" />+ {g.label}
            </button>
          ))}
        </div>
      </section>

      <section className="order-4 lg:col-start-1 lg:row-start-3 bg-white border border-[#e4e4e0] rounded-2xl px-3 py-2.5 space-y-2">
        <button onClick={() => setGlassOpen(!showGlass)} className="w-full flex items-center justify-between gap-2 text-left">
          <span className="min-w-0">
            <span className="text-[14px] font-semibold text-[#111110]">Стёкла · {panels.length}</span>
            {!showGlass && glassSummary && <span className="text-[12px] text-[#6b6b66]"> — {glassSummary}</span>}
          </span>
          <span className="text-[12px] text-[#2563eb] shrink-0">{showGlass ? 'Свернуть ▴' : 'Изменить ▾'}</span>
        </button>
        {showGlass && (
          <div className="space-y-2">
            {panels.map((p, i) => {
              const line = fresh?.glass.lines[okPanels.findIndex(x => x.id === p.id)]
              const half = !!(p.w || p.h) && !(numOr(p.w) >= 50 && numOr(p.h) >= 50)
              return (
                <div key={p.id} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-end">
                  <div><label className={lbl}>{i === 0 ? 'Название' : ' '}</label><input className={`${fld} font-sans`} value={p.label} onChange={e => setPanel(p.id, { label: e.target.value })} /></div>
                  <div><label className={lbl}>{i === 0 ? 'Ширина, мм' : ' '}</label><input inputMode="numeric" className={fld} value={p.w} onChange={e => setPanel(p.id, { w: e.target.value })} placeholder="900" /></div>
                  <div><label className={lbl}>{i === 0 ? 'Высота, мм' : ' '}</label><input inputMode="numeric" className={fld} value={p.h} onChange={e => setPanel(p.id, { h: e.target.value })} placeholder="2000" /></div>
                  <button onClick={() => set({ panels: panels.filter(x => x.id !== p.id) })} disabled={panels.length === 1}
                    className="h-[38px] w-[38px] rounded-lg border border-[#e4e4e0] text-[#9a9a95] hover:text-[#c2410c] disabled:opacity-30" aria-label="Убрать стекло">✕</button>
                  <div className="col-span-4 flex flex-wrap items-center gap-1.5">
                    {KINDS.map(k => <button key={k.id} onClick={() => setPanel(p.id, { kind: k.id })} className={miniChip(p.kind === k.id)}>{k.label}</button>)}
                    {p.kind === 'door' && (() => {
                      const hinge = layout.elevation.panels.find(x => x.id === p.id)?.hinge ?? p.hinge
                      return (
                        <>
                          <span className="text-[11px] text-[#9a9a95] ml-1.5">петли</span>
                          {(['left', 'right'] as const).map(sd => <button key={sd} onClick={() => setPanel(p.id, { hinge: sd })} className={miniChip(hinge === sd)}>{sd === 'left' ? 'слева' : 'справа'}</button>)}
                        </>
                      )
                    })()}
                    {shape === 'corner' && (
                      <>
                        <span className="text-[11px] text-[#9a9a95] ml-1.5">ряд</span>
                        <button onClick={() => setPanel(p.id, { run: 'front' })} className={miniChip(p.run !== 'side')}>спереди</button>
                        <button onClick={() => setPanel(p.id, { run: 'side' })} className={miniChip(p.run === 'side')}>сбоку</button>
                      </>
                    )}
                    {(line || half) && (
                      <span className={`text-[11px] ml-auto ${half ? 'text-[#c2410c]' : 'text-[#9a9a95]'}`}>
                        {half ? 'Впишите оба размера от 50 мм' : `${line!.areaM2.toLocaleString('ru-RU')} м² × ${RUB(line!.pricePerM2)} → ${RUB(line!.total)}`}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
            <div className="flex flex-wrap gap-2">
              {([['Дверь', 'door'], ['Неподвижное', 'fixed']] as const).map(([name, kind]) => (
                <button key={kind} disabled={panels.length >= 12}
                  onClick={() => set({ panels: [...panels, { id: uid(), label: `${name} ${panels.filter(p => p.label.startsWith(name)).length + 1}`, w: '', h: '', kind }] })}
                  className="px-3 py-1.5 rounded-lg border border-dashed border-[#c9c9c4] text-[12.5px] text-[#4b4b47] hover:border-[#111110] disabled:opacity-40">
                  + {name.toLowerCase()}
                </button>
              ))}
              <span className="text-[11px] text-[#9a9a95] self-center">Цена стекла — со скидкой M GLASS.</span>
            </div>
          </div>
        )}
      </section>

      <aside className="order-3 lg:col-start-2 lg:row-start-1 lg:row-span-3 lg:sticky lg:top-3 lg:h-[calc(100dvh-5.5rem)] lg:max-h-[860px] flex flex-col gap-3 min-h-0">
        <section className="bg-white border border-[#e4e4e0] rounded-2xl p-3 lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
          {inspector || composition}
        </section>

        <section className="bg-white border border-[#e4e4e0] rounded-2xl p-3 space-y-2 text-[13px] shrink-0 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:rounded-none max-lg:border-x-0 max-lg:border-b-0 max-lg:shadow-[0_-4px_16px_rgba(0,0,0,0.06)] max-lg:max-h-[70dvh] max-lg:overflow-y-auto">
          {/* На планшете и телефоне итог закреплён внизу: видны «К оплате» и кнопки, разбивка — по «Подробнее». */}
          <div className={`space-y-0.5 ${termsOpen ? '' : 'max-lg:hidden'}`}>
            <div className="flex justify-between"><span className="text-[#6b6b66]">Себестоимость</span><span className="font-mono font-semibold">{RUB(cost)}</span></div>
            {/* Фурнитура — вычитанием из округлённых: стекло + фурнитура = себестоимость и на экране. */}
            <div className="text-[11px] text-[#9a9a95]">стекло {RUB(glassCost)} + фурнитура (закупка) {RUB(Math.round(cost) - Math.round(glassCost))}</div>
            {usable && (
              <div className="text-[11.5px] text-[#6b6b66]">
                Изделие {RUB(productPrice)}{install > 0 && ` · монтаж ${sections} × ${RUB(numOr(perSection))}`}{deliveryN > 0 && ` · доставка ${RUB(deliveryN)}`}{liftN > 0 && ` · подъём ${RUB(liftN)}`}{discPct > 0 && ` · скидка ${discPct}%`}
              </div>
            )}
          </div>
          {fresh && fresh.stops.length > 0 && <ul className="text-[12px] text-[#c2410c] space-y-0.5 list-disc pl-4">{fresh.stops.map(s => <li key={s}>{s}</li>)}</ul>}
          {state === 'error' && err && <p className="text-[12px] text-[#c2410c]">Расчёт не выполнен: {err}</p>}
          {!okPanels.length && <p className="text-[12px] text-[#9a9a95]">Впишите размер хотя бы одного стекла — расчёт начнётся сам.</p>}
          <div className="flex flex-col gap-2 md:max-lg:flex-row md:max-lg:items-center">
            <div className={`flex items-center justify-between md:max-lg:flex-1 md:max-lg:justify-start md:max-lg:gap-3 ${termsOpen ? 'pt-1.5 border-t border-[#e4e4e0]' : 'lg:pt-1.5 lg:border-t lg:border-[#e4e4e0]'}`}>
              <span className="text-[14px] font-semibold text-[#111110]">К оплате{cartCount ? ` (изделие ${cartCount + 1})` : ''}</span>
              <span className="text-[22px] font-bold font-mono text-[#111110]">{usable ? RUB(grand) : '—'}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 md:max-lg:w-[400px] md:max-lg:shrink-0">
              <button onClick={add} disabled={!usable || grand <= 0 || dirty}
                className="px-4 py-2.5 border border-[#111110] text-[#111110] text-[13px] font-semibold rounded-lg hover:bg-[#f0f0ec] disabled:opacity-40">+ В КП</button>
              <button onClick={onSave} disabled={saving || cartCount === 0}
                className="px-4 py-2.5 bg-[#111110] text-white text-[13px] font-semibold rounded-lg hover:bg-[#2a2a28] disabled:opacity-40">
                {saving ? 'Сохраняю…' : `Сохранить${cartCount ? ` (${cartCount})` : ''} → КП`}
              </button>
            </div>
          </div>
          {dirty && okPanels.length > 0 && state !== 'error' && <p className="text-[11px] text-[#9a9a95]">пересчёт цены…</p>}
          {!dirty && !usable && okPanels.length > 0 && <p className="text-[11px] text-[#c2410c]">Расчёт неполный — {pending.length ? 'детали из чертежа ждут подбора из каталога' : halfDone ? 'не у всех строк есть размер, количество или длины' : 'причины выше'}. В КП не добавляю.</p>}
          {added && <p className="text-[11px] text-emerald-700">✓ {added}</p>}
          {noteSlot}
          <button onClick={() => setTermsOpen(o => !o)} className="w-full flex items-center justify-between text-[12px] text-[#2563eb]">
            <span><span className="lg:hidden">Подробнее, условия и клиент</span><span className="max-lg:hidden">Условия и клиент</span>{!clientOk ? <span className="text-[#9a9a95]"> · клиент нужен для сохранения</span> : ''}</span>
            <span>{termsOpen ? '▴' : '▾'}</span>
          </button>
          {termsOpen && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div><label className={lbl}>Маржа, %</label><input inputMode="decimal" className={fld} value={margin} onChange={e => { marginTouched.current = true; setMargin(e.target.value) }} /></div>
                <div><label className={lbl}>Налог, %</label><input inputMode="decimal" className={fld} value={tax} onChange={e => { taxTouched.current = true; setTax(e.target.value) }} /></div>
                <div><label className={lbl}>Монтаж/секц.</label><input inputMode="numeric" className={fld} value={perSection} onChange={e => setPerSection(e.target.value)} /></div>
                <div><label className={lbl}>Секций</label><input inputMode="numeric" className={fld} value={sectionsOver} onChange={e => setSectionsOver(e.target.value)} placeholder={String(okPanels.length || 1)} /></div>
                <div><label className={lbl}>Доставка</label><input inputMode="numeric" className={fld} value={delivery} onChange={e => setDelivery(e.target.value)} /></div>
                <div><label className={lbl}>Подъём</label><input inputMode="numeric" className={fld} value={lift} onChange={e => setLift(e.target.value)} placeholder="0" /></div>
                <div><label className={lbl}>Скидка, %</label><input inputMode="decimal" className={fld} value={discount} onChange={e => setDiscount(e.target.value)} /></div>
              </div>
              <div className="text-[11px] text-[#9a9a95]">Маржа и налог по умолчанию: {financeSource}. Секций по умолчанию — по числу стёкол.</div>
              {fresh && fresh.notes.length > 0 && <ul className="text-[11px] text-[#9a9a95] space-y-0.5 list-disc pl-4">{fresh.notes.map(s => <li key={s}>{s}</li>)}</ul>}
              {clientSlot}
            </div>
          )}
          {cartCount === 0 && termsOpen && <p className="text-[11px] text-[#9a9a95]">«+ В КП» кладёт изделие в корзину расчёта; «Сохранить» делает из корзины расчёт и КП.</p>}
        </section>
      </aside>

      {picker && catalog && (
        <Picker catalog={catalog} finishId={finishId} finishLabel={finish.label} countIn={countIn}
          onPick={pickForRow ? resolvePending : replaceRow ? m => { swapRow(replaceRow.id, m); closePicker() } : addModel} onClose={closePicker}
          full={!pickForRow && !replaceRow && hardware.length >= 30} forName={pickForRow?.name ?? replaceRow?.label}
          replacing={!!replaceRow} kind={replaceKind} linear={replaceRow ? replaceRow.stockMm != null : undefined}
          current={replaceRow ? byBase.get(rowKeyOf(replaceRow)) : undefined}
          initialGroup={pickForRow ? GROUP_OF[pickForRow.role] ?? (pickForRow.role as CatalogGroupId) : replaceRow ? byBase.get(rowKeyOf(replaceRow))?.group : pickerGroup ?? undefined} />
      )}
    </div>
  )
}

function Picker({ catalog, finishId, finishLabel, countIn, onPick, onClose, full, forName, initialGroup, replacing, kind, linear, current }: {
  catalog: Catalog
  finishId: FinishId
  finishLabel: string
  countIn: (m: CatalogModel) => number
  onPick: (m: CatalogModel) => void
  onClose: () => void
  full: boolean
  forName?: string                // подбор позиции для детали из чертежа или замена строки: выбор закрывает окно
  initialGroup?: CatalogGroupId
  replacing?: boolean
  kind?: Kind                     // замена: только эта разновидность, пока фишку не сняли
  linear?: boolean                // замена: погонную — только на погонную
  current?: CatalogModel          // замена: от неё меряется «ближе по цене»
}) {
  const [group, setGroup] = useState<CatalogGroupId>(initialGroup && catalog.groups.some(g => g.id === initialGroup) ? initialGroup : 'hinge')
  const [q, setQ] = useState('')
  const [onlyFinish, setOnlyFinish] = useState(true)
  const [onlyKind, setOnlyKind] = useState(!!kind)
  // Разновидность внутри раздела (К9 В3): «Ручки» → кноб 91 · скоба 68 · купе 26…
  const [sub, setSub] = useState<string | null>(null)
  const needle = q.trim().toLowerCase().replace(/x/g, 'х')
  const match = (m: CatalogModel) => !needle || `${m.name} ${m.base} ${m.category} ${SUPPLIER_RU[m.supplier]}`.toLowerCase().replace(/x/g, 'х').includes(needle)
  const avail = (m: CatalogModel) => !onlyFinish || !!m.variants[finishId]
  // Поиск идёт по всем разделам: менеджер помнит артикул, а не раздел.
  const fits = (m: CatalogModel) => (linear === undefined || (m.stockMm != null) === linear) && (!kind || !onlyKind || (m.group === group && sameKind(kind, kindOf(m))))
  const list = catalog.models.filter(m => (needle ? true : m.group === group && (!sub || kindOf(m).label === sub)) && match(m) && avail(m) && fits(m))
  const subs = useMemo(() => {
    const c = new Map<string, number>()
    for (const m of catalog.models) {
      if (m.group !== group || (onlyFinish && !m.variants[finishId]) || (linear !== undefined && (m.stockMm != null) !== linear)) continue
      const l = kindOf(m).label
      c.set(l, (c.get(l) ?? 0) + 1)
    }
    return [...c].sort((a, b) => b[1] - a[1])
  }, [catalog, group, finishId, onlyFinish, linear])
  // В «Все» частые разновидности впереди: кнобы и скобы, а не заглушки и ручки для саун по алфавиту.
  const rank = new Map(subs.map(([l], i) => [l, i]))
  // Замена — ближе по закупке к текущей детали выше, как в «Заменить на».
  const near = (m: CatalogModel) => { const c = m.variants[finishId]?.cost; return current?.variants[finishId] && c ? Math.abs(Math.log(c / current.variants[finishId]!.cost)) : 99 }
  const shown = needle ? list
    : current && kind && onlyKind ? [...list].sort((a, b) => near(a) - near(b))
    : [...list].sort((a, b) => (rank.get(kindOf(a).label) ?? 99) - (rank.get(kindOf(b).label) ?? 99))
  const counts = useMemo(() => {
    const c: Partial<Record<CatalogGroupId, number>> = {}
    for (const m of catalog.models) if (avail(m)) c[m.group] = (c[m.group] ?? 0) + 1
    return c
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, finishId, onlyFinish])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex md:p-6" onClick={onClose}>
      <div className="bg-[#f5f5f3] flex-1 flex flex-col md:rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-white border-b border-[#e4e4e0] p-3 space-y-2">
          {forName && !replacing && <p className="text-[12.5px] text-[#4b4b47]">Позиция каталога для детали из чертежа: <b className="text-[#111110]">{forName}</b>. Количество и места останутся как в чертеже.</p>}
          {forName && replacing && <p className="text-[12.5px] text-[#4b4b47]">Замена для <b className="text-[#111110]">{forName}</b>: количество и места на схеме останутся.</p>}
          <div className="flex items-center gap-2">
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск: FDP-230, Dessau-103, петля 90, ветро…"
              className="flex-1 bg-[#f5f5f3] border border-[#e4e4e0] rounded-lg px-3 py-2.5 text-[14px] outline-none focus:border-[#111110]" />
            <button onClick={onClose} className="px-4 py-2.5 rounded-lg bg-[#111110] text-white text-[13px] font-semibold">Готово</button>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5 -mx-1 px-1">
            {catalog.groups.map(g => (
              <button key={g.id} onClick={() => { setGroup(g.id); setQ(''); setSub(null) }}
                className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-[13px] ${!needle && group === g.id ? 'bg-[#111110] text-white' : 'bg-[#f5f5f3] text-[#4b4b47]'}`}>
                {g.label} <span className="opacity-60">{counts[g.id] ?? 0}</span>
              </button>
            ))}
          </div>
          {!needle && subs.length > 1 && !(kind && onlyKind) && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
              <button onClick={() => setSub(null)} className={`${miniChip(!sub)} whitespace-nowrap`}>Все</button>
              {subs.map(([l, n]) => (
                <button key={l} onClick={() => setSub(l === sub ? null : l)} className={`${miniChip(sub === l)} whitespace-nowrap`}>
                  {l[0].toUpperCase() + l.slice(1)} <span className="opacity-60">{n}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap">
            <label className="flex items-center gap-2 text-[12px] text-[#6e6e73]">
              <input type="checkbox" checked={onlyFinish} onChange={e => setOnlyFinish(e.target.checked)} />
              Только то, что есть в цвете «{finishLabel}»
            </label>
            {kind && (
              <label className="flex items-center gap-2 text-[12px] text-[#6e6e73]">
                <input type="checkbox" checked={onlyKind} onChange={e => setOnlyKind(e.target.checked)} />
                Только «{kind.label}»
              </label>
            )}
          </div>
          {full && <p className="text-[12px] text-[#c2410c]">В изделии уже 30 позиций — больше расчёт не принимает.</p>}
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {!list.length && <p className="text-[13px] text-[#9a9a95] p-2">Ничего не нашлось{onlyFinish ? ` в цвете «${finishLabel}» — снимите галочку, чтобы увидеть остальные цвета` : ''}.</p>}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-2">
            {shown.map(m => {
              const v = m.variants[finishId]
              const n = countIn(m)
              return (
                <button key={`${m.supplier}|${m.base}`} onClick={() => v && onPick(m)} disabled={!v || (full && !n)}
                  className={`relative text-left bg-white rounded-xl border p-2 flex flex-col gap-1.5 transition-colors ${n ? 'border-[#111110]' : 'border-[#e4e4e0] hover:border-[#111110]'} disabled:opacity-50 disabled:hover:border-[#e4e4e0]`}>
                  <Thumb src={v?.image ?? m.image} alt={m.name} size="w-full aspect-square" />
                  {n > 0 && <span className="absolute top-3 right-3 bg-[#111110] text-white text-[11px] font-semibold rounded-full px-2 py-0.5">{m.stockMm == null ? `×${n}` : '✓'}</span>}
                  <span className="text-[12px] leading-snug text-[#111110] line-clamp-3">{m.name}</span>
                  <span className="text-[10.5px] text-[#9a9a95] font-mono">{m.base}<span className="font-sans"> · {SUPPLIER_RU[m.supplier]}</span>{materialOf(m.base) && <span className="font-sans"> · {materialOf(m.base)}</span>}</span>
                  <span className="text-[12px] font-mono text-[#111110] mt-auto">
                    {v ? <>{RUBk(v.cost)}{m.stockMm != null && <span className="font-sans text-[#9a9a95]"> / {(m.stockMm / 1000).toLocaleString('ru-RU')} м</span>}</>
                      : <span className="font-sans text-[#c2410c]">нет в этом цвете</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
