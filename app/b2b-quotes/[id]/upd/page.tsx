'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { saveUpdPdf } from '@/lib/b2b/updPdf'
import { entityTitle, type B2BLegalEntity } from '@/lib/b2bLegalEntities'
import UpdDocument from '@/components/UpdDocument'
import type { InvoiceOrder, InvoiceRequisites } from '@/lib/b2b/invoiceMath'
import DocSkeleton from '@/components/DocSkeleton'
import { toast, loadJson, responseError, NETWORK_ERROR } from '@/lib/toast'
import { confirmDialog } from '@/lib/dialog'
import { updDocDate } from '@/lib/b2b/updLines'
import { buildUpdBody, draftUpdView, issuedUpdView, moscowDate, nextUpdNumber, updDateError, updIssueBlockers, type UpdIssued } from '@/lib/b2b/updView'
import type { UpdSeriesState } from '@/lib/b2b/updRegistry'

// А7 маршрута менеджерского контура: УПД у менеджера — тот же документ, что в кабинете
// партнёра (components/UpdDocument). Этап 7 docs/b2b/ORDER_PANEL_ROUTE.md: пока УПД не выдан,
// это черновик с водяным знаком; «Выдать» присваивает номер из серии бухгалтера и закрепляет
// содержимое. Реквизиты покупателя правятся на странице счёта — здесь только выбор юрлица.

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
}
type UpdState = { issued: UpdIssued | null; series: UpdSeriesState[]; pendingSql: boolean; canIssue: boolean }

