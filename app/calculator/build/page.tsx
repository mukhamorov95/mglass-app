'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { M_MODELS, getModel } from '@/lib/configurator/arrangement'
import { FINISHES, type FinishId } from '@/lib/configurator/catalog'
import { Partition3DView } from '@/components/configurator/Partition3DView'
import type { MDims, GlassTint, HardwareChoice, MVariant } from '@/components/configurator/scene/assembly'
import type { KitChoices } from '@/lib/configurator/kit'
import { calcFinancialModel } from '@/lib/pricing/financialModel'

// Вкладка «Расчёт» — два экрана. Экран 1: только выбор модели. Экран 2: слева крупный
// настоящий 3D-визуализатор, справа параметры (габариты → стекло/цвет фурнитуры →
// варианты фурнитуры ЭТОЙ модели из kit.slots) и цена, всё пересчитывается сразу.
// Сцена перестраивается на изменение пропсов; цена считается отдельно (debounce), чтобы
// тяжёлый 3D не дёргался на каждый символ. Фурнитура — реальный BOM, стекло — B2B (роут
// /api/calc/build). Внизу «Добавить ещё изделие» и «Сохранить» → КП.

const THICKNESS = 8
const BUDGET_FINISHES = new Set(['chrome', 'black', 'white'])
const finishOptions = FINISHES.filter(f => BUDGET_FINISHES.has(f.id))

type GlassType = { id: string; label: string; b2b: string; swatch: string; tint: GlassTint }
const GLASS_TYPES: GlassType[] = [
  { id: 'clear',    label: 'Прозрачное',  b2b: 'Прозрачное М1',            swatch: '#cfe3d3', tint: { color: '#ffffff', attenuation: '#b8d8c4', distance: 3.5 } },
  { id: 'crystal',  label: 'Осветлённое', b2b: 'Осветлённое CrystalVision', swatch: '#dfeaf6', tint: { color: '#ffffff', attenuation: '#cfe4f2', distance: 6.0 } },
  // Бронза и графит — одна позиция справочника «Тонированное (бронза/графит)»:
  // цвет на цену не влияет, толщина влияет. Различается только вид в 3D.
  { id: 'bronze',   label: 'Бронза',      b2b: 'Тонированное (бронза/графит)', swatch: '#b0895c', tint: { color: '#d6bd97', attenuation: '#7a5836', distance: 1.2 } },
  { id: 'graphite', label: 'Графит',      b2b: 'Тонированное (бронза/графит)', swatch: '#7f858b', tint: { color: '#b9bec4', attenuation: '#4f555d', distance: 1.1 } },
  // Матовые (кислотное травление). Неосветлённое ходит в справочнике как
  // «Сатинированное бесцветное» — то же матовое по прозрачному М1, имя не по бренду AGC.
  { id: 'matte',    label: 'Матовое',     b2b: 'Сатинированное бесцветное', swatch: '#dfe2dd', tint: { color: '#f2f5f1', attenuation: '#d8e0d8', distance: 2.2, roughness: 0.55 } },
  { id: 'matte-crystal', label: 'Матовое осветл.', b2b: 'CrystalVision Matelux', swatch: '#e6ecef', tint: { color: '#f6f9fa', attenuation: '#e2ecf2', distance: 3.2, roughness: 0.55 } },
]

// Фото модели из 3D-визуализатора (public/models/<латиница>.jpg). Нет файла (М11) — схема.
const PHOTO = new Set(['М1', 'М2', 'М4', 'М7', 'М8', 'М9', 'М10', 'М11', 'М12'])
const photoSlug = (code: string) => code.replace('М', 'M').toLowerCase()

const RUB = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const numOr = (v: string) => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return isFinite(n) ? n : 0 }
const midV = ([a, b]: [number, number]) => Math.round((a + b) / 200) * 100

