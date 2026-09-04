'use client'

import { useEffect, useMemo, useState } from 'react'
import { calcFinancialModel } from '@/lib/pricing/financialModel'

// Экран расчёта зеркала (маршрут З6). Отдельный компонент, а не ветка внутри
// экрана душевых: у продуктов разные параметры, и мешать их в одном файле —
// верный способ сломать душевые правкой зеркал. Корзина общая с родителем —
// в одно КП собираются и душевая, и зеркало (З8).

export type MirrorModel = {
  code: string; name: string; descr: string | null; shape: string
  has_lighting: boolean; frame_kind: string | null; image_url: string | null
}
export type MirrorMaterial = { name: string; mms: number[] }
export type MirrorCartItem = {
  title: string; cost: number; productPrice: number; install: number
  delivery: number; lift: number; total: number
}

type Line = { role: string; label: string; qty: number; unit: string; unitPrice: number; total: number; note?: string }
type Quote = {
  areaM2: number; perimeterM: number; lightingM: number
  lines: Line[]; hardwareCost: number; glassCost: number; directCost: number
  missing: { role: string; label: string; reason: string }[]
  complete: boolean; mirrorSource: string | null; quantity: number
}

const RUB = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const numOr = (v: string) => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return isFinite(n) ? n : 0 }
const fld = 'w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110]'
const lbl = 'block text-[11px] font-medium text-[#6e6e73] mb-1'

const FRAMES = [
  { id: 'none',   label: 'Без рамки' },
  { id: 'vetro',  label: 'Профиль Ветро' },
  { id: 'metal',  label: 'Металлическая' },
  { id: 'ushape', label: 'П-профиль (6 мм)' },
] as const
type FrameKind = typeof FRAMES[number]['id']

