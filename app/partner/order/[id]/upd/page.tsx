'use client'

import { useEffect, useRef, useState, use } from 'react'
import Link from 'next/link'
import { deliverPdf, useAutoDownload } from '@/lib/partner/docDownload'
import UpdDocument from '@/components/UpdDocument'
import { issuedUpdView, type UpdIssued } from '@/lib/b2b/updView'

// A11: УПД в кабинете партнёра. Данные — /api/partner/order/[id]/upd: любой партнёр своего
// заказа, флаг самообслуживания нужен только для счёта. С этапа 7 docs/b2b/ORDER_PANEL_ROUTE.md
// партнёр видит только выданный УПД — копию, закреплённую при выдаче; черновик из заказа сюда
// не попадает: его номер не совпал бы с настоящим документом.

type Resp = { order: { id: number; custom_number: string | null }; updIssued?: UpdIssued | null }

export default function PartnerUpdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const docRef = useRef<HTMLDivElement>(null)
  const [pdfErr, setPdfErr] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/partner/order/${id}/upd`).then(async r => {
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error || 'Документ недоступен'); setLoading(false); return }
      setData(await r.json() as Resp)
      setLoading(false)
    }).catch(() => { setError('Сеть недоступна'); setLoading(false) })
  }, [id])

  const issued = data?.updIssued ?? null

  async function downloadPdf() {
    if (!docRef.current || !issued) throw new Error('Документ не готов')
    setPdfErr(null)
    try {
      await deliverPdf(docRef.current, `УПД-${issued.number}-${issued.year}.pdf`, 'landscape')
    } catch (e) {
      setPdfErr('Не удалось сформировать PDF — используйте «Печать» → «Сохранить как PDF».')
      throw e
    }
  }
  useAutoDownload({ ready: !loading && !!issued, failed: loading ? null : error ?? (issued ? null : 'УПД ещё не выдан'), run: downloadPdf })

  if (loading) return <div className="wrap"><div className="note"><div className="s">Загрузка…</div></div></div>
  if (error || !data || !issued) return (
    <div className="wrap"><div className="note">
      <div className="t">{error ? 'Документ недоступен' : 'УПД ещё не выдан'}</div>
      <div className="s">{error || 'УПД по этому заказу выдаёт M-Glass при отгрузке — после этого он появится здесь.'}</div>
      <Link href={`/partner/order/${id}`} className="s" style={{ display: 'inline-block', marginTop: 10, color: 'var(--blue)' }}>← К заказу</Link>
    </div></div>
  )

  return (
    <>
      <style>{'body{background:#ececea}'}</style>
      <div className="no-print" style={{ maxWidth: 1040, margin: '0 auto', padding: '18px 16px 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Link href={`/partner/order/${id}`} className="ghost">‹ К заказу</Link>
        <button onClick={() => document.fonts.ready.then(() => window.print())} className="ghost" style={{ marginLeft: 'auto' }}>🖨 Печать</button>
        <button onClick={() => { void downloadPdf().catch(() => {}) }} className="primary">⬇ Скачать PDF</button>
        {pdfErr && <span style={{ flexBasis: '100%', fontSize: 12.5, color: '#b91c1c' }}>{pdfErr}</span>}
      </div>

      <UpdDocument ref={docRef} view={issuedUpdView(issued)} />
    </>
  )
}
