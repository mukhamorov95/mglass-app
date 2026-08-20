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
