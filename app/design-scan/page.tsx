'use client'

import { useRef, useState } from 'react'

// Скан дизайн-проекта: PDF → рендер страниц в браузере (pdf.js) → пачки JPEG в
// /api/ai/scan-design → список изделий из стекла/зеркал со страницей, размерами
// и скриншотом-вырезкой изделия по bbox от модели.

type Bbox = { x: number; y: number; w: number; h: number }
type FoundItem = {
  page: number
  kind: 'mirror' | 'shower' | 'partition' | 'loft' | 'glass_other'
  title: string
  dimensions?: string
  description?: string
  room?: string
  confidence: 'sure' | 'maybe'
  bbox?: Bbox
  crop?: string      // dataURL вырезки
  pageShot?: string  // dataURL всей страницы (для просмотра)
}

const KIND_META: Record<FoundItem['kind'], { label: string; cls: string }> = {
  mirror:      { label: '🪞 Зеркало',            cls: 'bg-blue-50 text-blue-700' },
  shower:      { label: '🚿 Душевая',            cls: 'bg-cyan-50 text-cyan-700' },
  partition:   { label: '🧊 Перегородка',        cls: 'bg-indigo-50 text-indigo-700' },
  loft:        { label: '🏗 Лофт-перегородка',   cls: 'bg-amber-50 text-amber-700' },
  glass_other: { label: '◻️ Стекло прочее',      cls: 'bg-[#f0f0ec] text-[#6b6b66]' },
}

const BATCH = 4          // страниц на запрос
const SCAN_WIDTH = 1500  // ширина JPEG для модели
const CROP_SCALE = 2.2   // рендер страницы с изделием для вырезки

