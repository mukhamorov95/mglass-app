'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FINISHES, type FinishId } from '@/lib/configurator/catalog'
import { calcFinancialModel } from '@/lib/pricing/financialModel'
import { FINANCE_FALLBACK, type Finance } from '@/lib/pricing/pickFinance'
import type { BomItem } from '@/lib/kp/bomSections'
import type { CompositionResult, CompositionRole } from '@/lib/calc/composition'
import type { CatalogGroupId, CatalogModel } from '@/lib/calc/compositionCatalog'
import { COMPOSE_TEMPLATES, applyTemplate, resolvePieces, type ComposeTemplate } from '@/lib/calc/composeTemplates'
import { DRAFT_KEY, DRAFT_KEY_V1, migrateDraft, type Draft, type Edge, type HwRow, type PanelKind, type PanelRow, type Shape, type Spot } from '@/lib/calc/composeDraft'
import { composeLayout, effectiveSpots, sameSpot } from '@/lib/calc/composeLayout'
import { composeAssembly, rowOfKey } from '@/lib/calc/composeAssembly'
import { confirmDialog } from '@/lib/dialog'
import { getModel } from '@/lib/configurator/arrangement'
import { Partition3DView } from '@/components/configurator/Partition3DView'
import type { GlassTint } from '@/components/configurator/scene/assembly'
import { ComposeScheme } from './ComposeScheme'

// Конструктор «Из деталей» (docs/configurator/CONSTRUCTOR_ROUTE.md, К1–К3): душевая, которой нет
// среди моделей, собирается из стёкол и фурнитуры каталога АВ24 с фото. Себестоимость
// считает сервер (/api/calc/composition — тот же расчёт по составу, что для чертежа),
// цена клиенту — той же формулой, что у моделей. Корзина общая с родителем.
// Черновик живёт в localStorage до «+ В КП» или явной очистки: собранное руками не теряется.
// Схема (К3) и 3D (К4) рисуют состав и привязку деталей к кромкам; в цену они не входят.

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

