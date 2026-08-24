'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { applicableSurcharges, type SurchargeRule } from '@/lib/surcharges'

// Партнёрский калькулятор (дизайн 1-в-1 из прототипа, .pcab). Форма и НАБОР полей —
// как у менеджера (/calculator/b2b), данные из реальных справочников
// (/api/partner/materials). Цену считает СЕРВЕР (/api/partner/quote) ЕДИНЫМ движком
// computeQuoteItem — тот же, что у менеджера, с надбавками за габариты. В браузере
// никакой себестоимости/маржи: партнёр видит только свою цену.

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

function OptBox({ color, title, on, onLabel, offLabel, onToggle }: {
  color: string; title: string; on: boolean; onLabel: string; offLabel: string; onToggle: () => void
}) {
  return (
    <div className={`opt c-${color}`}>
      <span className="t">{title}</span>
      <div className={`box${on ? ' on' : ''}`} onClick={onToggle} role="checkbox" aria-checked={on}>
        <span className="ck">{on ? '✓' : ''}</span>
        <span className="v">{on ? onLabel : offLabel}</span>
      </div>
    </div>
  )
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
  const [submitted, setSubmitted] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)   // редактируем существующий просчёт
  const [livePrice, setLivePrice] = useState<number | null>(null)   // живая цена текущей позиции
  const [liveBusy, setLiveBusy] = useState(false)

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
      // Режим редактирования: /partner/new?edit=<id> — грузим позиции просчёта.
      // Повтор заказа: /partner/new?reorder=<id> — грузим те же позиции, но как
      // НОВЫЙ просчёт (editingId не ставим → сохранение создаёт новый, а не правит).
      const params = new URLSearchParams(window.location.search)
      const editParam = params.get('edit')
      const reorderParam = params.get('reorder')
      if (editParam) {
        fetch(`/api/partner/quote/${editParam}`).then(r => r.ok ? r.json() : Promise.reject())
          .then((q: { id: number; comment: string; specs: Spec[] }) => {
            setEditingId(q.id); setComment(q.comment || ''); setList(q.specs)
            void recompute(q.specs, false)
          }).catch(() => {})
      } else if (reorderParam) {
        fetch(`/api/partner/quote/${reorderParam}?reorder=1`).then(r => r.ok ? r.json() : Promise.reject())
          .then((q: { specs: Spec[] }) => {
            setList(q.specs)
            void recompute(q.specs, false)
          }).catch(() => {})
      }
    }).catch(() => setLinked(false)).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Живая цена текущей позиции (дебаунс). Всё setState — внутри async-колбэка
  // (не в теле эффекта), чтобы не нарушать react-hooks/set-state-in-effect.
  useEffect(() => {
    const valid = matId != null && Number(width) > 0 && Number(height) > 0 && Number(qty) > 0
    const spec = valid ? {
      materialId: matId!, width: Number(width), height: Number(height), quantity: Number(qty),
      hasTempering: superCat !== 'зеркало' && tempering, hasFacet: facet, facetTypeMm: facet ? facetMm : null,
      hasHoles: holes, shape: (curved ? 'curved' : 'rect') as 'rect' | 'curved',
      hasTriplex: triplex, triplexLayers, triplexMat2Id: triplexMat2, triplexMat3Id: triplexMat3,
      applyMinPrice: minPrice,
    } : null
    const t = setTimeout(async () => {
      if (!spec) { setLivePrice(null); return }
      setLiveBusy(true)
      try {
        const r = await fetch('/api/partner/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [spec], save: false }) })
        const d = await r.json()
        if (d.ok) setLivePrice(d.total)
      } catch { /* сеть — просто не показываем цену */ } finally { setLiveBusy(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [matId, width, height, qty, tempering, facet, facetMm, holes, curved, minPrice, triplex, triplexLayers, triplexMat2, triplexMat3, superCat])

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
    setPreview(null); setSavedId(null); setSubmitted(false)
  }

  async function recompute(next: Spec[], save = false): Promise<number | null> {
    if (next.length === 0) { setPreview(null); return null }
    setErr(null); setBusy(true)
    try {
      const res = await fetch('/api/partner/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: next, save, comment, editId: save ? editingId : undefined }),
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
    setSavedId(null); setSubmitted(false)
    void recompute(next, false)
  }
  function removePosition(idx: number) {
    const next = list.filter((_, i) => i !== idx)
    setList(next); setSavedId(null); setSubmitted(false)
    void recompute(next, false)
  }
  // Изменить позицию: подставляем её параметры в форму и убираем из списка
  // (клиент правит и снова «Добавить»).
  function editRow(i: number) {
    const s = list[i]
    const mat = materials.find(m => m.id === s.materialId)
    const sc: SuperCat = mat && (SUPER_CATS[1].cats as readonly string[]).includes(mat.category) ? 'зеркало' : 'стекло'
    setSuperCat(sc)
    setThickness(mat?.thickness ?? null)
    setMatId(s.materialId)
    setWidth(String(s.width)); setHeight(String(s.height)); setQty(String(s.quantity))
    setTempering(s.hasTempering); setFacet(s.hasFacet); if (s.facetTypeMm) setFacetMm(s.facetTypeMm)
    setHoles(s.hasHoles); setCurved(s.shape === 'curved'); setMinPrice(s.applyMinPrice)
    setTriplex(s.hasTriplex); setTriplexLayers(s.triplexLayers === 3 ? 3 : 2)
    setTriplexMat2(s.triplexMat2Id); setTriplexMat3(s.triplexMat3Id)
    const next = list.filter((_, idx) => idx !== i)
    setList(next); setSavedId(null); setSubmitted(false)
    void recompute(next, false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  async function save() {
    const id = await recompute(list, true)
    if (id) { setSavedId(id); setSubmitted(false) }
  }
  async function saveAndSubmit() {
    const id = await recompute(list, true)
    if (!id) return
    setSavedId(id)
    try {
      const r = await fetch('/api/partner/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quoteId: id }) })
      if (r.ok) setSubmitted(true)
    } catch { /* просчёт сохранён — отправить можно позже из «Мои просчёты» */ }
  }

  const top = (
    <div className="top">
      <div>
        <h1>{editingId ? `Просчёт #${editingId}` : 'Новый просчёт'}</h1>
        <div className="cap">{editingId ? 'Измените позиции и сохраните' : 'Посчитайте по своим ценам и сохраните'}</div>
      </div>
      <Link className="ghost" href="/partner/quotes">Мои просчёты</Link>
    </div>
  )

  if (loading) return <>{top}<div className="wrap"><div className="note"><div className="s">Загрузка…</div></div></div></>
  if (!linked) return (
    <>{top}<div className="wrap"><div className="note">
      <div className="t">Аккаунт не привязан</div>
      <div className="s">Обратитесь к менеджеру M-Glass.</div>
      <Link href="/partner" className="s" style={{ display: 'inline-block', marginTop: 10, color: 'var(--blue)' }}>← Табло</Link>
    </div></div></>
  )

  const availableCats = SUPER_CATS.filter(s => materials.some(m => (s.cats as readonly string[]).includes(m.category)))

  return (
    <>
      {top}
      <div className="wrap" style={{ maxWidth: 820 }}>
        {/* Новая позиция */}
        <div className="card">
          <div className="card-h"><h3>Новая позиция</h3><span className="mut">детали стекла и зеркала</span></div>
          <div style={{ padding: 18 }}>
            <div className="frm">
              <div className="fld full">
                <span className="lab">Материал</span>
                <div className="seg">
                  {availableCats.map(s => (
                    <button key={s.value} className={superCat === s.value ? 'on' : ''} onClick={() => changeSuperCat(s.value)}>{s.label}</button>
                  ))}
                </div>
              </div>

              <div className="fld">
                <span className="lab">Толщина</span>
                <select value={thickness ?? ''} onChange={e => { const t = Number(e.target.value); setThickness(t); setMatId(catMats.find(m => m.thickness === t)?.id ?? null); setPreview(null) }}>
                  {thicknesses.map(t => <option key={t} value={t}>{t} мм</option>)}
                </select>
              </div>
              <div className="fld">
                <span className="lab">Тип</span>
                <select value={matId ?? ''} onChange={e => { setMatId(Number(e.target.value)); setPreview(null) }}>
                  {typesAtThickness.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>

              <div className="fld full">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 }}>
                  <span className="lab" style={{ marginBottom: 0 }}>Размеры и количество</span>
                  {livePrice != null ? (
                    <span style={{ textAlign: 'right', lineHeight: 1.05 }}>
                      <span style={{ display: 'block', fontSize: 10, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>за позицию</span>
                      <span className="tnum" style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>{fmt(livePrice)}</span>
                    </span>
                  ) : liveBusy ? <span className="mut" style={{ fontSize: 12, color: 'var(--muted)' }}>считаю…</span> : null}
                </div>
                <div className="grid3" style={{ marginTop: 6 }}>
                  <input type="number" min="1" value={width} onChange={e => setWidth(e.target.value)} placeholder="Ширина, мм" />
                  <input type="number" min="1" value={height} onChange={e => setHeight(e.target.value)} placeholder="Высота, мм" />
                  <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} placeholder="Кол-во" />
                </div>
              </div>

              <div className="fld full">
                <span className="lab">Отход <span style={{ color: 'var(--green)', fontWeight: 400, textTransform: 'none' }}>по раскрою</span></span>
                <div className="ro">авто по раскрою — считается по раскрою деталей заказа</div>
              </div>

              <div className="fld full">
                <span className="lab">Обработка</span>
                <div className="optgrid">
                  {!isMirror && <OptBox color="orange" title="Закалка" on={tempering} onLabel="Закалённое" offLabel="Без закалки" onToggle={() => setTempering(v => !v)} />}
                  <OptBox color="purple" title="Фацет" on={facet} onLabel="Фацет" offLabel="Без фацета" onToggle={() => setFacet(v => !v)} />
                  <OptBox color="blue" title="Сверловка" on={holes} onLabel="Есть отверстия" offLabel="Без отверстий" onToggle={() => setHoles(v => !v)} />
                  <OptBox color="teal" title="Криволинейка" on={curved} onLabel="Криволинейный рез" offLabel="Прямой рез" onToggle={() => setCurved(v => !v)} />
                  <OptBox color="emerald" title="Мин. цена" on={minPrice} onLabel="Учитывать мин." offLabel="Чистый расчёт" onToggle={() => setMinPrice(v => !v)} />
                  <OptBox color="indigo" title="Триплекс" on={triplex} onLabel="Триплекс" offLabel="Без триплекса" onToggle={() => setTriplex(v => !v)} />
                </div>
              </div>

              {facet && facetOpts.length > 0 && (
                <div className="fld full">
                  <select value={facetMm} onChange={e => setFacetMm(Number(e.target.value))}>
                    {facetOpts.map(f => <option key={f.typeMm} value={f.typeMm}>Фацет {f.typeMm} мм — {fmt(f.salePrice)}/м.п.</option>)}
                  </select>
                </div>
              )}

              {triplex && (
                <div className="fld full" style={{ gap: 8 }}>
                  <select value={triplexLayers} onChange={e => setTriplexLayers(Number(e.target.value) === 3 ? 3 : 2)}>
                    <option value={2}>2 стекла</option>
                    <option value={3}>3 стекла</option>
                  </select>
                  <select value={triplexMat2 ?? ''} onChange={e => setTriplexMat2(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Стекло 2: как основное</option>
                    {glassMats.map(m => <option key={m.id} value={m.id}>Стекло 2: {m.name} {m.thickness} мм</option>)}
                  </select>
                  {triplexLayers === 3 && (
                    <select value={triplexMat3 ?? ''} onChange={e => setTriplexMat3(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">Стекло 3: как основное</option>
                      {glassMats.map(m => <option key={m.id} value={m.id}>Стекло 3: {m.name} {m.thickness} мм</option>)}
                    </select>
                  )}
                </div>
              )}

              {activeSurcharges.length > 0 && (
                <div className="fld full" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {activeSurcharges.map(r => <span key={r.id} className="schip">{r.label} · +{r.surcharge_percent}%</span>)}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="primary" onClick={addPosition} disabled={!canAdd} style={!canAdd ? { opacity: 0.4, cursor: 'default' } : undefined}>＋ Добавить в просчёт</button>
              <span className="info" style={{ marginTop: 0, alignItems: 'center' }}>Цену считает наш серверный движок — та же, что у менеджера.</span>
            </div>
          </div>
        </div>

        {/* Просчёт */}
        {list.length > 0 && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-h"><h3>Просчёт</h3><span className="mut">{list.length} поз.</span></div>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Деталь</th><th>Размер</th><th className="r">Кол-во</th><th className="r">Цена</th><th></th></tr></thead>
              <tbody>
                {list.map((s, i) => {
                  const p = preview?.items[i]
                  const name = p?.material ?? materials.find(m => m.id === s.materialId)?.name ?? '—'
                  return (
                    <tr key={i}>
                      <td>{name}{s.hasTempering ? ', закалка' : ''}{s.hasFacet ? ', фацет' : ''}{s.hasTriplex ? ', триплекс' : ''}</td>
                      <td className="tnum">{s.width} × {s.height}</td>
                      <td className="r tnum">{s.quantity}</td>
                      <td className="r tnum">{p ? fmt(p.price) : (busy ? '…' : '')}</td>
                      <td className="r" style={{ whiteSpace: 'nowrap' }}>
                        <button className="rm" onClick={() => editRow(i)} title="Изменить">✎</button>
                        <button className="rm" onClick={() => removePosition(i)} title="Убрать">✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table></div>

            <div style={{ padding: '16px 18px', borderTop: '1px solid var(--border)' }}>
              <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={500} rows={2} placeholder="Комментарий к просчёту (необязательно)" style={{ marginBottom: 12 }} />
              {err && <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 10 }}>{err}</div>}

              {savedId ? (
                <div className="note" style={{ padding: 18, background: 'var(--green-bg)', borderColor: 'var(--green-bd)' }}>
                  <div className="t" style={{ color: 'var(--green)' }}>{submitted ? 'Отправлено в работу ✓' : editingId ? 'Просчёт обновлён ✓' : 'Просчёт сохранён ✓'}</div>
                  <div className="s">{submitted ? 'Менеджер подтвердит и запустит производство. Счёт-спецификацию для оплаты пришлёт ваш менеджер M-Glass.' : editingId ? 'Изменения сохранены в вашем просчёте.' : 'Он появился в разделе «Мои просчёты».'}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <Link href={`/partner/order/${savedId}/kp`} className="ghost">↓ Скачать КП</Link>
                    <Link href="/partner/quotes" className="primary">Мои просчёты</Link>
                  </div>
                </div>
              ) : (
                <div className="sum">
                  <div className="row">
                    <span className="mut" style={{ color: 'var(--muted)' }}>{discount > 0 ? `Ваша скидка ${discount}% учтена` : 'Ваша цена'}</span>
                    <span className="big tnum">{preview ? fmt(preview.total) : (busy ? '…' : '—')}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="ghost" style={{ flex: 1 }} onClick={save} disabled={busy || list.length === 0}>Сохранить просчёт</button>
                    <button className="primary" style={{ flex: 1 }} onClick={saveAndSubmit} disabled={busy || list.length === 0}>Отправить в работу</button>
                  </div>
                  <div className="info">📎 Сохранённый просчёт появится в «Мои просчёты» — оттуда его можно отправить в работу.</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
