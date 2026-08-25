import type { SupabaseClient } from '@supabase/supabase-js'
import { audit, type AuditInput, type Finding } from './audit'

// Сбор данных для проверки Б14. Отдельно от чистого ядра (lib/accounting/audit.ts),
// чтобы его можно было тестировать без базы. Читает service-role: сводка нужна и
// бухгалтеру в кабинете, и ночному крону, где сессии пользователя нет.

export async function collectAudit(svc: SupabaseClient, today: string): Promise<Finding[]> {
  const yearAgo = new Date(Date.parse(today + 'T00:00:00Z') - 400 * 86_400_000).toISOString().slice(0, 10)
  const halfYear = new Date(Date.parse(today + 'T00:00:00Z') - 180 * 86_400_000).toISOString().slice(0, 10)

  const [payments, posted, skips, bank, entries, reqs, invoices, taxes, accruals, paidPayroll, locks, funds, subfunds] =
    await Promise.all([
      svc.from('payments').select('id,amount,paid_at').is('voided_at', null).gte('paid_at', halfYear),
      svc.from('cashflow_entries').select('payment_id').not('payment_id', 'is', null),
      svc.from('cashflow_payment_skips').select('payment_id'),
      svc.from('bank_statement_rows').select('amount,op_date').eq('status', 'new'),
      svc.from('cashflow_entries').select('id,unit,entry_date,fund_id,amount,counterparty,kind').gte('entry_date', halfYear),
      svc.from('payment_requests').select('amount,status,status_changed_at,counterparty').eq('status', 'approved'),
      svc.from('invoices').select('amount,issued_at,invoice_no').eq('status', 'issued'),
      svc.from('tax_calendar').select('title,due_date,amount,status').gte('due_date', yearAgo),
      svc.from('payroll_accruals').select('subfund_id,person_name,month,kind,amount'),
      svc.from('cashflow_entries').select('subfund_id,amount,entry_date').eq('kind', 'out').gte('entry_date', halfYear),
      svc.from('cashflow_period_locks').select('unit,month'),
      svc.from('cashflow_funds').select('id,name,unit'),
      svc.from('cashflow_subfunds').select('id,fund_id,name'),
    ])

  const done = new Set([
    ...(posted.data ?? []).map(r => Number(r.payment_id)),
    ...(skips.data ?? []).map(r => Number(r.payment_id)),
  ])

  // Долг по зарплате за прошлый месяц: начислено (без удержаний) минус выплачено
  const prevMonth = prev(today.slice(0, 7))
  const payrollFunds = new Set((funds.data ?? [])
    .filter(f => /фонд оплаты труда|сдельная зарплата/i.test(String(f.name)))
    .map(f => Number(f.id)))
  const payrollSubs = new Set((subfunds.data ?? [])
    .filter(s => payrollFunds.has(Number(s.fund_id))).map(s => Number(s.id)))
  const paidBySub = new Map<number, number>()
  for (const e of paidPayroll.data ?? []) {
    const id = Number(e.subfund_id ?? 0)
    if (!payrollSubs.has(id)) continue
    if (String(e.entry_date).slice(0, 7) !== prevMonth) continue
    paidBySub.set(id, (paidBySub.get(id) ?? 0) + Number(e.amount))
  }
  const accruedBySub = new Map<number, { name: string; amount: number }>()
  for (const a of accruals.data ?? []) {
    if (a.month !== prevMonth) continue
    if (['НДФЛ', 'взносы'].includes(String(a.kind))) continue
    const id = Number(a.subfund_id ?? 0)
    const cur = accruedBySub.get(id) ?? { name: String(a.person_name), amount: 0 }
    cur.amount += Number(a.amount)
    accruedBySub.set(id, cur)
  }
  const payrollDebt = [...accruedBySub.entries()]
    .map(([id, v]) => ({ name: v.name, debt: Math.round((v.amount - (paidBySub.get(id) ?? 0)) * 100) / 100 }))
    .filter(p => p.debt > 1)

  // Месяцы с операциями, но без замка (кроме текущего — его рано закрывать)
  const withEntries = new Set<string>()
  for (const e of entries.data ?? []) withEntries.add(`${e.unit}|${String(e.entry_date).slice(0, 7)}`)
  const locked = new Set((locks.data ?? []).map(l => `${l.unit}|${l.month}`))
  const openMonths = [...withEntries]
    .filter(k => !locked.has(k) && k.split('|')[1] < today.slice(0, 7))
    .map(k => ({ unit: k.split('|')[0], month: k.split('|')[1] }))

  const input: AuditInput = {
    today,
    unpostedPayments: (payments.data ?? []).filter(p => !done.has(Number(p.id)))
      .map(p => ({ amount: Number(p.amount), paid_at: String(p.paid_at) })),
    bankRowsNew: (bank.data ?? []).map(r => ({ amount: Number(r.amount), op_date: String(r.op_date) })),
    entries: (entries.data ?? []).map(e => ({
      id: Number(e.id), unit: String(e.unit), entry_date: String(e.entry_date),
      fund_id: Number(e.fund_id), amount: Number(e.amount),
      counterparty: (e.counterparty as string) ?? null, kind: String(e.kind),
    })),
    approvedRequests: (reqs.data ?? []).map(r => ({
      amount: Number(r.amount), status_changed_at: (r.status_changed_at as string) ?? null,
      counterparty: (r.counterparty as string) ?? null,
    })),
    openInvoices: (invoices.data ?? []).map(i => ({
      amount: Number(i.amount), issued_at: String(i.issued_at), no: String(i.invoice_no),
    })),
    taxes: (taxes.data ?? []).map(t => ({
      title: String(t.title), due_date: String(t.due_date),
      amount: t.amount == null ? null : Number(t.amount), status: String(t.status),
    })),
    payrollDebt,
    openMonths,
  }

  return audit(input)
}

function prev(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
