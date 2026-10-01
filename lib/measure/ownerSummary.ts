// Сводка собственника по замерам за месяц — только то, по чему он решает
// (владелец 01.10: «как CEO — что я должен видеть, лишнего не нужно»).
// Новые и повторные — раздельно: «сколько реально новых замеров мы назначили за месяц».

import { companyOwes, type VisitPayment } from '@/lib/measure/money'
import { mskDate } from '@/lib/measure/slots'

export type OwnerRow = {
  id: number
  status: string
  is_repeat: boolean
  created_at: string
  scheduled_at: string | null
  visit_payment: VisitPayment | null
  fee_status: string
  measurer_fee: number | string | null
}
type Kind = { new: number; repeat: number }
export type OwnerSummary = {
  month: string                  // YYYY-MM по Москве
  created: Kind                  // заявок создано за месяц, без отменённых
  cancelled: number              // создано за месяц и отменено
  done: Kind                     // выполнено за месяц (по дате замера)
  pool: { count: number; oldestDays: number }
  issues: number                 // сложности без движения — ждут решения менеджера
  overdue: number                // время прошло, замерщик не отметил
  paidOnsite: { onsite: number; marked: number } // из выполненных за месяц с отмеченной оплатой
  owed: number                   // компания должна замерщикам гонорар — за всё время, не за месяц
}

const DAY = 86_400_000

export function summarizeOwner(rows: OwnerRow[], today: string): OwnerSummary {
  const month = today.slice(0, 7)
  const inMonth = (iso: string | null) => !!iso && mskDate(iso).slice(0, 7) === month
  const out: OwnerSummary = {
    month, created: { new: 0, repeat: 0 }, cancelled: 0, done: { new: 0, repeat: 0 },
    pool: { count: 0, oldestDays: 0 }, issues: 0, overdue: 0, paidOnsite: { onsite: 0, marked: 0 }, owed: 0,
  }
  const todayMs = new Date(`${today}T00:00:00Z`).getTime()
  const seen = new Set<number>()
  for (const r of rows) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    const kind = r.is_repeat ? 'repeat' : 'new'
    if (inMonth(r.created_at)) {
      if (r.status === 'cancelled') out.cancelled++
      else out.created[kind]++
    }
    if (r.status === 'done' && inMonth(r.scheduled_at)) {
      out.done[kind]++
      if (r.visit_payment) {
        out.paidOnsite.marked++
        if (r.visit_payment === 'onsite') out.paidOnsite.onsite++
      }
    }
    if (r.status === 'new') {
      out.pool.count++
      const days = Math.floor((todayMs - new Date(`${mskDate(r.created_at)}T00:00:00Z`).getTime()) / DAY)
      out.pool.oldestDays = Math.max(out.pool.oldestDays, days)
    }
    if (r.status === 'issue') out.issues++
    if (r.status === 'scheduled' && r.scheduled_at && mskDate(r.scheduled_at) < today) out.overdue++
    out.owed += companyOwes(r)
  }
  return out
}

