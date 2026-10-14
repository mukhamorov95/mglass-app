'use client'

import { useEffect, useMemo, useState } from 'react'
import { allIssues, defaultParams, geometryToQuoteFacts, getTemplate, glassRules, toDxf, type PartGeometry, type TemplateId } from '@/lib/glasmen'
import { toast } from '@/lib/toast'
import type { QuoteBody } from './api'
import { MODEL_IDS, QUANTITIES, canTemper, isMirror, num } from './api'
import {
  DXF_STORE_LIMIT, STORE_KEY, parseOnce, priceGate, readSnapshot, storable, stripOverride, unitsPendingFor,
  type Overrides, type Snapshot, type Tab,
} from './quoterState'
import { useMaterials } from './useMaterials'
import { useQuote } from './useQuote'
import DxfInput from './DxfInput'
import UnitsDialog, { UNIT_SHORT } from './UnitsDialog'
import PartPreview from './PartPreview'
import IssuesList from './IssuesList'
import MaterialPicker from './MaterialPicker'
import PricePanel, { Warnings } from './PricePanel'
import MiniCart, { type CartItem } from './MiniCart'
import { TemplateParamsForm, TemplatePicker } from './TemplateForm'
import NumField from './NumField'
import { LoadError } from './States'

const TABS: { id: Tab; label: string }[] = [
  { id: 'dxf', label: 'Чертёж DXF' },
  { id: 'template', label: 'Шаблон' },
  { id: 'size', label: 'Размеры' },
]

function downloadText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/dxf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').replace(/×/g, 'x') || 'detal'

