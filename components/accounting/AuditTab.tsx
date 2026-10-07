'use client'

// Б14: проверка. То же, что уходит владельцу утренней сводкой, только целиком —
// включая мелочи, которые в Telegram не шлём.

import { useEffect, useState } from 'react'
import { loadJson } from '@/lib/toast'

type Finding = {
  code: string; severity: 'high' | 'normal' | 'low'
  title: string; detail: string; amount?: number; count?: number
}

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const META: Record<Finding['severity'], { label: string; cls: string; dot: string }> = {
  high:   { label: 'срочно',  cls: 'border-red-200 bg-red-50',       dot: 'bg-red-500' },
  normal: { label: 'к работе', cls: 'border-amber-200 bg-amber-50',  dot: 'bg-amber-500' },
  low:    { label: 'заметка', cls: 'border-[#e4e4e0] bg-white',      dot: 'bg-[#c9c9c4]' },
}
export type AuditGoTab = 'unposted' | 'bank' | 'entry' | 'committee' | 'docs' | 'taxes' | 'payroll' | 'odds'

// Куда идти с находкой — кнопкой, а не подписью «Смотреть: вкладка…».
const WHERE: Record<string, { tab: AuditGoTab; label: string }> = {
  unposted_payments: { tab: 'unposted', label: 'Провести' },
  bank_rows_stale: { tab: 'bank', label: 'Разнести выписку' },
  duplicate_entries: { tab: 'entry', label: 'Открыть операции' },
  requests_hanging: { tab: 'committee', label: 'Открыть комитет' },
  invoices_unpaid: { tab: 'docs', label: 'Открыть счета' },
  tax_overdue: { tab: 'taxes', label: 'Открыть налоги' },
  tax_soon: { tab: 'taxes', label: 'Открыть налоги' },
  payroll_debt: { tab: 'payroll', label: 'Открыть зарплату' },
  month_open: { tab: 'odds', label: 'Закрыть месяц в ОДДС' },
}

export function AuditTab({ today, onGo }: { today: string; onGo: (tab: AuditGoTab) => void }) {
  const [findings, setFindings] = useState<Finding[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    loadJson<{ findings: Finding[] }>(`/api/accounting/audit?today=${today}`).then(res => {
      if (!alive) return
      if (res.error !== null) setError(res.error)
      else { setFindings(res.data.findings); setError(null) }
      setLoading(false)
    })
    return () => { alive = false }
  }, [today])

  if (loading) return <p className="text-[13px] text-[#9a9a95] py-6 text-center">Проверяю…</p>
  if (error) return <p className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-[13px]">Проверка не загрузилась: {error}</p>

  if (!findings.length) {
    return (
      <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-10 text-center">
        <p className="text-[15px] text-[#111110] font-medium">Расхождений нет</p>
        <p className="text-[13px] text-[#9a9a95] mt-1">
          Всё проведено, дублей не видно, сроки не горят.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-[13px] text-[#6b6b66]">
        Проверка на {today.slice(8, 10)}.{today.slice(5, 7)}. Срочное и «к работе» уходит владельцу утренней сводкой,
        заметки — только здесь.
      </p>
      {findings.map(f => {
        const m = META[f.severity]
        return (
          <div key={f.code} className={`rounded-xl border px-4 py-3 ${m.cls}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-[#111110] flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
                  {f.title}
                </p>
                <p className="text-[13px] text-[#6b6b66] mt-1">{f.detail}</p>
                {WHERE[f.code] && (
                  <button onClick={() => onGo(WHERE[f.code].tab)}
                    className="mt-2 px-3 py-1 rounded-lg border border-[#111110] text-[12px] font-medium text-[#111110] bg-white">
                    {WHERE[f.code].label} →
                  </button>
                )}
              </div>
              {f.amount ? (
                <span className="text-[14px] font-mono font-semibold text-[#111110] flex-shrink-0">{RUB(f.amount)}</span>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
