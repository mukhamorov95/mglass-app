'use client'

// Б14: проверка. То же, что уходит владельцу утренней сводкой, только целиком —
// включая мелочи, которые в Telegram не шлём.

import { useCallback, useEffect, useState } from 'react'

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
const WHERE: Record<string, string> = {
  unposted_payments: 'вкладка «К проведению»',
  bank_rows_stale: 'вкладка «Выписка»',
  duplicate_entries: 'вкладка «Ввод операций»',
  requests_hanging: 'вкладка «Комитет»',
  invoices_unpaid: 'вкладка «Документы»',
  tax_overdue: 'вкладка «Налоги»',
  tax_soon: 'вкладка «Налоги»',
  payroll_debt: 'вкладка «Зарплата»',
  month_open: 'ОДДС, кнопка «Закрыть месяц»',
}

export function AuditTab({ today }: { today: string }) {
  const [findings, setFindings] = useState<Finding[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`/api/accounting/audit?today=${today}`)
    if (r.ok) setFindings((await r.json()).findings as Finding[])
    setLoading(false)
  }, [today])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  if (loading) return <p className="text-[13px] text-[#9a9a95] py-6 text-center">Проверяю…</p>

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
                {WHERE[f.code] && <p className="text-[12px] text-[#9a9a95] mt-1">Смотреть: {WHERE[f.code]}</p>}
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
