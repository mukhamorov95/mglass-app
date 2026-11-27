'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Range } from '@/lib/economics/classification/vat'
import { CUTOUT_TYPES } from '@/lib/economics/engine/technology'
import { emptyPosition, type LabPosition, type LabProject } from '@/lib/economics/lab/project'
import type { LabQuote } from '@/lib/economics/lab/quote'
import type { Legacy } from '@/lib/economics/lab/compare'

// Экран экспериментального проекта. Каждая сумма раскрывается до норматива и формулы, пропуски
// печатаются списком, а не сворачиваются в ноль. Прайс и заказы отсюда не меняются.
type MaterialRef = { id: number; name: string; category: string; thickness: number }
type VariantHead = { id: string; label: string; note: string; computedAt: string; techStamp: string; financeStamp: string | null; input: LabProject }

const CUTOUT_LABEL: Record<string, string> = {
  angle: 'Угловой', rect: 'Прямоугольный', hinge: 'Под петлю',
  cheburashka: 'Чебурашка / ДСАУ', socket: 'Под розетку', complex: 'Сложный',
}
const EDGE_LABEL: Record<string, string> = { grind: 'Шлифовка', polish: 'Полировка', none: 'Без обработки', unknown: 'Не указан' }
const SAND_LABEL: Record<string, string> = { standard: 'Стандартный', dense: 'Плотный', enhanced: 'Усиленный', unknown: 'Не указан' }

const nf = (x: number, d = 0) => x.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d })
const rng = (r: Range | null | undefined, d = 0, unit = '') => {
  if (!r) return <span className="text-[#9a9a95]">нет значения</span>
  const same = Math.abs(r.hi - r.lo) < 0.005
  return <>{same ? nf(r.lo, d) : `${nf(r.lo, d)} … ${nf(r.hi, d)}`}{unit ? ` ${unit}` : ''}</>
}
const hours = (r: Range | null | undefined) => (r ? rng({ lo: r.lo / 60, hi: r.hi / 60 }, 1, 'ч') : rng(null))