const RUB = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const RUBk = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`
const numOr = (v: string) => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return isFinite(n) ? n : 0 }
const pieceList = (s: string) => s.split(/[^\d]+/).map(Number).filter(n => n > 0)
const uid = () => Math.random().toString(36).slice(2, 10)
const materialOf = (base: string) => MATERIAL[base.split(/\s+/)[1] ?? ''] ?? ''
const fld = 'w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-2 text-[14px] font-mono text-[#111110] outline-none focus:border-[#111110]'
const lbl = 'block text-[11px] font-medium text-[#6e6e73] mb-1'
// Не через fld: его w-full перебивает ширину, и поле количества растягивалось на всю строку.
const qtyFld = 'w-16 bg-white border border-[#e4e4e0] rounded-lg px-2 py-2 text-[14px] font-mono text-center text-[#111110] outline-none focus:border-[#111110]'
const chip = (on: boolean) => `px-3 py-2 rounded-lg border text-[13px] transition-colors ${on ? 'border-[#111110] bg-[#111110] text-white' : 'border-[#e4e4e0] bg-white text-[#4b4b47] hover:border-[#111110]'}`
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

export function ComposePanel({ onAdd, cartCount, onSave, saving, deliveryTaken, clientSlot }: {
  onAdd: (item: ComposeCartItem) => void
  cartCount: number
  onSave: () => void
  saving: boolean
  deliveryTaken: boolean          // доставка уже есть у изделия в корзине — второй раз не берём
  clientSlot: ReactNode           // «Кому считаем» родителя: без клиента «Сохранить» откажет
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
  const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }))
  const setPanel = (id: string, patch: Partial<PanelRow>) => setDraft(d => ({ ...d, panels: d.panels.map(p => (p.id === id ? { ...p, ...patch } : p)) }))
  const setHw = (id: string, patch: Partial<HwRow>) => setDraft(d => ({ ...d, hardware: d.hardware.map(h => (h.id === id ? { ...h, ...patch } : h)) }))

  // Схема: раскладка из того же черновика. Выбранная строка подсвечена на схеме, а касание
  // кромки ставит её деталь туда или убирает — привязка пишется в строку явно.
  const layout = useMemo(() => composeLayout(
    shape,
    panels.map(p => ({ id: p.id, label: p.label || 'Стекло', w: numOr(p.w), h: numOr(p.h), run: p.run, kind: p.kind, hinge: p.hinge })),
    hardware.map(h => ({ id: h.id, role: h.role, stockMm: h.stockMm, qty: numOr(h.qty), at: h.at, auto: h.auto })),
  ), [shape, panels, hardware])
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
  function pickRow(id: string, scroll: 'scheme' | 'row' | null) {
    setPicked(id)
    if (scroll === 'scheme') schemeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (scroll === 'row') document.getElementById(`hw-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  // 3D из той же раскладки: касание детали на сцене выбирает её строку, как на схеме.
  const [view, setView] = useState<'scheme' | '3d'>('scheme')
  const [doorOpen, setDoorOpen] = useState(true)
  const asm = useMemo(() => composeAssembly(shape, layout.elevation, hardware.map(h => ({ id: h.id, role: h.role, label: h.label, stockMm: h.stockMm })), thickness, doorOpen),
    [shape, layout, hardware, thickness, doorOpen])
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
  const byBase = useMemo(() => new Map((catalog?.models ?? []).map(m => [m.base, m])), [catalog])
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
    hardware: okHw.map(h => ({ role: h.role, label: h.label, article: h.base, ...(isLinear(h) ? { pieces_mm: piecesOf(h) } : { qty: numOr(h.qty) }) })),
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
  const res = priced?.res ?? null
  const dirty = !fresh || state === 'loading'
  const hwLineOf = (id: string) => { const i = okHw.findIndex(h => h.id === id); return i >= 0 ? fresh?.hardware.lines[i] ?? null : null }

  const glassCost = fresh?.glass.cost ?? 0
  const hwCost = fresh?.hardware.cost ?? 0
  const cost = glassCost + hwCost
  // Недописанная строка не входит в запрос, значит и в цену: пока она есть, цена занижена.
  const halfDone = okPanels.length < panels.length || okHw.length < hardware.length
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
      const m = byBase.get(h.base)
      if (!m) { missing.push(h.base); continue }
      // В каталоге позиция штучная, а в шаблоне куски — считаем кусками-штуками, а не теряем.
      const linear = m.stockMm != null
      rows.push({ id: uid(), base: m.base, role: m.role, label: m.name, stockMm: m.stockMm, qty: String(h.qty ?? h.auto?.length ?? 1), pieces: '', ...(linear && h.auto ? { auto: h.auto } : {}), at: h.at })
    }
    setDraft(d => ({ ...d, shape: a.shape, panels: a.panels, hardware: rows, kind: t.label }))
    setTplMissing(missing)
    setPicked(null)
  }

  function addModel(mdl: CatalogModel) {
    setDraft(d => {
      const have = d.hardware.find(h => h.base === mdl.base)
      if (have && mdl.stockMm == null) return { ...d, hardware: d.hardware.map(h => (h.id === have.id ? { ...h, qty: String(numOr(h.qty) + 1) } : h)) }
      if (have || d.hardware.length >= 30) return d
      return { ...d, hardware: [...d.hardware, { id: uid(), base: mdl.base, role: mdl.role, label: mdl.name, stockMm: mdl.stockMm, qty: String(DEFAULT_QTY[mdl.role] ?? 1), pieces: '' }] }
    })
  }
  const countIn = (base: string) => { const h = hardware.find(x => x.base === base); return h ? (h.stockMm == null ? numOr(h.qty) : 1) : 0 }
  // Подсказки длин — размеры стёкол: уплотнитель по высоте двери, порог по ширине.
  const dimChips = [...new Set(okPanels.flatMap(p => [numOr(p.h), numOr(p.w)]))].sort((a, b) => b - a)

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] items-start pb-44 lg:pb-0">
      <div className="space-y-4">
        <section className="bg-white border border-[#e4e4e0] rounded-2xl p-4 space-y-3">
          <div>
            <h2 className="text-[15px] font-semibold text-[#111110]">Шаблоны</h2>
            <p className="text-[11px] text-[#9a9a95] mt-0.5">Типовые душевые по 961 монтажу 2022–2026: стёкла и фурнитура одним касанием, дальше впишите размеры. Доля — среди всех установленных душевых.</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {COMPOSE_TEMPLATES.map(t => (
              <button key={t.id} onClick={() => pickTemplate(t)} disabled={!catalog}
                className={`text-left rounded-xl border px-3 py-2.5 transition-colors disabled:opacity-40 ${draft.kind === t.label ? 'border-[#111110] bg-[#f5f5f3]' : 'border-[#e4e4e0] bg-white hover:border-[#111110]'}`}>
                <span className="block text-[13px] font-semibold text-[#111110] leading-snug">{t.label}</span>
                <span className="block text-[11px] text-[#6b6b66] mt-0.5">{t.share}</span>
                <span className="block text-[10.5px] text-[#9a9a95]">{t.source}</span>
              </button>
            ))}
          </div>
          {tplMissing.length > 0 && <p className="text-[12px] text-[#c2410c]">Нет в каталоге АВ24, строка не добавлена: {tplMissing.join(', ')}.</p>}
        </section>

        <section ref={schemeRef} className="bg-white border border-[#e4e4e0] rounded-2xl p-4 space-y-3 scroll-mt-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold text-[#111110]">Вид</h2>
              <div className="flex rounded-lg border border-[#e4e4e0] p-0.5 bg-[#f5f5f3]">
                {([['scheme', 'Схема'], ['3d', '3D']] as const).map(([id, name]) => (
                  <button key={id} onClick={() => setView(id)} className={`px-3 py-1 rounded-md text-[12px] font-medium ${view === id ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66]'}`}>{name}</button>
                ))}
              </div>
              {view === '3d' && layout.elevation.panels.some(p => p.kind !== 'fixed') && (
                <button onClick={() => setDoorOpen(o => !o)} className={miniChip(false)}>{doorOpen ? 'Закрыть двери' : 'Открыть двери'}</button>
              )}
            </div>
            {layout.elevation.panels.length > 0 && !selRow && <span className="text-[11px] text-[#9a9a95] text-right">коснитесь детали — откроется её строка</span>}
          </div>
          {!layout.elevation.panels.length
            ? <p className="text-[13px] text-[#9a9a95]">Впишите размеры стёкол — здесь появится вид снаружи и план сверху.</p>
            : view === '3d'
              ? (
                <div className="space-y-1">
                  <Partition3DView model={SCENE_MODEL} dims={sceneDims} thickness={thickness} assembly={asm}
                    finishHex={finish.hex} finishId={finish.id} glassTint={GLASS.find(g => g.id === glassId)?.tint ?? GLASS[0].tint} doorOpen={doorOpen}
                    onPick={n => { const id = rowOfKey(n.key); if (id) pickRow(id, null) }} pickedPrefix={selected ? `row:${selected}:` : null} />
                  <p className="text-[11px] text-[#9a9a95]">Крутите пальцем или мышью. Уплотнители на сцене не показаны; место детали меняется на схеме.</p>
                </div>
              )
              : <ComposeScheme elevation={layout.elevation} plan={layout.plan} selected={selected} activeSpots={selSpots}
                  onSelect={id => pickRow(id, null)} onEdge={toggleSpot}
                  glassSwatch={GLASS.find(g => g.id === glassId)?.swatch ?? '#dfeaf6'} finishHex={finish.hex} />}
          {selRow && (() => {
            const num = hardware.findIndex(h => h.id === selRow.id) + 1
            const mdl = byBase.get(selRow.base)
            const lin = selRow.stockMm != null
            return (
              <div className="rounded-xl border border-[#bfd0f5] bg-[#f5f8ff] p-3 flex gap-3">
                <Thumb src={mdl?.variants[finishId]?.image ?? mdl?.image} alt={selRow.label} size="w-14 h-14" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13px] text-[#111110] leading-snug"><b>{num}.</b> {selRow.label}</div>
                      <div className="text-[11px] text-[#9a9a95] font-mono">{selRow.base}</div>
                    </div>
                    <button onClick={() => setPicked(null)} className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[12px] font-semibold shrink-0">Готово</button>
                  </div>
                  <p className="text-[12px] text-[#4b4b47]">Коснитесь кромки стекла на схеме — деталь встанет туда, ещё раз — уберётся.</p>
                  <p className="text-[12px] text-[#111110]">
                    {selSpots.length ? whereText(selRow) : 'Сейчас на схеме её нет.'}
                    {selRow.at === undefined && selSpots.length > 0 && <span className="text-[#9a9a95]"> · по умолчанию</span>}
                  </p>
                  {!lin && (
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setHw(selRow.id, { qty: String(Math.max(0, numOr(selRow.qty) - 1)) })} className="w-9 h-9 rounded-lg border border-[#e4e4e0] bg-white text-[16px]">−</button>
                      <input inputMode="numeric" className={qtyFld} value={selRow.qty} onChange={e => setHw(selRow.id, { qty: e.target.value })} />
                      <button onClick={() => setHw(selRow.id, { qty: String(numOr(selRow.qty) + 1) })} className="w-9 h-9 rounded-lg border border-[#e4e4e0] bg-white text-[16px]">+</button>
                      <span className="text-[12px] text-[#9a9a95] ml-1">шт</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                    {selRow.at !== undefined && <button onClick={() => setHw(selRow.id, { at: undefined })} className="text-[#2563eb] hover:underline">Как по умолчанию</button>}
                    <button onClick={() => pickRow(selRow.id, 'row')} className="text-[#2563eb] hover:underline">К строке ↓</button>
                  </div>
                </div>
              </div>
            )
          })()}
          {layout.elevation.unplaced.length > 0 && !selRow && (
            <p className="text-[12px] text-[#6b6b66]">
              Не на схеме:{' '}
              {layout.elevation.unplaced.map((id, i) => {
                const h = hardware.find(x => x.id === id)!
                return (
                  <span key={id}>{i > 0 && ', '}
                    <button onClick={() => pickRow(id, null)} className="text-[#2563eb] hover:underline">{hardware.indexOf(h) + 1}. {h.label}</button>
                  </span>
                )
              })}
              <span className="text-[#9a9a95]"> — выберите и коснитесь кромки.</span>
            </p>
          )}
        </section>

        <section className="bg-white border border-[#e4e4e0] rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-[#111110]">Стекло</h2>
            <button onClick={clearAll} className="text-[12px] text-[#9a9a95] hover:text-[#c2410c]">Очистить состав</button>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[12px] text-[#6e6e73] mr-1">Форма</span>
            {SHAPES.map(s => <button key={s.id} onClick={() => set({ shape: s.id })} className={chip(shape === s.id)}>{s.label}</button>)}
          </div>
          {shape === 'corner' && !panels.some(p => p.run === 'side') && (
            <p className="text-[11px] text-[#c2410c] -mt-1">Отметьте у бокового стекла «сбоку» — иначе схема покажет все стёкла в один ряд.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {GLASS.map(g => (
              <button key={g.id} onClick={() => set({ glassId: g.id })} className={`${chip(glassId === g.id)} flex items-center gap-2`}>
                <span className="w-3.5 h-3.5 rounded-full border border-black/10" style={{ background: g.swatch }} />{g.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[12px] text-[#6e6e73] mr-1">Толщина</span>
            {THICKNESSES.map(t => <button key={t} onClick={() => set({ thickness: t })} className={chip(thickness === t)}>{t} мм</button>)}
          </div>

          <div className="space-y-2 pt-1">
            {panels.map((p, i) => {
              const line = fresh?.glass.lines[okPanels.findIndex(x => x.id === p.id)]
              const half = !!(p.w || p.h) && !(numOr(p.w) >= 50 && numOr(p.h) >= 50)
              return (
                <div key={p.id} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-end">
                  <div><label className={lbl}>{i === 0 ? 'Название' : ' '}</label><input className={`${fld} font-sans`} value={p.label} onChange={e => setPanel(p.id, { label: e.target.value })} /></div>
                  <div><label className={lbl}>{i === 0 ? 'Ширина, мм' : ' '}</label><input inputMode="numeric" className={fld} value={p.w} onChange={e => setPanel(p.id, { w: e.target.value })} placeholder="900" /></div>
                  <div><label className={lbl}>{i === 0 ? 'Высота, мм' : ' '}</label><input inputMode="numeric" className={fld} value={p.h} onChange={e => setPanel(p.id, { h: e.target.value })} placeholder="2000" /></div>
                  <button onClick={() => set({ panels: panels.filter(x => x.id !== p.id) })} disabled={panels.length === 1}
                    className="h-[38px] w-[38px] rounded-lg border border-[#e4e4e0] text-[#9a9a95] hover:text-[#c2410c] disabled:opacity-30" aria-label="Убрать стекло">✕</button>
                  <div className="col-span-4 flex flex-wrap items-center gap-1.5">
                    {KINDS.map(k => <button key={k.id} onClick={() => setPanel(p.id, { kind: k.id })} className={miniChip(p.kind === k.id)}>{k.label}</button>)}
                    {p.kind === 'door' && (() => {
                      const hinge = layout.elevation.panels.find(x => x.id === p.id)?.hinge ?? p.hinge
                      return (
                        <>
                          <span className="text-[11px] text-[#9a9a95] ml-1.5">петли</span>
                          {(['left', 'right'] as const).map(sd => (
                            <button key={sd} onClick={() => setPanel(p.id, { hinge: sd })} className={miniChip(hinge === sd)}>{sd === 'left' ? 'слева' : 'справа'}</button>
                          ))}
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
                  </div>
                  {(line || half) && (
                    <p className={`col-span-4 -mt-1 text-[11px] ${half ? 'text-[#c2410c]' : 'text-[#9a9a95]'}`}>
                      {half ? 'Впишите оба размера от 50 мм' : `${line!.areaM2.toLocaleString('ru-RU')} м² × ${RUB(line!.pricePerM2)} → ${RUB(line!.total)} со скидкой M GLASS`}
                    </p>
                  )}
                </div>
              )
            })}
            <div className="flex flex-wrap gap-2">
              {([['Дверь', 'door'], ['Неподвижное', 'fixed']] as const).map(([name, kind]) => (
                <button key={kind} disabled={panels.length >= 12}
                  onClick={() => set({ panels: [...panels, { id: uid(), label: `${name} ${panels.filter(p => p.label.startsWith(name)).length + 1}`, w: '', h: '', kind }] })}
                  className="px-3 py-2 rounded-lg border border-dashed border-[#c9c9c4] text-[13px] text-[#4b4b47] hover:border-[#111110] disabled:opacity-40">
                  + {name.toLowerCase()}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white border border-[#e4e4e0] rounded-2xl p-4 space-y-3">
          <h2 className="text-[15px] font-semibold text-[#111110]">Цвет фурнитуры</h2>
          <div className="flex flex-wrap gap-2">
            {FINISHES.map(f => (
              <button key={f.id} onClick={() => set({ finishId: f.id })} className={`${chip(finishId === f.id)} flex items-center gap-2`}>
                <span className="w-3.5 h-3.5 rounded-full border border-black/10" style={{ background: f.hex }} />{f.label}
              </button>
            ))}
          </div>
        </section>

        <section className="bg-white border border-[#e4e4e0] rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-[#111110]">Фурнитура{hardware.length ? ` · ${hardware.length}` : ''}</h2>
            <button onClick={() => setPicker(true)} disabled={!catalog}
              className="px-4 py-2 rounded-lg bg-[#111110] text-white text-[13px] font-semibold hover:bg-[#2a2a28] disabled:opacity-40">
              + Добавить из каталога
            </button>
          </div>
          {catalogErr && <p className="text-[12px] text-[#c2410c]">{catalogErr}</p>}
          {!hardware.length && <p className="text-[13px] text-[#9a9a95]">Петли, коннекторы, ручки, уплотнители — из каталога АВ24 с фото. Цена берётся в выбранном цвете.</p>}
          <div className="divide-y divide-[#efefeb]">
            {hardware.map((h, idx) => {
              const mdl = byBase.get(h.base)
              const img = mdl?.variants[finishId]?.image ?? mdl?.image
              const line = hwLineOf(h.id)
              const lin = isLinear(h)
              const waiting = lin ? !piecesOf(h).length : !(numOr(h.qty) > 0)
              const where = whereText(h)
              const on = selected === h.id
              // Длины отвязываются от стёкол — место на схеме, выведенное из них, фиксируем.
              const unbind = (pieces: string) => setHw(h.id, { pieces, auto: undefined, ...(h.at === undefined ? { at: spotsOf(h) } : {}) })
              return (
                <div key={h.id} id={`hw-${h.id}`} className={`py-3 flex gap-3 scroll-mt-24 ${on ? 'bg-[#f5f8ff] -mx-2 px-2 rounded-xl' : ''}`}>
                  <div className="relative shrink-0">
                    <Thumb src={img} alt={h.label} size="w-14 h-14" />
                    <span className={`absolute -top-1.5 -left-1.5 min-w-[20px] h-5 px-1 rounded-full border text-[11px] font-semibold grid place-items-center ${on ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#111110] border-[#111110]'}`}>{idx + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[13px] text-[#111110] leading-snug">{h.label}</div>
                        <div className="text-[11px] text-[#9a9a95] font-mono">{line?.article ?? h.base}{materialOf(h.base) && <span className="font-sans"> · {materialOf(h.base)}</span>}{lin && <span className="font-sans"> · полоса {(h.stockMm! / 1000).toLocaleString('ru-RU')} м</span>}</div>
                        <button onClick={() => (on ? setPicked(null) : pickRow(h.id, 'scheme'))} className="text-left text-[11.5px] text-[#2563eb] hover:underline mt-0.5">
                          {on ? 'Выбрана на схеме — готово' : where ? `На схеме: ${where}` : 'Нет на схеме — указать'}
                        </button>
                      </div>
                      <button onClick={() => set({ hardware: hardware.filter(x => x.id !== h.id) })} className="text-[#9a9a95] hover:text-[#c2410c] px-1" aria-label="Убрать">✕</button>
                    </div>
                    {lin ? (
                      <div className="space-y-1.5">
                        <input className={fld} value={h.auto ? piecesOf(h).join(', ') : h.pieces} onChange={e => unbind(e.target.value)} placeholder="куски, мм: 2004, 2004" />
                        {h.auto && <p className="text-[11px] text-[#9a9a95]">Длины от размеров стёкол — меняются вместе с ними. Правка руками отвяжет.</p>}
                        {!!dimChips.length && (
                          <div className="flex flex-wrap gap-1.5">
                            {dimChips.map(v => (
                              <button key={v} onClick={() => unbind([...piecesOf(h), v].join(', '))}
                                className="px-2.5 py-1 rounded-md border border-[#e4e4e0] text-[12px] font-mono text-[#4b4b47] hover:border-[#111110]">+{v}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setHw(h.id, { qty: String(Math.max(0, numOr(h.qty) - 1)) })} className="w-9 h-9 rounded-lg border border-[#e4e4e0] text-[16px]">−</button>
                        <input inputMode="numeric" className={qtyFld} value={h.qty} onChange={e => setHw(h.id, { qty: e.target.value })} />
                        <button onClick={() => setHw(h.id, { qty: String(numOr(h.qty) + 1) })} className="w-9 h-9 rounded-lg border border-[#e4e4e0] text-[16px]">+</button>
                        <span className="text-[12px] text-[#9a9a95] ml-1">шт</span>
                      </div>
                    )}
                    <div className="text-[12px]">
                      {waiting ? <span className="text-[#c2410c]">{lin ? 'Впишите длины кусков или нажмите размер' : 'Укажите количество'}</span>
                        : line?.total != null ? (
                          <span className="text-[#4b4b47]">
                            {RUBk(line.unit!)} × {line.qty}{lin ? ` ${line.qty === 1 ? 'полоса' : 'полосы'}` : ' шт'} = <b className="font-mono">{RUBk(line.total)}</b>
                            {lin && line.layout && <span className="text-[#9a9a95]"> · раскрой {line.layout.map(s => s.join('+')).join(' | ')}</span>}
                          </span>
                        ) : fresh ? <span className="text-[#c2410c]">не посчитано — см. ниже</span> : <span className="text-[#9a9a95]">считаю…</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <aside className="bg-white border border-[#e4e4e0] rounded-2xl p-4 space-y-3 text-[13px] lg:sticky lg:top-4">
        <h2 className="text-[15px] font-semibold text-[#111110]">Цена</h2>
        <div className="space-y-1">
          <div className="flex justify-between"><span className="text-[#6b6b66]">Стекло{res?.glass.material ? ` · ${res.glass.material} ${thickness} мм` : ''}</span><span className="font-mono">{RUB(glassCost)}</span></div>
          <div className="flex justify-between"><span className="text-[#6b6b66]">Фурнитура АВ24 · закупка</span><span className="font-mono">{RUB(hwCost)}</span></div>
          <div className="flex justify-between font-semibold"><span>Себестоимость</span><span className="font-mono">{RUB(cost)}</span></div>
        </div>
        {fresh && fresh.stops.length > 0 && (
          <ul className="text-[12px] text-[#c2410c] space-y-0.5 list-disc pl-4">{fresh.stops.map(s => <li key={s}>{s}</li>)}</ul>
        )}
        {fresh && fresh.notes.length > 0 && (
          <ul className="text-[11px] text-[#9a9a95] space-y-0.5 list-disc pl-4">{fresh.notes.map(s => <li key={s}>{s}</li>)}</ul>
        )}
        {state === 'error' && err && <p className="text-[12px] text-[#c2410c]">Расчёт не выполнен: {err}</p>}
        {!okPanels.length && <p className="text-[12px] text-[#9a9a95]">Впишите размер хотя бы одного стекла — расчёт начнётся сам.</p>}

        <div className="grid grid-cols-3 gap-2 pt-1">
          <div><label className={lbl}>Маржа, %</label><input inputMode="decimal" className={fld} value={margin} onChange={e => { marginTouched.current = true; setMargin(e.target.value) }} /></div>
          <div><label className={lbl}>Налог, %</label><input inputMode="decimal" className={fld} value={tax} onChange={e => { taxTouched.current = true; setTax(e.target.value) }} /></div>
          <div><label className={lbl}>Монтаж/секц.</label><input inputMode="numeric" className={fld} value={perSection} onChange={e => setPerSection(e.target.value)} /></div>
          <div><label className={lbl}>Секций</label><input inputMode="numeric" className={fld} value={sectionsOver} onChange={e => setSectionsOver(e.target.value)} placeholder={String(okPanels.length || 1)} /></div>
          <div><label className={lbl}>Доставка</label><input inputMode="numeric" className={fld} value={delivery} onChange={e => setDelivery(e.target.value)} /></div>
          <div><label className={lbl}>Подъём</label><input inputMode="numeric" className={fld} value={lift} onChange={e => setLift(e.target.value)} placeholder="0" /></div>
          <div><label className={lbl}>Скидка, %</label><input inputMode="decimal" className={fld} value={discount} onChange={e => setDiscount(e.target.value)} /></div>
        </div>
        <div className="text-[11px] text-[#9a9a95]">Маржа и налог по умолчанию: {financeSource}. Секций по умолчанию — по числу стёкол.</div>

        <div className="space-y-1">
          {usable && <div className="flex justify-between"><span className="text-[#6b6b66]">Цена изделия</span><span className="font-mono font-semibold">{RUB(productPrice)}</span></div>}
          {install > 0 && <div className="flex justify-between text-[#6b6b66]"><span>Монтаж · {sections} × {RUB(numOr(perSection))}</span><span className="font-mono">{RUB(install)}</span></div>}
          {deliveryN > 0 && <div className="flex justify-between text-[#6b6b66]"><span>Доставка</span><span className="font-mono">{RUB(deliveryN)}</span></div>}
          {liftN > 0 && <div className="flex justify-between text-[#6b6b66]"><span>Подъём</span><span className="font-mono">{RUB(liftN)}</span></div>}
          {discPct > 0 && <div className="flex justify-between text-emerald-700"><span>Скидка {discPct}%</span><span className="font-mono">−{RUB(Math.round(beforeDisc * discPct / 100))}</span></div>}
        </div>

        {clientSlot}

        <div className="pt-2 border-t border-[#e4e4e0] space-y-2 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:bg-white max-lg:px-4 max-lg:pb-4 max-lg:shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-semibold text-[#111110]">К оплате{cartCount ? ` (изделие ${cartCount + 1})` : ''}</span>
            <span className="text-[22px] font-bold font-mono text-[#111110]">{usable ? RUB(grand) : '—'}</span>
          </div>
          {dirty && okPanels.length > 0 && state !== 'error' && <p className="text-[11px] text-[#9a9a95]">пересчёт цены…</p>}
          {!dirty && !usable && okPanels.length > 0 && <p className="text-[11px] text-[#c2410c]">Расчёт неполный — {halfDone ? 'не у всех строк есть размер, количество или длины' : 'причины выше'}. В КП не добавляю.</p>}
          {added && <p className="text-[11px] text-emerald-700">✓ {added}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={add} disabled={!usable || grand <= 0 || dirty}
              className="px-4 py-3 border border-[#111110] text-[#111110] text-[13px] font-semibold rounded-lg hover:bg-[#f0f0ec] disabled:opacity-40">
              + В КП
            </button>
            <button onClick={onSave} disabled={saving || cartCount === 0}
              className="px-4 py-3 bg-[#111110] text-white text-[13px] font-semibold rounded-lg hover:bg-[#2a2a28] disabled:opacity-40">
              {saving ? 'Сохраняю…' : `Сохранить${cartCount ? ` (${cartCount})` : ''} → КП`}
            </button>
          </div>
          {cartCount === 0 && <p className="text-[11px] text-[#9a9a95]">«+ В КП» кладёт изделие в корзину расчёта; «Сохранить» делает из корзины расчёт и КП.</p>}
        </div>
      </aside>

      {picker && catalog && (
        <Picker catalog={catalog} finishId={finishId} finishLabel={finish.label} countIn={countIn} onPick={addModel}
          onClose={() => setPicker(false)} full={hardware.length >= 30} />
      )}
    </div>
  )
}

function Thumb({ src, alt, size }: { src?: string | null; alt: string; size: string }) {
  const [broken, setBroken] = useState(false)
  return (
    <div className={`${size} shrink-0 rounded-lg bg-white border border-[#efefeb] overflow-hidden flex items-center justify-center`}>
      {src && !broken
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="w-full h-full object-contain" />
        : <span className="text-[10px] text-[#c9c9c4] text-center px-1">нет фото</span>}
    </div>
  )
}

function Picker({ catalog, finishId, finishLabel, countIn, onPick, onClose, full }: {
  catalog: Catalog
  finishId: FinishId
  finishLabel: string
  countIn: (base: string) => number
  onPick: (m: CatalogModel) => void
  onClose: () => void
  full: boolean
}) {
  const [group, setGroup] = useState<CatalogGroupId>('hinge')
  const [q, setQ] = useState('')
  const [onlyFinish, setOnlyFinish] = useState(true)
  const needle = q.trim().toLowerCase().replace(/x/g, 'х')
  const match = (m: CatalogModel) => !needle || `${m.name} ${m.base} ${m.category}`.toLowerCase().replace(/x/g, 'х').includes(needle)
  const avail = (m: CatalogModel) => !onlyFinish || !!m.variants[finishId]
  // Поиск идёт по всем разделам: менеджер помнит артикул, а не раздел.
  const list = catalog.models.filter(m => (needle ? true : m.group === group) && match(m) && avail(m))
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
          <div className="flex items-center gap-2">
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск: FDP-230, петля 90, коннектор стекло-стекло…"
              className="flex-1 bg-[#f5f5f3] border border-[#e4e4e0] rounded-lg px-3 py-2.5 text-[14px] outline-none focus:border-[#111110]" />
            <button onClick={onClose} className="px-4 py-2.5 rounded-lg bg-[#111110] text-white text-[13px] font-semibold">Готово</button>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5 -mx-1 px-1">
            {catalog.groups.map(g => (
              <button key={g.id} onClick={() => { setGroup(g.id); setQ('') }}
                className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-[13px] ${!needle && group === g.id ? 'bg-[#111110] text-white' : 'bg-[#f5f5f3] text-[#4b4b47]'}`}>
                {g.label} <span className="opacity-60">{counts[g.id] ?? 0}</span>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[12px] text-[#6e6e73]">
            <input type="checkbox" checked={onlyFinish} onChange={e => setOnlyFinish(e.target.checked)} />
            Только то, что есть в цвете «{finishLabel}»
          </label>
          {full && <p className="text-[12px] text-[#c2410c]">В изделии уже 30 позиций — больше расчёт не принимает.</p>}
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {!list.length && <p className="text-[13px] text-[#9a9a95] p-2">Ничего не нашлось{onlyFinish ? ` в цвете «${finishLabel}» — снимите галочку, чтобы увидеть остальные цвета` : ''}.</p>}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
            {list.map(m => {
              const v = m.variants[finishId]
              const n = countIn(m.base)
              return (
                <button key={m.base} onClick={() => v && onPick(m)} disabled={!v || (full && !n)}
                  className={`relative text-left bg-white rounded-xl border p-2 flex flex-col gap-1.5 transition-colors ${n ? 'border-[#111110]' : 'border-[#e4e4e0] hover:border-[#111110]'} disabled:opacity-50 disabled:hover:border-[#e4e4e0]`}>
                  <Thumb src={v?.image ?? m.image} alt={m.name} size="w-full aspect-square" />
                  {n > 0 && <span className="absolute top-3 right-3 bg-[#111110] text-white text-[11px] font-semibold rounded-full px-2 py-0.5">{m.stockMm == null ? `×${n}` : '✓'}</span>}
                  <span className="text-[12px] leading-snug text-[#111110] line-clamp-3">{m.name}</span>
                  <span className="text-[10.5px] text-[#9a9a95] font-mono">{m.base}{materialOf(m.base) && <span className="font-sans"> · {materialOf(m.base)}</span>}</span>
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