export function MirrorPanel({ model, materials, onBack, onAdd, cartCount, onSave, saving }: {
  model: MirrorModel
  materials: MirrorMaterial[]
  onBack: () => void
  onAdd: (item: MirrorCartItem) => void
  cartCount: number
  onSave: () => void
  saving: boolean
}) {
  const [width, setWidth] = useState('800')
  const [height, setHeight] = useState('600')
  const [qty, setQty] = useState('1')
  const [materialName, setMaterialName] = useState(materials.find(m => m.name === 'Серебро')?.name ?? materials[0]?.name ?? '')
  const mms = useMemo(() => materials.find(m => m.name === materialName)?.mms ?? [4], [materials, materialName])
  const [pickedMm, setPickedMm] = useState<number>(4)
  // Толщина выводится, а не хранится: у другого типа зеркала своего набора толщин
  // может не быть, и хранимое значение осталось бы невозможным.
  const thickness = mms.includes(pickedMm) ? pickedMm : (mms[0] ?? 4)
  const setThickness = setPickedMm
  const [sides, setSides] = useState({ top: true, bottom: false, left: false, right: false })
  const [voltage, setVoltage] = useState<12 | 24>(24)
  const [control, setControl] = useState<'none' | 'button' | 'sensor'>('none')
  const [frame, setFrame] = useState<FrameKind>('none')

  const [margin, setMargin] = useState('40')
  const [tax, setTax] = useState('12')
  const [install, setInstall] = useState('0')
  const [delivery, setDelivery] = useState('5000')
  const [lift, setLift] = useState('')
  const [discount, setDiscount] = useState('0')

  const [quote, setQuote] = useState<Quote | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [spec, setSpec] = useState(false)

  const params = useMemo(() => ({
    width: numOr(width), height: numOr(height), quantity: numOr(qty) || 1,
    shape: model.shape, thickness, materialName,
    lighting: model.has_lighting, sides, voltage, control, frame,
  }), [width, height, qty, model.shape, model.has_lighting, thickness, materialName, sides, voltage, control, frame])

  const paramsKey = JSON.stringify(params)
  const [pricedKey, setPricedKey] = useState('')
  const dirty = pricedKey !== paramsKey

  useEffect(() => {
    const key = paramsKey
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      if (params.width <= 0 || params.height <= 0) { setQuote(null); setState('idle'); return }
      setState('loading')
      fetch('/api/calc/mirror', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal, body: JSON.stringify(params),
      }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((res: { full?: boolean; price?: Quote }) => {
          if (res.full && res.price) { setQuote(res.price); setPricedKey(key); setState('idle') }
          else { setQuote(null); setState('error') }
        })
        .catch((e: unknown) => { if ((e as Error)?.name !== 'AbortError') { setQuote(null); setState('error') } })
    }, 400)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [params, paramsKey])

  const cost = quote?.directCost ?? 0
  const m = numOr(margin), tx = numOr(tax)
  const fin = calcFinancialModel({ directCost: cost, marginPercent: m, taxPercent: tx })
  const productPrice = fin ? fin.basePrice : 0
  const installN = numOr(install), deliveryN = numOr(delivery), liftN = numOr(lift)
  const discPct = Math.min(100, Math.max(0, numOr(discount)))
  const usable = !!quote && quote.complete
  const beforeDisc = (usable ? productPrice : 0) + installN + deliveryN + liftN
  const grand = Math.round(beforeDisc * (1 - discPct / 100))

  const title = () =>
    `${model.name} · ${materialName} ${thickness} мм · ${numOr(width)}×${numOr(height)} мм${numOr(qty) > 1 ? ` ×${numOr(qty)}` : ''}`

  const add = () => {
    if (!usable || grand <= 0) return
    onAdd({ title: title(), cost, productPrice: Math.round(productPrice), install: installN, delivery: deliveryN, lift: liftN, total: grand })
    onBack()
  }

  const sideBtn = (k: keyof typeof sides, label: string) => (
    <button key={k} onClick={() => setSides(s => ({ ...s, [k]: !s[k] }))}
      className={`text-[12px] px-2 py-1.5 rounded-lg border-2 transition-colors ${sides[k] ? 'border-[#111110] text-[#111110] font-semibold' : 'border-[#e4e4e0] text-[#6b6b66] hover:border-[#c4c4be]'}`}>
      {label}
    </button>
  )

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4 items-start">
      {/* Слева — схема зеркала: видно пропорции и с какой стороны свет. */}
      <div className="bg-white border border-[#e4e4e0] rounded-2xl p-4">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={onBack} className="text-[13px] text-[#6b6b66] hover:text-[#111110]">← Модели</button>
          <h2 className="text-[15px] font-semibold text-[#111110]">{model.code} · {model.name}</h2>
        </div>
        <MirrorScheme w={numOr(width)} h={numOr(height)} shape={model.shape} lit={model.has_lighting} sides={sides} frame={frame} />
        {quote && (
          <p className="text-[11.5px] text-[#9a9a95] mt-3">
            {quote.areaM2.toFixed(2)} м² · периметр {quote.perimeterM.toFixed(2)} м
            {model.has_lighting ? ` · подсветка ${quote.lightingM.toFixed(2)} м` : ''}
          </p>
        )}
      </div>

      {/* Справа — параметры и цена. */}
      <div className="space-y-3">
        <div className="bg-white border border-[#e4e4e0] rounded-2xl p-4">
          <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-2">Размер зеркала, мм</p>
          <div className="grid grid-cols-3 gap-2">
            <div><label className={lbl}>Ширина</label><input type="number" className={fld} value={width} onChange={e => setWidth(e.target.value)} /></div>
            <div><label className={lbl}>Высота</label><input type="number" className={fld} value={height} onChange={e => setHeight(e.target.value)} /></div>
            <div><label className={lbl}>Кол-во</label><input type="number" className={fld} value={qty} onChange={e => setQty(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div><label className={lbl}>Зеркало</label>
              <select className={`${fld} font-sans`} value={materialName} onChange={e => setMaterialName(e.target.value)}>
                {materials.map(mt => <option key={mt.name} value={mt.name}>{mt.name}</option>)}
              </select>
            </div>
            <div><label className={lbl}>Толщина</label>
              <select className={`${fld} font-sans`} value={thickness} onChange={e => setThickness(Number(e.target.value))}>
                {mms.map(mm => <option key={mm} value={mm}>{mm} мм</option>)}
              </select>
            </div>
          </div>
        </div>

        {model.has_lighting && (
          <div className="bg-white border border-[#e4e4e0] rounded-2xl p-4">
            <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-2">Подсветка</p>
            <label className={lbl}>Стороны</label>
            <div className="grid grid-cols-4 gap-1.5">
              {sideBtn('top', 'Верх')}{sideBtn('bottom', 'Низ')}{sideBtn('left', 'Лево')}{sideBtn('right', 'Право')}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div><label className={lbl}>Напряжение</label>
                <select className={`${fld} font-sans`} value={voltage} onChange={e => setVoltage(Number(e.target.value) === 24 ? 24 : 12)}>
                  <option value={12}>12 В</option><option value={24}>24 В</option>
                </select>
              </div>
              <div><label className={lbl}>Управление</label>
                <select className={`${fld} font-sans`} value={control} onChange={e => setControl(e.target.value as 'none' | 'button' | 'sensor')}>
                  <option value="none">Без выключателя</option><option value="button">Кнопка</option><option value="sensor">Сенсор</option>
                </select>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white border border-[#e4e4e0] rounded-2xl p-4">
          <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-2">Рамка</p>
          <div className="grid grid-cols-2 gap-1.5">
            {FRAMES.map(f => (
              <button key={f.id} onClick={() => setFrame(f.id)}
                className={`text-[12px] px-2 py-1.5 rounded-lg border-2 transition-colors ${frame === f.id ? 'border-[#111110] text-[#111110] font-semibold' : 'border-[#e4e4e0] text-[#6b6b66] hover:border-[#c4c4be]'}`}>
                {f.label}
              </button>
            ))}
          </div>
          {/* Конструктив, а не пожелание: П-профиль от душевых садится только на 6 мм. */}
          {frame === 'ushape' && thickness !== 6 && (
            <p className="text-[11px] text-[#c2410c] mt-1.5">П-профиль садится только на зеркало 6 мм — выберите 6 мм или другую рамку.</p>
          )}
        </div>

        <div className="bg-white border border-[#e4e4e0] rounded-2xl p-4 space-y-2 text-[12px]">
          <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest">Себестоимость и цена</p>
          <div className="flex justify-between"><span className="text-[#6b6b66]">Зеркало{quote?.mirrorSource ? ` · ${quote.mirrorSource}` : ''}</span><span className="font-mono">{RUB(quote?.glassCost ?? 0)}</span></div>
          <div>
            <button type="button" onClick={() => setSpec(v => !v)} disabled={!quote?.lines.length}
              className="w-full flex justify-between items-baseline gap-2 text-left disabled:cursor-default">
              <span className="text-[#6b6b66] flex items-center gap-1">
                Подсветка и рамка
                {!!quote?.lines.length && <span className="text-[10px] text-[#9a9a95]">{spec ? '▾' : '▸'} {quote.lines.length} поз.</span>}
              </span>
              <span className="font-mono">{RUB(quote?.hardwareCost ?? 0)}</span>
            </button>
            {spec && !!quote?.lines.length && (
              <div className="mt-1 mb-1 pl-2 border-l-2 border-[#e4e4e0] text-[11.5px]">
                {quote.lines.map((l, i) => (
                  <div key={i} className="flex justify-between gap-2 py-0.5">
                    <span className="text-[#6b6b66] min-w-0">
                      {l.label} · {l.qty} {l.unit} × {RUB(l.unitPrice)}
                      {l.note && <span className="text-[#9a9a95]"> · {l.note}</span>}
                    </span>
                    <span className="font-mono whitespace-nowrap">{RUB(l.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1">
            <div><label className={lbl}>Маржа, %</label><input type="number" className={fld} value={margin} onChange={e => setMargin(e.target.value)} /></div>
            <div><label className={lbl}>Налог, %</label><input type="number" className={fld} value={tax} onChange={e => setTax(e.target.value)} /></div>
            <div><label className={lbl}>Монтаж</label><input type="number" className={fld} value={install} onChange={e => setInstall(e.target.value)} /></div>
            <div><label className={lbl}>Доставка</label><input type="number" className={fld} value={delivery} onChange={e => setDelivery(e.target.value)} /></div>
            <div><label className={lbl}>Подъём</label><input type="number" className={fld} value={lift} onChange={e => setLift(e.target.value)} placeholder="0" /></div>
            <div><label className={lbl}>Скидка, %</label><input type="number" className={fld} value={discount} onChange={e => setDiscount(e.target.value)} /></div>
          </div>

          {usable && <div className="flex justify-between"><span className="text-[#6b6b66]">Цена изделия</span><span className="font-mono font-semibold">{RUB(productPrice)}</span></div>}
          {installN > 0 && <div className="flex justify-between text-[#6b6b66]"><span>Монтаж</span><span className="font-mono">{RUB(installN)}</span></div>}
          {deliveryN > 0 && <div className="flex justify-between text-[#6b6b66]"><span>Доставка</span><span className="font-mono">{RUB(deliveryN)}</span></div>}
          {liftN > 0 && <div className="flex justify-between text-[#6b6b66]"><span>Подъём</span><span className="font-mono">{RUB(liftN)}</span></div>}
          {discPct > 0 && <div className="flex justify-between text-emerald-700"><span>Скидка {discPct}%</span><span className="font-mono">−{RUB(Math.round(beforeDisc * discPct / 100))}</span></div>}
        </div>

        <div className="pt-1 border-t border-[#e4e4e0] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-semibold text-[#111110]">К оплате{cartCount ? ` (изделие ${cartCount + 1})` : ''}</span>
            <span className="text-[22px] font-bold font-mono text-[#111110]">{RUB(grand)}</span>
          </div>
          {(dirty || state === 'loading') && <p className="text-[11px] text-[#9a9a95]">пересчёт цены…</p>}
          {/* Пробел в справочнике не прячем: цена без позиции — это занижение. */}
          {!dirty && state !== 'loading' && quote && !quote.complete && (
            <p className="text-[11px] text-[#c2410c]">Не заведено: {quote.missing.map(x => x.label).join(', ')}.</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={add} disabled={!usable || grand <= 0 || dirty || state === 'loading'}
              className="px-4 py-2.5 border border-[#111110] text-[#111110] text-[13px] font-semibold rounded-lg hover:bg-[#f0f0ec] disabled:opacity-40">
              + В КП
            </button>
            <button onClick={onSave} disabled={saving || (cartCount === 0 && !usable)}
              className="px-4 py-2.5 bg-[#111110] text-white text-[13px] font-semibold rounded-lg hover:bg-[#2a2a28] disabled:opacity-40">
              {saving ? 'Сохраняю…' : 'Сохранить → КП'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Схема зеркала в реальных пропорциях: свет рисуется по выбранным сторонам,
// рамка — контуром. Пока это плоский вид; 3D — отдельный шаг маршрута (З9).
function MirrorScheme({ w, h, shape, lit, sides, frame }: {
  w: number; h: number; shape: string; lit: boolean
  sides: { top: boolean; bottom: boolean; left: boolean; right: boolean }; frame: string
}) {
  const W = Math.max(1, w), H = Math.max(1, h)
  const box = 320
  const k = box / Math.max(W, H)
  const pw = Math.max(24, W * k), ph = Math.max(24, H * k)
  const round = shape === 'circle' || shape === 'oval'
  const glow = '#ffd977'
  const x = (box - pw) / 2, y = (box - ph) / 2
  return (
    <div className="bg-[#f5f5f3] rounded-xl p-4 flex items-center justify-center">
      <svg viewBox={`0 0 ${box} ${box}`} className="w-full max-w-[420px] aspect-square">
        {lit && (round
          ? <ellipse cx={box / 2} cy={box / 2} rx={pw / 2 + 6} ry={ph / 2 + 6} fill="none" stroke={glow} strokeWidth="10" opacity="0.8" />
          : <>
              {sides.top    && <line x1={x} y1={y - 5} x2={x + pw} y2={y - 5} stroke={glow} strokeWidth="9" opacity="0.85" />}
              {sides.bottom && <line x1={x} y1={y + ph + 5} x2={x + pw} y2={y + ph + 5} stroke={glow} strokeWidth="9" opacity="0.85" />}
              {sides.left   && <line x1={x - 5} y1={y} x2={x - 5} y2={y + ph} stroke={glow} strokeWidth="9" opacity="0.85" />}
              {sides.right  && <line x1={x + pw + 5} y1={y} x2={x + pw + 5} y2={y + ph} stroke={glow} strokeWidth="9" opacity="0.85" />}
            </>)}
        {round
          ? <ellipse cx={box / 2} cy={box / 2} rx={pw / 2} ry={ph / 2} fill="#dfe7ea" stroke={frame === 'none' ? '#b9c6cc' : '#6b6b66'} strokeWidth={frame === 'none' ? 1.5 : 5} />
          : <rect x={x} y={y} width={pw} height={ph} fill="#dfe7ea" stroke={frame === 'none' ? '#b9c6cc' : '#6b6b66'} strokeWidth={frame === 'none' ? 1.5 : 5} />}
        <path d={`M ${x + pw * 0.15} ${y + ph * 0.85} L ${x + pw * 0.85} ${y + ph * 0.2}`} stroke="#ffffff" strokeWidth="5" opacity="0.65" />
        <text x={box / 2} y={box - 4} textAnchor="middle" className="fill-[#9a9a95]" style={{ fontSize: 11 }}>{Math.round(W)} × {Math.round(H)} мм</text>
      </svg>
    </div>
  )
}
