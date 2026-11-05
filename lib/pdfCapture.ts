// Снимок печатного документа в canvas для сборки PDF (html2canvas-pro + jsPDF).
//
// Проблема, которую это решает: html2canvas снимает вёрстку под ТЕКУЩИЙ вьюпорт и
// НЕ применяет @media print / Tailwind print:-классы. Поэтому PDF, собранный с
// телефона (<640px), выходил мобильным вариантом: узкий лист, переносы строк,
// раздутый шрифт, обрезанные правые колонки, вместо 2 страниц — 8. С компьютера тот
// же документ выходил нормально.
//
// Решение: документы свёрстаны фиксированной десктопной шириной (не зависят от
// вьюпорта), а тут мы дополнительно рендерим клон при широком windowWidth — так
// медиазапросы и раскладка одинаковы независимо от устройства, а геометрия клона
// совпадает с экранной (важно для постраничной нарезки по границам блоков).

export async function renderDocCanvas(
  el: HTMLElement,
  opts: { windowWidth?: number; scale?: number } = {},
): Promise<HTMLCanvasElement> {
  const windowWidth = opts.windowWidth ?? 1280
  const scale = opts.scale ?? 2
  const h2c = (await import('html2canvas-pro')).default
  return h2c(el, {
    scale,
    useCORS: true,
    backgroundColor: '#ffffff',
    windowWidth,
    windowHeight: Math.max(el.scrollHeight || 0, 2000),
    onclone: (_doc: Document, cloned: HTMLElement) => {
      // Мобильные обёртки с боковым скроллом таблиц разворачиваем — в PDF всё видимо.
      cloned.querySelectorAll<HTMLElement>('.overflow-x-auto').forEach(w => { w.style.overflow = 'visible' })
    },
  })
}

// Где резать длинный лист на страницы: только по низу неразрывного блока, чтобы строка не порвалась.
// Остаток, который влезает на страницу, идёт целиком: иначе от хвоста в пару пикселей рождалась пустая страница.
export function pageCuts(height: number, pageHeight: number, stops: number[]): number[] {
  const sorted = [...stops].sort((a, b) => a - b)
  const cuts: number[] = []
  let y = 0
  while (y < height - 1) {
    if (height - y <= pageHeight) { cuts.push(height); break }
    const limit = y + pageHeight
    const from = y
    const cut = sorted.filter(s => s > from + 1 && s <= limit).pop() ?? limit
    cuts.push(cut)
    y = cut
  }
  return cuts
}

// A4 с полями, нарезка по границам блоков. Только для клиентских компонентов: нужен DOM.
export async function saveSheetPdf(el: HTMLElement, fileName: string, keepSelector: string): Promise<void> {
  const jspdf = await import('jspdf')
  const scale = 2
  const canvas = await renderDocCanvas(el, { scale })
  const pdf = new jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const margin = 10
  const pageWidthMm = 210 - margin * 2
  const pageHeightMm = 297 - margin * 2
  const pxPerMm = canvas.width / pageWidthMm
  const top = el.getBoundingClientRect().top
  const stops = [...el.querySelectorAll(keepSelector)]
    .map(b => (b.getBoundingClientRect().bottom - top) * scale)
    .filter(y => y > 0)
  let y = 0
  pageCuts(canvas.height, pageHeightMm * pxPerMm, stops).forEach((cut, i) => {
    const h = Math.ceil(cut - y)
    const part = document.createElement('canvas')
    part.width = canvas.width
    part.height = h
    part.getContext('2d')?.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h)
    if (i > 0) pdf.addPage()
    pdf.addImage(part.toDataURL('image/jpeg', 0.94), 'JPEG', margin, margin, pageWidthMm, h / pxPerMm)
    y = cut
  })
  pdf.save(fileName)
}
