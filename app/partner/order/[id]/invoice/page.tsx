'use client'

import { useEffect, useRef, useState, use } from 'react'
import Link from 'next/link'
import { renderDocCanvas } from '@/lib/pdfCapture'
import { entityTitle, type B2BLegalEntity } from '@/lib/b2bLegalEntities'
import InvoiceDocument, { type InvoiceOrder, type InvoiceRequisites } from '@/components/InvoiceDocument'

// Счёт-спецификация в кабинете партнёра — тот же документ, что и у менеджера
// (общий компонент InvoiceDocument). Реквизиты покупателя — только чтение (из своих
// юрлиц). Доступ уже проверен сервером (can_self_invoice + запущен). Скачивание PDF.

const EMPTY: InvoiceRequisites = { full_name: '', inn: '', kpp: '', ogrn: '', legal_address: '', bank_account: '', bank_name: '', bik: '', corr_account: '', supply_contract_no: '', supply_contract_date: '' }

function toReq(src: Record<string, unknown> | null | undefined): InvoiceRequisites {
  const s = (k: string) => (src?.[k] as string | null | undefined) ?? ''
  return {
    full_name: s('full_name') || s('name'), inn: s('inn'), kpp: s('kpp'), ogrn: s('ogrn'), legal_address: s('legal_address'),
    bank_account: s('bank_account'), bank_name: s('bank_name'), bik: s('bik'), corr_account: s('corr_account'),
    supply_contract_no: s('supply_contract_no'), supply_contract_date: s('supply_contract_date'),
  }
}

type Resp = { order: InvoiceOrder & { client_name?: string }; client: Record<string, unknown> | null; entities: B2BLegalEntity[] }

export default function PartnerInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<Resp | null>(null)
  const [req, setReq] = useState<InvoiceRequisites>(EMPTY)
  const [entityId, setEntityId] = useState<number | null>(null)
  const [buyerName, setBuyerName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const docRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`/api/partner/order/${id}/invoice-data`).then(async r => {
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setError(d.error || 'Счёт недоступен'); setLoading(false); return
      }
      const d = await r.json() as Resp
      setData(d)
      setBuyerName(d.order.client_name || (d.client?.name as string) || 'Клиент')
      const def = d.entities.find(e => e.is_default) ?? d.entities[0] ?? null
      if (def) { setEntityId(def.id); setReq(toReq(def as unknown as Record<string, unknown>)) }
      else if (d.client) setReq(toReq(d.client))
      setLoading(false)
    }).catch(() => { setError('Сеть недоступна'); setLoading(false) })
  }, [id])

  function selectEntity(val: string) {
    const e = data?.entities.find(x => x.id === Number(val))
    if (e) { setEntityId(e.id); setReq(toReq(e as unknown as Record<string, unknown>)) }
  }

  async function downloadPdf() {
    if (!docRef.current || !data) return
    try {
      const jspdf = await import('jspdf')
      const canvas = await renderDocCanvas(docRef.current)
      const pdf = new jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
      const pw = 210, ph = 297
      const imgH = pw * canvas.height / canvas.width
      let pos = 0, left = imgH
      const img = canvas.toDataURL('image/jpeg', 0.94)
      pdf.addImage(img, 'JPEG', 0, pos, pw, imgH)
      left -= ph
      while (left > 0) { pos -= ph; pdf.addPage(); pdf.addImage(img, 'JPEG', 0, pos, pw, imgH); left -= ph }
      pdf.save(`Счёт-спецификация-${data.order.custom_number?.trim() || String(data.order.id).padStart(5, '0')}.pdf`)
    } catch {
      alert('Не удалось сформировать PDF. Используйте «Печать» → Сохранить как PDF.')
    }
  }

  if (loading) return <div className="wrap"><div className="note"><div className="s">Загрузка…</div></div></div>
  if (error || !data) return (
    <div className="wrap"><div className="note">
      <div className="t">{error === 'Счёт выставляет менеджер' ? 'Счёт выставляет менеджер' : 'Счёт недоступен'}</div>
      <div className="s">{error === 'Счёт выставляет менеджер'
        ? 'Счёт-спецификацию по этому заказу пришлёт ваш менеджер M-Glass.'
        : (error || 'Попробуйте позже.')}</div>
      <Link href={`/partner/order/${id}`} className="s" style={{ display: 'inline-block', marginTop: 10, color: 'var(--blue)' }}>← К заказу</Link>
    </div></div>
  )

  return (
    <>
      <style>{'body{background:#ececea}'}</style>
      <div className="no-print" style={{ maxWidth: 820, margin: '0 auto', padding: '18px 16px 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Link href={`/partner/order/${id}`} className="ghost">‹ К заказу</Link>
        {data.entities.length > 1 && (
          <select value={entityId ?? ''} onChange={e => selectEntity(e.target.value)} className="ghost" style={{ padding: '8px 12px' }}>
            {data.entities.map(e => <option key={e.id} value={e.id}>{entityTitle(e)}{e.is_default ? ' · основное' : ''}</option>)}
          </select>
        )}
        <button onClick={() => document.fonts.ready.then(() => window.print())} className="ghost" style={{ marginLeft: 'auto' }}>🖨 Печать</button>
        <button onClick={downloadPdf} className="primary">⬇ Скачать PDF</button>
      </div>

      <InvoiceDocument ref={docRef} order={data.order} requisites={req} buyerName={buyerName} />
    </>
  )
}