export default function Quoter({ initialTab }: { initialTab: Tab | null }) {
  const [init] = useState(() => {
    let stored: string | null = null
    try { stored = localStorage.getItem(STORE_KEY) } catch { /* хранилище недоступно — черновик пуст */ }
    return readSnapshot(initialTab, stored)
  })
  const [s, setS] = useState<Snapshot>(init.snap)
  const [droppedDxf, setDroppedDxf] = useState<string | null>(init.droppedDxf)
  const set = (patch: Partial<Snapshot>) => setS(prev => ({ ...prev, ...patch }))
  const [unitsOpen, setUnitsOpen] = useState(false)
  const [sel, setSel] = useState<{ issues: unknown; idx: number } | null>(null)
  const mats = useMaterials()

  useEffect(() => {
    const keepDxf = !!s.dxf && s.dxf.text.length <= DXF_STORE_LIMIT && storable(parseOnce(s.dxf.text, s.dxf.name, null))
    const toStore = s.dxf && !keepDxf ? { ...s, dxf: null } : s
    try { localStorage.setItem(STORE_KEY, JSON.stringify(toStore)) } catch { /* хранилище недоступно или полно — работаем без сохранения */ }
  }, [s])

  // ---------- деталь ----------
  const dxfAuto = useMemo(() => (s.dxf ? parseOnce(s.dxf.text, s.dxf.name, null) : null), [s.dxf])
  const dxfParsed = useMemo(() => (s.dxf && s.dxf.units ? parseOnce(s.dxf.text, s.dxf.name, s.dxf.units) : dxfAuto), [s.dxf, dxfAuto])
  const dxfGeom = dxfParsed?.geom ?? null
  const template = getTemplate(s.templateId)!
  const tplGeom = useMemo(() => template.build(s.templateParams), [template, s.templateParams])
  const sizeGeom = useMemo(() => getTemplate('rect')!.build({ W: s.size.W, H: s.size.H, R: 0 }), [s.size])
  const geom: PartGeometry | null = s.tab === 'dxf' ? dxfGeom : s.tab === 'template' ? tplGeom : sizeGeom

  // ---------- материал и правила ----------
  const list = mats.data?.materials ?? []
  const savedMaterial = list.find(m => m.id === s.materialId) ?? null
  const material = savedMaterial ?? list[0] ?? null
  const materialGone = mats.done && s.materialId !== null && !savedMaterial && !!material
  const facetTypes = mats.data?.facetTypesMm ?? []
  const facetMm = facetTypes.includes(s.facetMm) ? s.facetMm : facetTypes[0] ?? null
  const hasFacet = s.hasFacet && facetMm !== null
  const mirror = isMirror(material)
  const tempered = s.temperWanted && canTemper(material)
  const issues = useMemo(() => {
    if (!geom) return []
    const rules = glassRules(material?.thickness ?? 4, tempered, { category: mirror ? 'mirror' : 'glass' })
    return allIssues(geom, rules)
  }, [geom, material?.thickness, tempered, mirror])
  const selected = sel && sel.issues === issues ? sel.idx : null
  const hardCount = issues.filter(i => i.level === 'hard').length

  // ---------- цена ----------
  const facts = geom && geom.width > 0 && geom.height > 0 ? geometryToQuoteFacts(geom) : null
  const { blocked, hardNote, addReason } = priceGate({
    matsDone: mats.done, hasMaterial: !!material, tab: s.tab, hasDxf: !!s.dxf, hasFacts: !!facts,
    unitsPending: s.tab === 'dxf' && unitsPendingFor(s.dxf, dxfAuto?.geom), hardCount,
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
    quantities: QUANTITIES,
    discountPct: s.discount,
    models: MODEL_IDS,
    ...(Object.keys(cleanOverrides).length ? { params: cleanOverrides } : {}),
    asWholeOrder: s.wholeOrder,
  }
  const q = useQuote(body)

  const addToCart = () => {
    if (!geom || !facts || !material || addReason) return
    const item: CartItem = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: geom.name,
      materialId: material.id,
      materialLabel: `${material.name}, ${num(material.thickness)} мм`,
      width: facts.width, height: facts.height, shape: facts.shape,
      holes: facts.holes, cutouts: facts.cutouts,
      hasTempering: tempered, hasFacet,
      ...(hasFacet ? { facetTypeMm: facetMm! } : {}),
      qty: 1,
    }
    set({ items: [...s.items, item] })
    toast.success('Добавлено в расчёт', { detail: `${geom.name} — в блоке «Расчёт» ниже; количество меняется там.` })
  }

  const onDxfLoaded = (text: string, name: string) => {
    setDroppedDxf(null)
    set({ dxf: { text, name, units: null }, tab: 'dxf' })
    const auto = parseOnce(text, name, null).geom
    if (auto && auto.width > 0 && auto.height > 0) setUnitsOpen(true)
  }

  const pickTemplate = (id: TemplateId) => set({ templateId: id, templateParams: defaultParams(getTemplate(id)!) })

  if (mats.done && mats.error) return <LoadError what="материалы" reason={mats.error} onRetry={mats.retry} />

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Расчёт детали</h1>
          <p className="mt-1 text-[13px] text-[#55554f]">Чертёж, шаблон или размеры → проверка по правилам стекла → цена за штуку и за партию.</p>
        </div>

        <div className="flex gap-1 rounded-xl border border-[#e4e4e0] bg-white p-1" role="tablist">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={s.tab === t.id}
              onClick={() => set({ tab: t.id })}
              className={`flex-1 rounded-lg px-2 py-2 text-[13px] ${s.tab === t.id ? 'bg-[#111110] font-medium text-white' : 'text-[#55554f] hover:bg-[#f5f5f3]'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="rounded-2xl border border-[#e4e4e0] bg-white p-4">
          {s.tab === 'dxf' && (
            <div className="space-y-3">
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
            </div>
          )}
          {s.tab === 'template' && (
            <div className="space-y-4">
              <TemplatePicker value={s.templateId} onPick={pickTemplate} />
              <p className="text-[12px] text-[#55554f]">{template.description}</p>
              <TemplateParamsForm
                params={template.params}
                values={s.templateParams}
                onChange={(k, v) => set({ templateParams: { ...s.templateParams, [k]: v } })}
              />
            </div>
          )}
          {s.tab === 'size' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[12px] text-[#55554f]">Ширина, мм</span>
                <NumField value={s.size.W} onChange={n => set({ size: { ...s.size, W: n } })} className="mt-1 w-full" ariaLabel="Ширина, мм" />
              </label>
              <label className="block">
                <span className="text-[12px] text-[#55554f]">Высота, мм</span>
                <NumField value={s.size.H} onChange={n => set({ size: { ...s.size, H: n } })} className="mt-1 w-full" ariaLabel="Высота, мм" />
              </label>
              <p className="col-span-2 text-[11px] text-[#9a9a95]">Прямоугольник с острыми углами, 30–6000 мм. Скругления и отверстия — во вкладке «Шаблон».</p>
            </div>
          )}
        </div>

        {geom && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[14px] font-medium">{geom.name}</div>
                <div className="text-[12px] text-[#9a9a95]">
                  {num(geom.width)}×{num(geom.height)} мм · {geom.shape === 'rect' ? 'прямоугольник' : 'фигурная'}
                  {geom.holes.length ? ` · отверстий ${geom.holes.length}` : ''}
                  {geom.cutouts.length ? ` · вырезов ${geom.cutouts.length}` : ''}
                  {geom.rotatedDeg ? ` · повёрнута к осям на ${num(geom.rotatedDeg, 1)}°` : ''}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {s.tab === 'dxf' && s.dxf && dxfAuto?.geom && dxfAuto.geom.width > 0 && (
                  <button type="button" onClick={() => setUnitsOpen(true)} className={`rounded-lg border px-2.5 py-1 text-[12px] ${s.dxf.units ? 'border-[#e4e4e0] text-[#55554f]' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
                    Единицы: {UNIT_SHORT[s.dxf.units ?? geom.units.applied]}{s.dxf.units ? '' : ' — подтвердите'}
                  </button>
                )}
                {s.tab !== 'dxf' && (
                  <button
                    type="button"
                    onClick={() => downloadText(toDxf(geom, { label: geom.name }), `${fileSafe(geom.name)}.dxf`)}
                    className="rounded-lg border border-[#e4e4e0] px-2.5 py-1 text-[12px] text-[#55554f] hover:border-[#9a9a95]"
                  >
                    Скачать DXF
                  </button>
                )}
              </div>
            </div>
            <PartPreview geom={geom} issues={issues} selected={selected} mirror={mirror} onSelect={idx => setSel(idx === null ? null : { issues, idx })} />
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] sm:grid-cols-4">
              <div><dt className="text-[#9a9a95]">Площадь по габариту</dt><dd className="tabular-nums">{num(geom.areaBBox, 3)} м²</dd></div>
              <div><dt className="text-[#9a9a95]">Площадь стекла</dt><dd className="tabular-nums">{num(geom.areaNet, 3)} м²</dd></div>
              <div><dt className="text-[#9a9a95]">Периметр (кромка)</dt><dd className="tabular-nums">{num(geom.perimeter / 1000, 2)} м</dd></div>
              <div><dt className="text-[#9a9a95]">Правила</dt><dd>{material ? `${num(material.thickness)} мм, ${tempered ? 'закалка' : 'без закалки'}` : '—'}</dd></div>
            </dl>
            <IssuesList issues={issues} selected={selected} onSelect={idx => setSel(idx === null ? null : { issues, idx })} />
          </div>
        )}
      </div>

      <div className="min-w-0 space-y-4">
        <section className="rounded-2xl border border-[#e4e4e0] bg-white p-4">
          <h2 className="mb-3 text-[15px] font-semibold">Материал и обработка</h2>
          {!mats.done ? <div className="h-32 animate-pulse rounded-xl bg-[#f5f5f3]" /> : (
            <MaterialPicker
              materials={list}
              materialId={material?.id ?? null}
              onMaterial={id => set({ materialId: id })}
              temperWanted={s.temperWanted}
              onTemper={v => set({ temperWanted: v })}
              hasFacet={hasFacet}
              onFacet={v => set({ hasFacet: v })}
              facetMm={facetMm}
              onFacetMm={v => set({ facetMm: v })}
              facetTypes={facetTypes}
            />
          )}
          {materialGone && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              Материала из черновика больше нет среди активных с ценой — показан «{material!.name}, {num(material!.thickness)} мм». Выберите нужный.
            </p>
          )}
          {mats.data?.warnings?.length ? <div className="mt-3"><Warnings list={mats.data.warnings} /></div> : null}
        </section>

        <PricePanel
          q={q}
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
            Добавить в расчёт
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
