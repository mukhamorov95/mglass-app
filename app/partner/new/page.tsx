'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { applicableSurcharges, type SurchargeRule } from '@/lib/surcharges'

// Партнёрский калькулятор (тёмная тема). Форма и НАБОР полей — как у менеджера
// (/calculator/b2b), данные из реальных справочников (/api/partner/materials).
// Цену считает СЕРВЕР (/api/partner/quote) ЕДИНЫМ движком computeQuoteItem — тот
// же, что у менеджера, с надбавками за габариты. В браузере никакой себестоимости.

type Material = { id: number; name: string; category: string; thickness: number; salePrice: number }
type FacetOpt = { typeMm: number; salePrice: number }
type PricedItem = { material: string; thickness: number; width: number; height: number; quantity: number; price: number }

type Spec = {
  materialId: number; width: number; height: number; quantity: number
  hasTempering: boolean; hasFacet: boolean; facetTypeMm: number | null; hasHoles: boolean
  shape: 'rect' | 'curved'; hasTriplex: boolean; triplexLayers: number
  triplexMat2Id: number | null; triplexMat3Id: number | null; applyMinPrice: boolean
}

const SUPER_CATS = [
  { value: 'стекло', label: 'Стекло', cats: ['стекло', 'тонированное', 'сатин', 'рифленое', 'декоративное'] },
  { value: 'зеркало', label: 'Зеркало', cats: ['зеркало'] },
] as const
type SuperCat = typeof SUPER_CATS[number]['value']

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'

function firstSel(mats: Material[], sc: SuperCat): { thickness: number | null; matId: number | null } {
  const def = SUPER_CATS.find(s => s.value === sc) ?? SUPER_CATS[0]
  const cm = mats.filter(m => (def.cats as readonly string[]).includes(m.category))
  const ths = [...new Set(cm.map(m => m.thickness))].sort((a, b) => a - b)
  const thickness = ths[0] ?? null
  const matId = cm.find(m => m.thickness === thickness)?.id ?? null
  return { thickness, matId }
}

