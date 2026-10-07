'use client'

import { useEffect, useRef, useState, use } from 'react'
import Link from 'next/link'
import { renderDocCanvas } from '@/lib/pdfCapture'
import UpdDocument from '@/components/UpdDocument'
import { issuedUpdView, type UpdIssued } from '@/lib/b2b/updView'

// A11: УПД в кабинете партнёра. Данные — /api/partner/order/[id]/invoice-data (гейт
// can_self_invoice + запущен). С этапа 7 docs/b2b/ORDER_PANEL_ROUTE.md партнёр видит только
// выданный УПД — копию, закреплённую при выдаче; черновик из заказа сюда не попадает: его
// номер не совпал бы с настоящим документом.

type Resp = { order: { id: number; custom_number: string | null }; updIssued?: UpdIssued | null }

export default function PartnerUpdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const docRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`/api/partner/order/${id}/invoice-data`).then(async r => {
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error || 'Документ недоступен'); setLoading(false); return }
      setData(await r.json() as Resp)
      setLoading(false)
    }).catch(() => { setError('Сеть недоступна'); setLoading(false) })
  }, [id])

  const issued = data?.updIssued ?? null

  async function downloadPdf() {
    if (!docRef.current || !issued) return
    try {
      const jspdf = await import('jspdf')
      const canvas = await renderDocCanvas(docRef.current)
      const pdf = new jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
      const pw = 297, ph = 210
      const imgH = pw * canvas.height / canvas.width
      let pos = 0, left = imgH
      const img = canvas.toDataURL('image/jpeg', 0.94)
      pdf.addImage(img, 'JPEG', 0, pos, pw, imgH)
      left -= ph
      while (left > 0) { pos -= ph; pdf.addPage(); pdf.addImage(img, 'JPEG', 0, pos, pw, imgH); left -= ph }
      pdf.save(`УПД-${issued.number}-${issued.year}.pdf`)
    } catch {
      alert('Не удалось сформировать PDF. Используйте «Печать» → Сохранить как PDF.')
    }
  }

  if (loading) return <div className="wrap"><div className="note"><div className="s">Загрузка…</div></div></div>
  if (error || !data || !issued) return (
    <div className="wrap"><div className="note">
      <div className="t">{error === 'Счёт выставляет менеджер' || !error ? 'УПД выдаёт менеджер' : 'Документ недоступен'}</div>
      <div className="s">{error === 'Счёт выставляет менеджер' || !error ? 'УПД по этому заказу ещё не выдан — менеджер M-Glass выдаёт его при отгрузке, после этого он появится здесь.' : error}</div>
      <Link href={`/partner/order/${id}`} className="s" style={{ display: 'inline-block', marginTop: 10, color: 'var(--blue)' }}>← К заказу</Link>
    </div></div>
  )

  return (
    <>
      <style>{'body{background:#ececea}'}</style>
      <div className="no-print" style={{ maxWidth: 1040, margin: '0 auto', padding: '18px 16px 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Link href={`/partner/order/${id}`} className="ghost">‹ К заказу</Link>
        <button onClick={() => document.fonts.ready.then(() => window.print())} className="ghost" style={{ marginLeft: 'auto' }}>🖨 Печать</button>
        <button onClick={downloadPdf} className="primary">⬇ Скачать PDF</button>
      </div>

      <UpdDocument ref={docRef} view={issuedUpdView(issued)} />
    </>
  )
}