type KitLine = { role: string; label: string; qty: number; unit: string; unitPrice: number; total: number; plan?: { len: number; pieces: number[] }[] }
type GlassLine = { label: string; w: number; h: number; areaM2: number; pricePerM2: number; listTotal: number; total: number; minPriceApplied: boolean }
type Price = {
  glassCost: number; hardwareCost: number; sections: number; lines: KitLine[]
  glassLines?: GlassLine[]; glassSource?: string | null; glassThickness?: number; glassDiscountPct?: number
  missing: { label: string; reason: string }[]; complete: boolean
}
type CartItem = { title: string; cost: number; productPrice: number; install: number; delivery: number; lift: number; total: number }

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

  const [price, setPrice] = useState<Price | null>(null)
  const [specGlass, setSpecGlass] = useState(false)
  const [specHw, setSpecHw] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  // Ключ параметров, под которые посчитана текущая цена. Пока не совпадает с текущими
  // параметрами — цена «не догнала», кнопки сохранения блокируем (иначе запишется новый
  // размер со старой ценой). Считаем от glass.b2b (а не glassId) — цена зависит от него.
  const [pricedKey, setPricedKey] = useState('')

  // Правая панель — числа владельца. Сброс к умолчаниям на новом изделии.
  const [margin, setMargin] = useState('40')
  const [tax, setTax] = useState('12')
  const [perSection, setPerSection] = useState('6500')
  const [delivery, setDelivery] = useState('5000')
  const [lift, setLift] = useState('')
  const [discount, setDiscount] = useState('0')

  const [cart, setCart] = useState<CartItem[]>([])
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [objectAddress, setObjectAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const lastSavedSigRef = useRef('')

  const model = getModel(code)
  const isCorner = model.constraints.needsWidth2
  const isWalkin = model.shape === 'walkin'   // М1: вводится размер панели, не проёма
  const finish = FINISHES.find(f => f.id === finishId) ?? FINISHES[0]
  const glass = GLASS_TYPES.find(g => g.id === glassId) ?? GLASS_TYPES[0]
  // glassSpan: 'panel' — в просчёте вводят размер САМОЙ панели. На сайте у walk-in
  // вводят проём и стекло закрывает его часть; менеджер заказывает стекло, не проём.
  const mVariant = useMemo<MVariant>(() => (code === 'М1' ? { mount: 'perp90', profileFrame: 'partial', glassSpan: 'panel' } : {}), [code])
  const paramsKey = useMemo(() => JSON.stringify({ code, dims, finishId, g: glass.b2b, choice, qtyChoice, mVariant }), [code, dims, finishId, glass.b2b, choice, qtyChoice, mVariant])
  const priceDirty = pricedKey !== paramsKey   // цена ещё не догнала параметры

  function pickModel(c: string) {
    setCode(c); setDims(defaultsFor(c)); setChoice({}); setQtyChoice({}); setKitChoices(null); setPrice(null)
    setMargin('40'); setTax('12'); setPerSection('6500'); setDelivery('5000'); setLift(''); setDiscount('0')
    setScreen('detail')
  }
  const setD = <K extends keyof MDims>(k: K, v: MDims[K]) => setDims(d => ({ ...d, [k]: v }))

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
      if (p.finishId) setFinishId(p.finishId as FinishId)
      if (p.glassId) setGlassId(String(p.glassId))
      if (p.choice && typeof p.choice === 'object') setChoice(p.choice as Record<string, string>)
      if (p.qtyChoice && typeof p.qtyChoice === 'object') setQtyChoice(p.qtyChoice as Record<string, number>)
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
        body: JSON.stringify({ model: code, thickness: THICKNESS, finishId, glassType: glass.b2b, dims, choice, qtyChoice, variant: mVariant }),
      }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((res: { full?: boolean; price?: Price }) => {
          // Только последний запрос доживает (остальные оборваны abort), значит key актуален.
          if (res.full && res.price) { setPrice(res.price); setPricedKey(key); setState('idle') }
          else { setPrice(null); setState('error') }
        }).catch((e: unknown) => { if ((e as Error)?.name !== 'AbortError') { setPrice(null); setState('error') } })
    }, 400)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [screen, code, dims, finishId, glass.b2b, choice, qtyChoice, mVariant, paramsKey])

  const glassCost = price?.glassCost ?? 0
  const hwCost = price?.hardwareCost ?? 0
  const usable = !!price && price.complete
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

  const title = () => `${model.code} ${model.name} · ${isCorner ? `${numOr(String(dims.width))}×${numOr(String(dims.width2 ?? 0))}×${numOr(String(dims.height))}` : `${numOr(String(dims.width))}×${numOr(String(dims.height))}`} мм`
  const currentItem = (): CartItem => ({ title: title(), cost, productPrice: Math.round(productPrice), install, delivery: deliveryN, lift: liftN, total: grand })

  function addMore() {
    if (usable && grand > 0) setCart(c => [...c, currentItem()])
    setScreen('models')
  }

  async function save() {
    const list = [...cart]
    if (usable && grand > 0) list.push(currentItem())
    if (!list.length) { setSaveMsg('Нечего сохранять'); setTimeout(() => setSaveMsg(null), 2500); return }
    const snapshot = { code, dims, finishId, glassId, choice, qtyChoice, margin, tax, perSection, delivery, lift, discount, cart: list, clientName, clientPhone, objectAddress }
    const total = list.reduce((s, i) => s + i.total, 0)
    const sig = JSON.stringify(snapshot) + '|' + total
    if (sig === lastSavedSigRef.current) { setSaveMsg('Уже сохранено ✓'); setTimeout(() => setSaveMsg(null), 2500); return }
    setSaving(true); setSaveMsg(null)
    try {
      const { saveCalculation } = await import('@/lib/saveCalculation')
      const res = await saveCalculation({
        product_type: 'build',
        input_data: snapshot,
        cost_breakdown: { glassCost, hwCost, directCost: cost, productPrice, installTotal: install, delivery: deliveryN, lift: liftN, sections },
        financial_breakdown: { marginPct: m, taxPct: tx, discountPct: discPct, total },
        base_price: total, discount: 0, partner_percent: 0, final_price: total, margin: m,
        profit: Math.max(0, Math.round(total - cost)),
        client_text: [title(), objectAddress && `Адрес: ${objectAddress}`].filter(Boolean).join(' · '),
        client_name: clientName.trim() || undefined,
        client_phone: clientPhone.trim() || undefined,
      })
      const ok = !!(res && 'id' in res && res.id)
      if (!ok) { setSaveMsg(res && 'error' in res ? res.error! : 'Не удалось сохранить'); return }
      lastSavedSigRef.current = sig
      const newId = (res as { id: number }).id
      if (clientPhone.trim() || objectAddress.trim()) {
        try { await fetch('/api/deals/ensure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ calc_id: newId, client_name: clientName.trim(), phone: clientPhone.trim(), address: objectAddress.trim() }) }) } catch { /* ignore */ }
      }
      // КП из этого расчёта: позиции корзины → префилл /kp.
      const items = list.map(i => ({ name: i.title, qty: 1, price: i.productPrice + i.install + i.delivery + i.lift, sum: i.total }))
      const content = { title: (clientName || 'Коммерческое предложение').toUpperCase(), items, subtotal: total, total, client_name: clientName, client_phone: clientPhone, client_address: objectAddress }
      try { sessionStorage.setItem('mglass_kp_prefill', JSON.stringify(content)) } catch { /* ignore */ }
      router.push('/kp')
    } finally { setSaving(false); setTimeout(() => setSaveMsg(null), 4000) }
  }

  // ── Экран 1: только выбор модели ─────────────────────────────────────────────
  if (screen === 'models') {
    return (
      <div className="min-h-screen bg-[#f5f5f3] p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-5 flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-[18px] font-semibold text-[#111110]">Расчёт{cart.length ? ` · в корзине ${cart.length}` : ''}</h1>
              <p className="text-[12px] text-[#9a9a95] mt-0.5">Выберите модель душевой перегородки.</p>
            </div>
            {cart.length > 0 && (
              <button onClick={save} disabled={saving}
                className="text-[13px] font-semibold px-4 py-2 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40">
                {saving ? 'Сохраняю…' : `Сохранить (${cart.length}) → КП`}
              </button>
            )}
          </div>
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
        </div>
      </div>
    )
  }

  // ── Экран 2: 3D + параметры + цена ───────────────────────────────────────────
  const c = model.constraints
  return (
    <div className="min-h-screen bg-[#f5f5f3] p-4">
      <div className="max-w-[1400px] mx-auto">
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

            {/* Детали цены — прокручиваются; итог и кнопки закреплены ниже. */}
            <div className="bg-white border border-[#e4e4e0] rounded-2xl p-4 space-y-1.5 text-[12px]">
              <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1">Себестоимость и цена</p>
              {/* Спецификация: менеджер должен видеть, из чего сложилась цифра,
                  а не верить итогу. Свёрнута, чтобы не мешать частому сценарию. */}
              <SpecRow label="Себест. стекло" sum={glassCost} open={specGlass} onToggle={() => setSpecGlass(v => !v)} count={price?.glassLines?.length ?? 0}>
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
                  <div key={i} className="flex justify-between gap-2 py-0.5">
                    <span className="text-[#6b6b66] min-w-0">
                      {l.label} · {l.qty} {l.unit} × {RUB(l.unitPrice)}
                      {/* Хлыст режется — показываем куски, иначе непонятно, за что целая палка. */}
                      {l.plan?.length ? <span className="text-[#9a9a95]"> · рез {l.plan.flatMap(p => p.pieces).map(Math.round).join(', ')} мм</span> : null}
                    </span>
                    <span className="font-mono whitespace-nowrap">{RUB(l.total)}</span>
                  </div>
                ))}
              </SpecRow>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div><label className={lbl}>Маржа, %</label><input type="number" className={fld} value={margin} onChange={e => setMargin(e.target.value)} /></div>
                <div><label className={lbl}>Налог, %</label><input type="number" className={fld} value={tax} onChange={e => setTax(e.target.value)} /></div>
              </div>
              {denom > 0 && <div className="flex justify-between"><span className="text-[#6b6b66]">Цена изделия</span><span className="font-mono font-semibold">{RUB(productPrice)}</span></div>}
              <div className="grid grid-cols-2 gap-2">
                <div><label className={lbl}>Монтаж/секц</label><input type="number" className={fld} value={perSection} onChange={e => setPerSection(e.target.value)} /></div>
                <div><label className={lbl}>Секций</label><input type="number" className={fld} value={sections} readOnly /></div>
                <div><label className={lbl}>Доставка</label><input type="number" className={fld} value={delivery} onChange={e => setDelivery(e.target.value)} /></div>
                <div><label className={lbl}>Подъём</label><input type="number" className={fld} value={lift} onChange={e => setLift(e.target.value)} placeholder="0" /></div>
                <div><label className={lbl}>Скидка, %</label><input type="number" className={fld} value={discount} onChange={e => setDiscount(e.target.value)} placeholder="0" /></div>
              </div>
              {install > 0 && <div className="flex justify-between text-[#6b6b66]"><span>Монтаж ({sections}×{RUB(numOr(perSection))})</span><span className="font-mono">{RUB(install)}</span></div>}
              {deliveryN > 0 && <div className="flex justify-between text-[#6b6b66]"><span>Доставка</span><span className="font-mono">{RUB(deliveryN)}</span></div>}
              {liftN > 0 && <div className="flex justify-between text-[#6b6b66]"><span>Подъём</span><span className="font-mono">{RUB(liftN)}</span></div>}
              {discPct > 0 && <div className="flex justify-between text-emerald-700"><span>Скидка {discPct}%</span><span className="font-mono">−{RUB(Math.round(beforeDisc * discPct / 100))}</span></div>}
            </div>

            {/* Клиент (опц.) */}
            <div className="bg-white border border-[#e4e4e0] rounded-2xl p-4 grid grid-cols-1 gap-2">
              <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Клиент (необязательно)" className={`${fld} font-sans`} />
              <div className="grid grid-cols-2 gap-2">
                <input value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="Телефон" inputMode="tel" className={`${fld} font-sans`} />
                <input value={objectAddress} onChange={e => setObjectAddress(e.target.value)} placeholder="Адрес объекта" className={`${fld} font-sans`} />
              </div>
            </div>
          </div>

          {/* Закреплённый низ — итог и кнопки всегда видны (самое частое действие). */}
          <div className="shrink-0 mt-2 pt-3 border-t border-[#e4e4e0] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-semibold text-[#111110]">К оплате{cart.length ? ` (изделие ${cart.length + 1})` : ''}</span>
              <span className="text-[22px] font-bold font-mono text-[#111110]">{RUB(grand)}</span>
            </div>
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
              <button onClick={save} disabled={saving || priceDirty || state === 'loading' || (!usable && cart.length === 0)}
                className="px-4 py-2.5 bg-[#111110] text-white text-[13px] font-semibold rounded-lg hover:bg-[#2a2a28] disabled:opacity-40">
                {saving ? 'Сохраняю…' : 'Сохранить → КП'}
              </button>
            </div>
            {saveMsg && <p className={`text-center text-[13px] font-semibold rounded-lg px-3 py-1.5 ${saveMsg.includes('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{saveMsg}</p>}
            {cart.length > 0 && <p className="text-[11px] text-[#9a9a95] text-center">В корзине {cart.length}. «Сохранить» соберёт КП из всех.</p>}
          </div>
          </div>
        </div>
      </div>
    </div>
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