const field = 'w-full rounded border border-[#e4e4e0] px-2 py-1 text-sm text-[#111110] bg-white'
const label = 'block text-[10px] uppercase tracking-widest text-[#9a9a95]'

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 rounded-lg border border-[#e4e4e0] bg-white p-4">
      <h2 className="text-sm font-semibold text-[#111110]">{title}</h2>
      {sub && <p className="mt-0.5 text-xs text-[#9a9a95]">{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

export default function LabClient({ initial, materials, variants, refSource, refProblems, initialQuote = null, initialLegacy = null }: {
  initial: LabProject
  materials: MaterialRef[]
  variants: VariantHead[]
  refSource: { tech: string | null; finance: string | null }
  refProblems: string[]
  initialQuote?: LabQuote | null
  initialLegacy?: Legacy | null
}) {
  const router = useRouter()
  const [p, setP] = useState<LabProject>(initial)
  const [quote, setQuote] = useState<LabQuote | null>(initialQuote)
  const [legacy, setLegacy] = useState<Legacy | null>(initialLegacy)
  const [notes, setNotes] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const patch = (x: Partial<LabProject>) => setP(prev => ({ ...prev, ...x }))
  const patchPos = (id: string, x: Partial<LabPosition>) =>
    setP(prev => ({ ...prev, positions: prev.positions.map(q => (q.id === id ? { ...q, ...x } : q)) }))

  async function call<T>(url: string, init: RequestInit, what: string): Promise<T | null> {
    setBusy(what); setMsg(null)
    try {
      const r = await fetch(url, { headers: { 'content-type': 'application/json' }, ...init })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setMsg(j.error ?? `Ошибка ${r.status}`); return null }
      return j as T
    } catch (e) { setMsg(String(e)); return null } finally { setBusy(null) }
  }

  const recalc = async () => {
    const j = await call<{ quote: LabQuote | null; legacy: Legacy | null; notes: string[] }>(
      '/api/cfo/lab/quote', { method: 'POST', body: JSON.stringify({ project: p }) }, 'calc')
    if (!j) return
    setQuote(j.quote); setLegacy(j.legacy); setNotes(j.notes ?? [])
    if (!j.quote) setMsg('Расчёт не выполнен: ' + (j.notes ?? []).join('; '))
  }

  const saveProject = async () => {
    const j = p.id
      ? await call<{ id: string }>(`/api/cfo/lab/projects/${p.id}`, { method: 'PUT', body: JSON.stringify({ project: p }) }, 'save')
      : await call<{ id: string }>('/api/cfo/lab/projects', { method: 'POST', body: JSON.stringify({ project: p }) }, 'save')
    if (!j) return
    setMsg('Проект сохранён')
    if (!p.id) router.replace(`/cfo/lab/${j.id}`)
    else router.refresh()
  }

  const saveVariant = async () => {
    if (!p.id) { setMsg('Сначала сохраните проект'); return }
    const lbl = window.prompt('Название варианта — чем он отличается?')
    if (!lbl?.trim()) return
    const j = await call<{ id: string }>('/api/cfo/lab/variants',
      { method: 'POST', body: JSON.stringify({ projectId: p.id, label: lbl, project: p }) }, 'variant')
    if (j) { setMsg('Вариант сохранён: правка справочника его больше не изменит'); router.refresh() }
  }

  const s = p.scenario
  const money = quote?.money ?? null

  return (
    <div className="pb-16">
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input className="flex-1 min-w-48 rounded border border-[#e4e4e0] bg-white px-3 py-2 text-base font-semibold text-[#111110]"
          value={p.title} onChange={e => patch({ title: e.target.value })} />
        <button onClick={recalc} disabled={!!busy} className="rounded-md bg-[#111110] px-4 py-2 text-sm text-white disabled:opacity-50">
          {busy === 'calc' ? 'Считаю…' : 'Рассчитать'}
        </button>
        <button onClick={saveProject} disabled={!!busy} className="rounded-md border border-[#e4e4e0] bg-white px-4 py-2 text-sm text-[#111110]">
          Сохранить проект
        </button>
        <button onClick={saveVariant} disabled={!!busy} className="rounded-md border border-[#e4e4e0] bg-white px-4 py-2 text-sm text-[#111110]">
          Сохранить вариант
        </button>
      </div>
      <p className="mt-1 text-xs text-[#9a9a95]">
        Это экспериментальный расчёт, а не заказ и не согласованная цена: в производство, на склад
        и в выручку он не попадает, прайс не меняет.
      </p>
      {msg && <p className="mt-2 rounded border border-[#e4e4e0] bg-white px-3 py-2 text-sm text-[#111110]">{msg}</p>}

      {/* 1. Параметры проекта */}
      <Section title="1. Параметры проекта" sub={`Нормативы: ${refSource.tech ?? 'не загружены'} · финансовые параметры: ${refSource.finance ?? 'не загружены'}`}>
        {refProblems.length > 0 && (
          <ul className="mb-3 space-y-0.5 text-xs text-amber-700">{refProblems.map(x => <li key={x}>• {x}</li>)}</ul>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><span className={label}>Площадь</span>
            <select className={field} value={s.area} onChange={e => patch({ scenario: { ...s, area: e.target.value as typeof s.area } })}>
              <option value="current">действующая</option><option value="target">целевая</option>
            </select></div>
          <div><span className={label}>Лизинги</span>
            <select className={field} value={s.leases} onChange={e => patch({ scenario: { ...s, leases: e.target.value as typeof s.leases } })}>
              <option value="active">действуют</option><option value="afterEnd">после окончания</option><option value="none">без производственных</option>
            </select></div>
          <div><span className={label}>Смены</span>
            <input type="number" min={1} step={0.5} className={field} value={s.shifts}
              onChange={e => patch({ scenario: { ...s, shifts: Number(e.target.value) || 1 } })} /></div>
          <div><span className={label}>Режим норм</span>
            <select className={field} value={s.profile} onChange={e => patch({ scenario: { ...s, profile: e.target.value as typeof s.profile } })}>
              <option value="detailed">только подробные</option><option value="with_coarse">подробные + грубые</option>
            </select></div>
          <div><span className={label}>НДС исходящий, %</span>
            <input type="number" className={field} value={s.vatRatePct}
              onChange={e => patch({ scenario: { ...s, vatRatePct: Number(e.target.value) } })} /></div>
          <div><span className={label}>Комиссия от цены, %</span>
            <input type="number" className={field} value={s.commissionPct}
              onChange={e => patch({ scenario: { ...s, commissionPct: Number(e.target.value) } })} /></div>
          <div><span className={label}>Целевая доля МД, %</span>
            <input type="number" className={field} value={s.targetMarginPct ?? ''} placeholder="не задана"
              onChange={e => patch({ scenario: { ...s, targetMarginPct: e.target.value === '' ? null : Number(e.target.value) } })} /></div>
          <div><span className={label}>Цель МД на час ресурса, ₽</span>
            <input type="number" className={field} value={s.targetMdPerHour ?? ''} placeholder="не задана"
              onChange={e => patch({ scenario: { ...s, targetMdPerHour: e.target.value === '' ? null : Number(e.target.value) } })} /></div>
          <div><span className={label}>Канал</span>
            <select className={field} value={s.channel} onChange={e => patch({ scenario: { ...s, channel: e.target.value as typeof s.channel } })}>
              <option value="b2b">B2B</option><option value="d2c">D2C</option><option value="b2c">B2C</option><option value="internal">внутренний</option>
            </select></div>
          <div><span className={label}>Входной НДС</span>
            <select className={field} value={s.deductInputVat ? '1' : '0'}
              onChange={e => patch({ scenario: { ...s, deductInputVat: e.target.value === '1' } })}>
              <option value="1">к вычету</option><option value="0">не возмещается</option>
            </select></div>
        </div>
        <textarea className={`${field} mt-3`} rows={2} placeholder="Комментарий собственника"
          value={p.note} onChange={e => patch({ note: e.target.value })} />
      </Section>

      {/* 2. Спецификация изделий */}
      <Section title="2. Спецификация изделий" sub="Чего в позиции нет, то и не подставляется: «не указан» даёт диапазон, а не среднее.">
        {p.positions.map((q, i) => (
          <div key={q.id} className="mb-3 rounded border border-[#e4e4e0] p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold text-[#111110]">Позиция {i + 1}</span>
              {p.positions.length > 1 && (
                <button className="text-xs text-red-600" onClick={() => patch({ positions: p.positions.filter(x => x.id !== q.id) })}>убрать</button>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-6">
              <div className="col-span-2"><span className={label}>Материал</span>
                <select className={field} value={q.materialId ?? ''} onChange={e => {
                  const id = e.target.value === '' ? null : Number(e.target.value)
                  const m = materials.find(x => x.id === id)
                  patchPos(q.id, { materialId: id, materialLabel: m?.name, thicknessMm: m?.thickness ?? q.thicknessMm })
                }}>
                  <option value="">не выбран</option>
                  {materials.map(m => <option key={m.id} value={m.id}>{m.name} · {m.thickness} мм</option>)}
                </select></div>
              <div><span className={label}>Толщина, мм</span>
                <input type="number" className={field} value={q.thicknessMm ?? ''} onChange={e => patchPos(q.id, { thicknessMm: e.target.value === '' ? null : Number(e.target.value) })} /></div>
              <div><span className={label}>Ширина, мм</span>
                <input type="number" className={field} value={q.widthMm ?? ''} onChange={e => patchPos(q.id, { widthMm: e.target.value === '' ? null : Number(e.target.value) })} /></div>
              <div><span className={label}>Высота, мм</span>
                <input type="number" className={field} value={q.heightMm ?? ''} onChange={e => patchPos(q.id, { heightMm: e.target.value === '' ? null : Number(e.target.value) })} /></div>
              <div><span className={label}>Количество</span>
                <input type="number" min={1} className={field} value={q.qty} onChange={e => patchPos(q.id, { qty: Number(e.target.value) || 0 })} /></div>
              <div><span className={label}>Форма</span>
                <select className={field} value={q.shape} onChange={e => patchPos(q.id, { shape: e.target.value as 'rect' | 'curved' })}>
                  <option value="rect">прямоугольная</option><option value="curved">фигурная</option>
                </select></div>
              <div><span className={label}>Кромка</span>
                <select className={field} value={q.edge} onChange={e => patchPos(q.id, { edge: e.target.value as LabPosition['edge'] })}>
                  {Object.entries(EDGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
              <div><span className={label}>Сторон</span>
                <input type="number" min={0} max={4} className={field} value={q.edgeSides ?? ''} placeholder="весь периметр"
                  onChange={e => patchPos(q.id, { edgeSides: e.target.value === '' ? null : Number(e.target.value) })} /></div>
              <div><span className={label}>Длина обработки, м</span>
                <input type="number" step={0.01} className={field} value={q.edgeLengthM ?? ''} placeholder="из габарита"
                  onChange={e => patchPos(q.id, { edgeLengthM: e.target.value === '' ? null : Number(e.target.value) })} /></div>
              <div><span className={label}>Разметка отверстий</span>
                <select className={field} value={q.marking} onChange={e => patchPos(q.id, { marking: e.target.value as LabPosition['marking'] })}>
                  <option value="unknown">не указана</option><option value="manual">ручная</option><option value="template">по шаблону</option>
                </select></div>
              <div><span className={label}>Триплекс</span>
                <select className={field} value={q.triplexLayers ?? ''} onChange={e => patchPos(q.id, { triplexLayers: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">нет</option><option value="2">2 стекла</option><option value="3">3 стекла</option>
                </select></div>
              <div className="flex items-end gap-3 text-xs text-[#111110]">
                <label className="flex items-center gap-1"><input type="checkbox" checked={q.tempering} onChange={e => patchPos(q.id, { tempering: e.target.checked })} />закалка</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={q.facet} onChange={e => patchPos(q.id, { facet: e.target.checked })} />фацет</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={q.packaging} onChange={e => patchPos(q.id, { packaging: e.target.checked })} />упаковка</label>
              </div>
            </div>

            {/* отверстия */}
            <div className="mt-3">
              <span className={label}>Отверстия</span>
              {q.holes.map((h, hi) => (
                <div key={hi} className="mt-1 flex items-center gap-2">
                  <input type="number" className={`${field} w-28`} placeholder="Ø, мм" value={h.diameterMm ?? ''}
                    onChange={e => patchPos(q.id, { holes: q.holes.map((x, j) => j === hi ? { ...x, diameterMm: e.target.value === '' ? null : Number(e.target.value) } : x) })} />
                  <input type="number" className={`${field} w-28`} placeholder="шт. на деталь" value={h.perPart || ''}
                    onChange={e => patchPos(q.id, { holes: q.holes.map((x, j) => j === hi ? { ...x, perPart: Number(e.target.value) || 0 } : x) })} />
                  <button className="text-xs text-red-600" onClick={() => patchPos(q.id, { holes: q.holes.filter((_, j) => j !== hi) })}>убрать</button>
                </div>
              ))}
              <button className="mt-1 text-xs text-[#111110] underline" onClick={() => patchPos(q.id, { holes: [...q.holes, { diameterMm: null, perPart: 1 }] })}>
                + группа отверстий
              </button>
            </div>

            {/* вырезы */}
            <div className="mt-3">
              <span className={label}>Вырезы</span>
              {q.cutouts.map((c, ci) => (
                <div key={ci} className="mt-1 flex items-center gap-2">
                  <select className={`${field} w-44`} value={c.type ?? ''}
                    onChange={e => patchPos(q.id, { cutouts: q.cutouts.map((x, j) => j === ci ? { ...x, type: e.target.value || null } : x) })}>
                    <option value="">тип не указан</option>
                    {CUTOUT_TYPES.map(t => <option key={t} value={t}>{CUTOUT_LABEL[t]}</option>)}
                  </select>
                  <input type="number" className={`${field} w-24`} placeholder="шт." value={c.perPart || ''}
                    onChange={e => patchPos(q.id, { cutouts: q.cutouts.map((x, j) => j === ci ? { ...x, perPart: Number(e.target.value) || 0 } : x) })} />
                  <select className={`${field} w-48`} value={c.equipment}
                    onChange={e => patchPos(q.id, { cutouts: q.cutouts.map((x, j) => j === ci ? { ...x, equipment: e.target.value as typeof c.equipment } : x) })}>
                    <option value="unknown">оборудование не указано</option><option value="jym">станок JYM-1</option><option value="manual">ручной инструмент</option>
                  </select>
                  <button className="text-xs text-red-600" onClick={() => patchPos(q.id, { cutouts: q.cutouts.filter((_, j) => j !== ci) })}>убрать</button>
                </div>
              ))}
              <button className="mt-1 text-xs text-[#111110] underline" onClick={() => patchPos(q.id, { cutouts: [...q.cutouts, { type: null, perPart: 1, equipment: 'unknown' }] })}>
                + вырез
              </button>
            </div>

            {/* пескоструй и расход материала */}
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              <div><span className={label}>Пескоструй</span>
                <select className={field} value={q.sandblast ? q.sandblast.mode : ''}
                  onChange={e => patchPos(q.id, { sandblast: e.target.value === '' ? null : { m2PerPart: q.sandblast?.m2PerPart ?? null, mode: e.target.value as never } })}>
                  <option value="">нет</option>
                  {Object.entries(SAND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
              {q.sandblast && (
                <div><span className={label}>Площадь обработки, м²/дет.</span>
                  <input type="number" step={0.01} className={field} value={q.sandblast.m2PerPart ?? ''} placeholder="вся деталь"
                    onChange={e => patchPos(q.id, { sandblast: { ...q.sandblast!, m2PerPart: e.target.value === '' ? null : Number(e.target.value) } })} /></div>
              )}
              <div><span className={label}>Расход материала</span>
                <select className={field} value={q.material.kind} onChange={e => {
                  const kind = e.target.value as LabPosition['material']['kind']
                  patchPos(q.id, { material: kind === 'utilization' ? { kind, coefficient: null } : kind === 'sheets' ? { kind, partsPerSheet: null } : { kind, m2: null } })
                }}>
                  <option value="utilization">коэффициент использования</option>
                  <option value="sheets">целые листы</option>
                  <option value="manual">ввести вручную</option>
                </select></div>
              <div>
                <span className={label}>
                  {q.material.kind === 'utilization' ? 'Коэффициент (доля)' : q.material.kind === 'sheets' ? 'Деталей на листе' : 'Расход, м²'}
                </span>
                <input type="number" step={0.01} className={field}
                  value={q.material.kind === 'utilization' ? (q.material.coefficient ?? '') : q.material.kind === 'sheets' ? (q.material.partsPerSheet ?? '') : (q.material.m2 ?? '')}
                  placeholder={q.material.kind === 'utilization' ? '0,75' : q.material.kind === 'sheets' ? 'размещение' : 'м²'}
                  onChange={e => {
                    const v = e.target.value === '' ? null : Number(e.target.value)
                    patchPos(q.id, {
                      material: q.material.kind === 'utilization' ? { kind: 'utilization', coefficient: v }
                        : q.material.kind === 'sheets' ? { kind: 'sheets', partsPerSheet: v }
                        : { kind: 'manual', m2: v },
                    })
                  }} />
              </div>
            </div>

            {/* прочие прямые */}
            <div className="mt-3">
              <span className={label}>Дополнительные материалы и услуги</span>
              {q.extras.map((x, xi) => (
                <div key={xi} className="mt-1 flex items-center gap-2">
                  <input className={`${field} flex-1`} placeholder="что это" value={x.label}
                    onChange={e => patchPos(q.id, { extras: q.extras.map((y, j) => j === xi ? { ...y, label: e.target.value } : y) })} />
                  <input type="number" className={`${field} w-32`} placeholder="₽ с НДС" value={x.amountGross || ''}
                    onChange={e => patchPos(q.id, { extras: q.extras.map((y, j) => j === xi ? { ...y, amountGross: Number(e.target.value) || 0 } : y) })} />
                  <select className={`${field} w-32`} value={String(x.vat)}
                    onChange={e => patchPos(q.id, { extras: q.extras.map((y, j) => j === xi ? { ...y, vat: e.target.value === 'none' ? 'none' : e.target.value === 'unknown' ? 'unknown' : Number(e.target.value) } : y) })}>
                    <option value="22">НДС 22 %</option><option value="none">без НДС</option><option value="unknown">режим неизвестен</option>
                  </select>
                  <button className="text-xs text-red-600" onClick={() => patchPos(q.id, { extras: q.extras.filter((_, j) => j !== xi) })}>убрать</button>
                </div>
              ))}
              <button className="mt-1 text-xs text-[#111110] underline" onClick={() => patchPos(q.id, { extras: [...q.extras, { label: '', amountGross: 0, vat: 22 }] })}>
                + строка
              </button>
            </div>
          </div>
        ))}
        <button className="text-xs text-[#111110] underline"
          onClick={() => patch({ positions: [...p.positions, emptyPosition(`p${p.positions.length + 1}-${Date.now() % 1000}`)] })}>
          + позиция
        </button>
      </Section>

      {/* Правки нормативов проекта */}
      <Section title="Правки нормативов этого проекта" sub="Глобальный справочник не меняется: правка живёт в проекте и попадает в отпечаток расчёта.">
        {p.overrides.map((o, i) => (
          <div key={i} className="mt-1 flex items-center gap-2">
            <input className={`${field} w-64`} placeholder="ключ норматива, напр. cut.minPerSheet" value={o.key}
              onChange={e => patch({ overrides: p.overrides.map((x, j) => j === i ? { ...x, key: e.target.value } : x) })} />
            <input type="number" step={0.01} className={`${field} w-24`} placeholder="от" value={o.lo}
              onChange={e => patch({ overrides: p.overrides.map((x, j) => j === i ? { ...x, lo: Number(e.target.value) } : x) })} />
            <input type="number" step={0.01} className={`${field} w-24`} placeholder="до" value={o.hi}
              onChange={e => patch({ overrides: p.overrides.map((x, j) => j === i ? { ...x, hi: Number(e.target.value) } : x) })} />
            <input className={`${field} flex-1`} placeholder="почему" value={o.note}
              onChange={e => patch({ overrides: p.overrides.map((x, j) => j === i ? { ...x, note: e.target.value } : x) })} />
            <button className="text-xs text-red-600" onClick={() => patch({ overrides: p.overrides.filter((_, j) => j !== i) })}>убрать</button>
          </div>
        ))}
        <button className="mt-1 text-xs text-[#111110] underline"
          onClick={() => patch({ overrides: [...p.overrides, { key: '', lo: 0, hi: 0, note: '' }] })}>+ правка</button>
      </Section>

      {quote && (
        <>
          {quote.errors.length > 0 && (
            <ul className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-xs text-red-800">
              {quote.errors.map(e => <li key={e}>• {e}</li>)}
            </ul>
          )}

          {/* 3. Технологические операции */}
          <Section title="3. Технологические операции" sub={`Статус расчёта: ${quote.statusLabel}. Отпечаток норм ${quote.stamps.tech}${quote.stamps.finance ? ` · ${quote.stamps.finance}` : ''}`}>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-[#9a9a95]">
                <th className="pb-1">Операция</th><th>Участок</th><th className="text-right">Объём</th>
                <th className="text-right">Люди, мин</th><th className="text-right">Станок, мин</th><th className="text-right">Расходник, ₽</th><th>Формула</th>
              </tr></thead>
              <tbody>
                {quote.operations.map((o, i) => (
                  <tr key={i} className="border-t border-[#e4e4e0]">
                    <td className="py-1">{o.opLabel}</td><td>{o.centerLabel}</td>
                    <td className="text-right">{nf(o.qty, 2)} {o.unit}</td>
                    <td className="text-right">{rng(o.labourMin, 1)}</td>
                    <td className="text-right">{rng(o.machineMin, 1)}</td>
                    <td className="text-right">{rng(o.consumableRub, 0)}</td>
                    <td className="text-[#9a9a95]">{o.formula}</td>
                  </tr>
                ))}
                {quote.setups.map((o, i) => (
                  <tr key={`s${i}`} className="border-t border-[#e4e4e0] bg-[#f5f5f3]">
                    <td className="py-1">Наладка партии — {o.opLabel.toLowerCase()}</td><td>{o.centerLabel}</td>
                    <td className="text-right">партия {o.batchKey}</td>
                    <td className="text-right">{rng(o.labourMin, 1)}</td>
                    <td className="text-right">{rng(o.machineMin, 1)}</td>
                    <td className="text-right">—</td>
                    <td className="text-[#9a9a95]">одна на всю партию, а не на деталь</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          {/* 4. Материалы */}
          <Section title="4. Материалы">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-[#9a9a95]">
                <th className="pb-1">Позиция</th><th className="text-right">Годная площадь, м²</th><th className="text-right">Израсходовано, м²</th>
                <th className="text-right">Листов</th><th className="text-right">Вес, кг</th><th>Режим</th>
              </tr></thead>
              <tbody>{quote.positions.map(v => (
                <tr key={v.id} className="border-t border-[#e4e4e0]">
                  <td className="py-1">{v.label}</td>
                  <td className="text-right">{nf(v.netM2, 3)}</td>
                  <td className="text-right">{rng(v.usedM2, 3)}</td>
                  <td className="text-right">{rng(v.sheets, 2)}</td>
                  <td className="text-right">{nf(v.weightKg, 1)}</td>
                  <td className="text-[#9a9a95]">{v.materialMode}: {v.materialNote}</td>
                </tr>
              ))}</tbody>
            </table>
            {money && (
              <table className="mt-3 w-full text-xs">
                <tbody>{money.direct.map((d, i) => (
                  <tr key={i} className="border-t border-[#e4e4e0]">
                    <td className="py-1">{d.label}</td>
                    <td className="text-right">{rng(d.cost, 0, '₽')}</td>
                    <td className="pl-3 text-[#9a9a95]">{d.note}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </Section>

          {/* 5 и 6. Человеко-часы и станко-часы */}
          <Section title="5–6. Человеко-часы и станко-часы" sub="Это разные ресурсы: второй человек не добавляет станко-часов.">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-[#9a9a95]">
                <th className="pb-1">Участок</th><th>Станок</th><th className="text-right">Люди</th><th className="text-right">из них наладка</th>
                <th className="text-right">Станок</th><th className="text-right">Труд, ₽</th><th className="text-right">Станок, ₽</th>
                <th className="text-right">Доля мощности людей</th><th className="text-right">станка</th>
              </tr></thead>
              <tbody>{quote.minutes.map(m => (
                <tr key={m.id} className="border-t border-[#e4e4e0]">
                  <td className="py-1">{m.label}</td><td>{m.machine ?? '—'}</td>
                  <td className="text-right">{hours(m.labourMin)}</td>
                  <td className="text-right">{hours(m.setupMin)}</td>
                  <td className="text-right">{m.machine ? hours(m.machineMin) : '—'}</td>
                  <td className="text-right">{rng(m.labourCost, 0)}</td>
                  <td className="text-right">{m.machine ? rng(m.machineCost, 0) : '—'}</td>
                  <td className="text-right">{m.labourShare ? rng({ lo: m.labourShare.lo * 100, hi: m.labourShare.hi * 100 }, 1, '%') : rng(null)}</td>
                  <td className="text-right">{m.machineShare ? rng({ lo: m.machineShare.lo * 100, hi: m.machineShare.hi * 100 }, 1, '%') : '—'}</td>
                </tr>
              ))}
              <tr className="border-t border-[#e4e4e0] font-semibold">
                <td className="py-1">Итого</td><td />
                <td className="text-right">{hours(quote.totals.labourMin)}</td>
                <td className="text-right">{hours(quote.totals.setupMin)}</td>
                <td className="text-right">{hours(quote.totals.machineMin)}</td>
                <td colSpan={4} />
              </tr>
              </tbody>
            </table>
          </Section>

          {/* 7. Себестоимость */}
          <Section title="7. Себестоимость" sub={money ? 'H0 — переменная, H1 — нормативная производственная, H2 — полная экономическая.' : undefined}>
            {!money && <p className="text-sm text-amber-700">{quote.moneyWhy}</p>}
            {money && (
              <table className="w-full text-sm">
                <tbody>
                  <Row label="H0 — переменная себестоимость" v={money.levels.h0} bold />
                  <Row label="+ стоимость ресурсов (труд и станки)" v={money.resource} />
                  <Row label="   в том числе наладка партий" v={money.setupCost} muted />
                  <Row label="+ расходники по драйверу (износ сверла, абразив)" v={money.consumables} />
                  <Row label="+ общепроизводственные" v={money.overhead} />
                  <Row label="H1 — нормативная производственная" v={money.levels.h1} bold />
                  <Row label="+ административные и коммерческие" v={money.admin} />
                  <Row label="H2 — полная экономическая" v={money.levels.h2} bold />
                </tbody>
              </table>
            )}
            {money?.bottleneck && (
              <p className="mt-2 text-xs text-[#9a9a95]">
                Самый занятый ресурс заказа: {money.bottleneck.label} — {rng(money.bottleneck.hours, 1, 'ч')},
                {' '}{nf(money.bottleneck.share * 100, 1)} % месячной мощности. Это не доказанное узкое место цеха.
              </p>
            )}
          </Section>

          {/* 8. Ценовые сценарии */}
          {money && (
            <Section title="8. Ценовые сценарии" sub="Цена с НДС. Комиссия стоит в знаменателе: она берётся с суммы к оплате.">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-[#9a9a95]">
                  <th className="pb-1">Сценарий</th><th className="text-right">Цена с НДС</th><th className="text-right">Без НДС</th><th>Формула</th>
                </tr></thead>
                <tbody>{money.prices.map(x => (
                  <tr key={x.id} className="border-t border-[#e4e4e0]">
                    <td className="py-1">{x.id}. {x.label}{x.caution && <span className="block text-[#9a9a95]">{x.caution}</span>}</td>
                    <td className="text-right">{x.incVat ? rng(x.incVat, 0, '₽') : <span className="text-[#9a9a95]">нет цены</span>}</td>
                    <td className="text-right">{x.exVat ? rng(x.exVat, 0, '₽') : '—'}</td>
                    <td className="text-[#9a9a95]">{x.why ?? x.formula}</td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="mt-3 text-xs font-semibold text-[#111110]">Денежная модель</p>
              <p className="text-xs text-[#9a9a95]">
                Денежная нагрузка месяца: {rng(money.cash.monthlyGross, 0, '₽')} как платим,
                {' '}{rng(money.cash.monthlyExVat, 0, '₽')} без вычитаемого НДС.
                Это денежные обязательства производственного контура, а не экономическая себестоимость.
              </p>
              <table className="mt-1 w-full text-xs">
                <thead><tr className="text-left text-[#9a9a95]"><th>При цене сценария</th><th className="text-right">МД заказа</th><th className="text-right">Таких заказов в месяц до нуля</th></tr></thead>
                <tbody>{money.cash.perPrice.map(c => (
                  <tr key={c.id} className="border-t border-[#e4e4e0]">
                    <td className="py-1">{c.id}</td>
                    <td className="text-right">{c.md ? rng(c.md, 0, '₽') : <span className="text-[#9a9a95]">нет цены</span>}</td>
                    <td className="text-right">{c.ordersPerMonth ? rng(c.ordersPerMonth, 1) : <span className="text-[#9a9a95]">МД не покрывает</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </Section>
          )}

          {/* Серийность */}
          {quote.series && (
            <Section title="Эффект серийности" sub="Первая позиция проекта, пересчитанная по количествам. Подготовка распределяется на партию.">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-[#9a9a95]">
                  <th className="pb-1">Количество</th><th className="text-right">H1 партии</th><th className="text-right">H1 на единицу</th>
                  <th className="text-right">Наладка, мин</th><th className="text-right">Материал, м²</th><th className="text-right">Люди, ч</th><th className="text-right">Цена сценария Б</th>
                </tr></thead>
                <tbody>{quote.series.rows.map(r => (
                  <tr key={r.qty} className="border-t border-[#e4e4e0]">
                    <td className="py-1">{r.qty}</td>
                    <td className="text-right">{rng(r.batch, 0, '₽')}</td>
                    <td className="text-right">{rng(r.perUnit, 0, '₽')}</td>
                    <td className="text-right">{rng(r.setupMin, 0)}</td>
                    <td className="text-right">{rng(r.materialM2, 2)}</td>
                    <td className="text-right">{hours(r.labourMin)}</td>
                    <td className="text-right">{rng(r.priceB, 0, '₽')}</td>
                  </tr>
                ))}</tbody>
              </table>
            </Section>
          )}

          {/* 9. Сравнение */}
          <Section title="9. Сравнение с действующим калькулятором" sub="Слева — действующая модель на тех же входных данных, её ставки и прайс не менялись.">
            {!money?.legacyCompare && <p className="text-sm text-[#9a9a95]">Сравнение не посчитано.</p>}
            {money?.legacyCompare && (
              <table className="w-full text-xs">
                <thead><tr className="text-left text-[#9a9a95]">
                  <th className="pb-1">Показатель</th><th className="text-right">Действующая</th><th className="text-right">Экспериментальная</th><th className="text-right">Отклонение</th><th>Примечание</th>
                </tr></thead>
                <tbody>{money.legacyCompare.map((r, i) => {
                  const dev = r.legacy != null && r.lab ? r.lab.lo - r.legacy : null
                  const absent = r.legacy == null && !r.lab
                  const devPct = dev != null && r.legacy ? dev / r.legacy * 100 : null
                  return (
                    <tr key={i} className="border-t border-[#e4e4e0]">
                      <td className="py-1">{r.label}</td>
                      <td className="text-right">{r.legacy == null ? <span className="text-[#9a9a95]">{absent ? '—' : 'отсутствует'}</span> : `${nf(r.legacy)} ₽`}</td>
                      <td className="text-right">{r.lab ? rng(r.lab, 0, '₽') : <span className="text-[#9a9a95]">{absent ? '—' : 'разнесено иначе'}</span>}</td>
                      <td className="text-right">{dev == null ? '—' : `${nf(dev)} ₽${devPct == null ? '' : ` · ${nf(devPct, 1)} %`}`}</td>
                      <td className="text-[#9a9a95]">{r.note}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            )}
            {legacy && (
              <ul className="mt-2 space-y-0.5 text-xs text-[#9a9a95]">
                {legacy.absent.map(a => <li key={a}>• действующая модель: {a}</li>)}
              </ul>
            )}
          </Section>

          {/* Неучтённое */}
          <Section title="Что в расчёт не вошло" sub="Пропуск печатается, а не заменяется нулём: неполный расчёт не является согласованной ценой.">
            {quote.missing.length === 0 && <p className="text-sm text-[#9a9a95]">Пропусков нет.</p>}
            <ul className="space-y-0.5 text-xs text-[#111110]">
              {quote.missing.map((m, i) => <li key={i}>• {m.what}{m.partKey ? ` (${m.partKey})` : ''}</li>)}
            </ul>
            {notes.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-amber-700">{notes.map(n => <li key={n}>• {n}</li>)}</ul>
            )}
          </Section>
        </>
      )}

      {/* Варианты */}
      {variants.length > 0 && (
        <Section title="Сохранённые варианты" sub="Снимок входа и результата: правка справочника их не меняет.">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-[#9a9a95]"><th className="pb-1">Вариант</th><th>Посчитан</th><th>Нормы</th><th /></tr></thead>
            <tbody>{variants.map(v => (
              <tr key={v.id} className="border-t border-[#e4e4e0]">
                <td className="py-1">{v.label}{v.note ? ` — ${v.note}` : ''}</td>
                <td>{v.computedAt.slice(0, 16).replace('T', ' ')}</td>
                <td className="text-[#9a9a95]">{v.techStamp}{v.financeStamp ? ` · ${v.financeStamp}` : ''}</td>
                <td className="text-right">
                  <button className="text-xs text-[#111110] underline" onClick={() => { setP({ ...v.input, id: p.id, title: p.title }); setQuote(null); setMsg(`Вход варианта «${v.label}» подставлен в редактор. Нажмите «Рассчитать» — это будет новый расчёт.`) }}>
                    подставить вход
                  </button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </Section>
      )}
    </div>
  )
}

function Row({ label: l, v, bold, muted }: { label: string; v: Range; bold?: boolean; muted?: boolean }) {
  return (
    <tr className={`border-t border-[#e4e4e0] ${bold ? 'font-semibold' : ''}`}>
      <td className={`py-1 ${muted ? 'text-[#9a9a95]' : 'text-[#111110]'}`}>{l}</td>
      <td className="py-1 text-right">{rng(v, 0, '₽')}</td>
    </tr>
  )
}
