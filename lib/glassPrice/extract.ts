import type { RawGrid, RawPage, RawTextItem } from './types'
import { itemsToGrid, sheetToGrid } from './grid'

// Извлечение сетки из файла прайса. Работает в браузере: pdf.js грузится статикой
// мимо бандлера (как в /design-scan и /kp — иначе ломается worker-мост).
export async function extractPdfPages(file: File): Promise<RawPage[]> {
  const pdfjs = (await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ '/pdf.min.mjs' as string
  )) as typeof import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const pages: RawPage[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const height = page.getViewport({ scale: 1 }).height
    const content = await page.getTextContent()
    const items: RawTextItem[] = []
    for (const raw of content.items) {
      const it = raw as { str?: string; transform?: number[]; width?: number }
      const text = (it.str ?? '').trim()
      if (!text || !it.transform) continue
      items.push({
        text,
        x: Math.round(it.transform[4] * 10) / 10,
        y: Math.round((height - it.transform[5]) * 10) / 10,   // ось y в PDF растёт вверх
        w: Math.round((it.width ?? 0) * 10) / 10,
      })
    }
    pages.push({ page: n, items })
  }
  return pages
}

export async function extractFileGrid(file: File): Promise<{ pages: RawPage[]; grid: RawGrid[] }> {
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    const pages = await extractPdfPages(file)
    return { pages, grid: itemsToGrid(pages) }
  }
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const grid = wb.SheetNames.map((name, i) => {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, blankrows: false, defval: null }) as (string | number | null)[][]
    return sheetToGrid(i + 1, aoa)
  })
  return { pages: [], grid }
}

// «по состоянию на 10.02.2026» / «прайс 10.02.2026» → 2026-02-10
export function detectPriceDate(grid: RawGrid[], fileName = ''): string | null {
  const haystack = [fileName, ...grid.flatMap(p => p.rows.map(r => r.map(c => c.text).join(' ')))].join('\n')
  const m = haystack.match(/(\d{2})[.\-/](\d{2})[.\-/](\d{4})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  const iso = haystack.match(/(\d{4})-(\d{2})-(\d{2})/)
  return iso ? iso[0] : null
}
