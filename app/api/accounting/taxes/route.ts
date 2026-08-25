import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { FIN_ROLES } from '@/lib/accounting/roles'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { buildYear, type TaxRegime } from '@/lib/taxCalendar'

// Б12: налоговый календарь. Сроки генерируются типовым набором по режиму, суммы
// проставляет бухгалтер. Оплата рождает операцию ДДС в фонде «Налоги» — так
// налог виден и в календаре, и в ОДДС, а не отдельной вселенной.


async function me() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const { data: u } = await sb.from('users').select('name').eq('id', user?.id ?? '').maybeSingle()
  return { id: user?.id ?? null, name: (u as { name?: string } | null)?.name ?? user?.email ?? 'бухгалтерия' }
}

export async function GET(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const unit = new URL(req.url).searchParams.get('unit') === 'ooo' ? 'ooo' : 'ip'
  const svc = createServiceClient()
  const [{ data: rows }, { data: funds }] = await Promise.all([
    svc.from('tax_calendar').select('*').eq('unit', unit).order('due_date').limit(300),
    svc.from('cashflow_funds').select('id,name').eq('unit', unit),
  ])
  const taxFund = (funds ?? []).find(f => String(f.name).toLowerCase().startsWith('налог'))
  return NextResponse.json({ items: rows ?? [], tax_fund_id: taxFund ? Number(taxFund.id) : null })
}

export async function POST(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const who = await me()
  const body = await req.json().catch(() => ({}))
  const unit = body.unit === 'ooo' ? 'ooo' : 'ip'
  const svc = createServiceClient()

  // Разложить типовые сроки на год
  if (body.action === 'generate') {
    const year = Number(body.year)
    const regime = String(body.regime ?? 'usn') as TaxRegime
    if (!(year > 2020 && year < 2100)) return NextResponse.json({ error: 'Нужен год' }, { status: 400 })
    const dues = buildYear(year, regime, { company: unit === 'ooo', hasStaff: body.has_staff !== false })
    const rows = dues.map(d => ({
      unit, kind: d.kind, title: d.title, period: d.period,
      due_date: d.dueDate, created_by_name: who.name,
    }))
    // ignoreDuplicates: повторная генерация не затирает уже проставленные суммы
    const { error, count } = await svc.from('tax_calendar')
      .upsert(rows, { onConflict: 'unit,kind,period,due_date', ignoreDuplicates: true, count: 'exact' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, added: count ?? 0, total: rows.length })
  }

  // Ручное обязательство
  const due = String(body.due_date ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return NextResponse.json({ error: 'Нужна дата' }, { status: 400 })
  const { error } = await svc.from('tax_calendar').insert({
    unit, kind: String(body.kind ?? 'прочее'), title: String(body.title ?? '').trim() || 'Платёж',
    period: String(body.period ?? '').trim() || null, due_date: due,
    amount: Number(body.amount) > 0 ? Number(body.amount) : null,
    note: String(body.note ?? '').trim() || null, created_by_name: who.name,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const who = await me()
  const body = await req.json().catch(() => ({}))
  const id = Number(body.id)
  if (!(id > 0)) return NextResponse.json({ error: 'Нет платежа' }, { status: 400 })

  const svc = createServiceClient()
  const { data: row } = await svc.from('tax_calendar').select('*').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Не найдено' }, { status: 404 })

  if (body.action === 'amount') {
    const amount = Number(body.amount)
    const { error } = await svc.from('tax_calendar')
      .update({ amount: amount > 0 ? amount : null }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'cancel') {
    await svc.from('tax_calendar').update({ status: 'cancelled' }).eq('id', id)
    return NextResponse.json({ ok: true })
  }

  // Оплата: операция ДДС + отметка в календаре
  const amount = Number(body.amount ?? row.amount)
  const fundId = Number(body.fund_id)
  if (!(amount > 0)) return NextResponse.json({ error: 'Сначала проставьте сумму' }, { status: 400 })
  if (!(fundId > 0)) return NextResponse.json({ error: 'Не найден фонд «Налоги»' }, { status: 400 })

  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date)) ? String(body.date) : String(row.due_date)
  const { data: entry, error } = await svc.from('cashflow_entries').insert({
    entry_date: date, unit: row.unit, kind: 'out', fund_id: fundId,
    subfund_id: Number(body.subfund_id) || null, amount,
    counterparty: 'ФНС', comment: `${row.title}${row.period ? ` · ${row.period}` : ''}`,
    entered_by: who.id, entered_by_name: who.name,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await svc.from('tax_calendar')
    .update({ status: 'paid', amount, entry_id: entry.id }).eq('id', id)
  return NextResponse.json({ ok: true })
}
