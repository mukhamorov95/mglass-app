'use client'

import { useState } from 'react'

type Source = { supplier: string; title: string; discount_percent: number }
type Mapping = {
  dataStart: number; colName: number; colPrice: number
  colArticle?: number; colColor?: number; colUrl?: number; colCategory?: number
  categoryMode: 'url' | 'sections' | 'column' | 'fixed'; colorFromName?: boolean; fixedCategory?: string
}
type ParsedRow = { name: string; article: string; color: string; url: string; category: string; unit: string; retail_price: number }

const PRESETS: Record<string, { label: string; map: Mapping }> = {
  vetro: { label: 'Ветро (Наименование|Цвет|Артикул|Цена|URL)', map: { dataStart: 1, colName: 1, colColor: 2, colArticle: 3, colPrice: 4, colUrl: 5, categoryMode: 'url' } },
  av24: { label: 'АВ24 (№|Картинка|Артикул|Наименование|Цена, разделы)', map: { dataStart: 9, colArticle: 2, colName: 3, colPrice: 4, categoryMode: 'sections', colorFromName: true } },
  custom: { label: 'Свой формат (задать колонки)', map: { dataStart: 1, colName: 0, colPrice: 1, categoryMode: 'fixed', fixedCategory: '' } },
}

const numv = (v: unknown) => { const n = parseFloat(String(v ?? '').replace(/\s| /g, '').replace(',', '.')); return isFinite(n) ? n : null }
const strv = (v: unknown) => (v == null ? '' : String(v).trim())
const catFromUrl = (u: string) => { const m = /\/catalog\/([^/]+)\//.exec(u); return m ? m[1].replace(/_/g, ' ') : '' }
const afterSlash = (s: string) => (s.includes('/') ? (s.split('/').pop() || '').trim() : '')

function parseRows(aoa: unknown[][], m: Mapping): ParsedRow[] {
  const out: ParsedRow[] = []
  let cur = m.fixedCategory || ''
  for (let i = Math.max(0, m.dataStart); i < aoa.length; i++) {
    const r = aoa[i] || []
    const name = strv(r[m.colName]); const price = numv(r[m.colPrice])
    const article = m.colArticle != null ? strv(r[m.colArticle]) : ''
    if (m.categoryMode === 'sections' && !name && !article && price == null) {
      const t = r.map(strv).find(x => x); if (t) { cur = t }
      continue
    }
    if ((!name && !article) || price == null) continue
    const color = m.colColor != null ? strv(r[m.colColor]) : (m.colorFromName ? afterSlash(name) : '')
    const url = m.colUrl != null ? strv(r[m.colUrl]) : ''
    const category = m.categoryMode === 'url' ? catFromUrl(url)
      : m.categoryMode === 'column' && m.colCategory != null ? strv(r[m.colCategory])
      : m.categoryMode === 'fixed' ? (m.fixedCategory || '') : cur
    out.push({ name, article: article || name, color, url, category, unit: 'шт', retail_price: Math.round(price) })
  }
  return out
}

export function SupplierImport({ sources, onClose, onDone }: { sources: Source[]; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<'existing' | 'new'>(sources.length ? 'existing' : 'new')
  const [supplier, setSupplier] = useState(sources[0]?.supplier ?? '')
  const [newKey, setNewKey] = useState(''); const [newTitle, setNewTitle] = useState(''); const [newDisc, setNewDisc] = useState('25'); const [newSite, setNewSite] = useState('')
  const [preset, setPreset] = useState<keyof typeof PRESETS>('vetro')
  const [map, setMap] = useState<Mapping>(PRESETS.vetro.map)
  const [replace, setReplace] = useState(true)
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)

  function choosePreset(p: keyof typeof PRESETS) { setPreset(p); setMap(PRESETS[p].map); setParsed(null) }

  async function onFile(file: File) {
    setBusy(true); setMsg('Читаю файл…'); setParsed(null)
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false, defval: null }) as unknown[][]
      const rows = parseRows(aoa, map)
      setParsed(rows); setFileName(file.name)
      setMsg(rows.length ? `Разобрано ${rows.length} строк` : 'Не удалось разобрать — проверь колонки/пресет')
    } catch (e) { setMsg('Ошибка чтения: ' + (e instanceof Error ? e.message : '')) }
    finally { setBusy(false) }
  }

  const effSupplier = mode === 'new' ? newKey.trim().toLowerCase() : supplier
  async function upload() {
    if (!parsed?.length || !effSupplier) return
    setBusy(true); setProgress(0); setMsg('Загружаю…')
    const BATCH = 700
    try {
      for (let i = 0; i < parsed.length; i += BATCH) {
        const chunk = parsed.slice(i, i + BATCH)
        const first = i === 0
        const res = await fetch('/api/admin/supplier-catalog/import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            supplier: effSupplier,
            ...(first && mode === 'new' ? { title: newTitle || newKey, discount_percent: Number(newDisc) || 0, site_url: newSite } : {}),
            reset: first && replace,
            source_file: fileName,
            rows: chunk,
          }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Ошибка загрузки')
        setProgress(Math.min(parsed.length, i + BATCH))
      }
      setMsg(`Готово: загружено ${parsed.length} позиций`)
      onDone()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Ошибка') }
    finally { setBusy(false) }
  }

  const numField = (label: string, val: number | undefined, set: (n: number | undefined) => void) => (
    <label className="flex items-center gap-1 text-[12px]"><span className="text-[#6b6b66]">{label}</span>
      <input type="number" value={val ?? ''} onChange={e => set(e.target.value === '' ? undefined : Number(e.target.value))}
        className="w-14 text-right border border-[#e4e4e0] rounded px-1 py-0.5" /></label>
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 pt-12" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-[640px] max-h-[86vh] overflow-auto shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-[#e4e4e0] flex items-center justify-between">
          <p className="text-[15px] font-semibold text-[#111110]">Импорт прайса поставщика</p>
          <button onClick={onClose} className="text-[#9a9a95] hover:text-[#111110] text-[18px]">×</button>
        </div>
        <div className="p-4 space-y-4">
          {/* Поставщик */}
          <div>
            <div className="flex gap-2 mb-2 text-[13px]">
              <button onClick={() => setMode('existing')} disabled={!sources.length} className={`px-3 py-1 rounded-md border ${mode === 'existing' ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#4b4b47]'} disabled:opacity-40`}>Существующий</button>
              <button onClick={() => setMode('new')} className={`px-3 py-1 rounded-md border ${mode === 'new' ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#4b4b47]'}`}>Новый поставщик</button>
            </div>
            {mode === 'existing' ? (
              <select value={supplier} onChange={e => setSupplier(e.target.value)} className="w-full text-[13px] border border-[#e4e4e0] rounded-lg px-2 py-2">
                {sources.map(s => <option key={s.supplier} value={s.supplier}>{s.title} (−{s.discount_percent}%)</option>)}
              </select>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-[13px]">
                <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Название (Ветро)" className="border border-[#e4e4e0] rounded-lg px-2 py-2" />
                <input value={newKey} onChange={e => setNewKey(e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase())} placeholder="ключ (латиница, vetro)" className="border border-[#e4e4e0] rounded-lg px-2 py-2" />
                <label className="flex items-center gap-1 border border-[#e4e4e0] rounded-lg px-2"><span className="text-[#6b6b66]">Скидка</span><input type="number" value={newDisc} onChange={e => setNewDisc(e.target.value)} className="w-full text-right py-2" /><span className="text-[#9a9a95]">%</span></label>
                <input value={newSite} onChange={e => setNewSite(e.target.value)} placeholder="сайт (необяз.)" className="border border-[#e4e4e0] rounded-lg px-2 py-2" />
              </div>
            )}
          </div>

          {/* Формат */}
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[#8a8a85] mb-1">Формат файла</p>
            <select value={preset} onChange={e => choosePreset(e.target.value as keyof typeof PRESETS)} className="w-full text-[13px] border border-[#e4e4e0] rounded-lg px-2 py-2">
              {Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            {preset === 'custom' && (
              <div className="flex flex-wrap gap-2 mt-2">
                {numField('строка данных с', map.dataStart, v => setMap(m => ({ ...m, dataStart: v ?? 0 })))}
                {numField('кол. Наименование', map.colName, v => setMap(m => ({ ...m, colName: v ?? 0 })))}
                {numField('кол. Цена', map.colPrice, v => setMap(m => ({ ...m, colPrice: v ?? 0 })))}
                {numField('кол. Артикул', map.colArticle, v => setMap(m => ({ ...m, colArticle: v })))}
                {numField('кол. Цвет', map.colColor, v => setMap(m => ({ ...m, colColor: v })))}
                <label className="flex items-center gap-1 text-[12px]"><span className="text-[#6b6b66]">категория</span>
                  <select value={map.categoryMode} onChange={e => setMap(m => ({ ...m, categoryMode: e.target.value as Mapping['categoryMode'] }))} className="border border-[#e4e4e0] rounded px-1 py-0.5 text-[12px]">
                    <option value="fixed">одна на всё</option><option value="sections">строки-разделы</option><option value="url">из URL</option><option value="column">колонка</option>
                  </select></label>
                {map.categoryMode === 'fixed' && <input value={map.fixedCategory ?? ''} onChange={e => setMap(m => ({ ...m, fixedCategory: e.target.value }))} placeholder="категория" className="border border-[#e4e4e0] rounded px-1 py-0.5 text-[12px]" />}
              </div>
            )}
            <p className="text-[11px] text-[#9a9a95] mt-1">Индексы колонок с 0 (A=0, B=1…). Себестоимость = цена × (1 − скидка) считается на сервере.</p>
          </div>

          {/* Файл */}
          <div>
            <input type="file" accept=".xlsx,.xls" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])}
              className="block w-full text-[13px] file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-[#111110] file:text-white file:text-[12px]" />
          </div>

          {/* Превью */}
          {parsed && parsed.length > 0 && (
            <div className="border border-[#e4e4e0] rounded-lg overflow-hidden">
              <div className="text-[12px] text-[#6b6b66] px-3 py-1.5 bg-[#fafaf9] border-b border-[#e4e4e0]">Первые строки ({parsed.length} всего):</div>
              <table className="w-full text-[12px]">
                <tbody>
                  {parsed.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-b border-[#f4f4f0] last:border-0">
                      <td className="px-2 py-1 truncate max-w-[240px]">{r.name}</td>
                      <td className="px-2 py-1 text-[#9a9a95]">{r.color || '—'}</td>
                      <td className="px-2 py-1 text-right font-mono">{r.retail_price.toLocaleString('ru-RU')} ₽</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <label className="flex items-center gap-2 text-[13px] text-[#4b4b47]">
            <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />
            Заменить весь прайс поставщика (снять — только добавить/обновить)
          </label>

          {msg && <p className={`text-[13px] ${msg.startsWith('Готово') ? 'text-[#256029]' : msg.startsWith('Ошибка') ? 'text-red-600' : 'text-[#6b6b66]'}`}>{msg}{busy && progress > 0 ? ` — ${progress}` : ''}</p>}
        </div>
        <div className="p-4 border-t border-[#e4e4e0] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px] border border-[#e4e4e0]">Закрыть</button>
          <button onClick={upload} disabled={busy || !parsed?.length || !effSupplier}
            className={`px-4 py-2 rounded-lg text-[13px] font-medium ${!busy && parsed?.length && effSupplier ? 'bg-[#111110] text-white hover:bg-[#2a2a28]' : 'bg-[#eee] text-[#9a9a95]'}`}>
            {busy ? 'Загрузка…' : `Загрузить ${parsed?.length ?? 0}`}
          </button>
        </div>
      </div>
    </div>
  )
}
