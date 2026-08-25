import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

// Б11: зарплата по людям. Человек — подфонд зарплатных фондов ДДС, выплата —
// операция по этому подфонду. Начисления живут в payroll_accruals: без них
// видно только сколько отдали, но не сколько должны.
// Долг = начислено − выплачено за месяц. Удержания (НДФЛ, взносы) считаются
// отдельной строкой начисления и в долг человеку не идут — это долг государству.

const FIN_ROLES = ['accountant', 'cfo', 'admin', 'ceo'] as const
const WITHHELD = ['НДФЛ', 'взносы']
const PAYROLL_FUNDS = ['фонд оплаты труда', 'сдельная зарплата']

const isPayrollFund = (name: string) =>
  PAYROLL_FUNDS.some(p => name.toLowerCase().includes(p))

export async function GET(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const url = new URL(req.url)
  const unit = url.searchParams.get('unit') === 'ooo' ? 'ooo' : 'ip'
  const month = url.searchParams.get('month') ?? ''
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'Нужен месяц' }, { status: 400 })

  const from = `${month}-01`
  const [y, m] = month.split('-').map(Number)
  const to = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)

  const svc = createServiceClient()
  const { data: funds } = await svc.from('cashflow_funds').select('id,name').eq('unit', unit)
  const payrollFunds = (funds ?? []).filter(f => isPayrollFund(f.name as string))
  const fundIds = payrollFunds.map(f => Number(f.id))

  if (!fundIds.length) return NextResponse.json({ people: [], funds: [] })

  const [{ data: subs }, { data: accruals }, { data: paid }] = await Promise.all([
    svc.from('cashflow_subfunds').select('id,fund_id,name,active').in('fund_id', fundIds).order('sort'),
    svc.from('payroll_accruals').select('*').eq('unit', unit).eq('month', month),
    svc.from('cashflow_entries').select('subfund_id,fund_id,amount')
      .eq('unit', unit).eq('kind', 'out').in('fund_id', fundIds)
      .gte('entry_date', from).lt('entry_date', to),
  ])

  const paidBySub = new Map<number, number>()
  for (const e of paid ?? []) {
    const k = Number(e.subfund_id ?? 0)
    paidBySub.set(k, (paidBySub.get(k) ?? 0) + Number(e.amount))
  }

  const people = (subs ?? []).filter(s => s.active !== false).map(s => {
    const mine = (accruals ?? []).filter(a => Number(a.subfund_id) === Number(s.id))
    const accrued = mine.filter(a => !WITHHELD.includes(a.kind as string))
      .reduce((t, a) => t + Number(a.amount), 0)
    const withheld = mine.filter(a => WITHHELD.includes(a.kind as string))
      .reduce((t, a) => t + Number(a.amount), 0)
    const payment = paidBySub.get(Number(s.id)) ?? 0
    return {
      subfund_id: Number(s.id), fund_id: Number(s.fund_id), name: s.name as string,
      fund: (payrollFunds.find(f => Number(f.id) === Number(s.fund_id))?.name as string) ?? '',
      accrued, withheld, paid: payment, debt: Math.round((accrued - payment) * 100) / 100,
      items: mine.map(a => ({ id: Number(a.id), kind: a.kind as string, amount: Number(a.amount), note: (a.note as string) ?? null })),
    }
  })

  return NextResponse.json({
    people,
    funds: payrollFunds.map(f => ({ id: Number(f.id), name: f.name as string })),
    // прямые выплаты без подфонда — видно, что деньги ушли «в фонд», а не человеку
    unassigned: paidBySub.get(0) ?? 0,
  })
}

export async function POST(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const { data: me } = await sb.from('users').select('name').eq('id', user?.id ?? '').maybeSingle()
  const myName = (me as { name?: string } | null)?.name ?? user?.email ?? 'бухгалтерия'

  const body = await req.json().catch(() => ({}))
  const unit = body.unit === 'ooo' ? 'ooo' : 'ip'
  const month = String(body.month ?? '')
  const amount = Number(body.amount)
  const fundId = Number(body.fund_id)
  const subId = Number(body.subfund_id) || null
  if (!/^\d{4}-\d{2}$/.test(month) || !(amount > 0) || !(fundId > 0)) {
    return NextResponse.json({ error: 'Нужны месяц, фонд и сумма' }, { status: 400 })
  }

  const svc = createServiceClient()

  // Выплата — это операция ДДС; начисление — строка в payroll_accruals
  if (body.action === 'pay') {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date)) ? String(body.date) : `${month}-01`
    const { error } = await svc.from('cashflow_entries').insert({
      entry_date: date, unit, kind: 'out', fund_id: fundId, subfund_id: subId,
      amount, counterparty: String(body.person_name ?? '').trim() || null,
      comment: `Зарплата за ${month}`, entered_by: user?.id ?? null, entered_by_name: myName,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const { error } = await svc.from('payroll_accruals').insert({
    unit, fund_id: fundId, subfund_id: subId,
    person_name: String(body.person_name ?? '').trim() || '—',
    month, kind: String(body.kind ?? 'оклад'), amount,
    note: String(body.note ?? '').trim() || null,
    created_by: user?.id ?? null, created_by_name: myName,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard
  const id = Number(new URL(req.url).searchParams.get('id'))
  if (!(id > 0)) return NextResponse.json({ error: 'Нет начисления' }, { status: 400 })
  const svc = createServiceClient()
  const { error } = await svc.from('payroll_accruals').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
