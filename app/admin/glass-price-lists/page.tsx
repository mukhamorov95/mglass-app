'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { extractFileGrid, detectPriceDate } from '@/lib/glassPrice/extract'
import { parseGlassPriceGrid, PARSER_VERSION } from '@/lib/glassPrice/parse'
import { MATRIX_THICKNESSES } from '@/lib/glassPrice/applyPlan'
import type { ParsedItem, ParsedTable } from '@/lib/glassPrice/types'

type PriceList = {
  id: string; supplier: string; title: string; price_date: string; status: 'draft' | 'applied' | 'archived'
  file_name: string; file_size: number; notes: string; uploaded_at: string; applied_at: string | null
  items_count: number; applied_cells: number; vat_percent: number
}

type ListItem = {
  id: number; section: string; product: string; variant_code: string
  thickness_mm: number | null; sheet_format: string; price_per_m2: number | null; note: string
}

type LogRow = {
  id: number; matrix_name: string; matrix_category: string; thickness: number
  old_value: number | null; new_value: number | null; product: string; applied_at: string
}

type MappingRow = {
  id?: number; matrix_name: string; matrix_category: 'glass' | 'mirror'; thickness: number
  section: string; product: string; coefficient: number; rounding: number; enabled: boolean
}

type MatrixRow = { name: string; category: 'glass' | 'mirror'; t4: number | null; t5: number | null; t6: number | null; t8: number | null; t10: number | null; t12: number | null }

type Suggestion = { matrix_name: string; matrix_category: 'glass' | 'mirror'; section: string; product: string; score: number; exact: number; matched: number[] }

type PlanChange = {
  matrix_name: string; matrix_category: 'glass' | 'mirror'; thickness: number
  old_value: number | null; new_value: number; product: string; section: string
  price_per_m2: number; coefficient: number
  sale_price: number | null; margin_before: number | null; margin_after: number | null
}
type Plan = { changes: PlanChange[]; unchanged: number; skips: { matrix_name: string; thickness: number; reason: string; product: string }[]; unmappedProducts: { section: string; product: string }[] }

const CARD = 'bg-white border border-[#e4e4e0] rounded-xl'
const BTN = 'text-[12px] font-medium px-3.5 py-2 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f4] transition-colors whitespace-nowrap disabled:opacity-50'
const BTN_DARK = 'text-[12px] font-medium px-3.5 py-2 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] transition-colors whitespace-nowrap disabled:opacity-50'

const STATUS_LABEL: Record<PriceList['status'], string> = { draft: 'Черновик', applied: 'Действует', archived: 'Архив' }
const STATUS_STYLE: Record<PriceList['status'], string> = {
  draft: 'bg-[#f5f5f3] text-[#6b6b66] border-[#e4e4e0]',
  applied: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  archived: 'bg-[#faf9f7] text-[#9a9a95] border-[#e4e4e0]',
}

function money(v: number | null | undefined) { return v == null ? '—' : v.toLocaleString('ru-RU') }
function pct(v: number | null) { return v == null ? '—' : `${Math.round(v * 100)}%` }
function marginColor(v: number | null) {
  if (v == null) return 'text-[#9a9a95]'
  if (v < 0.25) return 'text-red-600'
  if (v < 0.35) return 'text-amber-600'
  return 'text-emerald-600'
}
function dateRu(s: string | null) { return s ? new Date(s).toLocaleDateString('ru-RU') : '—' }

