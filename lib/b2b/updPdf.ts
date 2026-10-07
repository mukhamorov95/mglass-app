// PDF выданного или черновика УПД: альбомный A4, длинный документ режется на листы.
// Только для клиентских компонентов — нужен DOM.

import { renderDocCanvas } from '@/lib/pdfCapture'

export async function saveUpdPdf(el: HTMLElement, fileName: string): Promise<void> {
  const jspdf = await import('jspdf')
  const canvas = await renderDocCanvas(el)
  const pdf = new jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const pw = 297, ph = 210
  const imgH = pw * canvas.height / canvas.width
  let pos = 0, left = imgH
  const img = canvas.toDataURL('image/jpeg', 0.94)
  pdf.addImage(img, 'JPEG', 0, pos, pw, imgH)
  left -= ph
  while (left > 0) { pos -= ph; pdf.addPage(); pdf.addImage(img, 'JPEG', 0, pos, pw, imgH); left -= ph }
  pdf.save(fileName)
}
