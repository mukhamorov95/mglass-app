'use client'

import { useEffect, useRef, useState } from 'react'
import { DRAWING_KINDS, MAX_FILES_PER_ORDER, PHOTO_JPEG_QUALITY, photoScale, type DrawingKind } from '@/lib/partner/drawingFiles'

// Ч1: партнёр прикладывает к просчёту чертёж конструктора или фото эскиза,
// чтобы менеджер увидел размеры и отверстия без звонка «уточните».

type F = { id: string; name: string; size: number | null; kind: DrawingKind | null; createdAt: string; url: string; canDelete: boolean }

// Фото сжимаем в браузере до ≈2 Мпикс JPEG: у сервера лимит 4,5 МБ, а HEIC
// модель не читает. Если браузер не открыл фото (HEIC в Chrome) — честно говорим.
async function toJpeg(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const k = photoScale(bmp.width, bmp.height)
  const w = Math.round(bmp.width * k)
  const h = Math.round(bmp.height * k)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')?.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('jpeg'))), 'image/jpeg', PHOTO_JPEG_QUALITY))
}

const kb = (n: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} КБ` : `${(n / 1024 / 1024).toFixed(1)} МБ`)

export default function DrawingFiles({ orderId }: { orderId: string }) {
  const [files, setFiles] = useState<F[]>([])
  const [launched, setLaunched] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const drawingInput = useRef<HTMLInputElement>(null)
  const sketchInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(`/api/partner/quote/${orderId}/files`)
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error ?? 'Список файлов не загрузился')
        setFiles(d.files ?? [])
        setLaunched(!!d.launched)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Список файлов не загрузился'))
      .finally(() => setLoaded(true))
  }, [orderId])

  async function upload(file: File, kind: DrawingKind) {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      let body: Blob = file
      let name = file.name
      if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
        try {
          body = await toJpeg(file)
          name = file.name.replace(/\.[^.]*$/, '') + '.jpg'
        } catch {
          throw new Error('Не удалось открыть фото. Если это iPhone: «Настройки → Камера → Форматы → Наиболее совместимый», затем сфотографируйте заново.')
        }
      }
      const fd = new FormData()
      fd.append('file', body, name)
      fd.append('kind', kind)
      const r = await fetch(`/api/partner/quote/${orderId}/files`, { method: 'POST', body: fd })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error ?? `Файл не загрузился (${r.status})`)
      setFiles(prev => [...prev, d.file])
      setDone(`«${d.file.name}» приложен к просчёту — менеджер видит его в карточке заказа.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Файл не загрузился')
    } finally {
      setBusy(false)
    }
  }

  async function remove(f: F) {
    if (!window.confirm(`Удалить «${f.name}»?`)) return
    setBusy(true)
    setError(null)
    setDone(null)
    const r = await fetch(`/api/partner/quote/${orderId}/files?file=${f.id}`, { method: 'DELETE' })
    const d = await r.json().catch(() => ({}))
    if (r.ok) setFiles(prev => prev.filter(x => x.id !== f.id))
    else setError(d.error ?? `Файл не удалён (${r.status})`)
    setBusy(false)
  }

  function pick(kind: DrawingKind) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (file) void upload(file, kind)
    }
  }

  const full = files.length >= MAX_FILES_PER_ORDER

  return (
    <div className="card">
      <div className="card-h"><h3>Ваши чертежи и эскизы</h3>{files.length > 0 && <span className="mut">{files.length} из {MAX_FILES_PER_ORDER}</span>}</div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loaded && files.length === 0 && !launched && (
          <div className="cap">Приложите PDF от конструктора или сфотографируйте эскиз с размерами — менеджер увидит отверстия и вырезы без звонка.</div>
        )}

        {files.map(f => (
          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
            <span style={{ fontSize: 18 }}>{f.kind === 'sketch' ? '✎' : '▤'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <a href={f.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{f.name}</a>
              <div className="cap">{f.kind ? DRAWING_KINDS[f.kind] : 'Файл менеджера'}{f.size ? ` · ${kb(f.size)}` : ''}</div>
            </div>
            {f.canDelete && <button className="ghost" disabled={busy} onClick={() => void remove(f)} aria-label={`Удалить ${f.name}`} style={{ padding: '4px 10px' }}>✕</button>}
          </div>
        ))}

        {!launched && !full && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="ghost" style={{ flex: 1 }} disabled={busy} onClick={() => drawingInput.current?.click()}>▤ Чертёж конструктора</button>
            <button className="ghost" style={{ flex: 1 }} disabled={busy} onClick={() => sketchInput.current?.click()}>✎ Фото эскиза</button>
            <input ref={drawingInput} type="file" hidden accept="application/pdf,image/*" onChange={pick('drawing')} />
            <input ref={sketchInput} type="file" hidden accept="image/*" capture="environment" onChange={pick('sketch')} />
          </div>
        )}
        {!launched && full && <div className="cap">Приложено {MAX_FILES_PER_ORDER} файлов — это предел. Удалите лишний, чтобы добавить новый.</div>}
        {launched && <div className="cap">Заказ в работе — новые файлы передайте менеджеру.</div>}

        {busy && <div className="cap">Загружаю…</div>}
        {done && <div className="info"><span>✓</span><span>{done}</span></div>}
        {error && <div className="recalc">{error}</div>}
      </div>
    </div>
  )
}