export default function PartnerNewQuotePage() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [facetOpts, setFacetOpts] = useState<FacetOpt[]>([])
  const [surchargeRules, setSurchargeRules] = useState<SurchargeRule[]>([])
  const [discount, setDiscount] = useState(0)
  const [linked, setLinked] = useState(true)
  const [loading, setLoading] = useState(true)

  const [superCat, setSuperCat] = useState<SuperCat>('стекло')
  const [thickness, setThickness] = useState<number | null>(null)
  const [matId, setMatId] = useState<number | null>(null)
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [qty, setQty] = useState('1')
  const [tempering, setTempering] = useState(false)
  const [facet, setFacet] = useState(false)
  const [facetMm, setFacetMm] = useState<number>(10)
  const [holes, setHoles] = useState(false)
  const [curved, setCurved] = useState(false)
  const [minPrice, setMinPrice] = useState(true)
  const [triplex, setTriplex] = useState(false)
  const [triplexLayers, setTriplexLayers] = useState<2 | 3>(2)
  const [triplexMat2, setTriplexMat2] = useState<number | null>(null)
  const [triplexMat3, setTriplexMat3] = useState<number | null>(null)

  const [list, setList] = useState<Spec[]>([])
  const [comment, setComment] = useState('')
  const [preview, setPreview] = useState<{ items: PricedItem[]; total: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/partner/materials').then(r => r.json()).then(d => {
      if (!d.linked) { setLinked(false); return }
      const mats = (d.materials ?? []) as Material[]
      setMaterials(mats)
      setFacetOpts(d.facetOptions ?? [])
      setSurchargeRules((d.surcharges ?? []) as SurchargeRule[])
      setDiscount(Number(d.discountPercent) || 0)
      if (d.facetOptions?.[0]) setFacetMm(Number(d.facetOptions[0].typeMm))
      const sel = firstSel(mats, 'стекло')
      setThickness(sel.thickness); setMatId(sel.matId)
    }).catch(() => setLinked(false)).finally(() => setLoading(false))
  }, [])

  const catDef = useMemo(() => SUPER_CATS.find(s => s.value === superCat) ?? SUPER_CATS[0], [superCat])
  const catMats = useMemo(() => materials.filter(m => (catDef.cats as readonly string[]).includes(m.category)), [materials, catDef])
  const thicknesses = useMemo(() => [...new Set(catMats.map(m => m.thickness))].sort((a, b) => a - b), [catMats])
  const typesAtThickness = useMemo(() => catMats.filter(m => m.thickness === thickness), [catMats, thickness])
  const glassMats = useMemo(() => materials.filter(m => (SUPER_CATS[0].cats as readonly string[]).includes(m.category)), [materials])

  const activeSurcharges = useMemo(() => {
    const w = Number(width) || 0, h = Number(height) || 0
    if (w <= 0 || h <= 0) return []
    return applicableSurcharges({ width: w, height: h, shape: curved ? 'curved' : 'rect' }, surchargeRules)
  }, [width, height, curved, surchargeRules])

  const isMirror = superCat === 'зеркало'
  const canAdd = matId != null && Number(width) > 0 && Number(height) > 0 && Number(qty) > 0

  function changeSuperCat(sc: SuperCat) {
    setSuperCat(sc)
    const sel = firstSel(materials, sc)
    setThickness(sel.thickness); setMatId(sel.matId)
    if (sc === 'зеркало') setTempering(false)
    setPreview(null); setSavedId(null)
  }

  async function recompute(next: Spec[], save = false): Promise<number | null> {
    if (next.length === 0) { setPreview(null); return null }
    setErr(null); setBusy(true)
    try {
      const res = await fetch('/api/partner/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: next, save, comment }),
      })
      const d = await res.json()
      if (!res.ok) { setErr(d.error || 'Ошибка расчёта'); return null }
      setPreview({ items: d.items, total: d.total })
      return save ? (d.quoteId ?? null) : null
    } catch { setErr('Сеть недоступна'); return null } finally { setBusy(false) }
  }

  function addPosition() {
    if (!canAdd) return
    const spec: Spec = {
      materialId: matId!, width: Number(width), height: Number(height), quantity: Number(qty),
      hasTempering: !isMirror && tempering, hasFacet: facet, facetTypeMm: facet ? facetMm : null,
      hasHoles: holes, shape: curved ? 'curved' : 'rect',
      hasTriplex: triplex, triplexLayers, triplexMat2Id: triplexMat2, triplexMat3Id: triplexMat3,
      applyMinPrice: minPrice,
    }
    const next = [...list, spec]
    setList(next)
    setWidth(''); setHeight(''); setQty('1'); setHoles(false); setCurved(false); setFacet(false); setTriplex(false)
    setSavedId(null)
    void recompute(next, false)
  }
  function removePosition(idx: number) {
    const next = list.filter((_, i) => i !== idx)
    setList(next); setSavedId(null)
    void recompute(next, false)
  }
  async function save() {
    const id = await recompute(list, true)
    if (id) setSavedId(id)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[var(--p-muted)]">Загрузка…</div>
  if (!linked) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="bg-[var(--p-surface)] rounded-2xl border border-[var(--p-border)] p-8 text-center max-w-sm">
        <p className="text-[14px] font-medium">Аккаунт не привязан</p>
        <p className="text-[13px] text-[var(--p-muted)] mt-1">Обратитесь к менеджеру M-Glass.</p>
        <Link href="/partner" className="text-[12px] text-[#7aa5f0] mt-3 inline-block">← Мои заказы</Link>
      </div>
    </div>
  )

  const inputCls = 'w-full bg-[var(--p-surface2)] border border-[var(--p-border)] rounded-lg px-2.5 py-2 text-[13px] text-[var(--p-ink)] outline-none focus:border-[var(--p-acc)]'
  const lblCls = 'block text-[12px] font-medium text-[var(--p-muted)] mb-1'
  const optCls = (on: boolean) => `flex items-center justify-center gap-2 h-[36px] px-2 border rounded-lg cursor-pointer text-[12.5px] font-medium transition-colors ${on ? 'border-[var(--p-acc)] bg-[#2a1f1c] text-[var(--p-ink)]' : 'border-[var(--p-border)] text-[var(--p-ink2)] hover:border-[var(--p-muted)]'}`

  return (
    <div className="min-h-screen pb-24">
      <div className="sticky top-0 z-10 bg-[var(--p-surface)]/90 backdrop-blur border-b border-[var(--p-border)] px-5 pt-12 pb-3.5 lg:pt-5 flex items-center justify-between">
        <h1 className="text-[21px] font-bold tracking-tight">Новый просчёт</h1>
        <Link href="/partner" className="text-[12px] text-[var(--p-muted)] hover:text-[var(--p-ink)]">← Мои заказы</Link>
      </div>

      <div className="px-5 pt-4 space-y-3 max-w-[760px] mx-auto">
        <div className="bg-[var(--p-surface)] rounded-2xl border border-[var(--p-border)] p-4 space-y-3">
          {/* Стекло / Зеркало */}
          <div className="flex bg-[var(--p-surface2)] border border-[var(--p-border)] rounded-[10px] p-[3px] gap-[2px]">
            {SUPER_CATS.filter(s => materials.some(m => (s.cats as readonly string[]).includes(m.category))).map(s => (
              <button key={s.value} onClick={() => changeSuperCat(s.value)}
                className={`flex-1 py-1.5 rounded-[8px] text-[13px] font-medium transition-all ${superCat === s.value ? 'bg-[#3a3a35] text-[var(--p-ink)]' : 'text-[var(--p-muted)] hover:text-[var(--p-ink)]'}`}>
                {s.label}
              </button>
            ))}
          </div>

          {/* Толщина + Тип */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={lblCls}>Толщина</label>
              <select value={thickness ?? ''} onChange={e => { const t = Number(e.target.value); setThickness(t); setMatId(catMats.find(m => m.thickness === t)?.id ?? null); setPreview(null) }} className={inputCls}>
                {thicknesses.map(t => <option key={t} value={t}>{t} мм</option>)}
              </select>
            </div>
            <div>
              <label className={lblCls}>Тип</label>
              <select value={matId ?? ''} onChange={e => { setMatId(Number(e.target.value)); setPreview(null) }} className={inputCls}>
                {typesAtThickness.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>

          {/* Размеры */}
          <div>
            <label className={lblCls}>Размеры и количество</label>
            <div className="grid grid-cols-3 gap-2">
              <input type="number" min="1" value={width} onChange={e => setWidth(e.target.value)} placeholder="Ширина, мм" className={`${inputCls} font-mono`} />
              <input type="number" min="1" value={height} onChange={e => setHeight(e.target.value)} placeholder="Высота, мм" className={`${inputCls} font-mono`} />
              <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} placeholder="Кол-во" className={`${inputCls} font-mono`} />
            </div>
          </div>

          {/* Обработка */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {!isMirror && (
              <label className={optCls(tempering)}><input type="checkbox" className="hidden" checked={tempering} onChange={e => setTempering(e.target.checked)} />{tempering ? 'Закалённое' : 'Без закалки'}</label>
            )}
            <label className={optCls(facet)}><input type="checkbox" className="hidden" checked={facet} onChange={e => setFacet(e.target.checked)} />{facet ? 'Фацет' : 'Без фацета'}</label>
            <label className={optCls(holes)}><input type="checkbox" className="hidden" checked={holes} onChange={e => setHoles(e.target.checked)} />{holes ? 'Есть отверстия' : 'Без отверстий'}</label>
            <label className={optCls(curved)}><input type="checkbox" className="hidden" checked={curved} onChange={e => setCurved(e.target.checked)} />{curved ? 'Криволинейный' : 'Прямой рез'}</label>
            <label className={optCls(minPrice)}><input type="checkbox" className="hidden" checked={minPrice} onChange={e => setMinPrice(e.target.checked)} />{minPrice ? 'Учитывать мин.' : 'Чистый расчёт'}</label>
            <label className={optCls(triplex)}><input type="checkbox" className="hidden" checked={triplex} onChange={e => setTriplex(e.target.checked)} />{triplex ? 'Триплекс' : 'Без триплекса'}</label>
          </div>

          {/* Фацет: выбор мм */}
          {facet && facetOpts.length > 0 && (
            <select value={facetMm} onChange={e => setFacetMm(Number(e.target.value))} className={inputCls}>
              {facetOpts.map(f => <option key={f.typeMm} value={f.typeMm}>Фацет {f.typeMm} мм — {fmt(f.salePrice)}/м.п.</option>)}
            </select>
          )}

          {/* Триплекс: слои + доп. стёкла */}
          {triplex && (
            <div className="space-y-2 border border-[#2a3757] bg-[#1a2133]/40 rounded-lg p-2">
              <select value={triplexLayers} onChange={e => setTriplexLayers(Number(e.target.value) === 3 ? 3 : 2)} className={inputCls}>
                <option value={2}>2 стекла</option>
                <option value={3}>3 стекла</option>
              </select>
              <select value={triplexMat2 ?? ''} onChange={e => setTriplexMat2(e.target.value ? Number(e.target.value) : null)} className={inputCls}>
                <option value="">Стекло 2: как основное</option>
                {glassMats.map(m => <option key={m.id} value={m.id}>Стекло 2: {m.name} {m.thickness} мм</option>)}
              </select>
              {triplexLayers === 3 && (
                <select value={triplexMat3 ?? ''} onChange={e => setTriplexMat3(e.target.value ? Number(e.target.value) : null)} className={inputCls}>
                  <option value="">Стекло 3: как основное</option>
                  {glassMats.map(m => <option key={m.id} value={m.id}>Стекло 3: {m.name} {m.thickness} мм</option>)}
                </select>
              )}
            </div>
          )}

          {/* Надбавки за габариты */}
          {activeSurcharges.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {activeSurcharges.map(r => (
                <span key={r.id} className="text-[11px] bg-[#2c2519] border border-[#413621] text-[#e0a45c] rounded-full px-2 py-0.5">
                  {r.label} · +{r.surcharge_percent}%
                </span>
              ))}
            </div>
          )}

          <button onClick={addPosition} disabled={!canAdd}
            className="w-full bg-[var(--p-acc)] text-[var(--p-acc-ink)] text-[13px] font-semibold py-2.5 rounded-lg hover:opacity-90 disabled:opacity-40 transition-opacity">
            ＋ Добавить позицию
          </button>
        </div>

        {/* Список позиций */}
        {list.length > 0 && (
          <div className="bg-[var(--p-surface)] rounded-2xl border border-[var(--p-border)] p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)] mb-2">Позиции · {list.length}</div>
            {list.map((s, i) => {
              const p = preview?.items[i]
              return (
                <div key={i} className="flex items-center justify-between text-[12.5px] py-1.5 border-b border-[var(--p-border)] last:border-0">
                  <span className="text-[var(--p-ink2)] truncate pr-2">
                    {p?.material ?? materials.find(m => m.id === s.materialId)?.name} · {s.width}×{s.height} · {s.quantity} шт
                    {s.hasTempering ? ' · закалка' : ''}{s.hasFacet ? ' · фацет' : ''}{s.hasTriplex ? ' · триплекс' : ''}
                  </span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <span className="font-mono font-medium text-[var(--p-ink)]">{p ? fmt(p.price) : (busy ? '…' : '')}</span>
                    <button onClick={() => removePosition(i)} className="text-[11px] text-red-400 hover:text-red-300">✕</button>
                  </span>
                </div>
              )
            })}
            {preview && (
              <div className="flex items-center justify-between pt-2 mt-1">
                <span className="text-[12px] text-[var(--p-muted)]">{discount > 0 ? `Ваша скидка ${discount}% учтена` : 'Ваша цена'}</span>
                <span className="text-[18px] font-bold font-mono text-[var(--p-ink)]">{fmt(preview.total)}</span>
              </div>
            )}
          </div>
        )}

        <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={500} rows={2}
          placeholder="Комментарий к просчёту (необязательно)"
          className="w-full bg-[var(--p-surface)] border border-[var(--p-border)] rounded-lg px-3 py-2 text-[13px] text-[var(--p-ink)] outline-none focus:border-[var(--p-acc)]" />

        {err && <div className="text-[12px] text-red-400">{err}</div>}

        {savedId ? (
          <div className="bg-[#152a22] border border-[#234034] rounded-2xl p-4 text-center">
            <p className="text-[14px] font-semibold text-[#5fc79a]">Просчёт сохранён ✓</p>
            <p className="text-[12px] text-[#5fc79a]/80 mt-0.5">Он появился в разделе «Мои просчёты». Отправьте его в работу, когда будете готовы.</p>
            <Link href="/partner/quotes" className="text-[12px] text-[#7aa5f0] mt-2 inline-block">→ К моим просчётам</Link>
          </div>
        ) : (
          <div className="flex gap-2 pt-1">
            <button onClick={() => save()} disabled={busy || list.length === 0}
              className="flex-1 py-2.5 rounded-lg bg-[var(--p-acc)] text-[var(--p-acc-ink)] text-[13px] font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity">
              {busy ? '…' : 'Сохранить просчёт'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
