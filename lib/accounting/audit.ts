// Б14: проверка бухгалтерии — что не проведено, что задвоилось, где аномалия.
// Чистый модуль: получает срезы данных и сегодняшнюю дату параметром, возвращает
// находки. Никаких запросов и Date.now — иначе это нельзя ни протестировать, ни
// прогнать на вчерашнем состоянии.

export type Severity = 'high' | 'normal' | 'low'
export type Finding = {
  code: string
  severity: Severity
  title: string
  detail: string
  amount?: number
  count?: number
}

export type AuditInput = {
  today: string                                   // YYYY-MM-DD
  unpostedPayments: { amount: number; paid_at: string }[]
  bankRowsNew: { amount: number; op_date: string }[]
  entries: { id: number; unit: string; entry_date: string; fund_id: number; amount: number; counterparty: string | null; kind: string }[]
  approvedRequests: { amount: number; status_changed_at: string | null; counterparty: string | null }[]
  openInvoices: { amount: number; issued_at: string; no: string }[]
  taxes: { title: string; due_date: string; amount: number | null; status: string }[]
  payrollDebt: { name: string; debt: number }[]
  openMonths: { unit: string; month: string }[]   // месяцы с операциями, но без замка
}

const DAY = 86_400_000
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY)
const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + Number(x.amount), 0)
const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'