export default function GlassPriceListsPage() {
  const [lists, setLists] = useState<PriceList[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/glass-price-lists')
    const data = res.ok ? await res.json() : []
    setLists(data)
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  return (
    <div className="p-6 max-w-[1400px]">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#111110] text-white text-[13px] px-4 py-2.5 rounded-lg shadow-lg">{toast}</div>
      )}

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">Прайсы поставщика — стекло и зеркало</h1>
          <p className="text-[13px] text-[#8a8a85] mt-0.5">
            Загрузи новый прайс — система разберёт его, покажет, что изменится в себестоимости, и применит только после подтверждения.
            Старые версии и их файлы остаются здесь навсегда.
          </p>
        </div>
        <a href="/admin/glass-prices" className={BTN}>← Справочник «Стекло»</a>
      </div>

      <UploadPanel onDone={(msg, id) => { setToast(msg); load(); if (id) setOpenId(id) }} />

      <div className={`${CARD} overflow-hidden`}>
        <div className="px-5 py-3.5 border-b border-[#e4e4e0] flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-[#111110]">Версии прайса</h2>
          <span className="text-[12px] text-[#9a9a95]">{lists.length}</span>
        </div>
        {loading ? (
          <div className="text-[13px] text-[#8a8a85] py-12 text-center">Загрузка…</div>
        ) : lists.length === 0 ? (
          <div className="text-[13px] text-[#8a8a85] py-12 text-center">Пока ни одного прайса — загрузи первый файл выше.</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-[#faf9f7] text-[12px] text-[#6b6b66]">
              <tr>
                <th className="text-left font-medium px-5 py-2.5">Дата прайса</th>
                <th className="text-left font-medium px-3 py-2.5">Название</th>
                <th className="text-left font-medium px-3 py-2.5">Статус</th>
                <th className="text-right font-medium px-3 py-2.5">Строк</th>
                <th className="text-right font-medium px-3 py-2.5">Изменено ячеек</th>
                <th className="text-left font-medium px-3 py-2.5">Загружен</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {lists.map(l => (
                <tr key={l.id} className="border-t border-[#f0f0ec] hover:bg-[#faf9f7]">
                  <td className="px-5 py-2.5 font-medium text-[#111110]">{dateRu(l.price_date)}</td>
                  <td className="px-3 py-2.5 text-[#6b6b66]">{l.title || l.file_name}</td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[11px] px-2 py-0.5 rounded border ${STATUS_STYLE[l.status]}`}>{STATUS_LABEL[l.status]}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-[#6b6b66]">{l.items_count}</td>
                  <td className="px-3 py-2.5 text-right text-[#6b6b66]">{l.applied_cells || '—'}</td>
                  <td className="px-3 py-2.5 text-[#9a9a95]">{dateRu(l.uploaded_at)}</td>
                  <td className="px-5 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => setOpenId(openId === l.id ? null : l.id)} className={BTN}>
                      {openId === l.id ? 'Свернуть' : 'Открыть'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {openId && (
        <ListDetail
          key={openId}
          listId={openId}
          onToast={setToast}
          onChanged={load}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}

function UploadPanel({ onDone }: { onDone: (msg: string, id?: string) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<{ tables: ParsedTable[]; items: ParsedItem[]; warnings: string[] } | null>(null)
  const [priceDate, setPriceDate] = useState('')
  const [title, setTitle] = useState('')
  const [vat, setVat] = useState('22')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  async function onFile(f: File) {
    setBusy(true); setError(null); setParsed(null); setFile(f)
    try {
      const { grid } = await extractFileGrid(f)
      const res = parseGlassPriceGrid(grid)
      setParsed(res)
      setPriceDate(detectPriceDate(grid, f.name) ?? '')
      setTitle(f.name.replace(/\.[^.]+$/, ''))
      if (res.items.length === 0) setError('В файле не нашлось ни одной цены — проверь, что это прайс, а не скан.')
    } catch (e) {
      setError('Не удалось прочитать файл: ' + (e instanceof Error ? e.message : ''))
    } finally { setBusy(false) }
  }

  async function save() {
    if (!file || !parsed || !priceDate) return
    setBusy(true); setError(null)
    try {
      const fd = new FormData()
      fd.set('file', file)
      fd.set('price_date', priceDate)
      fd.set('title', title)
      fd.set('vat_percent', vat)
      fd.set('items', JSON.stringify(parsed.items))
      fd.set('parse_meta', JSON.stringify({ parser: PARSER_VERSION, tables: parsed.tables.length, warnings: parsed.warnings.slice(0, 20) }))
      const res = await fetch('/api/admin/glass-price-lists', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Ошибка загрузки')
      onDone(`Прайс сохранён: ${parsed.items.length} позиций`, json.id)
      setFile(null); setParsed(null); setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <div className="mb-5">
        <button onClick={() => setOpen(true)} className={BTN_DARK}>＋ Загрузить новый прайс</button>
      </div>
    )
  }

  return (
    <div className={`${CARD} p-5 mb-5`}>
      <div className="flex items-start justify-between mb-4">
        <h2 className="text-[14px] font-semibold text-[#111110]">Новый прайс поставщика</h2>
        <button onClick={() => { setOpen(false); setFile(null); setParsed(null) }} className="text-[12px] text-[#9a9a95] hover:text-[#111110]">Закрыть</button>
      </div>

      <label className="block border border-dashed border-[#d8d8d4] rounded-lg px-4 py-6 text-center cursor-pointer hover:bg-[#faf9f7]">
        <input type="file" accept=".pdf,.xlsx,.xls" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
        <div className="text-[13px] text-[#111110] font-medium">{file ? file.name : 'Выбрать файл прайса (PDF или Excel)'}</div>
        <div className="text-[12px] text-[#9a9a95] mt-1">Файл сохранится целиком — его всегда можно будет открыть из истории</div>
      </label>

      {busy && <div className="text-[12px] text-[#8a8a85] mt-3">Читаю файл…</div>}
      {error && <div className="text-[12px] text-red-600 mt-3">{error}</div>}

      {parsed && parsed.items.length > 0 && (
        <>
          <div className="grid grid-cols-4 gap-3 mt-4">
            <label className="text-[12px] text-[#6b6b66]">Дата прайса
              <input type="date" value={priceDate} onChange={e => setPriceDate(e.target.value)}
                className="mt-1 w-full border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] text-[#111110]" />
            </label>
            <label className="text-[12px] text-[#6b6b66] col-span-2">Название версии
              <input value={title} onChange={e => setTitle(e.target.value)}
                className="mt-1 w-full border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] text-[#111110]" />
            </label>
            <label className="text-[12px] text-[#6b6b66]">НДС в ценах, %
              <input value={vat} onChange={e => setVat(e.target.value)}
                className="mt-1 w-full border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] text-[#111110]" />
            </label>
          </div>

          <div className="mt-4 text-[12px] text-[#6b6b66]">
            Распознано: <span className="font-medium text-[#111110]">{parsed.items.length}</span> позиций
            в <span className="font-medium text-[#111110]">{parsed.tables.length}</span> таблицах
          </div>
          <div className="mt-3 max-h-[320px] overflow-auto border border-[#f0f0ec] rounded-lg">
            {parsed.tables.map((t, i) => (
              <div key={i} className="border-b border-[#f0f0ec] last:border-0">
                <div className="px-3 py-2 bg-[#faf9f7] text-[12px] font-medium text-[#111110]">
                  {t.section || 'Без секции'} <span className="text-[#9a9a95] font-normal">· стр. {t.page} · {t.columns.join(' | ')}</span>
                </div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {t.rows.map((r, j) => (
                      <tr key={j} className="border-t border-[#f6f6f3]">
                        <td className="px-3 py-1 text-[#6b6b66] w-24">{r.code}{r.thicknessMm ? ' мм' : ''}</td>
                        <td className="px-3 py-1 text-[#6b6b66]">{r.attr}{r.sheetFormat ? ` · ${r.sheetFormat}` : ''}</td>
                        {r.cells.map((c, k) => <td key={k} className="px-3 py-1 text-right text-[#111110] w-24">{money(c)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button onClick={save} disabled={busy || !priceDate} className={BTN_DARK}>Сохранить версию прайса</button>
            <span className="text-[12px] text-[#9a9a95]">Цены в справочнике при этом ещё не меняются — только после подтверждения плана.</span>
          </div>
        </>
      )}
    </div>
  )
}

function ListDetail({ listId, onToast, onChanged, onClose }: {
  listId: string; onToast: (m: string) => void; onChanged: () => void; onClose: () => void
}) {
  const [tab, setTab] = useState<'items' | 'mappings' | 'plan'>('plan')
  const [data, setData] = useState<{ list: PriceList; items: ListItem[]; log: LogRow[] } | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/glass-price-lists/${listId}`)
    setData(res.ok ? await res.json() : null)
  }, [listId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  async function openFile() {
    const res = await fetch(`/api/admin/glass-price-lists/${listId}/file`)
    const json = await res.json()
    if (json.url) window.open(json.url, '_blank')
    else onToast(json.error ?? 'Файл недоступен')
  }

  if (!data) return <div className={`${CARD} p-5 mt-5 text-[13px] text-[#8a8a85]`}>Загрузка версии…</div>

  return (
    <div className={`${CARD} mt-5`}>
      <div className="px-5 py-4 border-b border-[#e4e4e0] flex items-start justify-between">
        <div>
          <div className="text-[15px] font-semibold text-[#111110]">
            {data.list.title || data.list.file_name}
            <span className={`ml-2 text-[11px] px-2 py-0.5 rounded border ${STATUS_STYLE[data.list.status]}`}>{STATUS_LABEL[data.list.status]}</span>
          </div>
          <div className="text-[12px] text-[#9a9a95] mt-0.5">
            Прайс от {dateRu(data.list.price_date)} · загружен {dateRu(data.list.uploaded_at)} · {data.items.length} позиций
            {data.list.applied_at ? ` · применён ${dateRu(data.list.applied_at)}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openFile} className={BTN}>📄 Открыть файл</button>
          <button onClick={onClose} className={BTN}>Свернуть</button>
        </div>
      </div>

      <div className="px-5 pt-4 flex items-center gap-1.5">
        {([['plan', 'Что изменится'], ['mappings', 'Привязки'], ['items', 'Строки прайса']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`text-[12px] font-medium px-3 py-1.5 rounded-lg border transition-colors ${tab === k ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f4]'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="p-5">
        {tab === 'items' && <ItemsTab items={data.items} />}
        {tab === 'mappings' && <MappingsTab listId={listId} supplier={data.list.supplier} items={data.items} onToast={onToast} />}
        {tab === 'plan' && <PlanTab listId={listId} log={data.log} onToast={onToast} onApplied={() => { load(); onChanged() }} />}
      </div>
    </div>
  )
}

function ItemsTab({ items }: { items: ListItem[] }) {
  const bySection = useMemo(() => {
    const map = new Map<string, ListItem[]>()
    for (const i of items) {
      if (!map.has(i.section)) map.set(i.section, [])
      map.get(i.section)!.push(i)
    }
    return [...map.entries()]
  }, [items])

  return (
    <div className="space-y-4">
      {bySection.map(([section, rows]) => (
        <div key={section} className="border border-[#f0f0ec] rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-[#faf9f7] text-[12px] font-medium text-[#111110]">{section || 'Без секции'}</div>
          <table className="w-full text-[12px]">
            <thead className="text-[11px] text-[#9a9a95]">
              <tr>
                <th className="text-left font-medium px-3 py-1.5">Продукт</th>
                <th className="text-left font-medium px-3 py-1.5">Толщина</th>
                <th className="text-left font-medium px-3 py-1.5">Формат листа</th>
                <th className="text-right font-medium px-3 py-1.5">Цена за м², ₽</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-[#f6f6f3]">
                  <td className="px-3 py-1.5 text-[#111110]">{r.product}</td>
                  <td className="px-3 py-1.5 text-[#6b6b66]">{r.thickness_mm ? `${r.thickness_mm} мм` : r.variant_code}</td>
                  <td className="px-3 py-1.5 text-[#9a9a95]">{r.sheet_format || '—'}</td>
                  <td className="px-3 py-1.5 text-right font-medium text-[#111110]">{money(r.price_per_m2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

function MappingsTab({ listId, supplier, items, onToast }: {
  listId: string; supplier: string; items: ListItem[]; onToast: (m: string) => void
}) {
  const [rows, setRows] = useState<MappingRow[]>([])
  const [matrix, setMatrix] = useState<MatrixRow[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [busy, setBusy] = useState(false)

  const products = useMemo(() => {
    const set = new Map<string, { section: string; product: string }>()
    for (const i of items) set.set(`${i.section}|${i.product}`, { section: i.section, product: i.product })
    return [...set.values()]
  }, [items])

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/glass-price-mappings?supplier=${supplier}&suggest_from=${listId}`)
    if (!res.ok) return
    const json = await res.json()
    setMatrix(json.matrixRows ?? [])
    setSuggestions(json.suggestions ?? [])
    const existing: MappingRow[] = (json.mappings ?? []).map((m: MappingRow) => ({ ...m, coefficient: Number(m.coefficient), rounding: Number(m.rounding) }))
    const base: MappingRow[] = (json.matrixRows ?? []).map((r: MatrixRow) => {
      const found = existing.find(e => e.matrix_name === r.name && e.matrix_category === r.category && e.thickness === 0)
      return found ?? { matrix_name: r.name, matrix_category: r.category, thickness: 0, section: '', product: '', coefficient: 1, rounding: 1, enabled: true }
    })
    const overrides = existing.filter(e => e.thickness !== 0)
    setRows([...base, ...overrides])
  }, [listId, supplier])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  function patch(idx: number, p: Partial<MappingRow>) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...p } : r))
  }

  function autoFill() {
    setRows(prev => prev.map(r => {
      if (r.thickness !== 0 || r.product) return r
      const s = suggestions.find(x => x.matrix_name === r.matrix_name && x.matrix_category === r.matrix_category)
      return s ? { ...r, section: s.section, product: s.product } : r
    }))
    onToast('Привязки подобраны по совпадению текущих цен — проверь и сохрани')
  }

  async function save() {
    setBusy(true)
    const payload = rows.filter(r => r.product)
    const res = await fetch('/api/admin/glass-price-mappings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supplier, mappings: payload }),
    })
    const json = await res.json()
    onToast(res.ok ? `Сохранено привязок: ${json.saved}` : (json.error ?? 'Ошибка'))
    setBusy(false)
    if (res.ok) load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12px] text-[#8a8a85] max-w-[720px]">
          Привязка говорит системе, из какой колонки прайса брать себестоимость строки справочника.
          Задаётся один раз — следующий прайс от поставщика применится по ней автоматически.
          Коэффициент — надбавка поверх цены поставщика (доставка, резка, упаковка).
        </p>
        <div className="flex items-center gap-2">
          <button onClick={autoFill} className={BTN}>Подобрать автоматически</button>
          <button onClick={save} disabled={busy} className={BTN_DARK}>Сохранить привязки</button>
        </div>
      </div>

      <table className="w-full text-[12px]">
        <thead className="bg-[#faf9f7] text-[11px] text-[#6b6b66]">
          <tr>
            <th className="text-left font-medium px-3 py-2">Строка справочника</th>
            <th className="text-left font-medium px-3 py-2">Толщина</th>
            <th className="text-left font-medium px-3 py-2">Колонка прайса</th>
            <th className="text-right font-medium px-3 py-2">Коэф.</th>
            <th className="text-right font-medium px-3 py-2">Округл.</th>
            <th className="text-center font-medium px-3 py-2">Вкл.</th>
            <th className="text-left font-medium px-3 py-2">Текущая себестоимость</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            const m = matrix.find(x => x.name === r.matrix_name && x.category === r.matrix_category)
            const s = suggestions.find(x => x.matrix_name === r.matrix_name && x.matrix_category === r.matrix_category)
            return (
              <tr key={`${r.matrix_name}|${r.matrix_category}|${r.thickness}|${idx}`} className="border-t border-[#f0f0ec]">
                <td className="px-3 py-1.5 text-[#111110]">
                  {r.matrix_name}
                  <span className="ml-1.5 text-[10px] text-[#9a9a95]">{r.matrix_category === 'mirror' ? 'зеркало' : 'стекло'}</span>
                </td>
                <td className="px-3 py-1.5">
                  <select value={r.thickness} onChange={e => patch(idx, { thickness: Number(e.target.value) })}
                    className="border border-[#e4e4e0] rounded px-1.5 py-1 text-[12px]">
                    <option value={0}>все</option>
                    {MATRIX_THICKNESSES.map(t => <option key={t} value={t}>{t} мм</option>)}
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  <select value={r.product ? `${r.section}|${r.product}` : ''}
                    onChange={e => {
                      const [section, product] = e.target.value.split('|')
                      patch(idx, { section: section ?? '', product: product ?? '' })
                    }}
                    className="border border-[#e4e4e0] rounded px-1.5 py-1 text-[12px] min-w-[280px]">
                    <option value="">— не привязано —</option>
                    {products.map(p => (
                      <option key={`${p.section}|${p.product}`} value={`${p.section}|${p.product}`}>
                        {p.section ? `${p.section} · ` : ''}{p.product}
                      </option>
                    ))}
                  </select>
                  {!r.product && s && (
                    <span className="ml-2 text-[11px] text-[#9a9a95]">похоже на «{s.product}» ({s.matched.length} совпад.)</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <input value={r.coefficient} onChange={e => patch(idx, { coefficient: Number(e.target.value) || 1 })}
                    className="w-16 text-right border border-[#e4e4e0] rounded px-1.5 py-1 text-[12px]" />
                </td>
                <td className="px-3 py-1.5 text-right">
                  <input value={r.rounding} onChange={e => patch(idx, { rounding: Number(e.target.value) || 1 })}
                    className="w-16 text-right border border-[#e4e4e0] rounded px-1.5 py-1 text-[12px]" />
                </td>
                <td className="px-3 py-1.5 text-center">
                  <input type="checkbox" checked={r.enabled} onChange={e => patch(idx, { enabled: e.target.checked })} />
                </td>
                <td className="px-3 py-1.5 text-[#9a9a95]">
                  {m ? MATRIX_THICKNESSES.map(t => {
                    const v = m[`t${t}` as keyof MatrixRow] as number | null
                    return v ? `${t}:${money(v)}` : null
                  }).filter(Boolean).join('  ') : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PlanTab({ listId, log, onToast, onApplied }: {
  listId: string; log: LogRow[]; onToast: (m: string) => void; onApplied: () => void
}) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [busy, setBusy] = useState(false)
  const [needsSync, setNeedsSync] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/glass-price-lists/${listId}/plan`)
    setPlan(res.ok ? await res.json() : null)
  }, [listId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  async function apply() {
    if (!plan?.changes.length) return
    if (!confirm(`Записать ${plan.changes.length} новых значений себестоимости? Продажные цены не изменятся.`)) return
    setBusy(true)
    const res = await fetch(`/api/admin/glass-price-lists/${listId}/plan`, { method: 'POST' })
    const json = await res.json()
    onToast(res.ok ? `Обновлено ячеек: ${json.applied}` : (json.error ?? 'Ошибка применения'))
    setNeedsSync(Boolean(json.needs_sync))
    setBusy(false)
    load(); onApplied()
  }

  async function sync() {
    setBusy(true)
    const res = await fetch('/api/admin/sync-b2b-materials', { method: 'POST' })
    const json = await res.json()
    onToast(res.ok ? `Синхронизировано материалов: ${json.total}` : (json.error ?? 'Синхронизацию делает владелец'))
    setBusy(false)
    if (res.ok) setNeedsSync(false)
  }

  if (!plan) return <div className="text-[13px] text-[#8a8a85]">Считаю изменения…</div>

  const risky = plan.changes.filter(c => c.margin_after != null && c.margin_after < 0.25)

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[12px] text-[#6b6b66]">
          Изменится ячеек: <span className="font-medium text-[#111110]">{plan.changes.length}</span> ·
          без изменений: {plan.unchanged} ·
          нет цены в прайсе: {plan.skips.filter(s => s.reason === 'no_price').length} ·
          непривязанных колонок прайса: {plan.unmappedProducts.length}
        </div>
        <div className="flex items-center gap-2">
          {needsSync && <button onClick={sync} disabled={busy} className={BTN}>⟳ Синхронизировать в B2B</button>}
          <button onClick={apply} disabled={busy || plan.changes.length === 0} className={BTN_DARK}>
            Применить к себестоимости
          </button>
        </div>
      </div>

      {risky.length > 0 && (
        <div className="mb-3 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          После применения маржа опустится ниже 25% в {risky.length} позициях — проверь продажные цены в справочнике.
        </div>
      )}

      {plan.changes.length === 0 ? (
        <div className="text-[13px] text-[#8a8a85] py-8 text-center border border-[#f0f0ec] rounded-lg">
          Себестоимость менять не нужно — цены прайса совпадают с текущими (или привязки ещё не заданы).
        </div>
      ) : (
        <table className="w-full text-[12px]">
          <thead className="bg-[#faf9f7] text-[11px] text-[#6b6b66]">
            <tr>
              <th className="text-left font-medium px-3 py-2">Строка справочника</th>
              <th className="text-left font-medium px-3 py-2">Толщина</th>
              <th className="text-left font-medium px-3 py-2">Из прайса</th>
              <th className="text-right font-medium px-3 py-2">Было</th>
              <th className="text-right font-medium px-3 py-2">Станет</th>
              <th className="text-right font-medium px-3 py-2">Δ</th>
              <th className="text-right font-medium px-3 py-2">Продажная</th>
              <th className="text-right font-medium px-3 py-2">Маржа было → станет</th>
            </tr>
          </thead>
          <tbody>
            {plan.changes.map((c, i) => {
              const delta = c.old_value ? (c.new_value - c.old_value) / c.old_value : null
              return (
                <tr key={i} className="border-t border-[#f0f0ec]">
                  <td className="px-3 py-1.5 text-[#111110]">
                    {c.matrix_name}
                    <span className="ml-1.5 text-[10px] text-[#9a9a95]">{c.matrix_category === 'mirror' ? 'зеркало' : 'стекло'}</span>
                  </td>
                  <td className="px-3 py-1.5 text-[#6b6b66]">{c.thickness} мм</td>
                  <td className="px-3 py-1.5 text-[#9a9a95]">
                    {c.product}{c.coefficient !== 1 ? ` ×${c.coefficient}` : ''} · {money(c.price_per_m2)} ₽
                  </td>
                  <td className="px-3 py-1.5 text-right text-[#6b6b66]">{money(c.old_value)}</td>
                  <td className="px-3 py-1.5 text-right font-medium text-[#111110]">{money(c.new_value)}</td>
                  <td className={`px-3 py-1.5 text-right ${delta == null ? 'text-[#9a9a95]' : delta > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {delta == null ? '—' : `${delta > 0 ? '+' : ''}${Math.round(delta * 100)}%`}
                  </td>
                  <td className="px-3 py-1.5 text-right text-[#9a9a95]">{money(c.sale_price)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <span className={marginColor(c.margin_before)}>{pct(c.margin_before)}</span>
                    <span className="text-[#d8d8d4] mx-1">→</span>
                    <span className={marginColor(c.margin_after)}>{pct(c.margin_after)}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {plan.unmappedProducts.length > 0 && (
        <div className="mt-4 text-[11px] text-[#9a9a95]">
          Колонки прайса без привязки: {plan.unmappedProducts.map(p => `${p.section ? p.section + ' · ' : ''}${p.product}`).join(', ')}
        </div>
      )}

      {log.length > 0 && (
        <div className="mt-6">
          <h3 className="text-[13px] font-semibold text-[#111110] mb-2">Что эта версия уже изменила</h3>
          <table className="w-full text-[12px]">
            <tbody>
              {log.map(r => (
                <tr key={r.id} className="border-t border-[#f0f0ec]">
                  <td className="px-3 py-1.5 text-[#111110]">{r.matrix_name} <span className="text-[10px] text-[#9a9a95]">{r.matrix_category === 'mirror' ? 'зеркало' : 'стекло'}</span></td>
                  <td className="px-3 py-1.5 text-[#6b6b66]">{r.thickness} мм</td>
                  <td className="px-3 py-1.5 text-right text-[#9a9a95]">{money(r.old_value)}</td>
                  <td className="px-3 py-1.5 text-right text-[#111110]">→ {money(r.new_value)}</td>
                  <td className="px-3 py-1.5 text-[#9a9a95]">{dateRu(r.applied_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
