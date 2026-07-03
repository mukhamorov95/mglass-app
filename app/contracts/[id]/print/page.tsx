'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import QRCode from 'qrcode'
import { paymentQrString } from '@/lib/paymentQr'
import { ContractDocument, InvoiceDocument, type ContractContent } from './documents'

const CSS = `
.dc-scope{--ink:#18181B;--red:#E1442E;--line:#c9c9c4;background:#54545a;min-height:100vh;font-family:-apple-system,"Helvetica Neue","Segoe UI",Arial,sans-serif;color:#1a1a1a}
.dc-scope *{box-sizing:border-box}
.dc-toolbar{position:fixed;top:16px;right:16px;z-index:50;display:flex;gap:8px}
.dc-toolbar button{background:#111110;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
.dc-toolbar button.tab{background:#fff;color:#6b6b66;border:1px solid #d8d8d3}
.dc-toolbar button.tab.on{background:#111110;color:#fff}
.dc-toolbar button:disabled{opacity:.6}
.doc-wrap{padding:24px 0;display:flex;justify-content:center}
.doc-page{width:210mm;background:#fff;padding:16mm 15mm;box-shadow:0 2px 12px rgba(0,0,0,.25)}
/* contract */
.contract{font-size:10.5pt;line-height:1.45;color:#1a1a1a}
.contract p{margin:0 0 7px;text-align:justify}
.contract h3{font-size:11pt;font-weight:800;margin:14px 0 7px}
.c-hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid var(--ink);padding-bottom:10px;margin-bottom:14px;font-size:10pt}
.c-hdr-r{text-align:right}
.c-req{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:10px;font-size:9.5pt;line-height:1.5}
/* invoice */
.invoice{position:relative;min-height:297mm}
.inv-hdr{font-size:11pt;margin-bottom:10px}
.inv-bank{width:62%;border-collapse:collapse;font-size:9pt;margin-bottom:10px}
.inv-bank td{border:1px solid #333;padding:4px 8px;vertical-align:top}
.inv-bank td.k{width:90px;color:#333}
.inv-qr{position:absolute;top:14mm;right:15mm;width:120px;height:120px}
.inv-title{text-align:center;font-size:15pt;font-weight:800;margin:16px 0 12px}
.inv-party{font-size:9.5pt;line-height:1.5;margin:0 0 8px}
.inv-party span{font-weight:700;display:inline-block;min-width:80px}
.inv-items{width:100%;border-collapse:collapse;font-size:9.5pt;margin:12px 0}
.inv-items th,.inv-items td{border:1px solid #333;padding:6px 8px;text-align:left}
.inv-items th{background:#f0f0ec;font-weight:700}
.inv-items td.r{text-align:right}
.inv-tot{width:45%;margin-left:auto;border-collapse:collapse;font-size:10pt;margin-bottom:24px}
.inv-tot td{padding:4px 8px}.inv-tot td.r{text-align:right}
.inv-sign{margin-top:44px;font-size:10pt;position:relative;padding-bottom:64px}
.inv-sig-wrap{display:inline-block;width:170px;border-bottom:1px solid #333;position:relative;vertical-align:bottom;margin:0 8px;height:1px}
.inv-signature{position:absolute;left:16px;bottom:-2px;height:56px}
.inv-stamp{position:absolute;left:210px;top:-42px;height:120px;opacity:.92}
/* подпись+печать в договоре (блок Исполнителя) */
.c-sign{position:relative;margin-top:14px;height:92px}
.c-signature{position:absolute;left:2px;top:-4px;height:50px}
.c-stamp{position:absolute;left:74px;top:-22px;height:98px;opacity:.9}
.c-sign-line{position:absolute;left:0;bottom:8px;font-size:9.5pt}
@media print{.dc-scope{background:#fff}.dc-toolbar{display:none}.doc-page{box-shadow:none;margin:0}}
`