const money2 = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' })
const fmtDateTime = (s: string) => new Date(s).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function ManagerUpdPage() {
  const params = useParams()
  const id = Number(params.id)

  const [data, setData] = useState<Resp | null>(null)
  const [upd, setUpd] = useState<UpdState | null>(null)
  const [req, setReq] = useState<InvoiceRequisites>(EMPTY)
  const [entityId, setEntityId] = useState<number | null>(null)
  const [buyerName, setBuyerName] = useState('')
  const [docDate, setDocDate] = useState(moscowDate())
  const [issuing, setIssuing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const docRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!id) return
    Promise.all([
      loadJson<Resp>(`/api/quotes/${id}/invoice-data`),
      loadJson<UpdState>(`/api/quotes/${id}/upd-issue`),
    ]).then(([inv, st]) => {
      if (inv.error || !inv.data) { setError(inv.error ?? 'Заказ не найден'); setLoading(false); return }
      const d = inv.data
      setData(d)
      // Без состояния реестра выдать нельзя, но черновик показать можно.
      setUpd(st.data ?? { issued: null, series: [], pendingSql: true, canIssue: false })
      if (st.error) toast.error('Не загрузилось состояние УПД', { detail: st.error })
      setBuyerName(d.order.client_name || (d.client?.name as string) || 'Клиент')
      const list = d.entities ?? []
      // Покупатель — тот, кому выставлен счёт; без счёта — основное юрлицо клиента.
      const def = list.find(e => e.id === d.payerEntityId) ?? list.find(e => e.is_default) ?? list[0] ?? null
      if (def) { setEntityId(def.id); setReq(toReq(def as unknown as Record<string, unknown>)) }
      else if (d.client) setReq(toReq(d.client))
      // Дата по умолчанию — отметка «Отгружен», если она уже была; иначе сегодня.
      let notes: Record<string, unknown> = {}
      try { notes = d.order.notes ? JSON.parse(d.order.notes) : {} } catch {}
      const dd = updDocDate(notes, d.order.created_at)
      const today = moscowDate()
      if (dd.source === 'shipped' && moscowDate(dd.date) <= today) setDocDate(moscowDate(dd.date))
      setLoading(false)
    })
  }, [id])

  function selectEntity(val: string) {
    const e = data?.entities.find(x => x.id === Number(val))
    if (e) { setEntityId(e.id); setReq(toReq(e as unknown as Record<string, unknown>)) }
  }

  const issued = upd?.issued ?? null
  const view = useMemo(() => {
    if (issued) return issuedUpdView(issued)
    if (!data) return null
    return draftUpdView(data.order, req, buyerName, docDate)
  }, [issued, data, req, buyerName, docDate])

  const year = Number(docDate.slice(0, 4))
  const series = upd?.series.find(s => s.year === year) ?? null
  const nextNumber = series ? nextUpdNumber(series.start_number, series.last_number) : null
  const dateErr = data ? updDateError(docDate, data.order.created_at, moscowDate()) : null
  const blockers = view && !issued ? updIssueBlockers(view) : []
  // Расхождение заказа с выданным УПД: документ не меняется, но человек должен это видеть.
  const currentTotal = data && issued ? buildUpdBody(data.order, req, buyerName, issued.doc_date).totals.sumIncVat : null

  async function issue() {
    if (!view || !data || nextNumber == null || issuing) return
    const late = series?.last_date && docDate < series.last_date
      ? ` Дата раньше последнего выданного УПД (№ ${series.last_number} от ${fmtDate(series.last_date)}).` : ''
    const ok = await confirmDialog({
      title: `Выдать УПД № ${nextNumber} от ${fmtDate(docDate)}?`,
      text: `Покупатель: ${view.buyer.name}, ИНН ${view.buyer.inn}. Сумма ${money2(view.totals.sumIncVat)} ₽, НДС ${money2(view.totals.vat)} ₽.` +
        ` Номер, дата, строки и покупатель закрепятся навсегда: правка заказа после выдачи документ не изменит.${late}`,
      confirmLabel: 'Выдать',
    })
    if (!ok) return
    setIssuing(true)
    try {
      const r = await fetch(`/api/quotes/${id}/upd-issue`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_date: docDate, entity_id: entityId }),
      })
      if (!r.ok) { toast.error('УПД не выдан', { detail: await responseError(r) }); return }
      const j = await r.json() as { issued: UpdIssued; already: boolean }
      setUpd(u => u ? { ...u, issued: j.issued } : u)
      toast.success(j.already ? `УПД № ${j.issued.number} уже был выдан` : `УПД № ${j.issued.number} выдан`, {
        detail: 'Номер и содержимое закреплены. Печать и PDF — на этой странице, без водяного знака.',
      })
    } catch {
      toast.error('УПД не выдан', { detail: NETWORK_ERROR })
    } finally {
      setIssuing(false)
    }
  }

  async function printDoc() {
    await document.fonts.ready
    window.print()
  }

  async function downloadPdf() {
    if (!docRef.current || !data || !view) return
    try {
      await saveUpdPdf(docRef.current, issued ? `УПД-${issued.number}-${issued.year}.pdf` : `УПД-черновик-${view.orderNumber}.pdf`)
    } catch {
      toast.error('Не удалось сформировать PDF', {
        detail: 'Лист можно сохранить через «Печать» → Сохранить как PDF.',
        action: { label: 'Печать', onClick: () => window.print() },
      })
    }
  }

  if (loading) return <DocSkeleton rows={5} />
  if (error || !data || !view) return (
    <div className="p-8">
      <p className="text-[15px] font-semibold text-[#111110]">Документ недоступен</p>
      <p className="text-[13px] text-[#6b6b66] mt-1">{error}</p>
      <Link href="/b2b-orders" className="text-[13px] text-blue-600 hover:underline mt-3 inline-block">← К заказам</Link>
    </div>
  )

  const btn = 'text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] bg-white text-[#6b6b66] hover:text-[#111110] hover:border-[#111110] transition-colors'
  const issueHint = !upd?.canIssue ? null
    : upd.pendingSql ? 'Выдача УПД включится после SQL владельца (20261007_upd_registry.sql)'
    : !series ? `Нумерация УПД на ${year} год не включена: первый номер задаёт бухгалтер в «Бухгалтерия → УПД». До этого УПД выписывает программа.`
    : dateErr ? `Дата УПД: ${dateErr}`
    : blockers.length ? `Нельзя выдать: ${blockers.join(', ')}`
    : null

  return (
    <>
      <style>{'body{background:#ececea}'}</style>
      <div className="no-print max-w-[1040px] mx-auto px-4 pt-4 flex flex-wrap items-center gap-2">
        <Link href="/b2b-orders" className={btn}>‹ К заказам</Link>
        <Link href={`/b2b-quotes/${id}/invoice`} className={btn}>🧾 Счёт</Link>
        {!issued && data.entities.length > 1 && (
          <select value={entityId ?? ''} onChange={e => selectEntity(e.target.value)}
            className="text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] bg-white text-[#6b6b66] outline-none">
            {data.entities.map(e => (
              <option key={e.id} value={e.id}>{entityTitle(e)}{e.is_default ? ' · основное' : ''}</option>
            ))}
          </select>
        )}
        {!issued && (
          <label className="text-[12px] text-[#6b6b66] flex items-center gap-1.5">
            Дата УПД
            <input type="date" value={docDate} onChange={e => e.target.value && setDocDate(e.target.value)}
              className="text-[12px] px-2 py-1 rounded-lg border border-[#e4e4e0] bg-white text-[#111110] outline-none" />
          </label>
        )}
        <button onClick={printDoc} className={`ml-auto ${btn}`}>🖨 Печать</button>
        <button onClick={downloadPdf} className={btn}>⬇ PDF</button>
        {!issued && upd?.canIssue && (
          <button onClick={issue} disabled={!!issueHint || issuing || nextNumber == null}
            className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {issuing ? 'Выдаю…' : nextNumber != null && !issueHint ? `Выдать УПД № ${nextNumber}` : 'Выдать УПД'}
          </button>
        )}
      </div>

      <div className="no-print max-w-[1040px] mx-auto px-4 mt-3 space-y-2">
        {issued ? (
          <div className="px-4 py-2 rounded-lg border border-[#e4e4e0] bg-white text-[12px] text-[#111110]">
            ✓ УПД № {issued.number} от {fmtDate(issued.doc_date)} выдан{issued.issued_by_name ? ` · ${issued.issued_by_name}` : ''} · {fmtDateTime(issued.issued_at)}.
            <span className="text-[#6b6b66]"> Печатается из закреплённой копии: покупатель {view.buyer.name}, {money2(view.totals.sumIncVat)} ₽.</span>
          </div>
        ) : (
          <div className="px-4 py-2 rounded-lg border border-amber-300 bg-amber-50 text-[12px] text-amber-800">
            Черновик: номер не присвоен, на печати — водяной знак «ЧЕРНОВИК».
            {issueHint ? ` ${issueHint}` : ' Проверьте дату и покупателя и нажмите «Выдать».'}
          </div>
        )}
        {!issued && !req.inn && (
          <div className="px-4 py-2 rounded-lg border border-amber-300 bg-amber-50 text-[12px] text-amber-800">
            Нет ИНН покупателя — заполните реквизиты на <Link href={`/b2b-quotes/${id}/invoice`} className="underline">странице счёта</Link>.
          </div>
        )}
        {issued && currentTotal != null && Math.abs(currentTotal - issued.snapshot.totals.sumIncVat) >= 0.01 && (
          <div className="px-4 py-2 rounded-lg border border-amber-300 bg-amber-50 text-[12px] text-amber-800">
            Заказ изменён после выдачи: сейчас {money2(currentTotal)} ₽, в УПД {money2(issued.snapshot.totals.sumIncVat)} ₽.
            Выданный документ не меняется — исправление УПД оформляет бухгалтер.
          </div>
        )}
      </div>

      <UpdDocument ref={docRef} view={view} draft={!issued} />
    </>
  )
}
