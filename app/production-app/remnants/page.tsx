'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import ProductionTabs from '@/components/ProductionTabs'
import { remnantError, remnantM2, stockSummary, thresholdLabel, type Thresholds } from '@/lib/production/remnants'
import { mskDateTime } from '@/lib/time'

// Остатки листа (Э6.3). Мастер резки: взял лист → нарезал → «Закрыл лист» → записал куски,
// которые идут на стеллаж. Остаток — от 400×800 мм, меньше — полоса в отход. Код «ОС-12»
// пишется маркером на стекле. Срок хранения пока не задаётся (решение владельца 15.09).

type Material = { id: number; name: string; thickness: number; sheet_width: number | null; sheet_height: number | null; pattern_direction: string | null }
type Remnant = { id: number; code: string; material_id: number | null; material_name: string; thickness: number; width_mm: number; height_mm: number; location: string | null; status: string; created_by_name: string | null; created_at: string }
type Data = { remnants: Remnant[]; materials: Material[]; thresholds: Thresholds; locations: string[]; canWrite: boolean }
type Row = { w: string; h: string; location: string }

const emptyRow = (location = ''): Row => ({ w: '', h: '', location })
const btn = 'min-h-[44px] px-4 rounded-xl text-[14px] font-semibold transition-colors disabled:opacity-40'
const input = 'min-h-[44px] w-full border border-[#e4e4e0] rounded-xl px-3 text-[16px] bg-white outline-none focus:border-[#111110]'

