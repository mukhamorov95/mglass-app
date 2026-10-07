'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import UpdDocument from '@/components/UpdDocument'
import DocSkeleton from '@/components/DocSkeleton'
import { toast, loadJson } from '@/lib/toast'
import { saveUpdPdf } from '@/lib/b2b/updPdf'
import { issuedUpdView, type UpdIssued } from '@/lib/b2b/updView'

// Печать выданного УПД бухгалтером (этап 8): только из закреплённой копии в реестре —
// тот же документ, что у менеджера после выдачи, без доступа к самому заказу.

const money2 = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' })
const fmtDateTime = (s: string) => new Date(s).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function IssuedUpdClient({ orderId }: { orderId: string }) {
  const [issued, setIssued] = useState<UpdIssued | null>(null)
  const [error, setError] = useState<string | null>(null)
  const docRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadJson<{ issued: UpdIssued }>(`/api/accounting/upd/${encodeURIComponent(orderId)}`)
      .then(r => {
        if (r.error || !r.data) setError(r.error ?? 'УПД не найден')
        else setIssued(r.data.issued)
      })
  }, [orderId])

  async function printDoc() {
    await document.fonts.ready
    window.print()
  }

  async function downloadPdf() {
    if (!docRef.current || !issued) return
    try {
      await saveUpdPdf(docRef.current, `УПД-${issued.number}-${issued.year}.pdf`)
    } catch {
      toast.error('Не удалось сформировать PDF', {
        detail: 'Лист можно сохранить через «Печать» → Сохранить как PDF.',
        action: { label: 'Печать', onClick: () => window.print() },
      })
    }
  }

  if (error) return (
    <div className="p-8">
      <p className="text-[15px] font-semibold text-[#111110]">Документ недоступен</p>
      <p className="text-[13px] text-[#6b6b66] mt-1">{error}</p>
      <Link href="/accounting/upd" className="text-[13px] text-blue-600 hover:underline mt-3 inline-block">← К реестру УПД</Link>
    </div>
  )
  if (!issued) return <DocSkeleton rows={5} />

  const view = issuedUpdView(issued)
  const btn = 'text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] bg-white text-[#6b6b66] hover:text-[#111110] hover:border-[#111110] transition-colors'
  return (
    <>
      <style>{'body{background:#ececea}'}</style>
      <div className="no-print max-w-[1040px] mx-auto px-4 pt-4 flex flex-wrap items-center gap-2">
        <Link href="/accounting/upd" className={btn}>‹ К реестру УПД</Link>
        <button onClick={printDoc} className={`ml-auto ${btn}`}>🖨 Печать</button>
        <button onClick={downloadPdf} className={btn}>⬇ PDF</button>
      </div>
      <div className="no-print max-w-[1040px] mx-auto px-4 mt-3">
        <div className="px-4 py-2 rounded-lg border border-[#e4e4e0] bg-white text-[12px] text-[#111110]">
          ✓ УПД № {issued.number} от {fmtDate(issued.doc_date)} выдан{issued.issued_by_name ? ` · ${issued.issued_by_name}` : ''} · {fmtDateTime(issued.issued_at)}.
          <span className="text-[#6b6b66]"> Печатается из закреплённой копии: покупатель {view.buyer.name}, {money2(view.totals.sumIncVat)} ₽.</span>
        </div>
      </div>
      <UpdDocument ref={docRef} view={view} />
    </>
  )
}
