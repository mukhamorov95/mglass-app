'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DEFAULT_CUTOUT, DEFAULT_HOLE, HOLE_LAYOUTS, SHAPES, allIssues, buildFromSpec, geometryToQuoteFacts, glassRules, toDxf,
  type CutoutGroup, type HoleGroup, type PartGeometry, type PartSpec,
} from '@/lib/glasmen'
import { toast } from '@/lib/toast'
import type { DemoMaterial, QuoteBody } from './api'
import { MODEL_IDS, QUANTITIES, canTemper, isMirror, num, rub, VAT_LABEL } from './api'
import {
  DXF_STORE_LIMIT, QTY_MAX, STORE_KEY, parseOnce, priceGate, readSnapshot, storable, stripOverride, unitsPendingFor,
  type Overrides, type Snapshot, type Source,
} from './quoterState'
import { KIND_TITLE, categoryTitle, materialsFor, pickMaterial, pickThickness, thicknessesFor, type Kind } from './groupMaterials'
import { useMaterials } from './useMaterials'
import { useQuote } from './useQuote'
import DxfInput from './DxfInput'
import UnitsDialog, { UNIT_SHORT } from './UnitsDialog'
import PartPreview from './PartPreview'
import IssuesList from './IssuesList'
import PricePanel, { Warnings } from './PricePanel'
import MiniCart, { type CartItem } from './MiniCart'
import NumField from './NumField'
import { LoadError } from './States'

function downloadText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/dxf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').replace(/×/g, 'x') || 'detal'

const chip = (on: boolean) =>
  `rounded-lg border px-3 py-2 text-left text-[13px] ${on ? 'border-[#111110] bg-[#111110] text-white' : 'border-[#e4e4e0] bg-white text-[#33332f] hover:border-[#9a9a95]'}`

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#e4e4e0] bg-white p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#111110] text-[12px] font-semibold text-white">{n}</span>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {hint && <span className="text-[12px] text-[#9a9a95]">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[12px] text-[#55554f]">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

const QTY_CHIPS = [1, 5, 10, 25, 50]

