'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import UpdDocument from '@/components/UpdDocument'
import DocSkeleton from '@/components/DocSkeleton'
import { toast, loadJson, responseError, NETWORK_ERROR } from '@/lib/toast'
import { confirmDialog } from '@/lib/dialog'
import { entityTitle } from '@/lib/b2bLegalEntities'
import { saveUpdPdf } from '@/lib/b2b/updPdf'
import { issuedUpdView, type UpdBody, type UpdIssued, type UpdView } from '@/lib/b2b/updView'

// УПД заказа у бухгалтера (этапы 8 и 8б docs/b2b/ORDER_PANEL_ROUTE.md). Выданный печатается
// из закреплённой копии. Невыданный — черновик с водяным знаком: его собирает сервер, здесь
// выбираются только юрлицо и дата. «Выдать» — та же выдача, что у менеджера.

type Draft = {
  orderId: number
  orderRef: string
  clientName: string
  entities: { id: number; full_name: string | null; inn: string | null; kpp: string | null; is_default: boolean }[]
  entityId: number | null
  docDate: string
  body: UpdBody | null
  buyerError: string | null
  blockers: string[]
  dateError: string | null
  launched: boolean
  archived: boolean
  shippedDay: string | null
  shippedBeforeSwitch: boolean
  series: { pendingSql: boolean; year: number; set: boolean; switchDay: string | null; nextNumber: number | null; lastNumber: number | null; lastDate: string | null }
}
type Resp = { issued?: UpdIssued; draft?: Draft }

const money2 = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDay = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}
const fmtDateTime = (s: string) => new Date(s).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const btn = 'text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] bg-white text-[#6b6b66] hover:text-[#111110] hover:border-[#111110] transition-colors'
const warn = 'px-4 py-2 rounded-lg border border-amber-300 bg-amber-50 text-[12px] text-amber-800'

