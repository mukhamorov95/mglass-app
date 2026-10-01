'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  SUPER_CATS, readDraft, writeDraft, retailLine, retailQuote, describeSpec,
  type CounterSpec, type SuperCat,
} from '@/lib/partner/counter'
import { leadTimeText, isMirrorCategory } from '@/lib/partner/leadTime'

// Прилавок точки на стройрынке: покупатель называет размер — партнёр за минуту
// показывает ему цену. Крупно — цена покупателю (закупка партнёра × наценка точки).
// Закупка спрятана по умолчанию: экран часто повёрнут к покупателю.
// Цену закупки считает сервер тем же движком, что и «Новый просчёт».

type Material = { id: number; name: string; category: string; thickness: number }
type FacetOpt = { typeMm: number }
type Priced = { material: string; thickness: number; lineTotal: number }

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'

async function priceSpecs(specs: CounterSpec[]): Promise<{ items: Priced[]; total: number } | { error: string }> {
  const r = await fetch('/api/partner/quote', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: specs, save: false }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.ok) return { error: d.error || 'Цена не посчитана' }
  return { items: d.items as Priced[], total: Number(d.total) || 0 }
}

function Chip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      style={{
        padding: '10px 14px', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
        border: `1px solid ${on ? 'var(--ink)' : 'var(--border)'}`,
        background: on ? 'var(--ink)' : 'var(--surface)', color: on ? 'var(--surface)' : 'var(--ink-2)',
      }}>{on ? '✓ ' : ''}{label}</button>
  )
}

