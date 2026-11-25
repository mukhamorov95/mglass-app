'use client'

import { useEffect, useRef, useState, use } from 'react'
import Link from 'next/link'
import { deliverPdf, useAutoDownload } from '@/lib/partner/docDownload'
import { entityTitle, type B2BLegalEntity } from '@/lib/b2bLegalEntities'
import InvoiceDocument, { type InvoiceOrder, type InvoiceRequisites } from '@/components/InvoiceDocument'

// Объединённый счёт кабинета (25.11.2026): тот же документ InvoiceDocument, строки всех заказов
// счёта, под каждой — номер заказа. Номер и сумма — из реестра счетов; оплата по нему
// раскладывается на заказы, УПД — на каждый заказ отдельно.

const EMPTY: InvoiceRequisites = { full_name: '', inn: '', kpp: '', ogrn: '', legal_address: '', bank_account: '', bank_name: '', bik: '', corr_account: '', supply_contract_no: '', supply_contract_date: '' }

function toReq(src: Record<string, unknown> | null | undefined): InvoiceRequisites {
  const s = (k: string) => (src?.[k] as string | null | undefined) ?? ''
  return {
    full_name: s('full_name') || s('name'), inn: s('inn'), kpp: s('kpp'), ogrn: s('ogrn'), legal_address: s('legal_address'),
    bank_account: s('bank_account'), bank_name: s('bank_name'), bik: s('bik'), corr_account: s('corr_account'),
    supply_contract_no: s('supply_contract_no'), supply_contract_date: s('supply_contract_date'),
  }
}

type Resp = { order: InvoiceOrder & { client_name?: string }; client: Record<string, unknown> | null; entities: B2BLegalEntity[]; payerEntityId: number | null; orders: { id: number; no: string }[]; basis?: string | null }

export default function PartnerCombinedInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<Resp | null>(null)
  const [req, setReq] = useState<InvoiceRequisites>(EMPTY)
  const [entityId, setEntityId] = useState<number | null>(null)
  const [buyerName, setBuyerName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const docRef = useRef<HTMLDivElement>(null)
  const [pdfErr, setPdfErr] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/partner/invoices/${id}`).then(async r => {
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setError(d.error || 'Счёт недоступен'); setLoading(false); return
      }
      const d = await r.json() as Resp
      setData(d)
      setBuyerName(d.order.client_name || (d.client?.name as string) || 'Клиент')
      const def = d.entities.find(e => e.id === d.payerEntityId) ?? d.entities.find(e => e.is_default) ?? d.entities[0] ?? null
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
    if (!docRef.current || !data) throw new Error('Документ не готов')
    setPdfErr(null)
    try {
      await deliverPdf(docRef.current, `Счёт-спецификация-${data.order.custom_number ?? data.order.id}.pdf`, 'portrait')
    } catch (e) {
      setPdfErr('Не удалось сформировать PDF — используйте «Печать» → «Сохранить как PDF».')
      throw e
    }
  }
  useAutoDownload({ ready: !loading && !!data, failed: loading ? null : error ?? (data ? null : 'Счёт недоступен'), run: downloadPdf })

  if (loading) return <div className="wrap"><div className="note"><div className="s">Загрузка…</div></div></div>
  if (error || !data) return (
    <div className="wrap"><div className="note">
      <div className="t">Счёт недоступен</div>
      <div className="s">{error || 'Попробуйте позже.'}</div>
      <Link href="/partner/documents" className="s" style={{ display: 'inline-block', marginTop: 10, color: 'var(--blue)' }}>← К документам</Link>
    </div></div>
  )

  return (
    <>
      <style>{'body{background:#ececea}'}</style>
      <div className="no-print" style={{ maxWidth: 820, margin: '0 auto', padding: '18px 16px 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Link href="/partner/documents" className="ghost">‹ К документам</Link>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Заказы: {data.orders.map(o => o.no).join(', ')}</span>
        {data.entities.length > 1 && (
          <select value={entityId ?? ''} onChange={e => selectEntity(e.target.value)} className="ghost" style={{ padding: '8px 12px' }}>
            {data.entities.map(e => <option key={e.id} value={e.id}>{entityTitle(e)}{e.is_default ? ' · основное' : ''}</option>)}
          </select>
        )}
        <button onClick={() => document.fonts.ready.then(() => window.print())} className="ghost" style={{ marginLeft: 'auto' }}>🖨 Печать</button>
        <button onClick={() => { void downloadPdf().catch(() => {}) }} className="primary">⬇ Скачать PDF</button>
        {pdfErr && <span style={{ flexBasis: '100%', fontSize: 12.5, color: '#b91c1c' }}>{pdfErr}</span>}
      </div>

      <InvoiceDocument ref={docRef} order={data.order} requisites={req} buyerName={buyerName} basis={data.basis ?? null} orderNos={data.orders.map(o => o.no)} />
    </>
  )
}