export default function UpdOrderClient({ orderId }: { orderId: string }) {
  const [sel, setSel] = useState<{ entityId?: number; docDate?: string }>({})
  const [res, setRes] = useState<(Resp & { key: string }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [issuing, setIssuing] = useState(false)
  const docRef = useRef<HTMLDivElement>(null)

  const key = `${sel.entityId ?? ''}|${sel.docDate ?? ''}`
  useEffect(() => {
    let alive = true
    const k = `${sel.entityId ?? ''}|${sel.docDate ?? ''}`
    const q = new URLSearchParams()
    if (sel.entityId != null) q.set('entity_id', String(sel.entityId))
    if (sel.docDate) q.set('doc_date', sel.docDate)
    loadJson<Resp>(`/api/accounting/upd/${encodeURIComponent(orderId)}?${q}`).then(r => {
      if (!alive) return
      if (r.error || !r.data) setError(r.error ?? 'УПД не найден')
      else { setRes({ ...r.data, key: k }); setError(null) }
    })
    return () => { alive = false }
  }, [orderId, sel.entityId, sel.docDate])
  // Черновик под новые юрлицо или дату ещё не пришёл — выдавать по старому нельзя.
  const stale = !!res && res.key !== key

  const issued = res?.issued ?? null
  const draft = res?.draft ?? null
  const view: UpdView | null = issued ? issuedUpdView(issued)
    : draft?.body ? { ...draft.body, number: 'б/н', docDate: draft.docDate } : null

  async function issue() {
    if (!draft?.body || draft.series.nextNumber == null || issuing || stale) return
    const s = draft.series
    const late = s.lastDate && draft.docDate < s.lastDate
      ? ` Дата раньше последнего выданного УПД (№ ${s.lastNumber} от ${fmtDay(s.lastDate)}).` : ''
    const before = draft.shippedBeforeSwitch && draft.shippedDay && s.switchDay
      ? ` Внимание: отгружен ${fmtDay(draft.shippedDay)}, до включения серии (${fmtDay(s.switchDay)}) — УПД на эту отгрузку мог выписать программа.` : ''
    const ok = await confirmDialog({
      title: `Выдать УПД № ${s.nextNumber} от ${fmtDay(draft.docDate)}?`,
      text: `Покупатель: ${draft.body.buyer.name}, ИНН ${draft.body.buyer.inn}. Сумма ${money2(draft.body.totals.sumIncVat)} ₽, НДС ${money2(draft.body.totals.vat)} ₽.` +
        ` Номер, дата, строки и покупатель закрепятся навсегда: правка заказа после выдачи документ не изменит.${late}${before}`,
      confirmLabel: 'Выдать',
    })
    if (!ok) return
    setIssuing(true)
    try {
      const r = await fetch(`/api/accounting/upd/${encodeURIComponent(orderId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_date: draft.docDate, entity_id: draft.entityId }),
      })
      if (!r.ok) { toast.error('УПД не выдан', { detail: await responseError(r) }); return }
      const j = await r.json() as { issued: UpdIssued; already: boolean }
      setRes(cur => cur ? { ...cur, issued: j.issued } : cur)
      toast.success(j.already ? `УПД № ${j.issued.number} уже был выдан` : `УПД № ${j.issued.number} выдан`, {
        detail: 'Он в реестре «Бухгалтерия → УПД»; печать и PDF — на этой странице, без водяного знака.',
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
    if (!docRef.current || !view) return
    try {
      await saveUpdPdf(docRef.current, issued ? `УПД-${issued.number}-${issued.year}.pdf` : `УПД-черновик-${view.orderNumber}.pdf`)
    } catch {
      toast.error('Не удалось сформировать PDF', {
        detail: 'Лист можно сохранить через «Печать» → Сохранить как PDF.',
        action: { label: 'Печать', onClick: () => window.print() },
      })
    }
  }

  if (error && !res) return (
    <div className="p-8">
      <p className="text-[15px] font-semibold text-[#111110]">Документ недоступен</p>
      <p className="text-[13px] text-[#6b6b66] mt-1">{error}</p>
      <Link href="/accounting/upd" className="text-[13px] text-blue-600 hover:underline mt-3 inline-block">← К реестру УПД</Link>
    </div>
  )
  if (!res) return <DocSkeleton rows={5} />

  const s = draft?.series
  const issueHint = !draft || issued ? null
    : s?.pendingSql ? 'Выдача УПД включится после SQL владельца (20261007_upd_registry.sql).'
    : !s?.set ? `Нумерация УПД на ${s?.year} год не включена — задайте первый номер в «Бухгалтерия → УПД».`
    : !draft.launched ? 'Заказ не запущен — это просчёт, УПД по нему не выдаётся.'
    : draft.archived ? 'Заказ в архиве — УПД по нему не выдаётся.'
    : draft.dateError ? `Дата УПД: ${draft.dateError}.`
    : draft.buyerError ? draft.buyerError
    : draft.blockers.length ? `Нельзя выдать: ${draft.blockers.join(', ')}.`
    : null

  return (
    <>
      <style>{'body{background:#ececea}'}</style>
      <div className="no-print max-w-[1040px] mx-auto px-4 pt-4 flex flex-wrap items-center gap-2">
        <Link href="/accounting/upd" className={btn}>‹ К реестру УПД</Link>
        {draft && !issued && (
          <span className="text-[12px] text-[#6b6b66]">Заказ {draft.orderRef} · {draft.clientName}</span>
        )}
        {draft && !issued && draft.entities.length > 1 && (
          <select value={draft.entityId ?? ''} onChange={e => setSel(v => ({ ...v, entityId: Number(e.target.value) }))}
            className="text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] bg-white text-[#6b6b66] outline-none">
            {draft.entities.map(e => (
              <option key={e.id} value={e.id}>{entityTitle(e)}{e.is_default ? ' · основное' : ''}</option>
            ))}
          </select>
        )}
        {draft && !issued && (
          <label className="text-[12px] text-[#6b6b66] flex items-center gap-1.5">
            Дата УПД
            <input type="date" value={sel.docDate ?? draft.docDate} onChange={e => e.target.value && setSel(v => ({ ...v, docDate: e.target.value }))}
              className="text-[12px] px-2 py-1 rounded-lg border border-[#e4e4e0] bg-white text-[#111110] outline-none" />
          </label>
        )}
        <button onClick={printDoc} disabled={!view} className={`ml-auto ${btn} disabled:opacity-40`}>🖨 Печать</button>
        <button onClick={downloadPdf} disabled={!view} className={`${btn} disabled:opacity-40`}>⬇ PDF</button>
        {draft && !issued && (
          <button onClick={issue} disabled={!!issueHint || issuing || stale || s?.nextNumber == null}
            className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {issuing ? 'Выдаю…' : s?.nextNumber != null && !issueHint ? `Выдать УПД № ${s.nextNumber}` : 'Выдать УПД'}
          </button>
        )}
      </div>

      <div className="no-print max-w-[1040px] mx-auto px-4 mt-3 space-y-2">
        {issued ? (
          <div className="px-4 py-2 rounded-lg border border-[#e4e4e0] bg-white text-[12px] text-[#111110]">
            ✓ УПД № {issued.number} от {fmtDay(issued.doc_date)} выдан{issued.issued_by_name ? ` · ${issued.issued_by_name}` : ''} · {fmtDateTime(issued.issued_at)}.
            <span className="text-[#6b6b66]"> Печатается из закреплённой копии: покупатель {issued.snapshot.buyer.name}, {money2(issued.snapshot.totals.sumIncVat)} ₽.</span>
          </div>
        ) : draft && (
          <>
            <div className={warn}>
              Черновик: номер не присвоен, на печати — водяной знак «ЧЕРНОВИК».
              {issueHint ? ` ${issueHint}` : ' Проверьте покупателя и дату и нажмите «Выдать».'}
            </div>
            {draft.shippedBeforeSwitch && draft.shippedDay && s?.switchDay && (
              <div className="px-4 py-2 rounded-lg border border-red-200 bg-red-50 text-[12px] text-red-700">
                Отгружен {fmtDay(draft.shippedDay)} — до включения серии ({fmtDay(s.switchDay)}). УПД на эту отгрузку, скорее всего,
                уже выписан в программе: проверьте там, прежде чем выдавать второй.
              </div>
            )}
            {draft.body && !draft.body.buyer.inn && (
              <div className={warn}>Нет ИНН покупателя — реквизиты заполняет менеджер на странице счёта заказа.</div>
            )}
          </>
        )}
        {error && <div className={warn}>{error}</div>}
      </div>

      {view && <UpdDocument ref={docRef} view={view} draft={!issued} />}
    </>
  )
}