export default function PartnerCounterPage() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [facetOpts, setFacetOpts] = useState<FacetOpt[]>([])
  const [markup, setMarkup] = useState<number | null>(null)   // без наценки цену покупателю не называем
  const [loading, setLoading] = useState(true)
  const [linked, setLinked] = useState(true)

  const [superCat, setSuperCat] = useState<SuperCat>('зеркало')
  const [thickness, setThickness] = useState<number | null>(null)
  const [matId, setMatId] = useState<number | null>(null)
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [qty, setQty] = useState('1')
  const [tempering, setTempering] = useState(false)
  const [facet, setFacet] = useState(false)
  const [facetMm, setFacetMm] = useState(10)
  const [holes, setHoles] = useState(false)
  const [curved, setCurved] = useState(false)

  const [list, setList] = useState<CounterSpec[]>([])
  const [ready, setReady] = useState(false)
  const [priced, setPriced] = useState<{ items: Priced[]; total: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [live, setLive] = useState<number | null>(null)
  const [liveBusy, setLiveBusy] = useState(false)
  const [showCost, setShowCost] = useState(false)
  const reqNo = useRef(0)

  const catDef = useMemo(() => SUPER_CATS.find(s => s.value === superCat) ?? SUPER_CATS[0], [superCat])
  const catMats = useMemo(() => materials.filter(m => (catDef.cats as readonly string[]).includes(m.category)), [materials, catDef])
  const thicknesses = useMemo(() => [...new Set(catMats.map(m => m.thickness))].sort((a, b) => a - b), [catMats])
  const typesAtThickness = useMemo(() => catMats.filter(m => m.thickness === thickness), [catMats, thickness])
  const isMirror = superCat === 'зеркало'

  function pickCat(sc: SuperCat, mats: Material[]) {
    const def = SUPER_CATS.find(s => s.value === sc) ?? SUPER_CATS[0]
    const cm = mats.filter(m => (def.cats as readonly string[]).includes(m.category))
    const ths = [...new Set(cm.map(m => m.thickness))].sort((a, b) => a - b)
    // Зеркало на рынке чаще всего 4 мм, стекло под закалку — 6 мм.
    const want = sc === 'зеркало' ? 4 : 6
    const t = ths.includes(want) ? want : (ths[0] ?? null)
    // Самое ходовое на рынке — серебро и прозрачное, а не первое по алфавиту.
    const atT = cm.filter(m => m.thickness === t)
    const pref = atT.find(m => /серебро|прозрачн/i.test(m.name)) ?? atT[0]
    setSuperCat(sc); setThickness(t); setMatId(pref?.id ?? null)
    if (sc === 'зеркало') setTempering(false)
  }

  async function reprice(next: CounterSpec[]) {
    const my = ++reqNo.current
    if (next.length === 0) { setPriced(null); setErr(null); return }
    setBusy(true); setErr(null)
    try {
      const r = await priceSpecs(next)
      if (my !== reqNo.current) return
      if ('error' in r) { setErr(r.error); setPriced(null) } else setPriced(r)
    } catch { if (my === reqNo.current) setErr('Сеть недоступна — цена не обновлена') }
    finally { if (my === reqNo.current) setBusy(false) }
  }

  useEffect(() => {
    Promise.all([
      fetch('/api/partner/materials').then(r => r.json()),
      fetch('/api/partner/settings').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([m, s]) => {
      if (!m.linked) { setLinked(false); return }
      const mats = (m.materials ?? []) as Material[]
      setMaterials(mats)
      setFacetOpts((m.facetOptions ?? []) as FacetOpt[])
      if (m.facetOptions?.[0]) setFacetMm(Number(m.facetOptions[0].typeMm))
      if (s?.settings) setMarkup(Number(s.settings.markupPct))
      const hasMirror = mats.some(x => (SUPER_CATS[1].cats as readonly string[]).includes(x.category))
      pickCat(hasMirror ? 'зеркало' : 'стекло', mats)
      const draft = readDraft()
      setList(draft); setReady(true)
      if (draft.length) void reprice(draft)
    }).catch(() => setLinked(false)).finally(() => setLoading(false))
  }, [])

  useEffect(() => { if (ready) writeDraft(list) }, [list, ready])

  const current: CounterSpec | null = matId != null && Number(width) > 0 && Number(height) > 0 && Number(qty) > 0 ? {
    materialId: matId, width: Number(width), height: Number(height), quantity: Math.round(Number(qty)),
    hasTempering: !isMirror && tempering, hasFacet: facet, facetTypeMm: facet ? facetMm : null,
    hasHoles: holes, shape: curved ? 'curved' : 'rect',
    hasTriplex: false, triplexLayers: 2, triplexMat2Id: null, triplexMat3Id: null, applyMinPrice: true,
  } : null
  const currentKey = current ? JSON.stringify(current) : ''

  useEffect(() => {
    const spec = currentKey ? (JSON.parse(currentKey) as CounterSpec) : null
    const t = setTimeout(async () => {
      if (!spec) { setLive(null); return }
      setLiveBusy(true)
      try {
        const r = await priceSpecs([spec])
        setLive('error' in r ? null : (r.items[0]?.lineTotal ?? null))
      } catch { setLive(null) } finally { setLiveBusy(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [currentKey])

  function add() {
    if (!current) return
    const next = [...list, current]
    setList(next)
    setWidth(''); setHeight(''); setQty('1'); setFacet(false); setHoles(false); setCurved(false)
    setLive(null)
    void reprice(next)
  }
  function remove(i: number) {
    const next = list.filter((_, k) => k !== i)
    setList(next); void reprice(next)
  }
  function clearAll() {
    if (!window.confirm('Убрать все позиции и начать с нового покупателя?')) return
    setList([]); setShowCost(false); void reprice([])
  }

  const retail = priced && markup != null && priced.items.length === list.length
    ? retailQuote(priced.items.map(i => i.lineTotal), markup) : null
  const income = retail && priced ? retail.total - priced.total : null

  const top = (
    <div className="top">
      <div>
        <h1>Прилавок</h1>
        {!loading && linked && <div className="cap">{markup != null
          ? <>Цена покупателю с вашей наценкой {markup.toLocaleString('ru-RU')}% · <Link href="/partner/profile#counter" style={{ color: 'var(--blue)' }}>изменить</Link></>
          : <span style={{ color: '#dc2626' }}>Наценка не загрузилась — цену покупателю не показываем. Обновите страницу.</span>}</div>}
      </div>
    </div>
  )

  if (loading) return <>{top}<div className="wrap"><div className="note"><div className="s">Загрузка…</div></div></div></>
  if (!linked) return <>{top}<div className="wrap"><div className="note"><div className="t">Аккаунт не привязан</div><div className="s">Обратитесь к менеджеру M-Glass.</div></div></div></>

  const availableCats = SUPER_CATS.filter(s => materials.some(m => (s.cats as readonly string[]).includes(m.category)))
  const big = { fontSize: 30, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.1 } as const

  return (
    <>
      {top}
      <div className="wrap" style={{ maxWidth: 640 }}>
        <div className="card">
          <div className="fld" style={{ padding: 16, gap: 12 }}>
            <div className="seg" style={{ alignSelf: 'flex-start' }}>
              {availableCats.map(s => (
                <button key={s.value} className={superCat === s.value ? 'on' : ''} onClick={() => pickCat(s.value, materials)}>{s.label}</button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
              <select value={thickness ?? ''} aria-label="Толщина" onChange={e => { const t = Number(e.target.value); setThickness(t); setMatId(catMats.find(m => m.thickness === t)?.id ?? null) }}>
                {thicknesses.map(t => <option key={t} value={t}>{t} мм</option>)}
              </select>
              <select value={matId ?? ''} aria-label="Тип" onChange={e => setMatId(Number(e.target.value))}>
                {typesAtThickness.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 72px', gap: 8 }}>
              <input inputMode="numeric" type="number" min="1" value={width} onChange={e => setWidth(e.target.value)} placeholder="Ширина, мм" style={{ fontSize: 18 }} />
              <input inputMode="numeric" type="number" min="1" value={height} onChange={e => setHeight(e.target.value)} placeholder="Высота, мм" style={{ fontSize: 18 }} />
              <input inputMode="numeric" type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} aria-label="Количество" style={{ fontSize: 18 }} />
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {!isMirror && <Chip on={tempering} label="Закалка" onClick={() => setTempering(v => !v)} />}
              <Chip on={facet} label="Фацет" onClick={() => setFacet(v => !v)} />
              <Chip on={holes} label="Отверстия" onClick={() => setHoles(v => !v)} />
              <Chip on={curved} label="Фигурный рез" onClick={() => setCurved(v => !v)} />
            </div>
            {facet && facetOpts.length > 0 && (
              <select value={facetMm} onChange={e => setFacetMm(Number(e.target.value))} aria-label="Ширина фацета">
                {facetOpts.map(f => <option key={f.typeMm} value={f.typeMm}>Фацет {f.typeMm} мм</option>)}
              </select>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 4 }}>
              <div>
                <div className="cap">Эта деталь покупателю</div>
                <div className="tnum" style={{ ...big, fontSize: 26, color: live != null ? 'var(--ink)' : 'var(--muted)' }}>
                  {live != null && markup != null ? fmt(retailLine(live, markup)) : liveBusy ? 'считаю…' : '—'}
                </div>
              </div>
              <button className="primary" onClick={add} disabled={!current} style={{ padding: '14px 20px', fontSize: 15, ...(current ? {} : { opacity: 0.4, cursor: 'default' }) }}>＋ Добавить</button>
            </div>
          </div>
        </div>

        {list.length > 0 && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h"><h3>Заказ покупателя</h3><span className="mut">{list.length} поз.</span></div>
            <div>
              {list.map((s, i) => {
                const p = priced?.items[i]
                const extra = describeSpec(s)
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{s.width} × {s.height} мм{s.quantity > 1 ? ` · ${s.quantity} шт` : ''}</div>
                      <div className="cap">{p ? `${p.material} ${p.thickness} мм` : materials.find(m => m.id === s.materialId)?.name ?? '—'}{extra ? `, ${extra}` : ''}</div>
                    </div>
                    <div className="tnum" style={{ fontWeight: 700, fontSize: 16 }}>{retail ? fmt(retail.lines[i]) : busy ? '…' : ''}</div>
                    <button className="rm" onClick={() => remove(i)} title="Убрать" style={{ fontSize: 16, padding: 6 }}>✕</button>
                  </div>
                )
              })}
            </div>

            <div style={{ padding: 16 }}>
              {err && <div style={{ fontSize: 13, color: '#dc2626', marginBottom: 10 }}>{err}</div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                <span style={{ fontWeight: 600 }}>Цена покупателю</span>
                <span className="tnum" style={big}>{retail ? fmt(retail.total) : busy ? '…' : '—'}</span>
              </div>

              <div className="cap" style={{ marginTop: 4 }}>Срок изготовления — {leadTimeText(list.map(sp => ({ ...sp, isMirror: isMirrorCategory(materials.find(m => m.id === sp.materialId)?.category) })))}</div>
              <button className="rm" onClick={() => setShowCost(v => !v)} style={{ marginTop: 8, padding: 0, fontSize: 13 }}>
                {showCost ? 'Скрыть мою закупку' : 'Показать мою закупку'}
              </button>
              {showCost && priced && retail && (
                <div className="info" style={{ marginTop: 8, flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Закупка у M-Glass</span><b className="tnum">{fmt(priced.total)}</b></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Ваш доход с заказа</span><b className="tnum">{fmt(income ?? 0)}</b></div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
                <Link href="/partner/counter/kp" className="primary" style={{ textAlign: 'center', padding: '13px 10px' }}>КП покупателю</Link>
                <Link href="/partner/new?from=counter" className="ghost" style={{ textAlign: 'center', padding: '13px 10px' }}>Оформить у M-Glass</Link>
              </div>
              <div className="info">
                <span>📏</span>
                <span>Размер проверьте вместе с покупателем: деталь режется ровно по тем цифрам, что введены здесь.</span>
              </div>
              <button className="rm" onClick={clearAll} style={{ marginTop: 10, padding: 0, fontSize: 13 }}>Новый покупатель — очистить</button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
