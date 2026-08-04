'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  computeRailing, STANDARD_STEP,
  type RailingSegment, type RailingShape, type RailingFixing,
} from '@/lib/railingCalculator'
import { loadGlassMatrix, getMatrixNames, getAvailableMm, getMatrixPrice, type GlassMatrixRow } from '@/lib/glassMatrix'
import { calcFinancialModel } from '@/lib/pricing/financialModel'

const TAX_PERCENT = 12  // канонический налог для всех продуктов (PROJECT_RULES)

const fmt = (n: number) => n.toLocaleString('ru-RU') + ' ₽'
const fmt2 = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

type SegRow = { id: number; name: string; span: string; shape: RailingShape }

type Saved = {
  rows?: SegRow[]; height?: string; fixing?: RailingFixing; maxPanel?: string
  tread?: string; riser?: string; sheetW?: string; sheetH?: string; margin?: string
  material?: string; mm?: number
}
function loadSaved(): Saved {
  try { return JSON.parse(localStorage.getItem('mglass_railing') ?? 'null') ?? {} } catch { return {} }
}

const DEFAULT_ROWS: SegRow[] = [
  { id: 1, name: '1 этаж',  span: '2670', shape: 'raked' },
  { id: 2, name: '1→2 этаж', span: '3020', shape: 'raked' },
]

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-[11px] text-[#9a9a95] mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-[#9a9a95] mt-0.5">{hint}</span>}
    </label>
  )
}

const inputCls = 'w-full h-9 px-2.5 rounded-lg border border-[#e4e4e0] bg-white text-sm text-[#111110] focus:border-[#111110] outline-none'

