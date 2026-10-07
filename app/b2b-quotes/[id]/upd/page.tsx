'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { renderDocCanvas } from '@/lib/pdfCapture'
import { entityTitle, type B2BLegalEntity } from '@/lib/b2bLegalEntities'
import UpdDocument from '@/components/UpdDocument'
import type { InvoiceOrder, InvoiceRequisites } from '@/components/InvoiceDocument'
import DocSkeleton from '@/components/DocSkeleton'
import { toast } from '@/lib/toast'
import { updDocDate } from '@/lib/b2b/updLines'
import type { UpdRegistered } from '@/lib/b2b/updRegistry'

// А7 маршрута менеджерского контура: УПД у менеджера — тот же документ, что в кабинете
// партнёра (components/UpdDocument), но на менеджерских данных /api/quotes/[id]/invoice-data.
// Реквизиты покупателя редактируются на странице счёта — здесь только выбор юрлица,
// чтобы два документа не разошлись по источнику правды.

const EMPTY: InvoiceRequisites = {
  full_name: '', inn: '', kpp: '', ogrn: '', legal_address: '',
  bank_account: '', bank_name: '', bik: '', corr_account: '',
  supply_contract_no: '', supply_contract_date: '',
}

function toReq(src: Record<string, unknown> | null | undefined): InvoiceRequisites {
  const s = (k: string) => (src?.[k] as string | null | undefined) ?? ''
  return {
    full_name: s('full_name') || s('name'), inn: s('inn'), kpp: s('kpp'), ogrn: s('ogrn'),
    legal_address: s('legal_address'), bank_account: s('bank_account'), bank_name: s('bank_name'),
    bik: s('bik'), corr_account: s('corr_account'),
    supply_contract_no: s('supply_contract_no'), supply_contract_date: s('supply_contract_date'),
  }
}

type Resp = {
  order: InvoiceOrder & { client_name?: string }
  client: Record<string, unknown> | null
  entities: B2BLegalEntity[]
  payerEntityId?: number | null
  paymentDates?: string[]
  updRegistered?: UpdRegistered | null
}