export default function DesignScanPage() {
  const abortRef = useRef(false)
  const [fileName, setFileName] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [items, setItems] = useState<FoundItem[]>([])
  const [failedPages, setFailedPages] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [finished, setFinished] = useState(false)
  const [viewer, setViewer] = useState<string | null>(null)

  async function scan(file: File) {
    setFileName(file.name); setRunning(true); setFinished(false)
    setItems([]); setFailedPages([]); setError(null); abortRef.current = false
    try {
      // pdf.js грузим статикой мимо бандлера — webpack/turbopack ломают его worker-мост
      // (рендер-промис зависает). Файлы pdf.min.mjs + pdf.worker.min.mjs лежат в public/.
      const pdfjs = (await import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ '/pdf.min.mjs' as string
      )) as typeof import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
      const buf = await file.arrayBuffer()
      const doc = await pdfjs.getDocument({ data: buf }).promise
      const total = doc.numPages
      setProgress({ done: 0, total })

      async function renderPage(n: number, targetWidth: number): Promise<{ canvas: HTMLCanvasElement }> {
        console.log(`[design-scan] getPage ${n}`)
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: targetWidth / base.width })
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height)
        const ctx = canvas.getContext('2d')!
        console.log(`[design-scan] render ${n} → ${canvas.width}×${canvas.height}`)
        const task = page.render({ canvasContext: ctx, viewport } as Parameters<typeof page.render>[0])
        const timeout = new Promise<never>((_, rej) => setTimeout(() => {
          try { task.cancel() } catch { /* уже завершилась */ }
          rej(new Error(`Рендер страницы ${n} завис (60 сек)`))
        }, 60_000))
        await Promise.race([task.promise, timeout])
        console.log(`[design-scan] done ${n}`)
        return { canvas }
      }

      for (let start = 1; start <= total && !abortRef.current; start += BATCH) {
        const nums = Array.from({ length: Math.min(BATCH, total - start + 1) }, (_, i) => start + i)
        const rendered: { page: number; image: string }[] = []
        for (const n of nums) {
          const { canvas } = await renderPage(n, SCAN_WIDTH)
          rendered.push({ page: n, image: canvas.toDataURL('image/jpeg', 0.8).split(',')[1] })
        }
        let batchItems: FoundItem[] = []
        let ok = false
        for (let attempt = 0; attempt < 2 && !ok; attempt++) {
          try {
            const r = await fetch('/api/ai/scan-design', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pages: rendered }),
            })
            const d = await r.json()
            if (r.ok && Array.isArray(d.items)) { batchItems = d.items as FoundItem[]; ok = true }
          } catch { /* retry */ }
        }
        if (!ok) setFailedPages(prev => [...prev, ...nums])

        // Вырезки: страницу с изделиями рендерим крупнее и режем по bbox с полями.
        if (batchItems.length) {
          const byPage = new Map<number, FoundItem[]>()
          for (const it of batchItems) {
            if (!byPage.has(it.page)) byPage.set(it.page, [])
            byPage.get(it.page)!.push(it)
          }
          for (const [pageNum, pageItems] of byPage) {
            try {
              const { canvas } = await renderPage(pageNum, SCAN_WIDTH * CROP_SCALE)
              const pageShotCanvas = await renderPage(pageNum, 1100)
              const pageShot = pageShotCanvas.canvas.toDataURL('image/jpeg', 0.75)
              for (const it of pageItems) {
                it.pageShot = pageShot
                if (it.bbox && it.bbox.w > 1 && it.bbox.h > 1) {
                  const pad = 4 // % запаса вокруг рамки
                  const x0 = Math.max(0, (it.bbox.x - pad) / 100 * canvas.width)
                  const y0 = Math.max(0, (it.bbox.y - pad) / 100 * canvas.height)
                  const w = Math.min(canvas.width - x0, (it.bbox.w + pad * 2) / 100 * canvas.width)
                  const h = Math.min(canvas.height - y0, (it.bbox.h + pad * 2) / 100 * canvas.height)
                  const c2 = document.createElement('canvas')
                  c2.width = Math.round(w); c2.height = Math.round(h)
                  c2.getContext('2d')!.drawImage(canvas, x0, y0, w, h, 0, 0, w, h)
                  it.crop = c2.toDataURL('image/jpeg', 0.85)
                }
              }
            } catch { /* без вырезки */ }
          }
          setItems(prev => [...prev, ...batchItems])
        }
        setProgress({ done: Math.min(start + nums.length - 1, total), total })
      }
      setFinished(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось обработать PDF')
    } finally { setRunning(false) }
  }

  function copyList() {
    const lines = items.map((it, i) => {
      const parts = [
        `${i + 1}. ${it.title}${it.confidence === 'maybe' ? ' (проверить)' : ''}`,
        it.dimensions ? `   Размеры: ${it.dimensions}` : '',
        it.description ? `   Описание: ${it.description}` : '',
        it.room ? `   Помещение: ${it.room}` : '',
        `   Страница проекта: ${it.page}`,
      ]
      return parts.filter(Boolean).join('\n')
    })
    navigator.clipboard.writeText(`Изделия из стекла и зеркал — ${fileName}\n\n${lines.join('\n\n')}`)
  }

  const pct = progress.total ? Math.round(progress.done / progress.total * 100) : 0

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Скан дизайн-проекта</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">Прикрепи PDF дизайн-проекта — пройду по всем страницам и выпишу изделия из стекла и зеркал: размеры, описание, страница и скриншот изделия.</p>
      </div>

      <div className="px-5 pt-4 space-y-4 max-w-[1100px]">
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <label className={`px-4 py-2 text-[13px] font-semibold rounded-lg ${running ? 'bg-[#efefec] text-[#c4c4be] cursor-default' : 'bg-[#111110] text-white hover:bg-[#2a2a28] cursor-pointer'}`}>
              📐 Прикрепить дизайн-проект (PDF)
              <input type="file" accept="application/pdf" className="hidden" disabled={running}
                onChange={e => { const f = e.target.files?.[0]; if (f) scan(f); e.target.value = '' }} />
            </label>
            {running && (
              <button onClick={() => { abortRef.current = true }}
                className="text-[12px] font-semibold border border-[#e4e4e0] rounded-lg px-3 py-1.5 hover:bg-[#f5f5f3]">■ Остановить</button>
            )}
            {fileName && <span className="text-[12px] text-[#6b6b66]">{fileName}</span>}
          </div>

          {(running || finished) && progress.total > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-[12px] text-[#6b6b66] mb-1">
                <span>{running ? `Смотрю страницу ${Math.min(progress.done + 1, progress.total)} из ${progress.total}…` : `Готово: ${progress.total} страниц`}</span>
                <span>Найдено изделий: <b>{items.length}</b></span>
              </div>
              <div className="h-2 bg-[#efefec] rounded-full overflow-hidden">
                <div className="h-full bg-[#111110] rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
          {!!failedPages.length && <p className="text-[11px] text-amber-600 mt-2">⚠️ Не удалось просмотреть страницы: {failedPages.join(', ')} — прогони их отдельно или проверь глазами.</p>}
          {error && <p className="text-[12px] text-red-600 mt-2">{error}</p>}
          {finished && !items.length && !error && <p className="text-[12px] text-[#6b6b66] mt-2">Изделий из стекла и зеркал в проекте не нашёл.</p>}
        </div>

        {items.length > 0 && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95]">Изделия ({items.length})</p>
              <button onClick={copyList}
                className="text-[12px] font-semibold border border-[#e4e4e0] rounded-lg px-3 py-1.5 hover:bg-[#f5f5f3]">📋 Скопировать список</button>
            </div>
            <div className="space-y-3">
              {items.map((it, i) => {
                const meta = KIND_META[it.kind] ?? KIND_META.glass_other
                return (
                  <div key={i} className="border border-[#f0f0ec] rounded-lg p-3 flex gap-3 flex-wrap sm:flex-nowrap">
                    {(it.crop || it.pageShot) && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.crop || it.pageShot} alt=""
                        onClick={() => setViewer(it.pageShot || it.crop || null)}
                        className="w-full sm:w-56 max-h-44 object-contain bg-[#fafaf8] border border-[#f0f0ec] rounded-lg cursor-zoom-in flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-bold">{i + 1}. {it.title}</span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${meta.cls}`}>{meta.label}</span>
                        {it.confidence === 'maybe' && <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700">⚠️ проверить</span>}
                      </div>
                      {it.dimensions && <p className="text-[13px] mt-1">📏 <b>{it.dimensions}</b></p>}
                      {it.description && <p className="text-[12px] text-[#6b6b66] mt-0.5">{it.description}</p>}
                      <p className="text-[11px] text-[#9a9a95] mt-1">{it.room ? `${it.room} · ` : ''}страница {it.page}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {viewer && (
        <div onClick={() => setViewer(null)} className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-6 cursor-zoom-out">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewer} alt="" className="max-w-full max-h-full rounded-lg bg-white" />
        </div>
      )}
    </div>
  )
}