export default function ContractPrintPage() {
  const params = useParams()
  const id = params?.id as string
  const [c, setC] = useState<ContractContent | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState<'contract' | 'invoice'>('contract')
  const [qr, setQr] = useState('')
  const [busy, setBusy] = useState(false)
  const contractRef = useRef<HTMLDivElement>(null)
  const invoiceRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function load() {
      try {
        const { data, error } = await createClient()
          .from('contracts')
          .select('number, date, customer_type, customer, spec, total, make_sum, install_sum, make_days, install_days, content')
          .eq('id', id).maybeSingle()
        if (error || !data) { setNotFound(true); return }
        const content = (data.content ?? {}) as ContractContent
        setC({
          ...content,
          number: content.number ?? (data.number as string),
          customer_type: (data.customer_type as 'individual' | 'company') ?? content.customer_type,
          customer: (data.customer as ContractContent['customer']) ?? content.customer,
          spec: (data.spec as ContractContent['spec']) ?? content.spec,
          total: content.total ?? (data.total as number),
          make_sum: content.make_sum ?? (data.make_sum as number),
          install_sum: content.install_sum ?? (data.install_sum as number),
          make_days: content.make_days ?? (data.make_days as number),
          install_days: content.install_days ?? (data.install_days as number),
        })
      } catch { setNotFound(true) } finally { setLoading(false) }
    }
    load()
  }, [id])

  useEffect(() => {
    if (!c) return
    const total = Number(String(c.total ?? '').replace(/[^\d.-]/g, '')) || 0
    const s = paymentQrString(total, `Оплата по счёту № ${c.number ?? ''}`)
    QRCode.toDataURL(s, { margin: 0, width: 240 }).then(setQr).catch(() => {})
  }, [c])

  async function downloadInvoice() {
    if (!invoiceRef.current) return
    setBusy(true)
    try {
      const [h2c, jspdf] = await Promise.all([import('html2canvas'), import('jspdf')])
      const canvas = await h2c.default(invoiceRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
      const pdf = new jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
      let w = 210, h = 210 * canvas.height / canvas.width
      if (h > 297) { h = 297; w = 297 * canvas.width / canvas.height }
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.94), 'JPEG', (210 - w) / 2, 0, w, h)
      pdf.save(`Счёт-${c?.number ?? ''}.pdf`)
    } finally { setBusy(false) }
  }

  async function downloadContract() {
    if (!contractRef.current) return
    setBusy(true)
    try {
      const [h2c, jspdf] = await Promise.all([import('html2canvas'), import('jspdf')])
      const canvas = await h2c.default(contractRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
      const pdf = new jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
      const pxPerMm = canvas.width / 210
      const pageHpx = 297 * pxPerMm
      let y = 0, first = true
      while (y < canvas.height - 2) {
        const sliceH = Math.min(pageHpx, canvas.height - y)
        const tmp = document.createElement('canvas')
        tmp.width = canvas.width; tmp.height = Math.round(sliceH)
        tmp.getContext('2d')!.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH)
        if (!first) pdf.addPage()
        pdf.addImage(tmp.toDataURL('image/jpeg', 0.94), 'JPEG', 0, 0, 210, sliceH / pxPerMm)
        first = false
        y += sliceH
      }
      pdf.save(`Договор-${c?.number ?? ''}.pdf`)
    } finally { setBusy(false) }
  }

  if (loading) return <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#8a8a85' }}>Загрузка…</div>
  if (notFound || !c) return <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#8a8a85' }}>Документ не найден.</div>

  return (
    <div className="dc-scope">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="dc-toolbar">
        <button className={`tab${tab === 'contract' ? ' on' : ''}`} onClick={() => setTab('contract')}>Договор</button>
        <button className={`tab${tab === 'invoice' ? ' on' : ''}`} onClick={() => setTab('invoice')}>Счёт</button>
        {tab === 'contract'
          ? <button onClick={downloadContract} disabled={busy}>{busy ? 'Готовлю…' : '💾 Скачать договор'}</button>
          : <button onClick={downloadInvoice} disabled={busy}>{busy ? 'Готовлю…' : '💾 Скачать счёт'}</button>}
      </div>
      <div className="doc-wrap">
        <div style={{ display: tab === 'contract' ? 'block' : 'none' }}>
          <div ref={contractRef}><ContractDocument c={c} /></div>
        </div>
        <div style={{ display: tab === 'invoice' ? 'block' : 'none' }}>
          <div ref={invoiceRef}><InvoiceDocument c={c} qr={qr} /></div>
        </div>
      </div>
    </div>
  )
}