export default function ManagerUpdPage() {
  const params = useParams()
  const id = Number(params.id)

  const [data, setData] = useState<Resp | null>(null)
  const [req, setReq] = useState<InvoiceRequisites>(EMPTY)
  const [entityId, setEntityId] = useState<number | null>(null)
  const [buyerName, setBuyerName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const docRef = useRef<HTMLDivElement>(null)
  const [registered, setRegistered] = useState<UpdRegistered | null>(null)

  useEffect(() => {
    if (!id) return
    fetch(`/api/quotes/${id}/invoice-data`).then(async r => {
      if (!r.ok) { setError(r.status === 403 ? 'Нет доступа к этому заказу' : 'Заказ не найден'); setLoading(false); return }
      const d = await r.json() as Resp
      setData(d)
      setRegistered(d.updRegistered ?? null)
      setBuyerName(d.order.client_name || (d.client?.name as string) || 'Клиент')
      const list = d.entities ?? []
      // Покупатель — тот, кому выставлен счёт; без счёта — основное юрлицо клиента.
      const def = list.find(e => e.id === d.payerEntityId) ?? list.find(e => e.is_default) ?? list[0] ?? null
      if (def) { setEntityId(def.id); setReq(toReq(def as unknown as Record<string, unknown>)) }
      else if (d.client) setReq(toReq(d.client))
      setLoading(false)
    }).catch(() => { setError('Сеть недоступна'); setLoading(false) })
  }, [id])

  function selectEntity(val: string) {
    const e = data?.entities.find(x => x.id === Number(val))
    if (e) { setEntityId(e.id); setReq(toReq(e as unknown as Record<string, unknown>)) }
  }

  // Сквозной номер выдаётся при первой печати/PDF и только отгруженному заказу: иначе
  // в реестре навсегда закрепилась бы дата запуска вместо даты отгрузки.
  async function ensureNumber(): Promise<UpdRegistered | null> {
    if (registered || !data) return registered
    let notes: Record<string, unknown> = {}
    try { notes = data.order.notes ? JSON.parse(data.order.notes) : {} } catch {}
    if (updDocDate(notes, data.order.created_at).source !== 'shipped') {
      toast.info('УПД без сквозного номера', { detail: 'Номер выдаётся после отметки «Отгружен» в заказах — тогда дата документа = дата отгрузки.' })
      return null
    }
    const r = await fetch(`/api/quotes/${id}/upd-number`, { method: 'POST' })
    const j = await r.json().catch(() => ({})) as { registered?: UpdRegistered | null; pendingSql?: boolean; error?: string }
    if (!r.ok) { toast.error('Номер УПД не выдан', { detail: j.error ?? `ошибка ${r.status}` }); return null }
    if (j.pendingSql) { toast.info('УПД с номером заказа', { detail: 'Сквозная нумерация включится после SQL владельца (20261007_upd_registry.sql).' }); return null }
    if (j.registered) setRegistered(j.registered)
    return j.registered ?? null
  }

  // Номер должен попасть в документ до снимка/печати — ждём перерисовку.
  const afterRender = () => new Promise<void>(res => requestAnimationFrame(() => requestAnimationFrame(() => res())))

  async function printDoc() {
    await ensureNumber()
    await afterRender()
    await document.fonts.ready
    window.print()
  }

  async function downloadPdf() {
    if (!docRef.current || !data) return
    const reg = await ensureNumber()
    await afterRender()
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
      pdf.save(`УПД-${reg ? `${reg.number}-${reg.year}` : data.order.custom_number?.trim() || String(data.order.id).padStart(5, '0')}.pdf`)
    } catch {
      toast.error('Не удалось сформировать PDF', {
        detail: 'Лист можно сохранить через «Печать» → Сохранить как PDF.',
        action: { label: 'Печать', onClick: () => window.print() },
      })
    }
  }

  if (loading) return <DocSkeleton rows={5} />
  if (error || !data) return (
    <div className="p-8">
      <p className="text-[15px] font-semibold text-[#111110]">Документ недоступен</p>
      <p className="text-[13px] text-[#6b6b66] mt-1">{error}</p>
      <Link href="/b2b-orders" className="text-[13px] text-blue-600 hover:underline mt-3 inline-block">← К заказам</Link>
    </div>
  )

  return (
    <>
      <style>{'body{background:#ececea}'}</style>
      <div className="no-print max-w-[1040px] mx-auto px-4 pt-4 flex flex-wrap items-center gap-2">
        <Link href="/b2b-orders"
          className="text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] bg-white text-[#6b6b66] hover:text-[#111110] hover:border-[#111110] transition-colors">‹ К заказам</Link>
        <Link href={`/b2b-quotes/${id}/invoice`}
          className="text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] bg-white text-[#6b6b66] hover:text-[#111110] hover:border-[#111110] transition-colors">🧾 Счёт</Link>
        {data.entities.length > 1 && (
          <select value={entityId ?? ''} onChange={e => selectEntity(e.target.value)}
            className="text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] bg-white text-[#6b6b66] outline-none">
            {data.entities.map(e => (
              <option key={e.id} value={e.id}>{entityTitle(e)}{e.is_default ? ' · основное' : ''}</option>
            ))}
          </select>
        )}
        {!req.inn && (
          <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
            Нет ИНН покупателя — заполните реквизиты на странице счёта
          </span>
        )}
        <button onClick={printDoc}
          className="ml-auto text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] bg-white text-[#6b6b66] hover:text-[#111110] hover:border-[#111110] transition-colors">🖨 Печать</button>
        <button onClick={downloadPdf}
          className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] transition-colors">⬇ Скачать PDF</button>
      </div>

      <UpdDocument ref={docRef} order={data.order} requisites={req} buyerName={buyerName} paymentDates={data.paymentDates ?? []} registered={registered} />
    </>
  )
}