const newItemId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export default function Quoter({ initialSource }: { initialSource: Source | null }) {
  const [init] = useState(() => {
    let stored: string | null = null
    try { stored = localStorage.getItem(STORE_KEY) } catch { /* хранилище недоступно — черновик пуст */ }
    return readSnapshot(initialSource, stored)
  })
  const [s, setS] = useState<Snapshot>(init.snap)
  const [droppedDxf, setDroppedDxf] = useState<string | null>(init.droppedDxf)
  const set = (patch: Partial<Snapshot>) => setS(prev => ({ ...prev, ...patch }))
  const setSpec = (patch: Partial<PartSpec>) => setS(prev => ({ ...prev, spec: { ...prev.spec, ...patch } }))
  const [unitsOpen, setUnitsOpen] = useState(false)
  const [sel, setSel] = useState<{ issues: string; idx: number } | null>(null)
  const mats = useMaterials()

  useEffect(() => {
    const keepDxf = !!s.dxf && s.dxf.text.length <= DXF_STORE_LIMIT && storable(parseOnce(s.dxf.text, s.dxf.name, null))
    const toStore = s.dxf && !keepDxf ? { ...s, dxf: null } : s
    try { localStorage.setItem(STORE_KEY, JSON.stringify(toStore)) } catch { /* хранилище недоступно или полно — работаем без сохранения */ }
  }, [s])

  // ---------- шаги 1–3: вид → толщина → материал ----------
  const list = useMemo(() => mats.data?.materials ?? [], [mats.data])
  const thicknesses = thicknessesFor(list, s.kind)
  const thickness = pickThickness(list, s.kind, s.thickness)
  const saved = list.find(m => m.id === s.materialId) ?? null
  const material: DemoMaterial | null = saved && !isMirror(saved) === (s.kind === 'glass') && saved.thickness === thickness
    ? saved
    : pickMaterial(list, s.kind, thickness, saved?.name ?? null)
  const groups = materialsFor(list, s.kind, thickness)
  const materialGone = mats.done && s.materialId !== null && !saved && !!material

  const chooseKind = (kind: Kind) => {
    const t = pickThickness(list, kind, thickness)
    set({ kind, thickness: t, materialId: pickMaterial(list, kind, t, material?.name ?? null)?.id ?? null })
  }
  const chooseThickness = (t: number) => set({ thickness: t, materialId: pickMaterial(list, s.kind, t, material?.name ?? null)?.id ?? null })

  const facetTypes = mats.data?.facetTypesMm ?? []
  const facetMm = facetTypes.includes(s.facetMm) ? s.facetMm : facetTypes[0] ?? null
  const hasFacet = s.hasFacet && facetMm !== null
  const mirror = isMirror(material)
  const temperable = canTemper(material)
  const tempered = s.temperWanted && temperable

  // ---------- шаги 4, 6, 7: деталь ----------
  const dxfAuto = useMemo(() => (s.dxf ? parseOnce(s.dxf.text, s.dxf.name, null) : null), [s.dxf])
  const dxfParsed = useMemo(() => (s.dxf && s.dxf.units ? parseOnce(s.dxf.text, s.dxf.name, s.dxf.units) : dxfAuto), [s.dxf, dxfAuto])
  const formGeom = useMemo(() => buildFromSpec(s.spec), [s.spec])
  const geom: PartGeometry | null = s.source === 'dxf' ? dxfParsed?.geom ?? null : formGeom

  const issues = geom ? allIssues(geom, glassRules(material?.thickness ?? 4, tempered, { category: mirror ? 'mirror' : 'glass' })) : []
  // Выделение замечания живёт, пока список замечаний тот же по содержанию.
  const issuesKey = issues.map(i => `${i.code}@${i.at ? `${Math.round(i.at.x)},${Math.round(i.at.y)}` : ''}`).join('|')
  const selected = sel && sel.issues === issuesKey ? sel.idx : null
  const hardCount = issues.filter(i => i.level === 'hard').length

  // ---------- цена ----------
  const qty = Math.min(QTY_MAX, Math.max(1, Math.round(s.qty)))
  const facts = geom && geom.width > 0 && geom.height > 0 ? geometryToQuoteFacts(geom) : null
  const { blocked, hardNote, addReason } = priceGate({
    matsDone: mats.done, hasMaterial: !!material, source: s.source, hasDxf: !!s.dxf, hasFacts: !!facts,
    unitsPending: s.source === 'dxf' && unitsPendingFor(s.dxf, dxfAuto?.geom), hardCount,
  })
  const cleanOverrides = Object.fromEntries(
    Object.entries(s.overrides).map(([k, v]) => [k, stripOverride(v)]).filter(([, v]) => v && Object.keys(v).length),
  ) as Overrides
  const body: QuoteBody | null = blocked || !material || !facts ? null : {
    materialId: material.id,
    width: facts.width, height: facts.height, shape: facts.shape,
    holes: facts.holes, cutouts: facts.cutouts,
    hasTempering: tempered, hasFacet,
    ...(hasFacet ? { facetTypeMm: facetMm! } : {}),
    quantities: [...new Set([...QUANTITIES, qty])].sort((a, b) => a - b),
    discountPct: s.discount,
    models: MODEL_IDS,
    ...(Object.keys(cleanOverrides).length ? { params: cleanOverrides } : {}),
    asWholeOrder: s.wholeOrder,
  }
  const q = useQuote(body)

  const addToCart = () => {
    if (!geom || !facts || !material || addReason) return
    const item: CartItem = {
      id: newItemId(),
      name: geom.name,
      materialId: material.id,
      materialLabel: `${material.name}, ${num(material.thickness)} мм`,
      width: facts.width, height: facts.height, shape: facts.shape,
      holes: facts.holes, cutouts: facts.cutouts,
      hasTempering: tempered, hasFacet,
      ...(hasFacet ? { facetTypeMm: facetMm! } : {}),
      qty,
    }
    set({ items: [...s.items, item] })
    toast.success('Добавлено в расчёт', { detail: `${geom.name}, ${qty} шт. — в блоке «Расчёт» ниже.` })
  }

  const onDxfLoaded = (text: string, name: string) => {
    setDroppedDxf(null)
    set({ dxf: { text, name, units: null }, source: 'dxf' })
    const auto = parseOnce(text, name, null).geom
    if (auto && auto.width > 0 && auto.height > 0) setUnitsOpen(true)
  }

  const setHole = (i: number, patch: Partial<HoleGroup>) => setSpec({ holes: s.spec.holes.map((h, k) => (k === i ? { ...h, ...patch } : h)) })
  const setCut = (i: number, patch: Partial<CutoutGroup>) => setSpec({ cutouts: s.spec.cutouts.map((c, k) => (k === i ? { ...c, ...patch } : c)) })

  if (mats.done && mats.error) return <LoadError what="материалы" reason={mats.error} onRetry={mats.retry} />

  const fromDxf = s.source === 'dxf'
  const sp = s.spec

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0 space-y-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Расчёт детали</h1>
          <p className="mt-1 text-[13px] text-[#55554f]">Материал → размеры и количество → форма, отверстия и вырезы, если нужны. Цена справа пересчитывается сразу.</p>
        </div>

        <Step n={1} title="Стекло или зеркало">
          <div className="grid grid-cols-2 gap-2">
            {(['glass', 'mirror'] as Kind[]).map(k => (
              <button key={k} type="button" onClick={() => chooseKind(k)} className={`${chip(s.kind === k)} py-3 text-center text-[14px] font-medium`}>
                {KIND_TITLE[k]}
              </button>
            ))}
          </div>
        </Step>

        <Step n={2} title="Толщина">
          {!mats.done ? <div className="h-10 animate-pulse rounded-lg bg-[#f5f5f3]" /> : thicknesses.length === 0 ? (
            <p className="text-[13px] text-[#9a9a95]">Нет материалов с ценой для «{KIND_TITLE[s.kind]}».</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {thicknesses.map(x => (
                <button key={x.t} type="button" onClick={() => chooseThickness(x.t)} className={chip(x.t === thickness)}>
                  <span className="font-medium">{num(x.t)} мм</span>
                  <span className={`block text-[11px] ${x.t === thickness ? 'text-white/70' : 'text-[#9a9a95]'}`}>от {rub(x.from)}/м²</span>
                </button>
              ))}
            </div>
          )}
        </Step>

        <Step n={3} title="Материал" hint={thickness !== null ? `${KIND_TITLE[s.kind].toLowerCase()} ${num(thickness)} мм` : undefined}>
          {!mats.done ? <div className="h-24 animate-pulse rounded-lg bg-[#f5f5f3]" /> : (
            <div className="space-y-3">
              {groups.map(g => (
                <div key={g.category}>
                  {groups.length > 1 && <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[#9a9a95]">{categoryTitle(g.category)}</div>}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {g.items.map(m => (
                      <button key={m.id} type="button" onClick={() => set({ materialId: m.id, thickness: m.thickness })} className={`${chip(m.id === material?.id)} flex items-baseline justify-between gap-2`}>
                        <span className="min-w-0">{m.name}</span>
                        <span className={`shrink-0 text-[12px] tabular-nums ${m.id === material?.id ? 'text-white/80' : 'text-[#55554f]'}`}>{rub(m.pricePerM2)}/м²</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-[#9a9a95]">Прайс за м² {VAT_LABEL}, до скидки. Кромка, сверление и вырезы входят в цену за м².</p>

              <div className="space-y-2 rounded-xl border border-[#e4e4e0] bg-[#fafaf9] p-3">
                <label className={`flex items-start gap-2 text-[13px] ${temperable ? '' : 'opacity-60'}`}>
                  <input type="checkbox" className="mt-0.5 accent-[#111110]" checked={tempered} disabled={!temperable} onChange={e => set({ temperWanted: e.target.checked })} />
                  <span>
                    Закалка <span className="text-[#9a9a95]">— входит в цену за м²</span>
                    {!temperable && material && <span className="block text-[12px] text-[#9a9a95]">{mirror ? 'Зеркало не закаливается.' : 'Этот материал не закаливается.'}</span>}
                    {temperable && material?.temperable === null && <span className="block text-[12px] text-amber-700">Закаляемость этой толщины не подтверждена: нет ставки закалки в справочнике.</span>}
                  </span>
                </label>
                <div className={`flex flex-wrap items-center gap-2 text-[13px] ${facetTypes.length ? '' : 'opacity-60'}`}>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="accent-[#111110]" checked={hasFacet} disabled={!facetTypes.length} onChange={e => set({ hasFacet: e.target.checked })} />
                    Фацет <span className="text-[#9a9a95]">— доплата за п. м периметра</span>
                  </label>
                  {hasFacet && (
                    <select value={facetMm!} onChange={e => set({ facetMm: Number(e.target.value) })} className="rounded-lg border border-[#e4e4e0] bg-white px-2 py-1 text-[12px]" aria-label="Ширина фацета">
                      {facetTypes.map(f => <option key={f} value={f}>{f} мм</option>)}
                    </select>
                  )}
                </div>
              </div>
              {materialGone && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                  Материала из черновика больше нет среди активных с ценой — выбран «{material!.name}, {num(material!.thickness)} мм».
                </p>
              )}
              {mats.data?.warnings?.length ? <Warnings list={mats.data.warnings} /> : null}
            </div>
          )}
        </Step>

        <Step n={4} title="Размеры" hint="мм">
          {fromDxf ? (
            <p className="text-[13px] text-[#55554f]">
              {geom ? <>Из чертежа: <b className="tabular-nums">{num(geom.width)} × {num(geom.height)} мм</b> по габариту.</> : 'Из чертежа — загрузите DXF в шаге 6.'}
              {' '}<button type="button" onClick={() => set({ source: 'form' })} className="underline underline-offset-2">Задать вручную</button>
            </p>
          ) : sp.shape === 'circle' ? (
            <Field label="Диаметр" className="max-w-[200px]">
              <NumField value={sp.W} onChange={n => setSpec({ W: n })} className="w-full" suffix="мм" ariaLabel="Диаметр, мм" />
            </Field>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:max-w-[420px]">
              <Field label="Ширина"><NumField value={sp.W} onChange={n => setSpec({ W: n })} className="w-full" suffix="мм" ariaLabel="Ширина, мм" /></Field>
              <Field label="Высота"><NumField value={sp.H} onChange={n => setSpec({ H: n })} className="w-full" suffix="мм" ariaLabel="Высота, мм" /></Field>
            </div>
          )}
        </Step>

        <Step n={5} title="Количество">
          <div className="flex flex-wrap items-center gap-2">
            <NumField value={qty} onChange={n => set({ qty: Math.min(QTY_MAX, Math.max(1, Math.round(n))) })} className="w-28" suffix="шт." ariaLabel="Количество, шт." />
            {QTY_CHIPS.map(n => (
              <button key={n} type="button" onClick={() => set({ qty: n })} className={`rounded-lg border px-2.5 py-1.5 text-[12px] ${qty === n ? 'border-[#111110] bg-[#f5f5f3] font-medium' : 'border-[#e4e4e0] bg-white text-[#55554f] hover:border-[#9a9a95]'}`}>
                {n}
              </button>
            ))}
          </div>
        </Step>

        <Step n={6} title="Форма" hint="если деталь не прямоугольная">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SHAPES.map(sh => (
              <button key={sh.id} type="button" title={sh.hint} onClick={() => { setSpec({ shape: sh.id }); set({ source: 'form' }) }} className={chip(!fromDxf && sp.shape === sh.id)}>
                {sh.title}
              </button>
            ))}
            <button type="button" onClick={() => set({ source: 'dxf' })} className={chip(fromDxf)}>По чертежу DXF</button>
          </div>

          {!fromDxf && sp.shape === 'rounded' && (
            <Field label="Радиус углов" className="mt-3 max-w-[200px]"><NumField value={sp.R} onChange={n => setSpec({ R: n })} className="w-full" suffix="мм" ariaLabel="Радиус углов, мм" /></Field>
          )}
          {!fromDxf && sp.shape === 'bevel' && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-[420px]">
              <Field label="Высота слева"><NumField value={sp.HL} onChange={n => setSpec({ HL: n })} className="w-full" suffix="мм" ariaLabel="Высота слева, мм" /></Field>
              <Field label="Высота справа"><NumField value={sp.HR} onChange={n => setSpec({ HR: n })} className="w-full" suffix="мм" ariaLabel="Высота справа, мм" /></Field>
              <p className="col-span-2 text-[11px] text-[#9a9a95]">Верхняя кромка — прямая от левой высоты к правой; низ ровный. Большая из высот — не больше общей высоты.</p>
            </div>
          )}
          {!fromDxf && sp.shape === 'arch' && (
            <Field label="Подъём дуги" className="mt-3 max-w-[200px]"><NumField value={sp.A} onChange={n => setSpec({ A: n })} className="w-full" suffix="мм" ariaLabel="Подъём дуги, мм" /></Field>
          )}
          {!fromDxf && sp.shape !== 'rect' && (
            <p className="mt-2 text-[11px] text-[#9a9a95]">{SHAPES.find(x => x.id === sp.shape)?.hint} Цена — по габариту; к непрямоугольной форме движок добавляет надбавку за криволинейную резку.</p>
          )}

          {fromDxf && (
            <div className="mt-3 space-y-3">
              {droppedDxf && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                  Сохранённый чертёж «{droppedDxf}» не разобрался при открытии — убрал его из черновика. Загрузите файл заново.
                </p>
              )}
              <DxfInput fileName={s.dxf?.name ?? null} onLoaded={onDxfLoaded} />
              {dxfParsed?.failed && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
                  Чертёж не разобран: {dxfParsed.failed}. Пересохраните DXF из CAD-программы и загрузите снова.
                </p>
              )}
              <p className="text-[11px] text-[#9a9a95]">С чертежом размеры, форма, отверстия и вырезы берутся из файла — шаги 4 и 7 заполнятся сами.</p>
            </div>
          )}
        </Step>

        <Step n={7} title="Отверстия и вырезы" hint="если нужны">
          {fromDxf ? (
            <p className="text-[13px] text-[#55554f]">
              {geom ? `Из чертежа: отверстий ${geom.holes.length}, вырезов ${geom.cutouts.length}.` : 'Из чертежа — загрузите DXF в шаге 6.'}
            </p>
          ) : (
            <div className="space-y-3">
              {sp.holes.map((h, i) => (
                <div key={`h${i}`} className="rounded-xl border border-[#e4e4e0] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[13px] font-medium">Отверстия{sp.holes.length > 1 ? ` — группа ${i + 1}` : ''}</span>
                    <button type="button" onClick={() => setSpec({ holes: sp.holes.filter((_, k) => k !== i) })} className="text-[12px] text-[#9a9a95] hover:text-red-700">Убрать</button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Field label="Расположение" className="col-span-2">
                      <select value={h.layout} onChange={e => setHole(i, { layout: e.target.value as HoleGroup['layout'] })} className="w-full rounded-lg border border-[#e4e4e0] bg-white px-2.5 py-2 text-[13px]">
                        {HOLE_LAYOUTS.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                      </select>
                    </Field>
                    <Field label="Диаметр"><NumField value={h.d} onChange={n => setHole(i, { d: n })} className="w-full" suffix="мм" ariaLabel="Диаметр отверстия, мм" /></Field>
                    {h.layout === 'corners'
                      ? <Field label="Штук"><div className="py-2 text-[13px] text-[#55554f]">4</div></Field>
                      : <Field label="Штук"><NumField value={h.n} onChange={n => setHole(i, { n })} className="w-full" suffix="шт." ariaLabel="Число отверстий" /></Field>}
                    <Field label="От кромки до центра"><NumField value={h.edge} onChange={n => setHole(i, { edge: n })} className="w-full" suffix="мм" ariaLabel="От кромки до центра отверстия, мм" /></Field>
                    {h.layout !== 'corners' && (
                      <Field label="От торца до крайнего"><NumField value={h.end} onChange={n => setHole(i, { end: n })} className="w-full" suffix="мм" ariaLabel="От торца до крайнего отверстия, мм" /></Field>
                    )}
                  </div>
                </div>
              ))}
              {sp.cutouts.map((c, i) => (
                <div key={`c${i}`} className="rounded-xl border border-[#e4e4e0] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[13px] font-medium">Вырезы{sp.cutouts.length > 1 ? ` — группа ${i + 1}` : ''} <span className="font-normal text-[#9a9a95]">под розетку, ручку, выключатель</span></span>
                    <button type="button" onClick={() => setSpec({ cutouts: sp.cutouts.filter((_, k) => k !== i) })} className="text-[12px] text-[#9a9a95] hover:text-red-700">Убрать</button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <Field label="Ширина"><NumField value={c.w} onChange={n => setCut(i, { w: n })} className="w-full" suffix="мм" ariaLabel="Ширина выреза, мм" /></Field>
                    <Field label="Высота"><NumField value={c.h} onChange={n => setCut(i, { h: n })} className="w-full" suffix="мм" ariaLabel="Высота выреза, мм" /></Field>
                    <Field label="Радиус углов"><NumField value={c.r} onChange={n => setCut(i, { r: n })} className="w-full" suffix="мм" ariaLabel="Радиус углов выреза, мм" /></Field>
                    <Field label="Штук в ряд"><NumField value={c.n} onChange={n => setCut(i, { n })} className="w-full" suffix="шт." ariaLabel="Число вырезов" /></Field>
                    <Field label="Центр от верха"><NumField value={c.fromTop} onChange={n => setCut(i, { fromTop: n })} className="w-full" suffix="мм" ariaLabel="От верхней кромки до центра выреза, мм" /></Field>
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setSpec({ holes: [...sp.holes, { ...DEFAULT_HOLE }] })} className="rounded-lg border border-dashed border-[#9a9a95] px-3 py-2 text-[13px] text-[#33332f] hover:border-[#111110]">+ Отверстия</button>
                <button type="button" onClick={() => setSpec({ cutouts: [...sp.cutouts, { ...DEFAULT_CUTOUT }] })} className="rounded-lg border border-dashed border-[#9a9a95] px-3 py-2 text-[13px] text-[#33332f] hover:border-[#111110]">+ Вырез</button>
              </div>
              <p className="text-[11px] text-[#9a9a95]">Положение типовое (по углам, в ряд). Точное — по чертежу DXF в шаге 6. Сверление и вырезы входят в цену за м²; расстояния проверяются по черновым правилам стекла.</p>
            </div>
          )}
        </Step>
      </div>

      <div className="min-w-0 space-y-4">
        <section className="space-y-3 rounded-2xl border border-[#e4e4e0] bg-white p-4">
          {geom ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium">{geom.name}</div>
                  <div className="text-[12px] text-[#9a9a95]">
                    {material ? `${material.name}, ${num(material.thickness)} мм${tempered ? ', закалка' : ''}` : '—'} · {qty} шт.
                  </div>
                </div>
                {fromDxf && s.dxf && dxfAuto?.geom && dxfAuto.geom.width > 0 ? (
                  <button type="button" onClick={() => setUnitsOpen(true)} className={`shrink-0 rounded-lg border px-2.5 py-1 text-[12px] ${s.dxf.units ? 'border-[#e4e4e0] text-[#55554f]' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
                    Единицы: {UNIT_SHORT[s.dxf.units ?? geom.units.applied]}{s.dxf.units ? '' : ' — подтвердите'}
                  </button>
                ) : !fromDxf && (
                  <button type="button" onClick={() => downloadText(toDxf(geom, { label: geom.name }), `${fileSafe(geom.name)}.dxf`)} className="shrink-0 rounded-lg border border-[#e4e4e0] px-2.5 py-1 text-[12px] text-[#55554f] hover:border-[#9a9a95]">
                    Скачать DXF
                  </button>
                )}
              </div>
              <PartPreview geom={geom} issues={issues} selected={selected} mirror={mirror} onSelect={idx => setSel(idx === null ? null : { issues: issuesKey, idx })} />
              <dl className="grid grid-cols-3 gap-x-3 text-[12px]">
                <div><dt className="text-[#9a9a95]">По габариту</dt><dd className="tabular-nums">{num(geom.areaBBox, 3)} м²</dd></div>
                <div><dt className="text-[#9a9a95]">Стекла</dt><dd className="tabular-nums">{num(geom.areaNet, 3)} м²</dd></div>
                <div><dt className="text-[#9a9a95]">Кромка</dt><dd className="tabular-nums">{num(geom.perimeter / 1000, 2)} м</dd></div>
              </dl>
              <IssuesList issues={issues} selected={selected} onSelect={idx => setSel(idx === null ? null : { issues: issuesKey, idx })} />
            </>
          ) : (
            <p className="rounded-xl bg-[#f5f5f3] px-3 py-6 text-center text-[13px] text-[#55554f]">
              {fromDxf ? 'Загрузите чертёж DXF в шаге 6 — здесь появится деталь.' : 'Задайте размеры — здесь появится деталь.'}
            </p>
          )}
        </section>

        <PricePanel
          q={q}
          qty={qty}
          blocked={blocked}
          hardNote={hardNote}
          model={s.model}
          onModel={m => set({ model: m })}
          discount={s.discount}
          onDiscount={d => set({ discount: d })}
          overrides={s.overrides}
          onOverride={(m, patch) => set({ overrides: { ...s.overrides, [m]: patch ?? undefined } })}
          wholeOrder={s.wholeOrder}
          onWholeOrder={v => set({ wholeOrder: v })}
        />

        <div>
          <button
            type="button"
            onClick={addToCart}
            disabled={!!addReason}
            className="w-full rounded-xl bg-[#111110] px-4 py-3 text-[14px] font-medium text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            Добавить в расчёт — {qty} шт.
          </button>
          {addReason && <p className="mt-1.5 text-[12px] text-[#9a9a95]">Недоступно: {addReason}</p>}
        </div>

        <MiniCart items={s.items} onItems={items => set({ items })} model={s.model} discount={s.discount} override={cleanOverrides[s.model]} />
      </div>

      {unitsOpen && s.dxf && dxfAuto?.geom && (
        <UnitsDialog
          auto={dxfAuto.geom}
          current={s.dxf.units ?? dxfAuto.geom.units.applied}
          fileName={s.dxf.name}
          onConfirm={u => { set({ dxf: { ...s.dxf!, units: u } }); setUnitsOpen(false) }}
          onCancel={() => setUnitsOpen(false)}
        />
      )}
    </div>
  )
}
