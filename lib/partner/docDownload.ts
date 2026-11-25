'use client'

import { useEffect, useRef } from 'react'
import { renderDocCanvas } from '@/lib/pdfCapture'

// Скачивание документа кабинета в одно нажатие (Шовер Гласс 25.11): список «Документы»
// открывает страницу документа в скрытом iframe с ?dl=1, страница собирает PDF и отдаёт его
// родителю сообщением; файл сохраняет верхнее окно. Открытая напрямую страница — обычное
// сохранение.

export const DL_MSG = 'pcab-pdf'
export type DlMessage = { type: typeof DL_MSG; name?: string; blob?: Blob; error?: string }

const embedded = () => typeof window !== 'undefined' && window.parent !== window
const autoMode = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('dl') === '1'

function post(msg: Omit<DlMessage, 'type'>) {
  window.parent.postMessage({ type: DL_MSG, ...msg }, window.location.origin)
}

export async function deliverPdf(el: HTMLElement, name: string, orientation: 'portrait' | 'landscape'): Promise<void> {
  await document.fonts.ready
  const jspdf = await import('jspdf')
  const canvas = await renderDocCanvas(el)
  const pdf = new jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation })
  const [pw, ph] = orientation === 'portrait' ? [210, 297] : [297, 210]
  const imgH = pw * canvas.height / canvas.width
  const img = canvas.toDataURL('image/jpeg', 0.94)
  let pos = 0, left = imgH
  pdf.addImage(img, 'JPEG', 0, pos, pw, imgH)
  left -= ph
  while (left > 0) { pos -= ph; pdf.addPage(); pdf.addImage(img, 'JPEG', 0, pos, pw, imgH); left -= ph }
  if (embedded() && autoMode()) post({ name, blob: pdf.output('blob') })
  else pdf.save(name)
}

// Страница документа в режиме ?dl=1: как только документ отрисован — собрать PDF; не открылся —
// сказать родителю причину, а не молчать до таймаута.
export function useAutoDownload(o: { ready: boolean; failed: string | null; run: () => Promise<void> }) {
  const done = useRef(false)
  const { ready, failed, run } = o
  useEffect(() => {
    if (done.current || !autoMode()) return
    if (failed) {
      done.current = true
      if (embedded()) post({ error: failed })
      return
    }
    if (!ready) return
    // QR и шрифты дорисовываются после данных — даём им кадр.
    const t = setTimeout(() => {
      if (done.current) return
      done.current = true
      run().catch(e => { if (embedded()) post({ error: e instanceof Error ? e.message : 'PDF не собрался' }) })
    }, 600)
    return () => clearTimeout(t)
  }, [ready, failed, run])
}