export function audit(input: AuditInput): Finding[] {
  const { today } = input
  const out: Finding[] = []

  if (input.unpostedPayments.length) {
    const stale = input.unpostedPayments.filter(p => daysBetween(p.paid_at, today) > 3)
    out.push({
      code: 'unposted_payments',
      severity: stale.length ? 'high' : 'normal',
      title: 'Оплаты не проведены в ОДДС',
      detail: stale.length
        ? `${input.unpostedPayments.length} шт., из них ${stale.length} старше трёх дней`
        : `${input.unpostedPayments.length} шт. за последние дни`,
      amount: sum(input.unpostedPayments), count: input.unpostedPayments.length,
    })
  }

  const staleBank = input.bankRowsNew.filter(r => daysBetween(r.op_date, today) > 5)
  if (staleBank.length) {
    out.push({
      code: 'bank_rows_stale', severity: 'normal',
      title: 'Строки выписки лежат неразнесёнными',
      detail: `${staleBank.length} шт. старше пяти дней`,
      amount: sum(staleBank), count: staleBank.length,
    })
  }

  // Дубли: одинаковые юнит + дата + фонд + сумма + контрагент
  const seen = new Map<string, number>()
  for (const e of input.entries) {
    const k = [e.unit, e.entry_date, e.fund_id, e.amount, (e.counterparty ?? '').trim().toLowerCase()].join('|')
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1)
  if (dupes.length) {
    const extra = dupes.reduce((s, [k, n]) => s + Number(k.split('|')[3]) * (n - 1), 0)
    out.push({
      code: 'duplicate_entries', severity: 'high',
      title: 'Похоже на задвоенные операции',
      detail: `${dupes.length} совпадений по дате, фонду, сумме и контрагенту`,
      amount: extra, count: dupes.length,
    })
  }

  const hangingRequests = input.approvedRequests.filter(
    r => r.status_changed_at && daysBetween(r.status_changed_at.slice(0, 10), today) > 7)
  if (hangingRequests.length) {
    out.push({
      code: 'requests_hanging', severity: 'normal',
      title: 'Одобренные заявки не оплачены',
      detail: `${hangingRequests.length} шт. висят дольше недели`,
      amount: sum(hangingRequests), count: hangingRequests.length,
    })
  }

  const oldInvoices = input.openInvoices.filter(i => daysBetween(i.issued_at, today) > 14)
  if (oldInvoices.length) {
    out.push({
      code: 'invoices_unpaid', severity: 'normal',
      title: 'Счета не оплачены дольше двух недель',
      detail: `${oldInvoices.length} шт., самый старый — ${oldInvoices
        .slice().sort((a, b) => a.issued_at.localeCompare(b.issued_at))[0].no}`,
      amount: sum(oldInvoices), count: oldInvoices.length,
    })
  }

  const overdueTax = input.taxes.filter(t => t.status === 'planned' && t.due_date < today)
  if (overdueTax.length) {
    out.push({
      code: 'tax_overdue', severity: 'high',
      title: 'Просроченные налоговые платежи',
      detail: overdueTax.map(t => `${t.title} до ${t.due_date.slice(8, 10)}.${t.due_date.slice(5, 7)}`).join('; '),
      amount: overdueTax.reduce((s, t) => s + Number(t.amount ?? 0), 0), count: overdueTax.length,
    })
  }
  const soonTax = input.taxes.filter(t => t.status === 'planned' && t.due_date >= today && daysBetween(today, t.due_date) <= 5)
  if (soonTax.length) {
    out.push({
      code: 'tax_soon', severity: 'normal',
      title: 'Налоги на этой неделе',
      detail: soonTax.map(t => `${t.title} — ${t.due_date.slice(8, 10)}.${t.due_date.slice(5, 7)}`).join('; '),
      amount: soonTax.reduce((s, t) => s + Number(t.amount ?? 0), 0), count: soonTax.length,
    })
  }

  const debtors = input.payrollDebt.filter(p => p.debt > 1)
  if (debtors.length) {
    out.push({
      code: 'payroll_debt', severity: 'normal',
      title: 'Зарплата начислена, но не выплачена',
      detail: debtors.slice(0, 5).map(p => `${p.name} — ${RUB(p.debt)}`).join('; ')
        + (debtors.length > 5 ? ` и ещё ${debtors.length - 5}` : ''),
      amount: debtors.reduce((s, p) => s + p.debt, 0), count: debtors.length,
    })
  }

  // Аномалия суммы: расход больше пятикратного среднего по своему фонду
  const byFund = new Map<number, number[]>()
  for (const e of input.entries) {
    if (e.kind !== 'out') continue
    if (!byFund.has(e.fund_id)) byFund.set(e.fund_id, [])
    byFund.get(e.fund_id)!.push(Number(e.amount))
  }
  const spikes = input.entries.filter(e => {
    if (e.kind !== 'out') return false
    const list = byFund.get(e.fund_id) ?? []
    if (list.length < 5) return false
    const avg = list.reduce((s, v) => s + v, 0) / list.length
    return Number(e.amount) > avg * 5
  })
  if (spikes.length) {
    out.push({
      code: 'amount_spike', severity: 'low',
      title: 'Необычно крупные расходы',
      detail: `${spikes.length} операций больше пятикратного среднего по своему фонду`,
      amount: sum(spikes), count: spikes.length,
    })
  }

  // Месяц закончился, а замок не поставлен
  const lateOpen = input.openMonths.filter(m => {
    const [y, mm] = m.month.split('-').map(Number)
    const monthEnd = new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10)
    return daysBetween(monthEnd, today) > 10
  })
  if (lateOpen.length) {
    out.push({
      code: 'month_open', severity: 'low',
      title: 'Прошедшие месяцы не закрыты',
      detail: lateOpen.map(m => `${m.unit === 'ooo' ? 'ООО' : 'ИП'} ${m.month}`).join(', '),
      count: lateOpen.length,
    })
  }

  const rank: Record<Severity, number> = { high: 0, normal: 1, low: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}

// Короткий текст для Telegram: только то, что требует действий сегодня.
export function digest(findings: Finding[]): string | null {
  const worth = findings.filter(f => f.severity !== 'low')
  if (!worth.length) return null
  return '🧾 Бухгалтерия, проверка:\n\n' + worth.map(f =>
    `• ${f.title} — ${f.detail}${f.amount ? ` (${RUB(f.amount)})` : ''}`).join('\n')
}