export default function RailingCalculatorPage() {
  const saved = typeof window !== 'undefined' ? loadSaved() : {}
  const [rows, setRows]         = useState<SegRow[]>(saved.rows?.length ? saved.rows : DEFAULT_ROWS)
  const [height, setHeight]     = useState(saved.height ?? '1100')
  const [fixing, setFixing]     = useState<RailingFixing>(saved.fixing ?? 'points')
  const [maxPanel, setMaxPanel] = useState(saved.maxPanel ?? '1200')
  const [tread, setTread]       = useState(saved.tread ?? String(STANDARD_STEP.tread))
  const [riser, setRiser]       = useState(saved.riser ?? String(STANDARD_STEP.riser))
  const [sheetW, setSheetW]     = useState(saved.sheetW ?? '3210')
  const [sheetH, setSheetH]     = useState(saved.sheetH ?? '2250')
  const [margin, setMargin]     = useState(saved.margin ?? '40')

  const [matrix, setMatrix]     = useState<GlassMatrixRow[]>([])
  const [material, setMaterial] = useState<string>(saved.material ?? '')
  const [mm, setMm]             = useState<number>(saved.mm ?? 10)
  const [copied, setCopied]     = useState(false)

  useEffect(() => {
    loadGlassMatrix().then(rowsM => {
      setMatrix(rowsM)
      const names = getMatrixNames(rowsM, 'cost', 'glass')
      setMaterial(prev => prev || names[0] || '')
    }).catch(() => {})
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('mglass_railing', JSON.stringify({
        rows, height, fixing, maxPanel, tread, riser, sheetW, sheetH, margin, material, mm,
      }))
    } catch {}
  }, [rows, height, fixing, maxPanel, tread, riser, sheetW, sheetH, margin, material, mm])

  const materialNames = getMatrixNames(matrix, 'cost', 'glass')
  const availableMm   = material ? getAvailableMm(matrix, material, 'cost', 'glass') : []
  const costPerM2     = material ? (getMatrixPrice(matrix, material, mm, 'cost', 'glass') ?? 0) : 0

  const num = (s: string, min = 0) => { const n = parseFloat(s.replace(',', '.')); return Number.isFinite(n) && n >= min ? n : 0 }

  const result = useMemo(() => {
    const segments: RailingSegment[] = rows
      .filter(r => num(r.span) > 0)
      .map(r => ({ name: r.name || 'Пролёт', spanMm: num(r.span), shape: r.shape }))
    if (!segments.length) return null
    return computeRailing(segments, {
      heightMm: num(height, 1) || 1100,
      thicknessMm: mm,
      materialName: material || 'Стекло',
      fixing,
      maxPanelWidthMm: num(maxPanel, 1) || 1200,
      step: { tread: num(tread, 1) || STANDARD_STEP.tread, riser: num(riser, 1) || STANDARD_STEP.riser },
      sheet: { width: num(sheetW, 1) || 3210, height: num(sheetH, 1) || 2250 },
      costPerM2,
    })
  }, [rows, height, mm, material, fixing, maxPanel, tread, riser, sheetW, sheetH, costPerM2])

  const directCost = result ? result.usage.reduce((a, u) => a + u.honestCost, 0) : 0
  const finance = directCost > 0
    ? calcFinancialModel({ directCost, marginPercent: num(margin), taxPercent: TAX_PERCENT })
    : null

  function addRow() {
    setRows(r => [...r, { id: Math.max(0, ...r.map(x => x.id)) + 1, name: `Пролёт ${r.length + 1}`, span: '', shape: 'raked' }])
  }
  function delRow(id: number) { setRows(r => r.filter(x => x.id !== id)) }
  function patchRow(id: number, patch: Partial<SegRow>) { setRows(r => r.map(x => x.id === id ? { ...x, ...patch } : x)) }

  function copySummary() {
    if (!result) return
    const L: string[] = []
    L.push(`Лестничное ограждение — расчёт`)
    L.push(`Стекло: ${material} ${mm} мм · высота ${height} мм · крепление: ${fixingLabel(fixing)}`)
    L.push(`Ступень: проступь ${tread} / подступёнок ${riser} мм · скат ${result.slope.angleDeg}°`)
    L.push('')
    for (const s of result.segments) {
      L.push(`${s.name}: ${s.spanMm} мм, ${s.steps} ступ., ${s.panelCount}×${Math.round(s.panelWidthMm)} мм — нетто ${fmt2(s.netM2)} м², заготовки ${fmt2(s.blankM2)} м²`)
    }
    L.push('')
    L.push(`Погонаж: ${result.spanTotalM} м (гориз.) / ${result.alongSlopeTotalM} м по скату`)
    L.push(`Чистое стекло: ${result.netM2} м² · заготовки: ${result.blankM2} м²`)
    L.push(`Лист ${result.sheet.width}×${result.sheet.height}: ${result.sheetsNeeded} шт`)
    L.push(`Себестоимость: ${fmt(directCost)}`)
    if (finance) L.push(`Цена клиенту: ${fmt(finance.finalPrice)} (маржа ${margin}%, налог ${TAX_PERCENT}%)`)
    navigator.clipboard?.writeText(L.join('\n')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  return (
    <div className="min-h-screen bg-[#f5f5f3] text-[#111110]">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <Link href="/calculations" className="text-xs text-[#9a9a95] hover:text-[#111110]">← Калькуляторы</Link>
            <h1 className="text-xl font-semibold mt-1">Лестничное ограждение</h1>
          </div>
          <button onClick={copySummary} disabled={!result}
            className="h-9 px-3 rounded-lg border border-[#e4e4e0] bg-white text-sm hover:border-[#111110] disabled:opacity-40">
            {copied ? '✓ Скопировано' : 'Копировать расчёт'}
          </button>
        </div>

        <div className="grid lg:grid-cols-[1fr_380px] gap-4 items-start">
          {/* Левая колонка — пролёты */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-[#e4e4e0] bg-white p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium">Пролёты</h2>
                <button onClick={addRow} className="h-8 px-3 rounded-lg bg-[#111110] text-white text-xs hover:opacity-90">+ Пролёт</button>
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_100px_130px_90px_32px] gap-2 text-[10px] text-[#9a9a95] px-1">
                  <span>Название</span><span>Длина, мм</span><span>Тип</span><span>Ступеней</span><span></span>
                </div>
                {rows.map(r => {
                  const span = num(r.span)
                  const steps = span > 0 ? Math.max(1, Math.round(span / (num(tread, 1) || STANDARD_STEP.tread))) : 0
                  return (
                    <div key={r.id} className="grid grid-cols-[1fr_100px_130px_90px_32px] gap-2 items-center">
                      <input value={r.name} onChange={e => patchRow(r.id, { name: e.target.value })} className={inputCls} placeholder="Пролёт" />
                      <input value={r.span} onChange={e => patchRow(r.id, { span: e.target.value })} className={inputCls} inputMode="numeric" placeholder="2670" />
                      <select value={r.shape} onChange={e => patchRow(r.id, { shape: e.target.value as RailingShape })} className={inputCls}>
                        <option value="raked">Наклонное</option>
                        <option value="rectangular">Прямое</option>
                      </select>
                      <span className="text-sm text-[#9a9a95] text-center tabular-nums">{steps || '—'}</span>
                      <button onClick={() => delRow(r.id)} className="h-9 w-8 rounded-lg border border-[#e4e4e0] text-[#9a9a95] hover:border-red-300 hover:text-red-500">×</button>
                    </div>
                  )
                })}
              </div>
              <p className="text-[10px] text-[#9a9a95] mt-2">Для лестницы длина — горизонтальная проекция пролёта (сумма проступей). Ступени считаются автоматически.</p>
            </div>

            {/* Результат */}
            {result && (
              <div className="rounded-2xl border border-[#e4e4e0] bg-white p-4">
                <h2 className="text-sm font-medium mb-3">Раскрой и расход</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] text-[#9a9a95] border-b border-[#e4e4e0]">
                        <th className="text-left font-normal py-1.5">Пролёт</th>
                        <th className="text-right font-normal">Ступ.</th>
                        <th className="text-right font-normal">Полотен</th>
                        <th className="text-right font-normal">Ширина</th>
                        <th className="text-right font-normal">Нетто, м²</th>
                        <th className="text-right font-normal">Заготовки, м²</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {result.segments.map((s, i) => (
                        <tr key={i} className="border-b border-[#f0f0ee]">
                          <td className="py-1.5">{s.name}</td>
                          <td className="text-right">{s.steps}</td>
                          <td className="text-right">{s.panelCount}</td>
                          <td className="text-right">{Math.round(s.panelWidthMm)}</td>
                          <td className="text-right">{fmt2(s.netM2)}</td>
                          <td className="text-right">{fmt2(s.blankM2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-medium tabular-nums">
                        <td className="py-2">Итого</td>
                        <td></td><td></td><td></td>
                        <td className="text-right">{fmt2(result.netM2)}</td>
                        <td className="text-right">{fmt2(result.blankM2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                  <Stat label="Погонаж (гориз.)" value={`${result.spanTotalM} м`} />
                  <Stat label="По скату" value={`${result.alongSlopeTotalM} м`} />
                  <Stat label={`Листов ${result.sheet.width}×${result.sheet.height}`} value={String(result.sheetsNeeded)} />
                  <Stat label="Обрез ската" value={`${fmt2(result.rakedWasteM2)} м²`} />
                </div>

                <div className="mt-4 pt-3 border-t border-[#e4e4e0]">
                  <p className="text-[11px] text-[#9a9a95] mb-2">На 1 погонный метр пролёта</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Stat label="Ступеней" value={String(result.perMeter.stepsPerM)} />
                    <Stat label="Чистого стекла" value={`${result.perMeter.netM2PerM} м²`} />
                    <Stat label="Заготовок" value={`${result.perMeter.blankM2PerM} м²`} />
                    <Stat label="Стекла по скату" value={`${result.perMeter.alongSlopePerM} м`} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Правая колонка — параметры + цена */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-[#e4e4e0] bg-white p-4 space-y-3">
              <h2 className="text-sm font-medium">Параметры</h2>
              <Field label="Стекло">
                <select value={material} onChange={e => setMaterial(e.target.value)} className={inputCls}>
                  {materialNames.length === 0 && <option value="">— загрузка —</option>}
                  {materialNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Толщина, мм">
                  <select value={mm} onChange={e => setMm(parseInt(e.target.value))} className={inputCls}>
                    {(availableMm.length ? availableMm : [mm]).map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Высота, мм"><input value={height} onChange={e => setHeight(e.target.value)} className={inputCls} inputMode="numeric" /></Field>
              </div>
              <Field label="Крепление">
                <select value={fixing} onChange={e => setFixing(e.target.value as RailingFixing)} className={inputCls}>
                  <option value="points">На точках</option>
                  <option value="posts">На стойках</option>
                  <option value="profile">Зажимной профиль</option>
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Макс. ширина полотна"><input value={maxPanel} onChange={e => setMaxPanel(e.target.value)} className={inputCls} inputMode="numeric" /></Field>
                <Field label="Себестоимость стекла" hint="₽/м² из матрицы">
                  <div className={`${inputCls} flex items-center text-[#9a9a95]`}>{costPerM2 ? fmt(costPerM2) : '—'}</div>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Проступь, мм"><input value={tread} onChange={e => setTread(e.target.value)} className={inputCls} inputMode="numeric" /></Field>
                <Field label="Подступёнок, мм"><input value={riser} onChange={e => setRiser(e.target.value)} className={inputCls} inputMode="numeric" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Лист, ширина"><input value={sheetW} onChange={e => setSheetW(e.target.value)} className={inputCls} inputMode="numeric" /></Field>
                <Field label="Лист, высота"><input value={sheetH} onChange={e => setSheetH(e.target.value)} className={inputCls} inputMode="numeric" /></Field>
              </div>
            </div>

            <div className="rounded-2xl border border-[#e4e4e0] bg-white p-4 space-y-3">
              <h2 className="text-sm font-medium">Стоимость</h2>
              <Field label="Маржа, %"><input value={margin} onChange={e => setMargin(e.target.value)} className={inputCls} inputMode="numeric" /></Field>
              <div className="space-y-1.5 pt-1">
                <Row label="Себестоимость стекла" value={fmt(directCost)} />
                {finance && <>
                  <Row label={`Налог ${TAX_PERCENT}%`} value={fmt(finance.taxAmount)} muted />
                  <Row label={`Маржа ${margin}%`} value={fmt(finance.marginAmount)} muted />
                  <div className="flex justify-between items-center pt-2 border-t border-[#e4e4e0]">
                    <span className="text-sm font-medium">Цена клиенту</span>
                    <span className="text-lg font-semibold">{fmt(finance.finalPrice)}</span>
                  </div>
                </>}
              </div>
              <p className="text-[10px] text-[#9a9a95]">Только стекло. Крепёж, работы, доставка — отдельно. Цена = себестоимость / (1 − маржа − налог).</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function fixingLabel(f: RailingFixing) {
  return f === 'points' ? 'на точках' : f === 'posts' ? 'на стойках' : 'зажимной профиль'
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#f5f5f3] px-3 py-2">
      <p className="text-[10px] text-[#9a9a95] leading-tight">{label}</p>
      <p className="text-sm font-medium mt-0.5 tabular-nums">{value}</p>
    </div>
  )
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className={muted ? 'text-[#9a9a95]' : ''}>{label}</span>
      <span className={`tabular-nums ${muted ? 'text-[#9a9a95]' : ''}`}>{value}</span>
    </div>
  )
}
