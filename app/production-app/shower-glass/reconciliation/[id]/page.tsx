'use client'

// Сохранённый акт сверки: цифры на момент сохранения, не меняются вслед за заказами и оплатами.

import { use, useEffect, useRef, useState } from 'react'
import SheetActions from '@/components/SheetActions'
import { loadJson } from '@/lib/toast'
import type { ReconDoc } from '@/lib/production/clientReconciliation'
import ReconciliationDoc from '../../ReconciliationDoc'
import { fmtDay } from '../../types'

type Saved = { id: number; snapshot: ReconDoc; created_at: string; created_by_name: string | null }

export default function SavedReconciliationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<Saved | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sheet = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadJson<Saved>(`/api/production/client-reconciliation?id=${encodeURIComponent(id)}`).then(r => {
      if (r.error !== null) setError(r.error)
      else setData(r.data)
    })
  }, [id])

  if (error) return <p className="p-6 text-[13px] text-red-700">Не удалось загрузить: {error}. Обновите страницу.</p>
  if (!data) return <p className="p-6 text-[13px] text-[#9a9a95]">Загружаю…</p>
  const doc = data.snapshot
  const saved = `Акт № ${data.id}, составлен ${fmtDay(data.created_at.slice(0, 10))}${data.created_by_name ? `, ${data.created_by_name}` : ''}.`

  return (
    <div className="min-h-screen bg-white p-4 sm:p-6 text-[#111110] print:p-0">
      <div className="max-w-[210mm] mx-auto space-y-4 print:max-w-none">
        <SheetActions sheet={sheet} fileName={`Акт сверки ${doc.clientName} ${fmtDay(doc.from)}-${fmtDay(doc.to)}, №${data.id}.pdf`} backHref="/production-app/shower-glass?tab=recon" backLabel="К актам сверки" />
        <div className="overflow-x-auto print:overflow-visible">
          <div ref={sheet} className="w-[190mm] mx-auto bg-white print:w-auto">
            <ReconciliationDoc doc={doc} caption={saved} />
          </div>
        </div>
      </div>
    </div>
  )
}