export default function RemnantsPage() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    const r = await fetch('/api/production/remnants')
    const j = await r.json().catch(() => null)
    if (!r.ok) { setError(j?.error ?? 'Не удалось загрузить'); return }
    setData(j as Data)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  const summary = useMemo(() => stockSummary(data?.remnants ?? []), [data])
  const visible = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (data?.remnants ?? []).filter(r => !s || r.material_name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || (r.location ?? '').toLowerCase().includes(s))
  }, [data, search])

  async function patch(id: number, body: object) {
    const r = await fetch(`/api/production/remnants/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (r.ok) load()
    else alert((await r.json().catch(() => null))?.error ?? 'Не удалось')
  }

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-3 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Остатки листа</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">
          Кусок от {thresholdLabel(data?.thresholds)} мм — на стеллаж, меньше — в отход. Код пишите маркером на стекле.
        </p>
        <ProductionTabs />
      </div>

      <div className="px-4 pt-4 max-w-3xl space-y-3">
        {error && <p className="text-[13px] text-red-600">{error}</p>}

        {data?.canWrite && !open && (
          <button onClick={() => setOpen(true)} className={`${btn} w-full bg-[#111110] text-white hover:bg-[#2a2a28] text-[16px]`}>
            ✂️ Закрыл лист — записать остаток
          </button>
        )}
        {data && open && (
          <CloseSheetForm data={data} onCancel={() => setOpen(false)} onSaved={() => { load() }} />
        )}

        {summary.length > 0 && (
          <div className="bg-white border border-[#e4e4e0] rounded-2xl px-4 py-3">
            <p className="text-[14px] font-bold text-[#111110]">На стеллаже</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {summary.map(s => (
                <button key={s.key} onClick={() => setSearch(s.material)}
                  className="text-[12px] border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 hover:border-[#111110]">
                  {s.material} {s.thickness} мм · <b>{s.count}</b> шт · {s.m2.toLocaleString('ru-RU')} м²
                </button>
              ))}
            </div>
          </div>
        )}

        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск: материал, код ОС-…, место" className={input} />

        {!data ? (
          <p className="text-[13px] text-[#9a9a95]">Загрузка…</p>
        ) : visible.length === 0 ? (
          <div className="bg-white border border-[#e4e4e0] rounded-2xl px-4 py-8 text-center text-[13px] text-[#9a9a95]">
            {data.remnants.length === 0 ? 'Остатков пока нет. После резки нажмите «Закрыл лист».' : 'Ничего не найдено'}
          </div>
        ) : (
          <div className="bg-white border border-[#e4e4e0] rounded-2xl divide-y divide-[#f0f0ec]">
            {visible.map(r => (
              <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-[#111110]">
                    <span className="font-mono">{r.code}</span> · {r.width_mm}×{r.height_mm} мм
                    <span className="text-[12px] font-normal text-[#9a9a95]"> · {remnantM2(r.width_mm, r.height_mm).toLocaleString('ru-RU')} м²</span>
                  </p>
                  <p className="text-[12px] text-[#6b6b66] truncate">{r.material_name} {Number(r.thickness)} мм · место: {r.location || '—'}</p>
                  <p className="text-[11px] text-[#9a9a95]">{r.created_by_name ?? '—'} · {mskDateTime(r.created_at)}</p>
                </div>
                {data.canWrite && (
                  <div className="flex gap-2">
                    <button onClick={() => { const loc = prompt('Место на стеллаже', r.location ?? ''); if (loc !== null) patch(r.id, { location: loc }) }}
                      className={`${btn} border border-[#e4e4e0] text-[#4b4b47] hover:border-[#111110] text-[13px]`}>Место</button>
                    <button onClick={() => { if (confirm(`${r.code}: списать в лом?`)) patch(r.id, { status: 'scrapped' }) }}
                      className={`${btn} border border-red-200 text-red-600 hover:bg-red-50 text-[13px]`}>В лом</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CloseSheetForm({ data, onCancel, onSaved }: { data: Data; onCancel: () => void; onSaved: () => void }) {
  const [matQuery, setMatQuery] = useState('')
  const [materialId, setMaterialId] = useState<number | null>(null)
  const [source, setSource] = useState<'sheet' | 'remnant'>('sheet')
  const [remnantId, setRemnantId] = useState<number | null>(null)
  const [rows, setRows] = useState<Row[]>([emptyRow(data.locations[0] ?? '')])
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ codes: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const material = data.materials.find(m => m.id === materialId) ?? null
  const matches = useMemo(() => {
    const s = matQuery.trim().toLowerCase()
    return s ? data.materials.filter(m => `${m.name} ${m.thickness}`.toLowerCase().includes(s)).slice(0, 8) : []
  }, [matQuery, data.materials])
  const stockOfMaterial = material
    ? data.remnants.filter(r => r.material_name === material.name && Number(r.thickness) === Number(material.thickness))
    : []
  const taken = stockOfMaterial.find(r => r.id === remnantId) ?? null
  const sheet = taken
    ? { w: taken.width_mm, h: taken.height_mm }
    : { w: Number(material?.sheet_width) || 3210, h: Number(material?.sheet_height) || 2250 }

  const filled = rows.filter(r => r.w || r.h)
  const rowErrors = filled.map(r => remnantError({ w: Number(r.w), h: Number(r.h) }, sheet, data.thresholds))
  const canSave = !!material && (source === 'sheet' || !!taken) && rowErrors.every(e => e == null)

  async function save(noRemnant: boolean) {
    if (!material) return
    setSaving(true); setError(null)
    try {
      const r = await fetch('/api/production/remnants', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materialId: material.id, source, remnantId: source === 'remnant' ? remnantId : undefined,
          remnants: noRemnant ? [] : filled.map(x => ({ w: Number(x.w), h: Number(x.h), location: x.location })),
        }),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok) { setError(j?.error ?? 'Не удалось записать'); return }
      setResult({ codes: j.codes ?? [] })
      onSaved()
    } finally { setSaving(false) }
  }

  if (result) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-4 space-y-2">
        <p className="text-[15px] font-bold text-emerald-900">Лист записан</p>
        {result.codes.length > 0 ? (
          <>
            <p className="text-[13px] text-emerald-800">Напишите маркером на стекле:</p>
            {result.codes.map(c => <p key={c} className="text-[22px] font-bold font-mono text-emerald-900">{c}</p>)}
          </>
        ) : <p className="text-[13px] text-emerald-800">Остатка нет — всё ушло в детали и отход.</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={() => { setResult(null); setRows([emptyRow(rows[0]?.location ?? '')]); setSource('sheet'); setRemnantId(null) }}
            className={`${btn} bg-[#111110] text-white`}>Следующий лист</button>
          <button onClick={onCancel} className={`${btn} border border-emerald-300 text-emerald-900`}>Готово</button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white border-2 border-[#111110] rounded-2xl px-4 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-bold text-[#111110]">Закрыл лист</p>
        <button onClick={onCancel} className="text-[13px] text-[#9a9a95] min-h-[44px] px-2">Отмена</button>
      </div>

      {/* 1. Материал */}
      <div>
        <p className="text-[12px] font-semibold text-[#6b6b66] mb-1">1. Какое стекло</p>
        {material ? (
          <div className="flex items-center justify-between gap-2 border border-[#e4e4e0] rounded-xl px-3 min-h-[44px]">
            <span className="text-[14px] text-[#111110]">{material.name} {Number(material.thickness)} мм{material.pattern_direction && material.pattern_direction !== 'none' ? ' · полоса вдоль длины' : ''}</span>
            <button onClick={() => { setMaterialId(null); setRemnantId(null); setSource('sheet') }} className="text-[12px] text-blue-600">сменить</button>
          </div>
        ) : (
          <>
            <input value={matQuery} onChange={e => setMatQuery(e.target.value)} placeholder="Начните вводить: мору, прозрачное 8…" className={input} autoFocus />
            {matches.length > 0 && (
              <div className="mt-1 border border-[#e4e4e0] rounded-xl divide-y divide-[#f0f0ec] overflow-hidden">
                {matches.map(m => (
                  <button key={m.id} onClick={() => { setMaterialId(m.id); setMatQuery('') }}
                    className="w-full text-left px-3 min-h-[44px] text-[14px] hover:bg-[#fafaf9]">{m.name} {Number(m.thickness)} мм</button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 2. Из чего резал */}
      {material && (
        <div>
          <p className="text-[12px] font-semibold text-[#6b6b66] mb-1">2. Из чего резал</p>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => { setSource('sheet'); setRemnantId(null) }}
              className={`${btn} border ${source === 'sheet' ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#4b4b47]'}`}>
              Новый лист {Number(material.sheet_width) || 3210}×{Number(material.sheet_height) || 2250}
            </button>
            <button onClick={() => setSource('remnant')} disabled={stockOfMaterial.length === 0}
              className={`${btn} border ${source === 'remnant' ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#4b4b47]'}`}>
              Остаток со стеллажа{stockOfMaterial.length ? ` (${stockOfMaterial.length})` : ' — нет'}
            </button>
          </div>
          {source === 'remnant' && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {stockOfMaterial.map(r => (
                <button key={r.id} onClick={() => setRemnantId(r.id)}
                  className={`min-h-[44px] px-3 rounded-xl border text-[13px] ${remnantId === r.id ? 'border-[#111110] bg-[#f5f5f3] font-semibold' : 'border-[#e4e4e0]'}`}>
                  <span className="font-mono">{r.code}</span> · {r.width_mm}×{r.height_mm}{r.location ? ` · ${r.location}` : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. Что осталось */}
      {material && (source === 'sheet' || taken) && (
        <div>
          <p className="text-[12px] font-semibold text-[#6b6b66] mb-1">3. Что осталось — от {thresholdLabel(data.thresholds)} мм</p>
          <datalist id="remnant-locations">{data.locations.map(l => <option key={l} value={l} />)}</datalist>
          <div className="space-y-2">
            {rows.map((r, i) => {
              const err = (r.w || r.h) ? remnantError({ w: Number(r.w), h: Number(r.h) }, sheet, data.thresholds) : null
              const set = (k: keyof Row, v: string) => setRows(rs => rs.map((x, j) => j === i ? { ...x, [k]: v } : x))
              return (
                <div key={i}>
                  <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
                    <input inputMode="numeric" value={r.w} onChange={e => set('w', e.target.value.replace(/\D/g, ''))} placeholder="ширина, мм" className={input} />
                    <span className="text-[#9a9a95]">×</span>
                    <input inputMode="numeric" value={r.h} onChange={e => set('h', e.target.value.replace(/\D/g, ''))} placeholder="высота, мм" className={input} />
                  </div>
                  <input list="remnant-locations" value={r.location} onChange={e => set('location', e.target.value)} placeholder="место на стеллаже (например С-1)" className={`${input} mt-2`} />
                  {err && <p className="text-[12px] text-amber-700 mt-1">{err}</p>}
                </div>
              )
            })}
          </div>
          {rows.length < 10 && (
            <button onClick={() => setRows(rs => [...rs, emptyRow(rs[rs.length - 1]?.location ?? '')])}
              className="text-[13px] text-blue-600 min-h-[44px]">+ ещё кусок</button>
          )}
        </div>
      )}

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {material && (source === 'sheet' || taken) && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => save(false)} disabled={!canSave || filled.length === 0 || saving}
            className={`${btn} flex-1 bg-[#111110] text-white hover:bg-[#2a2a28]`}>
            {saving ? '…' : `Сохранить остаток${filled.length > 1 ? ` (${filled.length})` : ''}`}
          </button>
          <button onClick={() => save(true)} disabled={saving}
            className={`${btn} border border-[#e4e4e0] text-[#4b4b47]`}>Остатка нет</button>
        </div>
      )}
    </div>
  )
}
